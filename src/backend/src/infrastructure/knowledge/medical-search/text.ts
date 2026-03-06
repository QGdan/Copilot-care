function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripHtml(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]*>/g, ' '));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return '...';
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function replaceCommonMedicalEnglishWithChinese(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bhypertension\b/gi, '高血压'],
    [/\bhigh blood pressure\b/gi, '高血压'],
    [/\bblood pressure\b/gi, '血压'],
    [/\bcardiovascular\b/gi, '心血管'],
    [/\bstroke\b/gi, '卒中'],
    [/\bdiabetes\b/gi, '糖尿病'],
    [/\bhyperglycemia\b/gi, '高血糖'],
    [/\bhypoglycemia\b/gi, '低血糖'],
    [/\bsodium\b/gi, '钠盐'],
    [/\bsalt\b/gi, '盐'],
    [/\bphysical activity\b/gi, '体力活动'],
    [/\bexercise\b/gi, '运动'],
    [/\bmonitor(?:ing)?\b/gi, '监测'],
    [/\bscreening\b/gi, '筛查'],
    [/\bguideline\b/gi, '指南'],
    [/\bconsensus\b/gi, '共识'],
    [/\bmanagement\b/gi, '管理'],
    [/\brisk\b/gi, '风险'],
  ];
  let normalized = value;
  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalizeWhitespace(normalized);
}

function dedupeTexts(values: string[]): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const value of values.map((item) => normalizeWhitespace(item)).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    selected.push(value);
  }
  return selected;
}

function buildChinesePointFromSignals(
  title: string,
  rawSnippet?: string,
): string {
  const titleText = normalizeWhitespace(title);
  const rawText = normalizeWhitespace(rawSnippet ?? '');
  const bag = `${titleText} ${rawText}`.toLowerCase();
  const points: string[] = [];

  if (
    bag.includes('hypertension') ||
    bag.includes('high blood pressure') ||
    bag.includes('blood pressure')
  ) {
    points.push('强调规范测量血压并结合总体心血管风险进行分层管理。');
  }
  if (bag.includes('salt') || bag.includes('sodium')) {
    points.push('建议减少钠盐摄入作为长期干预措施。');
  }
  if (
    bag.includes('physical activity') ||
    bag.includes('exercise') ||
    bag.includes('lifestyle')
  ) {
    points.push('建议通过规律运动和生活方式干预降低心血管风险。');
  }
  if (
    bag.includes('stroke') ||
    bag.includes('fast') ||
    bag.includes('facial droop') ||
    bag.includes('speech')
  ) {
    points.push('出现卒中FAST预警信号时应立即急诊评估。');
  }
  if (
    bag.includes('diabetes') ||
    bag.includes('hyperglycemia') ||
    bag.includes('hypoglycemia') ||
    bag.includes('glucose')
  ) {
    points.push('提示应结合血糖阈值与症状进行风险识别并及时复评。');
  }
  if (bag.includes('guideline') || bag.includes('consensus')) {
    points.push('该证据属于指南/共识类，可作为分诊与随访策略依据。');
  }

  const uniquePoints = dedupeTexts(points);
  if (uniquePoints.length > 0) {
    return uniquePoints.slice(0, 2).join('');
  }
  if (rawText) {
    if (/[\u4e00-\u9fff]/u.test(rawText)) {
      return truncateText(rawText, 160);
    }
    return `主要内容：${truncateText(replaceCommonMedicalEnglishWithChinese(rawText), 160)}。`;
  }
  if (titleText) {
    return `主题：${truncateText(replaceCommonMedicalEnglishWithChinese(titleText), 100)}。`;
  }
  return '该条证据来自白名单权威医学数据库。';
}

function buildGuidelineReferenceSnippet(
  title: string,
  publisher: string,
): string {
  const normalizedTitle = replaceCommonMedicalEnglishWithChinese(title);
  const normalizedPublisher = normalizeWhitespace(publisher || '权威机构');
  return `来自${normalizedPublisher}的指南条目，主题为“${truncateText(normalizedTitle, 90)}”，可作为临床复核依据。`;
}

function buildChineseEvidenceSnippet(input: {
  sourceName: string;
  title: string;
  rawSnippet?: string;
}): string {
  const sourceName = normalizeWhitespace(input.sourceName || '权威医学来源');
  const point = buildChinesePointFromSignals(input.title, input.rawSnippet);
  return `来源：${sourceName}。${point}`;
}

function tokenizeQuery(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2)
    .slice(0, 16);
}

function extractMatchedQueryTokens(
  queryTokens: readonly string[],
  text: string,
  limit: number = 3,
): string[] {
  if (queryTokens.length === 0) {
    return [];
  }
  const bag = normalizeWhitespace(text).toLowerCase();
  if (!bag) {
    return [];
  }
  const matched: string[] = [];
  const dedup = new Set<string>();
  for (const token of queryTokens) {
    if (token.length < 2 || dedup.has(token)) {
      continue;
    }
    if (!bag.includes(token)) {
      continue;
    }
    dedup.add(token);
    matched.push(token);
    if (matched.length >= limit) {
      break;
    }
  }
  return matched;
}

function buildPubMedChineseSnippet(input: {
  title: string;
  journal: string;
  publishedOn?: string;
}): string {
  const title = normalizeWhitespace(input.title);
  const journal = normalizeWhitespace(input.journal || 'PubMed文献');
  const point = buildChinesePointFromSignals(title);

  const dateText = input.publishedOn ? `（${input.publishedOn}）` : '';
  return `来源：PubMed${dateText}，期刊：${journal}。${point}`;
}

export {
  buildChineseEvidenceSnippet,
  buildGuidelineReferenceSnippet,
  buildPubMedChineseSnippet,
  decodeHtmlEntities,
  extractMatchedQueryTokens,
  normalizeWhitespace,
  stripHtml,
  tokenizeQuery,
};
