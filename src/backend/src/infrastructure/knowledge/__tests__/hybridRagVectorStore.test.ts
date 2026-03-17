import { createDeterministicHybridRagEmbeddingService } from '../hybrid-vector/DeterministicHybridRagEmbeddingService';
import {
  createInMemoryHybridRagVectorStore,
  InMemoryHybridRagVectorStoreError,
} from '../hybrid-vector/InMemoryHybridRagVectorStore';

describe('Hybrid RAG vector store adapter', () => {
  it('supports embedding-driven upsert and similarity query with metadata filtering', async () => {
    const embedding = createDeterministicHybridRagEmbeddingService(64);
    const vectorStore = createInMemoryHybridRagVectorStore();
    const namespace = 'authoritative-guidelines';

    const documents = [
      {
        id: 'doc-hyper',
        text: 'Hypertension guideline requires blood pressure follow-up and sodium reduction.',
        metadata: {
          sourceId: 'WHO',
          domain: 'hypertension',
        },
      },
      {
        id: 'doc-diabetes',
        text: 'Diabetes guideline tracks HbA1c and glucose control with periodic review.',
        metadata: {
          sourceId: 'NICE',
          domain: 'diabetes',
        },
      },
      {
        id: 'doc-stroke',
        text: 'Stroke warning signs require emergency triage and immediate FAST assessment.',
        metadata: {
          sourceId: 'CDC_US',
          domain: 'stroke',
        },
      },
    ];

    const embeddedDocs = await embedding.embed({
      texts: documents.map((item) => item.text),
      dimensions: 64,
    });
    await vectorStore.upsert(
      namespace,
      documents.map((item, index) => ({
        id: item.id,
        text: item.text,
        metadata: item.metadata,
        vector: embeddedDocs.vectors[index] ?? [],
      })),
    );

    const queryEmbedding = await embedding.embed({
      texts: ['high blood pressure follow-up recommendation'],
      dimensions: 64,
    });

    const matches = await vectorStore.query(namespace, {
      vector: queryEmbedding.vectors[0] ?? [],
      topK: 2,
      filter: {
        metadata: {
          domain: 'hypertension',
        },
      },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('doc-hyper');
    expect(matches[0]?.score).toBeGreaterThan(0);
    expect(matches[0]?.metadata.sourceId).toBe('WHO');
  });

  it('throws typed dimension errors for mismatched vectors', async () => {
    const vectorStore = createInMemoryHybridRagVectorStore();
    await vectorStore.upsert('ns-a', [
      {
        id: 'doc-1',
        text: 'vector baseline',
        metadata: {},
        vector: [0.1, 0.2, 0.3],
      },
    ]);

    await expect(
      vectorStore.upsert('ns-a', [
        {
          id: 'doc-2',
          text: 'bad dimension',
          metadata: {},
          vector: [0.1, 0.2],
        },
      ]),
    ).rejects.toBeInstanceOf(InMemoryHybridRagVectorStoreError);
    await expect(
      vectorStore.query('ns-a', {
        vector: [0.4, 0.5],
        topK: 3,
      }),
    ).rejects.toBeInstanceOf(InMemoryHybridRagVectorStoreError);
  });

  it('supports delete and namespace stats for lifecycle management', async () => {
    const vectorStore = createInMemoryHybridRagVectorStore();
    const namespace = 'ns-life';
    await vectorStore.upsert(namespace, [
      {
        id: 'doc-1',
        text: 'first',
        metadata: { sourceId: 'WHO' },
        vector: [1, 0, 0, 0],
      },
      {
        id: 'doc-2',
        text: 'second',
        metadata: { sourceId: 'CDC_US' },
        vector: [0, 1, 0, 0],
      },
    ]);

    const initialStats = await vectorStore.stats(namespace);
    expect(initialStats.dimension).toBe(4);
    expect(initialStats.recordCount).toBe(2);

    const removed = await vectorStore.delete(namespace, ['doc-2', 'missing']);
    expect(removed).toBe(1);

    const finalStats = await vectorStore.stats(namespace);
    expect(finalStats.recordCount).toBe(1);
  });
});

