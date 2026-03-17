import fs from 'node:fs';
import path from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { createBackendApp } from '../../bootstrap/createBackendApp';
import { createRuntime } from '../../bootstrap/createRuntime';

function buildEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'development',
    COPILOT_CARE_ENABLE_INTEROP: 'true',
    COPILOT_CARE_MED_SEARCH_ENABLED: 'false',
    COPILOT_CARE_MED_SEARCH_IN_TRIAGE: 'false',
    COPILOT_CARE_INTEROP_JOB_SIMULATION: 'none',
    ...overrides,
  };
}

function createAuditLogFilePath(testId: string): string {
  return path.resolve(
    'reports/runtime',
    `interop-writeback.audit.${testId}.${Date.now()}.jsonl`,
  );
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
        server.close(() => reject(error));
      }
    });

    server.on('error', reject);
  });
}

interface UpstreamCapture {
  baseUrl: string;
  requests: Array<{
    url: string;
    method: string;
    authorization?: string;
    body: Record<string, unknown> | null;
  }>;
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown> | null> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
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

async function withUpstreamServer(
  statuses: number[],
  run: (capture: UpstreamCapture) => Promise<void>,
): Promise<void> {
  const capture: UpstreamCapture = {
    baseUrl: '',
    requests: [],
  };

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const body = await readJsonBody(request);
      capture.requests.push({
        url: request.url ?? '',
        method: request.method ?? 'GET',
        authorization:
          typeof request.headers.authorization === 'string'
            ? request.headers.authorization
            : undefined,
        body,
      });

      const attempt = capture.requests.length;
      const statusCode = statuses[Math.min(attempt - 1, statuses.length - 1)] ?? 201;
      if (statusCode >= 200 && statusCode < 300) {
        writeJson(response, statusCode, {
          resourceType: 'Bundle',
          id: `upstream-bundle-${attempt}`,
        });
        return;
      }

      writeJson(response, statusCode, {
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: statusCode >= 500 ? 'exception' : 'processing',
            diagnostics: `Simulated upstream status ${statusCode}`,
          },
        ],
      });
    });

    server.listen(0, async () => {
      const address = server.address() as AddressInfo;
      capture.baseUrl = `http://127.0.0.1:${address.port}`;
      try {
        await run(capture);
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

async function waitForTerminalJob(
  baseUrl: string,
  jobId: string,
  maxAttempts: number = 60,
  intervalMs: number = 50,
): Promise<{
  job: {
    status: string;
    attempts: number;
    history: Array<{ errorCode?: string; status: string }>;
    result?: {
      triageStatus: string;
      resourceCounts: {
        patient: number;
        observation: number;
        provenance: number;
      };
    };
  };
  terminal: boolean;
}> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`${baseUrl}/interop/jobs/${jobId}`);
    const payload = await response.json() as {
      job: {
        status: string;
        attempts: number;
        history: Array<{ errorCode?: string; status: string }>;
        result?: {
          triageStatus: string;
          resourceCounts: {
            patient: number;
            observation: number;
            provenance: number;
          };
        };
      };
      terminal: boolean;
    };

    if (response.status === 200 && payload.terminal) {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`interop job ${jobId} did not reach terminal status in time`);
}

function buildSubmitBody(requestId: string): Record<string, unknown> {
  return {
    requestId,
    consentToken: 'consent_local_demo',
    symptomText: 'dizziness with blood pressure fluctuations',
    profile: {
      patientId: requestId,
      age: 52,
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

function readAuditLog(filePath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('Architecture Smoke - interop real writeback mode', () => {
  it('submits real-mode writeback and records audit trail', async () => {
    await withUpstreamServer([201], async (upstream) => {
      const auditLogFile = createAuditLogFilePath('real-success');
      try {
        const env = buildEnv({
          COPILOT_CARE_INTEROP_WRITEBACK_MODE: 'real',
          COPILOT_CARE_INTEROP_FHIR_BASE_URL: upstream.baseUrl,
          COPILOT_CARE_INTEROP_FHIR_BUNDLE_PATH: '/Bundle',
          COPILOT_CARE_INTEROP_FHIR_AUTH_TOKEN: 'interop-upstream-token',
          COPILOT_CARE_INTEROP_AUDIT_LOG_FILE: auditLogFile,
          COPILOT_CARE_INTEROP_JOB_MAX_RETRIES: '2',
          COPILOT_CARE_INTEROP_JOB_RETRY_DELAY_MS: '40',
        });

        await withServer(env, async (baseUrl) => {
          const submitResponse = await fetch(
            `${baseUrl}/interop/fhir/triage-bundle/submit`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-smart-scope':
                  'user/Patient.read user/Observation.read user/Provenance.read',
              },
              body: JSON.stringify(buildSubmitBody('interop-real-success-001')),
            },
          );
          const submitPayload = await submitResponse.json() as {
            writeback?: { mode: string };
            job: { jobId: string };
          };
          expect(submitResponse.status).toBe(202);
          expect(submitPayload.writeback?.mode).toBe('real');

          const terminalPayload = await waitForTerminalJob(
            baseUrl,
            submitPayload.job.jobId,
          );
          expect(terminalPayload.job.status).toBe('succeeded');
          expect(terminalPayload.job.attempts).toBe(1);
          expect(terminalPayload.job.result?.resourceCounts.patient).toBe(1);
        });

        expect(upstream.requests.length).toBe(1);
        expect(upstream.requests[0]?.method).toBe('POST');
        expect(upstream.requests[0]?.url).toBe('/Bundle');
        expect(upstream.requests[0]?.authorization).toBe(
          'Bearer interop-upstream-token',
        );
        expect(upstream.requests[0]?.body?.resourceType).toBe('Bundle');

        const auditLogs = readAuditLog(auditLogFile);
        expect(auditLogs.some((item) => item.status === 'attempt_started')).toBe(true);
        expect(auditLogs.some((item) => item.status === 'attempt_succeeded')).toBe(true);
        expect(auditLogs.some((item) => item.status === 'job_succeeded')).toBe(true);
        expect(
          auditLogs.some((item) => {
            const context = item.context as Record<string, unknown> | undefined;
            return context?.mode === 'real';
          }),
        ).toBe(true);
      } finally {
        if (fs.existsSync(auditLogFile)) {
          fs.unlinkSync(auditLogFile);
        }
      }
    });
  });

  it('retries real-mode writeback on transient upstream failure', async () => {
    await withUpstreamServer([503, 201], async (upstream) => {
      const auditLogFile = createAuditLogFilePath('real-retry');
      try {
        const env = buildEnv({
          COPILOT_CARE_INTEROP_WRITEBACK_MODE: 'real',
          COPILOT_CARE_INTEROP_FHIR_BASE_URL: upstream.baseUrl,
          COPILOT_CARE_INTEROP_FHIR_BUNDLE_PATH: '/Bundle',
          COPILOT_CARE_INTEROP_AUDIT_LOG_FILE: auditLogFile,
          COPILOT_CARE_INTEROP_JOB_MAX_RETRIES: '2',
          COPILOT_CARE_INTEROP_JOB_RETRY_DELAY_MS: '30',
        });

        await withServer(env, async (baseUrl) => {
          const submitResponse = await fetch(
            `${baseUrl}/interop/fhir/triage-bundle/submit`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-smart-scope':
                  'user/Patient.read user/Observation.read user/Provenance.read',
              },
              body: JSON.stringify({
                ...buildSubmitBody('interop-real-retry-001'),
                retryPolicy: {
                  maxRetries: 2,
                  retryDelayMs: 60,
                  retryableErrorCodes: ['INTEROP_UPSTREAM_UNAVAILABLE'],
                },
              }),
            },
          );
          const submitPayload = await submitResponse.json() as {
            job: { jobId: string };
          };
          expect(submitResponse.status).toBe(202);

          const terminalPayload = await waitForTerminalJob(
            baseUrl,
            submitPayload.job.jobId,
          );
          expect(terminalPayload.job.status).toBe('succeeded');
          expect(terminalPayload.job.attempts).toBe(2);
          expect(terminalPayload.job.history[0]?.status).toBe('failed');
          expect(terminalPayload.job.history[0]?.errorCode).toBe(
            'INTEROP_UPSTREAM_UNAVAILABLE',
          );
        });

        expect(upstream.requests.length).toBe(2);
        const auditLogs = readAuditLog(auditLogFile);
        expect(auditLogs.some((item) => item.status === 'retry_scheduled')).toBe(true);
      } finally {
        if (fs.existsSync(auditLogFile)) {
          fs.unlinkSync(auditLogFile);
        }
      }
    });
  });

  it('returns 503 when real writeback mode is enabled without target base url', async () => {
    const env = buildEnv({
      COPILOT_CARE_INTEROP_WRITEBACK_MODE: 'real',
      COPILOT_CARE_INTEROP_FHIR_BASE_URL: '',
    });

    await withServer(env, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/interop/fhir/triage-bundle/submit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-smart-scope':
            'user/Patient.read user/Observation.read user/Provenance.read',
        },
        body: JSON.stringify(buildSubmitBody('interop-real-missing-target-001')),
      });
      const payload = await response.json() as {
        issue?: Array<{ diagnostics?: string }>;
      };

      expect(response.status).toBe(503);
      expect(payload.issue?.[0]?.diagnostics).toContain('FHIR_BASE_URL');
    });
  });
});
