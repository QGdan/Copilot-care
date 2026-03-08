import {
  AuthoritativeMedicalEvidence,
  AuthoritativeMedicalSource,
  isAuthoritativeMedicalUrl,
  resolveSourceByUrl,
} from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import {
  buildDuckDuckGoQueryPlans,
  extractSearchSnippetNearAnchor,
  resolveSearchResultUrl,
} from './queryPlan';
import {
  buildChineseEvidenceSnippet,
  buildPubMedChineseSnippet,
  decodeHtmlEntities,
  extractMatchedQueryTokens,
  normalizeWhitespace,
  stripHtml,
  tokenizeQuery,
} from './text';
import {
  HttpGetText,
  PUBMED_SOURCE_ID,
  ResolvedSearchRuntimeConfig,
  WhitelistedSearchResult,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
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

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function parseJsonObject<T>(raw: string): T | null {
  const stripped = stripCodeFences(raw);
  const candidates: string[] = [stripped];
  const extracted = extractJsonObject(stripped);
  if (extracted && extracted !== stripped) {
    candidates.push(extracted);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as T;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function searchPubMed(input: {
  query: string;
  limit: number;
  config: ResolvedSearchRuntimeConfig;
  httpGetText: HttpGetText;
}): Promise<AuthoritativeMedicalEvidence[]> {
  const max = Math.min(input.limit, input.config.pubMedRetMax);
  if (max <= 0) {
    return [];
  }

  const searchUrl =
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?' +
    `db=pubmed&retmode=json&retmax=${max}&sort=relevance&term=${encodeURIComponent(input.query)}`;
  const searchRaw = await input.httpGetText(searchUrl, input.config.timeoutMs);
  const searchPayload = parseJsonObject<{
    esearchresult?: { idlist?: string[] };
  }>(searchRaw);
  if (!searchPayload) {
    return [];
  }

  const idList = searchPayload.esearchresult?.idlist;
  if (!Array.isArray(idList) || idList.length === 0) {
    return [];
  }
  const ids = idList.filter((id) => /^\d+$/.test(id)).slice(0, max);
  if (ids.length === 0) {
    return [];
  }

  const summaryUrl =
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?' +
    `db=pubmed&retmode=json&id=${encodeURIComponent(ids.join(','))}`;
  const summaryRaw = await input.httpGetText(summaryUrl, input.config.timeoutMs);
  const summaryPayload = parseJsonObject<{
    result?: Record<string, unknown>;
  }>(summaryRaw);
  if (!summaryPayload) {
    return [];
  }
  const summaryResult = summaryPayload.result;
  if (!summaryResult || typeof summaryResult !== 'object') {
    return [];
  }

  const queryTokens = tokenizeQuery(input.query);
  const evidence: AuthoritativeMedicalEvidence[] = [];
  for (const id of ids) {
    const node = summaryResult[id];
    if (!node || typeof node !== 'object') {
      continue;
    }
    const item = node as Record<string, unknown>;
    const title = typeof item.title === 'string' ? normalizeWhitespace(item.title) : '';
    if (!title) {
      continue;
    }
    const publishedOn =
      typeof item.pubdate === 'string' && item.pubdate.trim()
        ? item.pubdate.trim()
        : undefined;
    const sourceNameRaw =
      typeof item.fulljournalname === 'string' && item.fulljournalname.trim()
        ? item.fulljournalname.trim()
        : 'PubMed indexed article';
    const url = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
    if (!isAuthoritativeMedicalUrl(url)) {
      continue;
    }
    const snippet = buildPubMedChineseSnippet({
      title,
      journal: sourceNameRaw,
      publishedOn,
      queryTokens,
    });
    const matchedQueryTokens = extractMatchedQueryTokens(
      queryTokens,
      `${title} ${sourceNameRaw}`,
    );
    evidence.push({
      sourceId: PUBMED_SOURCE_ID,
      sourceName: sourceNameRaw,
      title,
      url,
      snippet,
      publishedOn,
      retrievedAt: nowIso(),
      origin: 'live_search',
      matchedQueryTokens,
    });
    if (evidence.length >= max) {
      break;
    }
  }

  return evidence;
}

function extractWhitelistedResultsFromDuckDuckGoHtml(input: {
  html: string;
  limit: number;
  seen: Set<string>;
  queryTokens: string[];
  preferredSource?: AuthoritativeMedicalSource;
}): WhitelistedSearchResult {
  const results: AuthoritativeMedicalEvidence[] = [];
  let droppedByPolicy = 0;
  const matcher =
    /<a\b([^>]*?)href=(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = matcher.exec(input.html);

  while (match) {
    const href = match[3];
    const titleHtml = match[5];
    const attributes = `${match[1]} ${match[4]}`.toLowerCase();
    const looksLikeResultAnchor =
      attributes.includes('result__a') ||
      attributes.includes('result-link') ||
      attributes.includes('result__title') ||
      attributes.includes('result-title') ||
      attributes.includes('result') ||
      href.startsWith('/l/?');
    if (!looksLikeResultAnchor) {
      match = matcher.exec(input.html);
      continue;
    }
    const resolvedUrl = resolveSearchResultUrl(href);
    if (resolvedUrl) {
      if (!isAuthoritativeMedicalUrl(resolvedUrl)) {
        droppedByPolicy += 1;
      } else {
        const key = resolvedUrl.toLowerCase();
        if (!input.seen.has(key)) {
          input.seen.add(key);
          const source = resolveSourceByUrl(resolvedUrl) ?? input.preferredSource;
          const title = stripHtml(decodeHtmlEntities(titleHtml)) || resolvedUrl;
          if (title.length < 2) {
            match = matcher.exec(input.html);
            continue;
          }
          const rawSnippet = extractSearchSnippetNearAnchor(
            input.html,
            typeof match.index === 'number' ? match.index : -1,
          );
          const matchedQueryTokens = extractMatchedQueryTokens(
            input.queryTokens,
            `${title} ${rawSnippet}`,
          );
          const summary = buildChineseEvidenceSnippet({
            sourceName: source?.name ?? '权威医学来源',
            title,
            rawSnippet,
            queryTokens: input.queryTokens,
          });
          results.push({
            sourceId: source?.id ?? 'WHITELIST_WEB',
            sourceName: source?.name ?? 'Whitelisted Medical Source',
            title,
            url: resolvedUrl,
            snippet: summary,
            retrievedAt: nowIso(),
            origin: 'live_search',
            matchedQueryTokens,
          });
        }
      }
    }
    if (results.length >= input.limit) {
      break;
    }
    match = matcher.exec(input.html);
  }

  return {
    results,
    droppedByPolicy,
  };
}

async function searchWhitelistedDuckDuckGo(input: {
  query: string;
  limit: number;
  sources: AuthoritativeMedicalSource[];
  config: ResolvedSearchRuntimeConfig;
  httpGetText: HttpGetText;
}): Promise<WhitelistedSearchResult> {
  if (input.limit <= 0) {
    return { results: [], droppedByPolicy: 0 };
  }

  const plans = buildDuckDuckGoQueryPlans(input.query, input.sources);
  if (plans.length === 0) {
    return { results: [], droppedByPolicy: 0 };
  }

  const sourceById = new Map<string, AuthoritativeMedicalSource>(
    input.sources.map((source) => [source.id, source]),
  );
  const queryTokens = tokenizeQuery(input.query);
  const seen = new Set<string>();
  const results: AuthoritativeMedicalEvidence[] = [];
  let droppedByPolicy = 0;
  let hadRequestFailure = false;

  const planExecutions = await Promise.all(
    plans.map(async (plan, index) => {
      try {
        const endpoint =
          `https://duckduckgo.com/html/?q=${encodeURIComponent(plan.searchQuery)}`;
        const html = await input.httpGetText(endpoint, input.config.timeoutMs);
        const extracted = extractWhitelistedResultsFromDuckDuckGoHtml({
          html,
          // Parse enough candidates from each plan; final merge still obeys global limit.
          limit: input.limit,
          seen: new Set<string>(),
          queryTokens,
          preferredSource: plan.sourceId
            ? sourceById.get(plan.sourceId)
            : undefined,
        });
        return {
          index,
          failed: false,
          extracted,
        };
      } catch {
        return {
          index,
          failed: true,
          extracted: null,
        };
      }
    }),
  );

  const orderedExecutions = [...planExecutions].sort(
    (left, right) => left.index - right.index,
  );

  for (const execution of orderedExecutions) {
    if (results.length >= input.limit) {
      break;
    }
    if (execution.failed || !execution.extracted) {
      hadRequestFailure = true;
      continue;
    }

    droppedByPolicy += execution.extracted.droppedByPolicy;
    for (const item of execution.extracted.results) {
      if (results.length >= input.limit) {
        break;
      }
      const key = item.url.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push(item);
    }
  }

  if (results.length === 0 && hadRequestFailure) {
    throw new Error('duckduckgo_whitelist_unavailable');
  }

  return {
    results,
    droppedByPolicy,
  };
}

export {
  searchPubMed,
  searchWhitelistedDuckDuckGo,
};
