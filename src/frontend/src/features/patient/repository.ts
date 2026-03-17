import {
  fhirApi,
  mcpApi,
  patientApi,
  type FHIRBundle,
  type FHIRObservation,
  type MCPPatientResponse,
  type PatientCaseRecord,
} from '../../services/api';
import {
  createMockConsultationHistory,
  createMockInsights,
  createMockPatient,
  createMockVitals,
} from './mock';
import type {
  ConsultationRecord,
  ConsultationStatus,
  PatientVitalsRecord,
} from './model';

export type PatientDataSource = 'mock' | 'api' | 'hybrid';

export interface PatientRepositoryRecord {
  patient: MCPPatientResponse;
  insights: string[];
  observationBundle: FHIRBundle<FHIRObservation> | null;
  fallbackVitals: PatientVitalsRecord[];
  consultationHistory: ConsultationRecord[];
}

export interface PatientDashboardRepository {
  fetchPatientRecord(patientId: string): Promise<PatientRepositoryRecord>;
}

function resolvePatientDataSource(): PatientDataSource {
  const raw = import.meta.env.VITE_PATIENT_DATA_SOURCE;

  if (raw === 'mock' || raw === 'api' || raw === 'hybrid') {
    return raw;
  }

  return 'hybrid';
}

function createMockRecord(patientId: string): PatientRepositoryRecord {
  const resolvedPatientId = patientId || 'demo-001';

  return {
    patient: createMockPatient(resolvedPatientId),
    insights: createMockInsights(),
    observationBundle: null,
    fallbackVitals: createMockVitals(),
    consultationHistory: createMockConsultationHistory(),
  };
}

function normalizeConsultationStatus(
  status: PatientCaseRecord['status'],
): ConsultationStatus {
  if (
    status === 'OUTPUT'
    || status === 'ESCALATE_TO_OFFLINE'
    || status === 'ABSTAIN'
    || status === 'ERROR'
  ) {
    return status;
  }
  return 'ERROR';
}

function normalizeTriageLevel(
  triageLevel: string | undefined,
): ConsultationRecord['triageLevel'] {
  const normalized = (triageLevel ?? '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'followup') {
    return 'low';
  }
  if (normalized === 'medium' || normalized === 'routine') {
    return 'medium';
  }
  if (normalized === 'high' || normalized === 'urgent') {
    return 'high';
  }
  if (normalized === 'critical' || normalized === 'emergency') {
    return 'critical';
  }
  return undefined;
}

function mapPatientCasesToHistory(
  cases: PatientCaseRecord[],
): ConsultationRecord[] {
  return cases
    .map((item) => {
      const date = item.endedAt ?? item.updatedAt ?? item.startedAt;
      return {
        id: item.caseId,
        date,
        conclusion: item.summary || 'No consultation summary available.',
        department: item.department || item.destination || 'General Clinic',
        status: normalizeConsultationStatus(item.status),
        triageLevel: normalizeTriageLevel(item.triageLevel),
      };
    })
    .sort((left, right) => {
      return new Date(right.date).getTime() - new Date(left.date).getTime();
    });
}

async function createApiRecord(patientId: string): Promise<PatientRepositoryRecord> {
  const [patient, insights, observationBundle, patientCases] = await Promise.all([
    mcpApi.getPatient(patientId),
    mcpApi.getPatientInsights(patientId),
    fhirApi.getObservations({ patient: patientId }),
    patientApi.getCases(patientId, { limit: 50 }),
  ]);

  return {
    patient,
    insights: insights.insights,
    observationBundle,
    fallbackVitals: createMockVitals(),
    consultationHistory: mapPatientCasesToHistory(patientCases.cases),
  };
}

async function createHybridRecord(patientId: string): Promise<PatientRepositoryRecord> {
  const mockRecord = createMockRecord(patientId);

  const [patient, insights, observationBundle, patientCases] = await Promise.all([
    mcpApi.getPatient(patientId).catch(() => null),
    mcpApi.getPatientInsights(patientId).catch(() => null),
    fhirApi.getObservations({ patient: patientId }).catch(() => null),
    patientApi.getCases(patientId, { limit: 50 }).catch(() => null),
  ]);

  return {
    patient: patient ?? mockRecord.patient,
    insights:
      insights?.insights && insights.insights.length > 0
        ? insights.insights
        : mockRecord.insights,
    observationBundle,
    fallbackVitals: mockRecord.fallbackVitals,
    consultationHistory:
      patientCases?.cases && patientCases.cases.length > 0
        ? mapPatientCasesToHistory(patientCases.cases)
        : mockRecord.consultationHistory,
  };
}

export function createPatientDashboardRepository(
  source: PatientDataSource = resolvePatientDataSource(),
): PatientDashboardRepository {
  return {
    async fetchPatientRecord(patientId: string): Promise<PatientRepositoryRecord> {
      if (!patientId || source === 'mock') {
        return createMockRecord(patientId);
      }

      if (source === 'api') {
        return createApiRecord(patientId);
      }

      return createHybridRecord(patientId);
    },
  };
}
