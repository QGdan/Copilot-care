import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { SmartTokenIntrospectionService } from '../SmartTokenIntrospectionService';

interface IntrospectionRequestLog {
  body: string;
  authorization?: string;
}

async function readRawBody(request: IncomingMessage): Promise<string> {
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
  handler: (
    token: string,
    request: IncomingMessage,
    response: ServerResponse,
  ) => void,
  run: (url: string, logs: IntrospectionRequestLog[]) => Promise<void>,
): Promise<void> {
  const logs: IntrospectionRequestLog[] = [];
  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const rawBody = await readRawBody(request);
      logs.push({
        body: rawBody,
        authorization:
          typeof request.headers.authorization === 'string'
            ? request.headers.authorization
            : undefined,
      });
      const params = new URLSearchParams(rawBody);
      const token = params.get('token') ?? '';
      handler(token, request, response);
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

describe('SmartTokenIntrospectionService', () => {
  it('uses scope header when introspection is disabled', async () => {
    const service = new SmartTokenIntrospectionService({
      COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'false',
    });

    const resolved = await service.resolveScope({
      scopeHeader: 'user/Patient.read user/Observation.read',
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.source).toBe('scope_header');
    expect(resolved.scope).toContain('Patient.read');
  });

  it('returns configuration error when introspection is enabled without url', async () => {
    const service = new SmartTokenIntrospectionService({
      COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'true',
    });

    const resolved = await service.resolveScope({
      token: 'token-001',
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.statusCode).toBe(503);
    expect(resolved.diagnostics).toContain('INTROSPECTION_URL');
  });

  it('accepts active token and returns introspected scope', async () => {
    await withIntrospectionServer(
      (token, _request, response) => {
        if (token !== 'token-pass') {
          writeJson(response, 200, { active: false });
          return;
        }
        writeJson(response, 200, {
          active: true,
          scope: 'user/Patient.read user/Observation.read user/Provenance.read',
          aud: 'copilot-care',
          iss: 'https://issuer.example',
          exp: Math.floor(Date.now() / 1000) + 300,
        });
      },
      async (url, logs) => {
        const service = new SmartTokenIntrospectionService({
          COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'true',
          COPILOT_CARE_SMART_INTROSPECTION_URL: url,
          COPILOT_CARE_SMART_REQUIRED_AUDIENCE: 'copilot-care',
          COPILOT_CARE_SMART_REQUIRED_ISSUER: 'https://issuer.example',
          COPILOT_CARE_SMART_INTROSPECTION_CLIENT_ID: 'client',
          COPILOT_CARE_SMART_INTROSPECTION_CLIENT_SECRET: 'secret',
          COPILOT_CARE_SMART_INTROSPECTION_CACHE_TTL_MS: '0',
        });

        const resolved = await service.resolveScope({
          token: 'Bearer token-pass',
        });
        expect(resolved.ok).toBe(true);
        expect(resolved.source).toBe('introspection');
        expect(resolved.scope).toContain('Provenance.read');
        expect(logs.length).toBe(1);
        expect(logs[0]?.authorization?.startsWith('Basic ')).toBe(true);
      },
    );
  });

  it('rejects inactive token and audience mismatch', async () => {
    await withIntrospectionServer(
      (token, _request, response) => {
        if (token === 'token-inactive') {
          writeJson(response, 200, {
            active: false,
            scope: 'user/Patient.read',
          });
          return;
        }
        writeJson(response, 200, {
          active: true,
          scope: 'user/Patient.read',
          aud: 'wrong-audience',
          exp: Math.floor(Date.now() / 1000) + 300,
        });
      },
      async (url) => {
        const service = new SmartTokenIntrospectionService({
          COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'true',
          COPILOT_CARE_SMART_INTROSPECTION_URL: url,
          COPILOT_CARE_SMART_REQUIRED_AUDIENCE: 'copilot-care',
          COPILOT_CARE_SMART_INTROSPECTION_CACHE_TTL_MS: '0',
        });

        const inactive = await service.resolveScope({
          token: 'token-inactive',
        });
        expect(inactive.ok).toBe(false);
        expect(inactive.statusCode).toBe(403);
        expect(inactive.diagnostics).toContain('inactive');

        const wrongAudience = await service.resolveScope({
          token: 'token-wrong-audience',
        });
        expect(wrongAudience.ok).toBe(false);
        expect(wrongAudience.statusCode).toBe(403);
        expect(wrongAudience.diagnostics).toContain('audience');
      },
    );
  });

  it('supports optional scope-header fallback when introspection scope is empty', async () => {
    await withIntrospectionServer(
      (_token, _request, response) => {
        writeJson(response, 200, {
          active: true,
          scope: '',
          exp: Math.floor(Date.now() / 1000) + 300,
        });
      },
      async (url) => {
        const withFallback = new SmartTokenIntrospectionService({
          COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'true',
          COPILOT_CARE_SMART_INTROSPECTION_URL: url,
          COPILOT_CARE_SMART_SCOPE_HEADER_FALLBACK: 'true',
          COPILOT_CARE_SMART_INTROSPECTION_CACHE_TTL_MS: '0',
        });
        const resolved = await withFallback.resolveScope({
          token: 'token-fallback',
          scopeHeader: 'user/Patient.read',
        });
        expect(resolved.ok).toBe(true);
        expect(resolved.source).toBe('scope_header');

        const withoutFallback = new SmartTokenIntrospectionService({
          COPILOT_CARE_SMART_INTROSPECTION_ENABLED: 'true',
          COPILOT_CARE_SMART_INTROSPECTION_URL: url,
          COPILOT_CARE_SMART_SCOPE_HEADER_FALLBACK: 'false',
          COPILOT_CARE_SMART_INTROSPECTION_CACHE_TTL_MS: '0',
        });
        const denied = await withoutFallback.resolveScope({
          token: 'token-fallback',
          scopeHeader: 'user/Patient.read',
        });
        expect(denied.ok).toBe(false);
        expect(denied.statusCode).toBe(403);
        expect(denied.diagnostics).toContain('scope');
      },
    );
  });
});
