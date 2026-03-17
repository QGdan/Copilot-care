import {
  AuthoritativeSearchDiagnostics,
  ExplainableEvidenceCard,
  TriageRequest,
} from '@copilot-care/shared/types';
import { AuthoritativeMedicalSearchPort } from '../../application/ports/AuthoritativeMedicalSearchPort';
import { OrchestratorRunOptions } from '../../application/ports/TriageOrchestratorPort';
import {
  RiskAssessmentSnapshot,
} from '../../application/services/RuleFirstRiskAssessmentService';
import {
  RuleDrivenEvidenceSearchPlan,
  RuleDrivenEvidenceSearchPlanService,
} from '../../application/services/RuleDrivenEvidenceSearchPlanService';
import { AuthoritativeMedicalEvidence } from '../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';

export interface EvidenceCompletenessGateResult {
  enforced: boolean;
  passed: boolean;
  message?: string;
}

export interface AuthoritativeEvidencePacket {
  reportLines: string[];
  cards: ExplainableEvidenceCard[];
  gate: EvidenceCompletenessGateResult;
  diagnostics?: AuthoritativeSearchDiagnostics;
}

interface AuthoritativeEvidenceCollectorOptions {
  authoritativeMedicalSearch?: AuthoritativeMedicalSearchPort;
  evidencePlanService?: RuleDrivenEvidenceSearchPlanService;
}

function formatEvidenceOrigin(origin: AuthoritativeMedicalEvidence['origin']): string {
  return origin === 'catalog_seed' ? '目录兜底' : '实时检索';
}

export class AuthoritativeEvidenceCollector {
  private readonly authoritativeMedicalSearch?: AuthoritativeMedicalSearchPort;

  private readonly evidencePlanService: RuleDrivenEvidenceSearchPlanService;

  constructor(options: AuthoritativeEvidenceCollectorOptions) {
    this.authoritativeMedicalSearch = options.authoritativeMedicalSearch;
    this.evidencePlanService =
      options.evidencePlanService ?? new RuleDrivenEvidenceSearchPlanService();
  }

