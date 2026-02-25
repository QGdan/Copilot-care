<script setup lang="ts">
import { computed } from 'vue';
import type { WorkflowStage, TriageStreamStageStatus } from '@copilot-care/shared/types';

interface StageRuntimeState {
  status: TriageStreamStageStatus;
  message: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
}

interface Props {
  stageRuntime: Record<WorkflowStage, StageRuntimeState>;
  currentStage?: WorkflowStage;
  hasRedFlag?: boolean;
  hasEscalation?: boolean;
}

interface Emits {
  (e: 'stage-click', stage: WorkflowStage): void;
  (e: 'stage-hover', stage: WorkflowStage): void;
  (e: 'stage-hover-leave'): void;
}

type LayerStatus = 'pending' | 'running' | 'blocked' | 'done';

interface LayerDefinition {
  id: string;
  title: string;
  subtitle: string;
  owner: string;
  stages: WorkflowStage[];
}

interface LayerRow extends LayerDefinition {
  status: LayerStatus;
  active: boolean;
  progress: number;
  health: number;
  message: string;
  actionHint: string;
  priorityScore: number;
  stageItems: Array<{
    stage: WorkflowStage;
    label: string;
    status: LayerStatus;
    message: string;
  }>;
}

const props = withDefaults(defineProps<Props>(), {
  currentStage: 'START',
  hasRedFlag: false,
  hasEscalation: false,
});

const emit = defineEmits<Emits>();

const STAGE_LABELS: Record<WorkflowStage, string> = {
  START: '启动',
  INFO_GATHER: '信息采集',
  RISK_ASSESS: '风险评估',
  ROUTING: '复杂度路由',
  DEBATE: '协同推理',
  CONSENSUS: '共识收敛',
  REVIEW: '安全复核',
  OUTPUT: '结果输出',
  ESCALATION: '上转处置',
};

const LAYERS: LayerDefinition[] = [
  {
    id: 'L1',
    title: '输入准备层',
    subtitle: '主诉与基础信息采集',
    owner: '接诊助手',
    stages: ['START', 'INFO_GATHER'],
  },
  {
    id: 'L2',
    title: '风险识别层',
    subtitle: '规则与红旗信号判定',
    owner: '风险引擎',
    stages: ['RISK_ASSESS'],
  },
  {
    id: 'L3',
    title: '复杂度路由层',
    subtitle: '专科与协作模式分流',
    owner: '路由引擎',
    stages: ['ROUTING'],
  },
  {
    id: 'L4',
    title: '多Agent协同层',
    subtitle: '并行意见与分歧对齐',
    owner: '总Agent',
    stages: ['DEBATE'],
  },
  {
    id: 'L5',
    title: '共识收敛层',
    subtitle: '结论合成与置信约束',
    owner: '共识模块',
    stages: ['CONSENSUS'],
  },
  {
    id: 'L6',
    title: '安全治理层',
    subtitle: '审校复核与上转边界',
    owner: '安全审校',
    stages: ['REVIEW', 'ESCALATION'],
  },
  {
    id: 'L7',
    title: '输出归档层',
    subtitle: '结论落地与报告闭环',
    owner: '输出服务',
    stages: ['OUTPUT'],
  },
];

const STATUS_PRIORITY: Record<LayerStatus, number> = {
  blocked: 4,
  running: 3,
  pending: 2,
  done: 1,
};

const STATUS_SCORES: Record<LayerStatus, number> = {
  blocked: 12,
  running: 68,
  pending: 34,
  done: 100,
};

function normalizeStatus(status: TriageStreamStageStatus): LayerStatus {
  if (status === 'blocked' || status === 'failed') return 'blocked';
  if (status === 'running') return 'running';
  if (status === 'done' || status === 'skipped') return 'done';
  return 'pending';
}

function resolveLayerStatus(stages: WorkflowStage[]): LayerStatus {
  let result: LayerStatus = 'done';
  stages.forEach((stage) => {
    const runtime = props.stageRuntime[stage];
    const status = runtime ? normalizeStatus(runtime.status) : 'pending';
    if (STATUS_PRIORITY[status] > STATUS_PRIORITY[result]) {
      result = status;
    }
  });
  return result;
}

