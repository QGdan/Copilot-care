import { HybridRetrieverChannel } from './hybridRetriever';

export interface HybridRerankCandidate {
  id: string;
  sourceId: string;
  url: string;
  title: string;
  snippet: string;
  channelRanks: Partial<Record<HybridRetrieverChannel, number>>;
  semanticScore?: number;
  publishedOn?: string;
  redFlagMatched?: boolean;
}

export interface HybridRerankOptions {
  query: string;
  queryVariants?: string[];
  topK: number;
  rrfK?: number;
  semanticWeight?: number;
  authorityWeight?: number;
  freshnessWeight?: number;
  redFlagBoost?: number;
  channelAgreementWeight?: number;
  topicAlignmentWeight?: number;
  topicMismatchWeight?: number;
  sourceAuthorityBoost?: Record<string, number>;
}

export interface HybridRerankResult extends HybridRerankCandidate {
  rrfScore: number;
  semanticScoreNormalized: number;
  authorityScore: number;
  freshnessScore: number;
  redFlagScore: number;
  channelAgreementScore: number;
  topicAlignmentScore: number;
  topicMismatchScore: number;
  finalScore: number;
}

const DEFAULT_RRF_K = 60;
const DEFAULT_SEMANTIC_WEIGHT = 0.35;
const DEFAULT_AUTHORITY_WEIGHT = 0.15;
const DEFAULT_FRESHNESS_WEIGHT = 0.1;
const DEFAULT_RED_FLAG_BOOST = 0.08;
const DEFAULT_CHANNEL_AGREEMENT_WEIGHT = 0.12;
const DEFAULT_TOPIC_ALIGNMENT_WEIGHT = 0.24;
const DEFAULT_TOPIC_MISMATCH_WEIGHT = 0.18;

const DEFAULT_SOURCE_AUTHORITY_BOOST: Record<string, number> = {
  NICE: 1,
  WHO: 1,
  CDC_US: 0.95,
  NHC_CN: 0.9,
  CDC_CN: 0.88,
  NMPA: 0.85,
  PUBMED: 0.8,
};

interface TopicSignature {
  hypertension: boolean;
  diabetes: boolean;
  stroke: boolean;
  cardiac: boolean;
}

function inferTopicSignature(text: string): TopicSignature {
  const bag = text.toLowerCase();
  return {
    hypertension:
      /\b(hypertension|blood pressure|systolic|diastolic|htn)\b|高血压|血压|收缩压|舒张压/u
        .test(bag),
    diabetes:
      /\b(diabetes|glucose|hyperglycemia|hypoglycemia|hba1c)\b|糖尿病|血糖|高血糖|低血糖|糖化血红蛋白/u
        .test(bag),
    stroke:
      /\b(stroke|fast|facial droop|speech|arm weakness|neurologic|emergency)\b|卒中|中风|急诊/u
        .test(bag),
    cardiac:
      /\b(cardiac|heart disease|chest pain|palpitation|dyspnea|heart failure|cardiovascular diseases)\b|心悸|气短|胸痛|心衰|心力衰竭|心脏病/u
        .test(bag),
  };
}

function countTopicMatches(signature: TopicSignature): number {
  return Object.values(signature).filter(Boolean).length;
}

function overlapTopicCount(
  left: TopicSignature,
  right: TopicSignature,
): number {
  let overlap = 0;
  if (left.hypertension && right.hypertension) {
    overlap += 1;
  }
  if (left.diabetes && right.diabetes) {
    overlap += 1;
  }
  if (left.stroke && right.stroke) {
    overlap += 1;
  }
  if (left.cardiac && right.cardiac) {
    overlap += 1;
  }
  return overlap;
}

function mergeTopicSignatures(signatures: TopicSignature[]): TopicSignature {
  return {
    hypertension: signatures.some((item) => item.hypertension),
    diabetes: signatures.some((item) => item.diabetes),
    stroke: signatures.some((item) => item.stroke),
    cardiac: signatures.some((item) => item.cardiac),
  };
}

function computeTopicScores(input: {
  querySignature: TopicSignature;
  candidateSignature: TopicSignature;
}): { alignment: number; mismatch: number } {
  const queryTopicCount = countTopicMatches(input.querySignature);
  const candidateTopicCount = countTopicMatches(input.candidateSignature);
  if (queryTopicCount === 0) {
    return { alignment: 0.5, mismatch: 0 };
  }

  const overlap = overlapTopicCount(
    input.querySignature,
    input.candidateSignature,
  );
  if (overlap > 0) {
    const alignment = Number((overlap / queryTopicCount).toFixed(6));
    return { alignment, mismatch: 0 };
  }

  if (candidateTopicCount === 0) {
    return { alignment: 0.15, mismatch: 0.08 };
  }

  let mismatch = 0.55;
  if (input.querySignature.diabetes && input.candidateSignature.stroke) {
    mismatch += 0.2;
  }
  if (input.querySignature.cardiac && input.candidateSignature.diabetes) {
    mismatch += 0.2;
  }
  if (input.querySignature.cardiac && input.candidateSignature.hypertension) {
    mismatch += 0.12;
  }
  if (input.querySignature.hypertension && input.candidateSignature.diabetes) {
    mismatch += 0.08;
  }

  return {
    alignment: 0,
    mismatch: Number(Math.min(1, mismatch).toFixed(6)),
  };
}

function normalizeQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((item) => item.length > 0);
}

function computeTextOverlapScore(query: string, text: string): number {
  const terms = normalizeQueryTerms(query);
  if (terms.length === 0) {
    return 0;
  }
  const bag = text.toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (bag.includes(term)) {
      matched += 1;
    }
  }
  return Number((matched / terms.length).toFixed(6));
}

function computeRrfScore(
  channelRanks: Partial<Record<HybridRetrieverChannel, number>>,
  rrfK: number,
): number {
  let score = 0;
  for (const rank of Object.values(channelRanks)) {
    if (!rank || rank <= 0) {
      continue;
    }
    score += 1 / (rrfK + rank);
  }
  return Number(score.toFixed(6));
}

function computeFreshnessScore(publishedOn: string | undefined): number {
  if (!publishedOn) {
    return 0;
  }
  const publishedAt = Date.parse(publishedOn);
  if (Number.isNaN(publishedAt)) {
    return 0;
  }
  const ageInDays = Math.max(0, (Date.now() - publishedAt) / (24 * 60 * 60 * 1000));
  return Number((1 / (1 + ageInDays / 365)).toFixed(6));
}

export function rerankHybridCandidates(
  candidates: HybridRerankCandidate[],
  options: HybridRerankOptions,
): HybridRerankResult[] {
  const rrfK = options.rrfK ?? DEFAULT_RRF_K;
  const semanticWeight = options.semanticWeight ?? DEFAULT_SEMANTIC_WEIGHT;
  const authorityWeight = options.authorityWeight ?? DEFAULT_AUTHORITY_WEIGHT;
  const freshnessWeight = options.freshnessWeight ?? DEFAULT_FRESHNESS_WEIGHT;
  const redFlagBoost = options.redFlagBoost ?? DEFAULT_RED_FLAG_BOOST;
  const channelAgreementWeight =
    options.channelAgreementWeight ?? DEFAULT_CHANNEL_AGREEMENT_WEIGHT;
  const topicAlignmentWeight =
    options.topicAlignmentWeight ?? DEFAULT_TOPIC_ALIGNMENT_WEIGHT;
  const topicMismatchWeight =
    options.topicMismatchWeight ?? DEFAULT_TOPIC_MISMATCH_WEIGHT;
  const authorityBoostMap = {
    ...DEFAULT_SOURCE_AUTHORITY_BOOST,
    ...(options.sourceAuthorityBoost ?? {}),
  };
  const querySignature = mergeTopicSignatures(
    [options.query, ...(options.queryVariants ?? [])]
      .map((item) => inferTopicSignature(item)),
  );

  const results = candidates.map((candidate) => {
    const rrfScore = computeRrfScore(candidate.channelRanks, rrfK);
    const semanticScoreNormalized =
      candidate.semanticScore ??
      computeTextOverlapScore(options.query, `${candidate.title}\n${candidate.snippet}`);
    const authorityScore = authorityBoostMap[candidate.sourceId] ?? 0.75;
    const freshnessScore = computeFreshnessScore(candidate.publishedOn);
    const redFlagScore = candidate.redFlagMatched ? redFlagBoost : 0;
    const channelCount = Object.keys(candidate.channelRanks).length;
    const channelAgreementScore =
      channelCount > 1 ? (channelCount - 1) * channelAgreementWeight : 0;
    const candidateSignature = inferTopicSignature(
      `${candidate.title}\n${candidate.snippet}`,
    );
    const topicScores = computeTopicScores({
      querySignature,
      candidateSignature,
    });
    const finalScore =
      rrfScore +
      semanticWeight * semanticScoreNormalized +
      authorityWeight * authorityScore +
      freshnessWeight * freshnessScore +
      redFlagScore +
      channelAgreementScore +
      topicAlignmentWeight * topicScores.alignment -
      topicMismatchWeight * topicScores.mismatch;

    return {
      ...candidate,
      rrfScore,
      semanticScoreNormalized: Number(semanticScoreNormalized.toFixed(6)),
      authorityScore,
      freshnessScore,
      redFlagScore,
      channelAgreementScore: Number(channelAgreementScore.toFixed(6)),
      topicAlignmentScore: topicScores.alignment,
      topicMismatchScore: topicScores.mismatch,
      finalScore: Number(finalScore.toFixed(6)),
    };
  });

  results.sort((left, right) => {
    if (right.finalScore !== left.finalScore) {
      return right.finalScore - left.finalScore;
    }
    return left.url.localeCompare(right.url);
  });

  return results.slice(0, Math.max(1, options.topK));
}
