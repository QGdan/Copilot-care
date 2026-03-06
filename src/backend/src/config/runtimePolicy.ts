export const DEMO_CONSENT_TOKEN = 'consent_local_demo';

export interface BackendExposurePolicy {
  isProduction: boolean;
  corsAllowedOrigins: string[];
  interopEnabled: boolean;
  mcpEnabled: boolean;
  allowDemoConsentToken: boolean;
  interopApiKey?: string;
  mcpApiKey?: string;
}

export function parseBooleanFlag(
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

function parseStringList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[,\n\r\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

export function isProductionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

export function resolveBackendExposurePolicy(
  env: NodeJS.ProcessEnv = process.env,
): BackendExposurePolicy {
  const isProduction = isProductionEnvironment(env);

  return {
    isProduction,
    corsAllowedOrigins: parseStringList(
      env.COPILOT_CARE_CORS_ALLOWED_ORIGINS,
    ).map(normalizeOrigin),
    interopEnabled: parseBooleanFlag(
      env.COPILOT_CARE_ENABLE_INTEROP,
      !isProduction,
    ),
    mcpEnabled: parseBooleanFlag(env.COPILOT_CARE_ENABLE_MCP, !isProduction),
    allowDemoConsentToken: !isProduction,
    interopApiKey: (env.COPILOT_CARE_INTEROP_API_KEY ?? '').trim() || undefined,
    mcpApiKey: (env.COPILOT_CARE_MCP_API_KEY ?? '').trim() || undefined,
  };
}

export function isOriginAllowed(
  origin: string,
  allowedOrigins: string[],
): boolean {
  return allowedOrigins.includes(normalizeOrigin(origin));
}
