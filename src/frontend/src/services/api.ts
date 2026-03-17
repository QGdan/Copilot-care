import axios, { type AxiosError, type AxiosInstance } from 'axios';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';

class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number | null,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function createApiClient(baseURL: string = API_BASE_URL): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response) {
        const data = error.response.data as Record<string, unknown>;
        throw new ApiError(
          (data.message as string) || error.message,
          error.response.status,
          data.error as string,
        );
      }

      if (error.request) {
        throw new ApiError(
          '网络请求失败，请检查网络连接或后端服务状态。',
          null,
        );
      }

      throw new ApiError(error.message, null);
    },
  );

  return client;
}

const apiClient = createApiClient();

export interface FHIRBundle<T> {
  resourceType: 'Bundle';
  type: string;
  total: number;
  entry?: Array<{ resource: T }>;
}

export interface FHIRPatient {
  resourceType: 'Patient';
  id: string;
  identifier?: Array<{ system?: string; value?: string }>;
  active?: boolean;
  gender?: string;
  birthDate?: string;
  name?: Array<{ family?: string; given?: string[] }>;
}

export interface FHIRObservation {
  resourceType: 'Observation';
  id: string;
  status: string;
  code?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };
  subject?: { reference?: string };
  effectiveDateTime?: string;
  valueQuantity?: {
    value?: number;
    unit?: string;
    system?: string;
    code?: string;
  };
}

export interface FHIRProvenance {
  resourceType: 'Provenance';
  id: string;
  target?: Array<{ reference?: string }>;
  recorded?: string;
  agent?: Array<{
    type?: { coding?: Array<{ system?: string; code?: string }> };
    who?: { reference?: string };
  }>;
  activity?: { text?: string };
  reason?: Array<{ text?: string }>;
}

export interface FHIRCapabilityStatement {
  resourceType: 'CapabilityStatement';
  status: string;
  fhirVersion: string;
  format: string[];
}

export const fhirApi = {
  async getMetadata(): Promise<FHIRCapabilityStatement> {
    const response = await apiClient.get<FHIRCapabilityStatement>(
      '/fhir/metadata',
    );
    return response.data;
  },

  async getPatients(): Promise<FHIRBundle<FHIRPatient>> {
    const response = await apiClient.get<FHIRBundle<FHIRPatient>>(
      '/fhir/Patient',
    );
    return response.data;
  },

  async getPatient(id: string): Promise<FHIRPatient> {
    const response = await apiClient.get<FHIRPatient>(`/fhir/Patient/${id}`);
    return response.data;
  },

  async getObservations(params?: {
    patient?: string;
    code?: string;
  }): Promise<FHIRBundle<FHIRObservation>> {
    const response = await apiClient.get<FHIRBundle<FHIRObservation>>(
      '/fhir/Observation',
      { params },
    );
    return response.data;
  },

  async getObservation(id: string): Promise<FHIRObservation> {
    const response = await apiClient.get<FHIRObservation>(
      `/fhir/Observation/${id}`,
    );
    return response.data;
  },

  async getProvenances(patientId?: string): Promise<FHIRBundle<FHIRProvenance>> {
    const response = await apiClient.get<FHIRBundle<FHIRProvenance>>(
      '/fhir/Provenance',
      {
        params: patientId ? { patient: patientId } : {},
      },
    );
    return response.data;
  },
};

export interface MCPHealthResponse {
  status: string;
  mode: string;
  endpoints: string[];
}

export interface MCPContextRequest {
  profile: {
    patientId: string;
    [key: string]: unknown;
  };
  consentToken: string;
  symptomText?: string;
}

export interface MCPContextResponse {
  profilePatch?: Record<string, unknown>;
  signals?: Array<{
    timestamp: string;
    source: string;
    [key: string]: unknown;
  }>;
  insights?: string[];
}

export interface MCPPatientResponse {
  patientId: string;
  age?: number;
  sex?: string;
  name?: string;
  chiefComplaint?: string;
  chronicDiseases?: string[];
  medicationHistory?: string[];
  lifestyleTags?: string[];
  tcmConstitution?: string;
}

export interface MCPInsightsResponse {
  patientId: string;
  insights: string[];
  generatedAt: string;
}

export interface MCPPatientSignalsResponse {
  resourceType: string;
  total: number;
  entry: Array<{ resource: unknown }>;
}

export type PatientCaseStatus =
  | 'OUTPUT'
  | 'ESCALATE_TO_OFFLINE'
  | 'ABSTAIN'
  | 'ERROR';

export interface PatientCaseRecord {
  caseId: string;
  requestId?: string;
  sessionId?: string;
  patientId: string;
  status: PatientCaseStatus;
  reviewStatus?: 'pending' | 'reviewing' | 'approved' | 'rejected';
  summary: string;
  triageLevel?: string;
  destination?: string;
  department: string;
  routeMode?: string;
  complexityScore?: number;
  durationMs?: number;
  errorCode?: string;
  startedAt: string;
  endedAt?: string;
  updatedAt: string;
  source: 'runtime' | 'review_queue' | 'merged';
}

export interface PatientCasesResponse {
  generatedAt: string;
  patientId: string;
  total: number;
  returned: number;
  cases: PatientCaseRecord[];
}

export const mcpApi = {
  async getHealth(): Promise<MCPHealthResponse> {
    const response = await apiClient.get<MCPHealthResponse>('/mcp/health');
    return response.data;
  },

  async getPatientContext(
    request: MCPContextRequest,
  ): Promise<MCPContextResponse> {
    const response = await apiClient.post<MCPContextResponse>(
      '/mcp/patient/context',
      request,
    );
    return response.data;
  },

  async getPatient(id: string): Promise<MCPPatientResponse> {
    const response = await apiClient.get<MCPPatientResponse>(
      `/mcp/patient/${id}`,
    );
    return response.data;
  },

  async getPatientSignals(id: string): Promise<MCPPatientSignalsResponse> {
    const response = await apiClient.get<MCPPatientSignalsResponse>(
      `/mcp/patient/${id}/signals`,
    );
    return response.data;
  },

  async getPatientInsights(id: string): Promise<MCPInsightsResponse> {
    const response = await apiClient.get<MCPInsightsResponse>(
      `/mcp/patient/${id}/insights`,
    );
    return response.data;
  },
};

export const patientApi = {
  async getCases(
    id: string,
    params?: {
      limit?: number;
    },
  ): Promise<PatientCasesResponse> {
    const response = await apiClient.get<PatientCasesResponse>(
      `/patients/${id}/cases`,
      { params },
    );
    return response.data;
  },
};

export { ApiError, apiClient, createApiClient };
