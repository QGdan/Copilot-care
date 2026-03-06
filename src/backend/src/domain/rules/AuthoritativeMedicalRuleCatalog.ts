import { HealthSignal, PatientProfile } from '@copilot-care/shared/types';

export interface GuidelineReference {
  id: string;
  title: string;
  publisher: string;
  publishedOn: string;
  lastUpdatedOn?: string;
  url: string;
}

export type GovernanceRuleLayer =
  | 'BASIC_SAFETY'
  | 'FLOW_CONTROL'
  | 'INTELLIGENT_COLLABORATION'
  | 'OPERATIONS';

export const GOVERNANCE_RULE_LAYER_LABELS: Record<
  GovernanceRuleLayer,
  string
> = {
  BASIC_SAFETY: '基础安全层',
  FLOW_CONTROL: '流程控制层',
  INTELLIGENT_COLLABORATION: '智能协同层',
  OPERATIONS: '运维层',
} as const;

export const AUTHORITATIVE_RULE_CATALOG_VERSION = '2026.03-r1';
export const RED_FLAG_SYNONYM_SET_VERSION = '2026.03-r1';

export const RULE_IDS = {
  BASIC_SAFETY_EMERGENCY_SYMPTOM: 'RULE-BS-EMERGENCY-SYMPTOM',
  BASIC_SAFETY_STROKE_WARNING: 'RULE-BS-STROKE-WARNING',
  BASIC_SAFETY_LEVEL2_HYPOGLYCEMIA: 'RULE-BS-LEVEL2-HYPOGLYCEMIA',
  FLOW_CONTROL_SEVERE_HTN_SAME_DAY: 'RULE-FC-SEVERE-HTN-SAME-DAY',
  FLOW_CONTROL_MINIMUM_INFOSET_GATE: 'RULE-FC-MIS-GATE',
  FLOW_CONTROL_STAGE2_HTN: 'RULE-FC-STAGE2-HTN',
  FLOW_CONTROL_STAGE1_HTN_HIGH_RISK: 'RULE-FC-STAGE1-HTN-HIGH-RISK',
  FLOW_CONTROL_RANDOM_GLUCOSE_CLASSIC: 'RULE-FC-RANDOM-GLUCOSE-CLASSIC',
  INTELLIGENT_COLLAB_COMPLEXITY_MULTI_SYSTEM:
    'RULE-IC-COMPLEXITY-MULTI-SYSTEM',
  INTELLIGENT_COLLAB_COMPLEXITY_MULTI_COMORBIDITY:
    'RULE-IC-COMPLEXITY-MULTI-COMORBIDITY',
  INTELLIGENT_COLLAB_COMPLEXITY_RISK_BOUNDARY:
    'RULE-IC-COMPLEXITY-RISK-BOUNDARY',
  INTELLIGENT_COLLAB_COMPLEXITY_WORSENING_HISTORY:
    'RULE-IC-COMPLEXITY-WORSENING-HISTORY',
  INTELLIGENT_COLLAB_ROUTE_FAST: 'RULE-IC-ROUTE-FAST',
  INTELLIGENT_COLLAB_ROUTE_LIGHT: 'RULE-IC-ROUTE-LIGHT',
  INTELLIGENT_COLLAB_ROUTE_DEEP: 'RULE-IC-ROUTE-DEEP',
  INTELLIGENT_COLLAB_ROUTE_ESCALATE: 'RULE-IC-ROUTE-ESCALATE',
  OPERATIONS_GOVERNANCE_RELEASE_LINK: 'RULE-OPS-GOVERNANCE-RELEASE-LINK',
} as const;

export interface LayeredRuleDescriptor {
  id: string;
  layer: GovernanceRuleLayer;
  title: string;
  summary: string;
  implementationRefs: string[];
}

