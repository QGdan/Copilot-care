import {
  ErrorCode,
  GovernanceLayerDecision,
  RuleGovernanceSnapshot,
  TriageStatus,
} from '@copilot-care/shared/types';
import {
  AUTHORITATIVE_RULE_CATALOG_VERSION,
  RED_FLAG_SYNONYM_SET_VERSION,
  RULE_IDS,
} from '../../domain/rules/AuthoritativeMedicalRuleCatalog';
import { RiskAssessmentSnapshot } from './RuleFirstRiskAssessmentService';
import { RoutingDecision } from './ComplexityRoutingPolicy';

export interface BuildRuleGovernanceInput {
  sessionId: string;
  auditRef: string;
  risk: RiskAssessmentSnapshot;
  routing?: RoutingDecision;
  status: TriageStatus;
  errorCode?: ErrorCode;
  requiredFields?: string[];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((item) => item.trim().length > 0))];
}

function buildBasicSafetyDecision(
  input: BuildRuleGovernanceInput,
): GovernanceLayerDecision {
  if (input.risk.redFlagTriggered || input.status === 'ESCALATE_TO_OFFLINE') {
    return {
      layer: 'BASIC_SAFETY',
      status: 'escalated',
      summary: '触发急症边界，已强制切换线下上转路径。',
      matchedRuleIds: input.risk.matchedRuleIds.filter((ruleId) =>
        ruleId.startsWith('RULE-BS-'),
      ),
    };
  }

  return {
    layer: 'BASIC_SAFETY',
    status: 'pass',
    summary: '未触发急症短路边界。',
    matchedRuleIds: input.risk.matchedRuleIds.filter((ruleId) =>
      ruleId.startsWith('RULE-BS-'),
    ),
  };
}

function buildFlowControlDecision(
  input: BuildRuleGovernanceInput,
): GovernanceLayerDecision {
  if (
    input.errorCode === 'ERR_MISSING_REQUIRED_DATA'
    || input.errorCode === 'ERR_INVALID_VITAL_SIGN'
    || input.errorCode === 'ERR_GUIDELINE_EVIDENCE_MISSING'
  ) {
    return {
      layer: 'FLOW_CONTROL',
      status: 'fail',
      summary:
        `输入门禁阻断：${input.errorCode}。` +
        (input.requiredFields?.length
          ? ` requiredFields=${input.requiredFields.join(',')}`
          : ''),
      matchedRuleIds: input.risk.matchedRuleIds.filter((ruleId) =>
        ruleId.startsWith('RULE-FC-'),
      ),
    };
  }

  return {
    layer: 'FLOW_CONTROL',
    status: 'pass',
    summary: '同意授权与最小信息门禁已通过。',
    matchedRuleIds: input.risk.matchedRuleIds.filter((ruleId) =>
      ruleId.startsWith('RULE-FC-'),
    ),
  };
}

function buildIntelligentCollabDecision(
  input: BuildRuleGovernanceInput,
): GovernanceLayerDecision {
  if (
    input.status === 'ABSTAIN'
    || input.errorCode === 'ERR_LOW_CONFIDENCE_ABSTAIN'
    || input.errorCode === 'ERR_CONFLICT_UNRESOLVED'
  ) {
    return {
      layer: 'INTELLIGENT_COLLABORATION',
      status: 'warn',
      summary:
        '模型置信度/冲突守护触发，已进入 ABSTAIN 兜底。',
      matchedRuleIds: input.routing?.matchedRuleIds ?? [],
    };
  }

  return {
    layer: 'INTELLIGENT_COLLABORATION',
    status: 'pass',
    summary: `路由决策=${input.routing?.routeMode ?? 'N/A'}。`,
    matchedRuleIds: input.routing?.matchedRuleIds ?? [],
  };
}

function buildOperationsDecision(): GovernanceLayerDecision {
  return {
    layer: 'OPERATIONS',
    status: 'pass',
    summary:
      '运行时遥测已关联发布门禁（gate:metrics / gate:all）。',
    matchedRuleIds: [RULE_IDS.OPERATIONS_GOVERNANCE_RELEASE_LINK],
  };
}

export function buildRuleGovernanceSnapshot(
  input: BuildRuleGovernanceInput,
): RuleGovernanceSnapshot {
  const matchedRuleIds = dedupe([
    ...input.risk.matchedRuleIds,
    ...(input.routing?.matchedRuleIds ?? []),
    RULE_IDS.OPERATIONS_GOVERNANCE_RELEASE_LINK,
  ]);

  return {
    catalogVersion: AUTHORITATIVE_RULE_CATALOG_VERSION,
    synonymSetVersion: RED_FLAG_SYNONYM_SET_VERSION,
    matchedRuleIds,
    guidelineRefs: [...input.risk.guidelineBasis],
    layerDecisions: [
      buildBasicSafetyDecision(input),
      buildFlowControlDecision(input),
      buildIntelligentCollabDecision(input),
      buildOperationsDecision(),
    ],
    evidenceTraceId: input.auditRef || `audit_${input.sessionId}`,
  };
}

export function buildValidationErrorGovernanceSnapshot(input: {
  sessionId: string;
  auditRef: string;
  errorCode: ErrorCode;
  requiredFields?: string[];
}): RuleGovernanceSnapshot {
  return {
    catalogVersion: AUTHORITATIVE_RULE_CATALOG_VERSION,
    synonymSetVersion: RED_FLAG_SYNONYM_SET_VERSION,
    matchedRuleIds: dedupe([
      RULE_IDS.FLOW_CONTROL_MINIMUM_INFOSET_GATE,
      RULE_IDS.OPERATIONS_GOVERNANCE_RELEASE_LINK,
    ]),
    guidelineRefs: [],
    layerDecisions: [
      {
        layer: 'BASIC_SAFETY',
        status: 'pass',
        summary: '因入参校验失败，未进入急症边界评估。',
      },
      {
        layer: 'FLOW_CONTROL',
        status: 'fail',
        summary:
          `校验阻断：${input.errorCode}。` +
          (input.requiredFields?.length
            ? ` requiredFields=${input.requiredFields.join(',')}`
            : ''),
        matchedRuleIds: [RULE_IDS.FLOW_CONTROL_MINIMUM_INFOSET_GATE],
      },
      {
        layer: 'INTELLIGENT_COLLABORATION',
        status: 'blocked',
        summary: '因校验失败，路由与辩论阶段已跳过。',
      },
      {
        layer: 'OPERATIONS',
        status: 'pass',
        summary:
          '校验结果已纳入审计链路并关联发布证据门禁。',
        matchedRuleIds: [RULE_IDS.OPERATIONS_GOVERNANCE_RELEASE_LINK],
      },
    ],
    evidenceTraceId: input.auditRef || `audit_${input.sessionId}`,
  };
}
