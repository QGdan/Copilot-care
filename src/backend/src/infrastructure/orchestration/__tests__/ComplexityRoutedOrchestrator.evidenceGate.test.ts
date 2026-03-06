import { TriageRequest } from '@copilot-care/shared/types';
import { CardiologyAgent } from '../../../agents/CardiologyAgent';
import { GPAgent } from '../../../agents/GPAgent';
import { MetabolicAgent } from '../../../agents/MetabolicAgent';
import { SafetyAgent } from '../../../agents/SafetyAgent';
import { AuthoritativeMedicalSearchPort } from '../../../application/ports/AuthoritativeMedicalSearchPort';
import {
  AuthoritativeMedicalEvidence,
  listAuthoritativeMedicalSources,
} from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import { DebateEngine } from '../../../core/DebateEngine';
import { ComplexityRoutedOrchestrator } from '../ComplexityRoutedOrchestrator';

function createRequest(overrides?: Partial<TriageRequest>): TriageRequest {
  return {
    consentToken: 'consent_local_demo',
    symptomText: 'dizziness',
    profile: {
      patientId: 'orchestrator-evidence-gate-001',
      age: 56,
      sex: 'male',
      chiefComplaint: 'dizziness',
      symptoms: ['dizziness'],
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['amlodipine'],
      vitals: {
        systolicBP: 162,
        diastolicBP: 102,
      },
    },
    ...overrides,
  };
}

function createEvidence(
  sourceId: string,
  url: string,
  title: string,
): AuthoritativeMedicalEvidence {
  return {
    sourceId,
    sourceName: sourceId,
    title,
    url,
    snippet: 'Authoritative evidence summary.',
    retrievedAt: '2026-03-02T00:00:00.000Z',
    origin: 'live_search',
  };
}

function createMockSearchPort(
  results: AuthoritativeMedicalEvidence[],
): AuthoritativeMedicalSearchPort {
  const usedSources = [...new Set(results.map((item) => item.sourceId))];
  const sourceBreakdown = usedSources.map((sourceId) => ({
    sourceId,
    count: results.filter((item) => item.sourceId === sourceId).length,
  }));
  return {
    isEnabled(): boolean {
      return true;
    },
    getSources() {
      return listAuthoritativeMedicalSources();
    },
    async search(input) {
      const realtimeCount = results.filter(
        (item) => item.origin !== 'catalog_seed',
      ).length;
      return {
        query: input.query,
        results,
        droppedByPolicy: 0,
        usedSources,
        sourceBreakdown,
        strategyVersion: 'test-strategy',
        generatedAt: '2026-03-02T00:00:00.000Z',
        realtimeCount,
        fallbackCount: results.length - realtimeCount,
      };
    },
  };
}

function createOrchestrator(
  medicalSearch: AuthoritativeMedicalSearchPort,
): ComplexityRoutedOrchestrator {
  const fastDepartmentEngines = {
    cardiology: new DebateEngine([new CardiologyAgent()], { maxRounds: 1 }),
    generalPractice: new DebateEngine([new GPAgent()], { maxRounds: 1 }),
    metabolic: new DebateEngine([new MetabolicAgent()], { maxRounds: 1 }),
  };
  const lightDepartmentEngines = {
    cardiology: new DebateEngine([new CardiologyAgent()], { maxRounds: 1 }),
    generalPractice: new DebateEngine([new GPAgent()], { maxRounds: 1 }),
    metabolic: new DebateEngine([new MetabolicAgent()], { maxRounds: 1 }),
  };
  const deepDebateEngine = new DebateEngine([
    new CardiologyAgent(),
    new GPAgent(),
    new MetabolicAgent(),
    new SafetyAgent(),
  ], { maxRounds: 1 });

  return new ComplexityRoutedOrchestrator({
    fastDepartmentEngines,
    lightDepartmentEngines,
    deepDebateEngine,
    authoritativeMedicalSearch: medicalSearch,
  });
}

describe('ComplexityRoutedOrchestrator evidence completeness gate', () => {
  it('blocks high-risk output when required authoritative sources are missing', async () => {
    const orchestrator = createOrchestrator(
      createMockSearchPort([
        createEvidence(
          'PUBMED',
          'https://pubmed.ncbi.nlm.nih.gov/123456/',
          'PubMed-only evidence',
        ),
      ]),
    );

    const result = await orchestrator.runSession(createRequest());

    expect(result.status).toBe('ERROR');
    expect(result.errorCode).toBe('ERR_GUIDELINE_EVIDENCE_MISSING');
    expect(
      result.notes.some((note) => note.includes('证据完整性门禁')),
    ).toBe(true);
  });

  it('keeps high-risk flow available when required sources are present', async () => {
    const orchestrator = createOrchestrator(
      createMockSearchPort([
        createEvidence(
          'WHO',
          'https://www.who.int/news-room/fact-sheets/detail/hypertension',
          'WHO hypertension facts',
        ),
        createEvidence(
          'NICE',
          'https://www.nice.org.uk/guidance/ng136/chapter/Recommendations',
          'NICE hypertension guideline',
        ),
      ]),
    );

    const result = await orchestrator.runSession(createRequest());

    expect(result.errorCode).not.toBe('ERR_GUIDELINE_EVIDENCE_MISSING');
    expect(result.status).not.toBe('ERROR');
  });

  it('does not enforce evidence gate for low-risk path', async () => {
    const orchestrator = createOrchestrator(
      createMockSearchPort([
        createEvidence(
          'PUBMED',
          'https://pubmed.ncbi.nlm.nih.gov/654321/',
          'Low-risk pubmed evidence',
        ),
      ]),
    );

    const result = await orchestrator.runSession(
      createRequest({
        symptomText: 'mild fatigue',
        profile: {
          ...createRequest().profile,
          symptoms: ['mild fatigue'],
          chronicDiseases: [],
          vitals: {
            systolicBP: 126,
            diastolicBP: 80,
          },
        },
      }),
    );

    expect(result.errorCode).not.toBe('ERR_GUIDELINE_EVIDENCE_MISSING');
  });
});
