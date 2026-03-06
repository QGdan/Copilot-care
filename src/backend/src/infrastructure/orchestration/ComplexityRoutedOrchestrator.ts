import {
  AuditEvent,
  DebateResult,
  DebateRound,
  DissentComputation,
  ExplainableEvidenceCard,
  PatientProfile,
  TriageDepartment,
  TriageRequest,
  TriageRouteMode,
  WorkflowStageTrace,
} from '@copilot-care/shared/types';
import {
  decideRouting,
  RoutingDecision,
} from '../../application/services/ComplexityRoutingPolicy';
import {
  OrchestratorRunOptions,
  TriageOrchestratorPort,
} from '../../application/ports/TriageOrchestratorPort';
import { AuthoritativeMedicalSearchPort } from '../../application/ports/AuthoritativeMedicalSearchPort';
import { DebateEngine } from '../../core/DebateEngine';
import { MinimumInfoSetService } from '../../application/services/MinimumInfoSetService';
import {
  RiskAssessmentSnapshot,
  RuleFirstRiskAssessmentService,
} from '../../application/services/RuleFirstRiskAssessmentService';
import { FollowupPlanningService } from '../../application/services/FollowupPlanningService';
import { ExplainableReportService } from '../../application/services/ExplainableReportService';
import { ConsentValidationService } from '../../application/services/ConsentValidationService';
import { SafetyOutputGuardService } from '../../application/services/SafetyOutputGuardService';
import { resolveNextAction } from '../../application/services/FlowControlNextActionService';
import {
  RuleDrivenEvidenceSearchPlan,
  RuleDrivenEvidenceSearchPlanService,
} from '../../application/services/RuleDrivenEvidenceSearchPlanService';
import {
  buildRuleGovernanceSnapshot,
  buildValidationErrorGovernanceSnapshot,
} from '../../application/services/RuleGovernanceService';
import { AuthoritativeMedicalEvidence } from '../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import { PatientContextEnricher } from '../mcp/PatientContextEnricher';

interface DepartmentEngines {
  cardiology: DebateEngine;
  generalPractice: DebateEngine;
  metabolic: DebateEngine;
}

const ROUTE_MODE_LABELS: Record<TriageRouteMode, string> = {
  FAST_CONSENSUS: '快速共识',
  LIGHT_DEBATE: '轻度辩论',
  DEEP_DEBATE: '深度辩论',
  ESCALATE_TO_OFFLINE: '线下上转',
};

const DEPARTMENT_LABELS: Record<TriageDepartment, string> = {
  cardiology: '心血管',
  generalPractice: '全科',
  metabolic: '代谢',
  multiDisciplinary: '多学科',
};

const COLLABORATION_MODE_LABELS: Record<
  RoutingDecision['collaborationMode'],
  string
> = {
  SINGLE_SPECIALTY_PANEL: '同专业多模型协同',
  MULTI_DISCIPLINARY_CONSULT: '多学科专家协同',
  OFFLINE_ESCALATION: '线下上转',
};

import { BaselineGuard } from '../../domain/governance/guards/BaselineGuard';
import { ConfidenceCalibrator } from '../../domain/governance/calibration/ConfidenceCalibrator';

export interface ComplexityRoutedOrchestratorOptions {
  fastDepartmentEngines: DepartmentEngines;
  lightDepartmentEngines: DepartmentEngines;
  deepDebateEngine: DebateEngine;
  patientContextEnricher?: PatientContextEnricher;
  authoritativeMedicalSearch?: AuthoritativeMedicalSearchPort;
  safetyOutputGuardService?: SafetyOutputGuardService;
}

function formatRoundReasoning(round: DebateRound): string {
  return `第${round.roundNumber}轮：分歧指数=${round.dissentIndex.toFixed(3)}，分歧等级=${round.dissentBand}`;
}

function emitRoutingNarrative(
  decision: RoutingDecision,
  options?: OrchestratorRunOptions,
): void {
  options?.onReasoningStep?.(
    `首轮分诊：${DEPARTMENT_LABELS[decision.department]}`,
  );
  options?.onReasoningStep?.(
    `复杂度分流：${ROUTE_MODE_LABELS[decision.routeMode]}（ComplexityScore=${decision.complexityScore}）`,
  );
  options?.onReasoningStep?.(
    `协同模式：${COLLABORATION_MODE_LABELS[decision.collaborationMode]}`,
  );

  for (const reason of decision.reasons.slice(0, 3)) {
    options?.onReasoningStep?.(reason);
  }
}

