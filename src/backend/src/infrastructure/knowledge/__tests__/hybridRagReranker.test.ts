import { rerankHybridCandidates } from '../medical-search/hybridReranker';

describe('hybrid reranker (RRF + semantic rerank)', () => {
  it('prioritizes candidates recalled by multiple channels via RRF fusion', () => {
    const reranked = rerankHybridCandidates(
      [
        {
          id: 'doc-a',
          sourceId: 'WHO',
          url: 'https://www.who.int/hypertension',
          title: 'WHO hypertension guideline',
          snippet: 'blood pressure follow-up',
          channelRanks: {
            vector: 1,
            lexical: 1,
            online: 2,
          },
          semanticScore: 0.6,
        },
        {
          id: 'doc-b',
          sourceId: 'WHO',
          url: 'https://www.who.int/other',
          title: 'WHO general report',
          snippet: 'general health report',
          channelRanks: {
            online: 1,
          },
          semanticScore: 0.7,
        },
      ],
      {
        query: 'hypertension blood pressure guideline',
        topK: 2,
      },
    );

    expect(reranked[0]?.id).toBe('doc-a');
    expect(reranked[0]?.rrfScore).toBeGreaterThan(reranked[1]?.rrfScore ?? 0);
  });

  it('allows semantic reranking to lift conceptually stronger evidence', () => {
    const reranked = rerankHybridCandidates(
      [
        {
          id: 'doc-low-sem',
          sourceId: 'NICE',
          url: 'https://www.nice.org.uk/guidance/ng136',
          title: 'NICE NG136',
          snippet: 'short policy text',
          channelRanks: {
            vector: 1,
            lexical: 2,
          },
          semanticScore: 0.2,
        },
        {
          id: 'doc-high-sem',
          sourceId: 'NICE',
          url: 'https://www.nice.org.uk/guidance/ng136/chapter/Recommendations',
          title: 'Hypertension blood pressure threshold and follow-up guidance',
          snippet: 'detailed clinical recommendation',
          channelRanks: {
            vector: 3,
            lexical: 4,
          },
          semanticScore: 0.95,
        },
      ],
      {
        query: 'hypertension blood pressure follow-up threshold',
        topK: 2,
        semanticWeight: 0.9,
      },
    );

    expect(reranked[0]?.id).toBe('doc-high-sem');
    expect(reranked[0]?.semanticScoreNormalized).toBeGreaterThan(
      reranked[1]?.semanticScoreNormalized ?? 0,
    );
  });

  it('demotes cross-topic evidence when disease focus mismatches query intent', () => {
    const reranked = rerankHybridCandidates(
      [
        {
          id: 'doc-diabetes',
          sourceId: 'WHO',
          url: 'https://www.who.int/diabetes',
          title: 'Diabetes glucose diagnostic thresholds',
          snippet: 'glucose threshold and follow-up interval for adults',
          channelRanks: {
            vector: 2,
            lexical: 2,
            online: 2,
          },
          semanticScore: 0.66,
        },
        {
          id: 'doc-stroke',
          sourceId: 'CDC_US',
          url: 'https://www.cdc.gov/stroke/signs-symptoms/index.html',
          title: 'Stroke warning signs emergency triage',
          snippet: 'FAST emergency referral pathway for stroke',
          channelRanks: {
            vector: 1,
            lexical: 1,
            online: 1,
          },
          semanticScore: 0.67,
          redFlagMatched: true,
        },
      ],
      {
        query: 'diabetes glucose threshold follow-up',
        queryVariants: [
          '糖尿病 血糖 阈值 随访 指南',
        ],
        topK: 2,
      },
    );

    expect(reranked[0]?.id).toBe('doc-diabetes');
    expect((reranked[0]?.topicMismatchScore ?? 0)).toBeLessThanOrEqual(
      reranked[1]?.topicMismatchScore ?? 1,
    );
  });

  it('adds red-flag and freshness-aware boost for urgent evidence', () => {
    const reranked = rerankHybridCandidates(
      [
        {
          id: 'doc-stable',
          sourceId: 'WHO',
          url: 'https://www.who.int/hypertension/stable',
          title: 'Stable hypertension follow-up',
          snippet: 'routine outpatient recommendation',
          channelRanks: {
            online: 1,
          },
          semanticScore: 0.7,
          publishedOn: '2018-01-01T00:00:00.000Z',
          redFlagMatched: false,
        },
        {
          id: 'doc-urgent',
          sourceId: 'CDC_US',
          url: 'https://www.cdc.gov/stroke/signs-symptoms/index.html',
          title: 'Stroke warning signs emergency triage',
          snippet: 'urgent FAST pathway and immediate escalation',
          channelRanks: {
            lexical: 2,
            online: 2,
          },
          semanticScore: 0.9,
          publishedOn: '2025-12-01T00:00:00.000Z',
          redFlagMatched: true,
        },
      ],
      {
        query: 'stroke warning signs emergency',
        topK: 2,
        redFlagBoost: 0.2,
      },
    );

    expect(reranked[0]?.id).toBe('doc-urgent');
    expect(reranked[0]?.redFlagScore).toBeGreaterThan(0);
    expect(reranked[0]?.freshnessScore).toBeGreaterThan(
      reranked[1]?.freshnessScore ?? 0,
    );
  });
});