  private normalizeEvidenceFingerprintText(value: string): string {
    return value
      .toLowerCase()
      .replace(/([\\/]\s*){2,}/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  }

  private toBigramSet(value: string): Set<string> {
    const normalized = this.normalizeEvidenceFingerprintText(value);
    const grams = new Set<string>();
    if (!normalized) {
      return grams;
    }
    if (normalized.length < 2) {
      grams.add(normalized);
      return grams;
    }
    for (let index = 0; index < normalized.length - 1; index += 1) {
      grams.add(normalized.slice(index, index + 2));
    }
    return grams;
  }

  private diceSimilarity(left: string, right: string): number {
    const leftSet = this.toBigramSet(left);
    const rightSet = this.toBigramSet(right);
    if (leftSet.size === 0 || rightSet.size === 0) {
      return 0;
    }
    let intersection = 0;
    for (const token of leftSet) {
      if (rightSet.has(token)) {
        intersection += 1;
      }
    }
    return (2 * intersection) / (leftSet.size + rightSet.size);
  }

  private isNearDuplicateEvidence(
    left: AuthoritativeMedicalEvidence,
    right: AuthoritativeMedicalEvidence,
  ): boolean {
    const leftSource = (left.sourceId ?? '').toUpperCase();
    const rightSource = (right.sourceId ?? '').toUpperCase();
    if (leftSource !== rightSource) {
      return false;
    }
    const leftCore = this.normalizeEvidenceFingerprintText(
      `${left.title} ${left.snippet ?? ''}`,
    );
    const rightCore = this.normalizeEvidenceFingerprintText(
      `${right.title} ${right.snippet ?? ''}`,
    );
    if (!leftCore || !rightCore) {
      return false;
    }
    if (leftCore === rightCore) {
      return true;
    }
    const shorter = leftCore.length <= rightCore.length ? leftCore : rightCore;
    const longer = leftCore.length > rightCore.length ? leftCore : rightCore;
    if (shorter.length >= 24 && longer.includes(shorter)) {
      return true;
    }
    return this.diceSimilarity(leftCore, rightCore) >= 0.9;
  }

  private dedupeSearchResults(
    results: readonly AuthoritativeMedicalEvidence[],
  ): AuthoritativeMedicalEvidence[] {
    const selected: AuthoritativeMedicalEvidence[] = [];
    for (const item of results) {
      const duplicateIndex = selected.findIndex((existing) =>
        this.isNearDuplicateEvidence(existing, item),
      );
      if (duplicateIndex < 0) {
        selected.push(item);
        continue;
      }

      const current = selected[duplicateIndex];
      const currentHasPublished = typeof current.publishedOn === 'string' && current.publishedOn.trim().length > 0;
      const candidateHasPublished = typeof item.publishedOn === 'string' && item.publishedOn.trim().length > 0;
      const currentSnippetLength = (current.snippet ?? '').trim().length;
      const candidateSnippetLength = (item.snippet ?? '').trim().length;
      if (
        (!currentHasPublished && candidateHasPublished)
        || candidateSnippetLength > currentSnippetLength
      ) {
        selected[duplicateIndex] = item;
      }
    }
    return selected;
  }

  private clampScore(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    if (value < 0) {
      return 0;
    }
    if (value > 1) {
      return 1;
    }
    return value;
  }

  private roundScore(value: number): number {
    return Number(this.clampScore(value).toFixed(3));
  }

  private isReadableEvidenceSummary(value: string): boolean {
    const text = value.trim();
    if (!text) {
      return false;
    }
    if (
      !text.includes('证据要点：')
      || !text.includes('临床解读：')
      || !text.includes('建议动作：')
    ) {
      return false;
    }
    if (/([\\/]\s*){2,}/u.test(text)) {
      return false;
    }
    if (/证据要点：\s*证据要点：/u.test(text)) {
      return false;
    }
    if (/([。！？!?]\s*){2,}/u.test(text)) {
      return false;
    }
    const chineseCount = (text.match(/[\u4E00-\u9FFF]/gu) ?? []).length;
    return chineseCount >= 20;
  }

  private buildQualityDiagnostics(input: {
    plan: RuleDrivenEvidenceSearchPlan;
    cards: ExplainableEvidenceCard[];
    usedSources: readonly string[];
    realtimeCount: number;
    fallbackCount: number;
    droppedByPolicy: number;
    dedupeRemovedCount: number;
  }): AuthoritativeSearchDiagnostics['quality'] {
    const decomposedCount = input.plan.decomposedNeeds.length;
    const restatementLength = input.plan.professionalRestatement.trim().length;
    const intentUnderstandingScore = this.roundScore(
      (decomposedCount >= 2 ? 0.55 : decomposedCount === 1 ? 0.35 : 0.1)
      + (restatementLength >= 24 ? 0.45 : restatementLength >= 12 ? 0.3 : 0.1),
    );

    const requiredTotal = input.plan.requiredSources.length;
    const requiredMatched =
      requiredTotal > 0
        ? input.plan.requiredSources.filter((sourceId) =>
          input.usedSources.includes(sourceId),
        ).length
        : 0;
    const requiredCoverageScore =
      requiredTotal > 0 ? requiredMatched / requiredTotal : 1;
    const retrievalBase = input.realtimeCount + input.fallbackCount;
    const realtimeRatio = retrievalBase > 0 ? input.realtimeCount / retrievalBase : 0;
    const retrievalCoverageScore = this.roundScore(
      realtimeRatio * 0.65 + requiredCoverageScore * 0.35,
    );

    const sourceDiversityScore = input.cards.length > 0
      ? new Set(
        input.cards.map((item) => (item.sourceId ?? '').trim()).filter(Boolean),
      ).size / input.cards.length
      : 0;
    const dedupePenaltyBase = input.cards.length + input.dedupeRemovedCount;
    const dedupePenalty = dedupePenaltyBase > 0
      ? input.dedupeRemovedCount / dedupePenaltyBase
      : 0;
    const policyPenalty = retrievalBase > 0
      ? Math.min(1, input.droppedByPolicy / Math.max(1, retrievalBase * 2))
      : 0;
    const evidenceSelectionScore = this.roundScore(
      sourceDiversityScore * 0.6
      + (1 - dedupePenalty) * 0.3
      + (1 - policyPenalty) * 0.1,
    );

    const readableCount = input.cards.filter((item) =>
      this.isReadableEvidenceSummary(item.summary),
    ).length;
    const summarizationReadabilityScore = this.roundScore(
      input.cards.length > 0 ? readableCount / input.cards.length : 0,
    );

    const stageScores: Array<{
      stage: NonNullable<AuthoritativeSearchDiagnostics['quality']>['weakestStage'];
      score: number;
    }> = [
      { stage: 'intent_understanding', score: intentUnderstandingScore },
      { stage: 'retrieval', score: retrievalCoverageScore },
      { stage: 'evidence_selection', score: evidenceSelectionScore },
      { stage: 'summarization', score: summarizationReadabilityScore },
    ];
    const weakest = stageScores.reduce((lowest, current) =>
      current.score < lowest.score ? current : lowest,
    );
    const weakestStage =
      weakest.score >= 0.8 ? 'none' : weakest.stage;

    const optimizationHints: string[] = [];
    if (intentUnderstandingScore < 0.75) {
      optimizationHints.push(
        '优化需求拆分与专业重述，优先补充症状时序、危险分层和鉴别诊断目标。',
      );
    }
    if (retrievalCoverageScore < 0.75) {
      optimizationHints.push(
        '提升实时检索覆盖率，优先满足必选来源命中（WHO/NICE/NIH 等）并减少目录兜底占比。',
      );
    }
    if (evidenceSelectionScore < 0.75) {
      optimizationHints.push(
        '加强证据去重与多源融合，避免同源同义条目重复占用证据位。',
      );
    }
    if (summarizationReadabilityScore < 0.8) {
      optimizationHints.push(
        '增强证据概述可读性闸门，输出“证据要点-临床解读-建议动作”的简明临床句式。',
      );
    }

    return {
      intentUnderstandingScore,
      retrievalCoverageScore,
      evidenceSelectionScore,
      summarizationReadabilityScore,
      weakestStage,
      optimizationHints,
    };
  }

  private buildDiagnostics(input: {
    plan: RuleDrivenEvidenceSearchPlan;
    cards?: ExplainableEvidenceCard[];
    dedupeRemovedCount?: number;
    result: {
      query: string;
      strategyVersion?: string;
      usedSources?: string[];
      sourceBreakdown?: Array<{ sourceId: string; count: number }>;
      realtimeCount?: number;
      fallbackCount?: number;
      droppedByPolicy?: number;
      fallbackReasons?: string[];
      missingRequiredSources?: string[];
    };
  }): AuthoritativeSearchDiagnostics {
    return {
      query: input.result.query,
      queryVariants: [...input.plan.queryVariants],
      strategyVersion: input.result.strategyVersion ?? 'unknown',
      usedSources: [...(input.result.usedSources ?? [])],
      sourceBreakdown: [...(input.result.sourceBreakdown ?? [])],
      realtimeCount: input.result.realtimeCount ?? 0,
      fallbackCount: input.result.fallbackCount ?? 0,
      droppedByPolicy: input.result.droppedByPolicy ?? 0,
      fallbackReasons: [...(input.result.fallbackReasons ?? [])],
      missingRequiredSources: [...(input.result.missingRequiredSources ?? [])],
      requiredSources: [...input.plan.requiredSources],
      minEvidenceCount: input.plan.minEvidenceCount,
      decomposedNeeds: [...input.plan.decomposedNeeds],
      professionalRestatement: input.plan.professionalRestatement,
      activatedSkills: [...input.plan.activatedSkills],
      quality: this.buildQualityDiagnostics({
        plan: input.plan,
        cards: [...(input.cards ?? [])],
        usedSources: [...(input.result.usedSources ?? [])],
        realtimeCount: input.result.realtimeCount ?? 0,
        fallbackCount: input.result.fallbackCount ?? 0,
        droppedByPolicy: input.result.droppedByPolicy ?? 0,
        dedupeRemovedCount: input.dedupeRemovedCount ?? 0,
      }),
    };
  }

  public async collect(
    input: {
      request: TriageRequest;
      risk: RiskAssessmentSnapshot;
      options?: Pick<OrchestratorRunOptions, 'onReasoningStep'>;
    },
  ): Promise<AuthoritativeEvidencePacket> {
    if (
      !this.authoritativeMedicalSearch
      || !this.authoritativeMedicalSearch.isEnabled()
    ) {
      input.options?.onReasoningStep?.(
        '权威医学联网检索未启用，当前分诊流程不接入实时检索。',
      );
      return {
        reportLines: [],
        cards: [],
        gate: { enforced: false, passed: true },
      };
    }

    const plan = this.evidencePlanService.build({
      request: input.request,
      risk: input.risk,
    });
    if (plan.query.length < 2) {
      return {
        reportLines: [],
        cards: [],
        gate: { enforced: false, passed: true },
      };
    }

    input.options?.onReasoningStep?.('已启动权威医学联网检索。');
    input.options?.onReasoningStep?.(
      `规则驱动检索计划：风险等级=${input.risk.riskLevel}，最少证据=${plan.minEvidenceCount}，必选来源=${plan.requiredSources.join(',') || '无'}`,
    );
    if (plan.decomposedNeeds.length > 0) {
      input.options?.onReasoningStep?.(
        `需求拆分：${plan.decomposedNeeds.slice(0, 4).join('；')}`,
      );
    }
    if (plan.professionalRestatement.trim()) {
      input.options?.onReasoningStep?.(
        `专业化重述：${plan.professionalRestatement}`,
      );
    }
    if (plan.queryVariants.length > 1) {
      input.options?.onReasoningStep?.(
        `检索改写：${plan.queryVariants.slice(0, 3).join(' | ')}`,
      );
    }
    if (plan.activatedSkills.length > 0) {
      input.options?.onReasoningStep?.(
        `主 Agent 技能链：${plan.activatedSkills.join(' -> ')}`,
      );
    }
    for (const note of plan.strategyNotes.slice(0, 2)) {
      input.options?.onReasoningStep?.(`策略说明：${note}`);
    }

    try {
      const result = await this.authoritativeMedicalSearch.search({
        query: plan.query,
        queryVariants: plan.queryVariants,
        limit: plan.limit,
        sourceFilter: plan.sourceFilter,
        requiredSources: plan.requiredSources,
      });
      if (result.results.length === 0) {
        input.options?.onReasoningStep?.(
          '未命中实时权威证据，已保留规则证据兜底路径。',
        );
      }

      const dedupedResults = this.dedupeSearchResults(result.results);
      const cards = dedupedResults.map((item, index) =>
        this.toEvidenceCard(item, index, input.risk),
      );
      const dedupeRemovedCount = Math.max(0, result.results.length - dedupedResults.length);
      const sourceSummary =
        result.usedSources.length > 0 ? result.usedSources.join(', ') : '未知';
      input.options?.onReasoningStep?.(
        `权威检索命中：去重后 ${cards.length} 条（原始 ${result.results.length} 条，来源：${sourceSummary}）。`,
      );
      if (dedupeRemovedCount > 0) {
        input.options?.onReasoningStep?.(
          `证据去重：移除 ${dedupeRemovedCount} 条近重复条目。`,
        );
      }
      input.options?.onReasoningStep?.(
        `检索质量统计：实时=${result.realtimeCount}，兜底=${result.fallbackCount}，策略过滤丢弃=${result.droppedByPolicy}。`,
      );
      if (result.fallbackCount > 0) {
        input.options?.onReasoningStep?.(
          '存在目录兜底证据，建议继续补充实时权威来源后再给出最终结论。',
        );
      }
      if (result.sourceBreakdown.length > 0) {
        const breakdownText = result.sourceBreakdown
          .map((item) => `${item.sourceId}x${item.count}`)
          .join('，');
        input.options?.onReasoningStep?.(
          `权威医学来源分布：${breakdownText}（策略：${result.strategyVersion}）`,
        );
      }

      const reportLines = cards.map((item, index) => {
        const originLabel = formatEvidenceOrigin(dedupedResults[index]?.origin);
        return `权威证据${index + 1}（${item.sourceId ?? '未知'}，${originLabel}）：${item.summary}`;
      });
      for (const line of reportLines) {
        input.options?.onReasoningStep?.(line);
      }

      const gate = this.evaluateEvidenceCompletenessGate({
        risk: input.risk,
        plan,
        evidenceCount: cards.length,
        usedSources: result.usedSources,
      });
      if (gate.enforced && !gate.passed) {
        input.options?.onReasoningStep?.(
          `证据完整性门禁未通过：${gate.message ?? '证据不足'}`,
        );
      }

      return {
        reportLines,
        cards,
        gate,
        diagnostics: this.buildDiagnostics({
          plan,
          cards,
          dedupeRemovedCount,
          result: {
            query: result.query,
            strategyVersion: result.strategyVersion,
            usedSources: result.usedSources,
            sourceBreakdown: result.sourceBreakdown,
            realtimeCount: result.realtimeCount,
            fallbackCount: result.fallbackCount,
            droppedByPolicy: result.droppedByPolicy,
            fallbackReasons: result.fallbackReasons,
            missingRequiredSources: result.missingRequiredSources,
          },
        }),
      };
    } catch {
      const gate = this.evaluateEvidenceCompletenessGate({
        risk: input.risk,
        plan,
        evidenceCount: 0,
        usedSources: [],
      });
      input.options?.onReasoningStep?.(
        '权威医学联网检索暂不可用，已切换为规则证据兜底路径。',
      );
      if (gate.enforced && !gate.passed) {
        input.options?.onReasoningStep?.(
          '证据完整性门禁未通过：高风险场景下实时检索不可用。',
        );
      }
      return {
        reportLines: [],
        cards: [],
        gate,
        diagnostics: this.buildDiagnostics({
          plan,
          cards: [],
          dedupeRemovedCount: 0,
          result: {
            query: plan.query,
            strategyVersion: 'search_error_fallback',
            usedSources: [],
            sourceBreakdown: [],
            realtimeCount: 0,
            fallbackCount: 0,
            droppedByPolicy: 0,
            fallbackReasons: ['search_error'],
            missingRequiredSources: [...plan.requiredSources],
          },
        }),
      };
    }
  }

  private getRiskNumeric(level: RiskAssessmentSnapshot['riskLevel']): number {
    if (level === 'L3') {
      return 3;
    }
    if (level === 'L2') {
      return 2;
    }
    if (level === 'L1') {
      return 1;
    }
    return 0;
  }

  private evaluateEvidenceCompletenessGate(input: {
    risk: RiskAssessmentSnapshot;
    plan: RuleDrivenEvidenceSearchPlan;
    evidenceCount: number;
    usedSources: string[];
  }): EvidenceCompletenessGateResult {
    const riskNumeric = this.getRiskNumeric(input.risk.riskLevel);
    const enforced = riskNumeric >= 2;
    if (!enforced) {
      return { enforced: false, passed: true };
    }

    const usedSourceSet = new Set(input.usedSources);
    const missingRequiredSources = input.plan.requiredSources.filter(
      (sourceId) => !usedSourceSet.has(sourceId),
    );
    const countPassed = input.evidenceCount >= input.plan.minEvidenceCount;
    const sourcePassed = missingRequiredSources.length === 0;
    const passed = countPassed && sourcePassed;
    if (passed) {
      return { enforced: true, passed: true };
    }

    const issues: string[] = [];
    if (!countPassed) {
      issues.push(
        `证据数量不足（${input.evidenceCount}/${input.plan.minEvidenceCount}）`,
      );
    }
    if (!sourcePassed) {
      issues.push(`缺少必选来源（${missingRequiredSources.join(',')}）`);
    }
    return {
      enforced: true,
      passed: false,
      message: issues.join('；'),
    };
  }

  private toEvidenceCard(
    evidence: AuthoritativeMedicalEvidence,
    index: number,
    risk: RiskAssessmentSnapshot,
  ): ExplainableEvidenceCard {
    const snippet =
      evidence.snippet?.trim()
      || '来自权威医学来源的证据摘要。';
    return {
      id: `auth-med-${index + 1}-${evidence.sourceId.toLowerCase()}`,
      category: 'authoritative_web',
      title: evidence.title,
      summary: snippet,
      sourceId: evidence.sourceId,
      sourceName: evidence.sourceName,
      publishedOn: evidence.publishedOn,
      retrievedAt: evidence.retrievedAt,
      url: evidence.url,
      supportsRuleIds: [...risk.matchedRuleIds],
    };
  }
}
