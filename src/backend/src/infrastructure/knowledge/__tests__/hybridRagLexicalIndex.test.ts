import { createBm25HybridRagLexicalIndex } from '../hybrid-lexical/Bm25HybridRagLexicalIndex';

describe('BM25 hybrid lexical index adapter', () => {
  it('retrieves clinically relevant documents by lexical score', () => {
    const index = createBm25HybridRagLexicalIndex();
    index.upsert([
      {
        id: 'doc-htn',
        text:
          'Hypertension guideline recommends blood pressure follow-up and sodium reduction.',
        metadata: {
          sourceId: 'WHO',
          domain: 'hypertension',
        },
      },
      {
        id: 'doc-diabetes',
        text: 'Diabetes management targets HbA1c and glucose monitoring.',
        metadata: {
          sourceId: 'NICE',
          domain: 'diabetes',
        },
      },
      {
        id: 'doc-stroke',
        text: 'Stroke warning signs should trigger emergency triage workflow.',
        metadata: {
          sourceId: 'CDC_US',
          domain: 'stroke',
        },
      },
    ]);

    const matches = index.search({
      query: 'blood pressure follow-up guideline',
      topK: 2,
    });

    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]?.id).toBe('doc-htn');
    expect(matches[0]?.score).toBeGreaterThan(0);
    expect(matches[0]?.matchedTerms.length).toBeGreaterThan(0);
  });

  it('supports metadata filter and index lifecycle operations', () => {
    const index = createBm25HybridRagLexicalIndex();
    index.upsert([
      {
        id: 'who-1',
        text: 'Hypertension blood pressure management.',
        metadata: { sourceId: 'WHO', language: 'en' },
      },
      {
        id: 'nice-1',
        text: 'Hypertension clinic follow-up recommendations.',
        metadata: { sourceId: 'NICE', language: 'en' },
      },
    ]);

    const filtered = index.search({
      query: 'hypertension follow-up',
      topK: 5,
      filter: {
        sourceId: 'NICE',
      },
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('nice-1');

    const removed = index.remove(['nice-1']);
    expect(removed).toBe(1);

    const afterRemove = index.search({
      query: 'hypertension follow-up',
      topK: 5,
      filter: {
        sourceId: 'NICE',
      },
    });
    expect(afterRemove).toEqual([]);
    expect(index.stats().documentCount).toBe(1);
  });

  it('handles cjk tokenization and empty query boundary', () => {
    const index = createBm25HybridRagLexicalIndex();
    index.upsert([
      {
        id: 'cn-1',
        text: '高血压 患者 需要 规律 血压 监测 与 随访',
        metadata: { sourceId: 'NHC_CN' },
      },
      {
        id: 'en-1',
        text: 'hypertension monitoring and follow-up',
        metadata: { sourceId: 'WHO' },
      },
    ]);

    const cnMatches = index.search({
      query: '高血压 监测',
      topK: 1,
    });
    expect(cnMatches).toHaveLength(1);
    expect(cnMatches[0]?.id).toBe('cn-1');

    const empty = index.search({
      query: '   ',
      topK: 3,
    });
    expect(empty).toEqual([]);
  });
});
