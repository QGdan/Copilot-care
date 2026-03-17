import {
  HealthSignal,
  PatientProfile,
  TriageRequest,
} from '@copilot-care/shared/types';
import { postJson } from '../../llm/http';

export interface EnrichedPatientContext {
  profile: PatientProfile;
  signals: HealthSignal[];
  insights: string[];
  source: 'mcp' | 'local';
}

export interface PatientContextEnricher {
  enrich(input: TriageRequest): Promise<EnrichedPatientContext>;
}

interface McpRuntimeConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseMcpConfig(env: NodeJS.ProcessEnv): McpRuntimeConfig {
  const baseUrl = (env.COPILOT_CARE_MCP_BASE_URL || '').trim();
  return {
    enabled: Boolean(baseUrl),
    baseUrl,
    apiKey: (env.COPILOT_CARE_MCP_API_KEY || '').trim() || undefined,
    timeoutMs: parsePositiveInt(env.COPILOT_CARE_MCP_TIMEOUT_MS, 30000),
    maxRetries: parsePositiveInt(env.COPILOT_CARE_MCP_MAX_RETRIES, 0),
    retryDelayMs: parsePositiveInt(env.COPILOT_CARE_MCP_RETRY_DELAY_MS, 200),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeStringArray(base: string[], patch: string[]): string[] {
  return [...new Set([...base, ...patch])];
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function sanitizeSignal(raw: unknown): HealthSignal | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const timestamp =
    typeof source.timestamp === 'string' && source.timestamp.trim()
      ? source.timestamp
      : new Date().toISOString();
  const origin =
    source.source === 'wearable' ||
    source.source === 'manual' ||
    source.source === 'hospital'
      ? source.source
      : 'hospital';

  const signal: HealthSignal = {
    timestamp,
    source: origin,
  };

  const fields: Array<keyof Omit<HealthSignal, 'timestamp' | 'source'>> = [
    'systolicBP',
    'diastolicBP',
    'heartRate',
    'spo2',
    'bloodGlucose',
    'bloodLipid',
  ];

  for (const field of fields) {
    const value = toOptionalNumber(source[field]);
    if (typeof value === 'number') {
      signal[field] = value;
    }
  }

  return signal;
}

function sanitizeSignals(raw: unknown): HealthSignal[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => sanitizeSignal(item))
    .filter((item): item is HealthSignal => Boolean(item));
}

function mergeProfile(
  profile: PatientProfile,
  patch: Partial<PatientProfile>,
): PatientProfile {
  const mergedVitals = {
    ...(profile.vitals ?? {}),
    ...(patch.vitals ?? {}),
  };

  return {
    ...profile,
    ...patch,
    chronicDiseases: mergeStringArray(
      profile.chronicDiseases ?? [],
      patch.chronicDiseases ?? [],
    ),
    medicationHistory: mergeStringArray(
      profile.medicationHistory ?? [],
      patch.medicationHistory ?? [],
    ),
    allergyHistory: mergeStringArray(
      profile.allergyHistory ?? [],
      patch.allergyHistory ?? [],
    ),
    lifestyleTags: mergeStringArray(
      profile.lifestyleTags ?? [],
      patch.lifestyleTags ?? [],
    ),
    vitals: Object.keys(mergedVitals).length > 0 ? mergedVitals : undefined,
  };
}

function protectDemographicConsistency(input: {
  localProfile: PatientProfile;
  remotePatch: Partial<PatientProfile>;
}): {
  patch: Partial<PatientProfile>;
  conflictInsights: string[];
} {
  const patch: Partial<PatientProfile> = { ...input.remotePatch };
  const conflictInsights: string[] = [];

  const localAge = toOptionalNumber(input.localProfile.age);
  const remoteAge = toOptionalNumber(patch.age);
  if (
    typeof localAge === 'number'
    && typeof remoteAge === 'number'
    && Math.abs(localAge - remoteAge) >= 2
  ) {
    delete patch.age;
    conflictInsights.push(
      `MCP人口学冲突：云端年龄(${remoteAge})与请求年龄(${localAge})不一致，已保留请求值。`,
    );
  }

  const localSex = input.localProfile.sex;
  const remoteSex = patch.sex;
  if (
    (localSex === 'male' || localSex === 'female' || localSex === 'other')
    && (remoteSex === 'male' || remoteSex === 'female' || remoteSex === 'other')
    && localSex !== remoteSex
  ) {
    delete patch.sex;
    conflictInsights.push(
      `MCP人口学冲突：云端性别(${remoteSex})与请求性别(${localSex})不一致，已保留请求值。`,
    );
  }

  return { patch, conflictInsights };
}

function sanitizeProfilePatch(raw: unknown): Partial<PatientProfile> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const source = raw as Record<string, unknown>;
  const patch: Partial<PatientProfile> = {};

