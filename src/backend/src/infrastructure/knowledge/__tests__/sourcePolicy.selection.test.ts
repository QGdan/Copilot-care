import { AuthoritativeMedicalEvidence } from '../../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import { selectDiverseEvidence } from '../medical-search/sourcePolicy';

function createEvidence(input: {
  sourceId: string;
  url: string;
  title: string;
  snippet: string;
  matchedQueryTokens?: string[];
}): AuthoritativeMedicalEvidence {
  return {
    sourceId: input.sourceId,
    sourceName: input.sourceId,
    title: input.title,
    url: input.url,
    snippet: input.snippet,
    matchedQueryTokens: input.matchedQueryTokens ?? [],
    retrievedAt: '2026-03-08T00:00:00.000Z',
    origin: 'live_search',
  };
}

describe('selectDiverseEvidence', () => {
  it('prefers less similar candidates when source bucket has alternatives', () => {
    const candidates: AuthoritativeMedicalEvidence[] = [
      createEvidence({
        sourceId: 'WHO',
        url: 'https://www.who.int/a',
        title: 'WHO hypertension fact sheet',
        snippet:
          'Source: WHO. Title: Hypertension fact sheet. Snippet: blood pressure screening and sodium reduction.',
        matchedQueryTokens: ['hypertension', 'blood', 'pressure'],
      }),
      createEvidence({
        sourceId: 'WHO',
        url: 'https://www.who.int/b',
        title: 'WHO hypertension summary',
        snippet:
          'Source: WHO. Title: Hypertension summary. Snippet: blood pressure screening and sodium reduction.',
        matchedQueryTokens: ['hypertension', 'blood', 'pressure'],
      }),
      createEvidence({
        sourceId: 'WHO',
        url: 'https://www.who.int/c',
        title: 'WHO implementation guidance',
        snippet:
          'Source: WHO. Title: Primary care pathway. Snippet: risk-based follow-up cadence and adherence review.',
        matchedQueryTokens: ['risk', 'follow-up'],
      }),
      createEvidence({
        sourceId: 'NICE',
        url: 'https://www.nice.org.uk/a',
        title: 'NICE NG136',
        snippet:
          'Source: NICE. Title: NG136 recommendations. Snippet: confirm diagnosis with repeated measurements.',
        matchedQueryTokens: ['diagnosis', 'measurements'],
      }),
    ];

    const selected = selectDiverseEvidence(candidates, 3);
    const selectedUrls = selected.map((item) => item.url);

    expect(selected).toHaveLength(3);
    expect(selectedUrls).toContain('https://www.nice.org.uk/a');
    expect(selectedUrls).toContain('https://www.who.int/c');
  });

  it('keeps requested size when only highly similar evidence exists', () => {
    const candidates: AuthoritativeMedicalEvidence[] = [
      createEvidence({
        sourceId: 'WHO',
        url: 'https://www.who.int/s1',
        title: 'WHO hypertension article 1',
        snippet: 'blood pressure screening for adults with cardiovascular risk',
      }),
      createEvidence({
        sourceId: 'WHO',
        url: 'https://www.who.int/s2',
        title: 'WHO hypertension article 2',
        snippet: 'blood pressure screening for adults with cardiovascular risk',
      }),
      createEvidence({
        sourceId: 'WHO',
        url: 'https://www.who.int/s3',
        title: 'WHO hypertension article 3',
        snippet: 'blood pressure screening for adults with cardiovascular risk',
      }),
    ];

    const selected = selectDiverseEvidence(candidates, 2);
    expect(selected).toHaveLength(2);
  });
});
