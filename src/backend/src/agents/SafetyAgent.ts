import { AgentBase } from './AgentBase';
import { AgentOpinion, PatientProfile } from '@copilot-care/shared/types';
import { ClinicalLLMClient } from '../llm/types';
import { evaluateEmergencySignalSnapshot } from '../domain/rules/AuthoritativeMedicalRuleCatalog';

const FALLBACK_CITATION_MARKER = 'SYSTEM_FALLBACK_OPINION';

function hasRedFlag(profile: PatientProfile): boolean {
  return evaluateEmergencySignalSnapshot(profile).immediateEmergency;
}

export class SafetyAgent extends AgentBase {
  private readonly llmClient: ClinicalLLMClient | null;

  constructor(llmClient?: ClinicalLLMClient | null) {
    super('safety_01', '瀹夊叏瀹℃煡浠ｇ悊', 'Safety');
    this.llmClient = llmClient ?? null;
  }

  private buildFallbackOpinion(profile: PatientProfile): AgentOpinion {
    if (hasRedFlag(profile)) {
      return {
        agentId: this.id,
        agentName: this.name,
        role: this.role,
        riskLevel: 'L3',
        confidence: 0.95,
        reasoning:
          'Detected emergency safety signal; escalate to immediate offline care.',
        citations: ['SAFETY_RED_FLAG_RULESET', FALLBACK_CITATION_MARKER],
        actions: [
          'Immediate offline emergency assessment is required.',
          'Stop online autonomous recommendation and transfer to clinician.',
        ],
      };
    }

    return {
      agentId: this.id,
      agentName: this.name,
      role: this.role,
      riskLevel: 'L1',
      confidence: 0.82,
      reasoning:
        'No immediate emergency signal detected; keep conservative monitoring and follow-up.',
      citations: ['BASE_TRIAGE_SAFETY_BOUNDARY', FALLBACK_CITATION_MARKER],
      actions: [
        'Continue symptom and vital monitoring with planned follow-up.',
        'Escalate offline immediately if red-flag symptoms emerge.',
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
        focus:
          'Safety red-flag detection, risk-boundary review, and conservative escalation',
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


