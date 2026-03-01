import {
  AUTHORITATIVE_GUIDELINE_REFERENCES,
  GOVERNANCE_RULE_LAYER_LABELS,
  evaluateEmergencySignalSnapshot,
  listLayeredRules,
} from '../../domain/rules/AuthoritativeMedicalRuleCatalog';

describe('Architecture Smoke - layered rule catalog', () => {
  it('provides Chinese labels for all governance layers', () => {
    expect(GOVERNANCE_RULE_LAYER_LABELS.BASIC_SAFETY).toBe('基础安全层');
    expect(GOVERNANCE_RULE_LAYER_LABELS.FLOW_CONTROL).toBe('流程控制层');
    expect(GOVERNANCE_RULE_LAYER_LABELS.INTELLIGENT_COLLABORATION).toBe(
      '智能协同层',
    );
    expect(GOVERNANCE_RULE_LAYER_LABELS.OPERATIONS).toBe('运维层');
  });

  it('exposes at least one descriptor for each layer', () => {
    expect(listLayeredRules('BASIC_SAFETY').length).toBeGreaterThan(0);
    expect(listLayeredRules('FLOW_CONTROL').length).toBeGreaterThan(0);
    expect(
      listLayeredRules('INTELLIGENT_COLLABORATION').length,
    ).toBeGreaterThan(0);
    expect(listLayeredRules('OPERATIONS').length).toBeGreaterThan(0);
  });

  it('tracks key guideline references for safety and chronic disease rules', () => {
    const ids = new Set(
      AUTHORITATIVE_GUIDELINE_REFERENCES.map((item) => item.id),
    );
    expect(ids.has('NICE_NG136_2026')).toBe(true);
    expect(ids.has('ACC_AHA_BP_2025')).toBe(true);
    expect(ids.has('ADA_DIAGNOSIS_2026')).toBe(true);
    expect(ids.has('CDC_STROKE_SIGNS_2025')).toBe(true);
    expect(ids.has('ENDO_HYPOGLYCEMIA_2023')).toBe(true);
  });

  it('evaluates severe hypertension without emergency symptom as same-day specialist review', () => {
    const snapshot = evaluateEmergencySignalSnapshot({
      patientId: 'layer-catalog-001',
      age: 60,
      sex: 'male',
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['amlodipine'],
      symptoms: ['mild dizziness'],
      vitals: {
        systolicBP: 182,
        diastolicBP: 122,
      },
    });

    expect(snapshot.immediateEmergency).toBe(false);
    expect(snapshot.urgentSameDaySpecialistReview).toBe(true);
    expect(snapshot.synonymSetVersion).toBeTruthy();
    expect(snapshot.matchedRuleIds.length).toBeGreaterThan(0);
  });
});
