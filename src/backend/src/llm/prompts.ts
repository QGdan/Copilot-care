import { ClinicalLLMRequest } from './types';

const RESPONSE_SCHEMA = `{
  "riskLevel": "L0|L1|L2|L3",
  "confidence": 0.0,
  "reasoning": "short clinical reasoning in Simplified Chinese",
  "citations": ["guideline/source in Simplified Chinese"],
  "actions": ["non-prescription next step in Simplified Chinese"]
}`;

export function buildClinicalSystemPrompt(): string {
  return [
    'You are a clinical triage assistant for decision support only.',
    'Never provide definitive diagnosis or prescription.',
    'When uncertainty is high, choose conservative escalation/follow-up.',
    'Output must be JSON object only, no markdown, no extra text.',
    'reasoning/citations/actions must use Simplified Chinese.',
    'confidence must be between 0 and 1.',
    `JSON schema: ${RESPONSE_SCHEMA}`,
  ].join('\n');
}

export function buildClinicalUserPrompt(input: ClinicalLLMRequest): string {
  return JSON.stringify(
    {
      task: 'Generate one triage opinion for the assigned expert role.',
      role: input.role,
      agentName: input.agentName,
      focus: input.focus,
      context: input.context,
      patientProfile: input.profile,
      safetyRules: [
        'No direct prescription behavior',
        'No definitive diagnosis output',
        'Conservative escalation when disagreement is high',
      ],
      outputRequirements: [
        'Return JSON object only',
        'riskLevel must be one of L0/L1/L2/L3',
        'reasoning/citations/actions must be Simplified Chinese',
        'actions must be case-specific and reference patient profile/context',
        'actions must be mutually non-overlapping; avoid repeated or paraphrased duplicates',
        'prefer 2-4 concise actions with distinct intent (monitoring, follow-up timing, escalation condition)',
      ],
    },
    null,
    2,
  );
}
