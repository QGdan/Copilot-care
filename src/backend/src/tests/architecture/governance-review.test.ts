import { DebateResult } from '@copilot-care/shared/types';
import { GovernanceReviewService } from '../../application/services/GovernanceReviewService';
import { RiskAssessmentSnapshot } from '../../application/services/RuleFirstRiskAssessmentService';

function createRisk(
  overrides: Partial<RiskAssessmentSnapshot> = {},
): RiskAssessmentSnapshot {
  return {
    riskLevel: 'L2',
    triageLevel: 'urgent',
    redFlagTriggered: false,
    evidence: ['rule evidence'],
    guidelineBasis: ['guideline basis'],
    matchedRuleIds: ['RULE-001'],
    ...overrides,
  };
}

function createResult(overrides: Partial<DebateResult> = {}): DebateResult {
  return {
    sessionId: 'governance-review-session',
    status: 'OUTPUT',
    rounds: [],
    dissentIndexHistory: [],
    notes: [],
    auditTrail: [],
    finalConsensus: {
      agentId: 'gp-agent',
      agentName: 'GP agent',
      role: 'Generalist',
      reasoning:
        'Detailed reasoning with enough context to pass the minimum reasoning length threshold.',
      citations: ['NICE-001', 'WHO-001'],
      confidence: 0.82,
      riskLevel: 'L1',
      actions: ['schedule follow-up'],
    },
    ...overrides,
  };
}

describe('Architecture Smoke - governance review service', () => {
  it('abstains when calibrated confidence falls below threshold', () => {
    const service = new GovernanceReviewService();

    const outcome = service.apply(
      createResult({
        finalConsensus: {
          ...createResult().finalConsensus!,
          confidence: 0.3,
          citations: [],
          reasoning: 'too short',
        },
      }),
      createRisk({ riskLevel: 'L1', triageLevel: 'routine' }),
    );

    expect(outcome.debateResult.status).toBe('ABSTAIN');
    expect(outcome.debateResult.errorCode).toBe('ERR_LOW_CONFIDENCE_ABSTAIN');
    expect(outcome.debateResult.finalConsensus).toBeUndefined();
    expect(outcome.notes.some((note) => note.includes('拒答'))).toBe(true);
  });

  it('forces rule risk level when baseline guard detects under-triage conflict', () => {
    const service = new GovernanceReviewService();

    const outcome = service.apply(
      createResult({
        finalConsensus: {
          ...createResult().finalConsensus!,
          confidence: 0.92,
          riskLevel: 'L0',
        },
      }),
      createRisk({ riskLevel: 'L3', triageLevel: 'emergency' }),
    );

    expect(outcome.debateResult.status).toBe('OUTPUT');
    expect(outcome.debateResult.finalConsensus?.riskLevel).toBe('L3');
    expect(
      outcome.notes.some((note) => note.includes('已强制执行规则基线')),
    ).toBe(true);
  });
});
