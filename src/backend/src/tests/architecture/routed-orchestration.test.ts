import { createRuntime } from '../../bootstrap/createRuntime';

describe('Architecture Smoke - routed orchestration flow', () => {
  it('returns routing metadata and state-machine trace for normal output', async () => {
    const runtime = createRuntime();
    const result = await runtime.triageUseCase.execute({
      profile: {
        patientId: 'routed-flow-normal-001',
        age: 54,
        sex: 'male',
        chiefComplaint: 'mild dizziness',
        symptoms: ['dizziness'],
        chronicDiseases: ['Hypertension'],
        medicationHistory: ['amlodipine'],
        vitals: {
          systolicBP: 146,
          diastolicBP: 92,
        },
      },
      symptomText: 'mild dizziness',
      signals: [
        {
          timestamp: '2026-02-21T09:00:00Z',
          source: 'manual',
          systolicBP: 146,
          diastolicBP: 92,
        },
      ],
      consentToken: 'consent_local_demo',
    });

    expect(result.routing).toBeDefined();
    expect(result.routing?.routeMode).toBe('FAST_CONSENSUS');
    expect(result.routing?.collaborationMode).toBe('SINGLE_SPECIALTY_PANEL');
    expect(result.workflowTrace?.some((stage) => stage.stage === 'ROUTING')).toBe(true);
    expect(result.workflowTrace?.some((stage) => stage.stage === 'REVIEW')).toBe(true);
    expect(result.triageResult).toBeDefined();
    expect(result.explainableReport).toBeDefined();
  });

  it('routes complex input to multidisciplinary deep debate', async () => {
    const runtime = createRuntime();
    const result = await runtime.triageUseCase.execute({
      profile: {
        patientId: 'routed-flow-deep-001',
        age: 71,
        sex: 'female',
        symptoms: ['dizziness', 'fatigue', 'thirst'],
        chronicDiseases: ['Hypertension', 'Diabetes', 'Dyslipidemia'],
        medicationHistory: ['metformin'],
        vitals: {
          systolicBP: 166,
          diastolicBP: 101,
        },
      },
      symptomText: 'dizziness, fatigue, thirst',
      signals: [
        {
          timestamp: '2026-02-21T10:00:00Z',
          source: 'manual',
          systolicBP: 166,
          diastolicBP: 101,
        },
      ],
      consentToken: 'consent_local_demo',
    });

    expect(result.routing).toBeDefined();
    expect(result.routing?.routeMode).toBe('DEEP_DEBATE');
    expect(result.routing?.department).toBe('multiDisciplinary');
    expect(result.routing?.collaborationMode).toBe('MULTI_DISCIPLINARY_CONSULT');
    expect(result.workflowTrace?.some((stage) => stage.stage === 'DEBATE')).toBe(true);
    expect(result.workflowTrace?.some((stage) => stage.stage === 'REVIEW')).toBe(true);
  });

  it('keeps review stage explicit on red-flag escalation path', async () => {
    const runtime = createRuntime();
    const result = await runtime.triageUseCase.execute({
      profile: {
        patientId: 'routed-flow-escalation-001',
        age: 67,
        sex: 'male',
        chiefComplaint: 'chest pain and shortness of breath',
        symptoms: ['chest pain', 'shortness of breath'],
        chronicDiseases: ['Hypertension'],
        medicationHistory: ['amlodipine'],
        vitals: {
          systolicBP: 182,
          diastolicBP: 112,
        },
      },
      symptomText: 'chest pain and shortness of breath',
      consentToken: 'consent_local_demo',
    });

    expect(result.status).toBe('ESCALATE_TO_OFFLINE');
    const reviewStage = result.workflowTrace?.find((stage) => stage.stage === 'REVIEW');
    expect(reviewStage).toBeDefined();
    expect(reviewStage?.status).toBe('skipped');
  });

  it(
    'blocks preset fallback output when strict diagnosis mode is enabled',
    async () => {
      const runtime = createRuntime({
        ...process.env,
        NODE_ENV: 'development',
        COPILOT_CARE_STRICT_DIAGNOSIS_MODE: 'true',
        COPILOT_CARE_MED_SEARCH_ENABLED: 'false',
        COPILOT_CARE_MED_SEARCH_IN_TRIAGE: 'false',
        COPILOT_CARE_CARDIO_PROVIDER: 'none',
        COPILOT_CARE_GP_PROVIDER: 'none',
        COPILOT_CARE_METABOLIC_PROVIDER: 'none',
        COPILOT_CARE_SAFETY_PROVIDER: 'none',
      });
      const result = await runtime.triageUseCase.execute({
        profile: {
          patientId: 'routed-flow-strict-001',
          age: 52,
          sex: 'male',
          chiefComplaint: 'mild dizziness',
          symptoms: ['dizziness'],
          chronicDiseases: ['Hypertension'],
          medicationHistory: ['amlodipine'],
          vitals: {
            systolicBP: 146,
            diastolicBP: 92,
          },
        },
        symptomText: 'mild dizziness',
        consentToken: 'consent_local_demo',
      });

      expect(result.status).toBe('ABSTAIN');
      expect(result.errorCode).toBe('ERR_LOW_CONFIDENCE_ABSTAIN');
      expect(result.blockingReason?.code).toBe('RUNTIME_FAILURE_BLOCKED');
      expect(
        result.notes.some((note) => note.includes('可信诊断门禁触发')),
      ).toBe(true);
    },
    15000,
  );

  it('emits authoritative medical search reasoning in triage stream hooks', async () => {
    const originalInTriage = process.env.COPILOT_CARE_MED_SEARCH_IN_TRIAGE;
    const originalEnabled = process.env.COPILOT_CARE_MED_SEARCH_ENABLED;
    process.env.COPILOT_CARE_MED_SEARCH_IN_TRIAGE = 'true';
    process.env.COPILOT_CARE_MED_SEARCH_ENABLED = 'true';

    try {
      const runtime = createRuntime();
      const reasoningSteps: string[] = [];
      await runtime.triageUseCase.execute(
        {
          profile: {
            patientId: 'routed-flow-med-search-001',
            age: 56,
            sex: 'male',
            chiefComplaint: 'mild dizziness',
            symptoms: ['dizziness'],
            chronicDiseases: ['Hypertension'],
            medicationHistory: ['amlodipine'],
            vitals: {
              systolicBP: 148,
              diastolicBP: 94,
            },
          },
          symptomText: 'mild dizziness',
          consentToken: 'consent_local_demo',
        },
        {
          onReasoningStep: (message) => {
            reasoningSteps.push(message);
          },
        },
      );

      expect(
        reasoningSteps.some((item) =>
          item.includes('已启动权威医学联网检索'),
        ),
      ).toBe(true);
      expect(
        reasoningSteps.some((item) => item.includes('权威检索命中')),
      ).toBe(true);
      expect(
        reasoningSteps.some((item) =>
          item.includes('权威证据1'),
        ),
      ).toBe(true);
    } finally {
      if (originalInTriage === undefined) {
        delete process.env.COPILOT_CARE_MED_SEARCH_IN_TRIAGE;
      } else {
        process.env.COPILOT_CARE_MED_SEARCH_IN_TRIAGE = originalInTriage;
      }
      if (originalEnabled === undefined) {
        delete process.env.COPILOT_CARE_MED_SEARCH_ENABLED;
      } else {
        process.env.COPILOT_CARE_MED_SEARCH_ENABLED = originalEnabled;
      }
    }
  });

  it('defaults triage injection to enabled when medical search is enabled', async () => {
    const originalInTriage = process.env.COPILOT_CARE_MED_SEARCH_IN_TRIAGE;
    const originalEnabled = process.env.COPILOT_CARE_MED_SEARCH_ENABLED;
    delete process.env.COPILOT_CARE_MED_SEARCH_IN_TRIAGE;
    process.env.COPILOT_CARE_MED_SEARCH_ENABLED = 'true';

    try {
      const runtime = createRuntime();
      const reasoningSteps: string[] = [];
      await runtime.triageUseCase.execute(
        {
          profile: {
            patientId: 'routed-flow-med-search-default-001',
            age: 57,
            sex: 'female',
            chiefComplaint: 'mild dizziness',
            symptoms: ['dizziness'],
            chronicDiseases: ['Hypertension'],
            medicationHistory: ['amlodipine'],
            vitals: {
              systolicBP: 147,
              diastolicBP: 93,
            },
          },
          symptomText: 'mild dizziness',
          consentToken: 'consent_local_demo',
        },
        {
          onReasoningStep: (message) => {
            reasoningSteps.push(message);
          },
        },
      );

      expect(
        reasoningSteps.some((item) =>
          item.includes('已启动权威医学联网检索'),
        ),
      ).toBe(true);
      expect(
        reasoningSteps.some((item) =>
          item.includes('权威医学联网检索未启用'),
        ),
      ).toBe(false);
    } finally {
      if (originalInTriage === undefined) {
        delete process.env.COPILOT_CARE_MED_SEARCH_IN_TRIAGE;
      } else {
        process.env.COPILOT_CARE_MED_SEARCH_IN_TRIAGE = originalInTriage;
      }
      if (originalEnabled === undefined) {
        delete process.env.COPILOT_CARE_MED_SEARCH_ENABLED;
      } else {
        process.env.COPILOT_CARE_MED_SEARCH_ENABLED = originalEnabled;
      }
    }
  });
});
