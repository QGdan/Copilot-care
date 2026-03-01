import { ErrorCode } from '@copilot-care/shared/types';
import {
  listErrPathMappings,
  listRiskTriggersByLayer,
  resolveRiskTriggerByErrorCode,
  RISK_TRIGGER_MATRIX,
} from '../../infrastructure/governance/riskTriggerMatrix';

const ALL_ERROR_CODES: ErrorCode[] = [
  'ERR_MISSING_REQUIRED_DATA',
  'ERR_INVALID_VITAL_SIGN',
  'ERR_LOW_CONFIDENCE_ABSTAIN',
  'ERR_CONFLICT_UNRESOLVED',
  'ERR_ESCALATE_TO_OFFLINE',
  'ERR_GUIDELINE_EVIDENCE_MISSING',
  'ERR_ADVERSARIAL_PROMPT_DETECTED',
];

describe('Architecture Smoke - risk trigger matrix automation', () => {
  it('maps every ERR_* code to a deterministic governance action', () => {
    for (const code of ALL_ERROR_CODES) {
      const resolved = resolveRiskTriggerByErrorCode(code);
      expect(resolved).toBeDefined();
      expect(resolved?.action).toBeTruthy();
      expect(resolved?.scope).toBe('runtime');
    }
  });

  it('provides documented ERR path mapping without duplicate error codes', () => {
    const mappings = listErrPathMappings();
    const codeSet = new Set(mappings.map((item) => item.errorCode));

    expect(codeSet.size).toBe(mappings.length);
    expect(codeSet.size).toBe(ALL_ERROR_CODES.length);
  });

  it('contains explicit release-block triggers for metrics and review evidence', () => {
    const releaseBlockRules = RISK_TRIGGER_MATRIX.filter(
      (rule) => rule.scope === 'release' && rule.releaseBlock,
    );
    const ids = new Set(releaseBlockRules.map((rule) => rule.id));

    expect(ids.has('RTM-008')).toBe(true);
    expect(ids.has('RTM-009')).toBe(true);
    expect(releaseBlockRules.every((rule) => typeof rule.gateCommand === 'string')).toBe(
      true,
    );
  });

  it('covers all four governance rule layers', () => {
    expect(listRiskTriggersByLayer('BASIC_SAFETY').length).toBeGreaterThan(0);
    expect(listRiskTriggersByLayer('FLOW_CONTROL').length).toBeGreaterThan(0);
    expect(
      listRiskTriggersByLayer('INTELLIGENT_COLLABORATION').length,
    ).toBeGreaterThan(0);
    expect(listRiskTriggersByLayer('OPERATIONS').length).toBeGreaterThan(0);
  });

  it('keeps release blocking rules in operations layer', () => {
    const releaseBlockRules = RISK_TRIGGER_MATRIX.filter(
      (rule) => rule.scope === 'release' && rule.releaseBlock,
    );
    expect(releaseBlockRules.every((rule) => rule.layer === 'OPERATIONS')).toBe(
      true,
    );
  });
});
