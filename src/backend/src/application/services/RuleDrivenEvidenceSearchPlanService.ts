import { TriageRequest } from '@copilot-care/shared/types';
import { RULE_IDS } from '../../domain/rules/AuthoritativeMedicalRuleCatalog';
import { RiskAssessmentSnapshot } from './RuleFirstRiskAssessmentService';

export interface RuleDrivenEvidenceSearchPlan {
  query: string;
  queryVariants: string[];
  limit: number;
  sourceFilter: string[];
  requiredSources: string[];
  minEvidenceCount: number;
  decomposedNeeds: string[];
  professionalRestatement: string;
  strategyNotes: string[];
  activatedSkills: string[];
}

interface BuildRuleDrivenEvidenceSearchPlanInput {
  request: TriageRequest;
  risk: RiskAssessmentSnapshot;
}

const DEFAULT_SOURCE_FILTER = [
  'NICE',
  'WHO',
  'CDC_US',
  'NHC_CN',
  'CDC_CN',
  'PUBMED',
] as const;
const MAX_QUERY_VARIANTS = 6;
const MAX_QUERY_LENGTH = 300;
const MAX_RESTATEMENT_LENGTH = 380;

const CLINICAL_TERM_HINTS: Array<{
  pattern: RegExp;
  en: string;
  zh: string;
}> = [
  { pattern: /\bhypertension\b|高血压|血压|收缩压|舒张压/i, en: 'hypertension blood pressure', zh: '高血压 血压' },
  { pattern: /\bstroke\b|卒中|中风|fast|面瘫|言语障碍/i, en: 'stroke warning sign fast', zh: '卒中 预警 FAST' },
  { pattern: /\bdiabetes\b|糖尿病|血糖|高血糖|低血糖|hba1c/i, en: 'diabetes glucose threshold', zh: '糖尿病 血糖 阈值' },
  { pattern: /\bdizziness\b|头晕|眩晕/i, en: 'dizziness differential diagnosis', zh: '头晕 鉴别诊断' },
  { pattern: /\bheadache\b|头痛/i, en: 'headache red flag', zh: '头痛 红旗信号' },
  { pattern: /\bchest pain\b|胸痛|胸闷/i, en: 'chest pain emergency triage', zh: '胸痛 急诊 分诊' },
  { pattern: /\bpalpitation\b|心悸/i, en: 'palpitation cardiac risk', zh: '心悸 心血管 风险' },
  { pattern: /\bfatigue\b|乏力/i, en: 'fatigue risk stratification', zh: '乏力 风险分层' },
  { pattern: /\bedema\b|水肿/i, en: 'edema heart failure risk', zh: '水肿 心衰 风险' },
  { pattern: /\bblurred vision\b|视物模糊/i, en: 'blurred vision hypertension emergency', zh: '视物模糊 高血压 急症' },
];

interface ClinicalFocusProfile {
  hasHypertensionFocus: boolean;
  hasGlucoseFocus: boolean;
  hasStrokeFocus: boolean;
  hasCardiacFocus: boolean;
}

const HYPERTENSION_FOCUS_PATTERN =
  /\b(hypertension|blood pressure|systolic|diastolic)\b|高血压|血压|收缩压|舒张压/i;
const GLUCOSE_FOCUS_PATTERN =
  /\b(diabetes|glucose|hyperglycemia|hypoglycemia|hba1c|polyuria|polydipsia|thirst)\b|糖尿病|血糖|高血糖|低血糖|多尿|多饮|口渴/i;
const STROKE_FOCUS_PATTERN =
  /\b(stroke|fast|facial droop|speech|arm weakness|neurologic)\b|卒中|中风|面瘫|言语障碍|肢体无力|口角歪斜/i;
const CARDIAC_FOCUS_PATTERN =
  /\b(chest pain|palpitation|dyspnea|shortness of breath|heart failure|cardiac|cardiovascular)\b|胸痛|胸闷|心悸|气短|呼吸困难|心衰|心力衰竭|心脏|心血管/i;

function hasAbnormalBloodPressure(vitals: TriageRequest['profile']['vitals'] | undefined): boolean {
  if (!vitals) {
    return false;
  }
  const systolic = vitals.systolicBP;
  const diastolic = vitals.diastolicBP;
  if (typeof systolic !== 'number' || typeof diastolic !== 'number') {
    return false;
  }
  return (
    systolic >= 140 ||
    diastolic >= 90 ||
    systolic <= 90 ||
    diastolic <= 60
  );
}

