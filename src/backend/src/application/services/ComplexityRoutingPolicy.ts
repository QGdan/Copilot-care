import {
  PatientProfile,
  RoutingFactorContribution,
  TriageCollaborationMode,
  TriageDepartment,
  TriageRouteMode,
  TriageRoutingInfo,
} from '@copilot-care/shared/types';
import {
  evaluateEmergencySignalSnapshot,
  hasHighRiskComorbidity,
  isRandomGlucoseDiagnostic,
  isStage1HypertensionAccAha,
  isStage2Hypertension,
  RULE_IDS,
  resolveLatestBloodPressure,
} from '../../domain/rules/AuthoritativeMedicalRuleCatalog';

export interface ComplexityScoreResult {
  score: number;
  reasons: string[];
  factorContributions: RoutingFactorContribution[];
  matchedRuleIds: string[];
}

export interface RoutingDecision extends TriageRoutingInfo {
  matchedRuleIds: string[];
}

interface DepartmentTriageDecision {
  department: TriageDepartment;
  reasons: string[];
  cardioSignalScore: number;
  metabolicSignalScore: number;
}

const DEPARTMENT_LABELS: Record<TriageDepartment, string> = {
  cardiology: 'Cardiology',
  generalPractice: 'General Practice',
  metabolic: 'Metabolic',
  multiDisciplinary: 'Multi-disciplinary',
};

const CARDIO_DISEASE_TERMS = [
  'hypertension',
  'high blood pressure',
  'coronary',
  'arrhythmia',
  'heart failure',
  '高血压',
  '冠心病',
  '心律失常',
  '心衰',
];

const METABOLIC_DISEASE_TERMS = [
  'diabetes',
  'prediabetes',
  'dyslipidemia',
  'hyperlipidemia',
  'obesity',
  'metabolic syndrome',
  '糖尿病',
  '糖耐量异常',
  '血脂异常',
  '高脂血症',
  '肥胖',
];

const CARDIO_SYMPTOM_TERMS = [
  'chest',
  'palpitation',
  'dyspnea',
  'edema',
  '胸闷',
  '胸痛',
  '心悸',
  '气促',
];

const METABOLIC_SYMPTOM_TERMS = [
  'thirst',
  'polyuria',
  'polyphagia',
  'fatigue',
  'weight loss',
  '口渴',
  '多尿',
  '乏力',
  '体重下降',
];

const CROSS_SYSTEM_TERMS = [
  'headache',
  'dizziness',
  'shortness of breath',
  '头痛',
  '头晕',
  '呼吸困难',
];

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function hasRedFlag(profile: PatientProfile): boolean {
  return evaluateEmergencySignalSnapshot(profile).immediateEmergency;
}

function hasRiskBoundarySignal(profile: PatientProfile): boolean {
  if (hasRedFlag(profile)) {
    return true;
  }

  const emergencySignals = evaluateEmergencySignalSnapshot(profile);
  if (emergencySignals.urgentSameDaySpecialistReview) {
    return true;
  }

  const { systolic, diastolic } = resolveLatestBloodPressure(profile);
  if (isStage2Hypertension(systolic, diastolic)) {
    return true;
  }

  return (
    isStage1HypertensionAccAha(systolic, diastolic) &&
    hasHighRiskComorbidity(profile)
  );
}

function isCoreInformationMissing(profile: PatientProfile): boolean {
  const hasComplaint =
    typeof profile.chiefComplaint === 'string' &&
    profile.chiefComplaint.trim().length > 0;
  const hasSymptom = Array.isArray(profile.symptoms) && profile.symptoms.length > 0;
  const hasBloodPressure =
    Number.isFinite(profile.vitals?.systolicBP) &&
    Number.isFinite(profile.vitals?.diastolicBP);
  const hasHistory =
    (Array.isArray(profile.chronicDiseases) && profile.chronicDiseases.length > 0) ||
    (Array.isArray(profile.medicationHistory) &&
      profile.medicationHistory.length > 0);

  return !(hasBloodPressure && hasHistory && (hasComplaint || hasSymptom));
}

function detectSymptomSystems(symptoms: string[]): number {
  let cardio = 0;
  let metabolic = 0;
  let crossSystem = 0;

  for (const symptom of symptoms) {
    if (hasAnyKeyword(symptom, CARDIO_SYMPTOM_TERMS)) {
      cardio += 1;
    }
    if (hasAnyKeyword(symptom, METABOLIC_SYMPTOM_TERMS)) {
      metabolic += 1;
    }
    if (hasAnyKeyword(symptom, CROSS_SYSTEM_TERMS)) {
      crossSystem += 1;
    }
  }

  return [cardio, metabolic, crossSystem].filter((count) => count > 0).length;
}

