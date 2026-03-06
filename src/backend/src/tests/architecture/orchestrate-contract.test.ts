import { Server } from 'http';
import { AddressInfo } from 'net';
import { app } from '../../index';

describe('Contract - orchestrate_triage v6.13', () => {
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

  it('returns v6.13 success shape with triageResult/report/workflow fields', async () => {
    const response = await fetch(`${baseUrl}/orchestrate_triage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'contract-success-001',
        consentToken: 'consent_local_demo',
        contextVersion: 'v4.30',
        symptomText: 'dizziness, fatigue',
        profile: {
          patientId: 'contract-success-001',
          age: 56,
          sex: 'female',
          symptoms: ['dizziness', 'fatigue'],
          chronicDiseases: ['Hypertension'],
          medicationHistory: ['amlodipine'],
          vitals: {
            systolicBP: 148,
            diastolicBP: 95,
          },
        },
        signals: [
          {
            timestamp: '2026-02-21T12:00:00Z',
            source: 'manual',
            systolicBP: 148,
            diastolicBP: 95,
          },
        ],
      }),
    });
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(typeof payload.status).toBe('string');
    expect(payload).toHaveProperty('routing');
    expect(payload).toHaveProperty('triageResult');
    expect(payload).toHaveProperty('explainableReport');
    expect(payload).toHaveProperty('workflowTrace');
    expect(payload).toHaveProperty('auditRef');
    expect(payload).toHaveProperty('ruleGovernance');

    const workflowTrace = Array.isArray(payload.workflowTrace)
      ? (payload.workflowTrace as Array<{ stage?: string }>)
      : [];
    const stages = workflowTrace
      .map((item) => item.stage)
      .filter((stage): stage is string => typeof stage === 'string');
    expect(stages).toContain('REVIEW');
    expect(stages.indexOf('ROUTING')).toBeGreaterThan(-1);
    expect(stages.indexOf('OUTPUT')).toBeGreaterThan(stages.indexOf('ROUTING'));

    const governance = payload.ruleGovernance as
      | {
          catalogVersion?: string;
          matchedRuleIds?: string[];
          layerDecisions?: Array<{ layer?: string }>;
        }
      | undefined;
    expect(governance?.catalogVersion).toBeTruthy();
    expect(Array.isArray(governance?.matchedRuleIds)).toBe(true);
    expect(governance?.layerDecisions?.some((item) => item.layer === 'FLOW_CONTROL')).toBe(true);
  });

  it('returns requiredFields for missing MIS fields', async () => {
    const response = await fetch(`${baseUrl}/orchestrate_triage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'contract-mis-001',
        consentToken: 'consent_local_demo',
        symptomText: '',
        profile: {
          patientId: 'contract-mis-001',
          age: 56,
          sex: 'female',
          chronicDiseases: [],
          medicationHistory: [],
        },
      }),
    });
    const payload = await response.json() as {
      errorCode: string;
      requiredFields?: string[];
      nextAction?: string;
      ruleGovernance?: {
        layerDecisions: Array<{ layer: string; status: string }>;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.errorCode).toBe('ERR_MISSING_REQUIRED_DATA');
    expect(Array.isArray(payload.requiredFields)).toBe(true);
    expect((payload.requiredFields ?? []).length).toBeGreaterThan(0);
    expect(typeof payload.nextAction).toBe('string');
    expect((payload.nextAction ?? '').length).toBeGreaterThan(0);
    expect(payload.ruleGovernance).toBeDefined();
    expect(
      payload.ruleGovernance?.layerDecisions.some(
        (item) => item.layer === 'FLOW_CONTROL' && item.status === 'fail',
      ),
    ).toBe(true);
  });
});
