import {
  AuthoritativeMedicalEvidence,
  AuthoritativeMedicalSearchResult,
  AuthoritativeMedicalSource,
} from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';

export interface SearchRuntimeConfig {
  enabled: boolean;
  networkEnabled: boolean;
  timeoutMs: number;
  maxResults: number;
  pubMedRetMax: number;
  duckDuckGoEnabled: boolean;
  allowPartialSeedFill?: boolean;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  providerFailureThreshold?: number;
  providerCircuitOpenMs?: number;
  runtimeLogFilePath?: string;
  recentSearchLogLimit?: number;
}

export interface ResolvedSearchRuntimeConfig {
  enabled: boolean;
  networkEnabled: boolean;
  timeoutMs: number;
  maxResults: number;
  pubMedRetMax: number;
  duckDuckGoEnabled: boolean;
  allowPartialSeedFill: boolean;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  providerFailureThreshold: number;
  providerCircuitOpenMs: number;
  runtimeLogFilePath?: string;
  recentSearchLogLimit: number;
}

export type HttpGetText = (
  url: string,
  timeoutMs: number,
  redirectsRemaining?: number,
) => Promise<string>;

export interface SearchSourceScope {
  sourceById: Map<string, AuthoritativeMedicalSource>;
  allowedSources: AuthoritativeMedicalSource[];
  allowedSourceIds: Set<string>;
  requiredSourceIds: string[];
}

export interface DdgQueryPlan {
  sourceId?: string;
  searchQuery: string;
}

export interface WhitelistedSearchResult {
  results: AuthoritativeMedicalEvidence[];
  droppedByPolicy: number;
}

export interface SearchCacheEntry {
  value: AuthoritativeMedicalSearchResult;
  expiresAt: number;
  touchedAt: number;
}

export interface MedicalSearchProviderContext {
  query: string;
  limit: number;
  allowedSources: AuthoritativeMedicalSource[];
  allowedSourceIds: Set<string>;
  config: ResolvedSearchRuntimeConfig;
  httpGetText: HttpGetText;
}

export interface MedicalSearchProviderExecutionResult {
  providerId: string;
  results: AuthoritativeMedicalEvidence[];
  droppedByPolicy: number;
}

export interface MedicalSearchProvider {
  readonly id: string;
  isEnabled(context: MedicalSearchProviderContext): boolean;
  search(
    context: MedicalSearchProviderContext,
  ): Promise<MedicalSearchProviderExecutionResult>;
}

export const PUBMED_SOURCE_ID = 'PUBMED';
export const MAX_REDIRECTS = 2;
export const USER_AGENT =
  'CopilotCareMedicalSearch/1.0 (+https://github.com/copilot-care)';
export const SOURCE_PRIORITY_ORDER = [
  'NICE',
  'WHO',
  'CDC_US',
  'NHC_CN',
  'CDC_CN',
  'NMPA',
  PUBMED_SOURCE_ID,
] as const;
export const SEARCH_STRATEGY_VERSION = 'authority-multisource-v3.0';
