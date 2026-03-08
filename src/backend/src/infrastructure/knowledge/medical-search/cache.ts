import { AuthoritativeMedicalSearchResult } from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import { SearchCacheEntry } from './types';

class MedicalSearchResultCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly store: Map<string, SearchCacheEntry>;

  constructor(ttlMs: number, maxEntries: number) {
    this.ttlMs = Math.max(0, Math.floor(ttlMs));
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.store = new Map<string, SearchCacheEntry>();
  }

  public get(key: string): AuthoritativeMedicalSearchResult | null {
    if (this.ttlMs <= 0) {
      return null;
    }
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    entry.touchedAt = Date.now();
    return this.cloneResult(entry.value);
  }

  public set(key: string, value: AuthoritativeMedicalSearchResult): void {
    if (this.ttlMs <= 0) {
      return;
    }
    this.pruneExpired();
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      this.evictLeastRecentlyUsed();
    }
    this.store.set(key, {
      value: this.cloneResult(value),
      expiresAt: Date.now() + this.ttlMs,
      touchedAt: Date.now(),
    });
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  private evictLeastRecentlyUsed(): void {
    let candidateKey: string | null = null;
    let candidateTouchedAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.store.entries()) {
      if (entry.touchedAt < candidateTouchedAt) {
        candidateTouchedAt = entry.touchedAt;
        candidateKey = key;
      }
    }
    if (candidateKey) {
      this.store.delete(candidateKey);
    }
  }

  private cloneResult(
    value: AuthoritativeMedicalSearchResult,
  ): AuthoritativeMedicalSearchResult {
    return {
      query: value.query,
      results: value.results.map((item) => ({
        ...item,
        matchedQueryTokens: item.matchedQueryTokens
          ? [...item.matchedQueryTokens]
          : undefined,
      })),
      droppedByPolicy: value.droppedByPolicy,
      usedSources: [...value.usedSources],
      sourceBreakdown: value.sourceBreakdown.map((item) => ({ ...item })),
      strategyVersion: value.strategyVersion,
      generatedAt: value.generatedAt,
      realtimeCount: value.realtimeCount,
      fallbackCount: value.fallbackCount,
      fallbackReasons: value.fallbackReasons
        ? [...value.fallbackReasons]
        : undefined,
      missingRequiredSources: value.missingRequiredSources
        ? [...value.missingRequiredSources]
        : undefined,
    };
  }
}

export { MedicalSearchResultCache };
