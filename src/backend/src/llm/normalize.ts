import { RiskLevel } from '@copilot-care/shared/types';
import { ClinicalLLMResponse } from './types';

const VALID_RISK_LEVELS: RiskLevel[] = ['L0', 'L1', 'L2', 'L3'];
const LIST_SPLIT_PATTERN = /[\n;,|，；、]+/;

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeArrayItem(item))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .replace(/\\n/g, '\n')
      .split(LIST_SPLIT_PATTERN)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeArrayItem(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (!value || typeof value !== 'object') {
    return '';
  }

  const source = value as Record<string, unknown>;
  const preferred = pickFirstDefined(source, [
    'text',
    'title',
    'name',
    'content',
    'url',
    'value',
  ]);
  if (typeof preferred === 'string') {
    return preferred.trim();
  }
  return '';
}

function pickFirstDefined(
  source: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
}

function toRiskLevel(value: unknown): RiskLevel | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.max(0, Math.min(3, Math.floor(value)));
    return `L${normalized}` as RiskLevel;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/^l[0-3]$/i.test(normalized)) {
    return normalized.toUpperCase() as RiskLevel;
  }

  if (/^[0-3]$/.test(normalized)) {
    return `L${normalized}` as RiskLevel;
  }

  if (
    ['l0', 'low', 'minimal', 'normal', 'stable', 'routine'].includes(
      normalized,
    )
  ) {
    return 'L0';
  }
  if (['l1', 'mild', 'watch'].includes(normalized)) {
    return 'L1';
  }
  if (['l2', 'moderate', 'medium', 'urgent'].includes(normalized)) {
    return 'L2';
  }
  if (
    ['l3', 'high', 'severe', 'critical', 'emergency', 'escalate'].includes(
      normalized,
    )
  ) {
    return 'L3';
  }

  // Chinese aliases from heterogeneous model outputs.
  const compact = normalized.replace(/\s+/g, '');
  if (/(高|危急|紧急|急诊|重度|立即)/u.test(compact)) {
    return 'L3';
  }
  if (/(中|中度|较高|尽快|就诊)/u.test(compact)) {
    return 'L2';
  }
  if (/(轻|轻度|观察|随访)/u.test(compact)) {
    return 'L1';
  }
  if (/(低|低度|常规|稳定|平稳)/u.test(compact)) {
    return 'L0';
  }

  return null;
}

function toConfidence(value: unknown): number | null {
  let parsed: number | null = null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    parsed = value;
  }
  if (parsed === null && typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    const ratioMatch = /(-?\d+(?:\.\d+)?)\s*\/\s*100\b/.exec(normalized);
    if (ratioMatch?.[1]) {
      const ratioCandidate = Number(ratioMatch[1]);
      if (Number.isFinite(ratioCandidate)) {
        parsed = ratioCandidate / 100;
      }
    }

    if (parsed === null) {
      const percentMatch = /(-?\d+(?:\.\d+)?)\s*%/.exec(normalized);
      if (percentMatch?.[1]) {
        const percentCandidate = Number(percentMatch[1]);
        if (Number.isFinite(percentCandidate)) {
          parsed = percentCandidate;
        }
      }
    }

    if (parsed === null) {
      const rawCandidate = Number(normalized.replace(/%$/, ''));
      if (Number.isFinite(rawCandidate)) {
        parsed = rawCandidate;
      }
    }

    if (parsed === null) {
      const fallbackNumeric = /-?\d+(?:\.\d+)?/.exec(normalized);
      if (fallbackNumeric?.[0]) {
        const candidate = Number(fallbackNumeric[0]);
        if (Number.isFinite(candidate)) {
          parsed = candidate;
        }
      }
    }
  }

  if (parsed === null) {
    return null;
  }

  if (parsed > 1 && parsed <= 100) {
    parsed = parsed / 100;
  }

  return Math.min(1, Math.max(0, parsed));
}

function hasAnyKey(
  source: Record<string, unknown>,
  keys: string[],
): boolean {
  return keys.some((key) => source[key] !== undefined && source[key] !== null);
}

function resolvePayloadSource(candidate: Record<string, unknown>): Record<string, unknown> {
  const riskKeys = ['riskLevel', 'risk_level', 'risk', 'level'];
  const nestedCandidates = ['data', 'result', 'output', 'response', 'payload'];

  for (const key of nestedCandidates) {
    const nested = candidate[key];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
      continue;
    }
    const record = nested as Record<string, unknown>;
    if (hasAnyKey(record, riskKeys)) {
      return record;
    }
  }

  return candidate;
}

