import { AuthoritativeMedicalEvidence } from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';

interface RetrievalExpectation {
  hasHypertension: boolean;
  hasDiabetes: boolean;
  hasHeartDisease: boolean;
  redFlagSuggested: boolean;
}

interface SingleCaseEvaluationInput {
  results: AuthoritativeMedicalEvidence[];
  expected: RetrievalExpectation;
}

export interface SingleCaseEvaluationResult {
  firstRelevantRank: number | null;
  hitAt3: boolean;
  mrrAt5: number;
  redFlagHit: boolean;
  summaryStructuredRate: number;
}

export interface AggregatedCaseEvaluationResult {
  sampleCount: number;
  top3HitRate: number;
  mrrAt5: number;
  redFlagRecall: number;
  summaryStructuredRate: number;
}

const HYPERTENSION_TERMS = [
  '高血压',
  '血压',
  'hypertension',
  'blood pressure',
  'systolic',
  'diastolic',
];

const DIABETES_TERMS = [
  '糖尿病',
  '血糖',
  '高血糖',
  '低血糖',
  'diabetes',
  'glucose',
  'hba1c',
];

const HEART_DISEASE_TERMS = [
  '心血管',
  '冠心病',
  '心衰',
  '心力衰竭',
  'cardiovascular',
  'cardiac',
  'heart',
];

const RED_FLAG_TERMS = [
  '红旗',
  '急诊',
  '卒中',
  'warning',
  'emergency',
  'fast',
  'same-day',
];

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function buildExpectedTerms(expected: RetrievalExpectation): string[] {
  const terms: string[] = [];
  if (expected.hasHypertension) {
    terms.push(...HYPERTENSION_TERMS);
  }
  if (expected.hasDiabetes) {
    terms.push(...DIABETES_TERMS);
  }
  if (expected.hasHeartDisease) {
    terms.push(...HEART_DISEASE_TERMS);
  }
  if (terms.length === 0) {
    terms.push('指南', '共识', 'risk', 'follow', '随访');
  }
  return [...new Set(terms)];
}

function isStructuredSummary(snippet: string): boolean {
  const text = normalizeText(snippet);
  return (
    text.includes('证据要点：') &&
    text.includes('临床解读：') &&
    text.includes('建议动作：')
  );
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, item) => acc + item, 0);
  return Number((sum / values.length).toFixed(4));
}

export function evaluateSingleRetrievalCase(
  input: SingleCaseEvaluationInput,
): SingleCaseEvaluationResult {
  const expectedTerms = buildExpectedTerms(input.expected);
  let firstRelevantRank: number | null = null;
  let redFlagHit = false;
  let structuredCount = 0;

  for (let index = 0; index < input.results.length; index += 1) {
    const item = input.results[index];
    const bag = normalizeText(`${item.title} ${item.snippet}`);
    if (firstRelevantRank === null && containsAny(bag, expectedTerms)) {
      firstRelevantRank = index + 1;
    }
    if (input.expected.redFlagSuggested && containsAny(bag, RED_FLAG_TERMS)) {
      redFlagHit = true;
    }
    if (isStructuredSummary(item.snippet)) {
      structuredCount += 1;
    }
  }

  const hitAt3 = firstRelevantRank !== null && firstRelevantRank <= 3;
  const mrrAt5 =
    firstRelevantRank !== null && firstRelevantRank <= 5
      ? Number((1 / firstRelevantRank).toFixed(4))
      : 0;
  const summaryStructuredRate =
    input.results.length > 0
      ? Number((structuredCount / input.results.length).toFixed(4))
      : 0;

  return {
    firstRelevantRank,
    hitAt3,
    mrrAt5,
    redFlagHit,
    summaryStructuredRate,
  };
}

export function aggregateRetrievalEvaluations(
  cases: Array<SingleCaseEvaluationResult & { redFlagExpected: boolean }>,
): AggregatedCaseEvaluationResult {
  const redFlagCases = cases.filter((item) => item.redFlagExpected);
  const redFlagHits = redFlagCases.filter((item) => item.redFlagHit).length;

  return {
    sampleCount: cases.length,
    top3HitRate: average(cases.map((item) => (item.hitAt3 ? 1 : 0))),
    mrrAt5: average(cases.map((item) => item.mrrAt5)),
    redFlagRecall:
      redFlagCases.length > 0
        ? Number((redFlagHits / redFlagCases.length).toFixed(4))
        : 1,
    summaryStructuredRate: average(
      cases.map((item) => item.summaryStructuredRate),
    ),
  };
}

export type { RetrievalExpectation };
