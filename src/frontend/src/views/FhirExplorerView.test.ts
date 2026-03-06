import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FhirExplorerView from './FhirExplorerView.vue';

const apiMocks = vi.hoisted(() => ({
  getPatients: vi.fn(),
  getObservations: vi.fn(),
  getProvenances: vi.fn(),
}));

const interopMocks = vi.hoisted(() => ({
  createInteropFhirTriageBundle: vi.fn(),
}));

vi.mock('../services/api', () => ({
  fhirApi: {
    getPatients: apiMocks.getPatients,
    getObservations: apiMocks.getObservations,
    getProvenances: apiMocks.getProvenances,
  },
}));

vi.mock('../services/triageApi', () => ({
  createInteropFhirTriageBundle: interopMocks.createInteropFhirTriageBundle,
}));

function mockFhirBundles(): void {
  apiMocks.getPatients.mockResolvedValue({
    resourceType: 'Bundle',
    type: 'searchset',
    total: 1,
    entry: [
      {
        resource: {
          resourceType: 'Patient',
          id: 'patient-001',
          name: [{ family: 'Test', given: ['User'] }],
          gender: 'male',
          birthDate: '1970-01-01',
        },
      },
    ],
  });
  apiMocks.getObservations.mockResolvedValue({
    resourceType: 'Bundle',
    type: 'searchset',
    total: 1,
    entry: [
      {
        resource: {
          resourceType: 'Observation',
          id: 'obs-001',
          status: 'final',
          subject: { reference: 'Patient/patient-001' },
        },
      },
    ],
  });
  apiMocks.getProvenances.mockResolvedValue({
    resourceType: 'Bundle',
    type: 'searchset',
    total: 1,
    entry: [
      {
        resource: {
          resourceType: 'Provenance',
          id: 'prov-001',
          target: [
            { reference: 'Patient/patient-001' },
            { reference: 'Observation/obs-001' },
          ],
        },
      },
    ],
  });
}

describe('FhirExplorerView interop draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFhirBundles();
  });

  it('generates interop draft and shows summary from interopSummary', async () => {
    interopMocks.createInteropFhirTriageBundle.mockResolvedValue({
      draft: true,
      generatedAt: '2026-03-02T00:00:00.000Z',
      triage: {
        sessionId: 'session-interop-1',
        status: 'OUTPUT',
        interopSummary: {
          resourceCounts: {
            patient: 1,
            observation: 2,
            provenance: 1,
          },
          referenceIntegrity: {
            observationSubjectLinked: true,
            provenanceTargetLinked: true,
            provenanceObservationLinked: true,
          },
        },
      },
      bundle: {
        resourceType: 'Bundle',
        type: 'collection',
        timestamp: '2026-03-02T00:00:00.000Z',
        identifier: {
          system: 'urn:copilot-care:interop:triage-bundle',
          value: 'triage-session-interop-1',
        },
        entry: [],
      },
    });

    const wrapper = mount(FhirExplorerView);
    await flushPromises();

    await wrapper.get('[data-testid="interop-generate-btn"]').trigger('click');
    await flushPromises();

    expect(interopMocks.createInteropFhirTriageBundle).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="interop-summary-grid"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('session-interop-1');
    expect(wrapper.text()).toContain('P1 / O2 / Pr1');
  });

  it('falls back to bundle parsing when interopSummary is missing', async () => {
    interopMocks.createInteropFhirTriageBundle.mockResolvedValue({
      draft: true,
      generatedAt: '2026-03-02T00:00:00.000Z',
      triage: {
        sessionId: 'session-interop-2',
        status: 'OUTPUT',
      },
      bundle: {
        resourceType: 'Bundle',
        type: 'collection',
        timestamp: '2026-03-02T00:00:00.000Z',
        identifier: {
          system: 'urn:copilot-care:interop:triage-bundle',
          value: 'triage-session-interop-2',
        },
        entry: [
          {
            resource: {
              resourceType: 'Patient',
              id: 'patient-x',
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: 'obs-x',
              subject: { reference: 'Patient/patient-x' },
            },
          },
          {
            resource: {
              resourceType: 'Provenance',
              id: 'prov-x',
              target: [
                { reference: 'Patient/patient-x' },
                { reference: 'Observation/obs-x' },
              ],
            },
          },
        ],
      },
    });

    const wrapper = mount(FhirExplorerView);
    await flushPromises();

    await wrapper.get('[data-testid="interop-generate-btn"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="interop-summary-grid"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('P1 / O1 / Pr1');
    const integrityList = wrapper.get('[data-testid="interop-integrity-list"]').text();
    expect(integrityList).toContain('Observation -> Patient');
    expect(integrityList).toContain('Provenance -> Patient');
    expect(integrityList).toContain('Provenance -> Observation');
  });

  it('shows error when interop draft generation fails', async () => {
    interopMocks.createInteropFhirTriageBundle.mockRejectedValue(
      new Error('interop unavailable'),
    );

    const wrapper = mount(FhirExplorerView);
    await flushPromises();

    await wrapper.get('[data-testid="interop-generate-btn"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('interop unavailable');
    expect(wrapper.find('[data-testid="interop-summary-grid"]').exists()).toBe(false);
  });
});
