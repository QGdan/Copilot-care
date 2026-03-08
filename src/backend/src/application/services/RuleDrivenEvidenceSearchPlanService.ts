import { TriageRequest } from '@copilot-care/shared/types';
import { RULE_IDS } from '../../domain/rules/AuthoritativeMedicalRuleCatalog';
import { RiskAssessmentSnapshot } from './RuleFirstRiskAssessmentService';

export interface RuleDrivenEvidenceSearchPlan {
  query: string;
  limit: number;
  sourceFilter: string[];
  requiredSources: string[];
  minEvidenceCount: number;
  strategyNotes: string[];
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

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim();
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

export class RuleDrivenEvidenceSearchPlanService {
  public build(
    input: BuildRuleDrivenEvidenceSearchPlanInput,
  ): RuleDrivenEvidenceSearchPlan {
    const riskLevel = input.risk.riskLevel;
    const matchedRuleIds = new Set(input.risk.matchedRuleIds);
    const strategyNotes: string[] = [];

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
    if (hasHypertensionRule) {
      queryKeywords.push(
        'hypertension guideline blood pressure management',
        'high blood pressure diagnosis threshold treatment target',
        '成人 高血压 血压 分层 管理',
      );
      strategyNotes.push('命中高血压规则，优先召回血压阈值、风险分层与随访频率证据。');
    }

    const hasStrokeRule =
      matchedRuleIds.has(RULE_IDS.BASIC_SAFETY_STROKE_WARNING) ||
      matchedRuleIds.has(RULE_IDS.BASIC_SAFETY_EMERGENCY_SYMPTOM);
    if (hasStrokeRule) {
      queryKeywords.push(
        'stroke warning signs emergency triage guideline',
        'FAST stroke signs facial droop arm weakness speech',
        '卒中 预警 症状 急诊 处置',
      );
      strategyNotes.push('命中卒中/急症规则，优先召回红旗症状与急诊上转证据。');
    }

    const hasGlucoseRule =
      matchedRuleIds.has(RULE_IDS.FLOW_CONTROL_RANDOM_GLUCOSE_CLASSIC) ||
      matchedRuleIds.has(RULE_IDS.BASIC_SAFETY_LEVEL2_HYPOGLYCEMIA);
    if (hasGlucoseRule) {
      queryKeywords.push(
        'diabetes hyperglycemia hypoglycemia diagnosis guideline',
        'blood glucose management diabetes emergency thresholds',
        '糖尿病 高血糖 低血糖 诊断 阈值',
      );
      strategyNotes.push('命中血糖规则，优先召回诊断边界与急性风险处理证据。');
    }

    if (queryKeywords.length === 0) {
      queryKeywords.push(
        'evidence based guideline clinical practice',
        'clinical practice guideline evidence synthesis',
      );
      strategyNotes.push('未命中特定病种规则，采用通用循证检索策略。');
    }

    const riskNumeric = riskToNumeric(riskLevel);
    const sourceFilter = [...DEFAULT_SOURCE_FILTER] as string[];
    const requiredSources = ['WHO'];
    if (
      hasHypertensionRule &&
      (riskNumeric >= 3 || matchedRuleIds.has(RULE_IDS.FLOW_CONTROL_SEVERE_HTN_SAME_DAY))
    ) {
      requiredSources.push('NICE');
    }
    if (hasStrokeRule || hasGlucoseRule) {
      requiredSources.push('CDC_US');
    }

    const limit =
      riskNumeric >= 3 ? 6 : riskNumeric >= 2 ? 5 : riskNumeric >= 1 ? 4 : 3;
    const minEvidenceCount = riskNumeric >= 2 ? 2 : 1;

    const baseQuery = queryParts.join(' ').slice(0, 220);
    const strategyQuery = queryKeywords.join(' ');
    const query = `${baseQuery} ${strategyQuery}`.trim().slice(0, 300);

    return {
      query,
      limit,
      sourceFilter,
      requiredSources: dedupe(requiredSources).filter((sourceId) =>
        sourceFilter.includes(sourceId),
      ),
      minEvidenceCount,
      strategyNotes,
    };
  }
}