function calculatePriority(layer: LayerRow): number {
  let score = 100 - layer.health;
  if (layer.status === 'blocked') score += 65;
  if (layer.status === 'running') score += 30;
  if (layer.active) score += 22;
  if (layer.id === 'L6' && (props.hasEscalation || props.hasRedFlag)) score += 38;
  return Math.round(score);
}

function resolveActionHint(layer: Pick<LayerRow, 'status' | 'title'>): string {
  if (layer.status === 'blocked') {
    return `${layer.title}存在阻断，建议补齐输入并触发复核回路。`;
  }
  if (layer.status === 'running') {
    return `${layer.title}正在执行，建议保持同层闭环并监测超时。`;
  }
  if (layer.status === 'pending') {
    return `${layer.title}等待上游就绪，建议提前准备下一跳参数。`;
  }
  return `${layer.title}已完成，可推进至下一层。`;
}

function resolveStatusLabel(status: LayerStatus): string {
  if (status === 'blocked') return '阻断';
  if (status === 'running') return '执行中';
  if (status === 'done') return '已完成';
  return '待执行';
}

const layerRows = computed<LayerRow[]>(() => {
  return LAYERS.map((layer) => {
    const stageItems = layer.stages.map((stage) => {
      const runtime = props.stageRuntime[stage];
      const normalizedStatus = runtime ? normalizeStatus(runtime.status) : 'pending';
      return {
        stage,
        label: STAGE_LABELS[stage],
        status: normalizedStatus,
        message: runtime?.message?.trim() || '等待执行',
      };
    });

    const status = resolveLayerStatus(layer.stages);
    const active = layer.stages.includes(props.currentStage);
    const doneCount = stageItems.filter((item) => item.status === 'done').length;
    const progress = Math.round((doneCount / layer.stages.length) * 100);
    const averageScore = stageItems.reduce((sum, item) => {
      return sum + STATUS_SCORES[item.status];
    }, 0) / layer.stages.length;
    const health = Math.max(0, Math.min(100, Math.round(averageScore)));
    const message = stageItems.find((item) => item.message.length > 0)?.message || '等待执行';
    const row: LayerRow = {
      ...layer,
      status,
      active,
      progress,
      health,
      message,
      actionHint: '',
      priorityScore: 0,
      stageItems,
    };
    row.actionHint = resolveActionHint(row);
    row.priorityScore = calculatePriority(row);
    return row;
  });
});

const totalStageCount = computed(() => LAYERS.reduce((count, layer) => count + layer.stages.length, 0));

const doneStageCount = computed(() => {
  return layerRows.value.reduce((count, layer) => {
    return count + layer.stageItems.filter((item) => item.status === 'done').length;
  }, 0);
});

const progressPercent = computed(() => {
  return Math.round((doneStageCount.value / Math.max(1, totalStageCount.value)) * 100);
});

const healthScore = computed(() => {
  const total = layerRows.value.reduce((sum, layer) => sum + layer.health, 0);
  return Math.round(total / Math.max(1, layerRows.value.length));
});

const blockedLayerCount = computed(() => {
  return layerRows.value.filter((layer) => layer.status === 'blocked').length;
});

const currentLayer = computed(() => {
  return layerRows.value.find((layer) => layer.active) ?? null;
});

const interventionQueue = computed(() => {
  return layerRows.value
    .filter((layer) => layer.status === 'blocked' || layer.status === 'running')
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 3);
});

const strategyHint = computed(() => {
  if (props.hasRedFlag || props.hasEscalation) {
    return '高风险分支已激活：优先推进安全治理层并预置线下转诊方案。';
  }
  if (blockedLayerCount.value > 0) {
    return '当前存在阻断层：建议先清理阻断，再继续推进后续工作流。';
  }
  if (currentLayer.value) {
    return `当前主执行层：${currentLayer.value.title}，建议保持同层闭环后再切换。`;
  }
  return '等待会诊启动。';
});

function handleLayerClick(stage: WorkflowStage): void {
  emit('stage-click', stage);
}

function handleStageClick(stage: WorkflowStage): void {
  emit('stage-click', stage);
}

function handleStageHover(stage: WorkflowStage): void {
  emit('stage-hover', stage);
}

