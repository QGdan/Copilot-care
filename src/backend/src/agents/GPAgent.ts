import { AgentBase } from './AgentBase';
import { AgentOpinion, PatientProfile } from '@copilot-care/shared/types';
import { ClinicalLLMClient } from '../llm/types';

const FALLBACK_CITATION_MARKER = 'SYSTEM_FALLBACK_OPINION';

export class GPAgent extends AgentBase {
  private readonly llmClient: ClinicalLLMClient | null;

  constructor(llmClient?: ClinicalLLMClient | null) {
    super('gp_01', 'General Practice Agent', 'Generalist');
    this.llmClient = llmClient ?? null;
  }

  private buildFallbackOpinion(_profile: PatientProfile): AgentOpinion {
    return {
      agentId: this.id,
      agentName: this.name,
      role: this.role,
      riskLevel: 'L1',
      confidence: 0.85,
      reasoning:
        'Fallback general-practice heuristic path was used; likely fluctuating blood pressure and requires trend-based re-evaluation.',
      citations: [
        'FALLBACK_GENERAL_PRACTICE_RULESET',
        FALLBACK_CITATION_MARKER,
      ],
      actions: [
        'Perform ambulatory or serial blood pressure monitoring and follow up.',
        'Reinforce low-sodium diet and lifestyle management.',
        'Escalate to offline care immediately if red-flag symptoms emerge.',
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
        focus: 'Conservative triage and continuity management from GP perspective',
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
