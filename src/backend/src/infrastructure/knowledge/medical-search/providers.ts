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
  extractFocusedClinicalSnippet,
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

const RRF_K = 60;
const MAX_REALTIME_QUERY_VARIANTS = 3;

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

interface RawWhitelistedEvidence extends AuthoritativeMedicalEvidence {
  rawSnippet?: string;
}

interface RawWhitelistedSearchResult {
  results: RawWhitelistedEvidence[];
  droppedByPolicy: number;
}

function decodePubMedXmlText(value: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' '),
  );
}

async function fetchPubMedAbstractByIds(input: {
  ids: readonly string[];
  config: ResolvedSearchRuntimeConfig;
  httpGetText: HttpGetText;
}): Promise<Map<string, string>> {
  const ids = input.ids.filter((id) => /^\d+$/.test(id)).slice(0, 8);
  const abstractsById = new Map<string, string>();
  if (ids.length === 0) {
    return abstractsById;
  }

  try {
    const endpoint =
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?' +
      `db=pubmed&retmode=xml&id=${encodeURIComponent(ids.join(','))}`;
    const xml = await input.httpGetText(endpoint, input.config.timeoutMs);
    const articleBlocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) ?? [];
    for (const block of articleBlocks) {
      const pmidMatch = block.match(/<PMID[^>]*>\s*(\d+)\s*<\/PMID>/i);
      const pmid = pmidMatch?.[1];
      if (!pmid) {
        continue;
      }
      const abstractMatches = [...block.matchAll(
        /<AbstractText(?:\s+Label="([^"]+)")?[^>]*>([\s\S]*?)<\/AbstractText>/gi,
      )];
      if (abstractMatches.length === 0) {
        continue;
      }
      const abstractText = abstractMatches
        .map((matched) => {
          const label = decodePubMedXmlText(matched[1] ?? '');
          const text = decodePubMedXmlText(matched[2] ?? '');
          if (!text) {
            return '';
          }
          return label ? `${label}：${text}` : text;
        })
        .filter((item) => item.length > 0)
        .join(' ');
      if (abstractText) {
        abstractsById.set(pmid, abstractText);
      }
    }
  } catch {
    return abstractsById;
  }

  return abstractsById;
}

function normalizeQueryList(queries: readonly string[]): string[] {
  const dedup = new Set<string>();
  const normalized: string[] = [];
  for (const query of queries) {
    const value = normalizeWhitespace(query);
    if (value.length < 2) {
      continue;
    }
    const key = value.toLowerCase();
    if (dedup.has(key)) {
      continue;
    }
    dedup.add(key);
    normalized.push(value);
    if (normalized.length >= 6) {
      break;
    }
  }
  return normalized;
}

function dedupeTokenList(values: readonly string[]): string[] {
  const dedup = new Set<string>();
  const selected: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (normalized.length < 2 || dedup.has(normalized)) {
      continue;
    }
    dedup.add(normalized);
    selected.push(normalized);
  }
  return selected;
}

function mergeMatchedQueryTokens(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] {
  const merged = [...(left ?? []), ...(right ?? [])]
    .map((item) => normalizeWhitespace(item).toLowerCase())
    .filter((item) => item.length >= 2);
  const dedup = new Set<string>();
  const selected: string[] = [];
  for (const token of merged) {
    if (dedup.has(token)) {
      continue;
    }
    dedup.add(token);
    selected.push(token);
    if (selected.length >= 6) {
      break;
    }
  }
  return selected;
}

function queryWeight(index: number): number {
  return Math.max(0.55, 1 - (index * 0.12));
}

