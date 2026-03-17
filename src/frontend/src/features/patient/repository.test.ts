import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPatientDashboardRepository } from './repository';
import { fhirApi, mcpApi, patientApi } from '../../services/api';

vi.mock('../../services/api', () => ({
  mcpApi: {
    getPatient: vi.fn(),
    getPatientInsights: vi.fn(),
  },
  fhirApi: {
    getObservations: vi.fn(),
  },
  patientApi: {
    getCases: vi.fn(),
  },
}));

describe('patient repository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns mock snapshot when source is mock', async () => {
    const repository = createPatientDashboardRepository('mock');

    const record = await repository.fetchPatientRecord('patient-mock');

    expect(record.patient.patientId).toBe('patient-mock');
    expect(record.insights.length).toBeGreaterThan(0);
    expect(record.fallbackVitals.length).toBeGreaterThan(0);
    expect(record.consultationHistory.length).toBeGreaterThan(0);
    expect(record.observationBundle).toBeNull();
  });

  it('returns api payload when source is api', async () => {
    vi.mocked(mcpApi.getPatient).mockResolvedValue({
      patientId: 'patient-api',
      name: 'Patient API',
      sex: 'male',
    });
    vi.mocked(mcpApi.getPatientInsights).mockResolvedValue({
      patientId: 'patient-api',
      insights: ['Stable profile'],
      generatedAt: new Date().toISOString(),
    });
    vi.mocked(fhirApi.getObservations).mockResolvedValue({
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [
        {
          resource: {
            resourceType: 'Observation',
            id: 'obs-1',
            status: 'final',
            code: { text: 'Systolic blood pressure' },
            valueQuantity: { value: 132 },
            effectiveDateTime: new Date().toISOString(),
          },
        },
      ],
    });
    vi.mocked(patientApi.getCases).mockResolvedValue({
      generatedAt: new Date().toISOString(),
      patientId: 'patient-api',
      total: 1,
      returned: 1,
      cases: [
        {
          caseId: 'case-api-1',
          patientId: 'patient-api',
          status: 'OUTPUT',
          summary: 'Follow-up in one week.',
          department: 'Cardiology',
          triageLevel: 'urgent',
          startedAt: '2026-02-01T08:00:00.000Z',
          updatedAt: '2026-02-01T08:10:00.000Z',
          source: 'merged',
        },
      ],
    });

    const repository = createPatientDashboardRepository('api');
    const record = await repository.fetchPatientRecord('patient-api');

    expect(record.patient.patientId).toBe('patient-api');
    expect(record.insights).toEqual(['Stable profile']);
    expect(record.observationBundle?.entry?.length).toBe(1);
    expect(record.consultationHistory).toHaveLength(1);
    expect(record.consultationHistory[0].id).toBe('case-api-1');
    expect(record.consultationHistory[0].triageLevel).toBe('high');
  });

  it('falls back to mock data in hybrid mode when api calls fail', async () => {
    vi.mocked(mcpApi.getPatient).mockRejectedValue(new Error('network'));
    vi.mocked(mcpApi.getPatientInsights).mockResolvedValue({
      patientId: 'patient-hybrid',
      insights: [],
      generatedAt: new Date().toISOString(),
    });
    vi.mocked(fhirApi.getObservations).mockRejectedValue(new Error('timeout'));
    vi.mocked(patientApi.getCases).mockRejectedValue(new Error('unavailable'));

    const repository = createPatientDashboardRepository('hybrid');
    const record = await repository.fetchPatientRecord('patient-hybrid');

    expect(record.patient.patientId).toBe('patient-hybrid');
    expect(record.insights.length).toBeGreaterThan(0);
    expect(record.observationBundle).toBeNull();
    expect(record.fallbackVitals.length).toBeGreaterThan(0);
    expect(record.consultationHistory.length).toBeGreaterThan(0);
  });
});
