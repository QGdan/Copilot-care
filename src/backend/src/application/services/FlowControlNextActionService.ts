import { ErrorCode } from '@copilot-care/shared/types';

export interface NextActionInput {
  errorCode?: ErrorCode;
  requiredFields?: string[];
}

const FIELD_LABELS: Record<string, string> = {
  profile: 'profile',
  consentToken: 'consent token',
  symptomText: 'symptom description',
  systolicBP: 'systolic blood pressure',
  diastolicBP: 'diastolic blood pressure',
  chronicDiseasesOrMedicationHistory: 'history or medication',
  ageOrSex: 'age/sex',
};

function formatRequiredFields(requiredFields: string[] | undefined): string {
  if (!requiredFields || requiredFields.length === 0) {
    return 'required clinical fields';
  }
  const labels = requiredFields.map((field) => FIELD_LABELS[field] ?? field);
  return labels.join(', ');
}

export function resolveNextAction(input: NextActionInput): string {
  const requiredFieldText = formatRequiredFields(input.requiredFields);
  switch (input.errorCode) {
    case 'ERR_MISSING_REQUIRED_DATA':
      return `Provide missing fields (${requiredFieldText}) and resubmit triage.`;
    case 'ERR_INVALID_VITAL_SIGN':
      return 'Correct vital signs (systolic must be greater than diastolic) and resubmit.';
    case 'ERR_LOW_CONFIDENCE_ABSTAIN':
      return 'Add objective findings or route to clinician review before final decision.';
    case 'ERR_CONFLICT_UNRESOLVED':
      return 'Escalate to human review with full evidence and conflict notes.';
    case 'ERR_ESCALATE_TO_OFFLINE':
      return 'Trigger immediate offline referral and follow emergency handoff protocol.';
    case 'ERR_GUIDELINE_EVIDENCE_MISSING':
      return 'Attach guideline references and supporting evidence before release.';
    case 'ERR_ADVERSARIAL_PROMPT_DETECTED':
      return 'Remove non-clinical instructions and restate request with clinical facts only.';
    default:
      return 'Run manual review and retry after evidence completeness check.';
  }
}