export const LAYERED_RULE_DESCRIPTORS: readonly LayeredRuleDescriptor[] = [
  {
    id: 'RULE-L1',
    layer: 'BASIC_SAFETY',
    title: 'Emergency Red-Flag Rules',
    summary:
      'Emergency symptoms, stroke warning signs, and severe hypoglycemia trigger immediate escalation.',
    implementationRefs: [
      'application/services/RuleFirstRiskAssessmentService.ts',
      'agents/SafetyAgent.ts',
      'core/DebateEngine.ts',
    ],
  },
  {
    id: 'RULE-L2',
    layer: 'FLOW_CONTROL',
    title: 'Intake and Validation Gate',
    summary:
      'Consent checks, minimum information checks, and typed vital-sign validation gate workflow entry.',
    implementationRefs: [
      'application/services/ConsentValidationService.ts',
      'application/services/MinimumInfoSetService.ts',
      'infrastructure/governance/riskTriggerMatrix.ts',
    ],
  },
  {
    id: 'RULE-L3',
    layer: 'INTELLIGENT_COLLABORATION',
    title: 'Routing and Consensus Governance',
    summary:
      'Complexity routing, confidence calibration, and baseline guard coordinate multi-agent decisions.',
    implementationRefs: [
      'application/services/ComplexityRoutingPolicy.ts',
      'domain/governance/calibration/ConfidenceCalibrator.ts',
      'domain/governance/guards/BaselineGuard.ts',
    ],
  },
  {
    id: 'RULE-L4',
    layer: 'OPERATIONS',
    title: 'Release and Runtime Guardrails',
    summary:
      'Risk trigger matrix, stop-loss governance, and knowledge version controls protect release quality.',
    implementationRefs: [
      'infrastructure/governance/riskTriggerMatrix.ts',
      'infrastructure/governance/stopLossGuard.ts',
      'infrastructure/governance/KnowledgeVersionGovernor.ts',
    ],
  },
] as const;

export const AUTHORITATIVE_GUIDELINE_REFERENCES: readonly GuidelineReference[] = [
  {
    id: 'NICE_NG136_2026',
    title: 'Hypertension in Adults: Diagnosis and Management (NG136)',
    publisher: 'NICE',
    publishedOn: '2019-08-28',
    lastUpdatedOn: '2026-02-03',
    url: 'https://www.nice.org.uk/guidance/ng136/chapter/Recommendations',
  },
  {
    id: 'ACC_AHA_BP_2025',
    title:
      '2025 Guideline for the Management of High Blood Pressure in Adults',
    publisher:
      'ACC / AHA / AHA / ABC / AAPA / AGS / APhA / ASPC / NMA / PCNA',
    publishedOn: '2025-09-03',
    url: 'https://www.acc.org/About-ACC/Press-Releases/2025/09/03/17/42/New-High-Blood-Pressure-Guideline',
  },
  {
    id: 'ADA_DIAGNOSIS_2026',
    title: 'Diabetes Diagnosis and Tests',
    publisher: 'American Diabetes Association',
    publishedOn: '2026-03-01',
    url: 'https://diabetes.org/about-diabetes/diagnosis',
  },
  {
    id: 'CDC_STROKE_SIGNS_2025',
    title: 'Stroke Signs and Symptoms',
    publisher: 'CDC',
    publishedOn: '2025-10-17',
    url: 'https://www.cdc.gov/stroke/signs-symptoms/index.html',
  },
  {
    id: 'ENDO_HYPOGLYCEMIA_2023',
    title:
      'Hypoglycemia Management in Diabetes: 2023 Endocrine Society Guideline',
    publisher: 'Endocrine Society',
    publishedOn: '2023-02-28',
    url: 'https://www.endocrine.org/clinical-practice-guidelines/high-risk-for-hypoglycemia',
  },
] as const;

const GUIDELINE_REFERENCE_BY_ID = new Map<string, GuidelineReference>(
  AUTHORITATIVE_GUIDELINE_REFERENCES.map((item) => [item.id, item]),
);

