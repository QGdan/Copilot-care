import { TriageRequest } from '@copilot-care/shared/types';
import { postJson } from '../../../llm/http';
import { createPatientContextEnricher } from '../PatientContextEnricher';

jest.mock('../../../llm/http', () => ({
  postJson: jest.fn(),
}));

const postJsonMock = postJson as jest.MockedFunction<typeof postJson>;

function createBaseRequest(): TriageRequest {
  return {
    requestId: 'req-mcp-001',
    consentToken: 'consent_local_demo',
    symptomText: 'headache and dizziness',
    profile: {
      patientId: 'patient-001',
      age: 56,
      sex: 'male',
      chiefComplaint: 'headache and dizziness',
      symptoms: ['headache', 'dizziness'],
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['amlodipine'],
    },
    signals: [],
  };
}

describe('PatientContextEnricher', () => {
  beforeEach(() => {
    postJsonMock.mockReset();
  });

  it('keeps request demographics when MCP patch has conflicting age/sex', async () => {
    postJsonMock.mockResolvedValue({
      profilePatch: {
        age: 49,
        sex: 'female',
        chiefComplaint: 'cloud complaint',
        chronicDiseases: ['Diabetes'],
      },
      signals: [],
      insights: ['cloud insight'],
    });

    const enricher = createPatientContextEnricher({
      COPILOT_CARE_MCP_BASE_URL: 'http://127.0.0.1:3900/mcp',
    });
    const enriched = await enricher.enrich(createBaseRequest());

    expect(enriched.source).toBe('mcp');
    expect(enriched.profile.age).toBe(56);
    expect(enriched.profile.sex).toBe('male');
    expect(enriched.profile.chiefComplaint).toBe('cloud complaint');
    expect(enriched.profile.chronicDiseases).toEqual(
      expect.arrayContaining(['Hypertension', 'Diabetes']),
    );
    const conflictHints = enriched.insights.filter((item) => item.startsWith('MCP'));
    expect(conflictHints.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to local context when MCP request fails', async () => {
    postJsonMock.mockRejectedValue(new Error('network timeout'));

    const request = createBaseRequest();
    const enricher = createPatientContextEnricher({
      COPILOT_CARE_MCP_BASE_URL: 'http://127.0.0.1:3900/mcp',
    });
    const enriched = await enricher.enrich(request);

    expect(enriched.source).toBe('local');
    expect(enriched.profile).toEqual(request.profile);
    expect(enriched.signals).toEqual(request.signals);
    expect(enriched.insights).toEqual([]);
  });
});
