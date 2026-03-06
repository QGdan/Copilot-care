<script setup lang="ts">
import { computed } from 'vue';
import type {
  AgentOpinion,
  ExplainableEvidenceCard,
  ExplainableReport,
  RuleGovernanceSnapshot,
  StructuredTriageResult,
  TriageRoutingInfo,
} from '@copilot-care/shared/types';
import {
  formatCollaboration,
  formatDepartment,
  formatRouteMode,
} from '../constants/triageLabels';

interface Props {
  routeInfo: TriageRoutingInfo | null;
  triageResult: StructuredTriageResult | null;
  ruleGovernance: RuleGovernanceSnapshot | null;
  explainableReport: ExplainableReport | null;
  finalConsensus: AgentOpinion | null;
  resultNotes: string[];
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

const props = defineProps<Props>();
const emit = defineEmits<{
  export: [];
}>();

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
  return normalized.replace(/\s+/g, ' ').trim();
}

function splitCandidateSentences(text: string): string[] {
  const normalized = text
    .replace(/\s+/g, ' ')
    .replace(/[;；]+/g, '。')
    .trim();
  if (!normalized) {
    return [];
  }

  const candidates = normalized
    .split(/[。.!?]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return candidates.length > 0 ? candidates : [normalized];
}

function scoreMedicalSentence(sentence: string): number {
  let score = 0;
  if (/\d/.test(sentence)) {
    score += 3;
  }
  if (
    /(mmhg|mg\/dl|%|风险|建议|应当|推荐|阈值|目标|收缩压|舒张压|血压|高血压|指南|证据)/i
      .test(sentence)
  ) {
    score += 3;
  }
  if (sentence.length >= 16 && sentence.length <= 140) {
    score += 2;
  }
  return score;
}

function extractEvidenceKeyPoint(item: ExplainableEvidenceCard): string {
  const primaryText = normalizeMedicalExpression(item.summary || '');
  const fallbackText = normalizeMedicalExpression(item.title || '');
  const combinedText = primaryText || fallbackText;

  if (!combinedText) {
    return '暂无可用证据正文，建议补充权威来源后再进行临床判断。';
  }

  const candidates = splitCandidateSentences(combinedText);
  if (candidates.length === 0) {
    return combinedText;
  }

  const ranked = candidates
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreMedicalSentence(sentence),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = ranked
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((itemRow) => itemRow.sentence);

  const keyPoint = selected.join('；').trim();
  if (keyPoint.length > 0) {
    return keyPoint;
  }

  return combinedText;
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
  const normalizedTitle = normalizeMedicalExpression(item.title || '');
  if (normalizedTitle && hasChinese(normalizedTitle)) {
    return normalizedTitle;
  }

  const sourceName = resolveSourceNameToChinese(item);
  return `来自${sourceName}的医学证据`;
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
  const point = buildChineseKnowledgePoint(item);
  const usage = item.category === 'guideline_rule'
    ? '建议优先用于分诊与风险分层。'
    : item.category === 'model_citation'
      ? '仅作模型补充参考，需用权威来源复核。'
      : '建议结合生命体征、既往史和红旗症状联合判断。';

  return `证据要点：${point} 适用提示：${usage}`;
}

function buildConsensusEvidenceBrief(item: ExplainableEvidenceCard): string {
  const source = resolveSourceNameToChinese(item);
  const point = buildChineseKnowledgePoint(item);
  return `多Agent共识证据：${source}；核心知识：${point}`;
}

const displayEvidenceCards = computed<DisplayEvidenceCard[]>(() => {
  const cards = props.explainableReport?.evidenceCards ?? [];
  return cards.slice(0, 6).map((card) => {
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
          {{ props.triageResult.triageLevel }} /
          {{ props.triageResult.destination }}
        </p>
        <small>随访周期 {{ props.triageResult.followupDays }} 天</small>
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
    <div v-if="props.isSafetyBlocked" class="safety-block-alert">
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
