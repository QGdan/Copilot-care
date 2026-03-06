import { ConsentValidationService } from '../../application/services/ConsentValidationService';

describe('Architecture Smoke - consent token validation', () => {
  it('rejects missing token', () => {
    const service = new ConsentValidationService();
    const result = service.validate(undefined);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('ERR_MISSING_REQUIRED_DATA');
    expect(result.requiredFields).toEqual(expect.arrayContaining(['consentToken']));
  });

  it('rejects malformed token', () => {
    const service = new ConsentValidationService();
    const result = service.validate('bad-token');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('ERR_MISSING_REQUIRED_DATA');
  });

  it('accepts allowlisted token', () => {
    const service = new ConsentValidationService({
      COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST: 'consent_approved_token_001',
    });
    const result = service.validate('consent_approved_token_001');
    expect(result.ok).toBe(true);
  });

  it('rejects the demo token in production', () => {
    const service = new ConsentValidationService({
      NODE_ENV: 'production',
    });
    const result = service.validate('consent_local_demo');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('ERR_MISSING_REQUIRED_DATA');
  });

  it('accepts an explicitly allowlisted production token', () => {
    const service = new ConsentValidationService({
      NODE_ENV: 'production',
      COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST: 'consent_prod_token_001',
    });
    const result = service.validate('consent_prod_token_001');
    expect(result.ok).toBe(true);
  });
});
