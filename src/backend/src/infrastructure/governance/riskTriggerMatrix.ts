import {
  ErrorCode,
  TriageStatus,
} from '@copilot-care/shared/types';
import { GovernanceRuleLayer } from '../../domain/rules/AuthoritativeMedicalRuleCatalog';

export type GovernanceSeverity = 'high' | 'critical';

export type GovernanceAction =
  | 'REQUEST_DATA_COMPLETION'
  | 'REJECT_INVALID_INPUT'
  | 'ABSTAIN_AND_OFFLINE_REVIEW'
  | 'ESCALATE_TO_OFFLINE_IMMEDIATELY'
  | 'BLOCK_OUTPUT_UNTIL_EVIDENCE'
  | 'SECURITY_BLOCK_AND_AUDIT'
  | 'BLOCK_RELEASE';

export interface RiskTriggerRule {
  id: string;
  title: string;
  layer: GovernanceRuleLayer;
  scope: 'runtime' | 'release';
  status?: TriageStatus;
  errorCode?: ErrorCode;
  action: GovernanceAction;
  severity: GovernanceSeverity;
  releaseBlock: boolean;
  owner: 'build' | 'reviewer';
  gateCommand?: string;
}

export const RISK_TRIGGER_MATRIX: readonly RiskTriggerRule[] = [
  {
    id: 'RTM-001',
    title: 'Required intake fields missing',
    layer: 'FLOW_CONTROL',
    scope: 'runtime',
    status: 'ERROR',
    errorCode: 'ERR_MISSING_REQUIRED_DATA',
    action: 'REQUEST_DATA_COMPLETION',
    severity: 'high',
    releaseBlock: false,
    owner: 'build',
  },
  {
    id: 'RTM-002',
    title: 'Invalid vital sign pair detected',
    layer: 'BASIC_SAFETY',
    scope: 'runtime',
    status: 'ERROR',
    errorCode: 'ERR_INVALID_VITAL_SIGN',
    action: 'REJECT_INVALID_INPUT',
    severity: 'high',
    releaseBlock: false,
    owner: 'build',
  },
  {
    id: 'RTM-003',
    title: 'Low confidence consensus candidate',
    layer: 'INTELLIGENT_COLLABORATION',
    scope: 'runtime',
    status: 'ABSTAIN',
    errorCode: 'ERR_LOW_CONFIDENCE_ABSTAIN',
    action: 'ABSTAIN_AND_OFFLINE_REVIEW',
    severity: 'high',
    releaseBlock: false,
    owner: 'build',
  },
  {
    id: 'RTM-004',
    title: 'Conflict remains unresolved',
    layer: 'INTELLIGENT_COLLABORATION',
    scope: 'runtime',
    status: 'ABSTAIN',
    errorCode: 'ERR_CONFLICT_UNRESOLVED',
    action: 'ABSTAIN_AND_OFFLINE_REVIEW',
    severity: 'high',
    releaseBlock: false,
    owner: 'build',
  },
  {
    id: 'RTM-005',
    title: 'Safety red-flag or severe disagreement',
    layer: 'BASIC_SAFETY',
    scope: 'runtime',
    status: 'ESCALATE_TO_OFFLINE',
    errorCode: 'ERR_ESCALATE_TO_OFFLINE',
    action: 'ESCALATE_TO_OFFLINE_IMMEDIATELY',
    severity: 'critical',
    releaseBlock: false,
    owner: 'build',
  },
  {
    id: 'RTM-006',
    title: 'Guideline evidence is missing',
    layer: 'FLOW_CONTROL',
    scope: 'runtime',
    status: 'ERROR',
    errorCode: 'ERR_GUIDELINE_EVIDENCE_MISSING',
    action: 'BLOCK_OUTPUT_UNTIL_EVIDENCE',
    severity: 'high',
    releaseBlock: true,
    owner: 'reviewer',
    gateCommand: 'npm run gate:workflow',
  },
  {
    id: 'RTM-007',
    title: 'Adversarial prompt or prompt-injection signal',
    layer: 'BASIC_SAFETY',
    scope: 'runtime',
    status: 'ERROR',
    errorCode: 'ERR_ADVERSARIAL_PROMPT_DETECTED',
    action: 'SECURITY_BLOCK_AND_AUDIT',
    severity: 'critical',
    releaseBlock: true,
    owner: 'reviewer',
    gateCommand: 'npm run gate:safety',
  },
  {
    id: 'RTM-008',
    title: 'M3 metric threshold breach',
    layer: 'OPERATIONS',
    scope: 'release',
    action: 'BLOCK_RELEASE',
    severity: 'critical',
    releaseBlock: true,
    owner: 'reviewer',
    gateCommand: 'npm run gate:metrics',
  },
  {
    id: 'RTM-009',
    title: 'Gate evidence missing in review package',
    layer: 'OPERATIONS',
    scope: 'release',
    action: 'BLOCK_RELEASE',
    severity: 'critical',
    releaseBlock: true,
    owner: 'reviewer',
    gateCommand: 'npm run gate:all',
  },
] as const;

export interface ErrPathMapping {
  errorCode: ErrorCode;
  triggerId: string;
  action: GovernanceAction;
  releaseBlock: boolean;
}

const runtimeErrRules = RISK_TRIGGER_MATRIX.filter(
  (rule) => rule.scope === 'runtime' && typeof rule.errorCode === 'string',
);

export function resolveRiskTriggerByErrorCode(
  errorCode: ErrorCode,
): RiskTriggerRule | undefined {
  return runtimeErrRules.find((rule) => rule.errorCode === errorCode);
}

export function resolveRiskTriggerByOutcome(
  status: TriageStatus,
  errorCode?: ErrorCode,
): RiskTriggerRule | undefined {
  if (errorCode) {
    const fromErrCode = resolveRiskTriggerByErrorCode(errorCode);
    if (fromErrCode) {
      return fromErrCode;
    }
  }

  return runtimeErrRules.find(
    (rule) => rule.status === status && rule.errorCode === undefined,
  );
}

export function listErrPathMappings(): ErrPathMapping[] {
  return runtimeErrRules
    .filter((rule): rule is RiskTriggerRule & { errorCode: ErrorCode } =>
      typeof rule.errorCode === 'string',
    )
    .map((rule) => ({
      errorCode: rule.errorCode,
      triggerId: rule.id,
      action: rule.action,
      releaseBlock: rule.releaseBlock,
    }));
}

export function listRiskTriggersByLayer(
  layer: GovernanceRuleLayer,
): RiskTriggerRule[] {
  return RISK_TRIGGER_MATRIX.filter((rule) => rule.layer === layer);
}
