import { ref, type Ref } from 'vue';
import type {
  HealthSignal,
  PatientProfile,
  TriageRequest,
} from '@copilot-care/shared/types';

export type OptionalNumericInput = string | number | null | undefined;

export interface ConsultationInputForm {
  symptomText: string;
  age: number;
  sex: 'male' | 'female' | 'other';
  chronicDiseasesText: string;
  medicationHistoryText: string;
  systolicBPText: OptionalNumericInput;
  diastolicBPText: OptionalNumericInput;
  consentToken: string;
}

export interface ConsultationQuickInput {
  label: string;
  symptomText: string;
  age: number;
  sex: 'male' | 'female' | 'other';
  systolicBPText?: OptionalNumericInput;
  diastolicBPText?: OptionalNumericInput;
  chronicDiseasesText?: string;
  medicationHistoryText?: string;
}

export interface ConsultationPatientDataContext {
  patientId?: string;
  age?: number | string;
  sex?: string;
  chiefComplaint?: string;
  chronicDiseases?: string[];
  medicationHistory?: string[];
}

interface ConsultationInputValidationMessages {
  symptomRequired: string;
  ageInvalid: string;
  systolicNotGreaterThanDiastolic: string;
}

interface UseConsultationInputFormOptions {
  contextVersion?: string;
  defaultForm?: Partial<ConsultationInputForm>;
  validationMessages?: Partial<ConsultationInputValidationMessages>;
}

interface BuildPatientProfileOptions {
  fallbackPatientId: string;
  demographicOverride?: {
    age?: number;
    sex?: 'male' | 'female' | 'other';
  };
}

export interface ConsultationInputFormState {
  form: Ref<ConsultationInputForm>;
  showAdvancedInputs: Ref<boolean>;
  setAdvancedInputsVisible: (visible: boolean) => void;
  toggleAdvancedInputs: () => void;
  applyQuickInput: (input: ConsultationQuickInput, disabled?: boolean) => void;
  applyPatientDataContext: (
    patientData: ConsultationPatientDataContext | null,
    selectedPatientId?: string,
  ) => void;
  buildProfile: () => PatientProfile;
  buildSignals: () => HealthSignal[];
  buildRequestPayload: () => TriageRequest;
  buildExportPatientProfile: () => PatientProfile;
  validateInput: () => string | null;
}

const DEFAULT_FORM: ConsultationInputForm = {
  symptomText: '',
  age: 45,
  sex: 'other',
  chronicDiseasesText: '',
  medicationHistoryText: '',
  systolicBPText: '',
  diastolicBPText: '',
  consentToken: 'consent_local_demo',
};

const DEFAULT_VALIDATION_MESSAGES: ConsultationInputValidationMessages = {
  symptomRequired: 'Please describe current symptoms first.',
  ageInvalid: 'Age must be a valid positive number.',
  systolicNotGreaterThanDiastolic:
    'Systolic BP must be greater than diastolic BP.',
};

function parseTagText(value: string): string[] {
  return value
    .replace(/\uFF0C/g, ',')
    .replace(/\u3001/g, ',')
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSelectedPatientId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeSex(
  value: string | undefined,
): 'male' | 'female' | 'other' | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'male' || normalized === 'female' || normalized === 'other') {
    return normalized;
  }
  return undefined;
}

function buildPatientProfile(
  form: ConsultationInputForm,
  options: BuildPatientProfileOptions,
): PatientProfile {
  const symptomText = form.symptomText.trim();
  const systolicBP = parseOptionalNumber(form.systolicBPText);
  const diastolicBP = parseOptionalNumber(form.diastolicBPText);
  const effectiveAge = options.demographicOverride?.age ?? form.age;
  const effectiveSex = options.demographicOverride?.sex ?? form.sex;

  return {
    patientId: options.fallbackPatientId,
    age: effectiveAge,
    sex: effectiveSex,
    chiefComplaint: symptomText,
    symptoms: parseTagText(symptomText),
    chronicDiseases: parseTagText(form.chronicDiseasesText),
    medicationHistory: parseTagText(form.medicationHistoryText),
    allergyHistory: [],
    lifestyleTags: [],
    vitals:
      typeof systolicBP === 'number' || typeof diastolicBP === 'number'
        ? { systolicBP, diastolicBP }
        : undefined,
  };
}

