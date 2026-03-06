import { ExplainableEvidenceCard, TriageRequest } from '@copilot-care/shared/types';
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
        '权威医学联网检索未启用（会诊链路）。设置 COPILOT_CARE_MED_SEARCH_IN_TRIAGE=true 后可注入分诊流程。',
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

    input.options?.onReasoningStep?.(
      '权威医学联网检索启动：仅检索白名单权威数据库。',
    );
    input.options?.onReasoningStep?.(
      `规则驱动检索策略：risk=${input.risk.riskLevel}，minEvidence=${plan.minEvidenceCount}，requiredSources=${plan.requiredSources.join(',') || 'NONE'}。`,
    );
    for (const note of plan.strategyNotes.slice(0, 2)) {
      input.options?.onReasoningStep?.(`策略说明：${note}`);
    }

    try {
      const result = await this.authoritativeMedicalSearch.search({
        query: plan.query,
        limit: plan.limit,
        sourceFilter: plan.sourceFilter,
        requiredSources: plan.requiredSources,
      });
      if (result.results.length === 0) {
        input.options?.onReasoningStep?.(
          '权威医学检索未命中结果，已回退为内置规则证据路径。',
        );
      }

      const cards = result.results.map((item, index) =>
        this.toEvidenceCard(item, index, input.risk),
      );
      const sourceSummary =
        result.usedSources.length > 0 ? result.usedSources.join(', ') : 'UNKNOWN';
      input.options?.onReasoningStep?.(
        `权威医学联网检索命中 ${result.results.length} 条（来源：${sourceSummary}）。`,
      );
      input.options?.onReasoningStep?.(
        `检索质量统计：实时命中=${result.realtimeCount}，目录兜底=${result.fallbackCount}，策略过滤丢弃=${result.droppedByPolicy}。`,
      );
      if (result.fallbackCount > 0) {
        input.options?.onReasoningStep?.(
          '提示：存在目录兜底证据，建议继续补充实时检索后再做最终医学判断。',
        );
      }
      if (result.sourceBreakdown.length > 0) {
        const breakdownText = result.sourceBreakdown
          .map((item) => `${item.sourceId}x${item.count}`)
          .join('，');
        input.options?.onReasoningStep?.(
          `权威医学来源分布：${breakdownText}（策略：${result.strategyVersion}）。`,
        );
      }

      const reportLines = cards.map((item, index) => {
        const originLabel = formatEvidenceOrigin(result.results[index]?.origin);
        return `权威医学证据${index + 1}（${item.sourceId ?? 'UNKNOWN'}，${originLabel}）：${item.summary}`;
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
          `证据完整性门禁未通过：${gate.message ?? '证据不足'}。`,
        );
      }

      return {
        reportLines,
        cards,
        gate,
      };
    } catch {
      const gate = this.evaluateEvidenceCompletenessGate({
        risk: input.risk,
        plan,
        evidenceCount: 0,
        usedSources: [],
      });
      input.options?.onReasoningStep?.(
        '权威医学检索暂不可用，已回退为内置规则证据路径。',
      );
      if (gate.enforced && !gate.passed) {
        input.options?.onReasoningStep?.(
          '证据完整性门禁未通过：联网检索不可用且高风险场景证据不足。',
        );
      }
      return {
        reportLines: [],
        cards: [],
        gate,
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
        `证据数量不足(${input.evidenceCount}/${input.plan.minEvidenceCount})`,
      );
    }
    if (!sourcePassed) {
      issues.push(`缺少必选来源(${missingRequiredSources.join(',')})`);
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
    const snippet = evidence.snippet?.trim() || '来自权威医学数据库的相关证据。';
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