function hasHistoryWorseningSignal(profile: PatientProfile): boolean {
  const textParts = [profile.chiefComplaint ?? '', ...(profile.symptoms ?? [])];
  const text = textParts.join(' ').toLowerCase();
  return /worsen|persistent|recurrent|加重|持续|反复/.test(text);
}

function detectDepartment(profile: PatientProfile): DepartmentTriageDecision {
  const diseases = profile.chronicDiseases ?? [];
  const symptoms = profile.symptoms ?? [];
  let cardioSignalScore = 0;
  let metabolicSignalScore = 0;

  for (const disease of diseases) {
    if (hasAnyKeyword(disease, CARDIO_DISEASE_TERMS)) {
      cardioSignalScore += 2;
    }
    if (hasAnyKeyword(disease, METABOLIC_DISEASE_TERMS)) {
      metabolicSignalScore += 2;
    }
  }

  for (const symptom of symptoms) {
    if (hasAnyKeyword(symptom, CARDIO_SYMPTOM_TERMS)) {
      cardioSignalScore += 1;
    }
    if (hasAnyKeyword(symptom, METABOLIC_SYMPTOM_TERMS)) {
      metabolicSignalScore += 1;
    }
  }

  if (
    (profile.vitals?.systolicBP ?? 0) >= 140 ||
    (profile.vitals?.diastolicBP ?? 0) >= 90
  ) {
    cardioSignalScore += 1;
  }

  if (isRandomGlucoseDiagnostic(profile.vitals?.bloodGlucose)) {
    metabolicSignalScore += 2;
  }

  if (cardioSignalScore === 0 && metabolicSignalScore === 0) {
    return {
      department: 'generalPractice',
      reasons: [
        'No clear specialty signal detected; start with general-practice panel.',
      ],
      cardioSignalScore,
      metabolicSignalScore,
    };
  }

  if (Math.abs(cardioSignalScore - metabolicSignalScore) <= 1) {
    return {
      department: 'generalPractice',
      reasons: [
        'Cardio and metabolic signals are close; use general-practice panel first.',
      ],
      cardioSignalScore,
      metabolicSignalScore,
    };
  }

  if (metabolicSignalScore > cardioSignalScore) {
    return {
      department: 'metabolic',
      reasons: ['Metabolic signal dominates; route to metabolic panel.'],
      cardioSignalScore,
      metabolicSignalScore,
    };
  }

  return {
    department: 'cardiology',
    reasons: ['Cardiovascular signal dominates; route to cardiology panel.'],
    cardioSignalScore,
    metabolicSignalScore,
  };
}

function resolveModeByComplexity(
  score: number,
  forceAtLeastLightDebate: boolean,
): TriageRouteMode {
  if (score <= 2) {
    return forceAtLeastLightDebate ? 'LIGHT_DEBATE' : 'FAST_CONSENSUS';
  }
  if (score <= 5) {
    return 'LIGHT_DEBATE';
  }
  return 'DEEP_DEBATE';
}

function resolveCollaborationMode(
  mode: TriageRouteMode,
): TriageCollaborationMode {
  if (mode === 'DEEP_DEBATE') {
    return 'MULTI_DISCIPLINARY_CONSULT';
  }
  if (mode === 'ESCALATE_TO_OFFLINE') {
    return 'OFFLINE_ESCALATION';
  }
  return 'SINGLE_SPECIALTY_PANEL';
}