export const RULE_TO_GUIDELINE_IDS: Readonly<Record<string, string[]>> = {
  [RULE_IDS.BASIC_SAFETY_EMERGENCY_SYMPTOM]: [
    'CDC_STROKE_SIGNS_2025',
    'NICE_NG136_2026',
  ],
  [RULE_IDS.BASIC_SAFETY_STROKE_WARNING]: ['CDC_STROKE_SIGNS_2025'],
  [RULE_IDS.BASIC_SAFETY_LEVEL2_HYPOGLYCEMIA]: ['ENDO_HYPOGLYCEMIA_2023'],
  [RULE_IDS.FLOW_CONTROL_SEVERE_HTN_SAME_DAY]: [
    'NICE_NG136_2026',
    'ACC_AHA_BP_2025',
  ],
  [RULE_IDS.FLOW_CONTROL_STAGE2_HTN]: [
    'NICE_NG136_2026',
    'ACC_AHA_BP_2025',
  ],
  [RULE_IDS.FLOW_CONTROL_STAGE1_HTN_HIGH_RISK]: [
    'NICE_NG136_2026',
    'ACC_AHA_BP_2025',
  ],
  [RULE_IDS.FLOW_CONTROL_RANDOM_GLUCOSE_CLASSIC]: ['ADA_DIAGNOSIS_2026'],
} as const;

export const BP_THRESHOLDS = {
  crisis: { systolic: 180, diastolic: 120 },
  stage2Nice: { systolic: 160, diastolic: 100 },
  stage1Nice: { systolic: 140, diastolic: 90 },
  stage1AccAha: { systolic: 130, diastolic: 80 },
} as const;

export const BLOOD_GLUCOSE_THRESHOLDS = {
  randomDiagnostic: 200,
} as const;

export const HYPOGLYCEMIA_THRESHOLDS = {
  level1: 70,
  level2: 54,
} as const;

const EMERGENCY_SYMPTOM_TERMS = [
  'chest pain',
  'shortness of breath',
  'syncope',
  'severe headache',
  'neurological deficit',
  'new confusion',
  'confusion',
  'heart failure',
  'acute kidney injury',
  'chest pressure',
  '胸痛',
  '呼吸困难',
  '晕厥',
  '剧烈头痛',
  '神经功能缺损',
  '意识混乱',
  '心力衰竭',
  '急性肾损伤',
] as const;

const STROKE_WARNING_TERMS = [
  'sudden numbness',
  'sudden weakness',
  'face droop',
  'arm weakness',
  'speech difficulty',
  'sudden confusion',
  'trouble speaking',
  'trouble seeing',
  'trouble walking',
  'loss of balance',
  'severe headache',
  '口角歪斜',
  '肢体无力',
  '言语不清',
  '突发视物异常',
  '突发头痛',
  '步态不稳',
] as const;

const CLASSIC_HYPERGLYCEMIA_TERMS = [
  'thirst',
  'polyuria',
  'polyphagia',
  'unintentional weight loss',
  'weight loss',
  'fatigue',
  '口渴',
  '多尿',
  '多食',
  '体重下降',
  '乏力',
] as const;

const HIGH_RISK_COMORBIDITY_TERMS = [
  'diabetes',
  'prediabetes',
  'metabolic syndrome',
  'chronic kidney',
  'kidney disease',
  'renal',
  'coronary',
  'ischemic heart',
  'heart failure',
  'stroke',
  'tia',
  'peripheral artery',
  '糖尿病',
  '糖调节受损',
  '代谢综合征',
  '慢性肾病',
  '肾病',
  '冠心病',
  '心力衰竭',
  '脑卒中',
  '短暂性脑缺血',
] as const;

function toTextBag(profile: PatientProfile): string {
  const parts = [profile.chiefComplaint ?? '', ...(profile.symptoms ?? [])];
  return parts.join(' ').toLowerCase();
}

function includesAnyTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function findLatestSignalValue(
  signals: HealthSignal[],
  key:
    | 'systolicBP'
    | 'diastolicBP'
    | 'bloodGlucose'
    | 'heartRate'
    | 'spo2',
): number | undefined {
  return [...signals]
    .reverse()
    .find((signal) => Number.isFinite(signal[key]))
    ?.[key];
}

export function resolveLatestBloodPressure(
  profile: PatientProfile,
  signals: HealthSignal[] = [],
): { systolic?: number; diastolic?: number } {
  const systolic =
    profile.vitals?.systolicBP ?? findLatestSignalValue(signals, 'systolicBP');
  const diastolic =
    profile.vitals?.diastolicBP ??
    findLatestSignalValue(signals, 'diastolicBP');
  return { systolic, diastolic };
}

export function resolveLatestBloodGlucose(
  profile: PatientProfile,
  signals: HealthSignal[] = [],
): number | undefined {
  return (
    profile.vitals?.bloodGlucose ??
    findLatestSignalValue(signals, 'bloodGlucose')
  );
}

export function hasEmergencySymptoms(profile: PatientProfile): boolean {
  return includesAnyTerm(toTextBag(profile), EMERGENCY_SYMPTOM_TERMS);
}

export function hasStrokeWarningSymptoms(profile: PatientProfile): boolean {
  return includesAnyTerm(toTextBag(profile), STROKE_WARNING_TERMS);
}

export function hasClassicHyperglycemiaSymptoms(
  profile: PatientProfile,
): boolean {
  return includesAnyTerm(toTextBag(profile), CLASSIC_HYPERGLYCEMIA_TERMS);
}

export function hasHighRiskComorbidity(profile: PatientProfile): boolean {
  const bag = (profile.chronicDiseases ?? []).join(' ').toLowerCase();
  return includesAnyTerm(bag, HIGH_RISK_COMORBIDITY_TERMS);
}

export function isHypertensiveCrisis(
  systolic?: number,
  diastolic?: number,
): boolean {
  return (
    (systolic ?? 0) >= BP_THRESHOLDS.crisis.systolic ||
    (diastolic ?? 0) >= BP_THRESHOLDS.crisis.diastolic
  );
}

export function isStage2Hypertension(
  systolic?: number,
  diastolic?: number,
): boolean {
  return (
    (systolic ?? 0) >= BP_THRESHOLDS.stage2Nice.systolic ||
    (diastolic ?? 0) >= BP_THRESHOLDS.stage2Nice.diastolic
  );
}

export function isStage1HypertensionNice(
  systolic?: number,
  diastolic?: number,
): boolean {
  return (
    (systolic ?? 0) >= BP_THRESHOLDS.stage1Nice.systolic ||
    (diastolic ?? 0) >= BP_THRESHOLDS.stage1Nice.diastolic
  );
}

export function isStage1HypertensionAccAha(
  systolic?: number,
  diastolic?: number,
): boolean {
  return (
    (systolic ?? 0) >= BP_THRESHOLDS.stage1AccAha.systolic ||
    (diastolic ?? 0) >= BP_THRESHOLDS.stage1AccAha.diastolic
  );
}

export function isRandomGlucoseDiagnostic(glucose?: number): boolean {
  return (glucose ?? 0) >= BLOOD_GLUCOSE_THRESHOLDS.randomDiagnostic;
}

export function isSevereHypoglycemia(glucose?: number): boolean {
  return (glucose ?? Number.POSITIVE_INFINITY) < HYPOGLYCEMIA_THRESHOLDS.level2;
}

export interface EmergencySignalSnapshot {
  immediateEmergency: boolean;
  urgentSameDaySpecialistReview: boolean;
  severeHypertension: boolean;
  emergencySymptoms: boolean;
  strokeWarningSymptoms: boolean;
  severeHypoglycemia: boolean;
  matchedRuleIds: string[];
  synonymSetVersion: string;
  evidence: string[];
}