function buildPanelNarrative(
  routeMode: TriageRouteMode,
  department: TriageDepartment,
): string {
  if (routeMode === 'DEEP_DEBATE') {
    return '进入多学科协同会诊面板（复杂病例路径）。';
  }
  if (routeMode === 'LIGHT_DEBATE') {
    return `进入${DEPARTMENT_LABELS[department]}轻度协同面板（同专业多模型）。`;
  }
  return `进入${DEPARTMENT_LABELS[department]}快速共识面板（同专业优先）。`;
}

function createRoutingAuditEvent(
  sessionId: string,
  decision: RoutingDecision,
): AuditEvent {
  return {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    timestamp: new Date().toISOString(),
    phase: 'ROUTING',
    eventType: 'BAND_SELECTED',
    details:
      `路由决策：mode=${decision.routeMode}, department=${decision.department}, ` +
      `complexity=${decision.complexityScore}`,
    provenance: [
      {
        referenceType: 'rule',
        referenceId: 'COMPLEXITY_ROUTING_V4_30',
        description: 'red-flag first, then complexity score routing',
      },
    ],
  };
}

function createReviewAuditEvent(
  sessionId: string,
  blocked: boolean,
  detail: string,
): AuditEvent {
  return {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    timestamp: new Date().toISOString(),
    phase: 'REVIEW',
    eventType: blocked ? 'ERROR_RAISED' : 'FINALIZED',
    details: detail,
    provenance: [
      {
        referenceType: 'rule',
        referenceId: 'SAFETY_OUTPUT_GUARD_V1',
        description: 'post-consensus boundary review for unsafe output blocking',
      },
    ],
  };
}
function pickDepartmentEngine(
  engines: DepartmentEngines,
  department: TriageDepartment,
): DebateEngine {
  if (department === 'metabolic') {
    return engines.metabolic;
  }
  if (department === 'cardiology') {
    return engines.cardiology;
  }
  return engines.generalPractice;
}

function toThresholdBand(dissentValue: number): DissentComputation['thresholdBand'] {
  if (dissentValue < 0.2) {
    return '一致';
  }
  if (dissentValue < 0.4) {
    return '轻度分歧';
  }
  if (dissentValue < 0.7) {
    return '显著分歧';
  }
  return '严重分歧';
}

function mapDissent(result: DebateResult): DissentComputation | undefined {
  if (result.rounds.length === 0) {
    return undefined;
  }
  const latestRound = result.rounds[result.rounds.length - 1];
  return {
    dissonance: latestRound.dissentIndex,
    clinicalSignificance: latestRound.dissentIndex,
    dissentIndex: latestRound.dissentIndex,
    thresholdBand: toThresholdBand(latestRound.dissentIndex),
  };
}

function createWorkflowStage(
  stage: WorkflowStageTrace['stage'],
  detail: string,
  status: WorkflowStageTrace['status'] = 'done',
): WorkflowStageTrace {
  return {
    stage,
    detail,
    status,
    timestamp: new Date().toISOString(),
  };
}

interface EvidenceCompletenessGateResult {
  enforced: boolean;
  passed: boolean;
  message?: string;
}

interface AuthoritativeEvidencePacket {
  reportLines: string[];
  cards: ExplainableEvidenceCard[];
  gate: EvidenceCompletenessGateResult;
}

function formatEvidenceOrigin(origin: AuthoritativeMedicalEvidence['origin']): string {
  return origin === 'catalog_seed' ? '目录兜底' : '实时检索';
}

