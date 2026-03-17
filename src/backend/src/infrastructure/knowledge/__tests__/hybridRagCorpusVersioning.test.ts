import { createHybridRagCorpusVersioningService } from '../hybrid-indexing/HybridRagCorpusVersioningService';
import { createHybridRagIngestionAdapter } from '../hybrid-indexing/HybridRagIngestionAdapter';
import { HybridRagIngestionResult } from '../hybrid-indexing/types';

describe('HybridRagCorpusVersioningService', () => {
  it('builds stable snapshots for the same corpus payload', () => {
    const ingestionAdapter = createHybridRagIngestionAdapter({
      chunkCharSize: 180,
      chunkCharOverlap: 30,
      minChunkChars: 60,
    });
    const versioning = createHybridRagCorpusVersioningService();

    const ingestion = ingestionAdapter.ingest([
      {
        sourceId: 'WHO',
        sourceName: 'World Health Organization',
        url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
        title: 'WHO hypertension facts',
        content:
          'Hypertension control requires long-term blood pressure follow-up and cardiovascular prevention.',
        fetchedAt: '2026-03-15T00:00:00.000Z',
      },
    ]);

    const snapshotA = versioning.buildSnapshot({
      ingestion,
      generatedAt: '2026-03-15T10:00:00.000Z',
    });
    const snapshotB = versioning.buildSnapshot({
      ingestion,
      generatedAt: '2026-03-15T10:00:00.000Z',
    });

    expect(snapshotA.fingerprint).toBe(snapshotB.fingerprint);
    expect(snapshotA.versionId).toBe(snapshotB.versionId);
    expect(snapshotA.sourceBreakdown).toEqual([{ sourceId: 'WHO', count: 1 }]);

    const diff = versioning.diffSnapshots(snapshotA, snapshotB);
    expect(diff.changed).toBe(false);
    expect(diff.reasons).toEqual([]);
  });

  it('identifies corpus changes and emits structured diff reasons', () => {
    const ingestionAdapter = createHybridRagIngestionAdapter({
      chunkCharSize: 120,
      chunkCharOverlap: 20,
      minChunkChars: 40,
    });
    const versioning = createHybridRagCorpusVersioningService();

    const baselineIngestion = ingestionAdapter.ingest([
      {
        sourceId: 'WHO',
        sourceName: 'World Health Organization',
        url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
        title: 'WHO hypertension facts',
        content:
          'Hypertension management should include regular monitoring and sodium reduction.',
        fetchedAt: '2026-03-15T00:00:00.000Z',
      },
    ]);

    const candidateIngestion = ingestionAdapter.ingest([
      {
        sourceId: 'WHO',
        sourceName: 'World Health Organization',
        url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
        title: 'WHO hypertension facts',
        content:
          'Hypertension management should include regular monitoring, sodium reduction, and annual risk reassessment for cardiovascular disease.',
        fetchedAt: '2026-03-16T00:00:00.000Z',
      },
      {
        sourceId: 'CDC_US',
        sourceName: 'US CDC',
        url: 'https://www.cdc.gov/high-blood-pressure/about/index.html',
        title: 'CDC blood pressure basics',
        content:
          'Public health screening and adherence support can improve blood pressure control outcomes.',
        fetchedAt: '2026-03-16T00:00:00.000Z',
      },
    ]);

    const baselineSnapshot = versioning.buildSnapshot({
      ingestion: baselineIngestion,
      generatedAt: '2026-03-15T10:00:00.000Z',
    });
    const candidateSnapshot = versioning.buildSnapshot({
      ingestion: candidateIngestion,
      generatedAt: '2026-03-16T10:00:00.000Z',
    });

    const diff = versioning.diffSnapshots(baselineSnapshot, candidateSnapshot);
    expect(diff.changed).toBe(true);
    expect(diff.reasons).toEqual(
      expect.arrayContaining([
        'fingerprint_changed',
        'document_count_changed',
        'chunk_count_changed',
        'source_breakdown_changed',
      ]),
    );
  });

  it('infers document count from chunk metadata when normalized documents are absent', () => {
    const versioning = createHybridRagCorpusVersioningService();
    const ingestion: HybridRagIngestionResult = {
      documentCount: 2,
      normalizedDocumentCount: 0,
      chunkCount: 2,
      normalizedDocuments: [],
      chunks: [
        {
          chunkId: 'chunk-1',
          text: 'hypertension evidence part one',
          tokenEstimate: 7,
          metadata: {
            sourceId: 'WHO',
            sourceName: 'World Health Organization',
            url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
            title: 'WHO hypertension facts',
            tags: [],
            riskTags: [],
            clinicalDomains: ['hypertension'],
            chunkIndex: 1,
            totalChunks: 2,
          },
        },
        {
          chunkId: 'chunk-2',
          text: 'hypertension evidence part two',
          tokenEstimate: 7,
          metadata: {
            sourceId: 'WHO',
            sourceName: 'World Health Organization',
            url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
            title: 'WHO hypertension facts',
            tags: [],
            riskTags: [],
            clinicalDomains: ['hypertension'],
            chunkIndex: 2,
            totalChunks: 2,
          },
        },
      ],
    };

    const snapshot = versioning.buildSnapshot({
      ingestion,
      generatedAt: '2026-03-15T10:00:00.000Z',
    });

    expect(snapshot.documentCount).toBe(1);
    expect(snapshot.chunkCount).toBe(2);
    expect(snapshot.sourceBreakdown).toEqual([{ sourceId: 'WHO', count: 2 }]);
  });
});

