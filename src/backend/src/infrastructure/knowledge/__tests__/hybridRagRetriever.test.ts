import {
  HybridRagRetriever,
  HybridRetrieverChannelProvider,
  HybridRetrieverHit,
} from '../medical-search/hybridRetriever';

function buildHit(input: {
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
}): HybridRetrieverHit {
  return {
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    title: input.title,
    url: input.url,
    snippet: input.snippet,
    retrievedAt: '2026-03-15T00:00:00.000Z',
    score: input.score,
  };
}

class StaticProvider implements HybridRetrieverChannelProvider {
  private readonly hits: HybridRetrieverHit[];

  public constructor(hits: HybridRetrieverHit[]) {
    this.hits = hits;
  }

  public async retrieve(): Promise<HybridRetrieverHit[]> {
    return this.hits;
  }
}

class FailingProvider implements HybridRetrieverChannelProvider {
  private readonly message: string;

  public constructor(message: string) {
    this.message = message;
  }

  public async retrieve(): Promise<HybridRetrieverHit[]> {
    throw new Error(this.message);
  }
}

describe('HybridRagRetriever', () => {
  it('merges vector, lexical and online candidates into one deduplicated pool', async () => {
    const retriever = new HybridRagRetriever({
      vectorProvider: new StaticProvider([
        buildHit({
          sourceId: 'WHO',
          sourceName: 'WHO',
          title: 'WHO hypertension',
          url: 'https://www.who.int/hypertension',
          snippet: 'vector snippet from WHO',
          score: 0.7,
        }),
        buildHit({
          sourceId: 'CDC_US',
          sourceName: 'CDC',
          title: 'CDC blood pressure',
          url: 'https://www.cdc.gov/high-blood-pressure/about/index.html',
          snippet: 'vector snippet from CDC',
          score: 0.5,
        }),
      ]),
      lexicalProvider: new StaticProvider([
        buildHit({
          sourceId: 'WHO',
          sourceName: 'WHO',
          title: 'WHO hypertension',
          url: 'https://www.who.int/hypertension',
          snippet: 'lexical snippet from WHO with longer detail',
          score: 0.8,
        }),
        buildHit({
          sourceId: 'NICE',
          sourceName: 'NICE',
          title: 'NICE NG136',
          url: 'https://www.nice.org.uk/guidance/ng136/chapter/Recommendations',
          snippet: 'lexical snippet from NICE',
          score: 0.4,
        }),
      ]),
      onlineProvider: new StaticProvider([
        buildHit({
          sourceId: 'WHO',
          sourceName: 'WHO',
          title: 'WHO hypertension',
          url: 'https://www.who.int/hypertension',
          snippet: 'online snippet from WHO',
          score: 0.9,
        }),
        buildHit({
          sourceId: 'NICE',
          sourceName: 'NICE',
          title: 'NICE NG136',
          url: 'https://www.nice.org.uk/guidance/ng136/chapter/Recommendations',
          snippet: 'online snippet from NICE',
          score: 0.6,
        }),
      ]),
    });

    const response = await retriever.retrieve({
      query: 'hypertension guideline',
      topK: 5,
      requiredSources: ['WHO', 'NICE'],
    });

    expect(response.candidates).toHaveLength(3);
    expect(response.candidates[0]?.sourceId).toBe('WHO');
    expect(response.candidates[0]?.channels).toEqual(
      expect.arrayContaining(['vector', 'lexical', 'online']),
    );
    expect(response.candidates[0]?.score).toBeGreaterThan(
      response.candidates[1]?.score ?? 0,
    );
    expect(response.missingRequiredSources).toEqual([]);
    expect(response.diagnostics.vectorCount).toBe(2);
    expect(response.diagnostics.lexicalCount).toBe(2);
    expect(response.diagnostics.onlineCount).toBe(2);
  });

  it('applies source filter and reports missing required coverage', async () => {
    const retriever = new HybridRagRetriever({
      vectorProvider: new StaticProvider([
        buildHit({
          sourceId: 'WHO',
          sourceName: 'WHO',
          title: 'WHO hypertension',
          url: 'https://www.who.int/hypertension',
          snippet: 'vector snippet',
          score: 0.9,
        }),
        buildHit({
          sourceId: 'NICE',
          sourceName: 'NICE',
          title: 'NICE NG136',
          url: 'https://www.nice.org.uk/guidance/ng136/chapter/Recommendations',
          snippet: 'vector snippet',
          score: 0.8,
        }),
      ]),
    });

    const response = await retriever.retrieve({
      query: 'hypertension guideline',
      topK: 5,
      sourceFilter: ['WHO'],
      requiredSources: ['WHO', 'NICE'],
    });

    expect(response.candidates).toHaveLength(1);
    expect(response.candidates[0]?.sourceId).toBe('WHO');
    expect(response.missingRequiredSources).toEqual(['NICE']);
  });

  it('degrades gracefully when one recall channel fails', async () => {
    const retriever = new HybridRagRetriever({
      vectorProvider: new FailingProvider('vector backend unavailable'),
      lexicalProvider: new StaticProvider([
        buildHit({
          sourceId: 'WHO',
          sourceName: 'WHO',
          title: 'WHO hypertension',
          url: 'https://www.who.int/hypertension',
          snippet: 'lexical snippet',
          score: 0.7,
        }),
      ]),
    });

    const response = await retriever.retrieve({
      query: 'hypertension',
      topK: 3,
    });

    expect(response.candidates).toHaveLength(1);
    expect(response.diagnostics.channelFailures).toEqual(
      expect.arrayContaining(['vector:vector backend unavailable']),
    );
    expect(response.diagnostics.lexicalCount).toBe(1);
  });
});

