<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import type {
  AgentOpinion,
  AuthoritativeSearchDiagnostics,
  WorkflowStage,
} from '@copilot-care/shared/types';
import { useTypewriterManager } from '../composables/useTypewriter';
import {
  parseMedicalSourceBreakdownMessage,
  type MedicalSourceBreakdown,
} from '../utils/medicalSourceBreakdown';

type ReasoningKind = 'system' | 'evidence' | 'decision' | 'warning' | 'query';

interface ReasoningItem {
  id: string;
  kind: ReasoningKind;
  text: string;
  timestamp: string;
  stage?: WorkflowStage;
  evidence?: string[];
  confidence?: number;
  agentName?: string;
  isNew?: boolean;
}

interface Props {
  items: ReasoningItem[];
  currentStage?: WorkflowStage;
  maxItems?: number;
  isRunning?: boolean;
  agentOpinions?: AgentOpinion[];
  authoritativeSearch?: AuthoritativeSearchDiagnostics | null;
  theme?: 'light' | 'dark';
}

const props = withDefaults(defineProps<Props>(), {
  maxItems: 50,
  isRunning: false,
  agentOpinions: () => [],
  theme: 'dark',
});

const emit = defineEmits<{
  (e: 'item-complete', id: string): void;
}>();

const expandedItems = ref<Set<string>>(new Set());
const completedItems = ref<Set<string>>(new Set());
const containerRef = ref<HTMLDivElement | null>(null);
const typewriterManager = useTypewriterManager();

const KIND_CONFIG: Record<ReasoningKind, { icon: string; label: string; color: string; bgColor: string; glowColor: string }> = {
  system: { 
    icon: '⚙️', 
    label: '系统', 
    color: '#64c8ff', 
    bgColor: 'rgba(100, 200, 255, 0.1)',
    glowColor: 'rgba(100, 200, 255, 0.3)',
  },
  evidence: { 
    icon: '📊', 
    label: '证据', 
    color: '#00ff88', 
    bgColor: 'rgba(0, 255, 136, 0.1)',
    glowColor: 'rgba(0, 255, 136, 0.3)',
  },
  decision: { 
    icon: '🎯', 
    label: '决策', 
    color: '#ffc800', 
    bgColor: 'rgba(255, 200, 0, 0.1)',
    glowColor: 'rgba(255, 200, 0, 0.3)',
  },
  warning: { 
    icon: '⚠️', 
    label: '风险', 
    color: '#ff4444', 
    bgColor: 'rgba(255, 68, 68, 0.1)',
    glowColor: 'rgba(255, 68, 68, 0.4)',
  },
  query: { 
    icon: '❓', 
    label: '补充', 
    color: '#ff9f43', 
    bgColor: 'rgba(255, 159, 67, 0.1)',
    glowColor: 'rgba(255, 159, 67, 0.3)',
  },
};

const AGENT_ICONS: Record<string, string> = {
  'cardio': '❤️',
  'gp': '🏥',
  'metabolic': '📊',
  'safety': '🛡️',
  'Cardiology': '❤️',
  'GP': '🏥',
  'Metabolic': '📊',
  'Safety': '🛡️',
};

const STAGE_LABELS: Record<WorkflowStage, string> = {
  START: '启动',
  INFO_GATHER: '信息采集',
  RISK_ASSESS: '风险评估',
  ROUTING: '复杂度分流',
  DEBATE: '协同仲裁',
  CONSENSUS: '共识收敛',
  REVIEW: '审校复核',
  OUTPUT: '输出结论',
  ESCALATION: '线下上转',
};

const displayItems = computed(() => {
  const sorted = [...props.items].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  return sorted.slice(-props.maxItems);
});

const stageGroups = computed(() => {
  const groups: Record<string, ReasoningItem[]> = {};
  for (const item of displayItems.value) {
    const stage = item.stage ?? 'unknown';
    if (!groups[stage]) {
      groups[stage] = [];
    }
    groups[stage].push(item);
  }
  return groups;
});

