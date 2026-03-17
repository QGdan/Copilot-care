<script setup lang="ts">
import { computed } from 'vue';
import type {
  AgentOpinion,
  ExplainableEvidenceCard,
  ExplainableReport,
  RuleGovernanceSnapshot,
  StructuredTriageResult,
  TriageBlockingReason,
  TriageRoutingInfo,
} from '@copilot-care/shared/types';
import {
  formatCollaboration,
  formatClinicalGrade,
  formatDestination,
  formatDepartment,
  formatRouteMode,
  formatTriageLevel,
} from '../constants/triageLabels';

interface Props {
  routeInfo: TriageRoutingInfo | null;
  triageResult: StructuredTriageResult | null;
  ruleGovernance: RuleGovernanceSnapshot | null;
  explainableReport: ExplainableReport | null;
  finalConsensus: AgentOpinion | null;
  resultNotes: string[];
  blockingReason: TriageBlockingReason | null;
  isSafetyBlocked: boolean;
  safetyBlockNote: string;
  canExportReport: boolean;
  exportingReport: boolean;
  reportExportError: string;
  reportExportSuccess: string;
}

type AuthorityTier = 'A' | 'B' | 'C';

interface DisplayEvidenceCard extends ExplainableEvidenceCard {
  displayTitle: string;
  metaText: string;
  authorityTier: AuthorityTier;
  authorityLabel: string;
  authorityReason: string;
  clinicalSummary: string;
  consensusEvidenceBrief: string;
}

const TIER_A_TOKENS = [
  'WHO',
  'NICE',
  'CDC',
  'NIH',
  'NCCN',
  'USPSTF',
  'KDIGO',
  'ESC',
  'AHA',
  'ACC',
  'NHC',
  'CHINESE CENTER FOR DISEASE CONTROL',
  '中国疾控',
  '国家卫健',
  '中华医学会',
];

const TIER_B_TOKENS = [
  'PUBMED',
  'COCHRANE',
  'JAMA',
  'NEJM',
  'LANCET',
  'BMJ',
];

const STRUCTURED_EVIDENCE_LABEL_PATTERN =
  '(?:来源|证据要点|临床解读|建议动作|适用提示|核心知识|多\\s*agent共识证据)';
const ACRONYM_CHAIN_DETECT_PATTERN = /\b(?:[A-Z]{2,8}\s*[/\\|]\s*){3,}[A-Z]{2,8}\b/;
const ACRONYM_CHAIN_REPLACE_PATTERN = /\b(?:[A-Z]{2,8}\s*[/\\|]\s*){3,}[A-Z]{2,8}\b/g;
const STRUCTURED_LABEL_DUPLICATE_PATTERN = new RegExp(
  `((?:${STRUCTURED_EVIDENCE_LABEL_PATTERN}))\\s*[：:]\\s*\\1\\s*[：:]\\s*`,
  'giu',
);

const props = defineProps<Props>();
const emit = defineEmits<{
  export: [];
}>();

function formatBlockingStage(stage: TriageBlockingReason['triggerStage']): string {
  const labels: Record<TriageBlockingReason['triggerStage'], string> = {
    START: '启动',
    INFO_GATHER: '信息采集',
    RISK_ASSESS: '风险评估',
    ROUTING: '复杂度分流',
    DEBATE: '协同会诊',
    CONSENSUS: '共识收敛',
    REVIEW: '安全复核',
    OUTPUT: '输出结论',
    ESCALATION: '线下上转',
  };
  return labels[stage] ?? stage;
}

function formatBlockingSeverity(
  severity: TriageBlockingReason['severity'],
): string {
  if (severity === 'critical') {
    return '高危';
  }
  if (severity === 'high') {
    return '高';
  }
  return '中';
}

function handleExport(): void {
  emit('export');
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function extractHost(url?: string): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toUpperCase();
  } catch {
    return null;
  }
}

