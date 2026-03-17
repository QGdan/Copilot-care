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

const CASE_CONTEXT_STOPWORDS = new Set<string>([
  'adult',
  'adults',
  'clinical',
  'evidence',
  'follow',
  'followup',
  'guideline',
  'guidelines',
  'management',
  'model',
  'monitor',
  'patient',
  'patients',
  'practice',
  'recommendation',
  'recommendations',
  'risk',
  'screening',
  'study',
  'threshold',
  'triage',
  '分诊',
  '指南',
  '管理',
  '证据',
  '风险',
  '随访',
  '阈值',
  '患者',
  '成人',
  '临床',
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
    pattern:
      /\b(cardiac|cardiovascular|heart failure|palpitation|dyspnea|shortness of breath|chest pain)\b|心血管|心悸|气短|呼吸困难|心衰|心力衰竭|胸痛|胸闷/i,
    summary: '提示需评估心悸/气短等心脏负荷相关症状，并明确急诊转诊触发条件。',
    weight: 3,
  },
  {
    pattern: /\b(guideline|consensus|recommendation)\b|指南|共识|建议/i,
    summary: '该证据属于指南或共识类，可作为分诊与随访策略依据。',
    weight: 1,
  },
];

type ClinicalNarrativeTopic =
  | 'stroke'
  | 'hypertension'
  | 'diabetes'
  | 'cardiac'
  | 'followup'
  | 'generic';

type RankedClinicalNarrativeTopic = Exclude<ClinicalNarrativeTopic, 'generic'>;

const CLINICAL_TOPIC_PATTERNS = {
  strokeStrong:
    /\b(fast|facial droop|speech|arm weakness|emergency|urgent|red flag)\b|FAST|急诊|红旗|预警/i,
  stroke:
    /\b(stroke|neurologic)\b|卒中|中风/i,
  hypertension:
    /\b(hypertension|blood pressure|systolic|diastolic)\b|高血压|血压|收缩压|舒张压/i,
  diabetes:
    /\b(diabetes|hyperglycemia|hypoglycemia|glucose|hba1c)\b|糖尿病|高血糖|低血糖|血糖|糖化血红蛋白|多饮|多尿|口渴/i,
  cardiac:
    /\b(cardiac|heart disease|heart failure|palpitation|dyspnea|shortness of breath|chest pain|cardiovascular diseases)\b|心悸|气短|呼吸困难|心衰|心力衰竭|胸痛|胸闷|心脏病/i,
  followup:
    /\b(follow[-\s]?up|monitor|monitoring|screening|reassessment)\b|随访|监测|筛查|复评/i,
};

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

const STRUCTURED_LABEL_PATTERN =
  '(?:来源|证据要点|临床解读|建议动作|适用提示|核心知识|多\\s*agent共识证据)';

const ACRONYM_CHAIN_GLOBAL_PATTERN = /\b(?:[A-Z]{2,8}\s*[/\\|]\s*){3,}[A-Z]{2,8}\b/g;
const STRUCTURED_LABEL_DUPLICATE_PATTERN = new RegExp(
  `((?:${STRUCTURED_LABEL_PATTERN}))\\s*[：:]\\s*\\1\\s*[：:]\\s*`,
  'giu',
);

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
    [/\bdizziness\b/gi, '头晕'],
    [/\bheadache\b/gi, '头痛'],
    [/\bchest pain\b/gi, '胸痛'],
    [/\bpalpitations?\b/gi, '心悸'],
    [/\bfatigue\b/gi, '乏力'],
    [/\bblurred vision\b/gi, '视物模糊'],
    [/\bdyspnea\b/gi, '呼吸困难'],
    [/\bshortness of breath\b/gi, '呼吸困难'],
    [/\bedema\b/gi, '水肿'],
    [/\bnausea\b/gi, '恶心'],
    [/\bvomiting\b/gi, '呕吐'],
    [/\bpolyuria\b/gi, '多尿'],
    [/\bpolydipsia\b/gi, '多饮'],
    [/\bthirst\b/gi, '口渴'],
    [/\bsyncope\b/gi, '晕厥'],
    [/\bconfusion\b/gi, '意识模糊'],
    [/\bweakness\b/gi, '无力'],
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
    [/\bhour(?:s)?\b/gi, '小时'],
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
      .replace(ACRONYM_CHAIN_GLOBAL_PATTERN, ' ')
      .replace(/([\\/]\s*){2,}/g, ' ')
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

