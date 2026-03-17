import {
  AUTHORITATIVE_MEDICAL_DOCUMENT_SEEDS,
  AUTHORITATIVE_MEDICAL_SOURCES,
  AuthoritativeMedicalEvidence,
  isAuthoritativeMedicalUrl,
  resolveSourceByUrl,
} from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import { AUTHORITATIVE_GUIDELINE_REFERENCES } from '../../../domain/rules/AuthoritativeMedicalRuleCatalog';
import {
  buildChineseEvidenceSnippet,
  buildGuidelineReferenceSnippet,
  extractMatchedQueryTokens,
  normalizeWhitespace,
  tokenizeQuery,
} from './text';

function nowIso(): string {
  return new Date().toISOString();
}

const FALLBACK_QUERY_STOPWORDS = new Set<string>([
  'adult',
  'adults',
  'blood',
  'clinical',
  'consensus',
  'diagnosis',
  'disease',
  'diseases',
  'evidence',
  'follow',
  'followup',
  'guideline',
  'guidelines',
  'high',
  'low',
  'management',
  'practice',
  'recommendation',
  'risk',
  'screening',
  'threshold',
  'triage',
  '分诊',
  '指南',
  '管理',
  '证据',
  '风险',
  '随访',
  '阈值',
  '临床',
  '成人',
]);

