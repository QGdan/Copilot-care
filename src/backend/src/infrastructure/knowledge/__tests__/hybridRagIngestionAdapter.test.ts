import { createHybridRagIngestionAdapter } from '../hybrid-indexing/HybridRagIngestionAdapter';
import { HybridRagRawDocument } from '../hybrid-indexing/types';

describe('HybridRagIngestionAdapter', () => {
  it('normalizes, deduplicates, chunks, and annotates authoritative documents', () => {
    const adapter = createHybridRagIngestionAdapter({
      chunkCharSize: 150,
      chunkCharOverlap: 40,
      minChunkChars: 60,
    });

    const longHypertensionText = [
      'Hypertension management should combine blood pressure monitoring and risk stratification.',
      'Lifestyle intervention includes sodium reduction, physical activity, and weight control.',
      'Follow-up schedule should align with cardiovascular risk profile and target organ status.',
      'Public health screening can improve early detection in high-risk populations.',
    ].join(' ');

    const documents: HybridRagRawDocument[] = [
      {
        sourceId: 'WHO',
        sourceName: 'World Health Organization',
        url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension?b=2&a=1#top',
        title: 'WHO hypertension fact sheet',
        content: longHypertensionText,
        tags: ['Hypertension', 'Guideline'],
        fetchedAt: '2026-03-14T00:00:00.000Z',
      },
      {
        sourceId: 'WHO',
        sourceName: 'World Health Organization',
        url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension?a=1&b=2',
        title: 'WHO hypertension fact sheet',
        content: `${longHypertensionText} Updated summary line for annual review.`,
        tags: ['guideline'],
        fetchedAt: '2026-03-15T00:00:00.000Z',
      },
      {
        sourceId: 'CDC_US',
        sourceName: 'US CDC',
        url: 'https://www.cdc.gov/stroke/signs-symptoms/index.html',
        title: 'Stroke warning signs',
        content:
          'Stroke warning sign should trigger emergency triage and same-day escalation using FAST protocol.',
        tags: ['Emergency', 'Stroke'],
        fetchedAt: '2026-03-13T00:00:00.000Z',
      },
      {
        sourceId: 'NICE',
        sourceName: 'NICE',
        url: 'https://www.nice.org.uk/guidance/ng136',
        title: 'NG136',
        content: '   ',
        fetchedAt: '2026-03-13T00:00:00.000Z',
      },
    ];

    const firstRun = adapter.ingest(documents);
    const secondRun = adapter.ingest(documents);

    expect(firstRun.documentCount).toBe(4);
    expect(firstRun.normalizedDocumentCount).toBe(2);
    expect(firstRun.chunkCount).toBeGreaterThan(2);
    expect(firstRun.chunks.map((item) => item.chunkId)).toEqual(
      secondRun.chunks.map((item) => item.chunkId),
    );

    const whoDocument = firstRun.normalizedDocuments.find(
      (item) => item.sourceId === 'WHO',
    );
    expect(whoDocument).toBeDefined();
    expect(whoDocument?.url).toBe(
      'https://www.who.int/news-room/fact-sheets/detail/hypertension?a=1&b=2',
    );
    expect(whoDocument?.tags).toEqual(['guideline']);

    const whoChunk = firstRun.chunks.find((item) => item.metadata.sourceId === 'WHO');
    expect(whoChunk).toBeDefined();
    expect(whoChunk?.metadata.clinicalDomains).toContain('hypertension');

    const cdcChunk = firstRun.chunks.find(
      (item) => item.metadata.sourceId === 'CDC_US',
    );
    expect(cdcChunk?.metadata.riskTags).toEqual(
      expect.arrayContaining(['neuro_acute', 'red_flag']),
    );
  });

  it('returns empty ingestion result for empty input', () => {
    const adapter = createHybridRagIngestionAdapter();
    const result = adapter.ingest([]);

    expect(result.documentCount).toBe(0);
    expect(result.normalizedDocumentCount).toBe(0);
    expect(result.chunkCount).toBe(0);
    expect(result.normalizedDocuments).toEqual([]);
    expect(result.chunks).toEqual([]);
  });

  it('sanitizes invalid chunking options and still emits valid chunks', () => {
    const adapter = createHybridRagIngestionAdapter({
      chunkCharSize: -1,
      chunkCharOverlap: 9999,
      minChunkChars: 0,
    });

    const content = new Array(30).fill('hypertension follow-up and blood pressure control.').join(' ');
    const result = adapter.ingest([
      {
        sourceId: 'NHC_CN',
        sourceName: 'National Health Commission of China',
        url: 'http://www.nhc.gov.cn/yzygj/s7659/new_list.shtml',
        title: 'Guideline updates',
        content,
        fetchedAt: '2026-03-12T00:00:00.000Z',
      },
    ]);

    expect(result.normalizedDocumentCount).toBe(1);
    expect(result.chunkCount).toBeGreaterThan(1);
    expect(result.chunks.every((item) => item.text.trim().length > 0)).toBe(true);
    expect(result.chunks.every((item) => item.tokenEstimate >= 1)).toBe(true);
  });
});

