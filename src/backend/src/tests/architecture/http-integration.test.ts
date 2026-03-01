import { Server } from 'http';
import { AddressInfo } from 'net';
import { app } from '../../index';

describe('Architecture Smoke - HTTP integration', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll((done) => {
    server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it('returns health status for GET /health', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const payload = await response.json() as { status: string };

    expect(response.status).toBe(200);
    expect(payload.status).toBe('ok');
  });

  it('returns expert architecture snapshot for GET /architecture/experts', async () => {
    const response = await fetch(`${baseUrl}/architecture/experts`);
    const payload = await response.json() as {
      experts: Record<string, { provider: string; llmEnabled: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.experts).toBeDefined();
    expect(payload.experts.cardiology).toBeDefined();
    expect(payload.experts.generalPractice).toBeDefined();
    expect(payload.experts.metabolic).toBeDefined();
    expect(payload.experts.safety).toBeDefined();
  });

  it('returns governance runtime snapshot for GET /governance/runtime', async () => {
    const response = await fetch(`${baseUrl}/governance/runtime`);
    const payload = await response.json() as {
      generatedAt: string;
      source: string;
      queueOverview: Record<string, number>;
      performance: Record<string, number>;
      totals: Record<string, number>;
      recentSessions: unknown[];
      stageRuntime: Record<
        string,
        {
          status: string;
          message: string;
          active: number;
          transitions: number;
          updatedAt: string;
        }
      >;
      currentStage: string;
    };

    expect(response.status).toBe(200);
    expect(payload.source).toBe('runtime');
    expect(payload.generatedAt).toBeTruthy();
    expect(payload.queueOverview).toBeDefined();
    expect(payload.performance).toBeDefined();
    expect(payload.totals).toBeDefined();
    expect(Array.isArray(payload.recentSessions)).toBe(true);
    expect(payload.stageRuntime).toBeDefined();
    expect(payload.stageRuntime.START).toBeDefined();
    expect(payload.stageRuntime.START.status).toBeDefined();
    expect(payload.currentStage).toBeTruthy();
  });

  it('returns rule catalog snapshot for GET /governance/rules/catalog', async () => {
    const response = await fetch(`${baseUrl}/governance/rules/catalog`);
    const payload = await response.json() as {
      catalogVersion: string;
      synonymSetVersion: string;
      layers: Array<{ id: string; layer: string }>;
      guidelineReferences: Array<{ id: string; url: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.catalogVersion).toBeTruthy();
    expect(payload.synonymSetVersion).toBeTruthy();
    expect(payload.layers.length).toBeGreaterThan(0);
    expect(payload.guidelineReferences.length).toBeGreaterThan(0);
  });

  it('returns rule catalog version for GET /governance/rules/version', async () => {
    const response = await fetch(`${baseUrl}/governance/rules/version`);
    const payload = await response.json() as {
      catalogVersion: string;
      guidelineCount: number;
    };

    expect(response.status).toBe(200);
    expect(payload.catalogVersion).toBeTruthy();
    expect(payload.guidelineCount).toBeGreaterThan(0);
  });

  it('returns 400 for POST /orchestrate_triage when profile is missing', async () => {
    const response = await fetch(`${baseUrl}/orchestrate_triage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = await response.json() as { errorCode: string };

    expect(response.status).toBe(400);
    expect(payload.errorCode).toBe('ERR_MISSING_REQUIRED_DATA');
  });

  it('returns typed triage status for POST /orchestrate_triage', async () => {
    const response = await fetch(`${baseUrl}/orchestrate_triage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'http-smoke-typed-001',
        consentToken: 'consent_local_demo',
        symptomText: 'fatigue',
        profile: {
          patientId: 'http-smoke-001',
          age: 52,
          sex: 'male',
          symptoms: ['fatigue'],
          chronicDiseases: ['Hypertension'],
          medicationHistory: ['none'],
          vitals: {
            systolicBP: 150,
            diastolicBP: 95,
          },
        },
      }),
    });
    const payload = await response.json() as { status: string };

    expect(response.status).toBe(200);
    expect(['OUTPUT', 'ESCALATE_TO_OFFLINE', 'ABSTAIN', 'ERROR']).toContain(
      payload.status,
    );
    expect((payload as { ruleGovernance?: unknown }).ruleGovernance).toBeDefined();
  });

  it('returns 403 for interop bundle when SMART scope is missing', async () => {
    const response = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'interop-denied-001',
        consentToken: 'consent_local_demo',
        symptomText: 'dizziness',
        profile: {
          patientId: 'interop-denied-001',
          age: 55,
          sex: 'female',
          symptoms: ['dizziness'],
          chronicDiseases: ['Hypertension'],
          medicationHistory: ['amlodipine'],
          vitals: {
            systolicBP: 146,
            diastolicBP: 92,
          },
        },
      }),
    });
    const payload = await response.json() as {
      resourceType: string;
      issue: Array<{ code: string }>;
    };

    expect(response.status).toBe(403);
    expect(payload.resourceType).toBe('OperationOutcome');
    expect(payload.issue[0]?.code).toBe('forbidden');
  });

  it('returns FHIR bundle draft for interop endpoint when SMART scope is valid', async () => {
    const response = await fetch(`${baseUrl}/interop/fhir/triage-bundle`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-smart-scope': 'user/Patient.read user/Observation.read user/Provenance.read',
      },
      body: JSON.stringify({
        requestId: 'interop-allowed-001',
        consentToken: 'consent_local_demo',
        symptomText: 'dizziness',
        profile: {
          patientId: 'interop-allowed-001',
          age: 55,
          sex: 'female',
          symptoms: ['dizziness'],
          chronicDiseases: ['Hypertension'],
          medicationHistory: ['amlodipine'],
          vitals: {
            systolicBP: 146,
            diastolicBP: 92,
          },
        },
        signals: [
          {
            timestamp: '2026-03-01T10:00:00Z',
            source: 'manual',
            systolicBP: 146,
            diastolicBP: 92,
          },
        ],
      }),
    });
    const payload = await response.json() as {
      draft: boolean;
      triage: {
        status: string;
        ruleGovernance?: {
          catalogVersion?: string;
        };
      };
      bundle: {
        resourceType: string;
        entry: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expect(payload.draft).toBe(true);
    expect(payload.bundle.resourceType).toBe('Bundle');
    expect(payload.bundle.entry.length).toBeGreaterThan(0);
    expect(payload.triage.status).toBeTruthy();
    expect(payload.triage.ruleGovernance?.catalogVersion).toBeTruthy();
  });

  it('updates governance runtime totals after POST /orchestrate_triage', async () => {
    const beforeResponse = await fetch(`${baseUrl}/governance/runtime`);
    const beforePayload = await beforeResponse.json() as {
      totals: { totalSessions: number };
    };

    const executeResponse = await fetch(`${baseUrl}/orchestrate_triage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'http-governance-runtime-001',
        consentToken: 'consent_local_demo',
        symptomText: 'headache',
        profile: {
          patientId: 'http-governance-runtime-001',
          age: 47,
          sex: 'female',
          symptoms: ['headache'],
          chronicDiseases: ['Hypertension'],
          medicationHistory: ['amlodipine'],
          vitals: {
            systolicBP: 142,
            diastolicBP: 90,
          },
        },
      }),
    });

    expect(executeResponse.status).toBe(200);

    const afterResponse = await fetch(`${baseUrl}/governance/runtime`);
    const afterPayload = await afterResponse.json() as {
      totals: { totalSessions: number };
      recentSessions: Array<{ requestId?: string }>;
      stageRuntime: Record<string, { transitions: number; status: string }>;
      currentStage: string;
    };

    expect(afterResponse.status).toBe(200);
    expect(afterPayload.totals.totalSessions).toBeGreaterThanOrEqual(
      beforePayload.totals.totalSessions + 1,
    );
    expect(
      afterPayload.recentSessions.some((session) => session.requestId === 'http-governance-runtime-001'),
    ).toBe(true);
    expect(afterPayload.stageRuntime.START.transitions).toBeGreaterThan(0);
    expect(afterPayload.currentStage).toBeTruthy();
  });

  it('replays the same result for repeated sessionId requests', async () => {
    const requestBody = {
      requestId: 'http-smoke-idempotent-001',
      consentToken: 'consent_local_demo',
      symptomText: 'fatigue',
      sessionId: 'http-smoke-idempotent-001',
      profile: {
        patientId: 'http-smoke-idempotent-001',
        age: 58,
        sex: 'female',
        symptoms: ['fatigue'],
        chronicDiseases: ['Hypertension'],
        medicationHistory: ['amlodipine'],
        vitals: {
          systolicBP: 148,
          diastolicBP: 94,
        },
      },
    };

    const firstResponse = await fetch(`${baseUrl}/orchestrate_triage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const firstPayload = await firstResponse.json() as { status: string };

    const secondResponse = await fetch(`${baseUrl}/orchestrate_triage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const secondPayload = await secondResponse.json() as { status: string };

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondPayload).toEqual(firstPayload);
  });

  it('returns requiredFields when consentToken is missing', async () => {
    const response = await fetch(`${baseUrl}/orchestrate_triage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'http-smoke-consent-missing-001',
        symptomText: 'fatigue',
        profile: {
          patientId: 'http-smoke-consent-missing-001',
          age: 50,
          sex: 'male',
          symptoms: ['fatigue'],
          chronicDiseases: ['Hypertension'],
          medicationHistory: ['none'],
          vitals: {
            systolicBP: 146,
            diastolicBP: 94,
          },
        },
      }),
    });
    const payload = await response.json() as {
      errorCode: string;
      requiredFields?: string[];
    };

    expect(response.status).toBe(400);
    expect(payload.errorCode).toBe('ERR_MISSING_REQUIRED_DATA');
    expect(payload.requiredFields).toEqual(expect.arrayContaining(['consentToken']));
  });

  it('streams stage updates and final result for POST /orchestrate_triage/stream', async () => {
    const response = await fetch(`${baseUrl}/orchestrate_triage/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'http-stream-typed-001',
        consentToken: 'consent_local_demo',
        symptomText: 'fatigue',
        profile: {
          patientId: 'http-stream-001',
          age: 52,
          sex: 'male',
          symptoms: ['fatigue'],
          chronicDiseases: ['Hypertension'],
          medicationHistory: ['none'],
          vitals: {
            systolicBP: 150,
            diastolicBP: 95,
          },
        },
      }),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const events = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) =>
        JSON.parse(line) as {
          type: string;
          stage?: string;
          snapshot?: {
            coordinator: string;
            tasks: unknown[];
            graph: {
              nodes: unknown[];
              edges: unknown[];
            };
          };
        },
      );
    const snapshotEvent = events.find(
      (event) => event.type === 'orchestration_snapshot',
    );
    const snapshotEvents = events.filter(
      (event) => event.type === 'orchestration_snapshot',
    );
    const latestSnapshot = snapshotEvents[snapshotEvents.length - 1]?.snapshot;
    const reviewTask = Array.isArray(latestSnapshot?.tasks)
      ? latestSnapshot.tasks.find((task) => {
          if (!task || typeof task !== 'object') {
            return false;
          }
          const candidate = task as {
            roleId?: string;
            roleName?: string;
            status?: string;
            progress?: number;
          };
          return candidate.roleId === 'reviewer_agent'
            || candidate.roleName === '安全审校Agent';
        }) as
          | {
              status?: string;
              progress?: number;
            }
          | undefined
      : undefined;

    expect(response.status).toBe(200);
    expect(contentType).toContain('application/x-ndjson');
    expect(events.some((event) => event.type === 'stage_update')).toBe(true);
    expect(snapshotEvent).toBeDefined();
    expect(snapshotEvent?.snapshot?.coordinator).toBe('总Agent');
    expect((snapshotEvent?.snapshot?.tasks?.length ?? 0) > 0).toBe(true);
    expect((snapshotEvent?.snapshot?.graph?.nodes?.length ?? 0) > 0).toBe(true);
    expect(snapshotEvents.length).toBeGreaterThan(0);
    expect(reviewTask).toBeDefined();
    expect(reviewTask?.status).not.toBe('pending');
    expect((reviewTask?.progress ?? 0)).toBeGreaterThan(0);
    expect(
      events.some(
        (event) => event.type === 'stage_update' && event.stage === 'REVIEW',
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === 'final_result')).toBe(true);
  });

  it('streams clarification request when required fields are missing', async () => {
    const response = await fetch(`${baseUrl}/orchestrate_triage/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'http-stream-missing-001',
        symptomText: 'fatigue',
        profile: {
          patientId: 'http-stream-missing-001',
          age: 52,
          sex: 'male',
          symptoms: ['fatigue'],
          chronicDiseases: ['Hypertension'],
          medicationHistory: ['none'],
          vitals: {
            systolicBP: 150,
            diastolicBP: 95,
          },
        },
      }),
    });
    const text = await response.text();
    const events = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as {
        type: string;
        requiredFields?: string[];
        snapshot?: {
          tasks: unknown[];
        };
      });

    const clarification = events.find(
      (event) => event.type === 'clarification_request',
    );
    const latestSnapshot = events
      .filter((event) => event.type === 'orchestration_snapshot')
      .map((event) => event.snapshot)
      .filter(Boolean)
      .pop();
    const reviewTask = Array.isArray(latestSnapshot?.tasks)
      ? latestSnapshot.tasks.find((task) => {
          if (!task || typeof task !== 'object') {
            return false;
          }
          const candidate = task as {
            roleId?: string;
            roleName?: string;
            status?: string;
            progress?: number;
          };
          return candidate.roleId === 'reviewer_agent'
            || candidate.roleName === '安全审校Agent';
        }) as
          | {
              status?: string;
              progress?: number;
            }
          | undefined
      : undefined;

    expect(response.status).toBe(200);
    expect(clarification).toBeDefined();
    expect(clarification?.requiredFields).toEqual(
      expect.arrayContaining(['consentToken']),
    );
    expect(reviewTask).toBeDefined();
    expect(reviewTask?.status).not.toBe('pending');
    expect((reviewTask?.progress ?? 0)).toBeGreaterThan(0);
    expect(events.some((event) => event.type === 'final_result')).toBe(true);
  });
});
