import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConsultationInputForm } from './useConsultationInputForm';

const VALIDATION_MESSAGES = {
  symptomRequired: 'symptom-required',
  ageInvalid: 'age-invalid',
  systolicNotGreaterThanDiastolic: 'bp-invalid',
};

describe('useConsultationInputForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-23T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds request payload from form state on happy path', () => {
    const state = useConsultationInputForm({
      contextVersion: 'v4.30',
      validationMessages: VALIDATION_MESSAGES,
      defaultForm: {
        symptomText: '  dizziness，chest pain\nfatigue  ',
        age: 56,
        sex: 'male',
        chronicDiseasesText: 'Hypertension, Diabetes',
        medicationHistoryText: 'amlodipine、metformin',
        systolicBPText: '148',
        diastolicBPText: '95',
        consentToken: ' consent_demo ',
      },
    });

    const payload = state.buildRequestPayload();

    expect(payload.requestId).toBe('req-1771840800000');
    expect(payload.contextVersion).toBe('v4.30');
    expect(payload.symptomText).toBe('dizziness，chest pain\nfatigue');
    expect(payload.consentToken).toBe('consent_demo');

    expect(payload.profile.patientId).toBe('demo-1771840800000');
    expect(payload.profile.chiefComplaint).toBe('dizziness，chest pain\nfatigue');
    expect(payload.profile.symptoms).toEqual(['dizziness', 'chest pain', 'fatigue']);
    expect(payload.profile.chronicDiseases).toEqual(['Hypertension', 'Diabetes']);
    expect(payload.profile.medicationHistory).toEqual(['amlodipine', 'metformin']);
    expect(payload.profile.vitals).toEqual({
      systolicBP: 148,
      diastolicBP: 95,
    });

    expect(payload.signals).toHaveLength(1);
    expect(payload.signals[0]?.source).toBe('manual');
    expect(payload.signals[0]?.timestamp).toBe('2026-02-23T10:00:00.000Z');
  });

  it('returns validation errors for required and invalid inputs', () => {
    const state = useConsultationInputForm({
      validationMessages: VALIDATION_MESSAGES,
    });

    expect(state.validateInput()).toBe('symptom-required');

    state.form.value.symptomText = 'headache';
    state.form.value.age = 0;
    expect(state.validateInput()).toBe('age-invalid');

    state.form.value.age = 40;
    state.form.value.systolicBPText = '90';
    state.form.value.diastolicBPText = '90';
    expect(state.validateInput()).toBe('bp-invalid');
  });

  it('applies quick input and ignores updates while disabled', () => {
    const state = useConsultationInputForm({
      validationMessages: VALIDATION_MESSAGES,
    });

    state.applyQuickInput(
      {
        label: 'quick',
        symptomText: 'initial',
        age: 30,
        sex: 'female',
      },
      true,
    );
    expect(state.form.value.symptomText).toBe('');

    state.applyQuickInput({
      label: 'quick',
      symptomText: 'new symptom',
      age: 32,
      sex: 'female',
      systolicBPText: '130',
      diastolicBPText: '80',
      chronicDiseasesText: 'asthma',
      medicationHistoryText: 'drug-a',
    });

    expect(state.form.value.symptomText).toBe('new symptom');
    expect(state.form.value.age).toBe(32);
    expect(state.form.value.systolicBPText).toBe('130');
    expect(state.form.value.diastolicBPText).toBe('80');
    expect(state.form.value.chronicDiseasesText).toBe('asthma');
    expect(state.form.value.medicationHistoryText).toBe('drug-a');
  });

  it('controls advanced input visibility and export profile fallback id', () => {
    const state = useConsultationInputForm({
      validationMessages: VALIDATION_MESSAGES,
      defaultForm: {
        symptomText: 'headache',
        age: 0,
        sex: 'other',
      },
    });

    expect(state.showAdvancedInputs.value).toBe(false);
    state.toggleAdvancedInputs();
    expect(state.showAdvancedInputs.value).toBe(true);
    state.setAdvancedInputsVisible(false);
    expect(state.showAdvancedInputs.value).toBe(false);

    const exportProfile = state.buildExportPatientProfile();
    expect(exportProfile.patientId).toBe('demo');
    expect(exportProfile.vitals).toBeUndefined();
  });

  it('returns null validation result and no signals when optional fields are absent', () => {
    const state = useConsultationInputForm({
      validationMessages: VALIDATION_MESSAGES,
      defaultForm: {
        symptomText: 'mild fatigue',
        age: 45,
        sex: 'male',
        consentToken: '   ',
      },
    });

    expect(state.validateInput()).toBeNull();
    expect(state.buildSignals()).toEqual([]);
    expect(state.buildRequestPayload().consentToken).toBeUndefined();
  });

  it('handles numeric blood-pressure inputs at runtime without throwing', () => {
    const state = useConsultationInputForm({
      validationMessages: VALIDATION_MESSAGES,
      defaultForm: {
        symptomText: 'palpitation',
        age: 50,
        sex: 'female',
      },
    });

    state.form.value.systolicBPText = 132;
    state.form.value.diastolicBPText = 84;

    expect(state.validateInput()).toBeNull();

    const signals = state.buildSignals();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.systolicBP).toBe(132);
    expect(signals[0]?.diastolicBP).toBe(84);
  });

  it('treats nullish blood-pressure inputs as absent', () => {
    const state = useConsultationInputForm({
      validationMessages: VALIDATION_MESSAGES,
      defaultForm: {
        symptomText: 'fatigue',
        age: 38,
        sex: 'male',
      },
    });

    state.form.value.systolicBPText = null;
    state.form.value.diastolicBPText = undefined;

    expect(state.validateInput()).toBeNull();
    expect(state.buildSignals()).toEqual([]);
    expect(state.buildProfile().vitals).toBeUndefined();
  });

  it('syncs selected patient context into form and request profile', () => {
    const state = useConsultationInputForm({
      validationMessages: VALIDATION_MESSAGES,
      defaultForm: {
        symptomText: 'manual symptom',
        age: 42,
        sex: 'other',
      },
    });

    state.applyPatientDataContext(
      {
        patientId: 'patient-777',
        age: 61,
        sex: 'female',
        chiefComplaint: 'headache and dizziness',
        chronicDiseases: ['Hypertension', 'Diabetes'],
        medicationHistory: ['amlodipine', 'metformin'],
      },
      'patient-777',
    );

    expect(state.form.value.symptomText).toBe('headache and dizziness');
    expect(state.form.value.age).toBe(61);
    expect(state.form.value.sex).toBe('female');
    expect(state.form.value.chronicDiseasesText).toBe(
      'Hypertension, Diabetes',
    );
    expect(state.form.value.medicationHistoryText).toBe(
      'amlodipine, metformin',
    );

    const payload = state.buildRequestPayload();
    expect(payload.profile.patientId).toBe('patient-777');
    expect(payload.profile.chiefComplaint).toBe('headache and dizziness');

    const exportProfile = state.buildExportPatientProfile();
    expect(exportProfile.patientId).toBe('patient-777');
  });

  it('parses string age from patient context and allows manual demographic overrides', () => {
    const state = useConsultationInputForm({
      validationMessages: VALIDATION_MESSAGES,
      defaultForm: {
        symptomText: 'manual symptom',
        age: 49,
        sex: 'male',
      },
    });

    state.applyPatientDataContext(
      {
        patientId: 'patient-5566',
        age: '56',
        sex: 'female',
        chiefComplaint: 'dizziness',
      },
      'patient-5566',
    );

    expect(state.form.value.age).toBe(56);
    expect(state.form.value.sex).toBe('female');

    state.form.value.age = 49;
    state.form.value.sex = 'male';
    const payload = state.buildRequestPayload();
    expect(payload.profile.patientId).toBe('patient-5566');
    expect(payload.profile.age).toBe(49);
    expect(payload.profile.sex).toBe('male');
  });

  it('uses selected patient id even when patient details are unavailable', () => {
    const state = useConsultationInputForm({
      validationMessages: VALIDATION_MESSAGES,
      defaultForm: {
        symptomText: 'persistent cough',
        age: 33,
        sex: 'male',
      },
    });

    state.applyPatientDataContext(null, 'patient-404');

    expect(state.buildRequestPayload().profile.patientId).toBe('patient-404');
    expect(state.buildProfile().patientId).toBe('patient-404');
  });
});
