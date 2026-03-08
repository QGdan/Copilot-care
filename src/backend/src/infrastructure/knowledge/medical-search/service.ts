import fs from 'node:fs';
import path from 'node:path';
import { AuthoritativeMedicalSearchPort } from '../../../application/ports/AuthoritativeMedicalSearchPort';
import {
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
import {
  HttpGetText,
  MedicalSearchProvider,
  MedicalSearchProviderContext,
  PUBMED_SOURCE_ID,
  SEARCH_STRATEGY_VERSION,
  ResolvedSearchRuntimeConfig,
  SearchRuntimeConfig,
} from './types';

function buildCacheKey(input: {
  query: string;
  limit: number;
  allowedSourceIds: Set<string>;
  requiredSourceIds: readonly string[];
}): string {
  const allowed = [...input.allowedSourceIds].sort();
  const required = [...input.requiredSourceIds].sort();
  return JSON.stringify({
    query: input.query.toLowerCase(),
    limit: input.limit,
    allowed,
    required,
  });
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

  public async search(
    input: AuthoritativeMedicalSearchQuery,
  ): Promise<AuthoritativeMedicalSearchResult> {
    this.runtimeCounters.searches += 1;

    const query = normalizeWhitespace(input.query ?? '');
    const limit = Math.min(
      this.config.maxResults,
      Math.max(1, Math.floor(input.limit || 1)),
    );

    if (!this.config.enabled || query.length < 2) {
      const emptyResult = createEmptySearchResultShape(query);
      this.recordSearchTrace({
        query,
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
      const emptyResult = createEmptySearchResultShape(query);
      this.recordSearchTrace({
        query,
        limit,
        sourceFilter: [],
        requiredSources: [],
        fromCache: false,
        result: emptyResult,
      });
      return emptyResult;
    }

    const cacheKey = buildCacheKey({
      query,
      limit,
      allowedSourceIds: sourceScope.allowedSourceIds,
      requiredSourceIds: sourceScope.requiredSourceIds,
    });
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.runtimeCounters.cacheHits += 1;
      this.recordSearchTrace({
        query,
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
        query,
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
        query,
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
        query,
        Math.max(limit, 8),
        sourceScope.allowedSourceIds,
      );
      addCandidates(fallback);
    }

    const selected = selectEvidenceWithRealtimePriority({
      candidates,
      requiredSourceIds: sourceScope.requiredSourceIds,
      limit,
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
      query,
      results: selected,
      droppedByPolicy,
      usedSources,
      sourceBreakdown: buildSourceBreakdown(selected),
      strategyVersion: SEARCH_STRATEGY_VERSION,
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
      query,
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
