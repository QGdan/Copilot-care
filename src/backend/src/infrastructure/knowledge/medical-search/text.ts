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

const ENGLISH_QUERY_STOPWORDS = new Set<string>([
  'about',
  'adult',
  'adults',
  'and',
  'article',
  'based',
  'care',
  'cdc',
  'consensus',
  'fact',
  'for',
  'from',
  'guideline',
  'guidelines',
  'in',
  'journal',
  'management',
  'model',
  'nice',
  'overview',
  'patient',
  'patients',
  'pubmed',
  'review',
  'risk',
  'sheet',
  'study',
  'the',
  'update',
  'who',
  'with',
]);

const CLINICAL_SIGNAL_RULES: Array<{
  pattern: RegExp;
  summary: string;
  weight: number;
}> = [
  {
    pattern:
      /\b(hypertension|high blood pressure|blood pressure|systolic|diastolic)\b|高血压|血压|收缩压|舒张压/i,
    summary: '强调规范测量血压并结合总体心血管风险进行分层管理。',
    weight: 3,
  },
  {
    pattern:
      /\b(prevalence|epidemiology|burden|population)\b|患病率|流行病学|疾病负担|人群/i,
    summary: '概述患病率与流行病学负担，可用于人群风险识别。',
    weight: 2,
  },
  {
    pattern:
      /\b(risk factor|risk factors|risk stratification|cardiovascular risk)\b|危险因素|风险分层|心血管风险/i,
    summary: '说明主要危险因素，建议结合既往史进行风险分层。',
    weight: 2,
  },
  {
    pattern: /\b(symptom|symptoms|red flag|warning sign)\b|症状|红旗|预警/i,
    summary: '提示症状表现可能不典型，应结合生命体征与红旗信号综合判断。',
    weight: 2,
  },
  {
    pattern:
      /\b(sodium|salt|diet|lifestyle|physical activity|exercise|weight)\b|钠盐|限盐|饮食|生活方式|运动|体重/i,
    summary: '建议优先开展生活方式干预，包括限盐、体重管理与规律运动。',
    weight: 2,
  },
  {
    pattern:
      /\b(follow[-\s]?up|monitor|monitoring|screening|reassessment)\b|随访|监测|筛查|复评/i,
    summary: '强调持续监测与分层随访，便于动态评估治疗反应和风险变化。',
    weight: 2,
  },
  {
    pattern:
      /\b(treatment|therapy|medication|control|target|threshold)\b|治疗|药物|控制|目标|阈值/i,
    summary: '概括治疗与控制目标，需结合个体情况制定方案并定期复核。',
    weight: 2,
  },
  {
    pattern:
      /\b(stroke|fast|facial droop|speech|arm weakness|emergency)\b|卒中|急诊|FAST/i,
    summary: '出现卒中FAST预警信号时应立即急诊评估，避免延误关键治疗窗口。',
    weight: 3,
  },
  {
    pattern:
      /\b(diabetes|hyperglycemia|hypoglycemia|glucose|hba1c)\b|糖尿病|高血糖|低血糖|血糖|糖化血红蛋白/i,
    summary: '提示应结合血糖阈值与症状进行风险识别，并安排及时复评。',
    weight: 2,
  },
  {
    pattern: /\b(guideline|consensus|recommendation)\b|指南|共识|建议/i,
    summary: '该证据属于指南或共识类，可作为分诊与随访策略依据。',
    weight: 1,
  },
];

const BOILERPLATE_PATTERNS: RegExp[] = [
  /\bcookie\b/i,
  /\bprivacy\b/i,
  /\bterms?\b/i,
  /\bsubscribe\b/i,
  /\bsign in\b/i,
  /\blog in\b/i,
  /\bnewsletter\b/i,
  /\bcopyright\b/i,
];

