import { AgentBase } from './AgentBase';
import { AgentOpinion, PatientProfile } from '@copilot-care/shared/types';
import { ClinicalLLMClient } from '../llm/types';

const FALLBACK_CITATION_MARKER = 'SYSTEM_FALLBACK_OPINION';

function normalizeDiseases(profile: PatientProfile): string[] {
  return profile.chronicDiseases.map((item) => item.toLowerCase());
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function detectMetabolicSignals(profile: PatientProfile): {
  hasDiabetes: boolean;
  hasPrediabetes: boolean;
  hasDyslipidemia: boolean;
  hasObesity: boolean;
  symptomSignal: boolean;
  bpSignal: boolean;
} {
  const diseases = normalizeDiseases(profile);
  const symptoms = profile.symptoms ?? [];

  const hasDiabetes = diseases.some((disease) =>
    hasAnyKeyword(disease, [
      'diabetes',
      '\u4e8c\u578b\u7cd6\u5c3f\u75c5',
      '\u7cd6\u5c3f\u75c5',
    ]),
  );
  const hasPrediabetes = diseases.some((disease) =>
    hasAnyKeyword(disease, ['prediabetes', '\u7cd6\u8010\u91cf\u5f02\u5e38']),
  );
  const hasDyslipidemia = diseases.some((disease) =>
    hasAnyKeyword(disease, [
      'dyslipidemia',
      'hyperlipidemia',
      '\u8840\u8102\u5f02\u5e38',
      '\u9ad8\u8102\u8840\u75c7',
    ]),
  );
  const hasObesity = diseases.some((disease) =>
    hasAnyKeyword(disease, ['obesity', 'overweight', '\u80a5\u80d6', '\u8d85\u91cd']),
  );

  const symptomSignal = symptoms.some((symptom) =>
    hasAnyKeyword(symptom, [
      '\u53e3\u6e34',
      '\u591a\u996e',
      '\u591a\u5c3f',
      '\u4e4f\u529b',
      '\u4f53\u91cd\u4e0b\u964d',
      'polydipsia',
      'polyuria',
      'weight loss',
      'fatigue',
    ]),
  );

  const bpSignal =
    (profile.vitals?.systolicBP ?? 0) >= 140 ||
    (profile.vitals?.diastolicBP ?? 0) >= 90;

  return {
    hasDiabetes,
    hasPrediabetes,
    hasDyslipidemia,
    hasObesity,
    symptomSignal,
    bpSignal,
  };
}

export class MetabolicAgent extends AgentBase {
  private readonly llmClient: ClinicalLLMClient | null;

  constructor(llmClient?: ClinicalLLMClient | null) {
    super('metabolic_01', 'Metabolic Agent', 'Metabolic');
    this.llmClient = llmClient ?? null;
  }

  private buildFallbackOpinion(profile: PatientProfile): AgentOpinion {
    const signals = detectMetabolicSignals(profile);
    const riskFactorCount = [
      signals.hasDiabetes,
      signals.hasPrediabetes,
      signals.hasDyslipidemia,
      signals.hasObesity,
      signals.symptomSignal,
      signals.bpSignal,
    ].filter(Boolean).length;

    const riskLevel: AgentOpinion['riskLevel'] =
      signals.hasDiabetes || riskFactorCount >= 3
        ? 'L2'
        : riskFactorCount >= 1
          ? 'L1'
          : 'L0';

    const reasoning =
      riskLevel === 'L2'
        ? 'Fallback metabolic heuristic indicates clustered risk factors; prioritize early in-person re-evaluation and laboratory workup.'
        : riskLevel === 'L1'
          ? 'Fallback metabolic heuristic indicates early risk signals; reinforce follow-up and complete baseline metabolic screening.'
          : 'Fallback metabolic heuristic does not identify high-risk metabolic signals at this time; continue routine monitoring.';

    return {
      agentId: this.id,
      agentName: this.name,
      role: this.role,
      riskLevel,
      confidence: 0.86,
      reasoning,
      citations: ['FALLBACK_METABOLIC_RULESET', FALLBACK_CITATION_MARKER],
      actions: [
        'Complete fasting glucose, HbA1c, lipid panel, and renal function tests.',
        'Track weight, waist circumference, diet, and activity as follow-up baseline.',
        'Escalate to offline care quickly if severe thirst, polyuria, persistent fatigue, or rapid weight change appears.',
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
          'Metabolic risk stratification, chronic follow-up rhythm, and lifestyle intervention recommendations',
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
