import fs from 'node:fs';
import path from 'node:path';
import { AuthoritativeMedicalSearchPort } from '../../../application/ports/AuthoritativeMedicalSearchPort';
import {
  AUTHORITATIVE_MEDICAL_DOCUMENT_SEEDS,
  AUTHORITATIVE_MEDICAL_SOURCES,
  AuthoritativeMedicalSearchRuntimeStats,
  AuthoritativeMedicalSearchTraceEntry,
  AuthoritativeMedicalEvidence,
  AuthoritativeMedicalSearchQuery,
  AuthoritativeMedicalSearchResult,
  AuthoritativeMedicalSource,
  MedicalSearchProviderRuntimeStats,
  isAuthoritativeMedicalUrl,
} from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import { MedicalSearchResultCache } from './cache';
import { ProviderCircuitBreaker } from './circuitBreaker';
import { createSearchRuntimeConfig, resolveSearchRuntimeConfig } from './config';
import { buildLocalFallbackEvidence } from './fallback';
import { getTextByHttps } from './httpClient';
import { createDefaultMedicalSearchProviders } from './providerRegistry';
import { probeAuthoritativeSeedPages } from './seedProbe';
import {
  buildSourceBreakdown,
  createEmptySearchResultShape,
  enforceRequiredSourceCoverage,
  resolveEvidenceSourceId,
  resolveSearchSourceScope,
  selectDiverseEvidence,
} from './sourcePolicy';
import { normalizeWhitespace } from './text';
import { createBm25HybridRagLexicalIndex } from '../hybrid-lexical/Bm25HybridRagLexicalIndex';
import { createDeterministicHybridRagEmbeddingService } from '../hybrid-vector/DeterministicHybridRagEmbeddingService';
import { createInMemoryHybridRagVectorStore } from '../hybrid-vector/InMemoryHybridRagVectorStore';
import {
  HybridRagRetriever,
  HybridRetrieverChannelProvider,
  HybridRetrieverHit,
} from './hybridRetriever';
import { rerankHybridCandidates } from './hybridReranker';
import {
  HttpGetText,
  MedicalSearchProvider,
  MedicalSearchProviderContext,
  PUBMED_SOURCE_ID,
  SEARCH_STRATEGY_VERSION,
  ResolvedSearchRuntimeConfig,
  SearchSourceScope,
  SearchRuntimeConfig,
} from './types';

function buildCacheKey(input: {
  query: string;
  retrievalQueries: readonly string[];
  limit: number;
  allowedSourceIds: Set<string>;
  requiredSourceIds: readonly string[];
}): string {
  const allowed = [...input.allowedSourceIds].sort();
  const required = [...input.requiredSourceIds].sort();
  return JSON.stringify({
    query: input.query.toLowerCase(),
    retrievalQueries: [...input.retrievalQueries].map((item) =>
      item.toLowerCase(),
    ),
    limit: input.limit,
    allowed,
    required,
  });
}

function buildRetrievalQueries(
  query: string,
  queryVariants: readonly string[] | undefined,
): string[] {
  const dedup = new Set<string>();
  const merged = [query, ...(queryVariants ?? [])];
  const selected: string[] = [];
  for (const item of merged) {
    const normalized = normalizeWhitespace(item ?? '');
    if (normalized.length < 2) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (dedup.has(key)) {
      continue;
    }
    dedup.add(key);
    selected.push(normalized);
    if (selected.length >= 6) {
      break;
    }
  }
  return selected;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'unknown_provider_error';
}

function toHybridKey(item: {
  sourceId: string;
  url: string;
}): string {
  return `${item.sourceId.toLowerCase()}|${item.url.toLowerCase()}`;
}

function toHybridScoreByRank(rank: number, maxRank: number): number {
  if (rank <= 0) {
    return 0;
  }
  const boundedMax = Math.max(1, maxRank);
  return Number((1 - (rank - 1) / boundedMax).toFixed(6));
}

function mergeHybridHits(...groups: HybridRetrieverHit[][]): HybridRetrieverHit[] {
  const merged = new Map<string, HybridRetrieverHit>();
  for (const group of groups) {
    for (const hit of group) {
      const key = toHybridKey(hit);
      const existing = merged.get(key);
      if (!existing || hit.score > existing.score) {
        merged.set(key, { ...hit });
      }
    }
  }
  return [...merged.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.url.localeCompare(right.url);
  });
}

class StaticHybridProvider implements HybridRetrieverChannelProvider {
  private readonly hits: HybridRetrieverHit[];

