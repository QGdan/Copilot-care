<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import { GraphChart } from 'echarts/charts';
import { LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { init, use, type ECharts } from 'echarts/core';
import type { TriageStreamStageStatus, WorkflowStage } from '@copilot-care/shared/types';
import type { MetricRecord, RiskTrigger } from '../features/governance/model';

use([GraphChart, TooltipComponent, LegendComponent, CanvasRenderer]);

type NodeCategory = 'entry' | 'engine' | 'agent' | 'governance' | 'output';

interface StageRuntimeState {
  status: TriageStreamStageStatus;
  message: string;
  durationMs?: number;
}

interface QueueOverview {
  pending: number;
  reviewing: number;
  approved: number;
  rejected: number;
}

interface Props {
  metrics: MetricRecord[];
  riskTriggers: RiskTrigger[];
  stageRuntime: Record<WorkflowStage, StageRuntimeState>;
  currentStage: WorkflowStage;
  queueOverview: QueueOverview;
}

interface Emits {
  (
    e: 'node-focus',
    payload: {
      nodeId: string;
      label: string;
      stage: WorkflowStage | null;
    },
  ): void;
  (
    e: 'node-hover',
    payload: {
      nodeId: string;
      label: string;
      stage: WorkflowStage | null;
    },
  ): void;
  (e: 'node-hover-leave'): void;
}

interface BlueprintNode {
  id: string;
  label: string;
  category: NodeCategory;
  x: number;
  y: number;
  stages?: WorkflowStage[];
}

interface GraphNodeDatum {
  id: string;
  name: string;
  category: number;
  x: number;
  y: number;
  symbolSize: number;
  status: TriageStreamStageStatus;
  detail: string;
  itemStyle: {
    color: string;
    borderColor: string;
    borderWidth: number;
    shadowColor: string;
    shadowBlur: number;
  };
  label: {
    color: string;
    fontSize: number;
    fontWeight?: 'normal' | 'bold';
  };
}

interface GraphLinkDatum {
  source: string;
  target: string;
  value: string;
  lineStyle: {
    color: string;
    width: number;
    type: 'solid' | 'dashed';
    opacity: number;
    curveness: number;
  };
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const CATEGORY_META: Array<{ key: NodeCategory; name: string; color: string }> = [
  { key: 'entry', name: '入口层', color: '#4a88df' },
  { key: 'engine', name: '推理引擎层', color: '#34b6d5' },
  { key: 'agent', name: 'Agent 协同层', color: '#7b73ef' },
  { key: 'governance', name: '治理审校层', color: '#f06f54' },
  { key: 'output', name: '输出归档层', color: '#4fbf89' },
];

const CATEGORY_INDEX: Record<NodeCategory, number> = CATEGORY_META.reduce(
  (acc, item, index) => {
    acc[item.key] = index;
    return acc;
  },
  {} as Record<NodeCategory, number>,
);

const STATUS_COLORS: Record<TriageStreamStageStatus, string> = {
  pending: '#5f7488',
  running: '#3aa7ff',
  blocked: '#ef6a53',
  done: '#2fbf78',
  failed: '#ef6a53',
  skipped: '#8899ab',
};

const STATUS_LABELS: Record<TriageStreamStageStatus, string> = {
  pending: '待执行',
  running: '执行中',
  blocked: '阻断',
  done: '完成',
  failed: '失败',
  skipped: '跳过',
};

const STAGE_LABELS: Record<WorkflowStage, string> = {
  START: '启动',
  INFO_GATHER: '信息采集',
  RISK_ASSESS: '风险评估',
  ROUTING: '复杂度路由',
  DEBATE: '多 Agent 协同',
  CONSENSUS: '共识收敛',
  REVIEW: '安全复核',
  OUTPUT: '结果输出',
  ESCALATION: '上转处置',
};

const NODE_BLUEPRINTS: BlueprintNode[] = [
  { id: 'api', label: 'API 接入', category: 'entry', x: 10, y: 45, stages: ['START', 'INFO_GATHER'] },
  { id: 'risk', label: '风险引擎', category: 'engine', x: 24, y: 24, stages: ['RISK_ASSESS'] },
  { id: 'router', label: '复杂度路由', category: 'engine', x: 40, y: 24, stages: ['ROUTING'] },
  { id: 'mesh', label: 'Agent 神经网', category: 'agent', x: 56, y: 45, stages: ['DEBATE'] },
  { id: 'cardio', label: '心血管 Agent', category: 'agent', x: 66, y: 20, stages: ['DEBATE'] },
  { id: 'gp', label: '全科 Agent', category: 'agent', x: 72, y: 45, stages: ['DEBATE'] },
  { id: 'metabolic', label: '代谢 Agent', category: 'agent', x: 66, y: 70, stages: ['DEBATE'] },
  { id: 'consensus', label: '共识引擎', category: 'engine', x: 80, y: 45, stages: ['CONSENSUS'] },
  { id: 'safety', label: '安全治理', category: 'governance', x: 90, y: 24, stages: ['REVIEW', 'ESCALATION'] },
  { id: 'output', label: '报告输出', category: 'output', x: 95, y: 68, stages: ['OUTPUT'] },
  { id: 'audit', label: '审计总线', category: 'governance', x: 90, y: 84 },
];

const NODE_LINKS: Array<{
  source: string;
  target: string;
  label: string;
  style?: 'solid' | 'dashed';
}> = [
  { source: 'api', target: 'risk', label: '输入校验' },
  { source: 'risk', target: 'router', label: '风险评分' },
  { source: 'router', target: 'mesh', label: '路由策略' },
  { source: 'mesh', target: 'cardio', label: '并行任务', style: 'dashed' },
  { source: 'mesh', target: 'gp', label: '并行任务', style: 'dashed' },
  { source: 'mesh', target: 'metabolic', label: '并行任务', style: 'dashed' },
  { source: 'cardio', target: 'consensus', label: '意见回流', style: 'dashed' },
  { source: 'gp', target: 'consensus', label: '意见回流', style: 'dashed' },
  { source: 'metabolic', target: 'consensus', label: '意见回流', style: 'dashed' },
  { source: 'consensus', target: 'safety', label: '安全复核' },
  { source: 'safety', target: 'output', label: '结果放行' },
  { source: 'output', target: 'audit', label: '归档审计' },
  { source: 'audit', target: 'risk', label: '闭环反馈', style: 'dashed' },
];

const chartRef = ref<HTMLDivElement | null>(null);
let chartInstance: ECharts | null = null;
const pinnedNodeId = ref<string | null>(null);
const hoveredNodeId = ref<string | null>(null);

const focusedNodeId = computed<string | null>(() => {
  return hoveredNodeId.value ?? pinnedNodeId.value;
});

const criticalRiskCount = computed(() => {
  return props.riskTriggers.filter((trigger) => {
    return !trigger.acknowledged
      && (trigger.severity === 'critical' || trigger.severity === 'high');
  }).length;
});

const breachedMetricCount = computed(() => {
  return props.metrics.filter((metric) => metric.status === 'breached').length;
});

const queuePressureCount = computed(() => {
  return props.queueOverview.pending + props.queueOverview.reviewing;
});

const currentStageLabel = computed(() => {
  return STAGE_LABELS[props.currentStage];
});

const closedLoopRate = computed(() => {
  const total = props.queueOverview.pending
    + props.queueOverview.reviewing
    + props.queueOverview.approved
    + props.queueOverview.rejected;
  if (total === 0) {
    return 0;
  }
  return Math.round(((props.queueOverview.approved + props.queueOverview.rejected) / total) * 100);
});

function resolveNodeStatusFromStages(stages?: WorkflowStage[]): TriageStreamStageStatus {
  if (!stages || stages.length === 0) {
    if (criticalRiskCount.value > 0 || breachedMetricCount.value > 0) {
      return 'running';
    }
    if (closedLoopRate.value >= 80) {
      return 'done';
    }
    return 'pending';
  }

  const statuses = stages.map((stage) => props.stageRuntime[stage]?.status ?? 'pending');
  if (statuses.some((status) => status === 'blocked' || status === 'failed')) return 'blocked';
  if (statuses.some((status) => status === 'running')) return 'running';
  if (statuses.every((status) => status === 'done' || status === 'skipped')) return 'done';
  return 'pending';
}

function resolveNodeDetail(node: BlueprintNode, status: TriageStreamStageStatus): string {
  if (node.id === 'audit') {
    return `待确认触发器 ${props.riskTriggers.filter((item) => !item.acknowledged).length} 条`;
  }
  if (node.id === 'mesh') {
    return `执行队列 ${queuePressureCount.value} 项`;
  }
  if (!node.stages || node.stages.length === 0) {
    return STATUS_LABELS[status];
  }

  const details = node.stages.map((stage) => {
    const runtime = props.stageRuntime[stage];
    if (!runtime) return null;
    return `${STAGE_LABELS[stage]}：${runtime.message}`;
  }).filter(Boolean);
  return details[0] ?? STATUS_LABELS[status];
}

function toShadowColor(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return hexColor;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const graphNodeMap = computed(() => {
  const map = new Map<string, GraphNodeDatum>();
  NODE_BLUEPRINTS.forEach((node) => {
    const status = resolveNodeStatusFromStages(node.stages);
    const baseColor = STATUS_COLORS[status];
    const isCurrent = node.stages?.includes(props.currentStage) ?? false;
    const isFocused = focusedNodeId.value === node.id;
    const sizeBias = node.category === 'agent' ? 0 : 4;

    map.set(node.id, {
      id: node.id,
      name: node.label,
      category: CATEGORY_INDEX[node.category],
      x: node.x,
      y: node.y,
      symbolSize: isCurrent || isFocused ? 64 + sizeBias : 52 + sizeBias,
      status,
      detail: resolveNodeDetail(node, status),
      itemStyle: {
        color: baseColor,
        borderColor: isCurrent || isFocused ? '#dff6ff' : '#0f172a',
        borderWidth: isCurrent || isFocused ? 2.6 : 1.2,
        shadowColor: toShadowColor(baseColor, isCurrent || isFocused ? 0.85 : 0.58),
        shadowBlur: isCurrent || isFocused ? 24 : 12,
      },
      label: {
        color: '#e6f1ff',
        fontSize: 11,
        fontWeight: isCurrent || isFocused ? 'bold' : 'normal',
      },
    });
  });
  return map;
});

const graphNodes = computed(() => Array.from(graphNodeMap.value.values()));

const graphLinks = computed<GraphLinkDatum[]>(() => {
  return NODE_LINKS.map((link) => {
    const sourceStatus = graphNodeMap.value.get(link.source)?.status ?? 'pending';
    const targetStatus = graphNodeMap.value.get(link.target)?.status ?? 'pending';

    let color = '#6b88a4';
    if (sourceStatus === 'blocked' || targetStatus === 'blocked') {
      color = STATUS_COLORS.blocked;
    } else if (sourceStatus === 'running' || targetStatus === 'running') {
      color = STATUS_COLORS.running;
    } else if (sourceStatus === 'done' && targetStatus === 'done') {
      color = STATUS_COLORS.done;
    }

    return {
      source: link.source,
      target: link.target,
      value: link.label,
      lineStyle: {
        color,
        width: link.style === 'dashed' ? 1.8 : 2.2,
        type: link.style ?? 'solid',
        opacity: 0.8,
        curveness: link.style === 'dashed' ? 0.12 : 0.04,
      },
    };
  });
});

const chartOption = computed<EChartsOption>(() => {
  return {
    backgroundColor: 'transparent',
    animationDurationUpdate: 420,
    legend: {
      show: true,
      top: 8,
      left: 'center',
      selectedMode: false,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#9eb9d2', fontSize: 11 },
      data: CATEGORY_META.map((item) => item.name),
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(8, 18, 31, 0.94)',
      borderColor: '#36516d',
      textStyle: { color: '#e1efff', fontSize: 12 },
      formatter: (params: any) => {
        if (params.dataType === 'node' && params.data) {
          const node = params.data as GraphNodeDatum;
          return `<div style="min-width:180px;"><div style="font-weight:600;margin-bottom:4px;">${node.name}</div><div style="color:#8fb0cf;">状态：${STATUS_LABELS[node.status]}</div><div style="margin-top:4px;color:#9bb8d6;">${node.detail}</div></div>`;
        }
        if (params.dataType === 'edge' && params.data) {
          const edge = params.data as GraphLinkDatum;
          return `<div>链路：${edge.value}</div>`;
        }
        return '';
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'none',
        roam: true,
        draggable: true,
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 7,
        lineStyle: {
          color: '#6a85a0',
          width: 1.6,
          opacity: 0.75,
          curveness: 0.08,
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 2.8, opacity: 0.96 },
          itemStyle: { shadowBlur: 28, shadowColor: 'rgba(110, 202, 255, 0.54)' },
        },
        label: {
          show: true,
          position: 'bottom',
          color: '#d8e9fb',
          fontSize: 11,
          distance: 6,
        },
        categories: CATEGORY_META.map((item) => ({
          name: item.name,
          itemStyle: { color: item.color },
        })),
        data: graphNodes.value as unknown as Record<string, unknown>[],
        links: graphLinks.value as unknown as Record<string, unknown>[],
      },
    ],
  };
});

function renderChart(replace: boolean = true): void {
  if (!chartInstance) return;
  chartInstance.setOption(chartOption.value, replace);
}

function handleResize(): void {
  chartInstance?.resize();
}

function initChart(): void {
  if (!chartRef.value) return;
  chartInstance = init(chartRef.value, undefined, { renderer: 'canvas' });
  renderChart(true);

  chartInstance.on('click', (params: any) => {
    if (params.dataType !== 'node' || !params.data?.id) return;
    const nodeId = String(params.data.id);
    const nodeMeta = NODE_BLUEPRINTS.find((item) => item.id === nodeId);
    pinnedNodeId.value = nodeId;
    emit('node-focus', {
      nodeId,
      label: nodeMeta?.label ?? nodeId,
      stage: nodeMeta?.stages?.[0] ?? null,
    });
  });

  chartInstance.on('mouseover', (params: any) => {
    if (params.dataType !== 'node' || !params.data?.id) return;
    const nodeId = String(params.data.id);
    const nodeMeta = NODE_BLUEPRINTS.find((item) => item.id === nodeId);
    hoveredNodeId.value = nodeId;
    emit('node-hover', {
      nodeId,
      label: nodeMeta?.label ?? nodeId,
      stage: nodeMeta?.stages?.[0] ?? null,
    });
  });

  chartInstance.on('mouseout', (params: any) => {
    if (params.dataType !== 'node') return;
    hoveredNodeId.value = null;
    emit('node-hover-leave');
  });

  chartInstance.on('globalout', () => {
    hoveredNodeId.value = null;
    emit('node-hover-leave');
  });

  window.addEventListener('resize', handleResize);
}

watch(chartOption, () => {
  renderChart(true);
}, { deep: true });

onMounted(() => {
  nextTick(() => {
    initChart();
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
});
</script>

<template>
  <section class="execution-neural-topology">
    <header class="topology-header">
      <div class="header-copy">
        <h3>后端执行神经网络拓扑</h3>
        <p>映射输入质量校验、复杂度路由、多 Agent 协同与安全治理的完整闭环。</p>
      </div>
      <div class="header-chips">
        <span class="chip">当前阶段：{{ currentStageLabel }}</span>
        <span class="chip">闭环率 {{ closedLoopRate }}%</span>
      </div>
    </header>

    <div class="signal-strip">
      <article class="signal-card">
        <small>高危触发器</small>
        <strong>{{ criticalRiskCount }}</strong>
      </article>
      <article class="signal-card">
        <small>超阈值指标</small>
        <strong>{{ breachedMetricCount }}</strong>
      </article>
      <article class="signal-card">
        <small>执行队列压强</small>
        <strong>{{ queuePressureCount }}</strong>
      </article>
      <article class="signal-card">
        <small>已闭环病例</small>
        <strong>{{ queueOverview.approved + queueOverview.rejected }}</strong>
      </article>
    </div>

    <div class="topology-workbench">
      <div ref="chartRef" class="topology-chart" />
      <aside class="pulse-panel">
        <h4>执行脉冲</h4>
        <ul>
          <li>
            <span>风险引擎</span>
            <strong>{{ stageRuntime.RISK_ASSESS.message }}</strong>
          </li>
          <li>
            <span>复杂度路由</span>
            <strong>{{ stageRuntime.ROUTING.message }}</strong>
          </li>
          <li>
            <span>多 Agent 协同</span>
            <strong>{{ stageRuntime.DEBATE.message }}</strong>
          </li>
          <li>
            <span>安全治理</span>
            <strong>{{ stageRuntime.REVIEW.message }}</strong>
          </li>
        </ul>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.execution-neural-topology {
  border: 1px solid rgba(94, 151, 199, 0.28);
  border-radius: 14px;
  background:
    radial-gradient(circle at 100% 0%, rgba(53, 138, 189, 0.2), transparent 42%),
    radial-gradient(circle at 0% 100%, rgba(58, 171, 158, 0.14), transparent 48%),
    linear-gradient(150deg, #091827 0%, #102236 54%, #0f2132 100%);
  box-shadow: 0 14px 28px rgba(6, 19, 34, 0.3);
  overflow: hidden;
}

.topology-header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(91, 130, 166, 0.24);
}

.header-copy h3 {
  margin: 0;
  color: #e8f4ff;
  font-size: 16px;
}

.header-copy p {
  margin: 4px 0 0;
  color: #a5bfd7;
  font-size: 12px;
}

.header-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.chip {
  border: 1px solid rgba(118, 151, 182, 0.45);
  background: rgba(16, 39, 60, 0.76);
  border-radius: 999px;
  color: #b4cde3;
  font-size: 11px;
  padding: 3px 10px;
}

.signal-strip {
  padding: 10px 16px 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.signal-card {
  border: 1px solid rgba(92, 128, 160, 0.35);
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(12, 32, 50, 0.72);
  display: grid;
  gap: 4px;
}

.signal-card small {
  color: #96b4cf;
  font-size: 11px;
}

.signal-card strong {
  color: #e8f4ff;
  font-size: 18px;
  line-height: 1;
}

.topology-workbench {
  padding: 10px 16px 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 12px;
}

.topology-chart {
  min-height: 360px;
  border: 1px solid rgba(96, 134, 166, 0.35);
  border-radius: 12px;
  background:
    radial-gradient(circle at 0% 0%, rgba(41, 94, 135, 0.22), transparent 42%),
    radial-gradient(circle at 100% 100%, rgba(48, 123, 112, 0.2), transparent 46%),
    rgba(10, 26, 41, 0.74);
}

.pulse-panel {
  border: 1px solid rgba(96, 134, 166, 0.35);
  border-radius: 12px;
  background: rgba(10, 28, 46, 0.84);
  padding: 10px;
}

.pulse-panel h4 {
  margin: 0 0 8px;
  color: #e1efff;
  font-size: 13px;
}

.pulse-panel ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.pulse-panel li {
  border: 1px solid rgba(106, 140, 169, 0.45);
  border-radius: 8px;
  background: rgba(12, 38, 58, 0.76);
  padding: 7px 8px;
  display: grid;
  gap: 4px;
}

.pulse-panel span {
  color: #99b7d3;
  font-size: 11px;
}

.pulse-panel strong {
  color: #e4f2ff;
  font-size: 12px;
  line-height: 1.4;
}

@media (max-width: 1280px) {
  .topology-workbench {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .topology-header {
    flex-direction: column;
  }

  .header-chips {
    justify-content: flex-start;
  }

  .signal-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .signal-strip {
    grid-template-columns: 1fr;
  }
}
</style>