const stageOrder = computed(() => {
  const order: WorkflowStage[] = [
    'START',
    'INFO_GATHER',
    'RISK_ASSESS',
    'ROUTING',
    'DEBATE',
    'CONSENSUS',
    'REVIEW',
    'OUTPUT',
    'ESCALATION',
  ];
  return Object.keys(stageGroups.value).sort(
    (a, b) => order.indexOf(a as WorkflowStage) - order.indexOf(b as WorkflowStage),
  );
});

function localizeReasoningMessage(input: string): string {
  let text = input.trim();
  if (!text) {
    return '';
  }

  const rules: Array<[RegExp, string]> = [
    [/Authoritative medical search is disabled in triage runtime\.?/giu, '权威医学联网检索未启用，当前分诊流程不接入实时检索。'],
    [/Authoritative medical search started\.?/giu, '已启动权威医学联网检索。'],
    [/No authoritative result hit; fallback rule evidence path stays active\.?/giu, '未命中实时权威证据，已保留规则证据兜底路径。'],
    [/Fallback catalog evidence exists; continue realtime retrieval for final medical judgement\.?/giu, '存在目录兜底证据，建议继续补充实时权威来源后再给出最终结论。'],
    [/Authoritative medical search unavailable; fallback rule evidence path applied\.?/giu, '权威医学联网检索暂不可用，已切换为规则证据兜底路径。'],
    [/Evidence completeness gate failed: network search unavailable in high-risk scenario\.?/giu, '证据完整性门禁未通过：高风险场景下实时检索不可用。'],
  ];
  for (const [pattern, replacement] of rules) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(
    /Rule-driven retrieval plan:\s*risk=([^,]+),\s*minEvidence=([^,]+),\s*requiredSources=([^.]+)\.?/iu,
    '规则驱动检索计划：风险等级=$1，最少证据=$2，必选来源=$3',
  );
  text = text.replace(
    /Need decomposition:\s*(.+)$/iu,
    '需求拆分：$1',
  );
  text = text.replace(
    /Professional restatement:\s*(.+)$/iu,
    '专业化重述：$1',
  );
  text = text.replace(
    /Query rewrite:\s*(.+)$/iu,
    '检索改写：$1',
  );
  text = text.replace(
    /Main-agent skill chain:\s*(.+)$/iu,
    '主 Agent 技能链：$1',
  );
  text = text.replace(
    /Strategy note:\s*(.+)$/iu,
    '策略说明：$1',
  );
  text = text.replace(
    /Authoritative search hits:\s*(.+)$/iu,
    '权威检索命中：$1',
  );
  text = text.replace(
    /Evidence deduplication removed\s*(\d+)\s*near-duplicate result\(s\)\.?/iu,
    '证据去重：移除 $1 条近重复条目。',
  );
  text = text.replace(
    /Retrieval quality stats:\s*realtime=([^,]+),\s*fallback=([^,]+),\s*droppedByPolicy=([^.]+)\.?/iu,
    '检索质量统计：实时=$1，兜底=$2，策略过滤丢弃=$3。',
  );
  text = text.replace(
    /Authoritative source breakdown:\s*(.+?)\s*\(strategy:\s*([^)]+)\)\.?/iu,
    '权威医学来源分布：$1（策略：$2）',
  );
  text = text.replace(
    /Authoritative evidence\s*(\d+)\s*\(([^,]+),\s*([^)]+)\):\s*(.+)$/iu,
    '权威证据$1（$2，$3）：$4',
  );
  text = text.replace(
    /Evidence completeness gate failed:\s*(.+)$/iu,
    '证据完整性门禁未通过：$1',
  );

  return text;
}

// Agent思考状态
const thinkingAgents = computed(() => {
  return props.agentOpinions.filter(agent => agent.confidence < 0.9);
});

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function toggleExpand(id: string): void {
  if (expandedItems.value.has(id)) {
    expandedItems.value.delete(id);
  } else {
    expandedItems.value.add(id);
  }
}

function isExpanded(id: string): boolean {
  return expandedItems.value.has(id);
}

function getConfidenceColor(confidence: number | undefined): string {
  if (confidence === undefined) return '#8b92a8';
  if (confidence >= 0.8) return '#00ff88';
  if (confidence >= 0.6) return '#ffc800';
  return '#ff4444';
}

