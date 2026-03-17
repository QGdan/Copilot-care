import { CardiologyAgent } from '../../agents/CardiologyAgent';
import { GPAgent } from '../../agents/GPAgent';
import {
  ClinicalLLMClient,
  ClinicalLLMRequest,
  ClinicalLLMResponse,
} from '../../llm/types';

class StubClinicalLLMClient implements ClinicalLLMClient {
  private readonly response: ClinicalLLMResponse | null;

  constructor(response: ClinicalLLMResponse | null) {
    this.response = response;
  }

  public async generateOpinion(
    _input: ClinicalLLMRequest,
  ): Promise<ClinicalLLMResponse | null> {
    return this.response;
  }
}

describe('Architecture Smoke - agent llm switch', () => {
  it('uses LLM output when LLM response is valid', async () => {
    const llmClient = new StubClinicalLLMClient({
      riskLevel: 'L3',
      confidence: 0.92,
      reasoning: 'LLM assessed high risk from symptoms and context.',
      citations: ['External LLM guideline synthesis'],
      actions: ['Escalate to offline evaluation soon'],
    });
    const agent = new CardiologyAgent(llmClient);

    const opinion = await agent.think(
      {
        patientId: 'llm-switch-001',
        age: 50,
        sex: 'male',
        chronicDiseases: ['Hypertension'],
        medicationHistory: ['none'],
        symptoms: ['fatigue'],
      },
      'test-context',
    );

    expect(opinion.riskLevel).toBe('L3');
    expect(opinion.reasoning).toContain('LLM assessed high risk');
  });

  it('falls back to local heuristic when llm returns null', async () => {
    const llmClient = new StubClinicalLLMClient(null);
    const agent = new GPAgent(llmClient);

    const opinion = await agent.think(
      {
        patientId: 'llm-switch-002',
        age: 47,
        sex: 'female',
        chronicDiseases: [],
        medicationHistory: [],
      },
      'test-context',
    );

    expect(opinion.riskLevel).toBe('L1');
    expect(opinion.reasoning).toContain('Fallback general-practice heuristic');
    expect(opinion.citations).toContain('SYSTEM_FALLBACK_OPINION');
  });
});
