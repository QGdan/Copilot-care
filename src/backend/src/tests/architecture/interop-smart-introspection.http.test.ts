import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { createBackendApp } from '../../bootstrap/createBackendApp';
import { createRuntime } from '../../bootstrap/createRuntime';

interface IntrospectionLogEntry {
  body: string;
  authorization?: string;
}

function buildEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'development',
    COPILOT_CARE_ENABLE_INTEROP: 'true',
    COPILOT_CARE_MED_SEARCH_ENABLED: 'false',
    COPILOT_CARE_MED_SEARCH_IN_TRIAGE: 'false',
    ...overrides,
  };
}

async function withBackendServer(
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
        server.close(() => reject(error));
      }
    });

    server.on('error', reject);
  });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload));
}

async function withIntrospectionServer(
  run: (url: string, logs: IntrospectionLogEntry[]) => Promise<void>,
): Promise<void> {
  const logs: IntrospectionLogEntry[] = [];
  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const rawBody = await readBody(request);
      logs.push({
        body: rawBody,
        authorization:
          typeof request.headers.authorization === 'string'
            ? request.headers.authorization
            : undefined,
      });
      const token = new URLSearchParams(rawBody).get('token') ?? '';
      const nowSeconds = Math.floor(Date.now() / 1000);

      if (token === 'smart-active') {
        writeJson(response, 200, {
          active: true,
          scope: 'user/Patient.read user/Observation.read user/Provenance.read',
          aud: 'copilot-care',
          iss: 'https://issuer.smart.local',
          exp: nowSeconds + 120,
        });
        return;
      }
      if (token === 'smart-inactive') {
        writeJson(response, 200, {
          active: false,
          scope: 'user/Patient.read user/Observation.read user/Provenance.read',
          aud: 'copilot-care',
          iss: 'https://issuer.smart.local',
          exp: nowSeconds + 120,
        });
        return;
      }
      if (token === 'smart-no-scope') {
        writeJson(response, 200, {
          active: true,
          scope: '',
          aud: 'copilot-care',
          iss: 'https://issuer.smart.local',
          exp: nowSeconds + 120,
        });
        return;
      }
      if (token === 'smart-wrong-audience') {
        writeJson(response, 200, {
          active: true,
          scope: 'user/Patient.read user/Observation.read user/Provenance.read',
          aud: 'other-audience',
          iss: 'https://issuer.smart.local',
          exp: nowSeconds + 120,
        });
        return;
      }
      writeJson(response, 200, {
        active: false,
        scope: '',
      });
    });

    server.listen(0, async () => {
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}/introspect`;
      try {
        await run(url, logs);
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      } catch (error) {
        server.close(() => reject(error));
      }
    });

    server.on('error', reject);
  });
}

function buildRequestBody(requestId: string, consentToken: string): Record<string, unknown> {
  return {
    requestId,
    consentToken,
    symptomText: 'dizziness with blood pressure fluctuations',
    profile: {
      patientId: requestId,
      age: 54,
      sex: 'female',
      symptoms: ['dizziness'],
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['amlodipine'],
      vitals: {
        systolicBP: 152,
        diastolicBP: 96,
      },
    },
  };
}

describe('Architecture Smoke - interop SMART introspection', () => {
  it('authorizes interop request via introspected SMART token scopes', async () => {
    await withIntrospectionServer(async (introspectionUrl, logs) => {
      const env = buildEnv({
        COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'true',
        COPILOT_CARE_SMART_INTROSPECTION_URL: introspectionUrl,
        COPILOT_CARE_SMART_REQUIRED_AUDIENCE: 'copilot-care',
        COPILOT_CARE_SMART_REQUIRED_ISSUER: 'https://issuer.smart.local',
        COPILOT_CARE_SMART_SCOPE_HEADER_FALLBACK: 'false',
      });

      await withBackendServer(env, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer smart-active',
            'content-type': 'application/json',
          },
          body: JSON.stringify(buildRequestBody('smart-introspect-ok-001', 'consent_local_demo')),
        });
        const payload = await response.json() as {
          draft?: boolean;
          triage?: { sessionId?: string };
        };

        expect(response.status).toBe(200);
        expect(payload.draft).toBe(true);
        expect(payload.triage?.sessionId).toBeTruthy();
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0]?.body).toContain('token=smart-active');
    });
  });

  it('rejects inactive token, empty scope and audience mismatch', async () => {
    await withIntrospectionServer(async (introspectionUrl) => {
      const env = buildEnv({
        COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'true',
        COPILOT_CARE_SMART_INTROSPECTION_URL: introspectionUrl,
        COPILOT_CARE_SMART_REQUIRED_AUDIENCE: 'copilot-care',
        COPILOT_CARE_SMART_SCOPE_HEADER_FALLBACK: 'false',
      });

      await withBackendServer(env, async (baseUrl) => {
        const inactiveResponse = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer smart-inactive',
            'content-type': 'application/json',
          },
          body: JSON.stringify(buildRequestBody('smart-introspect-deny-001', 'consent_local_demo')),
        });
        expect(inactiveResponse.status).toBe(403);

        const noScopeResponse = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer smart-no-scope',
            'content-type': 'application/json',
          },
          body: JSON.stringify(buildRequestBody('smart-introspect-deny-002', 'consent_local_demo')),
        });
        expect(noScopeResponse.status).toBe(403);

        const wrongAudienceResponse = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer smart-wrong-audience',
            'content-type': 'application/json',
          },
          body: JSON.stringify(buildRequestBody('smart-introspect-deny-003', 'consent_local_demo')),
        });
        expect(wrongAudienceResponse.status).toBe(403);
      });
    });
  });

  it('supports interop api key and separate SMART token header in production', async () => {
    await withIntrospectionServer(async (introspectionUrl) => {
      const env = buildEnv({
        NODE_ENV: 'production',
        COPILOT_CARE_ENABLE_INTEROP: 'true',
        COPILOT_CARE_INTEROP_API_KEY: 'interop_prod_key_001',
        COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST: 'consent_prod_token_001',
        COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'true',
        COPILOT_CARE_SMART_INTROSPECTION_URL: introspectionUrl,
        COPILOT_CARE_SMART_REQUIRED_AUDIENCE: 'copilot-care',
        COPILOT_CARE_SMART_REQUIRED_ISSUER: 'https://issuer.smart.local',
        COPILOT_CARE_SMART_SCOPE_HEADER_FALLBACK: 'false',
      });

      await withBackendServer(env, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer interop_prod_key_001',
            'x-smart-token': 'smart-active',
            'content-type': 'application/json',
          },
          body: JSON.stringify(buildRequestBody(
            'smart-introspect-prod-001',
            'consent_prod_token_001',
          )),
        });
        expect(response.status).toBe(200);
      });
    });
  });

  it('returns 503 when introspection is enabled without endpoint url', async () => {
    const env = buildEnv({
      COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'true',
      COPILOT_CARE_SMART_INTROSPECTION_URL: '',
    });

    await withBackendServer(env, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer smart-active',
          'x-smart-scope':
            'user/Patient.read user/Observation.read user/Provenance.read',
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildRequestBody('smart-introspect-misconfig-001', 'consent_local_demo')),
      });
      const payload = await response.json() as {
        issue?: Array<{ diagnostics?: string }>;
      };
      expect(response.status).toBe(503);
      expect(payload.issue?.[0]?.diagnostics).toContain('INTROSPECTION_URL');
    });
  });
});
