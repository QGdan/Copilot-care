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
  const searchPayload = JSON.parse(searchRaw) as {
    esearchresult?: { idlist?: string[] };
  };

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
  const summaryPayload = JSON.parse(summaryRaw) as {
    result?: Record<string, unknown>;
  };
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
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = matcher.exec(input.html);

  while (match) {
    const href = match[1];
    const titleHtml = match[2];
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

  for (const plan of plans) {
    if (results.length >= input.limit) {
      break;
    }
    try {
      const endpoint =
        `https://duckduckgo.com/html/?q=${encodeURIComponent(plan.searchQuery)}`;
      const html = await input.httpGetText(endpoint, input.config.timeoutMs);
      const extracted = extractWhitelistedResultsFromDuckDuckGoHtml({
        html,
        limit: input.limit - results.length,
        seen,
        queryTokens,
        preferredSource: plan.sourceId
          ? sourceById.get(plan.sourceId)
          : undefined,
      });
      droppedByPolicy += extracted.droppedByPolicy;
      results.push(...extracted.results);
    } catch {
      // Keep searching with remaining plans when one query fails.
      hadRequestFailure = true;
      continue;
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
