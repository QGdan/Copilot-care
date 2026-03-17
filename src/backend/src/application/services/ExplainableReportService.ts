import {
  AgentOpinion,
  ExplainableEvidenceCard,
  ExplainableReport,
  StructuredTriageResult,
  TriageRoutingInfo,
} from '@copilot-care/shared/types';

export interface BuildExplainableReportInput {
  triageResult: StructuredTriageResult;
  finalConsensus?: AgentOpinion;
  routing?: TriageRoutingInfo;
  ruleEvidence: string[];
  additionalEvidence: string[];
  evidenceCards?: ExplainableEvidenceCard[];
}

const TRIAGE_LEVEL_LABELS: Record<string, string> = {
  emergency: '急危（L3）',
  urgent: '紧急（L2）',
  routine: '常规（L1）',
  followup: '随访（L0）',
};

const TRIAGE_LEVEL_BAND_LABELS: Record<string, string> = {
  emergency: 'L3级',
  urgent: 'L2级',
  routine: 'L1级',
  followup: 'L0级',
};

const DESTINATION_LABELS: Record<string, string> = {
  cardiology_outpatient: '心血管专科门诊',
  gp_clinic: '全科门诊',
  metabolic_outpatient: '代谢专科门诊',
  multidisciplinary_clinic: '多学科联合门诊',
  offline_emergency: '线下急诊绿色通道',
  cardiology_clinic: '心血管专科门诊',
  metabolic_clinic: '代谢专科门诊',
  general_clinic: '全科门诊',
};