export class ComplexityRoutedOrchestrator implements TriageOrchestratorPort {
  private readonly fastDepartmentEngines: DepartmentEngines;
  private readonly lightDepartmentEngines: DepartmentEngines;
  private readonly deepDebateEngine: DebateEngine;
  private readonly intakeService: MinimumInfoSetService;
  private readonly consentService: ConsentValidationService;
  private readonly riskService: RuleFirstRiskAssessmentService;
  private readonly followupService: FollowupPlanningService;
  private readonly reportService: ExplainableReportService;
  private readonly evidencePlanService: RuleDrivenEvidenceSearchPlanService;
  private readonly safetyOutputGuardService: SafetyOutputGuardService;
  private readonly patientContextEnricher: PatientContextEnricher;
  private readonly authoritativeMedicalSearch?: AuthoritativeMedicalSearchPort;
  private readonly baselineGuard: BaselineGuard;
  private readonly confidenceCalibrator: ConfidenceCalibrator;

  constructor(options: ComplexityRoutedOrchestratorOptions) {
    this.fastDepartmentEngines = options.fastDepartmentEngines;
    this.lightDepartmentEngines = options.lightDepartmentEngines;
    this.deepDebateEngine = options.deepDebateEngine;
    this.intakeService = new MinimumInfoSetService();
    this.consentService = new ConsentValidationService();
    this.riskService = new RuleFirstRiskAssessmentService();
    this.followupService = new FollowupPlanningService();
    this.reportService = new ExplainableReportService();
    this.evidencePlanService = new RuleDrivenEvidenceSearchPlanService();
    this.safetyOutputGuardService =
      options.safetyOutputGuardService ?? new SafetyOutputGuardService();
    this.baselineGuard = new BaselineGuard();
    this.confidenceCalibrator = new ConfidenceCalibrator();
    this.patientContextEnricher = options.patientContextEnricher ?? {
      async enrich(input: TriageRequest) {
        return {
          profile: input.profile,
          signals: input.signals ?? [],
          insights: [],
          source: 'local' as const,
        };
      },
    };
    this.authoritativeMedicalSearch = options.authoritativeMedicalSearch;
  }

