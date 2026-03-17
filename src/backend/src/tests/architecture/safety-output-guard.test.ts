import {
  DebateResult,
  ExplainableReport,
  StructuredTriageResult,
  TriageRequest,
} from '@copilot-care/shared/types';
import { SafetyOutputGuardService } from '../../application/services/SafetyOutputGuardService';

function createBaseRequest(overrides?: Partial<TriageRequest>): TriageRequest {
  return {
    requestId: 'safety-guard-test',
    consentToken: 'consent_local_demo',
    symptomText: '轻度头晕',
    profile: {
      patientId: 'patient-safety-001',
      age: 48,
      sex: 'male',
      chiefComplaint: '轻度头晕',
      symptoms: ['头晕'],
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['amlodipine'],
      vitals: {
        systolicBP: 148,
        diastolicBP: 92,
      },
    },
    ...overrides,
  };
}

function createBaseDebateResult(overrides?: Partial<DebateResult>): DebateResult {
  return {
    sessionId: 'safety-session-001',
    status: 'OUTPUT',
    rounds: [],
    dissentIndexHistory: [],
    notes: [],
    auditTrail: [],
    finalConsensus: {
      agentId: 'agent-1',
      agentName: 'Test Agent',
      role: 'Generalist',
      riskLevel: 'L1',
      confidence: 0.86,
      reasoning: '建议继续观察，出现加重时复诊。',
      citations: ['GUIDE-1'],
      actions: ['3天后复诊'],
    },
    ...overrides,
  };
}

function createBaseTriageResult(
  overrides?: Partial<StructuredTriageResult>,
): StructuredTriageResult {
  return {
    patientId: 'patient-safety-001',
    triageLevel: 'routine',
    destination: '全科门诊',
    followupDays: 3,
    educationAdvice: ['继续监测血压变化'],
    ...overrides,
  };
}

function createBaseReport(overrides?: Partial<ExplainableReport>): ExplainableReport {
  return {
    conclusion: '建议常规门诊随访。',
    evidence: ['EVID-1'],
    basis: ['BASIS-1'],
    actions: ['保持低盐饮食', '按时复诊'],
    ...overrides,
  };
}

describe('Architecture Smoke - safety output guard', () => {
  it('passes safe output without blocking', () => {
    const guard = new SafetyOutputGuardService();

    const outcome = guard.review({
      request: createBaseRequest(),
      debateResult: createBaseDebateResult(),
      triageResult: createBaseTriageResult(),
      explainableReport: createBaseReport(),
    });

    expect(outcome.blocked).toBe(false);
    expect(outcome.status).toBe('OUTPUT');
    expect(outcome.errorCode).toBeUndefined();
    expect(outcome.finalConsensus).toBeDefined();
    expect(outcome.reviewDetail).toBe('安全复核通过');
  });

  it('blocks request containing self-harm risk signals', () => {
    const guard = new SafetyOutputGuardService();

    const outcome = guard.review({
      request: createBaseRequest({
        symptomText: 'I want to kill myself tonight',
      }),
      debateResult: createBaseDebateResult(),
      triageResult: createBaseTriageResult(),
      explainableReport: createBaseReport(),
    });

    expect(outcome.blocked).toBe(true);
    expect(outcome.status).toBe('ESCALATE_TO_OFFLINE');
    expect(outcome.errorCode).toBe('ERR_ESCALATE_TO_OFFLINE');
    expect(outcome.triageResult.triageLevel).toBe('emergency');
    expect(outcome.finalConsensus).toBeUndefined();
    expect(outcome.explainableReport.conclusion).toContain('安全审校触发');
  });

  it('blocks unsafe medication directives in generated output', () => {
    const guard = new SafetyOutputGuardService();

    const outcome = guard.review({
      request: createBaseRequest(),
      debateResult: createBaseDebateResult(),
      triageResult: createBaseTriageResult(),
      explainableReport: createBaseReport({
        actions: ['请立即自行服用抗生素，每日两次'],
      }),
    });

    expect(outcome.blocked).toBe(true);
    expect(outcome.status).toBe('ESCALATE_TO_OFFLINE');
    expect(outcome.errorCode).toBe('ERR_ADVERSARIAL_PROMPT_DETECTED');
    expect(outcome.finalConsensus).toBeUndefined();
    expect(outcome.explainableReport.actions.length).toBeGreaterThan(0);
    expect(outcome.explainableReport.actions[0]).toContain('线下急诊');
  });

  it('supports configurable safety term extension', () => {
    const guard = new SafetyOutputGuardService({
      unsafeDirectiveTerms: ['院外静推药物'],
    });

    const outcome = guard.review({
      request: createBaseRequest(),
      debateResult: createBaseDebateResult(),
      triageResult: createBaseTriageResult(),
      explainableReport: createBaseReport({
        actions: ['建议院外静推药物处理后观察'],
      }),
    });

    expect(outcome.blocked).toBe(true);
    expect(outcome.errorCode).toBe('ERR_ADVERSARIAL_PROMPT_DETECTED');
  });

  it('does not block prohibition-style medication safety reminders', () => {
    const guard = new SafetyOutputGuardService();

    const outcome = guard.review({
      request: createBaseRequest(),
      debateResult: createBaseDebateResult(),
      triageResult: createBaseTriageResult(),
      explainableReport: createBaseReport({
        actions: ['禁止自行加减药或停药，请在线下医生指导下调整方案。'],
      }),
    });

    expect(outcome.blocked).toBe(false);
    expect(outcome.status).toBe('OUTPUT');
    expect(outcome.errorCode).toBeUndefined();
  });

  it('does not block clinician-supervised dose guidance in English', () => {
    const guard = new SafetyOutputGuardService();

    const outcome = guard.review({
      request: createBaseRequest(),
      debateResult: createBaseDebateResult(),
      triageResult: createBaseTriageResult(),
      explainableReport: createBaseReport({
        actions: [
          'Do not stop medication on your own; adjust dose only under doctor supervision.',
        ],
      }),
    });

    expect(outcome.blocked).toBe(false);
    expect(outcome.status).toBe('OUTPUT');
    expect(outcome.errorCode).toBeUndefined();
  });

  it('blocks output when patient identity is inconsistent', () => {
    const guard = new SafetyOutputGuardService();

    const outcome = guard.review({
      request: createBaseRequest({
        profile: {
          ...createBaseRequest().profile,
          patientId: 'patient-a',
        },
      }),
      debateResult: createBaseDebateResult(),
      triageResult: createBaseTriageResult({
        patientId: 'patient-b',
      }),
      explainableReport: createBaseReport(),
    });

    expect(outcome.blocked).toBe(true);
    expect(outcome.status).toBe('ERROR');
    expect(outcome.errorCode).toBe('ERR_CONFLICT_UNRESOLVED');
    expect(outcome.blockingReason?.code).toBe('RUNTIME_FAILURE_BLOCKED');
    expect(outcome.finalConsensus).toBeUndefined();
    expect(outcome.explainableReport.conclusion).toContain('安全审校触发');
  });
});
