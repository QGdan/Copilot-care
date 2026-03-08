import { PatientProfile } from '@copilot-care/shared/types';
import { RuleFirstRiskAssessmentService } from '../../application/services/RuleFirstRiskAssessmentService';
import { RequestValidationError } from '../../application/errors/RequestValidationError';

function createProfile(overrides?: Partial<PatientProfile>): PatientProfile {
  return {
    patientId: 'risk-rule-test-001',
    age: 56,
    sex: 'male',
    chiefComplaint: 'mild dizziness',
    symptoms: ['mild dizziness'],
    chronicDiseases: ['Hypertension'],
    medicationHistory: ['amlodipine'],
    vitals: {
      systolicBP: 142,
      diastolicBP: 92,
    },
    ...overrides,
  };
}

describe('Architecture Smoke - rule-first risk assessment', () => {
  it('routes severe hypertension without immediate emergency symptoms to L2 urgent', () => {
    const service = new RuleFirstRiskAssessmentService();
    const snapshot = service.evaluate(
      createProfile({
        vitals: {
          systolicBP: 170,
          diastolicBP: 121,
        },
      }),
    );

    expect(snapshot.riskLevel).toBe('L2');
    expect(snapshot.triageLevel).toBe('urgent');
    expect(snapshot.redFlagTriggered).toBe(false);
    expect(
      snapshot.evidence.some((line) => line.includes('same-day specialist review')),
    ).toBe(true);
    expect(snapshot.matchedRuleIds.length).toBeGreaterThan(0);
  });

  it('triggers L3 emergency when severe hypertension coexists with life-threatening symptoms', () => {
    const service = new RuleFirstRiskAssessmentService();
    const snapshot = service.evaluate(
      createProfile({
        symptoms: ['chest pain', 'shortness of breath'],
        vitals: {
          systolicBP: 186,
          diastolicBP: 124,
        },
      }),
    );

    expect(snapshot.riskLevel).toBe('L3');
    expect(snapshot.triageLevel).toBe('emergency');
    expect(snapshot.redFlagTriggered).toBe(true);
    expect(
      snapshot.evidence.some((line) => line.includes('Life-threatening')),
    ).toBe(true);
    expect(
      snapshot.matchedRuleIds.some((ruleId) => ruleId.startsWith('RULE-BS-')),
    ).toBe(true);
  });

  it('raises to L2 when ACC/AHA stage-1 pressure coexists with high-risk comorbidity', () => {
    const service = new RuleFirstRiskAssessmentService();
    const snapshot = service.evaluate(
      createProfile({
        chronicDiseases: ['Prediabetes'],
        vitals: {
          systolicBP: 132,
          diastolicBP: 84,
        },
      }),
    );

    expect(snapshot.riskLevel).toBe('L2');
    expect(snapshot.triageLevel).toBe('urgent');
    expect(
      snapshot.matchedRuleIds.some(
        (ruleId) => ruleId === 'RULE-FC-STAGE1-HTN-HIGH-RISK',
      ),
    ).toBe(true);
  });

  it('raises to L2 when random glucose diagnostic signal and classic symptoms coexist', () => {
    const service = new RuleFirstRiskAssessmentService();
    const snapshot = service.evaluate(
      createProfile({
        symptoms: ['thirst', 'polyuria'],
        vitals: {
          systolicBP: 128,
          diastolicBP: 78,
          bloodGlucose: 232,
        },
      }),
    );

    expect(snapshot.riskLevel).toBe('L2');
    expect(
      snapshot.evidence.some((line) => line.includes('Random glucose')),
    ).toBe(true);
  });

  it('triggers L3 emergency for level-2 hypoglycemia signal', () => {
    const service = new RuleFirstRiskAssessmentService();
    const snapshot = service.evaluate(
      createProfile({
        symptoms: ['fatigue'],
        vitals: {
          systolicBP: 128,
          diastolicBP: 82,
          bloodGlucose: 48,
        },
      }),
    );

    expect(snapshot.riskLevel).toBe('L3');
    expect(snapshot.triageLevel).toBe('emergency');
    expect(
      snapshot.evidence.some((line) => line.includes('Level-2 hypoglycemia')),
    ).toBe(true);
  });

  it('matches Chinese red-flag symptom synonym and triggers emergency path', () => {
    const service = new RuleFirstRiskAssessmentService();
    const snapshot = service.evaluate(
      createProfile({
        chiefComplaint: '胸痛伴呼吸困难',
        symptoms: ['胸痛', '呼吸困难'],
        vitals: {
          systolicBP: 168,
          diastolicBP: 104,
        },
      }),
    );

    expect(snapshot.riskLevel).toBe('L3');
    expect(snapshot.redFlagTriggered).toBe(true);
    expect(
      snapshot.matchedRuleIds.some(
        (ruleId) => ruleId === 'RULE-BS-EMERGENCY-SYMPTOM',
      ),
    ).toBe(true);
  });

  it('matches UTF-8 Chinese red-flag symptom input and triggers emergency path', () => {
    const service = new RuleFirstRiskAssessmentService();
    const snapshot = service.evaluate(
      createProfile({
        chiefComplaint: '\u80f8\u75db\u4f34\u547c\u5438\u56f0\u96be',
        symptoms: ['\u80f8\u75db', '\u547c\u5438\u56f0\u96be'],
        vitals: {
          systolicBP: 168,
          diastolicBP: 104,
        },
      }),
    );

    expect(snapshot.riskLevel).toBe('L3');
    expect(snapshot.redFlagTriggered).toBe(true);
    expect(
      snapshot.matchedRuleIds.some(
        (ruleId) => ruleId === 'RULE-BS-EMERGENCY-SYMPTOM',
      ),
    ).toBe(true);
  });

  it('does not trigger emergency when chest pain and dyspnea are explicitly negated', () => {
    const service = new RuleFirstRiskAssessmentService();
    const snapshot = service.evaluate(
      createProfile({
        chiefComplaint:
          '\u65e0\u80f8\u75db\u65e0\u547c\u5438\u56f0\u96be\uff0c\u8f7b\u5ea6\u75b2\u52b3',
        symptoms: ['\u75b2\u52b3'],
        vitals: {
          systolicBP: 118,
          diastolicBP: 76,
        },
      }),
    );

    expect(snapshot.redFlagTriggered).toBe(false);
    expect(snapshot.riskLevel).not.toBe('L3');
  });

  it('throws typed error for invalid blood pressure pairing', () => {
    const service = new RuleFirstRiskAssessmentService();

    expect(() =>
      service.evaluate(
        createProfile({
          vitals: {
            systolicBP: 88,
            diastolicBP: 96,
          },
        }),
      ),
    ).toThrow(RequestValidationError);
  });
});
