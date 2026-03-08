import {
  AgentOpinion,
  PatientProfile,
  RiskLevel,
} from '@copilot-care/shared/types';

export interface ClinicalLLMRequest {
  role: AgentOpinion['role'];
  agentName: string;
  focus: string;
  profile: PatientProfile;
  context: string;
}

export interface ClinicalLLMResponse {
  riskLevel: RiskLevel;
  confidence: number;
  reasoning: string;
  citations: string[];
  actions: string[];
}

export interface ClinicalLLMClient {
  generateOpinion(input: ClinicalLLMRequest): Promise<ClinicalLLMResponse | null>;
}

export type ClinicalLLMProvider =
  | 'none'
  | 'auto'
  | 'deepseek'
  | 'gemini'
  | 'kimi'
  | 'dashscope'
  | 'openai'
  | 'anthropic'
  | 'deepseek_gemini';

export type ClinicalExpertKey =
  | 'cardiology'
  | 'generalPractice'
  | 'metabolic'
  | 'safety';

export type ProviderAssignmentSource = 'env' | 'default' | 'invalid_fallback';

export interface ClinicalExpertProviderAssignment {
  provider: ClinicalLLMProvider;
  source: ProviderAssignmentSource;
  envKey: string;
}

export interface ClinicalExpertLLMClients {
  cardiology: ClinicalLLMClient | null;
  generalPractice: ClinicalLLMClient | null;
  metabolic: ClinicalLLMClient | null;
  safety: ClinicalLLMClient | null;
}

export type ClinicalExpertProviderAssignments = Record<
  ClinicalExpertKey,
  ClinicalExpertProviderAssignment
>;

export interface ClinicalLLMProviderConfig {
  model: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}
