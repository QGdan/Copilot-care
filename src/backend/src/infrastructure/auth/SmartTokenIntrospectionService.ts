import { parseBooleanFlag } from '../../config/runtimePolicy';
import { IntrospectionResponse } from './smartTypes';

type SmartScopeResolutionSource = 'introspection' | 'scope_header';

export interface SmartScopeResolution {
  ok: boolean;
  scope?: string;
  source?: SmartScopeResolutionSource;
  statusCode?: number;
  diagnostics?: string;
  introspection?: IntrospectionResponse;
}

interface SmartIntrospectionCacheEntry {
  expiresAtMs: number;
  response: IntrospectionResponse;
}

interface SmartIntrospectionConfig {
  enabled: boolean;
  url?: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs: number;
  cacheTtlMs: number;
  requiredAudience: string[];
  requiredIssuer: string[];
  allowScopeHeaderFallback: boolean;
}

export interface ResolveSmartScopeInput {
  token?: string;
  scopeHeader?: string;
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\s|]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed =
    typeof value === 'number' ? value : Number(value ?? Number.NaN);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeIssuer(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function parseAudience(value: unknown): string[] {
  if (typeof value === 'string') {
    return parseList(value);
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function normalizeScope(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeUrl(value: string | undefined): string | undefined {
  const normalized = (value ?? '').trim();
  return normalized || undefined;
}

function normalizeTokenValue(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1].trim();
  }
  return trimmed;
}

function resolveConfig(env: NodeJS.ProcessEnv): SmartIntrospectionConfig {
  const isProduction = (env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
  return {
    enabled: parseBooleanFlag(
      env.COPILOT_CARE_SMART_INTROSPECTION_ENABLED,
      false,
    ),
    url: normalizeUrl(env.COPILOT_CARE_SMART_INTROSPECTION_URL),
    clientId: normalizeUrl(env.COPILOT_CARE_SMART_INTROSPECTION_CLIENT_ID),
    clientSecret: normalizeUrl(env.COPILOT_CARE_SMART_INTROSPECTION_CLIENT_SECRET),
    timeoutMs: clampInteger(
      env.COPILOT_CARE_SMART_INTROSPECTION_TIMEOUT_MS,
      1000,
      30000,
      5000,
    ),
    cacheTtlMs: clampInteger(
      env.COPILOT_CARE_SMART_INTROSPECTION_CACHE_TTL_MS,
      0,
      300000,
      10000,
    ),
    requiredAudience: parseList(env.COPILOT_CARE_SMART_REQUIRED_AUDIENCE),
    requiredIssuer: parseList(env.COPILOT_CARE_SMART_REQUIRED_ISSUER),
    allowScopeHeaderFallback: parseBooleanFlag(
      env.COPILOT_CARE_SMART_SCOPE_HEADER_FALLBACK,
      !isProduction,
    ),
  };
}

function buildBasicAuthHeader(
  clientId: string | undefined,
  clientSecret: string | undefined,
): string | undefined {
  if (!clientId || !clientSecret) {
    return undefined;
  }
  const encoded = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

function toIntrospectionResponse(payload: unknown): IntrospectionResponse | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const candidate = payload as Partial<IntrospectionResponse> & {
    aud?: string | string[];
    iss?: unknown;
    scope?: unknown;
    active?: unknown;
    exp?: unknown;
    iat?: unknown;
  };
  if (typeof candidate.active !== 'boolean') {
    return null;
  }

  return {
    active: candidate.active,
    scope: normalizeScope(candidate.scope),
    client_id:
      typeof candidate.client_id === 'string' ? candidate.client_id : undefined,
    username:
      typeof candidate.username === 'string' ? candidate.username : undefined,
    sub: typeof candidate.sub === 'string' ? candidate.sub : undefined,
    aud: parseAudience(candidate.aud).join(' '),
    iss: normalizeIssuer(candidate.iss) || undefined,
    exp:
      typeof candidate.exp === 'number' && Number.isFinite(candidate.exp)
        ? candidate.exp
        : undefined,
    iat:
      typeof candidate.iat === 'number' && Number.isFinite(candidate.iat)
        ? candidate.iat
        : undefined,
  };
}

export class SmartTokenIntrospectionService {
  private readonly config: SmartIntrospectionConfig;
  private readonly cache: Map<string, SmartIntrospectionCacheEntry>;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.config = resolveConfig(env);
    this.cache = new Map<string, SmartIntrospectionCacheEntry>();
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public async resolveScope(
    input: ResolveSmartScopeInput,
  ): Promise<SmartScopeResolution> {
    const scopeHeader = normalizeScope(input.scopeHeader);
    const token = normalizeTokenValue(input.token);

    if (!this.config.enabled) {
      if (!scopeHeader) {
        return {
          ok: false,
          statusCode: 403,
          diagnostics:
            'SMART scope missing required read grants for Patient/Observation/Provenance.',
        };
      }
      return {
        ok: true,
        scope: scopeHeader,
        source: 'scope_header',
      };
    }

    if (!this.config.url) {
      return {
        ok: false,
        statusCode: 503,
        diagnostics:
          'SMART introspection is enabled but COPILOT_CARE_SMART_INTROSPECTION_URL is missing.',
      };
    }
    if (!token) {
      return {
        ok: false,
        statusCode: 401,
        diagnostics:
          'SMART access token is required when introspection is enabled.',
      };
    }

    const introspection = await this.introspect(token);
    if (!introspection.ok) {
      return introspection;
    }

    const introspectionScope = normalizeScope(introspection.introspection?.scope);
    const fallbackScope =
      this.config.allowScopeHeaderFallback ? scopeHeader : '';
    const effectiveScope = introspectionScope || fallbackScope;
    if (!effectiveScope) {
      return {
        ok: false,
        statusCode: 403,
        diagnostics:
          'SMART introspection response does not contain usable scope grants.',
      };
    }

    return {
      ok: true,
      scope: effectiveScope,
      source: introspectionScope ? 'introspection' : 'scope_header',
      introspection: introspection.introspection,
    };
  }

  private getCached(token: string): IntrospectionResponse | null {
    if (this.config.cacheTtlMs <= 0) {
      return null;
    }
    const cached = this.cache.get(token);
    if (!cached) {
      return null;
    }
    if (cached.expiresAtMs <= Date.now()) {
      this.cache.delete(token);
      return null;
    }
    return cached.response;
  }

  private setCache(token: string, response: IntrospectionResponse): void {
    if (this.config.cacheTtlMs <= 0) {
      return;
    }
    this.cache.set(token, {
      response,
      expiresAtMs: Date.now() + this.config.cacheTtlMs,
    });
  }

  private validateIntrospection(
    response: IntrospectionResponse,
  ): SmartScopeResolution {
    if (!response.active) {
      return {
        ok: false,
        statusCode: 403,
        diagnostics: 'SMART access token is inactive.',
      };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof response.exp === 'number' && response.exp <= nowSeconds) {
      return {
        ok: false,
        statusCode: 403,
        diagnostics: 'SMART access token is expired.',
      };
    }

    if (this.config.requiredAudience.length > 0) {
      const grantedAudience = parseAudience(response.aud);
      const audienceMatch = grantedAudience.some((value) =>
        this.config.requiredAudience.includes(value),
      );
      if (!audienceMatch) {
        return {
          ok: false,
          statusCode: 403,
          diagnostics: 'SMART token audience is not allowed.',
        };
      }
    }

    if (this.config.requiredIssuer.length > 0) {
      const issuer = normalizeIssuer(response.iss);
      if (!issuer || !this.config.requiredIssuer.includes(issuer)) {
        return {
          ok: false,
          statusCode: 403,
          diagnostics: 'SMART token issuer is not allowed.',
        };
      }
    }

    return {
      ok: true,
      introspection: response,
    };
  }

  private async introspect(token: string): Promise<SmartScopeResolution> {
    const cached = this.getCached(token);
    if (cached) {
      return this.validateIntrospection(cached);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      };
      const basicAuth = buildBasicAuthHeader(
        this.config.clientId,
        this.config.clientSecret,
      );
      if (basicAuth) {
        headers.authorization = basicAuth;
      }

      const response = await fetch(this.config.url as string, {
        method: 'POST',
        headers,
        body: new URLSearchParams({ token }).toString(),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          statusCode: 502,
          diagnostics: `SMART introspection endpoint returned ${response.status}.`,
        };
      }
      const payload = (await response.json()) as unknown;
      const introspection = toIntrospectionResponse(payload);
      if (!introspection) {
        return {
          ok: false,
          statusCode: 502,
          diagnostics: 'SMART introspection response is invalid.',
        };
      }
      this.setCache(token, introspection);
      return this.validateIntrospection(introspection);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          ok: false,
          statusCode: 502,
          diagnostics: `SMART introspection timeout after ${this.config.timeoutMs}ms.`,
        };
      }
      return {
        ok: false,
        statusCode: 502,
        diagnostics: 'SMART introspection request failed.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
