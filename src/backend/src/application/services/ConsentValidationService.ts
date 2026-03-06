import { ErrorCode } from '@copilot-care/shared/types';
import {
  DEMO_CONSENT_TOKEN,
  resolveBackendExposurePolicy,
} from '../../config/runtimePolicy';

export interface ConsentValidationResult {
  ok: boolean;
  errorCode?: ErrorCode;
  message?: string;
  requiredFields?: string[];
}

function parseAllowlist(envValue: string | undefined): string[] {
  if (!envValue) {
    return [];
  }
  return envValue
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isFormatValid(token: string): boolean {
  if (!token.startsWith('consent_')) {
    return false;
  }
  return /^[a-zA-Z0-9_.:-]{12,}$/.test(token);
}

export class ConsentValidationService {
  private readonly allowlist: Set<string>;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const policy = resolveBackendExposurePolicy(env);
    const defaults = policy.allowDemoConsentToken ? [DEMO_CONSENT_TOKEN] : [];
    const configured = parseAllowlist(
      env.COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST,
    ).filter((token) => {
      return policy.allowDemoConsentToken || token !== DEMO_CONSENT_TOKEN;
    });

    this.allowlist = new Set([...defaults, ...configured]);
  }

  public validate(consentToken: string | undefined): ConsentValidationResult {
    const token = typeof consentToken === 'string' ? consentToken.trim() : '';
    if (!token) {
      return {
        ok: false,
        errorCode: 'ERR_MISSING_REQUIRED_DATA',
        message: 'Missing consentToken.',
        requiredFields: ['consentToken'],
      };
    }

    if (!isFormatValid(token)) {
      return {
        ok: false,
        errorCode: 'ERR_MISSING_REQUIRED_DATA',
        message: 'Invalid consentToken format.',
        requiredFields: ['consentToken'],
      };
    }

    if (!this.allowlist.has(token)) {
      return {
        ok: false,
        errorCode: 'ERR_MISSING_REQUIRED_DATA',
        message: 'consentToken is not authorized.',
        requiredFields: ['consentToken'],
      };
    }

    return { ok: true };
  }
}