const DEPARTMENT_LABELS: Record<string, string> = {
  cardiology: '心血管专科',
  generalPractice: '全科',
  metabolic: '代谢专科',
  multiDisciplinary: '多学科',
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForCompare(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[，。；：:、./\\\-_\s()（）[\]【】'"`]/g, '');
}

function toBigrams(text: string): Set<string> {
  const normalized = normalizeForCompare(text);
  if (normalized.length <= 1) {
    return new Set(normalized ? [normalized] : []);
  }
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function isNearDuplicate(left: string, right: string): boolean {
  const normalizedLeft = normalizeForCompare(left);
  const normalizedRight = normalizeForCompare(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (
    normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft)
  ) {
    return true;
  }
  const similarity = jaccardSimilarity(
    toBigrams(normalizedLeft),
    toBigrams(normalizedRight),
  );
  return similarity >= 0.72;
}

function translateMedicalActionText(text: string): string {
  const dictionary: Array<[RegExp, string]> = [
    [/\bmonitor(?:ing)?\b/gi, '监测'],
    [/\bfollow[-\s]?up\b/gi, '随访'],
    [/\breferral\b/gi, '转诊'],
    [/\bemergency\b/gi, '急诊'],
    [/\bblood pressure\b/gi, '血压'],
    [/\brisk\b/gi, '风险'],
    [/\bguideline\b/gi, '指南'],
    [/\bmanage(?:ment)?\b/gi, '管理'],
    [/\bclinic\b/gi, '门诊'],
  ];
  let normalized = text;
  for (const [pattern, replacement] of dictionary) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalizeWhitespace(normalized);
}

function cleanActionText(value: string): string {
  return translateMedicalActionText(
    normalizeWhitespace(value)
      .replace(/^建议[:：]?\s*/u, '')
      .replace(/^请[:：]?\s*/u, ''),
  );
}

function expandActionCandidates(actions: string[]): string[] {
  const expanded: string[] = [];
  for (const action of actions) {
    const normalized = normalizeWhitespace(action);
    if (!normalized) {
      continue;
    }
    const fragments = normalized
      .split(/[；;。]/u)
      .map((item) => cleanActionText(item))
      .filter(Boolean);
    if (fragments.length > 1) {
      expanded.push(...fragments);
      continue;
    }
    expanded.push(cleanActionText(normalized));
  }
  return expanded;
}

function dedupeActions(inputActions: string[]): string[] {
  const selected: string[] = [];
  for (const action of expandActionCandidates(inputActions)) {
    if (!action) {
      continue;
    }
    if (selected.some((item) => isNearDuplicate(item, action))) {
      continue;
    }
    selected.push(action);
    if (selected.length >= 7) {
      break;
    }
  }
  return selected;
}

function dedupeByNearDuplicate(items: string[]): string[] {
  const selected: string[] = [];
  for (const item of items.map(normalizeWhitespace).filter(Boolean)) {
    if (selected.some((existing) => isNearDuplicate(existing, item))) {
      continue;
    }
    selected.push(item);
  }
  return selected;
}

function toReadableEvidenceLine(card: ExplainableEvidenceCard): string {
  const source = card.sourceName || card.sourceId || '权威来源';
  const published = card.publishedOn ? `（${card.publishedOn}）` : '';
  return `${card.title}（${source}${published}）：${card.summary}`;
}

function formatTriageLevelLabel(triageLevel: string): string {
  return TRIAGE_LEVEL_LABELS[triageLevel] ?? triageLevel;
}

function formatTriageBandLabel(triageLevel: string): string {
  return TRIAGE_LEVEL_BAND_LABELS[triageLevel] ?? triageLevel;
}

function formatDestinationLabel(destination: string): string {
  const normalized = destination.trim();
  if (!normalized) {
    return destination;
  }
  if (DESTINATION_LABELS[normalized]) {
    return DESTINATION_LABELS[normalized];
  }

  const bag = normalized.toLowerCase();
  if (bag.includes('cardiology')) {
    return '心血管专科门诊';
  }
  if (bag.includes('metabolic')) {
    return '代谢专科门诊';
  }
  if (bag.includes('general') || bag.includes('gp')) {
    return '全科门诊';
  }
  if (bag.includes('multidisciplinary')) {
    return '多学科联合门诊';
  }
  if (bag.includes('emergency') || bag.includes('offline')) {
    return '线下急诊绿色通道';
  }
  return normalized;
}

function formatDepartmentLabel(routing: TriageRoutingInfo | undefined): string {
  if (!routing) {
    return '';
  }
  return DEPARTMENT_LABELS[routing.department] ?? routing.department;
}

function buildConclusion(input: BuildExplainableReportInput): string {
  const triageLevelLabel = formatTriageLevelLabel(input.triageResult.triageLevel);
  const triageBand = formatTriageBandLabel(input.triageResult.triageLevel);
  const destinationLabel = formatDestinationLabel(input.triageResult.destination);
  const followupDays = input.triageResult.followupDays;
  const departmentLabel = formatDepartmentLabel(input.routing);
  const professionalGrade = departmentLabel
    ? `${departmentLabel}${triageBand}`
    : triageBand;

  return `当前结论：${professionalGrade}；分诊等级：${triageLevelLabel}；建议去向：${destinationLabel}；建议 ${followupDays} 天内完成下一次复评。`;
}

function buildFallbackActionsByTriageLevel(triageLevel: string): string[] {
  if (triageLevel === 'emergency') {
    return [
      '立即线下急诊评估，避免延误关键救治窗口。',
      '出现胸痛、呼吸困难、意识障碍或肢体无力时立即呼叫 120。',
    ];
  }
  if (triageLevel === 'urgent') {
    return [
      '24 小时内完成线下面诊复评。',
      '记录症状变化与体征波动，便于专科快速分层。',
    ];
  }
  if (triageLevel === 'routine') {
    return [
      '72 小时内完成首次复评并建立随访记录。',
      '坚持每日体征监测并记录异常触发因素。',
    ];
  }
  return [
    '按计划周期随访并保持生活方式管理。',
    '症状加重或出现红旗信号时提前复诊。',
  ];
}

export class ExplainableReportService {
  public build(input: BuildExplainableReportInput): ExplainableReport {
    const readableCardEvidence = (input.evidenceCards ?? []).map((card) =>
      toReadableEvidenceLine(card),
    );
    const evidence = dedupeByNearDuplicate([
      ...readableCardEvidence,
      ...(input.finalConsensus?.citations ?? []),
      ...input.additionalEvidence,
    ]);

    const basis = dedupeByNearDuplicate([
      ...(input.routing?.reasons ?? []),
      ...input.ruleEvidence,
      ...(input.finalConsensus?.reasoning ? [input.finalConsensus.reasoning] : []),
    ]);

    const actions = dedupeActions([
      ...(input.finalConsensus?.actions ?? []),
      ...input.triageResult.educationAdvice,
      ...buildFallbackActionsByTriageLevel(input.triageResult.triageLevel),
    ]);

    return {
      conclusion: buildConclusion(input),
      evidence,
      evidenceCards: input.evidenceCards ? [...input.evidenceCards] : [],
      basis,
      actions,
      counterfactual: [
        '若未按计划随访与监测，风险分层可能在后续阶段上升。',
        '若按计划完成复评并持续监测，可降低异常延迟识别风险。',
      ],
    };
  }
}
