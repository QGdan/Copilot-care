import { MetabolicAgent } from '../../agents/MetabolicAgent';
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

describe('Architecture Smoke - metabolic agent', () => {
  it('returns L2 fallback opinion for diabetes/high-risk metabolic profile', async () => {
    const agent = new MetabolicAgent();

    const opinion = await agent.think(
      {
        patientId: 'metabolic-001',
        age: 53,
        sex: 'male',
        chronicDiseases: ['\u4e8c\u578b\u7cd6\u5c3f\u75c5', '\u9ad8\u8102\u8840\u75c7'],
        medicationHistory: ['none'],
        symptoms: ['\u4e4f\u529b'],
      },
      'test-context',
    );

    expect(opinion.role).toBe('Metabolic');
    expect(opinion.riskLevel).toBe('L2');
    expect(opinion.citations).toContain('SYSTEM_FALLBACK_OPINION');
  });

  it('returns L0 fallback opinion when no metabolic risk signal exists', async () => {
    const agent = new MetabolicAgent();

    const opinion = await agent.think(
      {
        patientId: 'metabolic-002',
        age: 28,
        sex: 'female',
        chronicDiseases: [],
        medicationHistory: [],
        symptoms: ['\u8f7b\u5fae\u5934\u75db'],
      },
      'test-context',
    );

    expect(opinion.role).toBe('Metabolic');
    expect(opinion.riskLevel).toBe('L0');
  });

  it('uses LLM response when configured', async () => {
    const llmClient = new StubClinicalLLMClient({
      riskLevel: 'L3',
      confidence: 0.91,
      reasoning: 'LLM marked urgent metabolic risk.',
      citations: ['LLM synthesized source'],
      actions: ['Escalate for urgent in-person assessment'],
    });
    const agent = new MetabolicAgent(llmClient);

    const opinion = await agent.think(
      {
        patientId: 'metabolic-003',
        age: 47,
        sex: 'other',
        chronicDiseases: ['Prediabetes'],
        medicationHistory: [],
      },
      'test-context',
    );

    expect(opinion.riskLevel).toBe('L3');
    expect(opinion.reasoning).toContain('LLM marked urgent metabolic risk');
  });
});
