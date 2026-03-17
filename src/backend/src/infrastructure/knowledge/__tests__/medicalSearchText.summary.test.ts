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
    expect(snippet).toContain('临床解读');
    expect(snippet).toContain('建议动作');
    expect(snippet).not.toContain('。 。');
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

    expect(strokeFocused).toContain('急诊');
    expect(strokeFocused).toContain('危险信号');
    expect(bpFocused).toContain('血压');
    expect(bpFocused).toMatch(/钠盐|限盐|生活方式/);
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
    expect(snippet).toContain('血压');
    expect(snippet).toMatch(/6\s*个月/);
    expect(snippet).toContain('临床解读');
    expect(snippet).toContain('建议动作');
    expect(/[A-Za-z]{3,}/.test(snippet)).toBe(false);
  });

  it('removes duplicated labels and slash/acronym noise from structured evidence text', () => {
    const snippet = buildChineseEvidenceSnippet({
      sourceName: 'NIH',
      title:
        '2025 AHA/ACC/AANP/AAPA/ABC/ACCP guideline for prevention, detection, evaluation and management of high blood pressure in adults',
      rawSnippet:
        '证据要点：证据要点：围绕高血压，2025 / / / / / 指南 预防。临床解读：适用于血压异常成人。建议动作：72小时内复测血压并复评。',
      queryTokens: tokenizeQuery('高血压 头晕 血压偏高'),
    });

    expect(snippet).toContain('来源：');
    expect(snippet).not.toContain('证据要点：证据要点：');
    expect(snippet).not.toMatch(/([\\/]\s*){2,}/);
    expect(snippet).toContain('临床解读');
    expect(snippet).toContain('建议动作');
  });

  it('falls back to readable clinical point when focus summary becomes phrase soup', () => {
    const snippet = buildChineseEvidenceSnippet({
      sourceName: 'WHO',
      title: 'Hypertension risk-based follow-up guidance',
      rawSnippet:
        'The guideline recommends confirming blood pressure with repeated measurements, reducing sodium intake, and scheduling follow-up every 3 months for high-risk adults.',
      queryTokens: tokenizeQuery('hypertension high risk follow up adults'),
    });

    expect(snippet).toContain('证据要点：');
    expect(snippet).not.toContain('。 。');
    expect(snippet).not.toMatch(/围绕[^，。]{1,24}，\s*围绕/);
    expect(snippet).toContain('3 个月');
  });

  it('marks overview-only evidence as background and avoids forcing emergency wording', () => {
    const snippet = buildChineseEvidenceSnippet({
      sourceName: 'WHO',
      title: 'WHO cardiovascular diseases topic',
      rawSnippet:
        'Cardiovascular diseases are the leading cause of death globally. This fact sheet summarizes prevalence, burden and broad prevention strategies.',
      queryTokens: tokenizeQuery('palpitation dyspnea heart failure follow up'),
    });

    expect(snippet).toContain('证据要点：');
    expect(snippet).toMatch(/心悸|气短|心血管/);
    expect(snippet).not.toContain('立即执行线下急诊评估路径');
    expect(snippet).toContain('建议动作');
  });
});
