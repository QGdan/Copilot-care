import { AgentBase } from './AgentBase';
import { AgentOpinion, PatientProfile } from '@copilot-care/shared/types';
import { ClinicalLLMClient } from '../llm/types';

const FALLBACK_CITATION_MARKER = 'SYSTEM_FALLBACK_OPINION';

export class CardiologyAgent extends AgentBase {
  private readonly llmClient: ClinicalLLMClient | null;

  constructor(llmClient?: ClinicalLLMClient | null) {
    super('cardio_01', 'Cardiology Agent', 'Specialist');
    this.llmClient = llmClient ?? null;
  }

  private buildFallbackOpinion(profile: PatientProfile): AgentOpinion {
    const hasHypertension = profile.chronicDiseases.includes('Hypertension');

    return {
      agentId: this.id,
      agentName: this.name,
      role: this.role,
      riskLevel: hasHypertension ? 'L2' : 'L0',
      confidence: 0.9,
      reasoning:
        'Fallback cardiology heuristic path was used; monitor blood pressure trend conservatively and re-evaluate risk at the next checkpoint.',
      citations: ['FALLBACK_CARDIOLOGY_RULESET', FALLBACK_CITATION_MARKER],
      actions: [
        'Arrange in-person follow-up within 1-2 weeks.',
        'Record home blood pressure daily and monitor trend changes.',
      ],
    };
  }

  public async think(
    profile: PatientProfile,
    context: string,
  ): Promise<AgentOpinion> {
    const fallback = this.buildFallbackOpinion(profile);
    if (!this.llmClient) {
      return fallback;
    }

    try {
      const llmOpinion = await this.llmClient.generateOpinion({
        role: this.role,
        agentName: this.name,
        focus: 'Cardiovascular risk triage and escalation boundaries',
        profile,
        context,
      });
      if (!llmOpinion) {
        return fallback;
      }

      return {
        agentId: this.id,
        agentName: this.name,
        role: this.role,
        ...llmOpinion,
      };
    } catch {
      return fallback;
    }
  }
}