function normalizeSourceText(item: ExplainableEvidenceCard): string {
  const parts = [
    item.sourceId ?? '',
    item.sourceName ?? '',
    extractHost(item.url) ?? '',
  ];
  return parts.join(' ').toUpperCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMedicalExpression(text: string): string {
  if (!text.trim()) {
    return '';
  }

  const dictionary: Array<[RegExp, string]> = [
    [/\bhypertension\b/gi, '高血压'],
    [/\badults?\b/gi, '成人'],
    [/\bdiagnosis\b/gi, '诊断'],
    [/\btreatment\b/gi, '治疗'],
    [/\bprevention\b/gi, '预防'],
    [/\btherapy\b/gi, '治疗'],
    [/\bsystolic\b/gi, '收缩压'],
    [/\bdiastolic\b/gi, '舒张压'],
    [/\bmmhg\b/gi, 'mmHg'],
    [/\btarget\b/gi, '目标'],
    [/\bthreshold\b/gi, '阈值'],
    [/\brecommended?\b/gi, '推荐'],
    [/\bshould\b/gi, '应当'],
    [/\bmonitoring\b/gi, '监测'],
    [/\boutcome\b/gi, '结局'],
    [/\bmortality\b/gi, '死亡率'],
    [/\bincidence\b/gi, '发生率'],
    [/\bblood pressure\b/gi, '血压'],
    [/\blifestyle interventions?\b/gi, '生活方式干预'],
    [/\bmanagement\b/gi, '管理'],
    [/\brisk\b/gi, '风险'],
    [/\bguidelines?\b/gi, '指南'],
    [/\bevidence\b/gi, '证据'],
    [/\bcardiovascular\b/gi, '心血管'],
    [/\bscreening\b/gi, '筛查'],
    [/\bfollow-up\b/gi, '随访'],
  ];

  let normalized = text.trim();
  dictionary.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });
  return normalized
    .replace(ACRONYM_CHAIN_REPLACE_PATTERN, ' ')
    .replace(/([\\/]\s*){2,}/g, ' ')
    .replace(/[_*#~]{2,}/g, ' ')
    .replace(/(\s*[|｜]\s*){2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeEvidenceText(text: string): string {
  return normalizeMedicalExpression(text)
    .replace(STRUCTURED_LABEL_DUPLICATE_PATTERN, '$1：')
    .replace(ACRONYM_CHAIN_REPLACE_PATTERN, ' ')
    .replace(/([\\/]\s*){2,}/g, ' ')
    .replace(/([;；]\s*){2,}/g, '；')
    .replace(/([。?!！]){2,}/g, '。')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingEvidenceLabels(text: string): string {
  const prefixPattern = new RegExp(
    `^(?:${STRUCTURED_EVIDENCE_LABEL_PATTERN})\\s*[：:]\\s*`,
    'iu',
  );
  let normalized = sanitizeEvidenceText(text);
  let previous = '';
  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(prefixPattern, '').trim();
  }
  return normalized;
}

function extractStructuredSegment(text: string, label: string): string {
  const normalized = sanitizeEvidenceText(text);
  if (!normalized) {
    return '';
  }
  const pattern = new RegExp(
    `${escapeRegExp(label)}\\s*[：:]\\s*([\\s\\S]*?)(?=(?:${STRUCTURED_EVIDENCE_LABEL_PATTERN})\\s*[：:]|$)`,
    'iu',
  );
  const matched = normalized.match(pattern);
  if (!matched || typeof matched[1] !== 'string') {
    return '';
  }
  return stripLeadingEvidenceLabels(matched[1]);
}

function toCanonicalEvidenceText(text: string): string {
  return stripLeadingEvidenceLabels(text)
    .toLowerCase()
    .replace(/[，。；:：./\\\-_\s()（）[\]【】"'`]/g, '')
    .trim();
}

function toBigramSet(text: string): Set<string> {
  const normalized = toCanonicalEvidenceText(text);
  const grams = new Set<string>();
  if (!normalized) {
    return grams;
  }
  if (normalized.length < 2) {
    grams.add(normalized);
    return grams;
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function diceSimilarity(left: string, right: string): number {
  const leftSet = toBigramSet(left);
  const rightSet = toBigramSet(right);
  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  return (2 * intersection) / (leftSet.size + rightSet.size);
}

function isNearDuplicateSentence(
  candidate: string,
  existingSentences: readonly string[],
): boolean {
  const candidateCanonical = toCanonicalEvidenceText(candidate);
  if (!candidateCanonical) {
    return true;
  }
  for (const existing of existingSentences) {
    const existingCanonical = toCanonicalEvidenceText(existing);
    if (!existingCanonical) {
      continue;
    }
    if (candidateCanonical === existingCanonical) {
      return true;
    }
    const shorter =
      candidateCanonical.length <= existingCanonical.length
        ? candidateCanonical
        : existingCanonical;
    const longer =
      candidateCanonical.length > existingCanonical.length
        ? candidateCanonical
        : existingCanonical;
    if (shorter.length >= 12 && longer.includes(shorter)) {
      return true;
    }
    if (diceSimilarity(candidateCanonical, existingCanonical) >= 0.88) {
      return true;
    }
  }
  return false;
}

function splitCandidateSentences(text: string): string[] {
  const normalized = sanitizeEvidenceText(text)
    .replace(/[;；]+/g, '。')
    .replace(/[|｜]+/g, '。')
    .trim();
  if (!normalized) {
    return [];
  }

  const candidates = normalized
    .split(/[。?!！]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return candidates.length > 0 ? candidates : [normalized];
}

function isLikelyNoisySentence(sentence: string): boolean {
  if (!sentence.trim()) {
    return true;
  }
  if (/([\\/]\s*){2,}/.test(sentence)) {
    return true;
  }
  if (/^[\d\s\-_/.,，；:：]+$/.test(sentence)) {
    return true;
  }
  const alnumAndCjk = sentence.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
  return alnumAndCjk.length < 6;
}

function hasClinicalSignal(sentence: string): boolean {
  return /(mmhg|mg\/dl|%|风险|建议|应当|推荐|阈值|目标|收缩压|舒张压|血压|高血压|指南|证据|复测|复查|随访|转诊|评估|症状|心血管|monitor|follow-up|referral)/i
    .test(sentence);
}

function scoreMedicalSentence(sentence: string): number {
  let score = 0;
  if (/\d/.test(sentence)) {
    score += 3;
  }
  if (hasClinicalSignal(sentence)) {
    score += 4;
  }
  if (/(19|20)\d{2}/.test(sentence)) {
    score += 1;
  }
  if (sentence.length >= 16 && sentence.length <= 140) {
    score += 2;
  }
  return score;
}

function extractEvidenceKeyPoint(item: ExplainableEvidenceCard): string {
  const primaryText = sanitizeEvidenceText(item.summary || '');
  const fallbackText = sanitizeEvidenceText(item.title || '');
  const structuredPoint =
    extractStructuredSegment(primaryText, '证据要点')
    || extractStructuredSegment(primaryText, '核心知识');
  const combinedText = [structuredPoint, primaryText, fallbackText]
    .filter(Boolean)
    .join('。');

  if (!combinedText) {
    return '暂无可用证据正文，建议补充权威来源后再进行临床判断。';
  }

  const seen = new Set<string>();
  const candidates = splitCandidateSentences(combinedText).filter((candidate) => {
    const normalized = toCanonicalEvidenceText(candidate);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });

  const filteredCandidates = candidates.filter(
    (sentence) => !isLikelyNoisySentence(sentence),
  );
  const candidatePool =
    filteredCandidates.length > 0 ? filteredCandidates : candidates;

  if (candidatePool.length === 0) {
    return fallbackText || primaryText;
  }

  const ranked = candidatePool
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreMedicalSentence(sentence),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = ranked
    .filter((itemRow) => itemRow.score >= 4)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index)
    .map((itemRow) => itemRow.sentence);

  const conciseSentences: string[] = [];
  for (const sentence of selected) {
    if (isNearDuplicateSentence(sentence, conciseSentences)) {
      continue;
    }
    conciseSentences.push(sentence);
    if (conciseSentences.length >= 2) {
      break;
    }
  }
  const keyPoint = conciseSentences
    .join('；')
    .trim()
    .replace(/([\\/]\s*){2,}/g, ' ');
  if (keyPoint.length > 0) {
    return stripLeadingEvidenceLabels(keyPoint);
  }

  if (fallbackText && !isLikelyNoisySentence(fallbackText)) {
    return stripLeadingEvidenceLabels(fallbackText);
  }

  return `来源：${resolveSourceNameToChinese(item)}；建议结合生命体征与红旗症状进行复核。`;
}

function resolveSourceNameToChinese(item: ExplainableEvidenceCard): string {
  const rawSource = item.sourceName || item.sourceId || '';
  const sourceText = normalizeSourceText(item);
  if (!sourceText) {
    return '权威医学数据库';
  }

  if (sourceText.includes('WHO')) {
    return '世界卫生组织(WHO)';
  }
  if (sourceText.includes('NICE')) {
    return '英国国家卫生与临床优化研究所(NICE)';
  }
  if (sourceText.includes('CDC')) {
    return '美国疾病控制与预防中心(CDC)';
  }
  if (sourceText.includes('NIH')) {
    return '美国国立卫生研究院(NIH)';
  }
  if (sourceText.includes('NHC') || sourceText.includes('国家卫健')) {
    return '国家卫生健康委员会';
  }
  if (sourceText.includes('PUBMED')) {
    return 'PubMed 文献数据库';
  }
  if (sourceText.includes('COCHRANE')) {
    return 'Cochrane 系统评价数据库';
  }
  if (sourceText.includes('JAMA')) {
    return 'JAMA 医学期刊';
  }
  if (sourceText.includes('LANCET')) {
    return '柳叶刀医学期刊';
  }
  if (sourceText.includes('NEJM')) {
    return '新英格兰医学期刊';
  }
  if (sourceText.includes('BMJ')) {
    return '英国医学杂志(BMJ)';
  }

  return rawSource || '权威医学数据库';
}

function containsAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function resolveAuthorityTier(item: ExplainableEvidenceCard): {
  tier: AuthorityTier;
  label: string;
  reason: string;
} {
  if (item.category === 'guideline_rule') {
    return {
      tier: 'A',
      label: 'A 级权威',
      reason: '来源于临床指南，优先作为分诊与风险分层依据。',
    };
  }

  const sourceText = normalizeSourceText(item);

  if (containsAnyToken(sourceText, TIER_A_TOKENS)) {
    return {
      tier: 'A',
      label: 'A 级权威',
      reason: '命中国际/国家级医学机构来源。',
    };
  }

  if (containsAnyToken(sourceText, TIER_B_TOKENS)) {
    return {
      tier: 'B',
      label: 'B 级循证',
      reason: '命中高质量期刊或证据汇编数据库。',
    };
  }

  return {
    tier: 'C',
    label: 'C 级参考',
    reason: '未识别为高优先白名单来源，需人工复核。',
  };
}

function buildDisplayTitle(item: ExplainableEvidenceCard): string {
  const normalizedTitle = sanitizeEvidenceText(item.title || '');
  const hasAcronymRun = ACRONYM_CHAIN_DETECT_PATTERN.test(item.title || '');
  if (
    normalizedTitle
    && hasChinese(normalizedTitle)
    && normalizedTitle.length <= 64
    && !hasAcronymRun
  ) {
    return normalizedTitle;
  }

  const bag = sanitizeEvidenceText(`${item.title || ''} ${item.summary || ''}`).toLowerCase();
  const yearMatch = `${item.title || ''} ${item.publishedOn || ''}`.match(/\b(19|20)\d{2}\b/);
  const topic = /(高血压|血压|收缩压|舒张压|hypertension|blood pressure)/i.test(bag)
    ? '高血压'
    : /(卒中|中风|stroke|fast)/i.test(bag)
      ? '卒中风险'
      : /(糖尿病|血糖|glucose|hba1c|diabetes)/i.test(bag)
        ? '糖代谢'
        : '临床';
  const evidenceType = /(指南|guideline|consensus|recommendation)/i.test(
    `${item.category || ''} ${item.title || ''}`,
  )
    ? '指南证据'
    : '权威证据';
  if (yearMatch && typeof yearMatch[0] === 'string') {
    return `${yearMatch[0]}年${topic}${evidenceType}`;
  }
  return `${topic}${evidenceType}`;
}

function buildChineseKnowledgePoint(item: ExplainableEvidenceCard): string {
  return extractEvidenceKeyPoint(item);
}

function formatEvidenceMeta(item: ExplainableEvidenceCard): string {
  const categoryText = item.category === 'guideline_rule'
    ? '临床指南'
    : item.category === 'model_citation'
      ? '模型引用'
      : '权威数据库';
  const source = resolveSourceNameToChinese(item);
  const published = item.publishedOn ? `发布时间 ${item.publishedOn}` : '';
  const retrieved = item.retrievedAt ? `检索时间 ${item.retrievedAt}` : '';

  return [categoryText, source, published, retrieved].filter(Boolean).join(' | ');
}

function buildClinicalSummary(item: ExplainableEvidenceCard): string {
  const point = stripLeadingEvidenceLabels(buildChineseKnowledgePoint(item));
  const usage = item.category === 'guideline_rule'
    ? '建议优先用于分诊与风险分层。'
    : item.category === 'model_citation'
      ? '仅作模型补充参考，需用权威来源复核。'
      : '建议结合生命体征、既往史和红旗症状联合判断。';

  return `证据要点：${point || '建议补充关键体征后再判断。'} 适用提示：${usage}`;
}

function buildConsensusEvidenceBrief(item: ExplainableEvidenceCard): string {
  const source = resolveSourceNameToChinese(item);
  const point = stripLeadingEvidenceLabels(buildChineseKnowledgePoint(item));
  return `多Agent共识证据：${source}；核心知识：${point || '需补充关键证据要点。'}`;
}

function authorityTierRank(tier: AuthorityTier): number {
  if (tier === 'A') {
    return 3;
  }
  if (tier === 'B') {
    return 2;
  }
  return 1;
}

function extractEvidenceYear(value: string): number {
  const matched = value.match(/\b(19|20)\d{2}\b/);
  if (!matched || typeof matched[0] !== 'string') {
    return 0;
  }
  return Number.parseInt(matched[0], 10);
}

function inferTopicSignature(value: string): string {
  const bag = sanitizeEvidenceText(value).toLowerCase();
  if (/(高血压|血压|hypertension|blood pressure)/i.test(bag)) {
    return 'blood_pressure';
  }
  if (/(卒中|中风|stroke|fast)/i.test(bag)) {
    return 'stroke';
  }
  if (/(糖尿病|血糖|glucose|hba1c|diabetes)/i.test(bag)) {
    return 'glucose';
  }
  if (/(心衰|heart failure)/i.test(bag)) {
    return 'heart_failure';
  }
  return '';
}

function isNearDuplicateEvidenceCard(
  left: DisplayEvidenceCard,
  right: DisplayEvidenceCard,
): boolean {
  const sourceMatched = normalizeSourceText(left) === normalizeSourceText(right);
  const leftCore = `${left.displayTitle} ${left.clinicalSummary}`;
  const rightCore = `${right.displayTitle} ${right.clinicalSummary}`;
  const similarity = diceSimilarity(leftCore, rightCore);
  const leftPoint =
    extractStructuredSegment(left.clinicalSummary, '证据要点')
    || left.clinicalSummary;
  const rightPoint =
    extractStructuredSegment(right.clinicalSummary, '证据要点')
    || right.clinicalSummary;
  const pointSimilarity = diceSimilarity(leftPoint, rightPoint);
  if (sourceMatched && similarity >= 0.72) {
    return true;
  }
  if (sourceMatched && pointSimilarity >= 0.62) {
    return true;
  }
  if (sourceMatched) {
    const leftTopic = inferTopicSignature(`${left.displayTitle} ${left.clinicalSummary}`);
    const rightTopic = inferTopicSignature(`${right.displayTitle} ${right.clinicalSummary}`);
    if (leftTopic && leftTopic === rightTopic) {
      return true;
    }
  }
  if (!sourceMatched && similarity >= 0.92) {
    return true;
  }
  const leftCanonical = toCanonicalEvidenceText(leftCore);
  const rightCanonical = toCanonicalEvidenceText(rightCore);
  const shorter = leftCanonical.length <= rightCanonical.length ? leftCanonical : rightCanonical;
  const longer = leftCanonical.length > rightCanonical.length ? leftCanonical : rightCanonical;
  return sourceMatched && shorter.length >= 16 && longer.includes(shorter);
}

function shouldReplaceDuplicateCard(
  current: DisplayEvidenceCard,
  candidate: DisplayEvidenceCard,
): boolean {
  const currentTier = authorityTierRank(current.authorityTier);
  const candidateTier = authorityTierRank(candidate.authorityTier);
  if (candidateTier !== currentTier) {
    return candidateTier > currentTier;
  }
  const currentYear = extractEvidenceYear(`${current.publishedOn ?? ''}`);
  const candidateYear = extractEvidenceYear(`${candidate.publishedOn ?? ''}`);
  if (candidateYear !== currentYear) {
    return candidateYear > currentYear;
  }
  return candidate.clinicalSummary.length > current.clinicalSummary.length;
}

const displayEvidenceCards = computed<DisplayEvidenceCard[]>(() => {
  const cards = props.explainableReport?.evidenceCards ?? [];
  const prepared = cards.slice(0, 12).map((card) => {
    const authority = resolveAuthorityTier(card);
    return {
      ...card,
      displayTitle: buildDisplayTitle(card),
      metaText: formatEvidenceMeta(card),
      authorityTier: authority.tier,
      authorityLabel: authority.label,
      authorityReason: authority.reason,
      clinicalSummary: buildClinicalSummary(card),
      consensusEvidenceBrief: buildConsensusEvidenceBrief(card),
    };
  });
  const selected: DisplayEvidenceCard[] = [];
  for (const candidate of prepared) {
    const duplicateIndex = selected.findIndex((existing) =>
      isNearDuplicateEvidenceCard(existing, candidate),
    );
    if (duplicateIndex < 0) {
      selected.push(candidate);
    } else if (shouldReplaceDuplicateCard(selected[duplicateIndex], candidate)) {
      selected[duplicateIndex] = candidate;
    }
    if (selected.length >= 6) {
      break;
    }
  }
  return selected.slice(0, 6);
});
</script>

<template>
  <div class="panel-card">
    <div class="panel-header-with-action">
      <h3>结构化结果</h3>
      <button
        v-if="props.triageResult || props.explainableReport"
        class="export-btn"
        :disabled="!props.canExportReport"
        @click="handleExport"
      >
        {{ props.exportingReport ? '导出中...' : '导出报告' }}
      </button>
    </div>
    <div class="summary-grid">
      <article v-if="props.routeInfo" class="summary-card">
        <h4>分流路径</h4>
        <p>
          {{ formatRouteMode(props.routeInfo.routeMode) }} /
          {{ formatDepartment(props.routeInfo.department) }} /
          {{ formatCollaboration(props.routeInfo.collaborationMode) }}
        </p>
        <small>复杂度 {{ props.routeInfo.complexityScore }}</small>
      </article>
      <article v-if="props.triageResult" class="summary-card">
        <h4>分诊结果</h4>
        <p>
          {{ formatTriageLevel(props.triageResult.triageLevel) }} /
          {{ formatDestination(props.triageResult.destination) }}
        </p>
        <small>{{ formatClinicalGrade(props.triageResult.triageLevel, props.routeInfo?.department) }} · 随访周期 {{ props.triageResult.followupDays }} 天</small>
      </article>
    </div>
    <article v-if="props.finalConsensus" class="consensus-card">
      <h4>最终结论</h4>
      <p>{{ props.finalConsensus.reasoning }}</p>
    </article>
    <article
      v-if="displayEvidenceCards.length > 0"
      class="evidence-card-list"
      data-testid="result-evidence-cards"
    >
      <h4>权威证据卡片</h4>
      <ul>
        <li v-for="item in displayEvidenceCards" :key="item.id">
          <div class="evidence-header">
            <strong>{{ item.displayTitle }}</strong>
            <span
              class="authority-chip"
              :class="`tier-${item.authorityTier.toLowerCase()}`"
              :data-tier="item.authorityTier"
              data-testid="result-evidence-authority-tier"
            >
              {{ item.authorityLabel }}
            </span>
          </div>
          <small>{{ item.metaText }}</small>
          <p class="clinical-summary" data-testid="result-evidence-clinical-summary">
            {{ item.clinicalSummary }}
          </p>
          <small
            class="consensus-evidence"
            data-testid="result-evidence-consensus-brief"
          >
            {{ item.consensusEvidenceBrief }}
          </small>
          <small class="authority-reason">{{ item.authorityReason }}</small>
        </li>
      </ul>
    </article>
    <div
      v-if="props.blockingReason"
      class="safety-block-alert"
      data-testid="result-blocking-reason"
    >
      <strong>{{ props.blockingReason.title }}</strong>
      <p>{{ props.blockingReason.summary }}</p>
      <small class="blocking-meta">
        阶段：{{ formatBlockingStage(props.blockingReason.triggerStage) }} ·
        严重度：{{ formatBlockingSeverity(props.blockingReason.severity) }}
      </small>
      <ul
        v-if="props.blockingReason.actions.length > 0"
        class="blocking-actions"
      >
        <li
          v-for="(action, index) in props.blockingReason.actions"
          :key="`blocking-action-${index}`"
        >
          {{ action }}
        </li>
      </ul>
    </div>
    <div v-else-if="props.isSafetyBlocked" class="safety-block-alert">
      <strong>安全审校已阻断线上建议</strong>
      <p>{{ props.safetyBlockNote || '检测到潜在不安全输出，已切换为线下上转路径。' }}</p>
    </div>
    <ul v-if="props.resultNotes.length > 0" class="reasoning-list">
      <li v-for="(note, index) in props.resultNotes" :key="`note-${index}`">
        {{ note }}
      </li>
    </ul>
    <p v-if="props.reportExportError" class="export-status error">
      {{ props.reportExportError }}
    </p>
    <p v-else-if="props.reportExportSuccess" class="export-status success">
      {{ props.reportExportSuccess }}
    </p>
  </div>
</template>

<style scoped>
.panel-card {
  background: #ffffff;
  border: 1px solid #cad6e2;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 12px;
  box-shadow: 0 6px 18px rgba(17, 44, 72, 0.06);
  position: relative;
  overflow: hidden;
}

.panel-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6);
}

.panel-header-with-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.panel-header-with-action h3 {
  margin: 0;
  color: #1a365d;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.summary-card {
  border: 1px solid #c9d7e7;
  border-radius: 9px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.92);
}

.summary-card h4,
.consensus-card h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #4c6881;
}

.summary-card p,
.consensus-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #21445e;
}

.summary-card small {
  display: block;
  margin-top: 6px;
  color: #5d7890;
}

.consensus-card {
  margin-top: 10px;
  border: 1px solid #c9d7e7;
  border-radius: 9px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.95);
}

.evidence-card-list {
  margin-top: 10px;
  border: 1px solid #c9d7e7;
  border-radius: 9px;
  padding: 10px;
  background: #f9fcff;
}

.evidence-card-list h4 {
  margin: 0 0 8px;
  font-size: 12px;
  color: #365c7a;
}

.evidence-card-list ul {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 10px;
}

.evidence-card-list li {
  color: #21445e;
}

.evidence-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.evidence-card-list strong {
  display: block;
  font-size: 12px;
}

.authority-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
}

.authority-chip.tier-a {
  color: #1d5d3a;
  background: #ebf7ef;
  border-color: #9bc9ad;
}

.authority-chip.tier-b {
  color: #2d4f86;
  background: #edf4ff;
  border-color: #abc2ea;
}

.authority-chip.tier-c {
  color: #7f4f1e;
  background: #fff5ea;
  border-color: #e7c4a1;
}

.evidence-card-list small {
  display: block;
  font-size: 11px;
  color: #5d7890;
}

.clinical-summary {
  margin-top: 5px;
  padding: 7px 8px;
  border-radius: 7px;
  background: #f2f8ff;
  border: 1px solid #d6e6f8;
  color: #21445e;
  line-height: 1.45;
}

.consensus-evidence {
  margin-top: 4px;
  color: #355b79;
}

.authority-reason {
  margin-top: 4px;
  color: #3d607c;
}

.export-btn {
  padding: 6px 14px;
  background: linear-gradient(135deg, #0e8d8f 0%, #0a7072 100%);
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(14, 141, 143, 0.3);
}

.export-btn:hover {
  background: linear-gradient(135deg, #0a7072 0%, #085557 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(14, 141, 143, 0.4);
}

.export-btn:disabled {
  background: #86a9ab;
  cursor: not-allowed;
  box-shadow: none;
}

.safety-block-alert {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #e0a18c;
  background: #fff4ef;
  color: #9b3f25;
}

.safety-block-alert strong {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
}

.safety-block-alert p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

.blocking-meta {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: #864332;
}

.blocking-actions {
  margin: 6px 0 0;
  padding-left: 18px;
  color: #8f3d24;
  font-size: 12px;
}

.reasoning-list {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 13px;
  color: #3c5b75;
  line-height: 1.5;
}

.export-status {
  margin: 10px 0 0;
  font-size: 12px;
}

.export-status.error {
  color: #b23f29;
}

.export-status.success {
  color: #1e7e58;
}

@media (max-width: 980px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>


