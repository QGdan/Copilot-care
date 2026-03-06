import {
  AUTHORITATIVE_MEDICAL_DOCUMENT_SEEDS,
  AUTHORITATIVE_MEDICAL_SOURCES,
  AuthoritativeMedicalEvidence,
  isAuthoritativeMedicalUrl,
  resolveSourceByUrl,
} from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import { AUTHORITATIVE_GUIDELINE_REFERENCES } from '../../../domain/rules/AuthoritativeMedicalRuleCatalog';
import {
  buildGuidelineReferenceSnippet,
  extractMatchedQueryTokens,
  normalizeWhitespace,
  tokenizeQuery,
} from './text';

function nowIso(): string {
  return new Date().toISOString();
}

function buildLocalFallbackEvidence(
  query: string,
  limit: number,
  allowedSourceIds?: ReadonlySet<string>,
): AuthoritativeMedicalEvidence[] {
  const tokens = tokenizeQuery(query);
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
    seedCandidates.push({
      title: seed.title,
      url: seed.url,
      sourceId: seed.sourceId,
      score,
      snippet: baseSummary,
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
    seedCandidates.push({
      title: reference.title,
      url: reference.url,
      sourceId: source?.id ?? 'GUIDELINE_CATALOG',
      score,
      snippet: buildGuidelineReferenceSnippet(
        reference.title,
        reference.publisher,
      ),
      matchedQueryTokens: extractMatchedQueryTokens(
        tokens,
        `${reference.title} ${reference.publisher}`,
      ),
    });
  }

  const ranked = seedCandidates
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

  const dedup = new Set<string>();
  const selected: AuthoritativeMedicalEvidence[] = [];
  for (const candidate of ranked) {
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