export function evaluateComplexityScore(
  profile: PatientProfile,
): ComplexityScoreResult {
  const reasons: string[] = [];
  const factorContributions: RoutingFactorContribution[] = [];
  const matchedRuleIds: string[] = [];
  let score = 0;

  if (isCoreInformationMissing(profile)) {
    score += 2;
    matchedRuleIds.push(RULE_IDS.FLOW_CONTROL_MINIMUM_INFOSET_GATE);
    factorContributions.push({
      factor: 'minimum_information_set',
      score: 2,
      rationale:
        'Core intake information is incomplete; minimum information gate forces deeper routing.',
    });
    reasons.push('Core information is incomplete (+2).');
  }

  const symptomCount = (profile.symptoms ?? []).length;
  const crossSystems = detectSymptomSystems(profile.symptoms ?? []);
  if (symptomCount >= 3 && crossSystems >= 2) {
    score += 2;
    matchedRuleIds.push(RULE_IDS.INTELLIGENT_COLLAB_COMPLEXITY_MULTI_SYSTEM);
    factorContributions.push({
      factor: 'multi_system_symptoms',
      score: 2,
      rationale: 'Symptoms cross systems with >=3 entries, increasing orchestration complexity.',
    });
    reasons.push('Symptoms >=3 across multiple systems (+2).');
  }

  if ((profile.chronicDiseases ?? []).length >= 2) {
    score += 2;
    matchedRuleIds.push(
      RULE_IDS.INTELLIGENT_COLLAB_COMPLEXITY_MULTI_COMORBIDITY,
    );
    factorContributions.push({
      factor: 'multi_comorbidity',
      score: 2,
      rationale: 'Two or more chronic comorbidities require broader consensus checks.',
    });
    reasons.push('Multi-comorbidity burden >=2 (+2).');
  }

  if (hasRiskBoundarySignal(profile)) {
    score += 3;
    matchedRuleIds.push(RULE_IDS.INTELLIGENT_COLLAB_COMPLEXITY_RISK_BOUNDARY);
    factorContributions.push({
      factor: 'risk_boundary_signal',
      score: 3,
      rationale: 'Risk-boundary signal detected; conservative routing weight increased.',
    });
    reasons.push('Risk-boundary signal detected (+3).');
  }

  if (hasHistoryWorseningSignal(profile)) {
    score += 1;
    matchedRuleIds.push(
      RULE_IDS.INTELLIGENT_COLLAB_COMPLEXITY_WORSENING_HISTORY,
    );
    factorContributions.push({
      factor: 'worsening_history',
      score: 1,
      rationale: 'History trend indicates worsening trajectory.',
    });
    reasons.push('Worsening history signal detected (+1).');
  }

  return {
    score,
    reasons,
    factorContributions,
    matchedRuleIds: [...new Set(matchedRuleIds)],
  };
}

export function decideRouting(profile: PatientProfile): RoutingDecision {
  const complexity = evaluateComplexityScore(profile);
  const missingCoreInfo = isCoreInformationMissing(profile);

  if (hasRedFlag(profile)) {
    return {
      complexityScore: complexity.score,
      routeMode: 'ESCALATE_TO_OFFLINE',
      department: 'multiDisciplinary',
      collaborationMode: 'OFFLINE_ESCALATION',
      factorContributions: complexity.factorContributions,
      matchedRuleIds: [
        ...complexity.matchedRuleIds,
        RULE_IDS.INTELLIGENT_COLLAB_ROUTE_ESCALATE,
      ],
      reasons: [
        'Emergency red-flag boundary triggered; escalate to offline immediately.',
        ...complexity.reasons,
      ],
    };
  }

  const triageDepartment = detectDepartment(profile);
  const routeMode = resolveModeByComplexity(complexity.score, missingCoreInfo);
  const department =
    routeMode === 'DEEP_DEBATE' ? 'multiDisciplinary' : triageDepartment.department;

  const reasons = [
    `Initial routing: ${DEPARTMENT_LABELS[triageDepartment.department]} (cardio=${triageDepartment.cardioSignalScore}, metabolic=${triageDepartment.metabolicSignalScore})`,
    ...triageDepartment.reasons,
    ...complexity.reasons,
  ];

  if (missingCoreInfo) {
    reasons.push(
      'Minimum information set is incomplete; disallow fast consensus and use at least light debate.',
    );
  }

  if (routeMode === 'DEEP_DEBATE') {
    reasons.push(
      'Complexity reached deep-debate threshold; switch to multi-disciplinary collaboration.',
    );
  }

  return {
    complexityScore: complexity.score,
    routeMode,
    department,
    collaborationMode: resolveCollaborationMode(routeMode),
    factorContributions: complexity.factorContributions,
    matchedRuleIds: [
      ...complexity.matchedRuleIds,
      routeMode === 'FAST_CONSENSUS'
        ? RULE_IDS.INTELLIGENT_COLLAB_ROUTE_FAST
        : routeMode === 'LIGHT_DEBATE'
          ? RULE_IDS.INTELLIGENT_COLLAB_ROUTE_LIGHT
          : RULE_IDS.INTELLIGENT_COLLAB_ROUTE_DEEP,
    ],
    reasons,
  };
}