function replaceCommonMedicalEnglishWithChinese(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bhypertension\b/gi, '高血压'],
    [/\bhigh blood pressure\b/gi, '高血压'],
    [/\bblood pressure\b/gi, '血压'],
    [/\bsystolic\b/gi, '收缩压'],
    [/\bdiastolic\b/gi, '舒张压'],
    [/\bmmhg\b/gi, '毫米汞柱'],
    [/\bthreshold(?:s)?\b/gi, '阈值'],
    [/\btarget(?:s)?\b/gi, '目标'],
    [/\bcardiovascular\b/gi, '心血管'],
    [/\bheart failure\b/gi, '心力衰竭'],
    [/\bcoronary heart disease\b/gi, '冠心病'],
    [/\bstroke\b/gi, '卒中'],
    [/\bfast\b/gi, '卒中快速识别'],
    [/\bfacial droop\b/gi, '面瘫'],
    [/\bspeech(?: difficulty| disturbance| impairment)?\b/gi, '言语障碍'],
    [/\barm weakness\b/gi, '肢体无力'],
    [/\bdiabetes\b/gi, '糖尿病'],
    [/\bglucose\b/gi, '血糖'],
    [/\bhba1c\b/gi, '糖化血红蛋白'],
    [/\bhyperglycemia\b/gi, '高血糖'],
    [/\bhypoglycemia\b/gi, '低血糖'],
    [/\bsodium\b/gi, '钠盐'],
    [/\bsalt\b/gi, '盐'],
    [/\breduc(?:e|es|ed|ing|tion)\b/gi, '减少'],
    [/\bincreas(?:e|es|ed|ing)\b/gi, '增加'],
    [/\bintake\b/gi, '摄入'],
    [/\bdiet(?:ary)?\b/gi, '饮食'],
    [/\blifestyle\b/gi, '生活方式'],
    [/\bweight\b/gi, '体重'],
    [/\bphysical activity\b/gi, '体力活动'],
    [/\bexercise\b/gi, '运动'],
    [/\bmonitor(?:ing)?\b/gi, '监测'],
    [/\bscreening\b/gi, '筛查'],
    [/\breassessment\b/gi, '复评'],
    [/\bguideline\b/gi, '指南'],
    [/\bconsensus\b/gi, '共识'],
    [/\brecommendation(?:s)?\b/gi, '建议'],
    [/\bmanagement\b/gi, '管理'],
    [/\brisk\b/gi, '风险'],
    [/\bprevalence\b/gi, '患病率'],
    [/\bepidemiology\b/gi, '流行病学'],
    [/\bburden\b/gi, '疾病负担'],
    [/\bpopulation\b/gi, '人群'],
    [/\bfactor(?:s)?\b/gi, '因素'],
    [/\bsymptom(?:s)?\b/gi, '症状'],
    [/\bred flag(?:s)?\b/gi, '红旗信号'],
    [/\bwarning sign(?:s)?\b/gi, '预警信号'],
    [/\bprevention\b/gi, '预防'],
    [/\btreatment\b/gi, '治疗'],
    [/\btherapy\b/gi, '治疗'],
    [/\bfollow[-\s]?up\b/gi, '随访'],
    [/\bemergency\b/gi, '急诊'],
    [/\bday(?:s)?\b/gi, '天'],
    [/\bweek(?:s)?\b/gi, '周'],
    [/\bmonth(?:s)?\b/gi, '个月'],
    [/\byear(?:s)?\b/gi, '年'],
  ];
  let normalized = value;
  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalizeWhitespace(normalized);
}

