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
      summary: 'Emergency boundary hit; offline escalation path enforced.',
      matchedRuleIds: input.risk.matchedRuleIds.filter((ruleId) =>
        ruleId.startsWith('RULE-BS-'),
      ),
    };
  }

  return {
    layer: 'BASIC_SAFETY',
    status: 'pass',
    summary: 'No emergency short-circuit boundary triggered.',
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
  ) {
    return {
      layer: 'FLOW_CONTROL',
      status: 'fail',
      summary:
        `Input gate blocked: ${input.errorCode}.` +
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
    summary: 'Consent and minimum-information gates passed.',
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
        'Model-level confidence or conflict guard triggered abstain fallback.',
      matchedRuleIds: input.routing?.matchedRuleIds ?? [],
    };
  }

  return {
    layer: 'INTELLIGENT_COLLABORATION',
    status: 'pass',
    summary: `Routing decision=${input.routing?.routeMode ?? 'N/A'}.`,
    matchedRuleIds: input.routing?.matchedRuleIds ?? [],
  };
}

function buildOperationsDecision(): GovernanceLayerDecision {
  return {
    layer: 'OPERATIONS',
    status: 'pass',
    summary:
      'Runtime telemetry linked with release gates (gate:metrics / gate:all).',
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
        summary: 'No emergency boundary evaluated due intake failure.',
      },
      {
        layer: 'FLOW_CONTROL',
        status: 'fail',
        summary:
          `Validation blocked with ${input.errorCode}.` +
          (input.requiredFields?.length
            ? ` requiredFields=${input.requiredFields.join(',')}`
            : ''),
        matchedRuleIds: [RULE_IDS.FLOW_CONTROL_MINIMUM_INFOSET_GATE],
      },
      {
        layer: 'INTELLIGENT_COLLABORATION',
        status: 'blocked',
        summary: 'Routing/debate skipped due validation failure.',
      },
      {
        layer: 'OPERATIONS',
        status: 'pass',
        summary:
          'Validation outcome remains auditable and linked to release evidence gates.',
        matchedRuleIds: [RULE_IDS.OPERATIONS_GOVERNANCE_RELEASE_LINK],
      },
    ],
    evidenceTraceId: input.auditRef || `audit_${input.sessionId}`,
  };
}