function normalizeFallbackToken(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function buildFallbackQueryTokens(query: string): string[] {
  return tokenizeQuery(query)
    .map((token) => normalizeFallbackToken(token))
    .filter(
      (token) =>
        token.length >= 2 &&
        !FALLBACK_QUERY_STOPWORDS.has(token) &&
        !/^\d+$/.test(token),
    );
}

interface FallbackTopicFlags {
  hypertension: boolean;
  diabetes: boolean;
  stroke: boolean;
  cardiac: boolean;
}

function inferFallbackTopicFlags(text: string): FallbackTopicFlags {
  const bag = normalizeWhitespace(text).toLowerCase();
  return {
    hypertension:
      /\b(hypertension|blood pressure|systolic|diastolic)\b|高血压|血压|收缩压|舒张压/u
        .test(bag),
    diabetes:
      /\b(diabetes|glucose|hyperglycemia|hypoglycemia|hba1c)\b|糖尿病|血糖|高血糖|低血糖/u
        .test(bag),
    stroke:
      /\b(stroke|fast|neurologic|emergency)\b|卒中|中风|急诊/u
        .test(bag),
    cardiac:
      /\b(cardiac|heart failure|heart disease|palpitation|dyspnea|chest pain|cardiovascular diseases)\b|心衰|心力衰竭|心悸|气短|胸痛|心脏病/u
        .test(bag),
  };
}

function isHardTopicMismatch(
  queryFlags: FallbackTopicFlags,
  candidateFlags: FallbackTopicFlags,
): boolean {
  if (
    queryFlags.diabetes &&
    !queryFlags.stroke &&
    candidateFlags.stroke &&
    !candidateFlags.diabetes
  ) {
    return true;
  }
  if (
    queryFlags.diabetes &&
    !queryFlags.hypertension &&
    candidateFlags.hypertension &&
    !candidateFlags.diabetes
  ) {
    return true;
  }
  if (
    queryFlags.cardiac &&
    !queryFlags.stroke &&
    candidateFlags.stroke
  ) {
    return true;
  }
  if (
    queryFlags.cardiac &&
    !queryFlags.hypertension &&
    candidateFlags.hypertension &&
    !candidateFlags.cardiac
  ) {
    return true;
  }
  return false;
}

function buildLocalFallbackEvidence(
  query: string,
  limit: number,
  allowedSourceIds?: ReadonlySet<string>,
): AuthoritativeMedicalEvidence[] {
  const tokens = buildFallbackQueryTokens(query);
  const at = nowIso();

  const seedCandidates: Array<{
    title: string;
    url: string;
    sourceId: string;
    score: number;
    snippet: string;
    matchedQueryTokens: string[];
  }> = [];

  for (const seed of AUTHORITATIVE_MEDICAL_DOCUMENT_SEEDS) {
    const bag = `${seed.title} ${seed.keywords.join(' ')}`.toLowerCase();
    const matchedKeywords = seed.keywords.filter((keyword) =>
      tokens.some((token) => keyword.toLowerCase().includes(token)),
    );
    const score = tokens.reduce((accumulator, token) => {
      return accumulator + (bag.includes(token) ? 1 : 0);
    }, 0);
    const matchedQueryTokens = matchedKeywords
      .map((keyword) => normalizeWhitespace(keyword).toLowerCase())
      .filter((keyword) => keyword.length >= 2)
      .slice(0, 3);
    const baseSummary =
      seed.evidenceSummaryZh ??
      `${seed.title} 为权威机构发布的指南/科普入口，可用于后续临床证据复核。`;
    const structuredSummary = buildChineseEvidenceSnippet({
      sourceName: seed.sourceId,
      title: seed.title,
      rawSnippet: baseSummary,
      queryTokens: tokens,
    });
    seedCandidates.push({
      title: seed.title,
      url: seed.url,
      sourceId: seed.sourceId,
      score,
      snippet: structuredSummary,
      matchedQueryTokens,
    });
  }

  for (const reference of AUTHORITATIVE_GUIDELINE_REFERENCES) {
    const bag =
      `${reference.id} ${reference.title} ${reference.publisher}`.toLowerCase();
    const score = tokens.reduce((accumulator, token) => {
      return accumulator + (bag.includes(token) ? 1 : 0);
    }, 0);
    const source = resolveSourceByUrl(reference.url);
    const rawReferenceSummary = buildGuidelineReferenceSnippet(
      reference.title,
      reference.publisher,
    );
    const structuredReferenceSummary = buildChineseEvidenceSnippet({
      sourceName: source?.name ?? reference.publisher,
      title: reference.title,
      rawSnippet: rawReferenceSummary,
      queryTokens: tokens,
    });
    seedCandidates.push({
      title: reference.title,
      url: reference.url,
      sourceId: source?.id ?? 'GUIDELINE_CATALOG',
      score,
      snippet: structuredReferenceSummary,
      matchedQueryTokens: extractMatchedQueryTokens(
        tokens,
        `${reference.title} ${reference.publisher}`,
      ),
    });
  }

  const rankedByScore = seedCandidates
    .filter((candidate) => isAuthoritativeMedicalUrl(candidate.url))
    .filter((candidate) => {
      if (!allowedSourceIds || allowedSourceIds.size === 0) {
        return true;
      }
      const source =
        AUTHORITATIVE_MEDICAL_SOURCES.find(
          (item) => item.id === candidate.sourceId,
        ) ?? resolveSourceByUrl(candidate.url);
      return source ? allowedSourceIds.has(source.id) : false;
    })
    .sort((a, b) => b.score - a.score);
  const maxScore = rankedByScore[0]?.score ?? 0;
  const ranked =
    maxScore > 0
      ? rankedByScore.filter((candidate) => candidate.score > 0)
      : rankedByScore;
  const queryTopicFlags = inferFallbackTopicFlags(query);
  const topicFiltered = ranked.filter((candidate) => {
    const candidateTopicFlags = inferFallbackTopicFlags(
      `${candidate.title} ${candidate.snippet}`,
    );
    return !isHardTopicMismatch(queryTopicFlags, candidateTopicFlags);
  });
  const effectiveRanked = topicFiltered.length > 0 ? topicFiltered : ranked;

  const dedup = new Set<string>();
  const selected: AuthoritativeMedicalEvidence[] = [];
  for (const candidate of effectiveRanked) {
    const urlKey = candidate.url.toLowerCase();
    if (dedup.has(urlKey)) {
      continue;
    }
    dedup.add(urlKey);
    const source =
      AUTHORITATIVE_MEDICAL_SOURCES.find(
        (item) => item.id === candidate.sourceId,
      ) ?? resolveSourceByUrl(candidate.url);
    selected.push({
      sourceId: source?.id ?? candidate.sourceId,
      sourceName: source?.name ?? candidate.sourceId,
      title: candidate.title,
      url: candidate.url,
      snippet: candidate.snippet,
      retrievedAt: at,
      origin: 'catalog_seed',
      matchedQueryTokens: candidate.matchedQueryTokens,
    });
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

export { buildLocalFallbackEvidence };