function toChineseOnlyText(value: string): string {
  const normalized = replaceCommonMedicalEnglishWithChinese(value);
  return normalizeWhitespace(
    normalized
      .replace(/[A-Za-z][A-Za-z0-9_\-']*/g, ' ')
      .replace(/["'`]/g, ' ')
      .replace(/[()（）[\]{}]/g, ' ')
      .replace(/\s+/g, ' '),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function tokenizeSemanticText(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2)
    .slice(0, 80);
}

function jaccardSimilarity(
  leftTokens: readonly string[],
  rightTokens: readonly string[],
): number {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
}

function toClinicalSentenceBlock(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return '';
  }
  const sentences = normalized
    .split(/(?<=[。！？!?])\s*/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (sentences.length === 0) {
    return '';
  }
  const merged = sentences.join(' ');
  if (/[。！？!?]$/u.test(merged)) {
    return merged;
  }
  return `${merged}。`;
}

function buildFocusTokens(
  queryTokens: readonly string[] | undefined,
  title: string,
): string[] {
  const titleTokens = tokenizeQuery(title);
  const merged = [...(queryTokens ?? []), ...titleTokens];
  const dedup = new Set<string>();
  const focusTokens: string[] = [];
  for (const token of merged) {
    const normalized = normalizeWhitespace(token).toLowerCase();
    if (
      normalized.length < 2 ||
      /^\d+$/.test(normalized) ||
      ENGLISH_QUERY_STOPWORDS.has(normalized) ||
      dedup.has(normalized)
    ) {
      continue;
    }
    dedup.add(normalized);
    focusTokens.push(normalized);
    if (focusTokens.length >= 10) {
      break;
    }
  }
  return focusTokens;
}

function containsFocusToken(text: string, token: string): boolean {
  if (!token) {
    return false;
  }
  if (/[\u4E00-\u9FFF]/u.test(token)) {
    return text.includes(token);
  }
  return new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(text);
}

function splitIntoCandidateSentences(value: string): string[] {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return [];
  }

  const primary = normalized
    .replace(/[•·]/g, ' ')
    .split(/(?<=[。！？!?;；.])\s*/u)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
  if (primary.length > 1) {
    return dedupeTexts(primary);
  }

  if (normalized.length <= 90) {
    return [normalized];
  }

  const byComma = normalized
    .split(/[，,]/u)
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length >= 8);
  if (byComma.length > 1) {
    return dedupeTexts(byComma);
  }

  return [normalized];
}

function normalizeNumericSignal(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\bday(?:s)?\b/gi, '天')
      .replace(/\bweek(?:s)?\b/gi, '周')
      .replace(/\bmonth(?:s)?\b/gi, '个月')
      .replace(/\byear(?:s)?\b/gi, '年')
      .replace(/\bmmhg\b/gi, '毫米汞柱'),
  );
}

function extractNumericSignals(value: string): string[] {
  const text = normalizeWhitespace(value);
  if (!text) {
    return [];
  }
  const patterns: RegExp[] = [
    /\b\d{2,3}\s*\/\s*\d{2,3}\b/gi,
    /\b\d{2,3}\s*mmhg\b/gi,
    /\b\d+(?:\.\d+)?\s*%/gi,
    /\b\d+\s*(?:day|days|week|weeks|month|months|year|years)\b/gi,
  ];
  const extracted: string[] = [];
  for (const pattern of patterns) {
    const found = text.match(pattern) ?? [];
    extracted.push(...found);
  }
  return dedupeTexts(
    extracted
      .map((item) => normalizeNumericSignal(item))
      .filter((item) => item.length >= 2),
  ).slice(0, 3);
}

interface ScoredSentence {
  sentence: string;
  index: number;
  score: number;
}

function scoreCandidateSentence(
  sentence: string,
  focusTokens: readonly string[],
): number {
  const lowered = normalizeWhitespace(sentence).toLowerCase();
  if (!lowered) {
    return 0;
  }

  let score = 0;
  let focusHitCount = 0;
  for (const token of focusTokens) {
    if (containsFocusToken(lowered, token)) {
      focusHitCount += 1;
      score += 3;
    }
  }
  if (focusHitCount >= 2) {
    score += 1;
  }

  for (const rule of CLINICAL_SIGNAL_RULES) {
    if (rule.pattern.test(lowered)) {
      score += rule.weight;
    }
  }

  if (/\b\d{2,3}\s*\/\s*\d{2,3}\b/.test(lowered)) {
    score += 3;
  }
  if (/\b\d+(?:\.\d+)?\s*%/.test(lowered)) {
    score += 2;
  }
  if (/\b\d+\s*(?:day|days|week|weeks|month|months|year|years)\b/.test(lowered)) {
    score += 2;
  }

  if (lowered.length >= 18 && lowered.length <= 220) {
    score += 1;
  } else if (lowered.length > 320) {
    score -= 1;
  }

  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(lowered)) {
      score -= 3;
    }
  }

  return score;
}

function summarizeSentenceToChinese(value: string): string {
  const normalized = toChineseOnlyText(value)
    .replace(/\.+/g, '。')
    .replace(/[，,;；:：]\s*(?=[，,;；:：])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return '';
  }
  return truncateText(normalized, 86);
}

function pickDiverseTopSentences(
  scored: ScoredSentence[],
  maxCount: number,
): string[] {
  if (scored.length === 0 || maxCount <= 0) {
    return [];
  }

  const ordered = [...scored].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.index - right.index;
  });
  const selected: string[] = [];
  const selectedTokens: string[][] = [];
  for (const item of ordered) {
    if (selected.length >= maxCount) {
      break;
    }
    if (selected.length > 0 && item.score <= 0) {
      continue;
    }
    const candidateTokens = tokenizeSemanticText(item.sentence);
    let similar = false;
    for (const existingTokens of selectedTokens) {
      if (jaccardSimilarity(existingTokens, candidateTokens) >= 0.72) {
        similar = true;
        break;
      }
    }
    if (similar) {
      continue;
    }
    selected.push(item.sentence);
    selectedTokens.push(candidateTokens);
  }

  if (selected.length === 0) {
    selected.push(ordered[0].sentence);
  }

  return selected;
}

function buildFocusLabel(focusTokens: readonly string[]): string {
  const normalizedTokens = dedupeTexts(
    focusTokens
      .map((token) => toChineseOnlyText(token))
      .map((token) => normalizeWhitespace(token))
      .filter((token) => token.length >= 2),
  );
  if (normalizedTokens.length === 0) {
    return '';
  }
  return normalizedTokens.slice(0, 3).join('、');
}