function canonicalizeClinicalChunk(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function sanitizeRawEvidenceText(value: string): string {
  return normalizeWhitespace(
    value
      .replace(STRUCTURED_LABEL_DUPLICATE_PATTERN, '$1：')
      .replace(ACRONYM_CHAIN_GLOBAL_PATTERN, ' ')
      .replace(/([\\/]\s*){2,}/g, ' ')
      .replace(/([|｜]\s*){2,}/g, ' ')
      .replace(/[_*#~]{2,}/g, ' ')
      .replace(/\s+/g, ' '),
  );
}

function stripLeadingStructuredLabels(value: string): string {
  const prefixPattern = new RegExp(
    `^(?:${STRUCTURED_LABEL_PATTERN})\\s*[：:]\\s*`,
    'iu',
  );
  let normalized = sanitizeRawEvidenceText(value);
  let previous = '';
  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalizeWhitespace(normalized.replace(prefixPattern, ''));
  }
  return normalized;
}

function polishClinicalPointText(value: string): string {
  const normalized = normalizeWhitespace(
    stripLeadingStructuredLabels(value)
      .replace(/^检索要点\s*[：:]\s*/u, '')
      .replace(/^围绕[^，,:：]{1,24}[，,:：]\s*/u, '')
      .replace(/([。！？!?]\s*){2,}/gu, '。')
      .replace(/\s*[；;]\s*[；;]\s*/gu, '；')
      .replace(/\s*[，,]\s*[，,]\s*/gu, '，')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (!normalized) {
    return '';
  }
  const chunks = normalized
    .split(/[；;]/u)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
  if (chunks.length <= 1) {
    return normalized;
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const key = canonicalizeClinicalChunk(chunk);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(chunk);
  }
  return normalizeWhitespace(unique.join('；'));
}

function isLowReadabilityClinicalPoint(value: string): boolean {
  const text = normalizeWhitespace(polishClinicalPointText(value));
  if (!text) {
    return true;
  }
  const chineseCount = (text.match(/[\u4E00-\u9FFF]/gu) ?? []).length;
  if (chineseCount < 8) {
    return true;
  }
  if (/([。！？!?]\s*){2,}/u.test(text)) {
    return true;
  }
  if (/围绕[^，。]{1,24}，\s*围绕/u.test(text)) {
    return true;
  }
  if (/[\u4E00-\u9FFF]{1,2}(?:\s+[\u4E00-\u9FFF]{1,2}){4,}/u.test(text)) {
    return true;
  }
  if (/^\d+(?:\.\d+)?\s*(?:天|周|个月|年|%|毫米汞柱)[，。]?$/u.test(text)) {
    return true;
  }
  if (/([\u4E00-\u9FFF]{2,})\s+\1/u.test(text)) {
    return true;
  }
  const bareNumberMatches = [...text.matchAll(/\d+/g)].filter((matched) => {
    const index = matched.index ?? 0;
    const context = text.slice(index, Math.min(text.length, index + 14));
    return !/^\d+\s*(?:毫米汞柱|%|天|周|个月|年|小时)/u.test(context)
      && !/^\d{2,3}\s*\/\s*\d{2,3}/u.test(context);
  });
  if (bareNumberMatches.length > 0) {
    return true;
  }
  const hasClinicalVerb = /(建议|应当|应|提示|强调|可用于|用于|需要|安排|复测|监测|评估|干预|管理|复评)/u
    .test(text);
  if (!hasClinicalVerb) {
    return true;
  }
  if (/相关[:：]\s*[\u4E00-\u9FFF0-9\s]+[。]?$/u.test(text) && !/[，；]/u.test(text)) {
    return true;
  }
  return false;
}

function extractStructuredField(value: string, label: string): string {
  const normalized = sanitizeRawEvidenceText(value);
  if (!normalized) {
    return '';
  }
  const pattern = new RegExp(
    `${escapeRegExp(label)}\\s*[：:]\\s*([\\s\\S]*?)(?=(?:${STRUCTURED_LABEL_PATTERN})\\s*[：:]|$)`,
    'iu',
  );
  const matched = normalized.match(pattern);
  if (!matched || typeof matched[1] !== 'string') {
    return '';
  }
  return stripLeadingStructuredLabels(matched[1]);
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
  const normalized = sanitizeRawEvidenceText(value);
  if (!normalized) {
    return [];
  }

  const primary = normalized
    .replace(ACRONYM_CHAIN_GLOBAL_PATTERN, ' ')
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
      .replace(/\b(hour|hours)\b/gi, '小时')
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
    /\b\d{2,3}\s*\/\s*\d{2,3}\s*(?:mmhg)?\b/gi,
    /\b\d{2,3}\s*mmhg\b/gi,
    /\b\d+(?:\.\d+)?\s*%/gi,
    /\b\d+\s*(?:hour|hours|day|days|week|weeks|month|months|year|years)\b/gi,
  ];
  const extracted: string[] = [];
  for (const pattern of patterns) {
    const found = text.match(pattern) ?? [];
    extracted.push(...found);
  }
  const normalized = dedupeTexts(
    extracted
      .map((item) => normalizeNumericSignal(item))
      .filter((item) => item.length >= 2),
  );
  const hasBpRatio = normalized.some((item) => /\d{2,3}\s*\/\s*\d{2,3}/.test(item));
  return normalized
    .filter((item) => !(hasBpRatio && /^\d{2,3}\s*毫米汞柱$/u.test(item)))
    .slice(0, 3);
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
  const normalized = toChineseOnlyText(stripLeadingStructuredLabels(value))
    .replace(/\.+/g, '。')
    .replace(/[，,;；:：]\s*(?=[，,;；:：])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return '';
  }
  const chineseCount = (normalized.match(/[\u4E00-\u9FFF]/gu) ?? []).length;
  if (chineseCount < 8) {
    return '';
  }
  if (/([\u4E00-\u9FFF]{2,})\s+\1/u.test(normalized)) {
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

function normalizeCaseContextToken(value: string): string {
  return normalizeWhitespace(toChineseOnlyText(value))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function buildCaseLinkagePhrase(input: {
  queryTokens?: readonly string[];
  rawSnippet?: string;
}): string {
  const focusTokens = dedupeTexts(
    (input.queryTokens ?? [])
      .map((token) => normalizeCaseContextToken(token))
      .filter(
        (token) =>
          token.length >= 2
          && !/^\d+$/.test(token)
          && !CASE_CONTEXT_STOPWORDS.has(token),
      ),
  ).slice(0, 3);

  const numericSignals = extractNumericSignals(input.rawSnippet ?? '');
  const hasFocus = focusTokens.length > 0;
  const hasNumeric = numericSignals.length > 0;

  if (hasFocus && hasNumeric) {
    return `包含可复核阈值/时限信息（${numericSignals.join('、')}），可用于当前病例复评`;
  }
  if (hasFocus) {
    return '与当前病例问题相关，可用于风险分层复核';
  }
  if (hasNumeric) {
    return `覆盖关键阈值/时限（${numericSignals.join('、')}），可用于当前病例的复评时点设定`;
  }
  return '可补充当前病例的循证判断依据';
}

function extractFocusedClinicalSnippet(input: {
  text: string;
  queryTokens?: readonly string[];
  maxLength?: number;
}): string {
  const rawText = sanitizeRawEvidenceText(input.text);
  if (!rawText) {
    return '';
  }

  const focusTokens = buildFocusTokens(input.queryTokens, '');
  const sentences = splitIntoCandidateSentences(rawText.slice(0, 8000));
  if (sentences.length === 0) {
    return truncateText(rawText, input.maxLength ?? 420);
  }

  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: scoreCandidateSentence(sentence, focusTokens),
  }));
  const selected = pickDiverseTopSentences(scored, 3)
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length >= 12);
  if (selected.length === 0) {
    return truncateText(rawText, input.maxLength ?? 420);
  }

  return truncateText(dedupeTexts(selected).join(' '), input.maxLength ?? 420);
}

function buildFocusedClinicalPoint(input: {
  title: string;
  rawSnippet?: string;
  queryTokens?: readonly string[];
}): string {
  const rawText = sanitizeRawEvidenceText(input.rawSnippet ?? '');
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

  const merged = summaries.slice(0, 2).join('；');
  const polishedMerged = polishClinicalPointText(merged);
  if (!polishedMerged) {
    return '';
  }
  return toClinicalSentenceBlock(polishedMerged);
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
  if (bag.includes('nih') || bag.includes('national institutes of health')) {
    return '美国国立卫生研究院';
  }
  if (bag.includes('pubmed')) {
    return '医学文献数据库';
  }
  const chinese = toChineseOnlyText(sourceName);
  return chinese || '权威医学来源';
}

function inferClinicalNarrativeTopic(input: {
  bag: string;
  queryTokens?: readonly string[];
}): ClinicalNarrativeTopic {
  const queryBag = normalizeWhitespace((input.queryTokens ?? []).join(' ')).toLowerCase();
  const bagScore: Record<RankedClinicalNarrativeTopic, number> = {
    stroke: 0,
    hypertension: 0,
    diabetes: 0,
    cardiac: 0,
    followup: 0,
  };
  if (CLINICAL_TOPIC_PATTERNS.strokeStrong.test(input.bag)) {
    bagScore.stroke += 2;
  }
  if (CLINICAL_TOPIC_PATTERNS.stroke.test(input.bag)) {
    bagScore.stroke += 1;
  }
  if (CLINICAL_TOPIC_PATTERNS.hypertension.test(input.bag)) {
    bagScore.hypertension += 1;
  }
  if (CLINICAL_TOPIC_PATTERNS.diabetes.test(input.bag)) {
    bagScore.diabetes += 1;
  }
  if (CLINICAL_TOPIC_PATTERNS.cardiac.test(input.bag)) {
    bagScore.cardiac += 1;
  }
  if (CLINICAL_TOPIC_PATTERNS.followup.test(input.bag)) {
    bagScore.followup += 1;
  }

  const score = { ...bagScore };

  if (queryBag) {
    if (CLINICAL_TOPIC_PATTERNS.stroke.test(queryBag)) {
      score.stroke += 1;
    }
    if (CLINICAL_TOPIC_PATTERNS.hypertension.test(queryBag)) {
      score.hypertension += 1;
    }
    if (CLINICAL_TOPIC_PATTERNS.diabetes.test(queryBag)) {
      score.diabetes += 1;
    }
    if (CLINICAL_TOPIC_PATTERNS.cardiac.test(queryBag)) {
      score.cardiac += 1;
    }
    if (CLINICAL_TOPIC_PATTERNS.followup.test(queryBag)) {
      score.followup += 1;
    }
  }

  if (bagScore.stroke >= 2 && score.stroke >= Math.max(
    score.hypertension,
    score.diabetes,
    score.cardiac,
    score.followup,
  )) {
    return 'stroke';
  }

  const topicCandidates: Array<[RankedClinicalNarrativeTopic, number]> = [
    ['diabetes', score.diabetes],
    ['cardiac', score.cardiac],
    ['hypertension', score.hypertension],
    ['followup', score.followup],
    ['stroke', score.stroke],
  ];
  topicCandidates.sort((left, right) => right[1] - left[1]);
  const topCandidate = topicCandidates.find(([topic, value]) => {
    if (value <= 0) {
      return false;
    }
    return bagScore[topic] > 0;
  });
  const [topTopic, topScore] = topCandidate ?? ['generic', 0];
  if (!topTopic || topScore <= 0 || topTopic === 'generic') {
    return 'generic';
  }

  if (
    topTopic === 'stroke' &&
    bagScore.stroke < 2 &&
    (
      bagScore.hypertension > 0 ||
      bagScore.diabetes > 0 ||
      bagScore.cardiac > 0
    )
  ) {
    const nonStroke = topicCandidates.find(
      (item) => item[0] !== 'stroke' && item[1] > 0 && bagScore[item[0]] > 0,
    );
    return nonStroke?.[0] ?? 'generic';
  }

  return topTopic;
}

function isOverviewStyleEvidence(input: {
  title: string;
  rawText: string;
}): boolean {
  const bag = normalizeWhitespace(`${input.title} ${input.rawText}`).toLowerCase();
  if (!bag) {
    return false;
  }
  const hasOverviewToken = /\b(fact sheet|overview|what is|burden|prevalence|health topic)\b|专题|概述|基础知识|简介|科普/i
    .test(bag);
  const hasActionOrThreshold =
    /\b(threshold|target|recommend|should|follow[-\s]?up|triage|urgent)\b|阈值|目标|建议|应|复测|转诊|随访|急诊|分诊/i
      .test(bag);
  const hasNumericSignal =
    /\d{2,3}\s*\/\s*\d{2,3}|\d+(?:\.\d+)?\s*(?:%|mmhg|毫米汞柱|天|周|个月|小时)/iu
      .test(bag);
  return hasOverviewToken && !hasActionOrThreshold && !hasNumericSignal;
}

function buildChinesePointFromSignals(
  input: {
    title: string;
    rawSnippet?: string;
    queryTokens?: readonly string[];
  },
): string {
  const structuredPoint = extractStructuredField(
    input.rawSnippet ?? '',
    '证据要点',
  );
  if (structuredPoint) {
    return toClinicalSentenceBlock(structuredPoint);
  }
  const consensusPoint = extractStructuredField(
    input.rawSnippet ?? '',
    '核心知识',
  );
  if (consensusPoint) {
    return toClinicalSentenceBlock(consensusPoint);
  }

  const focusedPoint = buildFocusedClinicalPoint(input);
  if (focusedPoint && !isLowReadabilityClinicalPoint(focusedPoint)) {
    return toClinicalSentenceBlock(polishClinicalPointText(focusedPoint));
  }

  const titleText = normalizeWhitespace(input.title);
  const rawText = sanitizeRawEvidenceText(input.rawSnippet ?? '');
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
    return toClinicalSentenceBlock(
      polishClinicalPointText(uniquePoints.slice(0, 2).join(' ')),
    );
  }
  if (isOverviewStyleEvidence({ title: titleText, rawText })) {
    return '该证据以疾病概览为主，缺少可直接执行的诊断阈值与处置时限。';
  }
  if (rawText) {
    const rawSummary = toChineseOnlyText(rawText);
    if (rawSummary.length >= 18) {
      return toClinicalSentenceBlock(`概括要点：${truncateText(rawSummary, 120)}。`);
    }
    if (rawSummary) {
      return '该证据正文信息较概括，建议补充含阈值与时效的指南条目。';
    }
  }
  if (titleText) {
    const titleSummary = toChineseOnlyText(titleText);
    if (titleSummary.length >= 16) {
      return toClinicalSentenceBlock(`概括要点：${truncateText(titleSummary, 80)}。`);
    }
    if (titleSummary) {
      return '该证据标题可用于来源追溯，但正文未提取到可执行临床要点。';
    }
  }
  return '可用于补充分诊判断与随访策略制定。';
}

