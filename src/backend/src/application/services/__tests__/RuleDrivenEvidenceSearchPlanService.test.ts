import { TriageRequest } from '@copilot-care/shared/types';
import { RuleDrivenEvidenceSearchPlanService } from '../RuleDrivenEvidenceSearchPlanService';
import { RULE_IDS } from '../../../domain/rules/AuthoritativeMedicalRuleCatalog';
import { RiskAssessmentSnapshot } from '../RuleFirstRiskAssessmentService';

function createRequest(overrides?: Partial<TriageRequest>): TriageRequest {
  return {
    consentToken: 'consent_local_demo',
    symptomText: 'dizziness',
    profile: {
      patientId: 'rule-plan-test-001',
      age: 56,
      sex: 'male',
      chiefComplaint: 'dizziness',
      symptoms: ['dizziness'],
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['amlodipine'],
      vitals: {
        systolicBP: 160,
        diastolicBP: 102,
      },
    },
    ...overrides,
  };
}

function createRisk(overrides?: Partial<RiskAssessmentSnapshot>): RiskAssessmentSnapshot {
  return {
    riskLevel: 'L2',
    triageLevel: 'urgent',
    redFlagTriggered: false,
    evidence: ['Stage-2 hypertension range detected.'],
    guidelineBasis: ['NICE_NG136_2026'],
    matchedRuleIds: [RULE_IDS.FLOW_CONTROL_STAGE2_HTN],
    ...overrides,
  };
}

describe('RuleDrivenEvidenceSearchPlanService', () => {
  it('builds hypertension-focused strategy for stage-2 risk rules', () => {
    const service = new RuleDrivenEvidenceSearchPlanService();
    const plan = service.build({
      request: createRequest(),
      risk: createRisk(),
    });

    expect(plan.query).toContain('hypertension guideline');
    expect(plan.requiredSources).toEqual(['WHO']);
    expect(plan.sourceFilter).toEqual(
      expect.arrayContaining(['WHO', 'NICE', 'CDC_US', 'PUBMED']),
    );
    expect(plan.minEvidenceCount).toBe(2);
    expect(plan.limit).toBeGreaterThanOrEqual(5);
    expect(plan.decomposedNeeds.length).toBeGreaterThanOrEqual(3);
    expect(plan.professionalRestatement).toContain('临床检索任务重述');
    expect(plan.queryVariants.length).toBeGreaterThan(1);
    expect(plan.queryVariants[0]).toContain('hypertension guideline');
    expect(plan.activatedSkills).toEqual(
      expect.arrayContaining([
        'need_decomposition',
        'professional_restatement',
        'query_rewrite',
        'hybrid_retrieval_fusion',
      ]),
    );
  });

  it('requires NICE for severe hypertension risk', () => {
    const service = new RuleDrivenEvidenceSearchPlanService();
    const plan = service.build({
      request: createRequest(),
      risk: createRisk({
        riskLevel: 'L3',
        matchedRuleIds: [RULE_IDS.FLOW_CONTROL_SEVERE_HTN_SAME_DAY],
      }),
    });

    expect(plan.requiredSources).toEqual(
      expect.arrayContaining(['WHO', 'NICE']),
    );
  });

  it('builds glucose strategy and requires CDC evidence when glucose rule is matched', () => {
    const service = new RuleDrivenEvidenceSearchPlanService();
    const plan = service.build({
      request: createRequest({
        symptomText: 'thirst polyuria weight loss',
        profile: {
          ...createRequest().profile,
          symptoms: ['thirst', 'polyuria', 'weight loss'],
        },
      }),
      risk: createRisk({
        matchedRuleIds: [RULE_IDS.FLOW_CONTROL_RANDOM_GLUCOSE_CLASSIC],
      }),
    });

    expect(plan.query).toContain('diabetes');
    expect(plan.requiredSources).toEqual(
      expect.arrayContaining(['WHO', 'CDC_US']),
    );
    expect(plan.strategyNotes.join(' ')).toContain('血糖');
    expect(plan.decomposedNeeds.join(' ')).toContain('血糖');
    expect(plan.queryVariants.some((item) => /diabetes|糖尿病/i.test(item))).toBe(true);
  });

  it('adds cardiac-focused variants and avoids blood-pressure threshold variants when vitals are normal', () => {
    const service = new RuleDrivenEvidenceSearchPlanService();
    const plan = service.build({
      request: createRequest({
        symptomText: '活动后心悸、气短2周',
        profile: {
          ...createRequest().profile,
          chiefComplaint: '活动后心悸、气短2周',
          symptoms: ['心悸', '气短'],
          chronicDiseases: ['Heart Disease', '心力衰竭，未特指'],
          vitals: {
            systolicBP: 125,
            diastolicBP: 80,
          },
        },
      }),
      risk: createRisk({
        matchedRuleIds: [],
        riskLevel: 'L1',
        triageLevel: 'urgent',
      }),
    });

    expect(plan.queryVariants.some((item) => /心悸|气短|heart failure|cardiac/i.test(item))).toBe(true);
    expect(plan.queryVariants.some((item) => /blood pressure 125\/80/i.test(item))).toBe(false);
    expect(plan.activatedSkills).toContain('cardiac_risk_focus');
    expect(plan.decomposedNeeds.join(' ')).toContain('心悸/气短/胸痛');
  });

  it('does not enforce high evidence count for low-risk generic scenarios', () => {
    const service = new RuleDrivenEvidenceSearchPlanService();
    const plan = service.build({
      request: createRequest({
        symptomText: 'mild fatigue',
        profile: {
          ...createRequest().profile,
          symptoms: ['fatigue'],
          chronicDiseases: [],
          vitals: {
            systolicBP: 126,
            diastolicBP: 82,
          },
        },
      }),
      risk: createRisk({
        riskLevel: 'L0',
        triageLevel: 'followup',
        matchedRuleIds: [],
      }),
    });

    expect(plan.minEvidenceCount).toBe(1);
    expect(plan.limit).toBe(3);
    expect(plan.requiredSources).toEqual(['WHO']);
    expect(plan.queryVariants.length).toBeGreaterThanOrEqual(2);
    expect(plan.professionalRestatement).toContain('随访');
  });
});