export function useConsultationInputForm(
  options: UseConsultationInputFormOptions = {},
): ConsultationInputFormState {
  const validationMessages: ConsultationInputValidationMessages = {
    ...DEFAULT_VALIDATION_MESSAGES,
    ...options.validationMessages,
  };

  const contextVersion = options.contextVersion ?? 'v4.30';
  const form = ref<ConsultationInputForm>({
    ...DEFAULT_FORM,
    ...options.defaultForm,
  });
  const showAdvancedInputs = ref<boolean>(false);
  const selectedPatientId = ref<string | undefined>(undefined);

  function setAdvancedInputsVisible(visible: boolean): void {
    showAdvancedInputs.value = visible;
  }

  function toggleAdvancedInputs(): void {
    showAdvancedInputs.value = !showAdvancedInputs.value;
  }

  function parsePositiveAge(value: unknown): number | undefined {
    const parsed = parseOptionalNumber(value);
    if (typeof parsed !== 'number' || parsed <= 0) {
      return undefined;
    }
    return Math.floor(parsed);
  }

  function applyQuickInput(
    input: ConsultationQuickInput,
    disabled = false,
  ): void {
    if (disabled) {
      return;
    }
    form.value.symptomText = input.symptomText;
    form.value.age = input.age;
    form.value.sex = input.sex;
    form.value.systolicBPText = input.systolicBPText ?? '';
    form.value.diastolicBPText = input.diastolicBPText ?? '';
    form.value.chronicDiseasesText = input.chronicDiseasesText ?? '';
    form.value.medicationHistoryText = input.medicationHistoryText ?? '';
  }

  function applyPatientDataContext(
    patientData: ConsultationPatientDataContext | null,
    explicitSelectedPatientId?: string,
  ): void {
    selectedPatientId.value =
      normalizeSelectedPatientId(explicitSelectedPatientId) ??
      normalizeSelectedPatientId(patientData?.patientId);

    if (!patientData) {
      if (selectedPatientId.value) {
        // Prevent stale demographics from a previous patient context.
        form.value.age = 0;
        form.value.sex = 'other';
      }
      return;
    }

    const normalizedSex = normalizeSex(patientData.sex);
    const normalizedAge = parsePositiveAge(patientData.age);
    if (typeof patientData.chiefComplaint === 'string') {
      form.value.symptomText = patientData.chiefComplaint.trim();
    }
    if (typeof normalizedAge === 'number') {
      form.value.age = normalizedAge;
    }
    if (normalizedSex) {
      form.value.sex = normalizedSex;
    }
    if (Array.isArray(patientData.chronicDiseases)) {
      form.value.chronicDiseasesText = patientData.chronicDiseases.join(', ');
    }
    if (Array.isArray(patientData.medicationHistory)) {
      form.value.medicationHistoryText = patientData.medicationHistory.join(', ');
    }

  }

  function buildProfile(): PatientProfile {
    return buildPatientProfile(form.value, {
      fallbackPatientId: selectedPatientId.value ?? `demo-${Date.now()}`,
    });
  }

  function buildSignals(): HealthSignal[] {
    const systolicBP = parseOptionalNumber(form.value.systolicBPText);
    const diastolicBP = parseOptionalNumber(form.value.diastolicBPText);

    if (typeof systolicBP !== 'number' && typeof diastolicBP !== 'number') {
      return [];
    }

    return [
      {
        timestamp: new Date().toISOString(),
        source: 'manual',
        systolicBP,
        diastolicBP,
      },
    ];
  }

  function buildRequestPayload(): TriageRequest {
    return {
      requestId: `req-${Date.now()}`,
      profile: buildProfile(),
      signals: buildSignals(),
      symptomText: form.value.symptomText.trim(),
      contextVersion,
      consentToken: form.value.consentToken.trim() || undefined,
    };
  }

  function buildExportPatientProfile(): PatientProfile {
    const fallbackPatientId = selectedPatientId.value ?? (
      form.value.age
        ? `demo-${Date.now()}`
        : 'demo'
    );
    return buildPatientProfile(form.value, {
      fallbackPatientId,
    });
  }

  function validateInput(): string | null {
    if (!form.value.symptomText.trim()) {
      return validationMessages.symptomRequired;
    }

    if (!Number.isFinite(form.value.age) || form.value.age <= 0) {
      return validationMessages.ageInvalid;
    }

    const systolicBP = parseOptionalNumber(form.value.systolicBPText);
    const diastolicBP = parseOptionalNumber(form.value.diastolicBPText);
    if (
      typeof systolicBP === 'number'
      && typeof diastolicBP === 'number'
      && systolicBP <= diastolicBP
    ) {
      return validationMessages.systolicNotGreaterThanDiastolic;
    }

    return null;
  }

  return {
    form,
    showAdvancedInputs,
    setAdvancedInputsVisible,
    toggleAdvancedInputs,
    applyQuickInput,
    applyPatientDataContext,
    buildProfile,
    buildSignals,
    buildRequestPayload,
    buildExportPatientProfile,
    validateInput,
  };
}