function buildClinicalInterpretation(input: {
  title: string;
  rawSnippet?: string;
  queryTokens?: readonly string[];
}): string {
  const structuredInterpretation = extractStructuredField(
    input.rawSnippet ?? '',
    '临床解读',
  );
  if (structuredInterpretation) {
    return toClinicalSentenceBlock(structuredInterpretation);
  }

  const bag = sanitizeRawEvidenceText(`${input.title} ${input.rawSnippet ?? ''}`).toLowerCase();
  const focusTokens = dedupeTexts(
    (input.queryTokens ?? [])
      .map((token) => normalizeCaseContextToken(token))
      .filter(
        (token) =>
          token.length >= 2
          && !/^\d+$/.test(token)
          && !CASE_CONTEXT_STOPWORDS.has(token),
      ),
  );
  const focusText = focusTokens.length > 0 ? '，与当前检索任务相关' : '';
  const caseLinkage = buildCaseLinkagePhrase({
    queryTokens: input.queryTokens,
    rawSnippet: input.rawSnippet,
  });
  const appendCaseLinkage = (message: string): string => {
    const normalized = normalizeWhitespace(message).replace(/[。！？!?]+$/u, '');
    return `${normalized}；${caseLinkage}。`;
  };
  const topic = inferClinicalNarrativeTopic({
    bag,
    queryTokens: input.queryTokens,
  });
  if (topic === 'stroke') {
    return appendCaseLinkage(
      `提示存在急症风险，需要优先完成危险信号排查${focusText}`,
    );
  }
  if (topic === 'hypertension') {
    return appendCaseLinkage(
      `适用于血压异常患者的风险分层与分诊决策${focusText}`,
    );
  }
  if (topic === 'diabetes') {
    return appendCaseLinkage(
      `可用于判断糖代谢异常的紧急程度与随访优先级${focusText}`,
    );
  }
  if (topic === 'cardiac') {
    return appendCaseLinkage(
      `可用于评估心悸/气短等心血管症状的紧急程度与转诊优先级${focusText}`,
    );
  }
  if (topic === 'followup') {
    return appendCaseLinkage(
      `可作为持续监测与复评频率设定的依据${focusText}`,
    );
  }
  return appendCaseLinkage(
    `可作为会诊结论复核与行动排序的辅助证据${focusText}`,
  );
}