function getAgentIcon(agentName: string): string {
  return AGENT_ICONS[agentName] || '🤖';
}

// 监听新项目，启动打字机动画
watch(() => displayItems.value, async (newItems, oldItems) => {
  const newItemIds = new Set(newItems.map(item => item.id));
  const oldItemIds = new Set((oldItems || []).map(item => item.id));
  
  // 找出真正的新项目
  const trulyNewItems = newItems.filter(item => !oldItemIds.has(item.id) && item.isNew);
  
  for (const item of trulyNewItems) {
    await nextTick();
    const typewriter = typewriterManager.create(item.id, localizeReasoningMessage(item.text), {
      speed: 25,
      delay: 100,
      cursor: true,
    });
    
    // 监听完成
    const unwatch = watch(() => typewriter.isComplete.value, (complete) => {
      if (complete) {
        completedItems.value.add(item.id);
        emit('item-complete', item.id);
        unwatch();
      }
    });
    
    typewriter.start();
  }
  
  // 滚动到底部
  if (trulyNewItems.length > 0 && containerRef.value) {
    await nextTick();
    containerRef.value.scrollTop = containerRef.value.scrollHeight;
  }
}, { deep: true });

// 获取打字机文本
function getTypewriterText(item: ReasoningItem): string {
  const typewriter = typewriterManager.get(item.id);
  if (!typewriter || completedItems.value.has(item.id)) {
    return localizeReasoningMessage(item.text);
  }
  return typewriter.displayText.value;
}

function isTyping(item: ReasoningItem): boolean {
  const typewriter = typewriterManager.get(item.id);
  return typewriter?.isTyping.value || false;
}

function showCursor(item: ReasoningItem): boolean {
  const typewriter = typewriterManager.get(item.id);
  return typewriter?.showCursor.value || false;
}

const sourceBreakdownByReasoningId = computed(() => {
  const map = new Map<string, MedicalSourceBreakdown>();
  for (const item of displayItems.value) {
    const parsed = parseMedicalSourceBreakdownMessage(
      localizeReasoningMessage(item.text),
    );
    if (parsed) {
      map.set(item.id, parsed);
    }
  }
  return map;
});

const structuredSourceBreakdown = computed<MedicalSourceBreakdown | null>(() => {
  const payload = props.authoritativeSearch;
  if (!payload || payload.sourceBreakdown.length === 0) {
    return null;
  }
  return {
    strategyVersion: payload.strategyVersion,
    items: payload.sourceBreakdown.map((item) => ({
      sourceId: item.sourceId,
      count: item.count,
    })),
  };
});

function getSourceBreakdown(itemId: string): MedicalSourceBreakdown | undefined {
  return sourceBreakdownByReasoningId.value.get(itemId);
}

const qualityDiagnostics = computed(() => props.authoritativeSearch?.quality ?? null);

const QUALITY_STAGE_LABELS: Record<string, string> = {
  intent_understanding: '需求理解',
  retrieval: '检索召回',
  evidence_selection: '证据筛选',
  summarization: '证据概述',
  none: '当前无明显短板',
};

const qualityMetrics = computed(() => {
  const quality = qualityDiagnostics.value;
  if (!quality) {
    return [];
  }
  return [
    { key: 'intent', label: '需求理解', score: quality.intentUnderstandingScore },
    { key: 'retrieval', label: '检索召回', score: quality.retrievalCoverageScore },
    { key: 'selection', label: '证据筛选', score: quality.evidenceSelectionScore },
    { key: 'summary', label: '概述可读性', score: quality.summarizationReadabilityScore },
  ];
});

function formatQualityPercent(score: number): string {
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}
</script>

