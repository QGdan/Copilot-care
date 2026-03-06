import { AuthoritativeMedicalSearchPort } from '../../../application/ports/AuthoritativeMedicalSearchPort';
import {
  AUTHORITATIVE_MEDICAL_SOURCES,
  AuthoritativeMedicalSearchRuntimeStats,
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
      return createEmptySearchResultShape(query);
    }

    const sourceScope = resolveSearchSourceScope(this.getSources(), input);
    if (sourceScope.allowedSources.length === 0) {
      return createEmptySearchResultShape(query);
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
    const hasNonPubMedCandidate = candidates.some(
      (item) => item.sourceId !== PUBMED_SOURCE_ID,
    );
    if (
      candidates.length === 0 ||
      (allowsNonPubMedSource && !hasNonPubMedCandidate) ||
      (this.config.allowPartialSeedFill && candidates.length < limit)
    ) {
      this.runtimeCounters.fallbackAppliedCount += 1;
      const fallback = buildLocalFallbackEvidence(
        query,
        Math.max(limit, 8),
        sourceScope.allowedSourceIds,
      );
      addCandidates(fallback);
    }

    const selected = enforceRequiredSourceCoverage(
      selectDiverseEvidence(candidates, limit),
      candidates,
      sourceScope.requiredSourceIds,
      limit,
    );
    const usedSources = [...new Set(selected.map((item) => item.sourceId))];
    const realtimeCount = selected.filter(
      (item) => item.origin !== 'catalog_seed',
    ).length;
    const fallbackCount = selected.length - realtimeCount;

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
    };
    this.cache.set(cacheKey, result);

    return result;
  }
}

export function createAuthoritativeMedicalSearchService(
  env: NodeJS.ProcessEnv = process.env,
): AuthoritativeMedicalSearchPort {
  return new AuthoritativeMedicalWebSearchService(createSearchRuntimeConfig(env));
}