function buildActionHint(input: {
  title: string;
  rawSnippet?: string;
  queryTokens?: readonly string[];
}): string {
  const structuredAction = extractStructuredField(input.rawSnippet ?? '', '建议动作');
  if (structuredAction) {
    return toClinicalSentenceBlock(structuredAction);
  }

  const bag = sanitizeRawEvidenceText(`${input.title} ${input.rawSnippet ?? ''}`).toLowerCase();
  const numericSignals = extractNumericSignals(input.rawSnippet ?? '');
  const numericText = numericSignals.length > 0 ? `（重点阈值：${numericSignals.join('、')}）` : '';

  const topic = inferClinicalNarrativeTopic({
    bag,
    queryTokens: input.queryTokens,
  });
  if (topic === 'stroke') {
    return `立即执行线下急诊评估路径，并补齐神经系统体征记录${numericText}。`;
  }
  if (topic === 'hypertension') {
    return `建议复测血压并结合既往史完成风险分层，再确定随访周期${numericText}。`;
  }
  if (topic === 'diabetes') {
    return `建议补充血糖复检与症状复评，必要时升级处置等级${numericText}。`;
  }
  if (topic === 'cardiac') {
    return `建议尽快复评心率、血氧与心衰体征；若静息气短加重、胸痛持续或出现晕厥，立即急诊转诊${numericText}。`;
  }
  if (topic === 'followup') {
    return `将该证据写入随访计划，明确复评时点与触发条件${numericText}。`;
  }
  return `将该证据纳入会诊记录并在下一次复评中核验一致性${numericText}。`;
}

