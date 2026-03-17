import { AddressInfo } from 'net';
import { createBackendApp } from '../../bootstrap/createBackendApp';
import { createRuntime } from '../../bootstrap/createRuntime';

function buildEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'development',
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

interface PatientCasesPayload {
  patientId: string;
  total: number;
  returned: number;
  cases: Array<{
    caseId: string;
    requestId?: string;
    patientId: string;
    status: string;
    reviewStatus?: string;
    summary: string;
    source: 'runtime' | 'review_queue' | 'merged';
    updatedAt: string;
  }>;
}

describe('Architecture Smoke - patient cases timeline http loop', () => {
  it('returns merged patient case timeline from runtime and review queue', async () => {
    const env = buildEnv({
      COPILOT_CARE_MED_SEARCH_ENABLED: 'false',
      COPILOT_CARE_MED_SEARCH_IN_TRIAGE: 'false',
    });

    await withServer(env, async (baseUrl) => {
      const successResponse = await fetch(`${baseUrl}/orchestrate_triage`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId: 'patient-cases-ok-001',
          consentToken: 'consent_local_demo',
          symptomText: 'headache with elevated blood pressure',
          profile: {
            patientId: 'patient-cases-001',
            age: 54,
            sex: 'male',
            symptoms: ['headache', 'chest tightness'],
            chronicDiseases: ['Hypertension'],
            medicationHistory: ['amlodipine'],
            vitals: {
              systolicBP: 162,
              diastolicBP: 102,
              heartRate: 92,
            },
          },
        }),
      });
      expect([200, 400]).toContain(successResponse.status);

      const errorResponse = await fetch(`${baseUrl}/orchestrate_triage`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId: 'patient-cases-err-001',
          profile: {
            patientId: 'patient-cases-001',
            age: 54,
            sex: 'male',
            symptoms: ['fatigue'],
          },
        }),
      });
      expect(errorResponse.status).toBe(400);

      const casesResponse = await fetch(
        `${baseUrl}/patients/patient-cases-001/cases?limit=20`,
      );
      const casesPayload = await casesResponse.json() as PatientCasesPayload;

      expect(casesResponse.status).toBe(200);
      expect(casesPayload.patientId).toBe('patient-cases-001');
      expect(casesPayload.total).toBeGreaterThan(0);
      expect(casesPayload.returned).toBe(casesPayload.cases.length);
      expect(casesPayload.returned).toBeLessThanOrEqual(20);
      expect(
        casesPayload.cases.every((item) => item.patientId === 'patient-cases-001'),
      ).toBe(true);
      expect(
        casesPayload.cases.some((item) => item.requestId === 'patient-cases-ok-001'),
      ).toBe(true);

      const reviewLinkedCase = casesPayload.cases.find(
        (item) => item.requestId === 'patient-cases-err-001',
      );
      expect(reviewLinkedCase).toBeDefined();
      expect(reviewLinkedCase?.status).toBe('ERROR');
      expect(reviewLinkedCase?.reviewStatus).toBeDefined();
      expect(typeof reviewLinkedCase?.summary).toBe('string');
      expect((reviewLinkedCase?.summary ?? '').length).toBeGreaterThan(0);
      expect(
        ['runtime', 'review_queue', 'merged'].includes(
          reviewLinkedCase?.source ?? '',
        ),
      ).toBe(true);
    });
  });

  it('returns empty list for patient without historical cases', async () => {
    const env = buildEnv();

    await withServer(env, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/patients/no-case-patient/cases`);
      const payload = await response.json() as PatientCasesPayload;

      expect(response.status).toBe(200);
      expect(payload.patientId).toBe('no-case-patient');
      expect(payload.total).toBe(0);
      expect(payload.returned).toBe(0);
      expect(payload.cases).toEqual([]);
    });
  });

  it('validates patient id and limit query for patient cases endpoint', async () => {
    const env = buildEnv();

    await withServer(env, async (baseUrl) => {
      const invalidPatientResponse = await fetch(`${baseUrl}/patients/%20/cases`);
      const invalidPatientPayload = await invalidPatientResponse.json() as {
        error?: string;
      };

      expect(invalidPatientResponse.status).toBe(400);
      expect(invalidPatientPayload.error).toBe('invalid_patient_id');

      const invalidLimitResponse = await fetch(
        `${baseUrl}/patients/patient-cases-001/cases?limit=0`,
      );
      const invalidLimitPayload = await invalidLimitResponse.json() as {
        error?: string;
      };

      expect(invalidLimitResponse.status).toBe(400);
      expect(invalidLimitPayload.error).toBe('invalid_limit');
    });
  });
});