function handleStageHoverLeave(): void {
  emit('stage-hover-leave');
}
</script>

<template>
  <section class="workflow-layer-matrix">
    <header class="matrix-header">
      <div class="header-copy">
        <h3>七层工作流模块</h3>
        <p>{{ strategyHint }}</p>
      </div>
      <div class="header-score">
        <strong>{{ progressPercent }}%</strong>
        <small>总完成度</small>
      </div>
    </header>

    <div class="ops-strip">
      <article class="ops-card">
        <small>完成度</small>
        <strong>{{ progressPercent }}%</strong>
      </article>
      <article class="ops-card">
        <small>流程健康度</small>
        <strong>{{ healthScore }}%</strong>
      </article>
      <article class="ops-card">
        <small>阻断层数</small>
        <strong>{{ blockedLayerCount }}</strong>
      </article>
    </div>

    <div class="progress-track">
      <div class="progress-fill" :style="{ width: `${progressPercent}%` }" />
    </div>

    <div class="layer-grid">
      <article
        v-for="layer in layerRows"
        :key="layer.id"
        class="layer-card"
        :class="[layer.status, { active: layer.active }]"
        role="button"
        tabindex="0"
        :aria-label="`${layer.title}，状态${resolveStatusLabel(layer.status)}`"
        @click="handleLayerClick(layer.stages[0])"
        @mouseenter="handleStageHover(layer.stages[0])"
        @mouseleave="handleStageHoverLeave"
        @focus="handleStageHover(layer.stages[0])"
        @blur="handleStageHoverLeave"
        @keydown.enter.prevent="handleLayerClick(layer.stages[0])"
        @keydown.space.prevent="handleLayerClick(layer.stages[0])"
      >
        <div class="layer-head">
          <span>{{ layer.id }}</span>
          <strong>{{ layer.title }}</strong>
          <em>{{ resolveStatusLabel(layer.status) }}</em>
        </div>
        <p class="layer-subtitle">{{ layer.subtitle }}</p>
        <p class="layer-owner">责任模块：{{ layer.owner }}</p>
        <div class="layer-metrics">
          <span>进度 {{ layer.progress }}%</span>
          <span>健康 {{ layer.health }}%</span>
        </div>
        <div class="stage-row">
          <button
            v-for="stage in layer.stageItems"
            :key="stage.stage"
            type="button"
            class="stage-pill"
            :class="stage.status"
            @click.stop="handleStageClick(stage.stage)"
            @mouseenter.stop="handleStageHover(stage.stage)"
            @mouseleave.stop="handleStageHoverLeave"
            @focus.stop="handleStageHover(stage.stage)"
            @blur.stop="handleStageHoverLeave"
          >
            {{ stage.label }}
          </button>
        </div>
        <p class="layer-message">{{ layer.message }}</p>
        <p class="layer-action">{{ layer.actionHint }}</p>
      </article>
    </div>

    <section class="intervention-board">
      <header>
        <h4>干预优先队列</h4>
        <span>{{ interventionQueue.length }}项</span>
      </header>
      <button
        v-for="layer in interventionQueue"
        :key="layer.id"
        type="button"
        class="queue-item"
        :class="layer.status"
        @click="handleLayerClick(layer.stages[0])"
        @mouseenter="handleStageHover(layer.stages[0])"
        @mouseleave="handleStageHoverLeave"
        @focus="handleStageHover(layer.stages[0])"
        @blur="handleStageHoverLeave"
      >
        <strong>{{ layer.title }}</strong>
        <span>优先级 {{ layer.priorityScore }}</span>
      </button>
      <p v-if="interventionQueue.length === 0" class="queue-empty">
        当前无高优先级干预项，建议保持现有节奏。
      </p>
    </section>
  </section>
</template>

<style scoped>
.workflow-layer-matrix {
  border: 1px solid #d3deeb;
  border-radius: 12px;
  background:
    radial-gradient(circle at 0% 0%, rgba(224, 244, 255, 0.72), transparent 42%),
    radial-gradient(circle at 100% 100%, rgba(229, 247, 236, 0.58), transparent 46%),
    #ffffff;
  padding: 12px;
  margin-bottom: 12px;
}

.matrix-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.header-copy h3 {
  margin: 0;
  font-size: 15px;
  color: #1d3f5b;
}