  const age = toOptionalNumber(source.age);
  if (typeof age === 'number' && age > 0) {
    patch.age = age;
  }

  if (source.sex === 'male' || source.sex === 'female' || source.sex === 'other') {
    patch.sex = source.sex;
  }

  if (typeof source.name === 'string' && source.name.trim()) {
    patch.name = source.name.trim();
  }
  if (typeof source.chiefComplaint === 'string' && source.chiefComplaint.trim()) {
    patch.chiefComplaint = source.chiefComplaint.trim();
  }
  if (typeof source.tcmConstitution === 'string' && source.tcmConstitution.trim()) {
    patch.tcmConstitution = source.tcmConstitution.trim();
  }

  patch.symptoms = toStringArray(source.symptoms);
  patch.chronicDiseases = toStringArray(source.chronicDiseases);
  patch.medicationHistory = toStringArray(source.medicationHistory);
  patch.allergyHistory = toStringArray(source.allergyHistory);
  patch.lifestyleTags = toStringArray(source.lifestyleTags);

  if (source.vitals && typeof source.vitals === 'object') {
    const vitalsSource = source.vitals as Record<string, unknown>;
    patch.vitals = {
      systolicBP: toOptionalNumber(vitalsSource.systolicBP),
      diastolicBP: toOptionalNumber(vitalsSource.diastolicBP),
      heartRate: toOptionalNumber(vitalsSource.heartRate),
      spo2: toOptionalNumber(vitalsSource.spo2),
      bloodGlucose: toOptionalNumber(vitalsSource.bloodGlucose),
      bloodLipid: toOptionalNumber(vitalsSource.bloodLipid),
    };
  }

  return patch;
}

class NoopPatientContextEnricher implements PatientContextEnricher {
  public async enrich(input: TriageRequest): Promise<EnrichedPatientContext> {
    return {
      profile: input.profile,
      signals: input.signals ?? [],
      insights: [],
      source: 'local',
    };
  }
}

class HttpPatientContextEnricher implements PatientContextEnricher {
  private readonly config: McpRuntimeConfig;

  constructor(config: McpRuntimeConfig) {
    this.config = config;
  }

  public async enrich(input: TriageRequest): Promise<EnrichedPatientContext> {
    const fallback: EnrichedPatientContext = {
      profile: input.profile,
      signals: input.signals ?? [],
      insights: [],
      source: 'local',
    };

    if (!this.config.enabled) {
      return fallback;
    }

    try {
      const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/patient/context`;
      const payload = await postJson({
        url: endpoint,
        timeoutMs: this.config.timeoutMs,
        maxRetries: this.config.maxRetries,
        retryDelayMs: this.config.retryDelayMs,
        headers: this.config.apiKey
          ? { Authorization: `Bearer ${this.config.apiKey}` }
          : {},
        body: {
          requestId: input.requestId,
          sessionId: input.sessionId,
          consentToken: input.consentToken,
          symptomText: input.symptomText,
          profile: input.profile,
          signals: input.signals ?? [],
        },
      });

      const candidate =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {};
      const profilePatch = sanitizeProfilePatch(candidate.profilePatch);
      const consistencyGuard = protectDemographicConsistency({
        localProfile: input.profile,
        remotePatch: profilePatch,
      });
      const remoteSignals = sanitizeSignals(candidate.signals);
      const insights = toStringArray(candidate.insights).slice(0, 8);
      const mergedProfile = mergeProfile(input.profile, consistencyGuard.patch);
      const mergedSignals = [...(input.signals ?? []), ...remoteSignals];
      for (const detail of consistencyGuard.conflictInsights) {
        if (insights.length >= 8) {
          break;
        }
        insights.push(detail);
      }

      if (insights.length === 0) {
        insights.push('已接入MCP患者云端数据并完成上下文融合。');
      }

      return {
        profile: mergedProfile,
        signals: mergedSignals,
        insights,
        source: 'mcp',
      };
    } catch {
      return fallback;
    }
  }
}

export function createPatientContextEnricher(
  env: NodeJS.ProcessEnv = process.env,
): PatientContextEnricher {
  const config = parseMcpConfig(env);
  if (!config.enabled) {
    return new NoopPatientContextEnricher();
  }
  return new HttpPatientContextEnricher(config);
}