function hasAbnormalBloodGlucose(vitals: TriageRequest['profile']['vitals'] | undefined): boolean {
  if (!vitals || typeof vitals.bloodGlucose !== 'number') {
    return false;
  }
  return vitals.bloodGlucose >= 11.1 || vitals.bloodGlucose <= 3.9;
}

function hasAbnormalSpo2(vitals: TriageRequest['profile']['vitals'] | undefined): boolean {
  return Boolean(vitals && typeof vitals.spo2 === 'number' && vitals.spo2 <= 93);
}

function inferClinicalFocusProfile(request: TriageRequest): ClinicalFocusProfile {
  const bag = dedupe([
    normalizeText(request.symptomText),
    normalizeText(request.profile.chiefComplaint),
    ...normalizeList(request.profile.symptoms),
    ...normalizeList(request.profile.chronicDiseases),
  ]).join(' ');
  const vitals = request.profile.vitals;

  return {
    hasHypertensionFocus:
      HYPERTENSION_FOCUS_PATTERN.test(bag) || hasAbnormalBloodPressure(vitals),
    hasGlucoseFocus:
      GLUCOSE_FOCUS_PATTERN.test(bag) || hasAbnormalBloodGlucose(vitals),
    hasStrokeFocus: STROKE_FOCUS_PATTERN.test(bag),
    hasCardiacFocus: CARDIAC_FOCUS_PATTERN.test(bag),
  };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeList(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  return dedupe(
    values
      .map((item) => normalizeText(item))
      .filter((item) => item.length > 0),
  );
}

function buildVitalHints(request: TriageRequest): string[] {
  const hints: string[] = [];
  const vitals = request.profile.vitals;
  if (!vitals) {
    return hints;
  }

  const systolic = vitals.systolicBP;
  const diastolic = vitals.diastolicBP;
  if (typeof systolic === 'number' && typeof diastolic === 'number') {
    hints.push(`血压 ${systolic}/${diastolic} mmHg`);
    if (systolic >= 180 || diastolic >= 120) {
      hints.push('severe hypertension immediate assessment');
      hints.push('重度高血压 急诊评估');
    } else if (systolic >= 140 || diastolic >= 90) {
      hints.push('stage-2 hypertension risk stratification');
      hints.push('高血压 分级 风险分层');
    }
  }

  if (typeof vitals.bloodGlucose === 'number') {
    hints.push(`随机血糖 ${vitals.bloodGlucose}`);
    if (vitals.bloodGlucose >= 11.1) {
      hints.push('hyperglycemia diagnostic threshold');
      hints.push('高血糖 诊断阈值');
    }
    if (vitals.bloodGlucose <= 3.9) {
      hints.push('hypoglycemia emergency management');
      hints.push('低血糖 急性处理');
    }
  }

  if (typeof vitals.spo2 === 'number' && vitals.spo2 <= 93) {
    hints.push(`血氧 ${vitals.spo2}%`);
    hints.push('low oxygen saturation red flag');
    hints.push('低氧 红旗信号');
  }

  return dedupe(hints);
}

function buildQueryVitalHints(
  request: TriageRequest,
  focus: ClinicalFocusProfile,
): string[] {
  const hints: string[] = [];
  const vitals = request.profile.vitals;
  if (!vitals) {
    return hints;
  }

  if (
    typeof vitals.systolicBP === 'number' &&
    typeof vitals.diastolicBP === 'number' &&
    (focus.hasHypertensionFocus || hasAbnormalBloodPressure(vitals))
  ) {
    hints.push(`血压 ${vitals.systolicBP}/${vitals.diastolicBP} mmHg`);
    if (vitals.systolicBP >= 180 || vitals.diastolicBP >= 120) {
      hints.push('severe hypertension immediate assessment');
      hints.push('重度高血压 急诊评估');
    } else if (vitals.systolicBP >= 140 || vitals.diastolicBP >= 90) {
      hints.push('stage-2 hypertension risk stratification');
      hints.push('高血压 分级 风险分层');
    }
  }

  if (
    typeof vitals.bloodGlucose === 'number' &&
    (focus.hasGlucoseFocus || hasAbnormalBloodGlucose(vitals))
  ) {
    hints.push(`随机血糖 ${vitals.bloodGlucose}`);
    if (vitals.bloodGlucose >= 11.1) {
      hints.push('hyperglycemia diagnostic threshold');
      hints.push('高血糖 诊断阈值');
    } else if (vitals.bloodGlucose <= 3.9) {
      hints.push('hypoglycemia emergency management');
      hints.push('低血糖 急性处理');
    }
  }

  if (hasAbnormalSpo2(vitals)) {
    hints.push(`血氧 ${vitals.spo2}%`);
    hints.push('low oxygen saturation red flag');
    hints.push('低氧 红旗信号');
  }

  return dedupe(hints);
}

function buildProfessionalRestatement(input: {
  request: TriageRequest;
  risk: RiskAssessmentSnapshot;
  decomposedNeeds: string[];
  requiredSources: string[];
}): string {
  const symptomParts = dedupe([
    normalizeText(input.request.symptomText),
    normalizeText(input.request.profile.chiefComplaint),
    ...normalizeList(input.request.profile.symptoms),
  ]).slice(0, 5);
  const chronicDiseases = normalizeList(input.request.profile.chronicDiseases).slice(
    0,
    4,
  );
  const vitalHints = buildVitalHints(input.request)
    .filter((item) => /mmhg|血压|血糖|血氧/i.test(item))
    .slice(0, 2);

  const symptomText =
    symptomParts.length > 0 ? symptomParts.join('、') : '症状描述有限';
  const chronicText =
    chronicDiseases.length > 0 ? chronicDiseases.join('、') : '未提供明确慢病史';
  const vitalText = vitalHints.length > 0 ? vitalHints.join('；') : '生命体征信息有限';
  const needText = input.decomposedNeeds.slice(0, 4).join('；');
  const sourceText =
    input.requiredSources.length > 0
      ? input.requiredSources.join('、')
      : 'WHO/NICE/CDC/PubMed';

  return truncateText(
    `临床检索任务重述：患者主诉与症状为${symptomText}，慢病背景为${chronicText}，关键生命体征为${vitalText}。` +
      `请围绕${needText}进行权威证据检索，优先输出${sourceText}来源中的诊断阈值、风险分层、处置时效与随访频率。`,
    MAX_RESTATEMENT_LENGTH,
  );
}

function buildNeedDecomposition(input: {
  hasHypertensionRule: boolean;
  hasStrokeRule: boolean;
  hasGlucoseRule: boolean;
  hasCardiacFocus: boolean;
  riskNumeric: number;
}): string[] {
  const needs: string[] = [
    '拆解主诉与伴随症状，识别当前场景的核心临床问题。',
  ];
  if (input.hasHypertensionRule) {
    needs.push('提取血压阈值、分级标准与心血管风险分层依据。');
  }
  if (input.hasStrokeRule) {
    needs.push('识别卒中/急症红旗信号与急诊上转时效要求。');
  }
  if (input.hasGlucoseRule) {
    needs.push('提取高低血糖诊断边界与急性风险处理证据。');
  }
  if (input.hasCardiacFocus) {
    needs.push('提取心悸/气短/胸痛等心血管症状的危险分层与转诊触发条件。');
  }
  if (input.riskNumeric >= 2) {
    needs.push('补充高风险患者的复评频率与跨科会诊触发条件。');
  } else {
    needs.push('补充低中风险随访计划与生活方式管理要点。');
  }
  needs.push('输出可执行建议时需给出对应证据出处与适用条件。');
  return dedupe(needs);
}

function expandClinicalKeywordsFromText(values: readonly string[]): string[] {
  const bag = values.join(' ').toLowerCase();
  const keywords: string[] = [];
  for (const rule of CLINICAL_TERM_HINTS) {
    if (rule.pattern.test(bag)) {
      keywords.push(rule.en, rule.zh);
    }
  }
  return dedupe(keywords);
}

function buildCaseAnchoredQueryVariants(input: {
  request: TriageRequest;
  decomposedNeeds: string[];
  focus: ClinicalFocusProfile;
}): string[] {
  const symptomParts = dedupe([
    normalizeText(input.request.symptomText),
    normalizeText(input.request.profile.chiefComplaint),
    ...normalizeList(input.request.profile.symptoms),
  ]);
  const chronicParts = normalizeList(input.request.profile.chronicDiseases);
  const vitals = input.request.profile.vitals;
  const termHints = expandClinicalKeywordsFromText([...symptomParts, ...chronicParts]);
  const variants: string[] = [];
  const bpAbnormal = hasAbnormalBloodPressure(vitals);
  const glucoseAbnormal = hasAbnormalBloodGlucose(vitals);
  const spo2Abnormal = hasAbnormalSpo2(vitals);

  if (
    typeof vitals?.systolicBP === 'number'
    && typeof vitals?.diastolicBP === 'number'
    && (input.focus.hasHypertensionFocus || bpAbnormal)
  ) {
    variants.push(
      `blood pressure ${vitals.systolicBP}/${vitals.diastolicBP} mmHg threshold triage referral follow-up guideline`,
      `收缩压 ${vitals.systolicBP} 舒张压 ${vitals.diastolicBP} 高血压 阈值 分诊 转诊 随访 指南`,
    );
  }
  if (
    typeof vitals?.bloodGlucose === 'number'
    && (input.focus.hasGlucoseFocus || glucoseAbnormal)
  ) {
    variants.push(
      `blood glucose ${vitals.bloodGlucose} diabetes diagnostic threshold follow-up guideline`,
      `血糖 ${vitals.bloodGlucose} 糖尿病 诊断阈值 随访 指南`,
    );
  }
  if (typeof vitals?.spo2 === 'number' && spo2Abnormal) {
    variants.push(
      `SpO2 ${vitals.spo2}% hypoxemia red flag emergency triage guideline`,
      `血氧 ${vitals.spo2}% 低氧 红旗信号 急诊 分诊 指南`,
    );
  }

  const symptomClause = symptomParts.slice(0, 4).join(' ');
  if (symptomClause) {
    if (input.focus.hasStrokeFocus) {
      variants.push(
        `${symptomClause} differential diagnosis red flag triage guideline`,
        `${symptomClause} 鉴别诊断 红旗信号 分诊 指南`,
      );
    } else {
      variants.push(
        `${symptomClause} differential diagnosis follow-up guideline`,
        `${symptomClause} 鉴别诊断 随访 指南`,
      );
    }
  }

  if (input.focus.hasCardiacFocus) {
    variants.push(
      'palpitation dyspnea chest pain heart failure risk stratification referral guideline',
      '心悸 气短 胸痛 心衰 风险分层 转诊 指南',
    );
  }
  if (input.focus.hasStrokeFocus) {
    variants.push(
      'stroke fast warning signs emergency referral guideline',
      '卒中 FAST 预警信号 急诊 转诊 指南',
    );
  }

  if (termHints.length > 0) {
    variants.push(
      `${termHints.slice(0, 6).join(' ')} guideline threshold risk stratification follow-up`,
      `${termHints.slice(0, 6).join(' ')} 指南 阈值 风险分层 随访`,
    );
  }
  if (input.decomposedNeeds.length > 0) {
    variants.push(
      `${input.decomposedNeeds.slice(0, 2).join(' ')} 权威 医学 指南`,
    );
  }

  return dedupe(variants)
    .map((item) => truncateText(item, MAX_QUERY_LENGTH))
    .slice(0, 10);
}

function buildQueryVariants(input: {
  request: TriageRequest;
  queryKeywords: string[];
  decomposedNeeds: string[];
  focus: ClinicalFocusProfile;
}): string[] {
  const symptomContext = dedupe([
    normalizeText(input.request.symptomText),
    normalizeText(input.request.profile.chiefComplaint),
    ...normalizeList(input.request.profile.symptoms),
  ])
    .join(' ')
    .trim();
  const chronicContext = normalizeList(input.request.profile.chronicDiseases)
    .slice(0, 4)
    .join(' ');
  const vitalHints = buildQueryVitalHints(input.request, input.focus).join(' ');
  const contextClause = dedupe([symptomContext, chronicContext, vitalHints])
    .join(' ')
    .trim();

  const genericVariants = [
    `${contextClause} guideline risk stratification triage threshold follow-up`,
    `${contextClause} 指南 风险分层 分诊 阈值 随访`,
    `${contextClause} evidence based clinical recommendation`,
    `${input.decomposedNeeds.slice(0, 3).join(' ')} 权威 指南 共识`,
  ];
  const caseAnchoredVariants = buildCaseAnchoredQueryVariants({
    request: input.request,
    decomposedNeeds: input.decomposedNeeds,
    focus: input.focus,
  });

  return dedupe([
    ...input.queryKeywords,
    ...caseAnchoredVariants,
    ...genericVariants,
  ])
    .map((item) => normalizeText(item))
    .filter((item) => item.length >= 8)
    .map((item) => truncateText(item, MAX_QUERY_LENGTH))
    .slice(0, MAX_QUERY_VARIANTS);
}

function riskToNumeric(level: RiskAssessmentSnapshot['riskLevel']): number {
  if (level === 'L3') {
    return 3;
  }
  if (level === 'L2') {
    return 2;
  }
  if (level === 'L1') {
    return 1;
  }
  return 0;
}

function buildActivatedSkills(input: {
  riskNumeric: number;
  hasHypertensionRule: boolean;
  hasStrokeRule: boolean;
  hasGlucoseRule: boolean;
  hasCardiacFocus: boolean;
}): string[] {
  const skills = new Set<string>([
    'need_decomposition',
    'professional_restatement',
    'query_rewrite',
    'network_authority_recall',
    'hybrid_retrieval_fusion',
    'local_vector_recall',
  ]);
  if (input.hasHypertensionRule) {
    skills.add('hypertension_guideline_focus');
  }
  if (input.hasStrokeRule) {
    skills.add('stroke_red_flag_focus');
  }
  if (input.hasGlucoseRule) {
    skills.add('glucose_threshold_focus');
  }
  if (input.hasCardiacFocus) {
    skills.add('cardiac_risk_focus');
  }
  if (input.riskNumeric >= 2) {
    skills.add('evidence_completeness_gate');
  }
  return [...skills];
}

export class RuleDrivenEvidenceSearchPlanService {
  public build(
    input: BuildRuleDrivenEvidenceSearchPlanInput,
  ): RuleDrivenEvidenceSearchPlan {
    const riskLevel = input.risk.riskLevel;
    const matchedRuleIds = new Set(input.risk.matchedRuleIds);
    const strategyNotes: string[] = [];
    const focusProfile = inferClinicalFocusProfile(input.request);
    const vitals = input.request.profile.vitals;

    const queryParts = [
      normalizeText(input.request.symptomText),
      normalizeText(input.request.profile.chiefComplaint),
      ...(input.request.profile.symptoms ?? []).map((item) => normalizeText(item)),
      ...(input.request.profile.chronicDiseases ?? []).map((item) =>
        normalizeText(item),
      ),
    ].filter((item) => item.length > 0);

    const queryKeywords: string[] = [];

    const hasHypertensionRule =
      matchedRuleIds.has(RULE_IDS.FLOW_CONTROL_STAGE2_HTN) ||
      matchedRuleIds.has(RULE_IDS.FLOW_CONTROL_STAGE1_HTN_HIGH_RISK) ||
      matchedRuleIds.has(RULE_IDS.FLOW_CONTROL_SEVERE_HTN_SAME_DAY);
    const useHypertensionFocus =
      hasHypertensionRule ||
      focusProfile.hasHypertensionFocus ||
      hasAbnormalBloodPressure(vitals);
    if (useHypertensionFocus) {
      queryKeywords.push(
        'hypertension guideline blood pressure management',
        'high blood pressure diagnosis threshold treatment target',
        '成人 高血压 血压 分层 管理',
      );
      strategyNotes.push(
        hasHypertensionRule
          ? '命中高血压规则，优先召回血压阈值、风险分层与随访频率证据。'
          : '识别到高血压相关线索，补充血压阈值与风险分层证据。',
      );
    }

    const hasStrokeRule =
      matchedRuleIds.has(RULE_IDS.BASIC_SAFETY_STROKE_WARNING) ||
      matchedRuleIds.has(RULE_IDS.BASIC_SAFETY_EMERGENCY_SYMPTOM);
    const useStrokeFocus = hasStrokeRule || focusProfile.hasStrokeFocus;
    if (useStrokeFocus) {
      queryKeywords.push(
        'stroke warning signs emergency triage guideline',
        'FAST stroke signs facial droop arm weakness speech',
        '卒中 预警 症状 急诊 处置',
      );
      strategyNotes.push(
        hasStrokeRule
          ? '命中卒中/急症规则，优先召回红旗症状与急诊上转证据。'
          : '识别到卒中/神经红旗线索，补充急诊上转时效证据。',
      );
    }

    const hasGlucoseRule =
      matchedRuleIds.has(RULE_IDS.FLOW_CONTROL_RANDOM_GLUCOSE_CLASSIC) ||
      matchedRuleIds.has(RULE_IDS.BASIC_SAFETY_LEVEL2_HYPOGLYCEMIA);
    const useGlucoseFocus =
      (hasGlucoseRule && (focusProfile.hasGlucoseFocus || hasAbnormalBloodGlucose(vitals))) ||
      focusProfile.hasGlucoseFocus ||
      hasAbnormalBloodGlucose(vitals);
    if (useGlucoseFocus) {
      queryKeywords.push(
        'diabetes hyperglycemia hypoglycemia diagnosis guideline',
        'blood glucose diabetes diagnostic threshold follow-up guideline',
        '糖尿病 高血糖 低血糖 诊断 阈值',
      );
      strategyNotes.push(
        hasGlucoseRule
          ? '命中血糖规则，优先召回诊断边界与急性风险处理证据。'
          : '识别到糖代谢相关线索，补充血糖阈值与复评证据。',
      );
    }

    const useCardiacFocus = focusProfile.hasCardiacFocus;
    if (useCardiacFocus) {
      queryKeywords.push(
        'cardiology heart failure palpitation dyspnea triage risk stratification guideline',
        '心悸 气短 心衰 心血管 分诊 风险分层 指南',
      );
      strategyNotes.push('识别到心血管症状线索，补充心脏专科分层与转诊证据。');
    }

    if (queryKeywords.length === 0) {
      queryKeywords.push(
        'evidence based guideline clinical practice',
        'clinical practice guideline evidence synthesis',
      );
      strategyNotes.push('未命中特定病种规则，采用通用循证检索策略。');
    }

    const riskNumeric = riskToNumeric(riskLevel);
    const decomposedNeeds = buildNeedDecomposition({
      hasHypertensionRule: useHypertensionFocus,
      hasStrokeRule: useStrokeFocus,
      hasGlucoseRule: useGlucoseFocus,
      hasCardiacFocus: useCardiacFocus,
      riskNumeric,
    });
    const activatedSkills = buildActivatedSkills({
      riskNumeric,
      hasHypertensionRule: useHypertensionFocus,
      hasStrokeRule: useStrokeFocus,
      hasGlucoseRule: useGlucoseFocus,
      hasCardiacFocus: useCardiacFocus,
    });
    const sourceFilter = [...DEFAULT_SOURCE_FILTER] as string[];
    const requiredSources = ['WHO'];
    if (
      useHypertensionFocus &&
      (riskNumeric >= 3 || matchedRuleIds.has(RULE_IDS.FLOW_CONTROL_SEVERE_HTN_SAME_DAY))
    ) {
      requiredSources.push('NICE');
    }
    if (useStrokeFocus || useGlucoseFocus) {
      requiredSources.push('CDC_US');
    }

    const limit =
      riskNumeric >= 3 ? 6 : riskNumeric >= 2 ? 5 : riskNumeric >= 1 ? 4 : 3;
    const minEvidenceCount = riskNumeric >= 2 ? 2 : 1;

    const baseQuery = queryParts.join(' ').slice(0, 220);
    const strategyQuery = queryKeywords.join(' ');
    const primaryQuery = `${baseQuery} ${strategyQuery}`.trim().slice(0, MAX_QUERY_LENGTH);
    const queryVariants = dedupe([
      primaryQuery,
      ...buildQueryVariants({
        request: input.request,
        queryKeywords,
        decomposedNeeds,
        focus: focusProfile,
      }),
    ]).slice(0, MAX_QUERY_VARIANTS);

    const normalizedRequiredSources = dedupe(requiredSources).filter((sourceId) =>
      sourceFilter.includes(sourceId),
    );
    const professionalRestatement = buildProfessionalRestatement({
      request: input.request,
      risk: input.risk,
      decomposedNeeds,
      requiredSources: normalizedRequiredSources,
    });
    strategyNotes.push(
      `需求拆解完成：${decomposedNeeds.length} 个子问题，检索改写 ${queryVariants.length} 条。`,
    );

    return {
      query: queryVariants[0] ?? primaryQuery,
      queryVariants,
      limit,
      sourceFilter,
      requiredSources: normalizedRequiredSources,
      minEvidenceCount,
      decomposedNeeds,
      professionalRestatement,
      strategyNotes,
      activatedSkills,
    };
  }
}
