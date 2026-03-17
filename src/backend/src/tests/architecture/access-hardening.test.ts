import { AddressInfo } from 'net';
import { createBackendApp } from '../../bootstrap/createBackendApp';
import { createRuntime } from '../../bootstrap/createRuntime';

function buildEnv(
  overrides: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...overrides,
  };
}

async function withServer(
  env: NodeJS.ProcessEnv,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const runtime = createRuntime(env);
  const app = createBackendApp(runtime, env);

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(0, async () => {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        await run(baseUrl);
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      } catch (error) {
        server.close(() => {
          reject(error);
        });
      }
    });

    server.on('error', reject);
  });
}

describe('Architecture Hardening - runtime exposure policy', () => {
  it('disables FHIR interop by default in production', async () => {
    const env = buildEnv({
      NODE_ENV: 'production',
    });

    await withServer(env, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-smart-scope':
            'user/Patient.read user/Observation.read user/Provenance.read',
        },
        body: JSON.stringify({
          requestId: 'interop-disabled-prod-001',
          consentToken: 'consent_prod_token_001',
          symptomText: 'dizziness',
          profile: {
            patientId: 'interop-disabled-prod-001',
            age: 55,
            sex: 'female',
            symptoms: ['dizziness'],
          },
        }),
      });
      const payload = await response.json() as {
        resourceType?: string;
        issue?: Array<{ diagnostics?: string }>;
      };

      expect(response.status).toBe(404);
      expect(payload.resourceType).toBe('OperationOutcome');
      expect(payload.issue?.[0]?.diagnostics).toContain('disabled');
    });
  });

  it('disables MCP mock endpoints by default in production', async () => {
    const env = buildEnv({
      NODE_ENV: 'production',
    });

    await withServer(env, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp/health`);
      const payload = await response.json() as {
        error?: string;
        message?: string;
      };

      expect(response.status).toBe(404);
      expect(payload.error).toBe('mcp_disabled');
      expect(payload.message).toContain('disabled');
    });
  });

  it('requires a bearer token when FHIR interop is enabled in production', async () => {
    const env = buildEnv({
      NODE_ENV: 'production',
      COPILOT_CARE_ENABLE_INTEROP: 'true',
      COPILOT_CARE_INTEROP_API_KEY: 'interop_secret_001',
      COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST: 'consent_prod_token_001',
      COPILOT_CARE_MED_SEARCH_ENABLED: 'false',
      COPILOT_CARE_MED_SEARCH_IN_TRIAGE: 'false',
    });

    await withServer(env, async (baseUrl) => {
      const deniedResponse = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-smart-scope':
            'user/Patient.read user/Observation.read user/Provenance.read',
        },
        body: JSON.stringify({
          requestId: 'interop-prod-auth-001',
          consentToken: 'consent_prod_token_001',
          symptomText: 'mild fatigue',
          profile: {
            patientId: 'interop-prod-auth-001',
            age: 35,
            sex: 'female',
            symptoms: ['fatigue'],
          },
        }),
      });
      expect(deniedResponse.status).toBe(401);

      const deniedSubmitResponse = await fetch(
        `${baseUrl}/interop/fhir/triage-bundle/submit`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-smart-scope':
              'user/Patient.read user/Observation.read user/Provenance.read',
          },
          body: JSON.stringify({
            requestId: 'interop-prod-submit-001',
            consentToken: 'consent_prod_token_001',
            symptomText: 'mild fatigue',
            profile: {
              patientId: 'interop-prod-submit-001',
              age: 35,
              sex: 'female',
              symptoms: ['fatigue'],
            },
          }),
        },
      );
      expect(deniedSubmitResponse.status).toBe(401);

      const allowedResponse = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer interop_secret_001',
          'content-type': 'application/json',
          'x-smart-scope':
            'user/Patient.read user/Observation.read user/Provenance.read',
        },
        body: JSON.stringify({
          requestId: 'interop-prod-auth-002',
          consentToken: 'consent_prod_token_001',
          symptomText: 'mild fatigue',
          profile: {
            patientId: 'interop-prod-auth-002',
            age: 35,
            sex: 'female',
            symptoms: ['fatigue'],
            chronicDiseases: ['Iron deficiency'],
            medicationHistory: ['Ferrous sulfate'],
            vitals: {
              systolicBP: 118,
              diastolicBP: 74,
            },
          },
        }),
      });
      const payload = await allowedResponse.json() as { draft?: boolean };

      expect(allowedResponse.status).toBe(200);
      expect(payload.draft).toBe(true);

      const allowedSubmitResponse = await fetch(
        `${baseUrl}/interop/fhir/triage-bundle/submit`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer interop_secret_001',
            'content-type': 'application/json',
            'x-smart-scope':
              'user/Patient.read user/Observation.read user/Provenance.read',
          },
          body: JSON.stringify({
            requestId: 'interop-prod-submit-002',
            consentToken: 'consent_prod_token_001',
            symptomText: 'mild fatigue',
            profile: {
              patientId: 'interop-prod-submit-002',
              age: 35,
              sex: 'female',
              symptoms: ['fatigue'],
              chronicDiseases: ['Iron deficiency'],
              medicationHistory: ['Ferrous sulfate'],
              vitals: {
                systolicBP: 118,
                diastolicBP: 74,
              },
            },
          }),
        },
      );
      const submitPayload = await allowedSubmitResponse.json() as {
        job?: { jobId?: string };
      };
      expect(allowedSubmitResponse.status).toBe(202);
      expect(submitPayload.job?.jobId).toBeTruthy();

      const deniedJobResponse = await fetch(
        `${baseUrl}/interop/jobs/${submitPayload.job?.jobId}`,
      );
      expect(deniedJobResponse.status).toBe(401);

      const allowedJobResponse = await fetch(
        `${baseUrl}/interop/jobs/${submitPayload.job?.jobId}`,
        {
          headers: {
            authorization: 'Bearer interop_secret_001',
          },
        },
      );
      expect(allowedJobResponse.status).toBe(200);
    });
  }, 15000);

  it('requires a bearer token when MCP is enabled in production', async () => {
    const env = buildEnv({
      NODE_ENV: 'production',
      COPILOT_CARE_ENABLE_MCP: 'true',
      COPILOT_CARE_MCP_API_KEY: 'mcp_secret_001',
    });

    await withServer(env, async (baseUrl) => {
      const deniedResponse = await fetch(`${baseUrl}/mcp/health`);
      expect(deniedResponse.status).toBe(401);

      const allowedResponse = await fetch(`${baseUrl}/mcp/health`, {
        headers: {
          authorization: 'Bearer mcp_secret_001',
        },
      });
      const payload = await allowedResponse.json() as {
        status?: string;
      };

      expect(allowedResponse.status).toBe(200);
      expect(payload.status).toBe('ok');
    });
  });

  it('blocks triage routes in production when auth is required but no key is configured', async () => {
    const env = buildEnv({
      NODE_ENV: 'production',
      COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST: 'consent_prod_token_001',
    });

    await withServer(env, async (baseUrl) => {
      const triageResponse = await fetch(`${baseUrl}/orchestrate_triage`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId: 'triage-auth-misconfig-001',
          consentToken: 'consent_prod_token_001',
          profile: {
            patientId: 'triage-auth-misconfig-001',
            age: 42,
            sex: 'female',
            symptoms: ['fatigue'],
            chronicDiseases: ['Hypertension'],
            medicationHistory: ['amlodipine'],
          },
        }),
      });
      const triagePayload = await triageResponse.json() as {
        error?: string;
      };
      expect(triageResponse.status).toBe(503);
      expect(triagePayload.error).toBe('triage_misconfigured');

      const governanceResponse = await fetch(`${baseUrl}/governance/runtime`);
      const governancePayload = await governanceResponse.json() as {
        error?: string;
      };
      expect(governanceResponse.status).toBe(503);
      expect(governancePayload.error).toBe('triage_misconfigured');

      const patientCasesResponse = await fetch(
        `${baseUrl}/patients/triage-auth-misconfig-001/cases`,
      );
      const patientCasesPayload = await patientCasesResponse.json() as {
        error?: string;
      };
      expect(patientCasesResponse.status).toBe(503);
      expect(patientCasesPayload.error).toBe('triage_misconfigured');
    });
  });

  it('requires bearer token for triage routes when production auth key is configured', async () => {
    const env = buildEnv({
      NODE_ENV: 'production',
      COPILOT_CARE_TRIAGE_API_KEY: 'triage_secret_001',
      COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST: 'consent_prod_token_001',
    });

    await withServer(env, async (baseUrl) => {
      const deniedResponse = await fetch(`${baseUrl}/orchestrate_triage`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId: 'triage-auth-001',
          consentToken: 'consent_prod_token_001',
          profile: {
            patientId: 'triage-auth-001',
            age: 42,
            sex: 'female',
            symptoms: ['fatigue'],
            chronicDiseases: ['Hypertension'],
            medicationHistory: ['amlodipine'],
          },
        }),
      });
      expect(deniedResponse.status).toBe(401);

      const allowedResponse = await fetch(`${baseUrl}/orchestrate_triage`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer triage_secret_001',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId: 'triage-auth-002',
          consentToken: 'consent_prod_token_001',
          symptomText: 'fatigue',
          profile: {
            patientId: 'triage-auth-002',
            age: 42,
            sex: 'female',
            symptoms: ['fatigue'],
            chronicDiseases: ['Hypertension'],
            medicationHistory: ['amlodipine'],
          },
        }),
      });
      const allowedPayload = await allowedResponse.json() as {
        status?: string;
        errorCode?: string;
      };

      expect([200, 400]).toContain(allowedResponse.status);
      if (allowedResponse.status === 200) {
        expect(typeof allowedPayload.status).toBe('string');
      } else {
        expect(typeof allowedPayload.errorCode).toBe('string');
      }

      const governanceDenied = await fetch(`${baseUrl}/governance/runtime`);
      expect(governanceDenied.status).toBe(401);

      const governanceAllowed = await fetch(`${baseUrl}/governance/runtime`, {
        headers: {
          authorization: 'Bearer triage_secret_001',
        },
      });
      expect(governanceAllowed.status).toBe(200);

      const patientCasesDenied = await fetch(
        `${baseUrl}/patients/triage-auth-002/cases`,
      );
      expect(patientCasesDenied.status).toBe(401);

      const patientCasesAllowed = await fetch(
        `${baseUrl}/patients/triage-auth-002/cases`,
        {
          headers: {
            authorization: 'Bearer triage_secret_001',
          },
        },
      );
      expect(patientCasesAllowed.status).toBe(200);
    });
  });

  it('only emits CORS headers for allowlisted production origins', async () => {
    const env = buildEnv({
      NODE_ENV: 'production',
      COPILOT_CARE_CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    });

    await withServer(env, async (baseUrl) => {
      const allowedResponse = await fetch(`${baseUrl}/health`, {
        headers: {
          origin: 'https://app.example.com',
        },
      });
      expect(allowedResponse.headers.get('access-control-allow-origin')).toBe(
        'https://app.example.com',
      );

      const deniedResponse = await fetch(`${baseUrl}/health`, {
        headers: {
          origin: 'https://evil.example.com',
        },
      });
      expect(deniedResponse.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