function buildStructuredEvidenceSummary(input: {
  title: string;
  rawSnippet?: string;
  queryTokens?: readonly string[];
}): string {
  const point = stripLeadingStructuredLabels(buildChinesePointFromSignals(input));
  const interpretation = stripLeadingStructuredLabels(
    buildClinicalInterpretation(input),
  );
  const action = stripLeadingStructuredLabels(buildActionHint({
    title: input.title,
    rawSnippet: input.rawSnippet,
    queryTokens: input.queryTokens,
  }));
  return truncateText(
    `证据要点：${point} 临床解读：${interpretation} 建议动作：${action}`,
    220,
  );
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
  const summary = buildStructuredEvidenceSummary({
    title: input.title,
    rawSnippet: input.rawSnippet,
    queryTokens: input.queryTokens,
  });
  return `来源：${sourceName}。${summary}`;
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
  rawSnippet?: string;
}): string {
  const dateText = input.publishedOn ? `（${input.publishedOn}）` : '';
  const summary = buildStructuredEvidenceSummary({
    title: `${input.title} ${input.journal}`,
    rawSnippet: normalizeWhitespace(
      `${input.title} ${input.rawSnippet ?? ''}`,
    ),
    queryTokens: input.queryTokens,
  });
  return `来源：医学文献数据库${dateText}。${summary}`;
}

export {
  buildChineseEvidenceSnippet,
  extractFocusedClinicalSnippet,
  buildGuidelineReferenceSnippet,
  buildPubMedChineseSnippet,
  decodeHtmlEntities,
  extractMatchedQueryTokens,
  normalizeWhitespace,
  stripHtml,
  tokenizeQuery,
};
