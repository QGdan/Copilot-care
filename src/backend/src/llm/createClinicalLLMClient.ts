import {
  ClinicalExpertKey,
  ClinicalExpertLLMClients,
  ClinicalExpertProviderAssignment,
  ClinicalExpertProviderAssignments,
  ClinicalLLMClient,
  ClinicalLLMProvider,
} from './types';
import { OpenAIClinicalLLMClient } from './providers/OpenAIClinicalLLMClient';
import { AnthropicClinicalLLMClient } from './providers/AnthropicClinicalLLMClient';
import { GeminiClinicalLLMClient } from './providers/GeminiClinicalLLMClient';
import { DeepSeekClinicalLLMClient } from './providers/DeepSeekClinicalLLMClient';
import { KimiClinicalLLMClient } from './providers/KimiClinicalLLMClient';
import { DashScopeClinicalLLMClient } from './providers/DashScopeClinicalLLMClient';

function parseTimeout(value: string | undefined): number {
  if (!value) {
    return 300000;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 300000;
  }
  return parsed;
}

function parseNonNegativeInt(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export interface ClinicalLLMTransportPolicy {
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export function resolveClinicalLLMTransportPolicy(
  env: NodeJS.ProcessEnv = process.env,
): ClinicalLLMTransportPolicy {
  return {
    timeoutMs: parseTimeout(env.COPILOT_CARE_LLM_TIMEOUT_MS),
    maxRetries: parseNonNegativeInt(env.COPILOT_CARE_LLM_MAX_RETRIES, 1),
    retryDelayMs: parseNonNegativeInt(env.COPILOT_CARE_LLM_RETRY_DELAY_MS, 300),
  };
}

class FallbackClinicalLLMClient implements ClinicalLLMClient {
  private readonly clients: ClinicalLLMClient[];

  constructor(clients: ClinicalLLMClient[]) {
    this.clients = clients;
  }

  public async generateOpinion(input: Parameters<ClinicalLLMClient['generateOpinion']>[0]) {
    for (const client of this.clients) {
      try {
        const response = await client.generateOpinion(input);
        if (response) {
          return response;
        }
      } catch {
        continue;
      }
    }
    return null;
  }
}

function selectModel(
  env: NodeJS.ProcessEnv,
  providerSpecific: string | undefined,
  fallback: string,
): string {
  return providerSpecific || env.COPILOT_CARE_LLM_MODEL || fallback;
}

const EXPERT_PROVIDER_POLICY: Record<
  ClinicalExpertKey,
  { envKey: string; defaultProvider: ClinicalLLMProvider }
> = {
  cardiology: {
    envKey: 'COPILOT_CARE_CARDIO_PROVIDER',
    defaultProvider: 'deepseek',
  },
  generalPractice: {
    envKey: 'COPILOT_CARE_GP_PROVIDER',
    defaultProvider: 'gemini',
  },
  metabolic: {
    envKey: 'COPILOT_CARE_METABOLIC_PROVIDER',
    defaultProvider: 'gemini',
  },
  safety: {
    envKey: 'COPILOT_CARE_SAFETY_PROVIDER',
    defaultProvider: 'kimi',
  },
};

const VALID_EXPERT_PROVIDER_SET: ReadonlySet<ClinicalLLMProvider> = new Set([
  'none',
  'auto',
  'deepseek',
  'gemini',
  'kimi',
  'dashscope',
  'openai',
  'anthropic',
  'deepseek_gemini',
]);

function createProviderClients(
  env: NodeJS.ProcessEnv,
  transportPolicy: ClinicalLLMTransportPolicy,
): Record<string, ClinicalLLMClient | null> {
  return {
    deepseek: env.DEEPSEEK_API_KEY
      ? new DeepSeekClinicalLLMClient({
          apiKey: env.DEEPSEEK_API_KEY,
          model: selectModel(env, env.DEEPSEEK_LLM_MODEL, 'deepseek-chat'),
          timeoutMs: transportPolicy.timeoutMs,
          maxRetries: transportPolicy.maxRetries,
          retryDelayMs: transportPolicy.retryDelayMs,
          baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
        })
      : null,
    gemini: env.GEMINI_API_KEY
      ? new GeminiClinicalLLMClient({
          apiKey: env.GEMINI_API_KEY,
          model: selectModel(env, env.GEMINI_LLM_MODEL, 'gemini-2.5-flash'),
          timeoutMs: transportPolicy.timeoutMs,
          maxRetries: transportPolicy.maxRetries,
          retryDelayMs: transportPolicy.retryDelayMs,
          baseUrl:
            env.GEMINI_BASE_URL ||
            'https://generativelanguage.googleapis.com/v1beta',
        })
      : null,
    kimi: env.KIMI_API_KEY
      ? new KimiClinicalLLMClient({
          apiKey: env.KIMI_API_KEY,
          model: selectModel(env, env.KIMI_LLM_MODEL, 'moonshot-v1-8k'),
          timeoutMs: transportPolicy.timeoutMs,
          maxRetries: transportPolicy.maxRetries,
          retryDelayMs: transportPolicy.retryDelayMs,
          baseUrl: env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
        })
      : null,
    dashscope: env.DASHSCOPE_API_KEY
      ? new DashScopeClinicalLLMClient({
          apiKey: env.DASHSCOPE_API_KEY,
          model: selectModel(env, env.DASHSCOPE_LLM_MODEL, 'qwen-plus'),
          timeoutMs: transportPolicy.timeoutMs,
          maxRetries: transportPolicy.maxRetries,
          retryDelayMs: transportPolicy.retryDelayMs,
          baseUrl:
            env.DASHSCOPE_BASE_URL
            || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        })
      : null,
    openai: env.OPENAI_API_KEY
      ? new OpenAIClinicalLLMClient({
          apiKey: env.OPENAI_API_KEY,
          model: selectModel(env, env.OPENAI_LLM_MODEL, 'gpt-5-mini'),
          timeoutMs: transportPolicy.timeoutMs,
          maxRetries: transportPolicy.maxRetries,
          retryDelayMs: transportPolicy.retryDelayMs,
          baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        })
      : null,
    anthropic: env.ANTHROPIC_API_KEY
      ? new AnthropicClinicalLLMClient({
          apiKey: env.ANTHROPIC_API_KEY,
          model: selectModel(env, env.ANTHROPIC_LLM_MODEL, 'claude-sonnet-4-5'),
          timeoutMs: transportPolicy.timeoutMs,
          maxRetries: transportPolicy.maxRetries,
          retryDelayMs: transportPolicy.retryDelayMs,
          baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
        })
      : null,
  };
}

function buildFallbackChain(
  providers: string[],
  clients: Record<string, ClinicalLLMClient | null>,
): ClinicalLLMClient | null {
  const chain = providers
    .map((provider) => clients[provider])
    .filter((client): client is ClinicalLLMClient => Boolean(client));

  if (chain.length === 0) {
    return null;
  }
  return chain.length === 1 ? chain[0] : new FallbackClinicalLLMClient(chain);
}

function parseProviderChain(value: string): string[] {
  return value
    .split(/[,\|>\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function resolveAutoProviderOrder(env: NodeJS.ProcessEnv): string[] {
  const fallback = ['deepseek', 'gemini', 'kimi', 'dashscope', 'openai', 'anthropic'];
  const raw = env.COPILOT_CARE_LLM_AUTO_CHAIN;
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const parsed = parseProviderChain(raw).filter((provider) =>
    fallback.includes(provider),
  );
  if (parsed.length === 0) {
    return fallback;
  }

  return [...new Set(parsed)];
}

export function createClinicalLLMClient(
  env: NodeJS.ProcessEnv = process.env,
): ClinicalLLMClient | null {
  if (
    env === process.env &&
    env.NODE_ENV === 'test' &&
    env.COPILOT_CARE_ENABLE_LLM_IN_TEST !== 'true'
  ) {
    return null;
  }

  const provider = (env.COPILOT_CARE_LLM_PROVIDER || 'auto').toLowerCase();
  const transportPolicy = resolveClinicalLLMTransportPolicy(env);
  const clients = createProviderClients(env, transportPolicy);

  if (provider === 'none') {
    return null;
  }

  if (provider === 'deepseek_gemini') {
    return buildFallbackChain(['deepseek', 'gemini'], clients);
  }

  const chainProviders = parseProviderChain(provider);
  if (chainProviders.length > 1) {
    return buildFallbackChain(chainProviders, clients);
  }

  if (chainProviders.length === 1 && chainProviders[0] in clients) {
    return clients[chainProviders[0]] || null;
  }

  const autoChain = buildFallbackChain(resolveAutoProviderOrder(env), clients);
  return autoChain;
}

function resolveProviderModelEnvKey(
  provider: ClinicalLLMProvider,
): keyof NodeJS.ProcessEnv | null {
  if (provider === 'deepseek') {
    return 'DEEPSEEK_LLM_MODEL';
  }
  if (provider === 'gemini') {
    return 'GEMINI_LLM_MODEL';
  }
  if (provider === 'kimi') {
    return 'KIMI_LLM_MODEL';
  }
  if (provider === 'dashscope') {
    return 'DASHSCOPE_LLM_MODEL';
  }
  if (provider === 'openai') {
    return 'OPENAI_LLM_MODEL';
  }
  if (provider === 'anthropic') {
    return 'ANTHROPIC_LLM_MODEL';
  }
  return null;
}

function buildClientWithScopedProvider(
  env: NodeJS.ProcessEnv,
  provider: ClinicalLLMProvider,
  modelOverride?: string,
): ClinicalLLMClient | null {
  const scopedEnv = {
    ...env,
    COPILOT_CARE_LLM_PROVIDER: provider,
  } as NodeJS.ProcessEnv;

  const modelEnvKey = resolveProviderModelEnvKey(provider);
  if (modelEnvKey && modelOverride && modelOverride.trim()) {
    scopedEnv[modelEnvKey] = modelOverride.trim();
  }

  return createClinicalLLMClient(scopedEnv);
}

export function createClinicalLLMClientForProvider(
  provider: ClinicalLLMProvider,
  env: NodeJS.ProcessEnv = process.env,
  modelOverride?: string,
): ClinicalLLMClient | null {
  return buildClientWithScopedProvider(env, provider, modelOverride);
}

function resolveSingleExpertProvider(
  env: NodeJS.ProcessEnv,
  envKey: string,
  fallback: ClinicalLLMProvider,
): ClinicalExpertProviderAssignment {
  const explicit = env[envKey];
  if (!explicit || !explicit.trim()) {
    return {
      provider: fallback,
      source: 'default',
      envKey,
    };
  }

  const candidate = explicit.trim().toLowerCase() as ClinicalLLMProvider;
  if (!VALID_EXPERT_PROVIDER_SET.has(candidate)) {
    return {
      provider: fallback,
      source: 'invalid_fallback',
      envKey,
    };
  }

  return {
    provider: candidate,
    source: 'env',
    envKey,
  };
}

export function resolveClinicalExpertProviderAssignments(
  env: NodeJS.ProcessEnv = process.env,
): ClinicalExpertProviderAssignments {
  const keys = Object.keys(EXPERT_PROVIDER_POLICY) as ClinicalExpertKey[];
  const assignmentEntries = keys.map((key) => {
    const policy = EXPERT_PROVIDER_POLICY[key];
    const assignment = resolveSingleExpertProvider(
      env,
      policy.envKey,
      policy.defaultProvider,
    );
    return [key, assignment] as const;
  });

  return Object.fromEntries(assignmentEntries) as ClinicalExpertProviderAssignments;
}

export function createClinicalExpertLLMClients(
  env: NodeJS.ProcessEnv = process.env,
): ClinicalExpertLLMClients {
  if (
    env === process.env &&
    env.NODE_ENV === 'test' &&
    env.COPILOT_CARE_ENABLE_LLM_IN_TEST !== 'true'
  ) {
    return {
      cardiology: null,
      generalPractice: null,
      metabolic: null,
      safety: null,
    };
  }

  const assignments = resolveClinicalExpertProviderAssignments(env);

  return {
    cardiology: buildClientWithScopedProvider(
      env,
      assignments.cardiology.provider,
    ),
    generalPractice: buildClientWithScopedProvider(
      env,
      assignments.generalPractice.provider,
    ),
    metabolic: buildClientWithScopedProvider(
      env,
      assignments.metabolic.provider,
    ),
    safety: buildClientWithScopedProvider(env, assignments.safety.provider),
  };
}