function fuseEvidenceByRrf(input: {
  perQueryBatches: Array<readonly AuthoritativeMedicalEvidence[]>;
  limit: number;
}): AuthoritativeMedicalEvidence[] {
  if (input.limit <= 0) {
    return [];
  }

  const scoreByUrl = new Map<string, number>();
  const firstSeenRank = new Map<string, { queryIndex: number; rank: number }>();
  const evidenceByUrl = new Map<string, AuthoritativeMedicalEvidence>();

  input.perQueryBatches.forEach((batch, queryIndex) => {
    const weight = queryWeight(queryIndex);
    batch.forEach((item, rank) => {
      const key = item.url.toLowerCase();
      const rrfScore = weight / (RRF_K + rank + 1);
      const tokenBonus = Math.min(
        0.05,
        (item.matchedQueryTokens?.length ?? 0) * 0.01,
      );
      scoreByUrl.set(key, (scoreByUrl.get(key) ?? 0) + rrfScore + tokenBonus);

      if (!firstSeenRank.has(key)) {
        firstSeenRank.set(key, { queryIndex, rank });
      }

      const existing = evidenceByUrl.get(key);
      if (!existing) {
        evidenceByUrl.set(key, item);
        return;
      }
      evidenceByUrl.set(key, {
        ...existing,
        snippet:
          existing.snippet.length >= item.snippet.length
            ? existing.snippet
            : item.snippet,
        matchedQueryTokens: mergeMatchedQueryTokens(
          existing.matchedQueryTokens,
          item.matchedQueryTokens,
        ),
      });
    });
  });

  return [...evidenceByUrl.entries()]
    .sort((left, right) => {
      const scoreDelta = (scoreByUrl.get(right[0]) ?? 0) - (scoreByUrl.get(left[0]) ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const leftRank = firstSeenRank.get(left[0]) ?? { queryIndex: 99, rank: 99 };
      const rightRank = firstSeenRank.get(right[0]) ?? { queryIndex: 99, rank: 99 };
      if (leftRank.queryIndex !== rightRank.queryIndex) {
        return leftRank.queryIndex - rightRank.queryIndex;
      }
      return leftRank.rank - rightRank.rank;
    })
    .map((entry) => entry[1])
    .slice(0, input.limit);
}

async function searchPubMedBySingleQuery(input: {
  query: string;
  max: number;
  config: ResolvedSearchRuntimeConfig;
  httpGetText: HttpGetText;
}): Promise<AuthoritativeMedicalEvidence[]> {
  if (input.max <= 0) {
    return [];
  }

  const searchUrl =
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?' +
    `db=pubmed&retmode=json&retmax=${input.max}&sort=relevance&term=${encodeURIComponent(input.query)}`;
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
  const ids = idList.filter((id) => /^\d+$/.test(id)).slice(0, input.max);
  if (ids.length === 0) {
    return [];
  }
  const abstractsById = await fetchPubMedAbstractByIds({
    ids,
    config: input.config,
    httpGetText: input.httpGetText,
  });

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
    const abstractText = abstractsById.get(id) ?? '';
    const url = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
    if (!isAuthoritativeMedicalUrl(url)) {
      continue;
    }
    const snippet = buildPubMedChineseSnippet({
      title,
      journal: sourceNameRaw,
      publishedOn,
      queryTokens,
      rawSnippet: abstractText,
    });
    const matchedQueryTokens = extractMatchedQueryTokens(
      queryTokens,
      `${title} ${sourceNameRaw} ${abstractText}`,
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
    if (evidence.length >= input.max) {
      break;
    }
  }

  return evidence;
}

async function searchPubMed(input: {
  queries: readonly string[];
  limit: number;
  config: ResolvedSearchRuntimeConfig;
  httpGetText: HttpGetText;
}): Promise<AuthoritativeMedicalEvidence[]> {
  const normalizedQueries = normalizeQueryList(input.queries).slice(
    0,
    MAX_REALTIME_QUERY_VARIANTS,
  );
  const max = Math.min(Math.max(1, input.limit), input.config.pubMedRetMax);
  if (max <= 0 || normalizedQueries.length === 0) {
    return [];
  }

  const perQueryBatches: AuthoritativeMedicalEvidence[][] =
    new Array(normalizedQueries.length).fill(null).map(() => []);
  let hadFailure = false;

  const executions = await Promise.allSettled(
    normalizedQueries.map((query) =>
      searchPubMedBySingleQuery({
        query,
        max,
        config: input.config,
        httpGetText: input.httpGetText,
      }),
    ),
  );
  executions.forEach((execution, index) => {
    if (execution.status === 'fulfilled') {
      perQueryBatches[index] = execution.value;
      return;
    }
    hadFailure = true;
  });

  const fused = fuseEvidenceByRrf({
    perQueryBatches,
    limit: max,
  });
  if (fused.length === 0 && hadFailure) {
    throw new Error('pubmed_unavailable');
  }

  return fused;
}

function extractWhitelistedResultsFromDuckDuckGoHtml(input: {
  html: string;
  limit: number;
  seen: Set<string>;
  queryTokens: string[];
  preferredSource?: AuthoritativeMedicalSource;
}): RawWhitelistedSearchResult {
  const results: RawWhitelistedEvidence[] = [];
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
            rawSnippet,
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

function stripRawWhitelistedEvidence(
  item: RawWhitelistedEvidence,
): AuthoritativeMedicalEvidence {
  return {
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    publishedOn: item.publishedOn,
    retrievedAt: item.retrievedAt,
    origin: item.origin,
    matchedQueryTokens: item.matchedQueryTokens,
  };
}

function shouldDeepEnrichWhitelistedEvidence(item: RawWhitelistedEvidence): boolean {
  const summary = normalizeWhitespace(item.snippet ?? '');
  if (!summary) {
    return true;
  }
  if (
    !summary.includes('证据要点：')
    || !summary.includes('临床解读：')
    || !summary.includes('建议动作：')
  ) {
    return true;
  }
  if (/证据要点：\s*证据要点：/u.test(summary)) {
    return true;
  }
  if (/([\\/]\s*){2,}/u.test(summary)) {
    return true;
  }
  const hasNumericSignal = /\d{2,3}\s*\/\s*\d{2,3}|\d+(?:\.\d+)?\s*(?:mmhg|毫米汞柱|%|天|周|个月)/iu
    .test(summary);
  const hasActionSignal = /(复测|复查|监测|评估|转诊|急诊|随访|升级处置|干预)/u.test(summary);
  return !hasNumericSignal && !hasActionSignal;
}

async function enrichWhitelistedEvidenceWithSourcePages(input: {
  results: RawWhitelistedEvidence[];
  normalizedQueries: readonly string[];
  config: ResolvedSearchRuntimeConfig;
  httpGetText: HttpGetText;
}): Promise<RawWhitelistedEvidence[]> {
  if (input.results.length === 0) {
    return [];
  }
  const maxToEnrich = Math.min(2, input.results.length);
  const globalQueryTokens = tokenizeQuery(input.normalizedQueries.join(' '));
  const timeoutMs = Math.min(1200, input.config.timeoutMs);
  let enrichedCount = 0;

  return Promise.all(
    input.results.map(async (item, index) => {
      if (
        index >= maxToEnrich
        || enrichedCount >= maxToEnrich
        || !shouldDeepEnrichWhitelistedEvidence(item)
      ) {
        return item;
      }
      enrichedCount += 1;
      try {
        const pageHtml = await input.httpGetText(item.url, timeoutMs, 1);
        const pageText = stripHtml(decodeHtmlEntities(pageHtml));
        const focusedRaw = extractFocusedClinicalSnippet({
          text: `${item.rawSnippet ?? ''} ${pageText}`,
          queryTokens: dedupeTokenList([
            ...(item.matchedQueryTokens ?? []),
            ...globalQueryTokens,
          ]).slice(0, 10),
          maxLength: 520,
        });
        if (focusedRaw.trim().length < 20) {
          return item;
        }
        const summary = buildChineseEvidenceSnippet({
          sourceName: item.sourceName,
          title: item.title,
          rawSnippet: focusedRaw,
          queryTokens: dedupeTokenList([
            ...globalQueryTokens,
            ...(item.matchedQueryTokens ?? []),
          ]).slice(0, 10),
        });
        return {
          ...item,
          snippet: summary,
          rawSnippet: focusedRaw,
        };
      } catch {
        return item;
      }
    }),
  );
}

async function searchWhitelistedDuckDuckGo(input: {
  queries: readonly string[];
  limit: number;
  sources: AuthoritativeMedicalSource[];
  config: ResolvedSearchRuntimeConfig;
  httpGetText: HttpGetText;
}): Promise<WhitelistedSearchResult> {
  if (input.limit <= 0) {
    return { results: [], droppedByPolicy: 0 };
  }

  const normalizedQueries = normalizeQueryList(input.queries).slice(
    0,
    MAX_REALTIME_QUERY_VARIANTS,
  );
  if (normalizedQueries.length === 0) {
    return { results: [], droppedByPolicy: 0 };
  }

  interface DdgExecutionPlan {
    planIndex: number;
    queryIndex: number;
    sourceId?: string;
    searchQuery: string;
  }

  const plans: DdgExecutionPlan[] = [];
  const queryDedup = new Set<string>();
  for (let queryIndex = 0; queryIndex < normalizedQueries.length; queryIndex += 1) {
    const query = normalizedQueries[queryIndex];
    const queryPlans = buildDuckDuckGoQueryPlans(query, input.sources);
    for (const plan of queryPlans) {
      const key = plan.searchQuery.toLowerCase();
      if (queryDedup.has(key)) {
        continue;
      }
      queryDedup.add(key);
      plans.push({
        planIndex: plans.length,
        queryIndex,
        sourceId: plan.sourceId,
        searchQuery: plan.searchQuery,
      });
    }
  }

  if (plans.length === 0) {
    return { results: [], droppedByPolicy: 0 };
  }

  const sourceById = new Map<string, AuthoritativeMedicalSource>(
    input.sources.map((source) => [source.id, source]),
  );
  const queryTokensByIndex = normalizedQueries.map((query) => tokenizeQuery(query));
  const perQueryBuckets = new Map<number, RawWhitelistedEvidence[]>();
  const perQuerySeenUrls = new Map<number, Set<string>>();
  let droppedByPolicy = 0;
  let hadRequestFailure = false;

  const planExecutions = await Promise.all(
    plans.map(async (plan) => {
      try {
        const endpoint =
          `https://duckduckgo.com/html/?q=${encodeURIComponent(plan.searchQuery)}`;
        const html = await input.httpGetText(endpoint, input.config.timeoutMs);
        const extracted = extractWhitelistedResultsFromDuckDuckGoHtml({
          html,
          // Parse enough candidates from each plan; final merge still obeys global limit.
          limit: input.limit,
          seen: new Set<string>(),
          queryTokens: queryTokensByIndex[plan.queryIndex] ?? [],
          preferredSource: plan.sourceId ? sourceById.get(plan.sourceId) : undefined,
        });
        return {
          planIndex: plan.planIndex,
          queryIndex: plan.queryIndex,
          failed: false,
          extracted,
        };
      } catch {
        return {
          planIndex: plan.planIndex,
          queryIndex: plan.queryIndex,
          failed: true,
          extracted: null,
        };
      }
    }),
  );

  const orderedExecutions = [...planExecutions].sort(
    (left, right) => left.planIndex - right.planIndex,
  );

  for (const execution of orderedExecutions) {
    if (execution.failed || !execution.extracted) {
      hadRequestFailure = true;
      continue;
    }

    droppedByPolicy += execution.extracted.droppedByPolicy;
    const bucket = perQueryBuckets.get(execution.queryIndex) ?? [];
    const seenUrls = perQuerySeenUrls.get(execution.queryIndex) ?? new Set<string>();
    for (const item of execution.extracted.results) {
      const key = item.url.toLowerCase();
      if (seenUrls.has(key)) {
        continue;
      }
      seenUrls.add(key);
      bucket.push(item);
    }
    perQueryBuckets.set(execution.queryIndex, bucket);
    perQuerySeenUrls.set(execution.queryIndex, seenUrls);
  }

  const perQueryBatches = normalizedQueries.map(
    (_query, index) => perQueryBuckets.get(index) ?? [],
  );
  const rawResults = fuseEvidenceByRrf({
    perQueryBatches,
    limit: input.limit,
  }) as RawWhitelistedEvidence[];
  const enrichedResults = await enrichWhitelistedEvidenceWithSourcePages({
    results: rawResults,
    normalizedQueries,
    config: input.config,
    httpGetText: input.httpGetText,
  });
  const results = enrichedResults.map(stripRawWhitelistedEvidence);

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
