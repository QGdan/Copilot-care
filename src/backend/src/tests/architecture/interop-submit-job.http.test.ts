import { AddressInfo } from 'net';
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
    history: Array<{
      attempt: number;
      status: string;
      errorCode?: string;
      retriable?: boolean;
    }>;
    lastErrorCode?: string;
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
        history: Array<{
          attempt: number;
          status: string;
          errorCode?: string;
          retriable?: boolean;
        }>;
        lastErrorCode?: string;
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

function buildSubmitBody(requestId: string, patientId: string): Record<string, unknown> {
  return {
    requestId,
    consentToken: 'consent_local_demo',
    symptomText: 'dizziness with blood pressure fluctuations',
    profile: {
      patientId,
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

describe('Architecture Smoke - interop submit job async loop', () => {
  it('submits writeback job and reaches succeeded status', async () => {
    const env = buildEnv({
      COPILOT_CARE_INTEROP_JOB_MAX_RETRIES: '2',
      COPILOT_CARE_INTEROP_JOB_RETRY_DELAY_MS: '60',
      COPILOT_CARE_INTEROP_JOB_SIMULATION: 'none',
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
          body: JSON.stringify(buildSubmitBody(
            'interop-submit-success-001',
            'interop-submit-success-001',
          )),
        },
      );
      const submitPayload = await submitResponse.json() as {
        accepted: boolean;
        job: {
          jobId: string;
          status: string;
          retryPolicy: { maxRetries: number; retryDelayMs: number };
        };
      };

      expect(submitResponse.status).toBe(202);
      expect(submitPayload.accepted).toBe(true);
      expect(submitPayload.job.jobId).toBeTruthy();
      expect(['queued', 'running']).toContain(submitPayload.job.status);

      const terminalPayload = await waitForTerminalJob(
        baseUrl,
        submitPayload.job.jobId,
      );
      expect(terminalPayload.job.status).toBe('succeeded');
      expect(terminalPayload.job.attempts).toBe(1);
      expect(terminalPayload.job.result?.triageStatus).toBeTruthy();
      expect(terminalPayload.job.result?.resourceCounts.patient).toBe(1);
      expect(
        (terminalPayload.job.result?.resourceCounts.observation ?? 0) >= 1,
      ).toBe(true);
      expect(
        (terminalPayload.job.result?.resourceCounts.provenance ?? 0) >= 1,
      ).toBe(true);
    });
  });

  it('retries transient failure and eventually succeeds', async () => {
    const env = buildEnv({
      COPILOT_CARE_INTEROP_JOB_MAX_RETRIES: '2',
      COPILOT_CARE_INTEROP_JOB_RETRY_DELAY_MS: '40',
      COPILOT_CARE_INTEROP_JOB_SIMULATION: 'fail_once',
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
            ...buildSubmitBody('interop-submit-retry-001', 'interop-submit-retry-001'),
            retryPolicy: {
              maxRetries: 2,
              retryDelayMs: 60,
              retryableErrorCodes: ['INTEROP_UPSTREAM_TIMEOUT'],
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
        'INTEROP_UPSTREAM_TIMEOUT',
      );
      expect(terminalPayload.job.history[0]?.retriable).toBe(true);
      expect(terminalPayload.job.history[1]?.status).toBe('succeeded');
    });
  });

  it('fails after retry budget is exhausted and validates input/not-found', async () => {
    const env = buildEnv({
      COPILOT_CARE_INTEROP_JOB_MAX_RETRIES: '1',
      COPILOT_CARE_INTEROP_JOB_RETRY_DELAY_MS: '30',
      COPILOT_CARE_INTEROP_JOB_SIMULATION: 'fail_always',
    });

    await withServer(env, async (baseUrl) => {
      const invalidPolicyResponse = await fetch(
        `${baseUrl}/interop/fhir/triage-bundle/submit`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-smart-scope':
              'user/Patient.read user/Observation.read user/Provenance.read',
          },
          body: JSON.stringify({
            ...buildSubmitBody('interop-submit-invalid-001', 'interop-submit-invalid-001'),
            retryPolicy: {
              maxRetries: -1,
            },
          }),
        },
      );
      expect(invalidPolicyResponse.status).toBe(400);

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
            ...buildSubmitBody('interop-submit-fail-001', 'interop-submit-fail-001'),
            retryPolicy: {
              maxRetries: 1,
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
      expect(terminalPayload.job.status).toBe('failed');
      expect(terminalPayload.job.attempts).toBe(2);
      expect(terminalPayload.job.lastErrorCode).toBe(
        'INTEROP_UPSTREAM_UNAVAILABLE',
      );
      expect(terminalPayload.job.history[0]?.status).toBe('failed');
      expect(terminalPayload.job.history[1]?.status).toBe('failed');

      const notFoundResponse = await fetch(
        `${baseUrl}/interop/jobs/not-exists-job-id`,
      );
      expect(notFoundResponse.status).toBe(404);
    });
  });
});
