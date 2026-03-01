import {
  decideRouting,
  evaluateComplexityScore,
} from '../../application/services/ComplexityRoutingPolicy';
import { PatientProfile } from '@copilot-care/shared/types';

describe('Architecture Smoke - complexity routing policy', () => {
  it('routes red-flag input to offline escalation with highest priority', () => {
    const profile: PatientProfile = {
      patientId: 'routing-policy-red-001',
      age: 66,
      sex: 'male',
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['none'],
      vitals: {
        systolicBP: 184,
        diastolicBP: 112,
      },
      symptoms: ['chest pain'],
    };

    const decision = decideRouting(profile);
    expect(decision.routeMode).toBe('ESCALATE_TO_OFFLINE');
    expect(decision.collaborationMode).toBe('OFFLINE_ESCALATION');
  });

  it('routes low complexity input into fast consensus flow', () => {
    const profile: PatientProfile = {
      patientId: 'routing-policy-fast-001',
      age: 50,
      sex: 'female',
      chiefComplaint: 'mild dizziness',
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['amlodipine'],
      vitals: {
        systolicBP: 142,
        diastolicBP: 90,
      },
      symptoms: ['dizziness'],
    };

    const decision = decideRouting(profile);
    expect(decision.routeMode).toBe('FAST_CONSENSUS');
    expect(['cardiology', 'generalPractice', 'metabolic']).toContain(
      decision.department,
    );
  });

  it('routes high complexity input into deep debate flow', () => {
    const profile: PatientProfile = {
      patientId: 'routing-policy-deep-001',
      age: 62,
      sex: 'female',
      chronicDiseases: ['Hypertension', 'Diabetes', 'Dyslipidemia'],
      medicationHistory: ['metformin'],
      symptoms: ['dizziness', 'fatigue', 'thirst'],
    };

    const complexity = evaluateComplexityScore(profile);
    const decision = decideRouting(profile);

    expect(complexity.score).toBeGreaterThanOrEqual(6);
    expect(complexity.factorContributions.length).toBeGreaterThan(0);
    expect(decision.routeMode).toBe('DEEP_DEBATE');
    expect(decision.department).toBe('multiDisciplinary');
    expect(decision.collaborationMode).toBe('MULTI_DISCIPLINARY_CONSULT');
    expect(decision.factorContributions?.length).toBeGreaterThan(0);
    expect(decision.matchedRuleIds.length).toBeGreaterThan(0);
  });

  it('forces at least light debate when minimum information set is incomplete', () => {
    const profile: PatientProfile = {
      patientId: 'routing-policy-mis-001',
      age: 47,
      sex: 'male',
      chiefComplaint: 'occasional dizziness',
      symptoms: ['dizziness'],
      chronicDiseases: ['Hypertension'],
      medicationHistory: [],
    };

    const decision = decideRouting(profile);
    expect(decision.routeMode).toBe('LIGHT_DEBATE');
    expect(
      decision.reasons.some((item) =>
        item.includes('Minimum information set is incomplete'),
      ),
    ).toBe(true);
    expect(
      decision.factorContributions?.some(
        (item) => item.factor === 'minimum_information_set',
      ),
    ).toBe(true);
  });

  it('uses general-practice panel when cardiology and metabolic signals are close', () => {
    const profile: PatientProfile = {
      patientId: 'routing-policy-gp-001',
      age: 59,
      sex: 'female',
      chiefComplaint: 'fatigue and mild palpitation',
      symptoms: ['fatigue', 'palpitation'],
      chronicDiseases: ['Prediabetes', 'Hypertension'],
      medicationHistory: ['none'],
      vitals: {
        systolicBP: 138,
        diastolicBP: 88,
      },
    };

    const decision = decideRouting(profile);
    expect(decision.department).toBe('generalPractice');
    expect(decision.collaborationMode).toBe('SINGLE_SPECIALTY_PANEL');
  });
});