function buildFocusedClinicalPoint(input: {
  title: string;
  rawSnippet?: string;
  queryTokens?: readonly string[];
}): string {
  const rawText = normalizeWhitespace(input.rawSnippet ?? '');
  if (!rawText) {
    return '';
  }

  const focusTokens = buildFocusTokens(input.queryTokens, input.title);
  const sentences = splitIntoCandidateSentences(rawText);
  if (sentences.length === 0) {
    return '';
  }

  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: scoreCandidateSentence(sentence, focusTokens),
  }));
  const topSentences = pickDiverseTopSentences(scored, 2);
  const summaries = dedupeTexts(
    topSentences
      .map((sentence) => summarizeSentenceToChinese(sentence))
      .filter((item) => item.length >= 8),
  );
  if (summaries.length === 0) {
    return '';
  }

  const focusLabel = buildFocusLabel(focusTokens);
  const merged = summaries.slice(0, 2).join('；');
  if (focusLabel) {
    return toClinicalSentenceBlock(`围绕${focusLabel}，${merged}。`);
  }
  return toClinicalSentenceBlock(`检索要点：${merged}。`);
}

function normalizeSourceNameToChinese(value: string): string {
  const sourceName = normalizeWhitespace(value);
  const bag = sourceName.toLowerCase();
  if (!bag) {
    return '权威医学来源';
  }
  if (bag.includes('world health organization') || bag === 'who') {
    return '世界卫生组织';
  }
  if (bag.includes('nice')) {
    return '英国临床优化研究所指南机构';
  }
  if (bag.includes('us cdc') || (bag.includes('cdc') && bag.includes('us'))) {
    return '美国疾病预防控制中心';
  }
  if (bag.includes('national health commission') || bag.includes('nhc')) {
    return '国家卫生健康委员会';
  }
  if (bag.includes('china cdc') || bag.includes('chinacdc')) {
    return '中国疾病预防控制中心';
  }
  if (bag.includes('nmpa')) {
    return '国家药品监督管理局';
  }
  if (bag.includes('pubmed')) {
    return '医学文献数据库';
  }
  const chinese = toChineseOnlyText(sourceName);
  return chinese || '权威医学来源';
}

function buildChinesePointFromSignals(
  input: {
    title: string;
    rawSnippet?: string;
    queryTokens?: readonly string[];
  },
): string {
  const focusedPoint = buildFocusedClinicalPoint(input);
  if (focusedPoint) {
    return focusedPoint;
  }

  const titleText = normalizeWhitespace(input.title);
  const rawText = normalizeWhitespace(input.rawSnippet ?? '');
  const bag = `${titleText} ${rawText}`.toLowerCase();
  const points: string[] = [];

  for (const rule of CLINICAL_SIGNAL_RULES) {
    if (rule.pattern.test(bag)) {
      points.push(rule.summary);
    }
  }

  const numericSignals = extractNumericSignals(rawText);
  if (numericSignals.length > 0) {
    points.push(
      `文本提及关键阈值或时间节点（${numericSignals.join('、')}），可用于风险分层与随访时点设置。`,
    );
  }

  const uniquePoints = dedupeTexts(points);
  if (uniquePoints.length > 0) {
    return toClinicalSentenceBlock(uniquePoints.slice(0, 2).join(' '));
  }
  if (rawText) {
    const rawSummary = toChineseOnlyText(rawText);
    if (rawSummary) {
      return toClinicalSentenceBlock(`概括要点：${truncateText(rawSummary, 120)}。`);
    }
  }
  if (titleText) {
    const titleSummary = toChineseOnlyText(titleText);
    if (titleSummary) {
      return toClinicalSentenceBlock(`概括要点：${truncateText(titleSummary, 80)}。`);
    }
  }
  return '可用于补充分诊判断与随访策略制定。';
}

function buildGuidelineReferenceSnippet(
  title: string,
  publisher: string,
): string {
  const titleSummary = toChineseOnlyText(title);
  const publisherSummary = normalizeSourceNameToChinese(publisher);
  const titleText = titleSummary
    ? `“${truncateText(titleSummary, 60)}”`
    : '相关指南主题';
  return `来自${publisherSummary}的指南条目，主题为${titleText}，可作为临床复核依据。`;
}

function buildChineseEvidenceSnippet(input: {
  sourceName: string;
  title: string;
  rawSnippet?: string;
  queryTokens?: readonly string[];
}): string {
  const sourceName = normalizeSourceNameToChinese(input.sourceName);
  const point = buildChinesePointFromSignals({
    title: input.title,
    rawSnippet: input.rawSnippet,
    queryTokens: input.queryTokens,
  });
  return `来源：${sourceName}。证据要点：${point}`;
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
  queryTokens?: readonly string[];
}): string {
  const dateText = input.publishedOn ? `（${input.publishedOn}）` : '';
  const point = buildChinesePointFromSignals({
    title: `${input.title} ${input.journal}`,
    rawSnippet: input.title,
    queryTokens: input.queryTokens,
  });
  return `来源：医学文献数据库${dateText}。证据要点：${point}`;
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