function captureByPatterns(
  text: string,
  patterns: RegExp[],
): string | null {
  for (const pattern of patterns) {
    const matched = pattern.exec(text);
    const value = matched?.[1];
    if (!value) {
      continue;
    }
    const normalized = value.trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function parseLooseStructuredText(text: string): ClinicalLLMResponse | null {
  const cleaned = stripCodeFences(text)
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .trim();
  if (!cleaned) {
    return null;
  }

  const riskRaw = captureByPatterns(cleaned, [
    /(?:^|\n)\s*(?:risk(?:_level|level)?|level|风险等级|风险)\s*[:：=]\s*["']?([^\n"'};,]+)/iu,
  ]);
  const confidenceRaw = captureByPatterns(cleaned, [
    /(?:^|\n)\s*(?:confidence(?:score)?|score|置信度|可信度)\s*[:：=]\s*["']?([^\n"'};,]+)/iu,
  ]);
  const reasoningRaw = captureByPatterns(cleaned, [
    /(?:^|\n)\s*(?:reasoning|reason|rationale|analysis|summary|依据|分析|理由)\s*[:：=]\s*["']?([^\n]+)/iu,
  ]);
  const actionsRaw = captureByPatterns(cleaned, [
    /(?:^|\n)\s*(?:actions?|next[_\s-]?actions?|recommendations?|建议|处理建议)\s*[:：=]\s*([^\n]+)/iu,
  ]);
  const citationsRaw = captureByPatterns(cleaned, [
    /(?:^|\n)\s*(?:citations?|references?|evidence|证据|参考依据)\s*[:：=]\s*([^\n]+)/iu,
  ]);

  const riskLevel = toRiskLevel(riskRaw);
  const confidence = toConfidence(confidenceRaw);

  if (!riskLevel || confidence === null) {
    return null;
  }

  const fallbackReasoning = cleaned
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 8 && !/^[\[{(]/.test(line));
  const reasoning = reasoningRaw ?? fallbackReasoning ?? '';
  if (!reasoning.trim()) {
    return null;
  }

  return {
    riskLevel,
    confidence,
    reasoning: reasoning.trim(),
    citations: citationsRaw ? toStringArray(citationsRaw) : [],
    actions: actionsRaw ? toStringArray(actionsRaw) : [],
  };
}

export function parseLLMJsonText(text: string): ClinicalLLMResponse | null {
  const candidates: string[] = [];
  const stripped = stripCodeFences(text);
  const extractedFromStripped = extractJsonObject(stripped);
  if (extractedFromStripped) {
    candidates.push(extractedFromStripped);
  }
  const extractedFromRaw = extractJsonObject(text);
  if (extractedFromRaw && extractedFromRaw !== extractedFromStripped) {
    candidates.push(extractedFromRaw);
  }
  if (candidates.length === 0) {
    candidates.push(stripped);
  }

  let candidate: unknown = null;
  for (const candidateText of candidates) {
    try {
      candidate = JSON.parse(candidateText);
      break;
    } catch {
      continue;
    }
  }

  if (!candidate || typeof candidate !== 'object') {
    return parseLooseStructuredText(text);
  }

  const source = resolvePayloadSource(candidate as Record<string, unknown>);
  const riskLevel = toRiskLevel(
    pickFirstDefined(source, ['riskLevel', 'risk_level', 'risk', 'level']),
  );
  if (!riskLevel || !VALID_RISK_LEVELS.includes(riskLevel)) {
    return parseLooseStructuredText(text);
  }

  const confidence = toConfidence(
    pickFirstDefined(source, ['confidence', 'confidenceScore', 'score']),
  );
  if (confidence === null || Number.isNaN(confidence)) {
    return parseLooseStructuredText(text);
  }

  const reasoning = pickFirstDefined(source, [
    'reasoning',
    'reason',
    'rationale',
    'analysis',
    'summary',
  ]);
  if (typeof reasoning !== 'string' || !reasoning.trim()) {
    return parseLooseStructuredText(text);
  }

  const citations = toStringArray(
    pickFirstDefined(source, ['citations', 'citation', 'references', 'evidence']),
  );
  const actions = toStringArray(
    pickFirstDefined(source, ['actions', 'action', 'nextAction', 'recommendations']),
  );

  return {
    riskLevel,
    confidence,
    reasoning: reasoning.trim(),
    citations,
    actions,
  };
}