  public constructor(hits: HybridRetrieverHit[]) {
    this.hits = hits;
  }

  public async retrieve(): Promise<HybridRetrieverHit[]> {
    return this.hits;
  }
}

function hasRequiredSourceCoverage(
  selected: AuthoritativeMedicalEvidence[],
  requiredSourceIds: readonly string[],
): boolean {
  if (requiredSourceIds.length === 0) {
    return selected.length > 0;
  }
  const present = new Set(selected.map((item) => item.sourceId));
  return requiredSourceIds.every((sourceId) => present.has(sourceId));
}

function selectEvidenceWithRealtimePriority(input: {
  candidates: AuthoritativeMedicalEvidence[];
  requiredSourceIds: readonly string[];
  limit: number;
}): AuthoritativeMedicalEvidence[] {
  const liveCandidates = input.candidates.filter(
    (item) => item.origin !== 'catalog_seed',
  );
  if (liveCandidates.length > 0) {
    const selectedLiveOnly = enforceRequiredSourceCoverage(
      selectDiverseEvidence(liveCandidates, input.limit),
      liveCandidates,
      input.requiredSourceIds,
      input.limit,
    );
    if (
      hasRequiredSourceCoverage(selectedLiveOnly, input.requiredSourceIds)
    ) {
      return selectedLiveOnly;
    }
  }

  return enforceRequiredSourceCoverage(
    selectDiverseEvidence(input.candidates, input.limit),
    input.candidates,
    input.requiredSourceIds,
    input.limit,
  );
}

function isProtectableFallbackEvidence(
  item: AuthoritativeMedicalEvidence,
): boolean {
  if ((item.matchedQueryTokens?.length ?? 0) >= 2) {
    return true;
  }
  const bag = normalizeWhitespace(`${item.title} ${item.snippet}`).toLowerCase();
  return /\b(guideline|consensus|threshold|triage|red flag|fast|follow[-\s]?up)\b|指南|共识|阈值|分诊|红旗|急诊|随访/u
    .test(bag);
}

interface RetrievalTopicFlags {
  hypertension: boolean;
  diabetes: boolean;
  stroke: boolean;
  cardiac: boolean;
}

