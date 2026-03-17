import {
  AuditEvent,
  DebateResult,
  DebateRound,
  DissentComputation,
  PatientProfile,
  TriageBlockingReason,
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
import { RuleFirstRiskAssessmentService } from '../../application/services/RuleFirstRiskAssessmentService';
import { FollowupPlanningService } from '../../application/services/FollowupPlanningService';
import { ExplainableReportService } from '../../application/services/ExplainableReportService';
import { ConsentValidationService } from '../../application/services/ConsentValidationService';
import { SafetyOutputGuardService } from '../../application/services/SafetyOutputGuardService';
import { GovernanceReviewService } from '../../application/services/GovernanceReviewService';
import { resolveNextAction } from '../../application/services/FlowControlNextActionService';
import {
  buildRuleGovernanceSnapshot,
  buildValidationErrorGovernanceSnapshot,
} from '../../application/services/RuleGovernanceService';
import { PatientContextEnricher } from '../mcp/PatientContextEnricher';
import { AuthoritativeEvidenceCollector } from './AuthoritativeEvidenceCollector';

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

const FALLBACK_CITATION_MARKER = 'SYSTEM_FALLBACK_OPINION';

export interface ComplexityRoutedOrchestratorOptions {
  fastDepartmentEngines: DepartmentEngines;
  lightDepartmentEngines: DepartmentEngines;
  deepDebateEngine: DebateEngine;
  env?: NodeJS.ProcessEnv;
  patientContextEnricher?: PatientContextEnricher;
  authoritativeMedicalSearch?: AuthoritativeMedicalSearchPort;
  safetyOutputGuardService?: SafetyOutputGuardService;
  strictDiagnosisMode?: boolean;
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

function normalizeBlockingActions(actions: string[]): string[] {
  return [...new Set(actions.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function hasFallbackCitation(citations: string[] | undefined): boolean {
  return (citations ?? []).some((citation) =>
    citation.toUpperCase().includes(FALLBACK_CITATION_MARKER),
  );
}

interface FallbackOpinionDiagnostics {
  totalOpinions: number;
  fallbackOpinions: number;
  fallbackRatio: number;
  fallbackAgents: string[];
  consensusFallback: boolean;
}

function inspectFallbackDiagnostics(result: DebateResult): FallbackOpinionDiagnostics {
  const latestRound = result.rounds[result.rounds.length - 1];
  const opinions = latestRound?.opinions ?? [];
  const fallbackOpinions = opinions.filter((opinion) =>
    hasFallbackCitation(opinion.citations),
  );
  const totalOpinions = opinions.length;
  return {
    totalOpinions,
    fallbackOpinions: fallbackOpinions.length,
    fallbackRatio:
      totalOpinions > 0 ? fallbackOpinions.length / totalOpinions : 0,
    fallbackAgents: fallbackOpinions.map((opinion) => opinion.agentName),
    consensusFallback: hasFallbackCitation(result.finalConsensus?.citations),
  };
}

function shouldBlockPresetDiagnosis(
  result: DebateResult,
  diagnostics: FallbackOpinionDiagnostics,
): boolean {
  if (result.status !== 'OUTPUT') {
    return false;
  }
  return diagnostics.consensusFallback || diagnostics.fallbackRatio >= 0.5;
}

function buildFallbackBlockingReason(detail: string): TriageBlockingReason {
  return {
    code: 'RUNTIME_FAILURE_BLOCKED',
    title: '可信诊断门禁触发',
    summary: detail,
    triggerStage: 'REVIEW',
    severity: 'high',
    actions: normalizeBlockingActions([
      resolveNextAction({ errorCode: 'ERR_LOW_CONFIDENCE_ABSTAIN' }),
      '请确认临床模型与权威证据链可用后再发起线上会诊。',
    ]),
    detail: 'preset_fallback_guard_blocked_output',
  };
}

function buildValidationBlockingReason(
  errorCode: DebateResult['errorCode'],
  detail: string,
  requiredFields: string[] = [],
): TriageBlockingReason {
  const nextAction = resolveNextAction({
    errorCode: errorCode ?? 'ERR_MISSING_REQUIRED_DATA',
    requiredFields,
  });
  return {
    code: 'VALIDATION_BLOCKED',
    title: '输入校验未通过',
    summary: detail,
    triggerStage: 'INFO_GATHER',
    severity: 'warning',
    actions: normalizeBlockingActions([
      requiredFields.length > 0
        ? `补充必要字段：${requiredFields.join('、')}`
        : '补充必要字段后重新提交会诊。',
      nextAction,
    ]),
    detail: errorCode ? `errorCode=${errorCode}` : undefined,
  };
}

function buildEvidenceGateBlockingReason(detail: string): TriageBlockingReason {
  return {
    code: 'EVIDENCE_INTEGRITY_GATE_BLOCKED',
    title: '证据完整性门禁阻断自动输出',
    summary: detail,
    triggerStage: 'REVIEW',
    severity: 'high',
    actions: normalizeBlockingActions([
      '进入人工复核队列并补齐权威证据来源（例如 WHO/NICE）。',
      resolveNextAction({
        errorCode: 'ERR_GUIDELINE_EVIDENCE_MISSING',
      }),
    ]),
    detail: 'authoritative_evidence_completeness_gate_failed',
  };
}

function buildEscalationBlockingReason(detail: string): TriageBlockingReason {
  return {
    code: 'RED_FLAG_SHORT_CIRCUIT',
    title: '触发红旗短路并执行线下上转',
    summary: detail,
    triggerStage: 'ESCALATION',
    severity: 'critical',
    actions: normalizeBlockingActions([
      resolveNextAction({
        errorCode: 'ERR_ESCALATE_TO_OFFLINE',
      }),
      '保留审计记录并通知线下接诊团队。',
    ]),
    detail: 'red_flag_or_offline_escalation_path',
  };
}

export class ComplexityRoutedOrchestrator implements TriageOrchestratorPort {
  private readonly fastDepartmentEngines: DepartmentEngines;
  private readonly lightDepartmentEngines: DepartmentEngines;
  private readonly deepDebateEngine: DebateEngine;
  private readonly strictDiagnosisMode: boolean;
  private readonly intakeService: MinimumInfoSetService;
  private readonly consentService: ConsentValidationService;
  private readonly riskService: RuleFirstRiskAssessmentService;
  private readonly followupService: FollowupPlanningService;
  private readonly reportService: ExplainableReportService;
  private readonly safetyOutputGuardService: SafetyOutputGuardService;
  private readonly governanceReviewService: GovernanceReviewService;
  private readonly patientContextEnricher: PatientContextEnricher;
  private readonly authoritativeEvidenceCollector: AuthoritativeEvidenceCollector;

  constructor(options: ComplexityRoutedOrchestratorOptions) {
    this.fastDepartmentEngines = options.fastDepartmentEngines;
    this.lightDepartmentEngines = options.lightDepartmentEngines;
    this.deepDebateEngine = options.deepDebateEngine;
    this.strictDiagnosisMode = options.strictDiagnosisMode ?? parseBooleanFlag(
      options.env?.COPILOT_CARE_STRICT_DIAGNOSIS_MODE,
      options.env?.NODE_ENV !== 'test',
    );
    this.intakeService = new MinimumInfoSetService();
    this.consentService = new ConsentValidationService(options.env);
    this.riskService = new RuleFirstRiskAssessmentService();
    this.followupService = new FollowupPlanningService();
    this.reportService = new ExplainableReportService();
    this.safetyOutputGuardService =
      options.safetyOutputGuardService ?? new SafetyOutputGuardService();
    this.governanceReviewService = new GovernanceReviewService();
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
    this.authoritativeEvidenceCollector = new AuthoritativeEvidenceCollector({
      authoritativeMedicalSearch: options.authoritativeMedicalSearch,
    });
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
        blockingReason: buildValidationBlockingReason(
          errorCode,
          notes[0],
          requiredFields,
        ),
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
        blockingReason: buildValidationBlockingReason(
          errorCode,
          intake.notes[0] ?? '最小信息集校验失败。',
          requiredFields,
        ),
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
    const authoritativeEvidencePacket =
      await this.authoritativeEvidenceCollector.collect({
        request: workingInput,
        risk,
        options,
      });
    const authoritativeEvidence = authoritativeEvidencePacket.reportLines;
    const authoritativeEvidenceCards = authoritativeEvidencePacket.cards;
    const authoritativeSearch = authoritativeEvidencePacket.diagnostics;

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
        authoritativeSearch,
        dissentIndexHistory: [],
        errorCode: 'ERR_GUIDELINE_EVIDENCE_MISSING',
        blockingReason: buildEvidenceGateBlockingReason(detail),
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
        profile: intake.normalizedProfile,
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
        authoritativeSearch,
        triageResult,
        explainableReport,
        workflowTrace: [...workflowTrace],
        dissentIndexHistory: [],
        errorCode: 'ERR_ESCALATE_TO_OFFLINE',
        blockingReason: buildEscalationBlockingReason(
          risk.redFlagTriggered
            ? '触发红旗规则，已短路线下上转。'
            : '复杂度分流判定需线下上转。',
        ),
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

    const governanceOutcome = this.governanceReviewService.apply(
      result,
      risk,
      options,
    );
    let finalResult = governanceOutcome.debateResult;
    const governanceNotes = governanceOutcome.notes;
    const fallbackDiagnostics = inspectFallbackDiagnostics(finalResult);

    if (
      this.strictDiagnosisMode &&
      shouldBlockPresetDiagnosis(finalResult, fallbackDiagnostics)
    ) {
      const detail =
        `检测到预设回退意见占比 ${fallbackDiagnostics.fallbackOpinions}/${fallbackDiagnostics.totalOpinions}` +
        `（${(fallbackDiagnostics.fallbackRatio * 100).toFixed(0)}%），已阻断自动结论并转人工复核。`;
      options?.onReasoningStep?.(`可信诊断门禁：${detail}`);
      finalResult = {
        ...finalResult,
        status: 'ABSTAIN',
        errorCode: 'ERR_LOW_CONFIDENCE_ABSTAIN',
        finalConsensus: undefined,
        blockingReason: buildFallbackBlockingReason(detail),
        notes: [
          ...finalResult.notes,
          '可信诊断门禁触发：检测到预设回退意见，避免输出伪确定性诊断。',
          detail,
          fallbackDiagnostics.fallbackAgents.length > 0
            ? `回退专家：${fallbackDiagnostics.fallbackAgents.join('、')}`
            : '',
        ].filter((item) => item.length > 0),
      };
    }

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
      profile: intake.normalizedProfile,
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

    const blockingReason: TriageBlockingReason | undefined =
      safetyOutcome.blockingReason
      ?? (safetyOutcome.blocked
        ? {
          code: 'SAFETY_GUARD_BLOCKED',
          title: '安全审校阻断线上建议',
          summary: reviewDetail,
          triggerStage: 'REVIEW',
          severity: 'critical',
          actions: normalizeBlockingActions([
            safetyOutcome.errorCode
              ? resolveNextAction({ errorCode: safetyOutcome.errorCode })
              : '',
            '请安排线下医生复核并完成交接。',
          ]),
          detail: 'safety_output_guard_blocked',
        }
        : safetyOutcome.status === 'ESCALATE_TO_OFFLINE'
          ? finalResult.blockingReason ?? buildEscalationBlockingReason(reviewDetail)
          : finalResult.blockingReason);

    return {
      ...finalResult,
      sessionId,
      requestId,
      auditRef,
      status: safetyOutcome.status,
      errorCode: safetyOutcome.errorCode,
      blockingReason,
      nextAction: safetyOutcome.errorCode
        ? resolveNextAction({
          errorCode: safetyOutcome.errorCode,
        })
        : undefined,
      finalConsensus: safetyOutcome.finalConsensus,
      routing: decision,
      authoritativeSearch,
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





