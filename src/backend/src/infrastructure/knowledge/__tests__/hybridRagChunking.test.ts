import { createHybridRagIngestionAdapter } from '../hybrid-indexing/HybridRagIngestionAdapter';
import { HybridRagChunk } from '../hybrid-indexing/types';

function assertChunkOrdering(chunks: HybridRagChunk[]): void {
  const grouped = new Map<string, HybridRagChunk[]>();
  for (const chunk of chunks) {
    const key = `${chunk.metadata.sourceId}|${chunk.metadata.url}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(chunk);
    grouped.set(key, bucket);
  }

  for (const bucket of grouped.values()) {
    const totalChunks = bucket[0]?.metadata.totalChunks ?? 0;
    expect(totalChunks).toBe(bucket.length);
    for (let index = 0; index < bucket.length; index += 1) {
      expect(bucket[index]?.metadata.chunkIndex).toBe(index + 1);
      expect(bucket[index]?.metadata.totalChunks).toBe(totalChunks);
    }
  }
}

describe('hybrid RAG chunking policy and metadata standard', () => {
  it('emits sequential chunks with normalized metadata', () => {
    const adapter = createHybridRagIngestionAdapter({
      chunkCharSize: 140,
      chunkCharOverlap: 30,
      minChunkChars: 50,
    });

    const content = [
      'Hypertension care pathway starts with standardized blood pressure measurement.',
      'Population screening and follow-up scheduling improve long-term control.',
      'Stroke warning sign should trigger emergency escalation and same-day triage.',
      'Lifestyle guidance includes sodium reduction and regular physical activity.',
    ].join(' ');

    const result = adapter.ingest([
      {
        sourceId: 'WHO',
        sourceName: 'World Health Organization',
        url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
        title: 'WHO hypertension fact sheet',
        content,
        tags: ['Cardio', 'cardio', 'Screening'],
        fetchedAt: '2026-03-15T00:00:00.000Z',
      },
    ]);

    expect(result.chunkCount).toBeGreaterThan(2);
    assertChunkOrdering(result.chunks);

    const firstChunk = result.chunks[0];
    expect(firstChunk?.metadata.tags).toEqual(['cardio', 'screening']);
    expect(firstChunk?.metadata.clinicalDomains).toContain('hypertension');

    const riskHitChunk = result.chunks.find((item) =>
      item.metadata.riskTags.includes('red_flag'),
    );
    expect(riskHitChunk).toBeDefined();
    expect(riskHitChunk?.metadata.riskTags).toEqual(
      expect.arrayContaining(['neuro_acute', 'red_flag']),
    );
  });

  it('keeps one chunk for short text and preserves chunk metadata cardinality', () => {
    const adapter = createHybridRagIngestionAdapter({
      chunkCharSize: 500,
      chunkCharOverlap: 80,
      minChunkChars: 300,
    });

    const result = adapter.ingest([
      {
        sourceId: 'NICE',
        sourceName: 'NICE',
        url: 'https://www.nice.org.uk/guidance/ng136/chapter/Recommendations',
        title: 'NICE guideline',
        content: 'Short follow-up recommendation for stable hypertension patients.',
        tags: ['Guideline'],
        fetchedAt: '2026-03-15T00:00:00.000Z',
      },
    ]);

    expect(result.chunkCount).toBe(1);
    expect(result.chunks[0]?.metadata.chunkIndex).toBe(1);
    expect(result.chunks[0]?.metadata.totalChunks).toBe(1);
    expect(result.chunks[0]?.metadata.tags).toEqual(['guideline']);
  });

  it('drops invalid records and only chunks normalized authoritative documents', () => {
    const adapter = createHybridRagIngestionAdapter({
      chunkCharSize: 120,
      chunkCharOverlap: 20,
      minChunkChars: 40,
    });

    const result = adapter.ingest([
      {
        sourceId: '',
        sourceName: 'Invalid Source',
        url: 'https://example.com/invalid',
        title: 'invalid',
        content: 'should be dropped',
      },
      {
        sourceId: 'CDC_US',
        sourceName: 'US CDC',
        url: 'https://www.cdc.gov/high-blood-pressure/about/index.html#overview',
        title: 'CDC hypertension basics',
        content:
          'High blood pressure is often silent. Regular blood pressure monitoring is recommended for adults.',
        fetchedAt: '2026-03-15T00:00:00.000Z',
      },
    ]);

    expect(result.documentCount).toBe(2);
    expect(result.normalizedDocumentCount).toBe(1);
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.normalizedDocuments[0]?.url).toBe(
      'https://www.cdc.gov/high-blood-pressure/about/index.html',
    );
  });
});