function inferRetrievalTopicFlags(text: string): RetrievalTopicFlags {
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

function isHardRetrievalMismatch(
  queryFlags: RetrievalTopicFlags,
  candidateFlags: RetrievalTopicFlags,
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

interface AuthoritativeMedicalWebSearchServiceOptions {
  providers?: MedicalSearchProvider[];
}

interface ServiceRuntimeCounters {
  searches: number;
  cacheHits: number;
  cacheMisses: number;
  fallbackAppliedCount: number;
}

interface ProviderRuntimeCounter {
  calls: number;
  successes: number;
  failures: number;
  skippedByCircuit: number;
  lastErrorAt?: string;
  lastErrorMessage?: string;
}

export class AuthoritativeMedicalWebSearchService
implements AuthoritativeMedicalSearchPort {
  private readonly config: ResolvedSearchRuntimeConfig;
  private readonly httpGetText: HttpGetText;
  private readonly cache: MedicalSearchResultCache;
  private readonly providers: MedicalSearchProvider[];
  private readonly providerCircuitBreaker: ProviderCircuitBreaker;
  private readonly runtimeCounters: ServiceRuntimeCounters;
  private readonly providerCounters: Map<string, ProviderRuntimeCounter>;
  private readonly recentSearches: AuthoritativeMedicalSearchTraceEntry[];
  private readonly localHybridNamespace: string;
  private readonly localHybridLexicalIndex: ReturnType<
    typeof createBm25HybridRagLexicalIndex
  >;
  private readonly localHybridVectorStore: ReturnType<
    typeof createInMemoryHybridRagVectorStore
  >;
  private readonly localHybridEmbeddingService: ReturnType<
    typeof createDeterministicHybridRagEmbeddingService
  >;
  private readonly localHybridEvidenceByDocId: Map<
    string,
    AuthoritativeMedicalEvidence
  >;
  private readonly localHybridReady: Promise<void>;
  private traceSerial: number;

  constructor(
    config: SearchRuntimeConfig,
    httpGetText: HttpGetText = getTextByHttps,
    options: AuthoritativeMedicalWebSearchServiceOptions = {},
  ) {
    this.config = resolveSearchRuntimeConfig(config);
    this.httpGetText = httpGetText;
    this.cache = new MedicalSearchResultCache(
      this.config.cacheTtlMs,
      this.config.cacheMaxEntries,
    );
    this.providers = options.providers ?? createDefaultMedicalSearchProviders();
    this.providerCircuitBreaker = new ProviderCircuitBreaker(
      this.config.providerFailureThreshold,
      this.config.providerCircuitOpenMs,
    );
    this.runtimeCounters = {
      searches: 0,
      cacheHits: 0,
      cacheMisses: 0,
      fallbackAppliedCount: 0,
    };
    this.providerCounters = new Map<string, ProviderRuntimeCounter>();
    this.recentSearches = [];
    this.localHybridNamespace = 'med-search-hybrid-local';
    this.localHybridLexicalIndex = createBm25HybridRagLexicalIndex();
    this.localHybridVectorStore = createInMemoryHybridRagVectorStore();
    this.localHybridEmbeddingService =
      createDeterministicHybridRagEmbeddingService(96);
    this.localHybridEvidenceByDocId =
      new Map<string, AuthoritativeMedicalEvidence>();
    this.localHybridReady = this.initializeLocalHybridCorpus().catch(() => {
      // Local corpus initialization is best-effort and must not break search.
    });
    this.traceSerial = 0;
    for (const provider of this.providers) {
      this.providerCounters.set(provider.id, {
        calls: 0,
        successes: 0,
        failures: 0,
        skippedByCircuit: 0,
      });
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public getSources(): AuthoritativeMedicalSource[] {
    return [...AUTHORITATIVE_MEDICAL_SOURCES];
  }

  public getRuntimeStats(): AuthoritativeMedicalSearchRuntimeStats {
    const providerStats: MedicalSearchProviderRuntimeStats[] = this.providers.map(
      (provider) => {
        const counter = this.providerCounters.get(provider.id) ?? {
          calls: 0,
          successes: 0,
          failures: 0,
          skippedByCircuit: 0,
        };
        const circuit = this.providerCircuitBreaker.snapshot(provider.id);
        return {
          providerId: provider.id,
          calls: counter.calls,
          successes: counter.successes,
          failures: counter.failures,
          skippedByCircuit: counter.skippedByCircuit,
          lastErrorAt: counter.lastErrorAt,
          lastErrorMessage: counter.lastErrorMessage,
          circuitState: circuit.state,
          circuitOpenUntil: circuit.openUntil,
        };
      },
    );

    return {
      generatedAt: nowIso(),
      searches: this.runtimeCounters.searches,
      cacheHits: this.runtimeCounters.cacheHits,
      cacheMisses: this.runtimeCounters.cacheMisses,
      fallbackAppliedCount: this.runtimeCounters.fallbackAppliedCount,
      providerStats,
      recentSearches: [...this.recentSearches],
    };
  }

  private getProviderCounter(providerId: string): ProviderRuntimeCounter {
    const existing = this.providerCounters.get(providerId);
    if (existing) {
      return existing;
    }
    const created: ProviderRuntimeCounter = {
      calls: 0,
      successes: 0,
      failures: 0,
      skippedByCircuit: 0,
    };
    this.providerCounters.set(providerId, created);
    return created;
  }

  private createTraceId(): string {
    this.traceSerial += 1;
    return `med-search-${Date.now()}-${this.traceSerial}`;
  }

  private async initializeLocalHybridCorpus(): Promise<void> {
    const sourceById = new Map(
      this.getSources().map((item) => [item.id, item] as const),
    );
    const now = nowIso();
    const documents: Array<{
      id: string;
      text: string;
      sourceId: string;
      evidence: AuthoritativeMedicalEvidence;
    }> = [];
    const dedup = new Set<string>();

    for (let index = 0; index < AUTHORITATIVE_MEDICAL_DOCUMENT_SEEDS.length; index += 1) {
      const seed = AUTHORITATIVE_MEDICAL_DOCUMENT_SEEDS[index];
      const source = sourceById.get(seed.sourceId);
      if (!source) {
        continue;
      }
      if (!isAuthoritativeMedicalUrl(seed.url)) {
        continue;
      }
      const key = `${source.id}|${seed.url.toLowerCase()}`;
      if (dedup.has(key)) {
        continue;
      }
      dedup.add(key);
      const snippet = normalizeWhitespace(
        seed.evidenceSummaryZh ??
          `${seed.title} authoritative clinical evidence seed`,
      );
      const matchedQueryTokens = [...new Set(
        seed.keywords
          .map((item) => normalizeWhitespace(item).toLowerCase())
          .filter((item) => item.length >= 2),
      )].slice(0, 6);
      const evidence: AuthoritativeMedicalEvidence = {
        sourceId: source.id,
        sourceName: source.name,
        title: seed.title,
        url: seed.url,
        snippet,
        retrievedAt: now,
        origin: 'catalog_seed',
        matchedQueryTokens,
      };
      const text = normalizeWhitespace(
        `${seed.title}\n${snippet}\n${seed.keywords.join(' ')}`,
      );
      const id = `local-seed-${index + 1}`;
      this.localHybridEvidenceByDocId.set(id, evidence);
      documents.push({
        id,
        text,
        sourceId: source.id,
        evidence,
      });
    }

    if (documents.length === 0) {
      return;
    }

    this.localHybridLexicalIndex.upsert(
      documents.map((item) => ({
        id: item.id,
        text: item.text,
        metadata: {
          sourceId: item.sourceId,
        },
      })),
    );

    const embedded = await this.localHybridEmbeddingService.embed({
      texts: documents.map((item) => item.text),
      dimensions: 96,
    });
    await this.localHybridVectorStore.upsert(
      this.localHybridNamespace,
      documents.map((item, index) => ({
        id: item.id,
        text: item.text,
        metadata: {
          sourceId: item.sourceId,
        },
        vector: embedded.vectors[index] ?? [],
      })),
    );
  }

  private async queryLocalHybridCorpus(input: {
    query: string;
    topK: number;
    sourceScope: SearchSourceScope;
  }): Promise<{
    vectorHits: HybridRetrieverHit[];
    lexicalHits: HybridRetrieverHit[];
  }> {
    await this.localHybridReady;
    if (this.localHybridEvidenceByDocId.size === 0) {
      return {
        vectorHits: [],
        lexicalHits: [],
      };
    }

    const lexicalMatches = this.localHybridLexicalIndex.search({
      query: input.query,
      topK: input.topK,
    });
    const embeddedQuery = await this.localHybridEmbeddingService.embed({
      texts: [input.query],
      dimensions: 96,
    });
    const queryVector = embeddedQuery.vectors[0] ?? [];
    if (queryVector.length === 0) {
      return {
        vectorHits: [],
        lexicalHits: [],
      };
    }

    const vectorMatches = await this.localHybridVectorStore.query(
      this.localHybridNamespace,
      {
        vector: queryVector,
        topK: input.topK,
      },
    );
    const allowedSourceIds = input.sourceScope.allowedSourceIds;

    const vectorHits = vectorMatches
      .map((item) => {
        const evidence = this.localHybridEvidenceByDocId.get(item.id);
        if (!evidence || !allowedSourceIds.has(evidence.sourceId)) {
          return null;
        }
        return {
          ...evidence,
          score: item.score,
        };
      })
      .filter((item): item is HybridRetrieverHit => item !== null);

    const lexicalHits = lexicalMatches
      .map((item) => {
        const evidence = this.localHybridEvidenceByDocId.get(item.id);
        if (!evidence || !allowedSourceIds.has(evidence.sourceId)) {
          return null;
        }
        return {
          ...evidence,
          score: item.score,
        };
      })
      .filter((item): item is HybridRetrieverHit => item !== null);

    return {
      vectorHits,
      lexicalHits,
    };
  }

  private appendRuntimeTrace(entry: AuthoritativeMedicalSearchTraceEntry): void {
    this.recentSearches.unshift(entry);
    if (this.recentSearches.length > this.config.recentSearchLogLimit) {
      this.recentSearches.length = this.config.recentSearchLogLimit;
    }

    if (!this.config.runtimeLogFilePath) {
      return;
    }

    try {
      fs.mkdirSync(path.dirname(this.config.runtimeLogFilePath), {
        recursive: true,
      });
      fs.appendFileSync(
        this.config.runtimeLogFilePath,
        `${JSON.stringify(entry)}\n`,
        'utf8',
      );
    } catch {
      // Ignore runtime logging I/O failures, should not block triage path.
    }
  }

  private recordSearchTrace(input: {
    query: string;
    queryVariants: string[];
    limit: number;
    sourceFilter: string[];
    requiredSources: string[];
    fromCache: boolean;
    result: AuthoritativeMedicalSearchResult;
  }): void {
    this.appendRuntimeTrace({
      traceId: this.createTraceId(),
      generatedAt: nowIso(),
      query: input.query,
      queryVariants: [...input.queryVariants],
      limit: input.limit,
      sourceFilter: [...input.sourceFilter],
      requiredSources: [...input.requiredSources],
      fromCache: input.fromCache,
      resultCount: input.result.results.length,
      realtimeCount: input.result.realtimeCount,
      fallbackCount: input.result.fallbackCount,
      droppedByPolicy: input.result.droppedByPolicy,
      usedSources: [...input.result.usedSources],
      fallbackReasons: [...(input.result.fallbackReasons ?? [])],
      missingRequiredSources: [...(input.result.missingRequiredSources ?? [])],
    });
  }

  private async applyHybridRetrievalFusion(input: {
    query: string;
    queryVariants?: readonly string[];
    candidates: AuthoritativeMedicalEvidence[];
    limit: number;
    sourceScope: SearchSourceScope;
  }): Promise<AuthoritativeMedicalEvidence[]> {
    const fallback = selectEvidenceWithRealtimePriority({
      candidates: input.candidates,
      requiredSourceIds: input.sourceScope.requiredSourceIds,
      limit: input.limit,
    });
    if (!this.config.hybridRetrievalEnabled) {
      return fallback;
    }

    try {
      const topK = Math.max(input.limit * 3, 12);
      const workingPool = input.candidates.slice(0, Math.max(topK * 2, 24));
      const lexicalIndex = createBm25HybridRagLexicalIndex();
      const vectorStore = createInMemoryHybridRagVectorStore();
      const embeddingService = createDeterministicHybridRagEmbeddingService(96);
      const namespace = 'med-search-hybrid-runtime';
      const evidenceByDocId = new Map<string, AuthoritativeMedicalEvidence>();
      const docTexts: string[] = [];
      const docIds: string[] = [];

      for (let index = 0; index < workingPool.length; index += 1) {
        const evidence = workingPool[index];
        const docId = `doc-${index + 1}`;
        const text = normalizeWhitespace(`${evidence.title} ${evidence.snippet}`);
        evidenceByDocId.set(docId, evidence);
        docIds.push(docId);
        docTexts.push(text);
      }

      lexicalIndex.upsert(
        docIds.map((id, index) => ({
          id,
          text: docTexts[index] ?? '',
          metadata: {
            sourceId: evidenceByDocId.get(id)?.sourceId ?? 'UNKNOWN',
          },
        })),
      );

      const embeddedDocs = await embeddingService.embed({
        texts: docTexts,
        dimensions: 96,
      });
      await vectorStore.upsert(
        namespace,
        docIds.map((id, index) => ({
          id,
          text: docTexts[index] ?? '',
          metadata: {
            sourceId: evidenceByDocId.get(id)?.sourceId ?? 'UNKNOWN',
          },
          vector: embeddedDocs.vectors[index] ?? [],
        })),
      );

      const embeddedQuery = await embeddingService.embed({
        texts: [input.query],
        dimensions: 96,
      });
      const queryVector = embeddedQuery.vectors[0] ?? [];
      if (queryVector.length === 0) {
        return fallback;
      }

      const [vectorMatches, lexicalMatches, localHybridHits] = await Promise.all([
        vectorStore.query(namespace, {
          vector: queryVector,
          topK,
        }),
        Promise.resolve(
          lexicalIndex.search({
            query: input.query,
            topK,
          }),
        ),
        this.queryLocalHybridCorpus({
          query: input.query,
          topK,
          sourceScope: input.sourceScope,
        }),
      ]);

      const runtimeVectorHits: HybridRetrieverHit[] = vectorMatches
        .map((item) => {
          const evidence = evidenceByDocId.get(item.id);
          if (!evidence) {
            return null;
          }
          return {
            ...evidence,
            score: item.score,
          };
        })
        .filter((item): item is HybridRetrieverHit => item !== null);

      const runtimeLexicalHits: HybridRetrieverHit[] = lexicalMatches
        .map((item) => {
          const evidence = evidenceByDocId.get(item.id);
          if (!evidence) {
            return null;
          }
          return {
            ...evidence,
            score: item.score,
          };
        })
        .filter((item): item is HybridRetrieverHit => item !== null);

      const vectorHits = mergeHybridHits(
        runtimeVectorHits,
        localHybridHits.vectorHits,
      );
      const lexicalHits = mergeHybridHits(
        runtimeLexicalHits,
        localHybridHits.lexicalHits,
      );

      const onlineHits: HybridRetrieverHit[] = workingPool.map((item, index) => ({
        ...item,
        score: toHybridScoreByRank(index + 1, workingPool.length),
      }));

      const retriever = new HybridRagRetriever({
        vectorProvider: new StaticHybridProvider(vectorHits),
        lexicalProvider: new StaticHybridProvider(lexicalHits),
        onlineProvider: new StaticHybridProvider(onlineHits),
      });

      const retrieved = await retriever.retrieve({
        query: input.query,
        topK,
        sourceFilter: input.sourceScope.allowedSources.map((source) => source.id),
        requiredSources: [...input.sourceScope.requiredSourceIds],
      });
      if (retrieved.candidates.length === 0) {
        return fallback;
      }

      const vectorRankByKey = new Map<string, number>();
      vectorHits.forEach((item, index) => {
        vectorRankByKey.set(toHybridKey(item), index + 1);
      });
      const lexicalRankByKey = new Map<string, number>();
      lexicalHits.forEach((item, index) => {
        lexicalRankByKey.set(toHybridKey(item), index + 1);
      });
      const onlineRankByKey = new Map<string, number>();
      onlineHits.forEach((item, index) => {
        onlineRankByKey.set(toHybridKey(item), index + 1);
      });
      const candidateByKey = new Map<string, AuthoritativeMedicalEvidence>();
      for (const item of retrieved.candidates) {
        candidateByKey.set(toHybridKey(item), {
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          publishedOn: item.publishedOn,
          retrievedAt: item.retrievedAt,
          origin: item.origin,
          matchedQueryTokens: item.matchedQueryTokens,
        });
      }

      const reranked = rerankHybridCandidates(
        retrieved.candidates.map((item) => {
          const key = toHybridKey(item);
          return {
            id: key,
            sourceId: item.sourceId,
            url: item.url,
            title: item.title,
            snippet: item.snippet,
            channelRanks: {
              vector: vectorRankByKey.get(key),
              lexical: lexicalRankByKey.get(key),
              online: onlineRankByKey.get(key),
            },
            publishedOn: item.publishedOn,
            redFlagMatched: /warning|red flag|emergency|urgent|stroke|chest pain/i.test(
              `${item.title} ${item.snippet}`,
            ),
          };
        }),
        {
          query: input.query,
          queryVariants: [...(input.queryVariants ?? [])],
          topK: input.limit,
        },
      );

      const rerankedEvidence = reranked
        .map((item) => candidateByKey.get(toHybridKey(item)))
        .filter((item): item is AuthoritativeMedicalEvidence => item !== undefined);
      const queryTopicFlags = inferRetrievalTopicFlags(
        [input.query, ...(input.queryVariants ?? [])].join(' '),
      );
      const topicFilteredReranked = rerankedEvidence.filter((item) => {
        const candidateFlags = inferRetrievalTopicFlags(
          `${item.title} ${item.snippet}`,
        );
        return !isHardRetrievalMismatch(queryTopicFlags, candidateFlags);
      });
      const effectiveRerankedEvidence =
        topicFilteredReranked.length > 0 ? topicFilteredReranked : rerankedEvidence;

      const localSupportPool = mergeHybridHits(
        localHybridHits.vectorHits,
        localHybridHits.lexicalHits,
      ).map((item) => ({
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        publishedOn: item.publishedOn,
        retrievedAt: item.retrievedAt,
        origin: item.origin,
        matchedQueryTokens: item.matchedQueryTokens,
      }));
      const supportByKey = new Map<string, AuthoritativeMedicalEvidence>();
      for (const item of [...input.candidates, ...localSupportPool]) {
        supportByKey.set(toHybridKey(item), item);
      }

      const prefix = fallback
        .filter((item) => isProtectableFallbackEvidence(item))
        .slice(0, Math.min(2, input.limit));
      const protectedKeys = new Set(prefix.map((item) => toHybridKey(item)));
      const suffix = [
        ...effectiveRerankedEvidence,
        ...fallback.filter((item) => !protectedKeys.has(toHybridKey(item))),
      ];
      const dedupedBlended: AuthoritativeMedicalEvidence[] = [];
      const seen = new Set<string>();
      for (const item of [...prefix, ...suffix]) {
        const key = toHybridKey(item);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        dedupedBlended.push(item);
        if (dedupedBlended.length >= input.limit) {
          break;
        }
      }

      return enforceRequiredSourceCoverage(
        dedupedBlended,
        [...supportByKey.values()],
        input.sourceScope.requiredSourceIds,
        input.limit,
      );
    } catch {
      return fallback;
    }
  }

  public async search(
    input: AuthoritativeMedicalSearchQuery,
  ): Promise<AuthoritativeMedicalSearchResult> {
    this.runtimeCounters.searches += 1;

    const query = normalizeWhitespace(input.query ?? '');
    const retrievalQueries = buildRetrievalQueries(query, input.queryVariants);
    const primaryQuery = retrievalQueries[0] ?? query;
    const limit = Math.min(
      this.config.maxResults,
      Math.max(1, Math.floor(input.limit || 1)),
    );

    if (!this.config.enabled || retrievalQueries.length === 0) {
      const emptyResult = createEmptySearchResultShape(primaryQuery);
      this.recordSearchTrace({
        query: primaryQuery,
        queryVariants: retrievalQueries,
        limit,
        sourceFilter: [],
        requiredSources: [],
        fromCache: false,
        result: emptyResult,
      });
      return emptyResult;
    }

    const sourceScope = resolveSearchSourceScope(this.getSources(), input);
    if (sourceScope.allowedSources.length === 0) {
      const emptyResult = createEmptySearchResultShape(primaryQuery);
      this.recordSearchTrace({
        query: primaryQuery,
        queryVariants: retrievalQueries,
        limit,
        sourceFilter: [],
        requiredSources: [],
        fromCache: false,
        result: emptyResult,
      });
      return emptyResult;
    }

    const cacheKey = buildCacheKey({
      query: primaryQuery,
      retrievalQueries,
      limit,
      allowedSourceIds: sourceScope.allowedSourceIds,
      requiredSourceIds: sourceScope.requiredSourceIds,
    });
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.runtimeCounters.cacheHits += 1;
      this.recordSearchTrace({
        query: primaryQuery,
        queryVariants: retrievalQueries,
        limit,
        sourceFilter: sourceScope.allowedSources.map((source) => source.id),
        requiredSources: [...sourceScope.requiredSourceIds],
        fromCache: true,
        result: cached,
      });
      return cached;
    }
    this.runtimeCounters.cacheMisses += 1;

    const dedup = new Set<string>();
    const candidates: AuthoritativeMedicalEvidence[] = [];
    let droppedByPolicy = 0;

    const addCandidates = (items: AuthoritativeMedicalEvidence[]): void => {
      for (const item of items) {
        if (!isAuthoritativeMedicalUrl(item.url)) {
          droppedByPolicy += 1;
          continue;
        }
        const resolvedSourceId = resolveEvidenceSourceId(
          item,
          sourceScope.sourceById,
        );
        if (
          !resolvedSourceId ||
          !sourceScope.allowedSourceIds.has(resolvedSourceId)
        ) {
          droppedByPolicy += 1;
          continue;
        }
        const key = item.url.toLowerCase();
        if (dedup.has(key)) {
          continue;
        }
        dedup.add(key);
        const source = sourceScope.sourceById.get(resolvedSourceId);
        candidates.push({
          ...item,
          sourceId: resolvedSourceId,
          sourceName: item.sourceName || source?.name || resolvedSourceId,
          origin: item.origin ?? 'live_search',
        });
      }
    };

    if (this.config.networkEnabled) {
      const providerContext: MedicalSearchProviderContext = {
        query: primaryQuery,
        retrievalQueries,
        limit,
        allowedSources: sourceScope.allowedSources,
        allowedSourceIds: sourceScope.allowedSourceIds,
        config: this.config,
        httpGetText: this.httpGetText,
      };
      const providerTasks = this.providers
        .filter((provider) => provider.isEnabled(providerContext))
        .map(async (provider) => {
          const providerCounter = this.getProviderCounter(provider.id);
          if (!this.providerCircuitBreaker.canExecute(provider.id)) {
            providerCounter.skippedByCircuit += 1;
            return null;
          }
          providerCounter.calls += 1;

          try {
            const execution = await provider.search(providerContext);
            providerCounter.successes += 1;
            this.providerCircuitBreaker.recordSuccess(provider.id);
            return execution;
          } catch (error) {
            providerCounter.failures += 1;
            providerCounter.lastErrorAt = nowIso();
            providerCounter.lastErrorMessage = toErrorMessage(error);
            this.providerCircuitBreaker.recordFailure(provider.id);
            return null;
          }
        });

      const providerResults = await Promise.all(providerTasks);
      for (const providerResult of providerResults) {
        if (!providerResult) {
          continue;
        }
        droppedByPolicy += providerResult.droppedByPolicy;
        addCandidates(providerResult.results);
      }
    }

    const allowsNonPubMedSource = sourceScope.allowedSources.some(
      (source) => source.id !== PUBMED_SOURCE_ID,
    );
    const hasNonPubMedCandidate = (): boolean =>
      candidates.some((item) => item.sourceId !== PUBMED_SOURCE_ID);
    const resolveMissingRequiredSources = (): string[] =>
      sourceScope.requiredSourceIds.filter(
        (sourceId) => !candidates.some((item) => item.sourceId === sourceId),
      );

    const missingRequiredSourcesBeforeProbe = resolveMissingRequiredSources();
    const needRealtimeSeedProbe =
      this.config.networkEnabled &&
      allowsNonPubMedSource &&
      (
        candidates.length === 0 ||
        !hasNonPubMedCandidate() ||
        missingRequiredSourcesBeforeProbe.length > 0
      );

    if (needRealtimeSeedProbe) {
      const nonPubmedAllowedSources = sourceScope.allowedSources
        .map((source) => source.id)
        .filter((sourceId) => sourceId !== PUBMED_SOURCE_ID);
      const targetSourceIds = [...new Set([
        ...missingRequiredSourcesBeforeProbe,
        ...nonPubmedAllowedSources,
      ])];
      const probed = await probeAuthoritativeSeedPages({
        query: primaryQuery,
        limit: Math.min(Math.max(limit, targetSourceIds.length), 8),
        timeoutMs: this.config.timeoutMs,
        targetSourceIds,
        allowedSourceIds: sourceScope.allowedSourceIds,
        httpGetText: this.httpGetText,
      });
      addCandidates(probed);
    }

    const missingRequiredSourcesAfterProbe = resolveMissingRequiredSources();
    const fallbackReasons: string[] = [];
    if (candidates.length === 0) {
      fallbackReasons.push('no_candidates');
    }
    if (allowsNonPubMedSource && !hasNonPubMedCandidate()) {
      fallbackReasons.push('no_non_pubmed_realtime');
    }
    if (this.config.allowPartialSeedFill && candidates.length < limit) {
      fallbackReasons.push('partial_fill');
    }
    // Do not force seed fill purely because a required source is missing.
    // This avoids repetitive static catalog evidence overshadowing realtime recall.
    if (missingRequiredSourcesAfterProbe.length > 0 && candidates.length === 0) {
      fallbackReasons.push('missing_required_sources');
    }

    if (fallbackReasons.length > 0) {
      this.runtimeCounters.fallbackAppliedCount += 1;
      const fallback = buildLocalFallbackEvidence(
        primaryQuery,
        Math.max(limit, 8),
        sourceScope.allowedSourceIds,
      );
      addCandidates(fallback);
    }

    const selected = await this.applyHybridRetrievalFusion({
      query: primaryQuery,
      queryVariants: retrievalQueries,
      candidates,
      limit,
      sourceScope,
    });
    const usedSources = [...new Set(selected.map((item) => item.sourceId))];
    const realtimeCount = selected.filter(
      (item) => item.origin !== 'catalog_seed',
    ).length;
    const fallbackCount = selected.length - realtimeCount;
    const missingRequiredSources = sourceScope.requiredSourceIds.filter(
      (sourceId) => !usedSources.includes(sourceId),
    );

    const result: AuthoritativeMedicalSearchResult = {
      query: primaryQuery,
      results: selected,
      droppedByPolicy,
      usedSources,
      sourceBreakdown: buildSourceBreakdown(selected),
      strategyVersion: this.config.hybridRetrievalEnabled
        ? `${SEARCH_STRATEGY_VERSION}+hybrid-v1`
        : SEARCH_STRATEGY_VERSION,
      generatedAt: nowIso(),
      realtimeCount,
      fallbackCount,
      fallbackReasons,
      missingRequiredSources,
    };
    const shouldCache = !(
      this.config.networkEnabled &&
      result.fallbackCount > 0
    );
    if (shouldCache) {
      this.cache.set(cacheKey, result);
    }

    this.recordSearchTrace({
      query: primaryQuery,
      queryVariants: retrievalQueries,
      limit,
      sourceFilter: sourceScope.allowedSources.map((source) => source.id),
      requiredSources: [...sourceScope.requiredSourceIds],
      fromCache: false,
      result,
    });

    return result;
  }
}

export function createAuthoritativeMedicalSearchService(
  env: NodeJS.ProcessEnv = process.env,
): AuthoritativeMedicalSearchPort {
  return new AuthoritativeMedicalWebSearchService(createSearchRuntimeConfig(env));
}
