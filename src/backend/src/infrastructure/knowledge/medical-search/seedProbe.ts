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
  decodeHtmlEntities,
  extractMatchedQueryTokens,
  normalizeWhitespace,
  stripHtml,
  tokenizeQuery,
} from './text';
import { HttpGetText } from './types';

interface SeedProbeCandidate {
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  keywords: string[];
}

interface SeedProbeInput {
  query: string;
  limit: number;
  timeoutMs: number;
  targetSourceIds: string[];
  allowedSourceIds: ReadonlySet<string>;
  httpGetText: HttpGetText;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildSeedProbeCandidates(
  allowedSourceIds: ReadonlySet<string>,
): SeedProbeCandidate[] {
  const sourceById = new Map(
    AUTHORITATIVE_MEDICAL_SOURCES.map((source) => [source.id, source]),
  );
  const candidates: SeedProbeCandidate[] = [];

  for (const seed of AUTHORITATIVE_MEDICAL_DOCUMENT_SEEDS) {
    if (!allowedSourceIds.has(seed.sourceId)) {
      continue;
    }
    if (!isAuthoritativeMedicalUrl(seed.url)) {
      continue;
    }
    const source = sourceById.get(seed.sourceId) ?? resolveSourceByUrl(seed.url);
    candidates.push({
      sourceId: source?.id ?? seed.sourceId,
      sourceName: source?.name ?? seed.sourceId,
      title: seed.title,
      url: seed.url,
      keywords: seed.keywords,
    });
  }

  for (const reference of AUTHORITATIVE_GUIDELINE_REFERENCES) {
    if (!isAuthoritativeMedicalUrl(reference.url)) {
      continue;
    }
    const source = resolveSourceByUrl(reference.url);
    if (!source || !allowedSourceIds.has(source.id)) {
      continue;
    }
    candidates.push({
      sourceId: source.id,
      sourceName: source.name,
      title: reference.title,
      url: reference.url,
      keywords: [reference.title, reference.publisher, reference.id],
    });
  }

  const dedupByUrl = new Set<string>();
  return candidates.filter((item) => {
    const key = item.url.toLowerCase();
    if (dedupByUrl.has(key)) {
      return false;
    }
    dedupByUrl.add(key);
    return true;
  });
}

function extractHtmlMetaDescription(html: string): string {
  const metaMatchers: RegExp[] = [
    /<meta[^>]*name=(?:"description"|'description')[^>]*content=(?:"([^"]+)"|'([^']+)')[^>]*>/i,
    /<meta[^>]*content=(?:"([^"]+)"|'([^']+)')[^>]*name=(?:"description"|'description')[^>]*>/i,
    /<meta[^>]*property=(?:"og:description"|'og:description')[^>]*content=(?:"([^"]+)"|'([^']+)')[^>]*>/i,
    /<meta[^>]*content=(?:"([^"]+)"|'([^']+)')[^>]*property=(?:"og:description"|'og:description')[^>]*>/i,
  ];

  for (const matcher of metaMatchers) {
    const matched = matcher.exec(html);
    const value = matched?.[1] ?? matched?.[2] ?? '';
    const normalized = normalizeWhitespace(decodeHtmlEntities(value));
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function extractHtmlTitle(html: string): string {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!titleMatch?.[1]) {
    return '';
  }
  return normalizeWhitespace(stripHtml(decodeHtmlEntities(titleMatch[1])));
}

function extractParagraphSnippet(html: string): string {
  const paragraphMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (!paragraphMatch?.[1]) {
    return '';
  }
  return normalizeWhitespace(stripHtml(decodeHtmlEntities(paragraphMatch[1])));
}

function scoreCandidate(
  candidate: SeedProbeCandidate,
  queryTokens: readonly string[],
): number {
  const bag = `${candidate.title} ${candidate.keywords.join(' ')}`.toLowerCase();
  return queryTokens.reduce((score, token) => {
    return score + (bag.includes(token) ? 1 : 0);
  }, 0);
}

function rankSeedProbeCandidates(
  candidates: SeedProbeCandidate[],
  queryTokens: readonly string[],
  targetSourceIds: readonly string[],
): SeedProbeCandidate[] {
  const targetSet = new Set(targetSourceIds);
  const ranked = [...candidates].sort((left, right) => {
    const leftTarget = targetSet.has(left.sourceId) ? 1 : 0;
    const rightTarget = targetSet.has(right.sourceId) ? 1 : 0;
    if (leftTarget !== rightTarget) {
      return rightTarget - leftTarget;
    }

    const scoreDelta =
      scoreCandidate(right, queryTokens) - scoreCandidate(left, queryTokens);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.sourceId.localeCompare(right.sourceId);
  });

  return ranked;
}

async function probeAuthoritativeSeedPages(
  input: SeedProbeInput,
): Promise<AuthoritativeMedicalEvidence[]> {
  const queryTokens = tokenizeQuery(input.query);
  const candidates = rankSeedProbeCandidates(
    buildSeedProbeCandidates(input.allowedSourceIds),
    queryTokens,
    input.targetSourceIds,
  );

  const selected: AuthoritativeMedicalEvidence[] = [];
  const usedSources = new Set<string>();

  for (const candidate of candidates) {
    if (selected.length >= input.limit) {
      break;
    }

    try {
      const html = await input.httpGetText(candidate.url, input.timeoutMs);
      const title = extractHtmlTitle(html) || candidate.title;
      const description =
        extractHtmlMetaDescription(html) || extractParagraphSnippet(html);
      const summary = buildChineseEvidenceSnippet({
        sourceName: candidate.sourceName,
        title,
        rawSnippet: description,
        queryTokens,
      });
      selected.push({
        sourceId: candidate.sourceId,
        sourceName: candidate.sourceName,
        title,
        url: candidate.url,
        snippet: summary,
        retrievedAt: nowIso(),
        origin: 'live_search',
        matchedQueryTokens: extractMatchedQueryTokens(
          queryTokens,
          `${title} ${description}`,
        ),
      });
      usedSources.add(candidate.sourceId);
    } catch {
      continue;
    }
  }

  return selected;
}

export { probeAuthoritativeSeedPages };