.header-copy p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #4a6782;
  line-height: 1.45;
}

.header-score {
  text-align: right;
}

.header-score strong {
  font-size: 18px;
  color: #136579;
}

.header-score small {
  display: block;
  color: #6a859d;
  font-size: 11px;
}

.ops-strip {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.ops-card {
  border: 1px solid #d4e0ec;
  border-radius: 10px;
  background: #f8fbff;
  padding: 8px;
  display: grid;
  gap: 4px;
}

.ops-card small {
  color: #6a859d;
  font-size: 11px;
}

.ops-card strong {
  color: #164c6a;
  font-size: 17px;
  line-height: 1;
}

.progress-track {
  margin: 10px 0 12px;
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: #d8e4ef;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #1f7b80 0%, #2e9156 100%);
  transition: width 220ms ease;
}

.layer-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.layer-card {
  border: 1px solid #d0ddeb;
  border-radius: 10px;
  background: #f8fbff;
  padding: 8px;
  text-align: left;
  cursor: pointer;
  display: grid;
  gap: 6px;
}

.layer-card:focus-visible {
  outline: 2px solid #2f7fb4;
  outline-offset: 2px;
}

.layer-card.active {
  border-color: #1f7b80;
  box-shadow: 0 0 0 1px rgba(31, 123, 128, 0.24);
}

.layer-card.running {
  background: #e9f5ff;
  border-color: #9fc4e7;
}

.layer-card.done {
  background: #eef9f2;
  border-color: #a8d7bc;
}

.layer-card.blocked {
  background: #fff1ed;
  border-color: #efb8ac;
}

.layer-head {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.layer-head span {
  font-size: 10px;
  color: #6d8399;
}

.layer-head strong {
  font-size: 12px;
  color: #234b69;
}

.layer-head em {
  margin-left: auto;
  color: #5d7a94;
  font-size: 10px;
  font-style: normal;
}

.layer-subtitle {
  margin: 0;
  font-size: 11px;
  color: #5a7690;
}

.layer-owner {
  margin: 0;
  font-size: 11px;
  color: #4e6f8a;
}

.layer-metrics {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #3d617f;
  font-size: 11px;
}

.stage-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.stage-pill {
  border: 1px solid #cfdceb;
  border-radius: 999px;
  background: #ffffff;
  color: #4f6d88;
  font-size: 10px;
  padding: 1px 7px;
  cursor: pointer;
}

.stage-pill:focus-visible {
  outline: 2px solid #2f7fb4;
  outline-offset: 1px;
}

.stage-pill.running {
  border-color: #90c5ea;
  color: #266490;
}

.stage-pill.done {
  border-color: #93cfa7;
  color: #277041;
}

.stage-pill.blocked {
  border-color: #e9a398;
  color: #8f3527;
}

.layer-message {
  margin: 0;
  font-size: 11px;
  color: #33556f;
  line-height: 1.4;
}

.layer-action {
  margin: 0;
  font-size: 11px;
  color: #2d6179;
  line-height: 1.4;
}

.intervention-board {
  margin-top: 10px;
  border: 1px solid #d3deea;
  border-radius: 10px;
  background: #f9fcff;
  padding: 8px;
  display: grid;
  gap: 6px;
}

.intervention-board header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.intervention-board h4 {
  margin: 0;
  font-size: 13px;
  color: #244764;
}

.intervention-board span {
  color: #5d7b94;
  font-size: 11px;
}

.queue-item {
  border: 1px solid #cfdbea;
  border-radius: 8px;
  background: #ffffff;
  padding: 6px 8px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.queue-item:focus-visible {
  outline: 2px solid #2f7fb4;
  outline-offset: 1px;
}

.queue-item strong {
  color: #244764;
  font-size: 12px;
}

.queue-item span {
  color: #58748b;
  font-size: 10px;
}

.queue-item.running {
  border-color: #9fc4e7;
}

.queue-item.blocked {
  border-color: #efb8ac;
}

.queue-empty {
  margin: 0;
  font-size: 12px;
  color: #607d95;
}

@media (max-width: 1320px) {
  .layer-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .ops-strip {
    grid-template-columns: 1fr;
  }

  .layer-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
