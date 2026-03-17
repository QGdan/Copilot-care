import {
  aggregateRetrievalEvaluations,
  evaluateSingleRetrievalCase,
} from '../medical-search/evaluation';

describe('medical-search evaluation metrics', () => {
  it('computes hit@3 and mrr for matched disease evidence', () => {
    const result = evaluateSingleRetrievalCase({
      results: [
        {
          sourceId: 'WHO',
          sourceName: 'WHO',
          title: 'General health topic',
          url: 'https://www.who.int/health-topics/cardiovascular-diseases',
          snippet:
            '来源：世界卫生组织。证据要点：一般建议。临床解读：一般解读。建议动作：一般动作。',
          retrievedAt: '2026-03-14T00:00:00.000Z',
        },
        {
          sourceId: 'NICE',
          sourceName: 'NICE',
          title: 'Hypertension diagnosis and management',
          url: 'https://www.nice.org.uk/guidance/ng136/chapter/Recommendations',
          snippet:
            '来源：英国临床优化研究所指南机构。证据要点：血压分层管理。临床解读：适用于高血压患者。建议动作：复测血压并随访。',
          retrievedAt: '2026-03-14T00:00:00.000Z',
        },
      ],
      expected: {
        hasHypertension: true,
        hasDiabetes: false,
        hasHeartDisease: false,
        redFlagSuggested: false,
      },
    });

    expect(result.firstRelevantRank).toBe(2);
    expect(result.hitAt3).toBe(true);
    expect(result.mrrAt5).toBe(0.5);
    expect(result.summaryStructuredRate).toBe(1);
  });

  it('returns zeroed relevance metrics for empty retrieval results', () => {
    const result = evaluateSingleRetrievalCase({
      results: [],
      expected: {
        hasHypertension: false,
        hasDiabetes: true,
        hasHeartDisease: false,
        redFlagSuggested: true,
      },
    });

    expect(result.firstRelevantRank).toBeNull();
    expect(result.hitAt3).toBe(false);
    expect(result.mrrAt5).toBe(0);
    expect(result.redFlagHit).toBe(false);
    expect(result.summaryStructuredRate).toBe(0);
  });

  it('handles non-structured summaries and computes aggregate recalls', () => {
    const caseA = evaluateSingleRetrievalCase({
      results: [
        {
          sourceId: 'CDC_US',
          sourceName: 'CDC',
          title: 'Stroke warning signs',
          url: 'https://www.cdc.gov/stroke/signs-symptoms/index.html',
          snippet:
            '来源：美国疾病预防控制中心。证据要点：FAST信号应急诊处理。临床解读：急症风险高。建议动作：立即急诊。',
          retrievedAt: '2026-03-14T00:00:00.000Z',
        },
      ],
      expected: {
        hasHypertension: false,
        hasDiabetes: false,
        hasHeartDisease: true,
        redFlagSuggested: true,
      },
    });
    const caseB = evaluateSingleRetrievalCase({
      results: [
        {
          sourceId: 'WHO',
          sourceName: 'WHO',
          title: 'General guideline',
          url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
          snippet: '来源：世界卫生组织。这是一段旧格式摘要。',
          retrievedAt: '2026-03-14T00:00:00.000Z',
        },
      ],
      expected: {
        hasHypertension: false,
        hasDiabetes: true,
        hasHeartDisease: false,
        redFlagSuggested: false,
      },
    });

    const aggregated = aggregateRetrievalEvaluations([
      { ...caseA, redFlagExpected: true },
      { ...caseB, redFlagExpected: false },
    ]);

    expect(caseB.summaryStructuredRate).toBe(0);
    expect(aggregated.sampleCount).toBe(2);
    expect(aggregated.redFlagRecall).toBe(1);
    expect(aggregated.summaryStructuredRate).toBe(0.5);
  });
});
