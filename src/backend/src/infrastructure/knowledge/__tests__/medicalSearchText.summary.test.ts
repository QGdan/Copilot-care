import {
  buildChineseEvidenceSnippet,
  buildPubMedChineseSnippet,
  tokenizeQuery,
} from '../medical-search/text';

describe('medical-search text summarization', () => {
  it('extracts long-text evidence into focused Chinese points', () => {
    const snippet = buildChineseEvidenceSnippet({
      sourceName: 'World Health Organization',
      title: 'Hypertension risk-based follow-up guidance',
      rawSnippet:
        'The guideline recommends confirming blood pressure with repeated measurements, reducing sodium intake, and scheduling follow-up every 3 months for high-risk adults.',
      queryTokens: tokenizeQuery('hypertension high risk follow up adults'),
    });

    expect(snippet).toContain('来源：世界卫生组织');
    expect(snippet).toContain('血压');
    expect(snippet).toContain('随访');
    expect(snippet).toMatch(/3\s*个月/);
    expect(/[A-Za-z]{3,}/.test(snippet)).toBe(false);
  });

  it('uses query focus tokens to prioritize stroke-related evidence from long text', () => {
    const rawSnippet = [
      'Guideline section one: blood pressure should be measured with validated devices and sodium intake should be reduced.',
      'Guideline section two: FAST signs such as facial droop and speech disturbance require emergency evaluation.',
    ].join(' ');
    const strokeFocused = buildChineseEvidenceSnippet({
      sourceName: 'WHO',
      title: 'Hypertension and emergency warning',
      rawSnippet,
      queryTokens: tokenizeQuery('stroke fast warning sign'),
    });
    const bpFocused = buildChineseEvidenceSnippet({
      sourceName: 'WHO',
      title: 'Hypertension and emergency warning',
      rawSnippet,
      queryTokens: tokenizeQuery('hypertension sodium blood pressure'),
    });

    expect(strokeFocused).toContain('卒中');
    expect(strokeFocused).toContain('急诊');
    expect(bpFocused).toContain('血压');
    expect(bpFocused).toContain('钠盐');
  });

  it('renders pubmed evidence in Chinese-only summary format', () => {
    const snippet = buildPubMedChineseSnippet({
      title:
        'Risk stratification for hypertension treatment with follow-up every 6 months',
      journal: 'Journal of Cardiology',
      publishedOn: '2026',
      queryTokens: tokenizeQuery('hypertension treatment follow up'),
    });

    expect(snippet).toContain('来源：医学文献数据库（2026）');
    expect(snippet).toContain('高血压');
    expect(snippet).toMatch(/6\s*个月/);
    expect(/[A-Za-z]{3,}/.test(snippet)).toBe(false);
  });
});