export function evaluateEmergencySignalSnapshot(
  profile: PatientProfile,
  signals: HealthSignal[] = [],
): EmergencySignalSnapshot {
  const { systolic, diastolic } = resolveLatestBloodPressure(profile, signals);
  const glucose = resolveLatestBloodGlucose(profile, signals);

  const severeHypertension = isHypertensiveCrisis(systolic, diastolic);
  const emergencySymptoms = hasEmergencySymptoms(profile);
  const strokeWarningSymptoms = hasStrokeWarningSymptoms(profile);
  const severeHypoglycemia = isSevereHypoglycemia(glucose);

  const immediateEmergency =
    emergencySymptoms || strokeWarningSymptoms || severeHypoglycemia;
  const urgentSameDaySpecialistReview = severeHypertension;

  const evidence: string[] = [];
  const matchedRuleIds: string[] = [];
  if (severeHypertension) {
    matchedRuleIds.push(RULE_IDS.FLOW_CONTROL_SEVERE_HTN_SAME_DAY);
    evidence.push(
      `Severe hypertension detected (SBP=${systolic ?? 'NA'}, DBP=${diastolic ?? 'NA'}).`,
    );
  }
  if (emergencySymptoms) {
    matchedRuleIds.push(RULE_IDS.BASIC_SAFETY_EMERGENCY_SYMPTOM);
    evidence.push('Life-threatening symptom pattern detected.');
  }
  if (strokeWarningSymptoms) {
    matchedRuleIds.push(RULE_IDS.BASIC_SAFETY_STROKE_WARNING);
    evidence.push('Stroke warning symptom pattern detected.');
  }
  if (severeHypoglycemia) {
    matchedRuleIds.push(RULE_IDS.BASIC_SAFETY_LEVEL2_HYPOGLYCEMIA);
    evidence.push(
      `Level-2 hypoglycemia detected (glucose=${glucose ?? 'NA'} mg/dL).`,
    );
  }

  return {
    immediateEmergency,
    urgentSameDaySpecialistReview,
    severeHypertension,
    emergencySymptoms,
    strokeWarningSymptoms,
    severeHypoglycemia,
    matchedRuleIds: [...new Set(matchedRuleIds)],
    synonymSetVersion: RED_FLAG_SYNONYM_SET_VERSION,
    evidence,
  };
}

export function buildGuidelineBasis(): string[] {
  return AUTHORITATIVE_GUIDELINE_REFERENCES.map(
    (item) => `${item.id}: ${item.title} (${item.url})`,
  );
}

export function resolveGuidelineReferencesByRuleIds(
  ruleIds: readonly string[],
): GuidelineReference[] {
  const guidelineIds = new Set<string>();
  for (const ruleId of ruleIds) {
    const mapped = RULE_TO_GUIDELINE_IDS[ruleId] ?? [];
    for (const guidelineId of mapped) {
      guidelineIds.add(guidelineId);
    }
  }

  if (guidelineIds.size === 0) {
    return [...AUTHORITATIVE_GUIDELINE_REFERENCES];
  }

  const resolved: GuidelineReference[] = [];
  for (const guidelineId of guidelineIds) {
    const guideline = GUIDELINE_REFERENCE_BY_ID.get(guidelineId);
    if (guideline) {
      resolved.push(guideline);
    }
  }
  return resolved;
}

export function buildGuidelineBasisByRuleIds(
  ruleIds: readonly string[],
): string[] {
  return resolveGuidelineReferencesByRuleIds(ruleIds).map(
    (item) =>
      `${item.id}: ${item.title} (${item.publisher}, ${item.publishedOn})`,
  );
}

export function listLayeredRules(
  layer?: GovernanceRuleLayer,
): LayeredRuleDescriptor[] {
  if (!layer) {
    return [...LAYERED_RULE_DESCRIPTORS];
  }
  return LAYERED_RULE_DESCRIPTORS.filter((item) => item.layer === layer);
}