<template>
  <div class="reasoning-trace-container" :class="{ 'dark-theme': theme === 'dark' }">
    <div class="header">
      <div class="header-left">
        <span class="pulse-indicator" :class="{ active: isRunning }"></span>
        <h3>实时推理链路追踪</h3>
      </div>
      <div class="stats">
        <span class="stat-item">{{ displayItems.length }} 条记录</span>
        <span class="stat-item">{{ stageOrder.length }} 个阶段</span>
      </div>
    </div>

    <!-- Agent思考状态栏 -->
    <div v-if="thinkingAgents.length > 0" class="thinking-bar">
      <div class="thinking-label">🧠 Agent思考中...</div>
      <div class="thinking-agents">
        <div
          v-for="agent in thinkingAgents"
          :key="agent.agentId"
          class="thinking-agent"
        >
          <span class="agent-icon">{{ getAgentIcon(agent.agentName) }}</span>
          <span class="agent-name">{{ agent.agentName }}</span>
          <div class="thinking-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    </div>

    <div class="kind-filter">
      <span
        v-for="(config, kind) in KIND_CONFIG"
        :key="kind"
        class="kind-badge"
        :style="{ 
          background: config.bgColor, 
          color: config.color,
          boxShadow: `0 0 10px ${config.glowColor}`,
        }"
      >
        {{ config.icon }} {{ config.label }}
      </span>
    </div>

    <div
      v-if="structuredSourceBreakdown"
      class="source-breakdown-card source-breakdown-card--global"
    >
      <div class="source-breakdown-head">
        <strong>权威来源分布（结构化）</strong>
        <span class="source-breakdown-strategy">
          {{ structuredSourceBreakdown.strategyVersion }}
        </span>
      </div>
      <div class="source-breakdown-list">
        <span
          v-for="entry in structuredSourceBreakdown.items"
          :key="`global-${entry.sourceId}`"
          class="source-breakdown-chip"
        >
          {{ entry.sourceId }} x {{ entry.count }}
        </span>
      </div>
    </div>

    <div
      v-if="qualityDiagnostics"
      class="quality-diagnostics-card"
    >
      <div class="source-breakdown-head">
        <strong>检索链路体检</strong>
        <span class="source-breakdown-strategy">
          最弱环节：{{ QUALITY_STAGE_LABELS[qualityDiagnostics.weakestStage] ?? qualityDiagnostics.weakestStage }}
        </span>
      </div>
      <div class="quality-metrics-list">
        <span
          v-for="metric in qualityMetrics"
          :key="metric.key"
          class="source-breakdown-chip"
        >
          {{ metric.label }} {{ formatQualityPercent(metric.score) }}
        </span>
      </div>
      <ul
        v-if="qualityDiagnostics.optimizationHints.length > 0"
        class="quality-hints"
      >
        <li
          v-for="(hint, index) in qualityDiagnostics.optimizationHints"
          :key="`quality-hint-${index}`"
        >
          {{ hint }}
        </li>
      </ul>
    </div>

    <div v-if="displayItems.length === 0" class="empty-state">
      <span class="empty-icon">🔍</span>
      <p>等待推理轨迹...</p>
    </div>

    <div v-else ref="containerRef" class="timeline-container">
      <div v-for="stage in stageOrder" :key="stage" class="stage-group">
        <div class="stage-header" :class="{ active: stage === currentStage }">
          <span class="stage-icon">{{ stage === currentStage ? '▶' : '✓' }}</span>
          <span class="stage-name">{{ STAGE_LABELS[stage as WorkflowStage] ?? stage }}</span>
          <span class="stage-count">{{ stageGroups[stage].length }}</span>
        </div>

        <div class="stage-items">
          <div
            v-for="item in stageGroups[stage]"
            :key="item.id"
            class="trace-item"
            :class="{ 
              expanded: isExpanded(item.id),
              'is-new': item.isNew && !completedItems.has(item.id),
            }"
            @click="toggleExpand(item.id)"
          >
            <div class="item-connector"
            >
              <div class="connector-line"></div>
              <div 
                class="connector-dot" 
                :style="{ 
                  background: KIND_CONFIG[item.kind].color,
                  boxShadow: `0 0 8px ${KIND_CONFIG[item.kind].color}`,
                }"
              ></div>
            </div>

            <div class="item-content"
            >
              <div class="item-header"
              >
                <span 
                  class="item-kind" 
                  :style="{ 
                    background: KIND_CONFIG[item.kind].bgColor, 
                    color: KIND_CONFIG[item.kind].color,
                    boxShadow: `0 0 8px ${KIND_CONFIG[item.kind].glowColor}`,
                  }"
                >
                  {{ KIND_CONFIG[item.kind].icon }} {{ KIND_CONFIG[item.kind].label }}
                </span>
                <span class="item-time">{{ formatTime(item.timestamp) }}</span>
                <span 
                  v-if="item.confidence !== undefined" 
                  class="item-confidence" 
                  :style="{ color: getConfidenceColor(item.confidence) }"
                >
                  置信度: {{ (item.confidence * 100).toFixed(0) }}%
                </span>
                <span v-if="item.agentName" class="item-agent"
                >
                  <span class="agent-mini-icon">{{ getAgentIcon(item.agentName) }}</span>
                  {{ item.agentName }}
                </span>
              </div>

              <p class="item-text" :class="{ 'is-typing': isTyping(item) }"
              >
                {{ getTypewriterText(item) }}
                <span 
                  v-if="showCursor(item)" 
                  class="cursor"
                  :class="{ blink: !isTyping(item) }"
                >▊</span>
              </p>

              <div
                v-if="getSourceBreakdown(item.id)"
                class="source-breakdown-card"
              >
                <div class="source-breakdown-head">
                  <strong>权威来源分布</strong>
                  <span class="source-breakdown-strategy">
                    {{ getSourceBreakdown(item.id)?.strategyVersion }}
                  </span>
                </div>
                <div class="source-breakdown-list">
                  <span
                    v-for="entry in getSourceBreakdown(item.id)?.items"
                    :key="`${item.id}-${entry.sourceId}`"
                    class="source-breakdown-chip"
                  >
                    {{ entry.sourceId }} x {{ entry.count }}
                  </span>
                </div>
              </div>

              <div v-if="isExpanded(item.id) && item.evidence?.length" class="item-evidence"
              >
                <h5>证据来源</h5>
                <ul>
                  <li v-for="(ev, idx) in item.evidence" :key="idx">{{ ev }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reasoning-trace-container {
  background: linear-gradient(135deg, #0a0e1a 0%, #1a1f35 100%);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid rgba(100, 200, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pulse-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4a5568;
  transition: all 0.3s ease;
}

.pulse-indicator.active {
  background: #00ff88;
  box-shadow: 0 0 10px #00ff88, 0 0 20px #00ff88;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.3); }
}

.header h3 {
  margin: 0;
  font-size: 14px;
  color: #e0e6ed;
  text-shadow: 0 0 10px rgba(100, 200, 255, 0.3);
}

.stats {
  display: flex;
  gap: 12px;
}

.stat-item {
  font-size: 11px;
  color: #8b92a8;
  padding: 3px 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* Agent思考状态栏 */
.thinking-bar {
  margin-bottom: 12px;
  padding: 10px 12px;
  background: rgba(100, 200, 255, 0.05);
  border-radius: 8px;
  border: 1px solid rgba(100, 200, 255, 0.15);
}

.thinking-label {
  font-size: 11px;
  color: #64c8ff;
  margin-bottom: 8px;
  font-weight: 600;
}

.thinking-agents {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.thinking-agent {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 20px;
  border: 1px solid rgba(100, 200, 255, 0.2);
}

.agent-icon {
  font-size: 14px;
}

.agent-name {
  font-size: 11px;
  color: #c0c8d8;
}

.thinking-dots {
  display: flex;
  gap: 3px;
}

.thinking-dots span {
  width: 5px;
  height: 5px;
  background: #64c8ff;
  border-radius: 50%;
  animation: thinkingBounce 1.4s ease-in-out infinite both;
}

.thinking-dots span:nth-child(1) { animation-delay: -0.32s; }
.thinking-dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes thinkingBounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

.kind-filter {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.kind-badge {
  font-size: 10px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid transparent;
  transition: all 0.3s ease;
}

.kind-badge:hover {
  transform: translateY(-1px);
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #5a6078;
}

.empty-icon {
  font-size: 32px;
  display: block;
  margin-bottom: 8px;
  opacity: 0.6;
}

.empty-state p {
  margin: 0;
  font-size: 13px;
}

.timeline-container {
  max-height: 400px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(100, 200, 255, 0.3) transparent;
}

.timeline-container::-webkit-scrollbar {
  width: 6px;
}

.timeline-container::-webkit-scrollbar-track {
  background: transparent;
}

.timeline-container::-webkit-scrollbar-thumb {
  background: rgba(100, 200, 255, 0.3);
  border-radius: 3px;
}

.stage-group {
  margin-bottom: 16px;
}

.stage-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  margin-bottom: 8px;
  border-left: 3px solid #4a5568;
}

.stage-header.active {
  background: rgba(100, 200, 255, 0.1);
  border-left-color: #64c8ff;
}

.stage-icon {
  font-size: 10px;
  color: #5a6078;
}

.stage-header.active .stage-icon {
  color: #64c8ff;
  text-shadow: 0 0 10px rgba(100, 200, 255, 0.8);
}

.stage-name {
  font-size: 12px;
  font-weight: 600;
  color: #c0c8d8;
  flex: 1;
}

.stage-count {
  font-size: 10px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: #8b92a8;
}

.stage-items {
  padding-left: 12px;
}

.trace-item {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: 6px;
}

.trace-item:hover {
  background: rgba(100, 200, 255, 0.05);
  margin: 0 -8px;
  padding: 10px 8px;
}

.trace-item.is-new {
  background: rgba(0, 255, 136, 0.05);
  animation: highlightNew 2s ease-out;
}

@keyframes highlightNew {
  0% { background: rgba(0, 255, 136, 0.2); }
  100% { background: rgba(0, 255, 136, 0.05); }
}

.item-connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 16px;
}

.connector-line {
  flex: 1;
  width: 2px;
  background: rgba(100, 200, 255, 0.2);
}

.connector-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.3s ease;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.item-kind {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  font-weight: 600;
  border: 1px solid transparent;
}

.item-time {
  font-size: 10px;
  color: #5a6078;
}

.item-confidence {
  font-size: 10px;
  font-weight: 600;
}

.item-agent {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #8b92a8;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}

.agent-mini-icon {
  font-size: 11px;
}

.item-text {
  margin: 0;
  font-size: 12px;
  color: #e0e6ed;
  line-height: 1.6;
  word-break: break-word;
}

.item-text.is-typing {
  color: #64c8ff;
}

.cursor {
  color: #64c8ff;
  animation: blink 1s step-end infinite;
}

.cursor.blink {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.source-breakdown-card {
  margin-top: 8px;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid rgba(0, 255, 136, 0.28);
  background: rgba(0, 255, 136, 0.06);
}

.source-breakdown-card--global {
  margin-bottom: 10px;
}

.quality-diagnostics-card {
  margin-bottom: 10px;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid rgba(100, 200, 255, 0.3);
  background: rgba(100, 200, 255, 0.08);
}

.source-breakdown-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.source-breakdown-head strong {
  font-size: 11px;
  color: #00ff88;
}

.source-breakdown-strategy {
  font-size: 10px;
  color: #9efad0;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 136, 0.35);
  background: rgba(0, 0, 0, 0.25);
}

.source-breakdown-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.quality-metrics-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.source-breakdown-chip {
  font-size: 10px;
  color: #d6ffee;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 136, 0.3);
  background: rgba(0, 255, 136, 0.12);
}

.quality-hints {
  margin: 8px 0 0;
  padding-left: 16px;
}

.quality-hints li {
  font-size: 11px;
  line-height: 1.5;
  color: #d9ecff;
  margin-bottom: 4px;
}

.item-evidence {
  margin-top: 8px;
  padding: 10px;
  background: rgba(0, 255, 136, 0.05);
  border-radius: 6px;
  border-left: 3px solid #00ff88;
}

.item-evidence h5 {
  margin: 0 0 8px;
  font-size: 11px;
  color: #00ff88;
}

.item-evidence ul {
  margin: 0;
  padding-left: 16px;
}

.item-evidence li {
  font-size: 11px;
  color: #8b92a8;
  margin-bottom: 3px;
}

@media (max-width: 768px) {
  .kind-filter {
    gap: 6px;
  }
  
  .thinking-agents {
    gap: 6px;
  }
  
  .item-header {
    gap: 6px;
  }
}
</style>
