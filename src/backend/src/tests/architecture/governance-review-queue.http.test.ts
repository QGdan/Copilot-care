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

describe('Architecture Smoke - governance review queue http loop', () => {
  it('records triage error cases and supports decision writeback', async () => {
    const env = buildEnv({
      COPILOT_CARE_MED_SEARCH_ENABLED: 'false',
      COPILOT_CARE_MED_SEARCH_IN_TRIAGE: 'false',
    });

    await withServer(env, async (baseUrl) => {
      const triageResponse = await fetch(`${baseUrl}/orchestrate_triage`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId: 'review-queue-http-001',
          symptomText: 'fatigue',
          profile: {
            patientId: 'review-queue-http-001',
            age: 53,
            sex: 'female',
            symptoms: ['fatigue'],
            chronicDiseases: ['Hypertension'],
            medicationHistory: ['amlodipine'],
          },
        }),
      });

      expect(triageResponse.status).toBe(400);

      const queueResponse = await fetch(`${baseUrl}/governance/review-queue`);
      const queuePayload = await queueResponse.json() as {
        total: number;
        queueOverview: {
          pending: number;
          reviewing: number;
          approved: number;
          rejected: number;
        };
        cases: Array<{
          caseId: string;
          requestId?: string;
          triggerOutcome: string;
          status: string;
        }>;
      };

      expect(queueResponse.status).toBe(200);
      expect(queuePayload.total).toBeGreaterThan(0);
      expect(queuePayload.queueOverview.pending).toBeGreaterThan(0);

      const createdCase = queuePayload.cases.find(
        (item) => item.requestId === 'review-queue-http-001',
      );
      expect(createdCase).toBeDefined();
      expect(createdCase?.triggerOutcome).toBe('ERROR');
      expect(createdCase?.status).toBe('pending');

      const decisionResponse = await fetch(
        `${baseUrl}/governance/review-queue/${createdCase?.caseId}/decision`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            decision: 'approve',
            reviewerId: 'doctor-a',
            note: 'Approved after missing records were supplemented',
          }),
        },
      );
      const decisionPayload = await decisionResponse.json() as {
        case: {
          caseId: string;
          status: string;
          decision?: {
            decision: string;
            reviewerId?: string;
            note?: string;
          };
        };
      };

      expect(decisionResponse.status).toBe(200);
      expect(decisionPayload.case.caseId).toBe(createdCase?.caseId);
      expect(decisionPayload.case.status).toBe('approved');
      expect(decisionPayload.case.decision?.decision).toBe('approve');
      expect(decisionPayload.case.decision?.reviewerId).toBe('doctor-a');

      const approvedOnlyResponse = await fetch(
        `${baseUrl}/governance/review-queue?status=approved`,
      );
      const approvedOnlyPayload = await approvedOnlyResponse.json() as {
        cases: Array<{ caseId: string; status: string }>;
      };
      expect(approvedOnlyResponse.status).toBe(200);
      expect(
        approvedOnlyPayload.cases.some(
          (item) => item.caseId === createdCase?.caseId && item.status === 'approved',
        ),
      ).toBe(true);
    });
  });

  it('validates decision input and not-found cases', async () => {
    const env = buildEnv();

    await withServer(env, async (baseUrl) => {
      const invalidDecisionResponse = await fetch(
        `${baseUrl}/governance/review-queue/fake-case/decision`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            decision: 'invalid',
          }),
        },
      );
      expect(invalidDecisionResponse.status).toBe(400);

      const notFoundResponse = await fetch(
        `${baseUrl}/governance/review-queue/fake-case/decision`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            decision: 'approve',
          }),
        },
      );
      expect(notFoundResponse.status).toBe(404);

      const invalidFilterResponse = await fetch(
        `${baseUrl}/governance/review-queue?status=UNKNOWN`,
      );
      expect(invalidFilterResponse.status).toBe(400);
    });
  });
});
