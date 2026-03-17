import {
  AuthoritativeMedicalEvidence,
  AuthoritativeMedicalSearchResult,
} from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';

export type HybridRetrieverChannel = 'vector' | 'lexical' | 'online';

export interface HybridRetrieverHit extends AuthoritativeMedicalEvidence {
  score: number;
}

export interface HybridRetrieverChannelProvider {
  retrieve(input: HybridRetrieverRequest): Promise<HybridRetrieverHit[]>;
}

export interface HybridRetrieverRequest {
  query: string;
  topK: number;
  sourceFilter?: string[];
  requiredSources?: string[];
}

export interface HybridRetrieverCandidate extends AuthoritativeMedicalEvidence {
  channels: HybridRetrieverChannel[];
  channelScores: Partial<Record<HybridRetrieverChannel, number>>;
  score: number;
}

export interface HybridRetrieverResponse {
  query: string;
  topK: number;
  candidates: HybridRetrieverCandidate[];
  missingRequiredSources: string[];
  diagnostics: {
    vectorCount: number;
    lexicalCount: number;
    onlineCount: number;
    channelFailures: string[];
  };
}

export interface HybridRetrieverDependencies {
  vectorProvider?: HybridRetrieverChannelProvider;
  lexicalProvider?: HybridRetrieverChannelProvider;
  onlineProvider?: HybridRetrieverChannelProvider;
}

const CHANNEL_WEIGHT: Record<HybridRetrieverChannel, number> = {
  vector: 1,
  lexical: 0.9,
  online: 1.1,
};

function canonicalKey(item: AuthoritativeMedicalEvidence): string {
  return `${item.sourceId.toLowerCase()}|${item.url.trim().toLowerCase()}`;
}

function applySourceFilter(
  hits: HybridRetrieverHit[],
  sourceFilter: string[] | undefined,
): HybridRetrieverHit[] {
  if (!sourceFilter || sourceFilter.length === 0) {
    return hits;
  }
  const allowed = new Set(sourceFilter.map((item) => item.toLowerCase()));
  return hits.filter((item) => allowed.has(item.sourceId.toLowerCase()));
}

function dedupeSort(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeScore(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  if (raw <= 0) {
    return 0;
  }
  if (raw <= 1) {
    return raw;
  }
  return Number((1 - 1 / (raw + 1)).toFixed(6));
}

async function collectChannelHits(
  provider: HybridRetrieverChannelProvider | undefined,
  channel: HybridRetrieverChannel,
  request: HybridRetrieverRequest,
  failures: string[],
): Promise<HybridRetrieverHit[]> {
  if (!provider) {
    return [];
  }
  try {
    return await provider.retrieve(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `unknown ${channel} error`;
    failures.push(`${channel}:${message}`);
    return [];
  }
}

class OnlineSearchResultProvider implements HybridRetrieverChannelProvider {
  private readonly searchResult: AuthoritativeMedicalSearchResult;

  public constructor(searchResult: AuthoritativeMedicalSearchResult) {
    this.searchResult = searchResult;
  }

  public async retrieve(): Promise<HybridRetrieverHit[]> {
    return this.searchResult.results.map((item, index) => ({
      ...item,
      score: Number((1 - index / Math.max(1, this.searchResult.results.length)).toFixed(6)),
    }));
  }
}

export class HybridRagRetriever {
  private readonly vectorProvider?: HybridRetrieverChannelProvider;

  private readonly lexicalProvider?: HybridRetrieverChannelProvider;

  private readonly onlineProvider?: HybridRetrieverChannelProvider;

  public constructor(dependencies: HybridRetrieverDependencies = {}) {
    this.vectorProvider = dependencies.vectorProvider;
    this.lexicalProvider = dependencies.lexicalProvider;
    this.onlineProvider = dependencies.onlineProvider;
  }

  public static fromOnlineSearchResult(
    result: AuthoritativeMedicalSearchResult,
  ): HybridRagRetriever {
    return new HybridRagRetriever({
      onlineProvider: new OnlineSearchResultProvider(result),
    });
  }

  public async retrieve(
    request: HybridRetrieverRequest,
  ): Promise<HybridRetrieverResponse> {
    const channelFailures: string[] = [];
    const [vectorHitsRaw, lexicalHitsRaw, onlineHitsRaw] = await Promise.all([
      collectChannelHits(this.vectorProvider, 'vector', request, channelFailures),
      collectChannelHits(this.lexicalProvider, 'lexical', request, channelFailures),
      collectChannelHits(this.onlineProvider, 'online', request, channelFailures),
    ]);

    const vectorHits = applySourceFilter(vectorHitsRaw, request.sourceFilter);
    const lexicalHits = applySourceFilter(lexicalHitsRaw, request.sourceFilter);
    const onlineHits = applySourceFilter(onlineHitsRaw, request.sourceFilter);

    const merged = new Map<string, HybridRetrieverCandidate>();
    const ingestHits = (
      channel: HybridRetrieverChannel,
      hits: HybridRetrieverHit[],
    ): void => {
      for (const hit of hits) {
        const key = canonicalKey(hit);
        const existing = merged.get(key);
        const weightedScore =
          normalizeScore(hit.score) * (CHANNEL_WEIGHT[channel] ?? 1);
        if (!existing) {
          merged.set(key, {
            sourceId: hit.sourceId,
            sourceName: hit.sourceName,
            title: hit.title,
            url: hit.url,
            snippet: hit.snippet,
            publishedOn: hit.publishedOn,
            retrievedAt: hit.retrievedAt,
            origin: hit.origin,
            matchedQueryTokens: hit.matchedQueryTokens,
            channels: [channel],
            channelScores: {
              [channel]: weightedScore,
            },
            score: weightedScore,
          });
          continue;
        }
        if (!existing.channels.includes(channel)) {
          existing.channels.push(channel);
        }
        const previousChannelScore = existing.channelScores[channel] ?? 0;
        existing.channelScores[channel] = Math.max(previousChannelScore, weightedScore);
        existing.score = Number((existing.score + weightedScore).toFixed(6));
        if ((hit.publishedOn ?? '').length > (existing.publishedOn ?? '').length) {
          existing.publishedOn = hit.publishedOn;
        }
        if (hit.snippet.length > existing.snippet.length) {
          existing.snippet = hit.snippet;
        }
      }
    };

    ingestHits('vector', vectorHits);
    ingestHits('lexical', lexicalHits);
    ingestHits('online', onlineHits);

    const candidates = [...merged.values()]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.url.localeCompare(right.url);
      })
      .slice(0, Math.max(1, request.topK));

    const requiredSources = dedupeSort(request.requiredSources ?? []);
    const usedSources = new Set(candidates.map((item) => item.sourceId));
    const missingRequiredSources = requiredSources.filter(
      (sourceId) => !usedSources.has(sourceId),
    );

    return {
      query: request.query,
      topK: request.topK,
      candidates,
      missingRequiredSources,
      diagnostics: {
        vectorCount: vectorHits.length,
        lexicalCount: lexicalHits.length,
        onlineCount: onlineHits.length,
        channelFailures,
      },
    };
  }
}

