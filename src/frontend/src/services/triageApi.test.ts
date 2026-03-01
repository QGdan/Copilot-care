import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInteropFhirTriageBundle,
  fetchGovernanceRuleCatalog,
  fetchGovernanceRuleVersion,
  orchestrateTriageStream,
} from './triageApi';

const { postMock, getMock, isAxiosErrorMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
  isAxiosErrorMock: vi.fn(() => false),
}));

vi.mock('axios', () => ({
  default: {
    post: postMock,
    get: getMock,
    isAxiosError: isAxiosErrorMock,
  },
  post: postMock,
  get: getMock,
  isAxiosError: isAxiosErrorMock,
}));

function createPayload() {
  return {
    requestId: 'stream-test-001',
    consentToken: 'consent_local_demo',
    symptomText: 'fatigue',
    profile: {
      patientId: 'patient-001',
      age: 52,
      sex: 'male' as const,
      chiefComplaint: 'fatigue',
      symptoms: ['fatigue'],
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['none'],
      allergyHistory: [],
      lifestyleTags: [],
    },
  };
}

function createStreamResponse(lines: string[]): {
  ok: boolean;
  status: number;
  body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } };
} {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${lines.join('\n')}\n`);
  let consumed = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (consumed) {
              return { done: true };
            }
            consumed = true;
            return { done: false, value: data };
          },
        };
      },
    },
  };
}

describe('orchestrateTriageStream', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('emits streamed final_result directly when present', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createStreamResponse([
        JSON.stringify({
          type: 'stage_update',
          timestamp: new Date().toISOString(),
          stage: 'START',
          status: 'running',
          message: '会诊流程启动',
        }),
        JSON.stringify({
          type: 'final_result',
          timestamp: new Date().toISOString(),
          result: {
            status: 'ERROR',
            errorCode: 'ERR_MISSING_REQUIRED_DATA',
            notes: ['缺少必要字段'],
          },
        }),
      ]),
    ) as typeof fetch;

    const onEvent = vi.fn();
    await orchestrateTriageStream(createPayload(), { onEvent });

    expect(onEvent).toHaveBeenCalled();
    expect(
      onEvent.mock.calls.some(([event]) => event.type === 'final_result'),
    ).toBe(true);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('falls back to non-stream endpoint when stream has no final_result', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createStreamResponse([
        JSON.stringify({
          type: 'stage_update',
          timestamp: new Date().toISOString(),
          stage: 'START',
          status: 'running',
          message: '会诊流程启动',
        }),
      ]),
    ) as typeof fetch;

    postMock.mockResolvedValue({
      data: {
        status: 'ERROR',
        errorCode: 'ERR_MISSING_REQUIRED_DATA',
        notes: ['缺少必要字段'],
      },
    } as never);

    const onEvent = vi.fn();
    await orchestrateTriageStream(createPayload(), { onEvent });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(
      postMock.mock.calls[0]?.[0],
    ).toContain('/orchestrate_triage');
    expect(
      onEvent.mock.calls.some(([event]) => event.type === 'final_result'),
    ).toBe(true);
  });

  it('fetches governance rule catalog from dedicated endpoint', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        catalogVersion: '2026.03-r1',
        synonymSetVersion: '2026.03-r1',
        layers: [],
        guidelineReferences: [],
        generatedAt: new Date().toISOString(),
      },
    } as never);

    const response = await fetchGovernanceRuleCatalog();

    expect(response.catalogVersion).toBe('2026.03-r1');
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock.mock.calls[0]?.[0]).toContain('/governance/rules/catalog');
  });

  it('fetches governance rule version from dedicated endpoint', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        catalogVersion: '2026.03-r1',
        synonymSetVersion: '2026.03-r1',
        guidelineCount: 5,
        generatedAt: new Date().toISOString(),
      },
    } as never);

    const response = await fetchGovernanceRuleVersion();

    expect(response.guidelineCount).toBe(5);
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock.mock.calls[0]?.[0]).toContain('/governance/rules/version');
  });

  it('posts interop FHIR triage bundle with default SMART scope header', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        draft: true,
        generatedAt: new Date().toISOString(),
        triage: {
          sessionId: 'session-1',
          status: 'OUTPUT',
        },
        bundle: {
          resourceType: 'Bundle',
          type: 'collection',
          timestamp: new Date().toISOString(),
          identifier: {
            system: 'urn:copilot-care:interop:triage-bundle',
            value: 'triage-session-1',
          },
          entry: [],
        },
      },
    } as never);

    await createInteropFhirTriageBundle(createPayload());

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0]?.[0]).toContain('/interop/fhir/triage-bundle');
    expect(postMock.mock.calls[0]?.[2]).toMatchObject({
      headers: {
        'x-smart-scope':
          'patient/Patient.read patient/Observation.read patient/Provenance.read',
      },
    });
  });
});