  private async runByRoute(
    profile: PatientProfile,
    sessionId: string,
    routeMode: TriageRouteMode,
    department: TriageDepartment,
    options?: OrchestratorRunOptions,
  ): Promise<DebateResult> {
    if (routeMode === 'DEEP_DEBATE') {
      return this.deepDebateEngine.runSession(profile, sessionId, {
        onRoundCompleted: (round) => {
          options?.onReasoningStep?.(formatRoundReasoning(round));
        },
      });
    }

    if (routeMode === 'LIGHT_DEBATE') {
      const engine = pickDepartmentEngine(this.lightDepartmentEngines, department);
      return engine.runSession(profile, sessionId, {
        onRoundCompleted: (round) => {
          options?.onReasoningStep?.(formatRoundReasoning(round));
        },
      });
    }

    const engine = pickDepartmentEngine(this.fastDepartmentEngines, department);
    return engine.runSession(profile, sessionId, {
      onRoundCompleted: (round) => {
        options?.onReasoningStep?.(formatRoundReasoning(round));
      },
    });
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

  private async collectAuthoritativeEvidence(
    input: TriageRequest,
    risk: RiskAssessmentSnapshot,
    options?: OrchestratorRunOptions,
  ): Promise<AuthoritativeEvidencePacket> {
    if (!this.authoritativeMedicalSearch || !this.authoritativeMedicalSearch.isEnabled()) {
      options?.onReasoningStep?.(
        '权威医学联网检索未启用（会诊链路）。设置 COPILOT_CARE_MED_SEARCH_IN_TRIAGE=true 后可注入分诊流程。',
      );
      return {
        reportLines: [],
        cards: [],
        gate: { enforced: false, passed: true },
      };
    }

    const plan = this.evidencePlanService.build({
      request: input,
      risk,
    });
    if (plan.query.length < 2) {
      return {
        reportLines: [],
        cards: [],
        gate: { enforced: false, passed: true },
      };
    }

    options?.onReasoningStep?.(
      '权威医学联网检索启动：仅检索白名单权威数据库。',
    );
    options?.onReasoningStep?.(
      `规则驱动检索策略：risk=${risk.riskLevel}，minEvidence=${plan.minEvidenceCount}，requiredSources=${plan.requiredSources.join(',') || 'NONE'}。`,
    );
    for (const note of plan.strategyNotes.slice(0, 2)) {
      options?.onReasoningStep?.(`策略说明：${note}`);
    }

    try {
      const result = await this.authoritativeMedicalSearch.search({
        query: plan.query,
        limit: plan.limit,
        sourceFilter: plan.sourceFilter,
        requiredSources: plan.requiredSources,
      });
      if (result.results.length === 0) {
        options?.onReasoningStep?.(
          '权威医学检索未命中结果，已回退为内置规则证据路径。',
        );
      }

      const cards = result.results.map((item, index) =>
        this.toEvidenceCard(item, index, risk),
      );
      const sourceSummary =
        result.usedSources.length > 0 ? result.usedSources.join(', ') : 'UNKNOWN';
      options?.onReasoningStep?.(
        `权威医学联网检索命中 ${result.results.length} 条（来源：${sourceSummary}）。`,
      );
      options?.onReasoningStep?.(
        `检索质量统计：实时命中=${result.realtimeCount}，目录兜底=${result.fallbackCount}，策略过滤丢弃=${result.droppedByPolicy}。`,
      );
      if (result.fallbackCount > 0) {
        options?.onReasoningStep?.(
          '提示：存在目录兜底证据，建议继续补充实时检索后再做最终医学判断。',
        );
      }
      if (result.sourceBreakdown.length > 0) {
        const breakdownText = result.sourceBreakdown
          .map((item) => `${item.sourceId}x${item.count}`)
          .join('，');
        options?.onReasoningStep?.(
          `权威医学来源分布：${breakdownText}（策略：${result.strategyVersion}）。`,
        );
      }

      const reportLines = cards.map(
        (item, index) => {
          const originLabel = formatEvidenceOrigin(result.results[index]?.origin);
          return `权威医学证据${index + 1}（${item.sourceId ?? 'UNKNOWN'}，${originLabel}）：${item.summary}`;
        },
      );
      for (const line of reportLines) {
        options?.onReasoningStep?.(line);
      }

      const gate = this.evaluateEvidenceCompletenessGate({
        risk,
        plan,
        evidenceCount: cards.length,
        usedSources: result.usedSources,
      });
      if (gate.enforced && !gate.passed) {
        options?.onReasoningStep?.(
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
        risk,
        plan,
        evidenceCount: 0,
        usedSources: [],
      });
      options?.onReasoningStep?.(
        '权威医学检索暂不可用，已回退为内置规则证据路径。',
      );
      if (gate.enforced && !gate.passed) {
        options?.onReasoningStep?.(
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

  public async runSession(
    input: TriageRequest,
    options?: OrchestratorRunOptions,
  ): Promise<DebateResult> {
    const requestId = input.requestId?.trim() || input.sessionId?.trim() || undefined;
    const sessionId = requestId || `sess_${Date.now()}`;
    const auditRef = `audit_${sessionId}`;
    const workflowTrace: WorkflowStageTrace[] = [];
    const pushWorkflowStage = (stage: WorkflowStageTrace): void => {
      workflowTrace.push(stage);
      options?.onWorkflowStage?.(stage);
    };

    pushWorkflowStage(createWorkflowStage('START', '会诊流程启动'));

    const consent = this.consentService.validate(input.consentToken);
    pushWorkflowStage(
      createWorkflowStage(
        'INFO_GATHER',
        consent.ok ? '授权校验通过' : '授权校验失败',
        consent.ok ? 'done' : 'failed',
      ),
    );
    if (!consent.ok) {
      const notes = [consent.message ?? 'consentToken 校验失败。'];
      const errorCode = consent.errorCode ?? 'ERR_MISSING_REQUIRED_DATA';
      const requiredFields = consent.requiredFields ?? ['consentToken'];
      return {
        sessionId,
        requestId,
        auditRef,
        status: 'ERROR',
        rounds: [],
        dissentIndexHistory: [],
        errorCode,
        requiredFields,
        nextAction: resolveNextAction({ errorCode, requiredFields }),
        ruleGovernance: buildValidationErrorGovernanceSnapshot({
          sessionId,
          auditRef,
          errorCode,
          requiredFields,
        }),
        notes,
        workflowTrace: [...workflowTrace],
        auditTrail: [
          {
            eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            sessionId,
            timestamp: new Date().toISOString(),
            phase: 'INFO_GATHER',
            eventType: 'ERROR_RAISED',
            details: `${errorCode}: ${notes.join('; ')}`,
          },
        ],
      };
    }

    const enrichedContext = await this.patientContextEnricher.enrich(input);
    const workingInput: TriageRequest = {
      ...input,
      profile: enrichedContext.profile,
      signals: enrichedContext.signals,
    };
    const mcpInsights = enrichedContext.insights;

    if (enrichedContext.source === 'mcp') {
      options?.onReasoningStep?.(
        '已接入MCP患者云端数据，正在融合历史病历与近期指标。',
      );
      for (const insight of mcpInsights.slice(0, 3)) {
        options?.onReasoningStep?.(`MCP洞察：${insight}`);
      }
    }

    const intake = this.intakeService.assess(workingInput);
    pushWorkflowStage(
      createWorkflowStage(
        'INFO_GATHER',
        intake.ok ? '最小信息集通过' : '最小信息集缺失',
        intake.ok ? 'done' : 'failed',
      ),
    );

    if (!intake.ok) {
      const errorCode: DebateResult['errorCode'] = 'ERR_MISSING_REQUIRED_DATA';
      const requiredFields = intake.requiredFields;
      return {
        sessionId,
        requestId,
        auditRef,
        status: 'ERROR',
        rounds: [],
        dissentIndexHistory: [],
        errorCode,
        requiredFields,
        nextAction: resolveNextAction({ errorCode, requiredFields }),
        ruleGovernance: buildValidationErrorGovernanceSnapshot({
          sessionId,
          auditRef,
          errorCode,
          requiredFields,
        }),
        notes: [...intake.notes, ...mcpInsights],
        workflowTrace: [...workflowTrace],
        auditTrail: [
          {
            eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            sessionId,
            timestamp: new Date().toISOString(),
            phase: 'INFO_GATHER',
            eventType: 'ERROR_RAISED',
            details: `${errorCode}: ${intake.notes.join('; ')}`,
          },
        ],
      };
    }

    const risk = this.riskService.evaluate(
      intake.normalizedProfile,
      workingInput.signals ?? [],
    );
    pushWorkflowStage(
      createWorkflowStage(
        'RISK_ASSESS',
        `规则评估完成：risk=${risk.riskLevel}, triage=${risk.triageLevel}`,
      ),
    );
    const authoritativeEvidencePacket = await this.collectAuthoritativeEvidence(
      workingInput,
      risk,
      options,
    );
    const authoritativeEvidence = authoritativeEvidencePacket.reportLines;
    const authoritativeEvidenceCards = authoritativeEvidencePacket.cards;

    const decision = decideRouting(intake.normalizedProfile);
    pushWorkflowStage(
      createWorkflowStage(
        'ROUTING',
        `路由=${decision.routeMode}, 科室=${decision.department}`,
      ),
    );
    emitRoutingNarrative(decision, options);

    if (
      !risk.redFlagTriggered &&
      decision.routeMode !== 'ESCALATE_TO_OFFLINE' &&
      authoritativeEvidencePacket.gate.enforced &&
      !authoritativeEvidencePacket.gate.passed
    ) {
      const detail =
        authoritativeEvidencePacket.gate.message ??
        '高风险场景未达到权威证据完整性要求。';
      pushWorkflowStage(
        createWorkflowStage('REVIEW', `证据完整性门禁未通过：${detail}`, 'failed'),
      );
      pushWorkflowStage(
        createWorkflowStage('OUTPUT', '已阻断自动输出，等待人工复核', 'failed'),
      );
      return {
        sessionId,
        requestId,
        auditRef,
        status: 'ERROR',
        rounds: [],
        routing: decision,
        dissentIndexHistory: [],
        errorCode: 'ERR_GUIDELINE_EVIDENCE_MISSING',
        nextAction: resolveNextAction({
          errorCode: 'ERR_GUIDELINE_EVIDENCE_MISSING',
        }),
        ruleGovernance: buildRuleGovernanceSnapshot({
          sessionId,
          auditRef,
          risk,
          routing: decision,
          status: 'ERROR',
          errorCode: 'ERR_GUIDELINE_EVIDENCE_MISSING',
        }),
        workflowTrace: [...workflowTrace],
        notes: [
          '证据完整性门禁触发，自动输出已阻断。',
          detail,
          ...mcpInsights,
          ...authoritativeEvidence,
          ...decision.reasons,
        ],
        auditTrail: [
          createRoutingAuditEvent(sessionId, decision),
          createReviewAuditEvent(sessionId, true, `Evidence completeness gate: ${detail}`),
        ],
      };
    }

    if (risk.redFlagTriggered || decision.routeMode === 'ESCALATE_TO_OFFLINE') {
      options?.onReasoningStep?.('触发红旗或上转条件，执行线下就医升级路径。');
      pushWorkflowStage(createWorkflowStage('ESCALATION', '触发红旗短路上转'));
      pushWorkflowStage(
        createWorkflowStage('REVIEW', '红旗短路路径无需专家复核', 'skipped'),
      );
      const triageResult = this.followupService.buildPlan({
        patientId: intake.normalizedProfile.patientId,
        riskLevel: 'L3',
        triageLevel: 'emergency',
        department: 'multiDisciplinary',
      });
      const explainableReport = this.reportService.build({
        triageResult,
        routing: decision,
        ruleEvidence: risk.guidelineBasis,
        additionalEvidence: [...risk.evidence, ...authoritativeEvidence],
        evidenceCards: authoritativeEvidenceCards,
      });

      const outputStage = createWorkflowStage('OUTPUT', '生成上转结果');
      pushWorkflowStage(outputStage);

      return {
        sessionId,
        requestId,
        auditRef,
        status: 'ESCALATE_TO_OFFLINE',
        rounds: [],
        routing: decision,
        triageResult,
        explainableReport,
        workflowTrace: [...workflowTrace],
        dissentIndexHistory: [],
        errorCode: 'ERR_ESCALATE_TO_OFFLINE',
        nextAction: resolveNextAction({
          errorCode: 'ERR_ESCALATE_TO_OFFLINE',
        }),
        ruleGovernance: buildRuleGovernanceSnapshot({
          sessionId,
          auditRef,
          risk,
          routing: decision,
          status: 'ESCALATE_TO_OFFLINE',
          errorCode: 'ERR_ESCALATE_TO_OFFLINE',
        }),
        notes: [
          '红旗边界触发，执行线下上转。',
          ...mcpInsights,
          ...authoritativeEvidence,
          ...decision.reasons,
        ],
        auditTrail: [createRoutingAuditEvent(sessionId, decision)],
      };
    }

    options?.onReasoningStep?.(
      buildPanelNarrative(decision.routeMode, decision.department),
    );
    pushWorkflowStage(createWorkflowStage('DEBATE', '进入多模型协同仲裁'));
    const result = await this.runByRoute(
      intake.normalizedProfile,
      sessionId,
      decision.routeMode,
      decision.department,
      options,
    );
    pushWorkflowStage(createWorkflowStage('CONSENSUS', `状态=${result.status}`));

    // --- 治理层介入 (Governance Layer Injection) ---
    let governedResult = result;
    let governanceNotes: string[] = [];

    if (result.finalConsensus) {
      // 1. 置信度校准
      const calibration = this.confidenceCalibrator.calibrate(result.finalConsensus);
      if (calibration.abstain) {
        governedResult = {
          ...result,
          status: 'ABSTAIN',
          errorCode: 'ERR_LOW_CONFIDENCE_ABSTAIN',
          finalConsensus: undefined, // 撤销共识
        };
        governanceNotes.push(`[置信度校准] 拒答：${calibration.reason}`);
        options?.onReasoningStep?.(`⚠️ 置信度校准未通过：${calibration.reason}`);
      } else {
        // 更新校准后的置信度
        if (governedResult.finalConsensus) {
          governedResult.finalConsensus.confidence = calibration.calibratedConfidence;
        }
        governanceNotes.push(`[置信度校准] 通过：${calibration.reason}`);
      }

      // 2. 基线守护 (仅当未被拒答时)
      if (governedResult.status === 'OUTPUT' && governedResult.finalConsensus) {
        const baselineCheck = this.baselineGuard.check(
          governedResult.finalConsensus,
          risk.riskLevel
        );
        
        if (baselineCheck.conflictFlag) {
          governanceNotes.push(`[基线守护] 发现冲突：${baselineCheck.conflictReason}`);
          options?.onReasoningStep?.(`🛡️ 基线守护触发：${baselineCheck.conflictReason}`);
          
          if (baselineCheck.mitigationAction === 'force_rule') {
             // 强制回退到规则基线
             governedResult.finalConsensus.riskLevel = baselineCheck.ruleRiskLevel;
             governanceNotes.push(`[基线守护] 已强制执行规则基线：${baselineCheck.ruleRiskLevel}`);
          }
        }
      }
    }
    
    // 更新 result 为受控后的结果
    const finalResult = governedResult;

    const finalRiskLevel = finalResult.finalConsensus?.riskLevel ?? risk.riskLevel;
    const triageLevel =
      finalResult.status === 'ESCALATE_TO_OFFLINE' ? 'emergency' : risk.triageLevel;
    const resultDepartment =
      finalResult.status === 'ESCALATE_TO_OFFLINE'
        ? 'multiDisciplinary'
        : decision.department;
    const triageResult = this.followupService.buildPlan({
      patientId: intake.normalizedProfile.patientId,
      riskLevel: finalRiskLevel,
      triageLevel,
      department: resultDepartment,
    });
    const dissent = mapDissent(finalResult);
    if (dissent) {
      triageResult.dissent = dissent;
    }
    const explainableReport = this.reportService.build({
      triageResult,
      finalConsensus: finalResult.finalConsensus,
      routing: decision,
      ruleEvidence: risk.guidelineBasis,
      additionalEvidence: [...risk.evidence, ...authoritativeEvidence],
      evidenceCards: authoritativeEvidenceCards,
    });

    const safetyOutcome = this.safetyOutputGuardService.review({
      request: workingInput,
      debateResult: finalResult,
      triageResult,
      explainableReport,
    });

    const reviewDetail =
      safetyOutcome.blocked
        ? safetyOutcome.reviewDetail
        : finalResult.status === 'OUTPUT'
          ? '专家结论复核通过'
          : finalResult.status === 'ABSTAIN'
            ? '专家结论未收敛/低置信，保守复核完成'
            : finalResult.status === 'ESCALATE_TO_OFFLINE'
              ? '高分歧触发上转，安全复核通过'
              : '复核结果异常';

    pushWorkflowStage(
      createWorkflowStage(
        'REVIEW',
        reviewDetail,
        safetyOutcome.blocked || finalResult.status === 'ERROR' ? 'failed' : 'done',
      ),
    );

    pushWorkflowStage(
      createWorkflowStage(
        'OUTPUT',
        safetyOutcome.blocked
          ? '安全降级输出完成（已阻断不安全建议）'
          : '可解释报告生成完成',
      ),
    );

    const routingNote =
      `首轮分诊=${DEPARTMENT_LABELS[decision.department]}; ` +
      `复杂度分流=${ROUTE_MODE_LABELS[decision.routeMode]}; ` +
      `协同模式=${COLLABORATION_MODE_LABELS[decision.collaborationMode]}; ` +
      `ComplexityScore=${decision.complexityScore}`;

    return {
      ...finalResult,
      sessionId,
      requestId,
      auditRef,
      status: safetyOutcome.status,
      errorCode: safetyOutcome.errorCode,
      nextAction: safetyOutcome.errorCode
        ? resolveNextAction({
          errorCode: safetyOutcome.errorCode,
        })
        : undefined,
      finalConsensus: safetyOutcome.finalConsensus,
      routing: decision,
      triageResult: safetyOutcome.triageResult,
      explainableReport: safetyOutcome.explainableReport,
      ruleGovernance: buildRuleGovernanceSnapshot({
        sessionId,
        auditRef,
        risk,
        routing: decision,
        status: safetyOutcome.status,
        errorCode: safetyOutcome.errorCode,
      }),
      workflowTrace,
      notes: [
        '状态机路径：开始 -> 信息采集 -> 风险评估 -> 分流处理 -> 审校 -> 输出',
        routingNote,
        ...mcpInsights,
        ...authoritativeEvidence,
        ...decision.reasons,
        ...finalResult.notes,
        ...governanceNotes,
        ...safetyOutcome.notes,
      ],
      auditTrail: [
        ...finalResult.auditTrail,
        createRoutingAuditEvent(sessionId, decision),
        createReviewAuditEvent(sessionId, safetyOutcome.blocked, reviewDetail),
      ],
    };
  }
}





