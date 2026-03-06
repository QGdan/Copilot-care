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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForCompare(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[，。；、:：,./\\\-_\s()（）[\]【】]/g, '');
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

function cleanActionText(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^建议[:：]?\s*/u, '')
    .replace(/^请[:：]?\s*/u, '');
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
    if (selected.length >= 5) {
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

function buildConclusion(input: BuildExplainableReportInput): string {
  const triageLevel = input.triageResult.triageLevel;
  const destination = input.triageResult.destination;
  const followupDays = input.triageResult.followupDays;
  return `分诊等级：${triageLevel}；去向：${destination}；建议 ${followupDays} 天内完成下一次随访。`;
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

    // 优先保留模型建议，再补齐规则随访建议，减少固定模板痕迹。
    const actions = dedupeActions([
      ...(input.finalConsensus?.actions ?? []),
      ...input.triageResult.educationAdvice,
    ]);

    return {
      conclusion: buildConclusion(input),
      evidence,
      evidenceCards: input.evidenceCards ? [...input.evidenceCards] : [],
      basis,
      actions,
      counterfactual: [
        '若未按计划随访和监测，风险等级可能在后续阶段上升。',
        '若按计划完成复评与趋势监测，可降低异常延迟识别的概率。',
      ],
    };
  }
}
