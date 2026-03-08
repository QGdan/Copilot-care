import path from 'node:path';
import {
  ResolvedSearchRuntimeConfig,
  SearchRuntimeConfig,
} from './types';

const DEFAULT_CACHE_TTL_MS = 180000;
const DEFAULT_CACHE_MAX_ENTRIES = 128;
const DEFAULT_PROVIDER_FAILURE_THRESHOLD = 3;
const DEFAULT_PROVIDER_CIRCUIT_OPEN_MS = 60000;
const DEFAULT_RECENT_SEARCH_LOG_LIMIT = 40;

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, Math.floor(parsed)));
  return clamped;
}

function resolveSearchRuntimeConfig(
  raw: SearchRuntimeConfig,
): ResolvedSearchRuntimeConfig {
  const runtimeLogFilePath =
    typeof raw.runtimeLogFilePath === 'string'
      ? raw.runtimeLogFilePath.trim()
      : '';

  return {
    enabled: raw.enabled,
    networkEnabled: raw.networkEnabled,
    timeoutMs: raw.timeoutMs,
    maxResults: raw.maxResults,
    pubMedRetMax: raw.pubMedRetMax,
    duckDuckGoEnabled: raw.duckDuckGoEnabled,
    allowPartialSeedFill: raw.allowPartialSeedFill === true,
    cacheTtlMs: Math.max(0, Math.floor(raw.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS)),
    cacheMaxEntries: Math.max(
      1,
      Math.floor(raw.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES),
    ),
    providerFailureThreshold: Math.max(
      1,
      Math.floor(
        raw.providerFailureThreshold ?? DEFAULT_PROVIDER_FAILURE_THRESHOLD,
      ),
    ),
    providerCircuitOpenMs: Math.max(
      1000,
      Math.floor(raw.providerCircuitOpenMs ?? DEFAULT_PROVIDER_CIRCUIT_OPEN_MS),
    ),
    runtimeLogFilePath: runtimeLogFilePath || undefined,
    recentSearchLogLimit: Math.max(
      1,
      Math.floor(raw.recentSearchLogLimit ?? DEFAULT_RECENT_SEARCH_LOG_LIMIT),
    ),
  };
}

function createSearchRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSearchRuntimeConfig {
  const enabled = parseBoolean(env.COPILOT_CARE_MED_SEARCH_ENABLED, true);
  const allowNetworkInTest = parseBoolean(
    env.COPILOT_CARE_MED_SEARCH_NETWORK_IN_TEST,
    false,
  );
  const networkEnabled =
    enabled && (env.NODE_ENV !== 'test' || allowNetworkInTest);
  const runtimeLogFilePathEnv = env.COPILOT_CARE_MED_SEARCH_RUNTIME_LOG_FILE?.trim();
  const runtimeLogFilePath =
    runtimeLogFilePathEnv && runtimeLogFilePathEnv.length > 0
      ? path.resolve(runtimeLogFilePathEnv)
      : env.NODE_ENV === 'test'
        ? undefined
        : path.resolve('reports/runtime/medical-search.runtime.jsonl');

  return resolveSearchRuntimeConfig({
    enabled,
    networkEnabled,
    timeoutMs: parsePositiveInt(
      env.COPILOT_CARE_MED_SEARCH_TIMEOUT_MS,
      8000,
      1000,
      30000,
    ),
    maxResults: parsePositiveInt(
      env.COPILOT_CARE_MED_SEARCH_MAX_RESULTS,
      8,
      1,
      20,
    ),
    pubMedRetMax: parsePositiveInt(
      env.COPILOT_CARE_MED_SEARCH_PUBMED_RETMAX,
      6,
      1,
      12,
    ),
    duckDuckGoEnabled: parseBoolean(
      env.COPILOT_CARE_MED_SEARCH_DDG_ENABLED,
      true,
    ),
    allowPartialSeedFill: parseBoolean(
      env.COPILOT_CARE_MED_SEARCH_ALLOW_PARTIAL_SEED_FILL,
      false,
    ),
    cacheTtlMs: parsePositiveInt(
      env.COPILOT_CARE_MED_SEARCH_CACHE_TTL_MS,
      DEFAULT_CACHE_TTL_MS,
      0,
      3_600_000,
    ),
    cacheMaxEntries: parsePositiveInt(
      env.COPILOT_CARE_MED_SEARCH_CACHE_MAX_ENTRIES,
      DEFAULT_CACHE_MAX_ENTRIES,
      1,
      1_024,
    ),
    providerFailureThreshold: parsePositiveInt(
      env.COPILOT_CARE_MED_SEARCH_PROVIDER_FAILURE_THRESHOLD,
      DEFAULT_PROVIDER_FAILURE_THRESHOLD,
      1,
      20,
    ),
    providerCircuitOpenMs: parsePositiveInt(
      env.COPILOT_CARE_MED_SEARCH_PROVIDER_CIRCUIT_OPEN_MS,
      DEFAULT_PROVIDER_CIRCUIT_OPEN_MS,
      1000,
      3_600_000,
    ),
    runtimeLogFilePath,
    recentSearchLogLimit: parsePositiveInt(
      env.COPILOT_CARE_MED_SEARCH_RECENT_LOG_LIMIT,
      DEFAULT_RECENT_SEARCH_LOG_LIMIT,
      1,
      500,
    ),
  });
}

export {
  createSearchRuntimeConfig,
  parseBoolean,
  parsePositiveInt,
  resolveSearchRuntimeConfig,
};
