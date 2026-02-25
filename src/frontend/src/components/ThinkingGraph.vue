<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import { GraphChart } from 'echarts/charts';
import { LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { init, use, type ECharts } from 'echarts/core';
import type {
  OrchestrationGraphEdge,
  OrchestrationGraphNode,
  OrchestrationTask,
  OrchestrationTaskStatus,
} from '@copilot-care/shared/types';
import type { ChartDensity, VisualizationState } from '../types/visualization';

use([GraphChart, TooltipComponent, LegendComponent, CanvasRenderer]);

type SourceKind = 'pending' | 'rule' | 'model';
type IntegrationMode = 'waiting' | 'syncing' | 'rule' | 'model';
type LayoutMode = 'force' | 'circular';
type GraphPreset = 'panorama' | 'execution' | 'safety';
type TaskStatusFilter = 'all' | OrchestrationTaskStatus;
type ProviderFilter = 'all' | string;

interface FlatTask {
  taskId: string;
  roleId: string;
  roleName: string;
  objective: string;
  status: OrchestrationTaskStatus;
  progress: number;
  latestUpdate?: string;
  parentTaskId?: string;
  provider?: string;
  dependencies?: string[];
}

interface ThinkingGraphProps {
  nodes?: OrchestrationGraphNode[];
  edges?: OrchestrationGraphEdge[];
  tasks?: OrchestrationTask[];
  phaseText?: string;
  sourceText?: string;
  sourceKind?: SourceKind;
  updatedAtText?: string;
  summary?: string;
  activeTaskHint?: string;
  integrationText?: string;
  integrationMode?: IntegrationMode;
  isRunning?: boolean;
  compact?: boolean;
  state?: VisualizationState;
  density?: ChartDensity;
}

interface GraphNodeDatum {
  id: string;
  name: string;
  category: number;
  symbol?: string;
  symbolSize: number;
  value: number;
  detail?: string;
  status?: OrchestrationTaskStatus;
  provider?: string;
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
  value?: string;
  lineStyle: {
    color: string;
    width: number;
    type: 'solid' | 'dashed';
    curveness: number;
    opacity?: number;
  };
}

const props = withDefaults(defineProps<ThinkingGraphProps>(), {
  nodes: () => [],
  edges: () => [],
  tasks: () => [],
  phaseText: '未启动',
  sourceText: '待判定',
  sourceKind: 'pending',
  updatedAtText: '--:--:--',
  summary: '等待总Agent分配任务...',
  activeTaskHint: '等待总Agent分配任务...',
  integrationText: '等待会诊启动。',
  integrationMode: 'waiting',
  isRunning: false,
  compact: false,
  state: 'idle',
  density: 'comfortable',
});

const emit = defineEmits<{ (e: 'node-click', nodeId: string): void }>();

const STATUS_LABELS: Record<OrchestrationTaskStatus, string> = {
  pending: '待执行',
  running: '进行中',
  done: '已完成',
  blocked: '阻断',
};

const STATUS_COLORS: Record<OrchestrationTaskStatus, string> = {
  pending: '#6f879f',
  running: '#3aa7ff',
  done: '#2fbf78',
  blocked: '#ef6a53',
};

const INTEGRATION_MODE_LABELS: Record<IntegrationMode, string> = {
  waiting: '等待中',
  syncing: '同步中',
  rule: '规则图谱',
  model: '模型图谱',
};

const PRESET_LABELS: Record<GraphPreset, string> = {
  panorama: '全景视图',
  execution: '执行压测',
  safety: '安全巡检',
};
const GRAPH_PRESETS: GraphPreset[] = ['panorama', 'execution', 'safety'];

const CATEGORY_META = [
  { key: 'input', name: '输入', color: '#4a88df' },
  { key: 'stage', name: '流程', color: '#34b6d5' },
  { key: 'decision', name: '决策', color: '#16a39f' },
  { key: 'evidence', name: '证据', color: '#56b26e' },
  { key: 'risk', name: '风险', color: '#f06f54' },
  { key: 'output', name: '输出', color: '#5f8ed8' },
  { key: 'agent', name: 'Agent', color: '#7b73ef' },
  { key: 'coordinator', name: '总Agent', color: '#0ea5e9' },
] as const;

type CategoryKey = (typeof CATEGORY_META)[number]['key'];

const CATEGORY_INDEX: Record<CategoryKey, number> = CATEGORY_META.reduce(
  (acc, item, index) => {
    acc[item.key] = index;
    return acc;
  },
  {} as Record<CategoryKey, number>,
);

const chartRef = ref<HTMLDivElement | null>(null);
let chartInstance: ECharts | null = null;

const statusFilter = ref<TaskStatusFilter>('all');
const providerFilter = ref<ProviderFilter>('all');
const searchKeyword = ref('');
const focusedTaskId = ref<string | null>(null);
const layoutMode = ref<LayoutMode>('force');
const showCriticalPath = ref(false);
const autoFocusRunningTask = ref(true);
const graphPreset = ref<GraphPreset>('panorama');

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function applyAlpha(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return hexColor;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isCoordinatorTask(task: Pick<FlatTask, 'roleId' | 'roleName'>): boolean {
  const text = `${task.roleId} ${task.roleName}`.toLowerCase();
  return text.includes('coordinator') || text.includes('chief');
}

function resolveNodeCategory(kind: OrchestrationGraphNode['kind']): CategoryKey {
  if (kind === 'input') return 'input';
  if (kind === 'stage') return 'stage';
  if (kind === 'decision') return 'decision';
  if (kind === 'evidence') return 'evidence';
  if (kind === 'risk') return 'risk';
  if (kind === 'output') return 'output';
  return 'agent';
}

function resolveTaskCategory(task: FlatTask): CategoryKey {
  if (isCoordinatorTask(task)) return 'coordinator';
  if (task.roleId.toLowerCase().includes('safety')) return 'risk';
  return 'agent';
}

function resolveTaskSymbol(status: OrchestrationTaskStatus): string {
  if (status === 'running') return 'diamond';
  if (status === 'done') return 'roundRect';
  if (status === 'blocked') return 'triangle';
  return 'circle';
}

function flattenTasks(tasks: OrchestrationTask[]): FlatTask[] {
  const result: FlatTask[] = [];
  const visited = new Set<string>();

  const visit = (task: OrchestrationTask, parentTaskId?: string): void => {
    if (visited.has(task.taskId)) return;
    visited.add(task.taskId);

    result.push({
      taskId: task.taskId,
      roleId: task.roleId,
      roleName: task.roleName,
      objective: task.objective,
      status: task.status,
      progress: clampProgress(task.progress),
      latestUpdate: task.latestUpdate,
      parentTaskId: task.parentTaskId ?? parentTaskId,
      provider: task.provider,
      dependencies: task.dependencies,
    });

    task.subTasks?.forEach((subTask) => {
      visit(subTask, task.taskId);
    });
  };

  tasks.forEach((task) => visit(task, task.parentTaskId));
  return result;
}

function formatTaskStatus(statusValue: OrchestrationTaskStatus): string {
  return STATUS_LABELS[statusValue] ?? statusValue;
}

function resolveSourceClass(sourceKind: SourceKind): string {
  if (sourceKind === 'model') return 'source-model';
  if (sourceKind === 'rule') return 'source-rule';
  return 'source-pending';
}

const normalizedSearchKeyword = computed(() => searchKeyword.value.trim().toLowerCase());
const isCompact = computed(() => props.compact || props.density === 'compact');
const integrationModeLabel = computed(() => INTEGRATION_MODE_LABELS[props.integrationMode] ?? props.integrationMode);
const flatTasks = computed(() => flattenTasks(props.tasks));
const taskById = computed(() => new Map(flatTasks.value.map((task) => [task.taskId, task])));
const runningTaskIds = computed(() => flatTasks.value.filter((task) => task.status === 'running').map((task) => task.taskId));
const coordinatorTaskIds = computed(() => flatTasks.value.filter((task) => isCoordinatorTask(task)).map((task) => task.taskId));

const providerFilterOptions = computed(() => {
  const providers = new Set<string>();
  flatTasks.value.forEach((task) => {
    if (task.provider) providers.add(task.provider);
  });
  return ['all', ...Array.from(providers)];
});

const filteredTaskIds = computed(() => {
  return flatTasks.value
    .filter((task) => {
      const statusMatched = statusFilter.value === 'all' || task.status === statusFilter.value;
      const providerMatched = providerFilter.value === 'all' || task.provider === providerFilter.value;
      const searchMatched = normalizedSearchKeyword.value.length === 0
        || `${task.roleName} ${task.objective} ${task.latestUpdate ?? ''} ${task.provider ?? ''}`
          .toLowerCase()
          .includes(normalizedSearchKeyword.value);
      return statusMatched && providerMatched && searchMatched;
    })
    .map((task) => task.taskId);
});

const criticalTaskIds = computed(() => {
  const set = new Set<string>();
  flatTasks.value.forEach((task) => {
    if (task.status === 'running' || task.status === 'blocked') set.add(task.taskId);
  });
  coordinatorTaskIds.value.forEach((taskId) => set.add(taskId));
  if (focusedTaskId.value) set.add(focusedTaskId.value);
  return set;
});

const visibleTaskIds = computed(() => {
  const set = new Set<string>();
  const byId = taskById.value;

  const attachAncestors = (taskId: string): void => {
    let cursor = byId.get(taskId);
    while (cursor) {
      if (set.has(cursor.taskId)) return;
      set.add(cursor.taskId);
      if (!cursor.parentTaskId) return;
      cursor = byId.get(cursor.parentTaskId);
    }
  };

  const baseIds = showCriticalPath.value ? Array.from(criticalTaskIds.value) : filteredTaskIds.value;
  if (baseIds.length > 0) {
    baseIds.forEach((taskId) => attachAncestors(taskId));
  } else if (normalizedSearchKeyword.value.length === 0 && !showCriticalPath.value) {
    flatTasks.value.forEach((task) => set.add(task.taskId));
  }

  coordinatorTaskIds.value.forEach((taskId) => set.add(taskId));
  if (focusedTaskId.value) attachAncestors(focusedTaskId.value);
  return set;
});

const visibleTasks = computed(() => flatTasks.value.filter((task) => visibleTaskIds.value.has(task.taskId)));
const visibleTaskCount = computed(() => visibleTasks.value.length);

const taskCounters = computed<Record<OrchestrationTaskStatus, number>>(() => {
  const counters: Record<OrchestrationTaskStatus, number> = { pending: 0, running: 0, done: 0, blocked: 0 };
  visibleTasks.value.forEach((task) => {
    counters[task.status] += 1;
  });
  return counters;
});

const dependencyLinkCount = computed(() => {
  return visibleTasks.value.reduce((count, task) => {
    return count + (task.dependencies?.length ?? 0);
  }, 0);
});

const criticalChainDepth = computed(() => {
  const depthCache = new Map<string, number>();
  const byId = taskById.value;

  const resolveDepth = (taskId: string): number => {
    if (depthCache.has(taskId)) {
      return depthCache.get(taskId) ?? 1;
    }
    const task = byId.get(taskId);
    if (!task) {
      return 0;
    }

    const parentDepth = task.parentTaskId ? resolveDepth(task.parentTaskId) : 0;
    const currentDepth = parentDepth + 1;
    depthCache.set(taskId, currentDepth);
    return currentDepth;
  };

  const candidateIds = focusedTaskId.value ? [focusedTaskId.value] : Array.from(visibleTaskIds.value);
  return candidateIds.reduce((maxDepth, taskId) => {
    return Math.max(maxDepth, resolveDepth(taskId));
  }, 0);
});

const executionPressure = computed(() => {
  const total = Math.max(1, visibleTaskCount.value);
  const weighted = (
    (taskCounters.value.blocked * 1.1)
    + (taskCounters.value.running * 0.68)
    + (taskCounters.value.pending * 0.3)
    - (taskCounters.value.done * 0.18)
  ) / total;
  return Math.max(0, Math.min(100, Math.round(weighted * 100)));
});

const executionPressureLabel = computed(() => {
  if (executionPressure.value >= 70) return '高压';
  if (executionPressure.value >= 40) return '中压';
  return '稳态';
});

const graphPresetLabel = computed(() => PRESET_LABELS[graphPreset.value]);

function calcBottleneckScore(task: FlatTask): number {
  let score = 0;
  if (task.status === 'blocked') score += 120;
  if (task.status === 'running') score += 82;
  if (task.status === 'pending') score += 26;
  score += Math.max(0, 60 - task.progress);
  score += (task.dependencies?.length ?? 0) * 9;
  if (task.parentTaskId) score += 4;
  return score;
}

const bottleneckTasks = computed(() => {
  return visibleTasks.value
    .map((task) => ({ task, score: calcBottleneckScore(task) }))
    .filter((item) => item.task.status !== 'done')
    .sort((left, right) => right.score - left.score);
});

const topBottlenecks = computed(() => bottleneckTasks.value.slice(0, 3));

const selectedTask = computed(() => (focusedTaskId.value ? taskById.value.get(focusedTaskId.value) ?? null : null));
const activeTaskText = computed(() => selectedTask.value ? `${selectedTask.value.roleName}：${selectedTask.value.objective}` : props.activeTaskHint);

const focusedPathNodeIds = computed(() => {
  const set = new Set<string>();
  if (!focusedTaskId.value) return set;
  let cursor = taskById.value.get(focusedTaskId.value);
  while (cursor) {
    set.add(cursor.taskId);
    if (!cursor.parentTaskId) break;
    cursor = taskById.value.get(cursor.parentTaskId);
  }
  return set;
});

const visibleOrchestrationNodes = computed(() => {
  if (normalizedSearchKeyword.value.length === 0) return props.nodes;
  return props.nodes.filter((node) => `${node.label} ${node.detail ?? ''}`.toLowerCase().includes(normalizedSearchKeyword.value));
});

const graphNodeMap = computed(() => {
  const nodeMap = new Map<string, GraphNodeDatum>();
  const pathSet = focusedPathNodeIds.value;

  visibleOrchestrationNodes.value.forEach((node) => {
    const categoryKey = resolveNodeCategory(node.kind);
    const categoryMeta = CATEGORY_META[CATEGORY_INDEX[categoryKey]];
    const inPath = pathSet.has(node.id);
    const color = node.color ?? categoryMeta.color;
    nodeMap.set(node.id, {
      id: node.id,
      name: node.label,
      category: CATEGORY_INDEX[categoryKey],
      symbolSize: Math.max(40, 46 + Math.round((node.emphasis ?? 0) * 16)),
      value: Math.max(1, node.emphasis ?? 1),
      detail: node.detail,
      itemStyle: {
        color,
        borderColor: inPath ? '#e0f4ff' : '#0f172a',
        borderWidth: inPath ? 2.8 : 1.2,
        shadowColor: applyAlpha(color, inPath ? 0.8 : 0.45),
        shadowBlur: inPath ? 20 : 10,
      },
      label: { color: '#d7e8fb', fontSize: 11, fontWeight: inPath ? 'bold' : 'normal' },
    });
  });

  visibleTasks.value.forEach((task) => {
    const categoryKey = resolveTaskCategory(task);
    const categoryMeta = CATEGORY_META[CATEGORY_INDEX[categoryKey]];
    const inPath = pathSet.has(task.taskId);
    const statusColor = STATUS_COLORS[task.status];
    const baseColor = task.status === 'pending' ? categoryMeta.color : statusColor;
    const progress = clampProgress(task.progress);

    nodeMap.set(task.taskId, {
      id: task.taskId,
      name: task.roleName,
      category: CATEGORY_INDEX[categoryKey],
      symbol: resolveTaskSymbol(task.status),
      symbolSize: categoryKey === 'coordinator' ? 74 : 44 + Math.round(progress * 0.14),
      value: Math.max(1, progress / 10),
      detail: task.latestUpdate ?? task.objective,
      status: task.status,
      provider: task.provider,
      itemStyle: {
        color: baseColor,
        borderColor: inPath ? '#e8fbff' : '#0f172a',
        borderWidth: inPath ? 3 : 1.2,
        shadowColor: applyAlpha(baseColor, inPath ? 0.82 : 0.58),
        shadowBlur: inPath ? 24 : 11,
      },
      label: { color: '#deecfb', fontSize: 11, fontWeight: inPath ? 'bold' : 'normal' },
    });
  });

  return nodeMap;
});

const graphNodes = computed(() => Array.from(graphNodeMap.value.values()));
const visibleNodeIds = computed(() => new Set(graphNodes.value.map((node) => node.id)));

const graphLinks = computed(() => {
  const links: GraphLinkDatum[] = [];
  const exists = new Set<string>();
  const pathSet = focusedPathNodeIds.value;

  const pushLink = (
    source: string,
    target: string,
    label?: string,
    style: 'solid' | 'dashed' = 'solid',
    status?: OrchestrationTaskStatus,
  ): void => {
    if (!visibleNodeIds.value.has(source) || !visibleNodeIds.value.has(target)) return;
    const key = `${source}->${target}:${style}:${label ?? ''}`;
    if (exists.has(key)) return;
    exists.add(key);

    const inPath = pathSet.has(source) && pathSet.has(target);
    links.push({
      source,
      target,
      value: label,
      lineStyle: {
        color: inPath ? '#7adfff' : status ? STATUS_COLORS[status] : '#6b88a4',
        width: inPath ? 2.8 : status === 'running' ? 2.2 : 1.4,
        type: style,
        curveness: 0.12,
        opacity: inPath ? 0.95 : 0.68,
      },
    });
  };

  props.edges.forEach((edge) => {
    pushLink(edge.source, edge.target, edge.label, edge.style === 'dashed' ? 'dashed' : 'solid');
  });

  const coordinatorId = coordinatorTaskIds.value.find((taskId) => visibleNodeIds.value.has(taskId));

  visibleTasks.value.forEach((task) => {
    task.dependencies?.forEach((dependencyId) => {
      pushLink(dependencyId, task.taskId, '依赖', 'dashed', task.status);
    });

    if (task.parentTaskId && taskById.value.has(task.parentTaskId)) {
      pushLink(task.parentTaskId, task.taskId, '协同', 'dashed', task.status);
      return;
    }
    if (coordinatorId && task.taskId !== coordinatorId && !isCoordinatorTask(task)) {
      pushLink(coordinatorId, task.taskId, '分派', 'dashed', task.status);
    }
  });

  return links;
});

const hasGraphContent = computed(() => {
  return graphNodes.value.length > 0 || graphLinks.value.length > 0 || flatTasks.value.length > 0;
});

const chartOption = computed(() => {
  return {
    backgroundColor: 'transparent',
    animationDurationUpdate: 380,
    tooltip: {
      show: true,
      trigger: 'item',
      triggerOn: 'mousemove',
      backgroundColor: 'rgba(8, 18, 31, 0.94)',
      borderColor: '#36516d',
      textStyle: { color: '#e1efff', fontSize: 12 },
      formatter: (params: any) => {
        if (params.dataType === 'node' && params.data && 'name' in params.data) {
          const node = params.data as GraphNodeDatum;
          const statusText = node.status ? formatTaskStatus(node.status) : '流程节点';
          const providerText = node.provider ? `<div>Provider：${node.provider}</div>` : '';
          const detailText = node.detail ? `<div style="margin-top:4px;color:#9bb8d6;">${node.detail}</div>` : '';
          return `<div style="min-width:180px;"><div style="font-weight:600;margin-bottom:4px;">${node.name}</div><div style="color:#8fb0cf;">状态：${statusText}</div>${providerText}${detailText}</div>`;
        }
        if (params.dataType === 'edge' && params.data && 'value' in params.data) {
          const edge = params.data as GraphLinkDatum;
          return `<div>关系：${edge.value ?? '流程关联'}</div>`;
        }
        return '';
      },
    },
    legend: {
      show: true,
      top: 6,
      left: 'center',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#9eb9d2', fontSize: 11 },
      selectedMode: false,
      data: CATEGORY_META.map((item) => item.name),
    },
    series: [
      {
        type: 'graph',
        layout: layoutMode.value,
        circular: layoutMode.value === 'circular' ? { rotateLabel: true } : undefined,
        roam: true,
        draggable: true,
        focusNodeAdjacency: true,
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 6,
        force: layoutMode.value === 'force'
          ? {
              repulsion: isCompact.value ? 255 : 390,
              edgeLength: isCompact.value ? 92 : 126,
              gravity: 0.08,
            }
          : undefined,
        lineStyle: { color: '#6a85a0', width: 1.3, opacity: 0.62, curveness: 0.12 },
        label: { show: true, position: 'bottom', fontSize: 11, color: '#dbe8f8', distance: 6 },
        itemStyle: { borderColor: '#0f172a', borderWidth: 1.2, shadowBlur: 10 },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 2.6, opacity: 0.95 },
          itemStyle: { shadowBlur: 22, shadowColor: 'rgba(114, 197, 255, 0.5)' },
        },
        categories: CATEGORY_META.map((item) => ({ name: item.name, itemStyle: { color: item.color } })),
        data: graphNodes.value as unknown as Record<string, unknown>[],
        links: graphLinks.value as unknown as Record<string, unknown>[],
      },
    ],
  } as EChartsOption;
});

function renderChart(replace: boolean = true): void {
  if (!chartInstance) return;
  chartInstance.setOption(chartOption.value, replace);
}

function handleResize(): void {
  chartInstance?.resize();
}

function selectTask(taskId: string): void {
  focusedTaskId.value = taskId;
  emit('node-click', taskId);
}

function applyPreset(preset: GraphPreset): void {
  graphPreset.value = preset;
  if (preset === 'panorama') {
    statusFilter.value = 'all';
    providerFilter.value = 'all';
    showCriticalPath.value = false;
    autoFocusRunningTask.value = true;
    return;
  }

  if (preset === 'execution') {
    statusFilter.value = 'running';
    providerFilter.value = 'all';
    showCriticalPath.value = true;
    autoFocusRunningTask.value = true;
    return;
  }

  statusFilter.value = 'blocked';
  providerFilter.value = 'all';
  showCriticalPath.value = true;
  autoFocusRunningTask.value = false;
}

function resetFilters(): void {
  searchKeyword.value = '';
  applyPreset('panorama');
}

function toggleLayoutMode(): void {
  layoutMode.value = layoutMode.value === 'force' ? 'circular' : 'force';
}

function initChart(): void {
  if (!chartRef.value) return;

  chartInstance = init(chartRef.value, undefined, { renderer: 'canvas' });
  renderChart(true);

  chartInstance.on('click', (params: any) => {
    if (params.dataType !== 'node' || !params.data?.id) return;
    const nodeId = String(params.data.id);
    if (taskById.value.has(nodeId)) {
      selectTask(nodeId);
      return;
    }
    emit('node-click', nodeId);
  });

  window.addEventListener('resize', handleResize);
}

watch(chartOption, () => {
  renderChart(true);
}, { deep: true });

watch(taskById, (nextTaskMap) => {
  if (focusedTaskId.value && !nextTaskMap.has(focusedTaskId.value)) {
    focusedTaskId.value = null;
  }
});

watch([runningTaskIds, autoFocusRunningTask], ([runningIds, enabled]) => {
  if (!enabled || runningIds.length === 0 || focusedTaskId.value) return;
  focusedTaskId.value = runningIds[0];
}, { immediate: true });

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

defineExpose({
  refresh: () => {
    renderChart(true);
  },
});
</script>

<template>
  <section class="thinking-graph-container" :class="[`state-${state}`, `density-${density}`]">
    <header class="graph-header">
      <div class="header-main">
        <span class="thinking-indicator" :class="{ active: isRunning }" />
        <div class="header-copy">
          <h3>多Agent深度推理导图</h3>
          <p>{{ summary }}</p>
        </div>
      </div>
      <div class="header-meta">
        <span class="meta-chip">{{ phaseText }}</span>
        <span class="meta-chip" :class="resolveSourceClass(sourceKind)">{{ sourceText }}</span>
        <span class="meta-chip">{{ updatedAtText }}</span>
      </div>
    </header>

    <div class="overview-row">
      <article class="overview-item"><small>可视节点</small><strong>{{ graphNodes.length }}</strong></article>
      <article class="overview-item"><small>关系链路</small><strong>{{ graphLinks.length }}</strong></article>
      <article class="overview-item"><small>运行中</small><strong>{{ taskCounters.running }}</strong></article>
      <article class="overview-item"><small>阻断</small><strong>{{ taskCounters.blocked }}</strong></article>
    </div>

    <div class="insight-row">
      <article class="insight-item">
        <small>执行压强</small>
        <div class="insight-main">
          <strong>{{ executionPressure }}%</strong>
          <span class="insight-pill">{{ executionPressureLabel }}</span>
        </div>
      </article>
      <article class="insight-item">
        <small>关键链深度</small>
        <div class="insight-main">
          <strong>{{ criticalChainDepth }}</strong>
          <span class="insight-sub">层</span>
        </div>
      </article>
      <article class="insight-item">
        <small>依赖关系</small>
        <div class="insight-main">
          <strong>{{ dependencyLinkCount }}</strong>
          <span class="insight-sub">条</span>
        </div>
      </article>
      <div class="preset-group">
        <span class="filter-label">视图预设</span>
        <button
          v-for="preset in GRAPH_PRESETS"
          :key="preset"
          type="button"
          class="preset-chip"
          :class="{ active: graphPreset === preset }"
          @click="applyPreset(preset)"
        >
          {{ PRESET_LABELS[preset] }}
        </button>
        <span class="preset-caption">当前：{{ graphPresetLabel }}</span>
      </div>
    </div>

    <div class="graph-toolbar">
      <div class="filter-group">
        <span class="filter-label">任务状态</span>
        <button v-for="item in ['all', 'running', 'pending', 'done', 'blocked']" :key="item" type="button" class="filter-chip" :class="{ active: statusFilter === item }" @click="statusFilter = item as TaskStatusFilter; graphPreset = 'panorama'">
          {{ item === 'all' ? '全部' : item === 'running' ? '进行中' : item === 'pending' ? '待执行' : item === 'done' ? '已完成' : '阻断' }}
        </button>
      </div>
      <div class="filter-group">
        <span class="filter-label">Provider</span>
        <button v-for="provider in providerFilterOptions" :key="provider" type="button" class="filter-chip" :class="{ active: providerFilter === provider }" @click="providerFilter = provider; graphPreset = 'panorama'">
          {{ provider === 'all' ? '全部' : provider }}
        </button>
      </div>
      <div class="filter-group">
        <span class="filter-label">检索</span>
        <input v-model.trim="searchKeyword" class="search-input" type="text" placeholder="搜索任务/节点" @input="graphPreset = 'panorama'" />
      </div>
      <button type="button" class="mode-btn" :class="{ active: showCriticalPath }" @click="showCriticalPath = !showCriticalPath; graphPreset = 'panorama'">关键路径</button>
      <button type="button" class="mode-btn" @click="toggleLayoutMode">布局：{{ layoutMode === 'force' ? '力导向' : '环形' }}</button>
      <button type="button" class="mode-btn" :class="{ active: autoFocusRunningTask }" @click="autoFocusRunningTask = !autoFocusRunningTask; graphPreset = 'panorama'">自动聚焦运行中</button>
      <button type="button" class="reset-btn" @click="resetFilters">重置筛选</button>
    </div>

    <div class="graph-workbench">
      <div class="graph-viewport">
        <div ref="chartRef" class="graph-chart" />
        <div v-if="!hasGraphContent" class="graph-empty-overlay">
          <strong>等待会诊输入后生成推理网络</strong>
          <p>将自动展示任务依赖、关键路径与瓶颈优先队列。</p>
        </div>
      </div>
      <aside class="task-stream">
        <div class="stream-header">
          <h4>任务流聚合</h4>
          <span class="integration-badge" :class="`mode-${integrationMode}`">{{ integrationModeLabel }}</span>
        </div>
        <p class="stream-text">{{ integrationText }}</p>
        <p class="stream-text active-task">{{ activeTaskText }}</p>

        <div class="bottleneck-block">
          <div class="bottleneck-head">
            <h5>瓶颈优先队列</h5>
            <span>{{ topBottlenecks.length }}项</span>
          </div>
          <button
            v-for="item in topBottlenecks"
            :key="item.task.taskId"
            type="button"
            class="bottleneck-item"
            :class="`status-${item.task.status}`"
            @click="selectTask(item.task.taskId)"
          >
            <strong>{{ item.task.roleName }}</strong>
            <span>优先级 {{ item.score }}</span>
          </button>
          <p v-if="topBottlenecks.length === 0" class="empty-state">暂无瓶颈节点。</p>
        </div>

        <div class="task-list">
          <button v-for="task in visibleTasks" :key="task.taskId" type="button" class="task-item" :class="[`status-${task.status}`, { focused: focusedTaskId === task.taskId }]" @click="selectTask(task.taskId)">
            <div class="task-head"><strong>{{ task.roleName }}</strong><span>{{ formatTaskStatus(task.status) }}</span></div>
            <p>{{ task.latestUpdate || task.objective }}</p>
            <div class="task-meta"><span>进度 {{ clampProgress(task.progress) }}%</span><span v-if="task.provider">{{ task.provider }}</span></div>
            <div class="task-progress"><div class="task-progress-fill" :style="{ width: `${clampProgress(task.progress)}%` }" /></div>
          </button>
          <p v-if="visibleTaskCount === 0" class="empty-state">当前筛选条件下暂无任务节点。</p>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.thinking-graph-container { border-radius: 16px; border: 1px solid rgba(94, 151, 199, 0.28); background: radial-gradient(circle at 100% 0%, rgba(53, 138, 189, 0.2), transparent 42%), radial-gradient(circle at 0% 100%, rgba(58, 171, 158, 0.14), transparent 48%), linear-gradient(150deg, #0a1828 0%, #102236 48%, #101f31 100%); box-shadow: 0 16px 32px rgba(6, 19, 34, 0.34); overflow: hidden; }
.thinking-graph-container.state-running { border-color: rgba(74, 176, 249, 0.56); }
.thinking-graph-container.state-done { border-color: rgba(65, 187, 123, 0.52); }
.thinking-graph-container.state-blocked { border-color: rgba(239, 106, 83, 0.6); }
.graph-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 16px 10px; border-bottom: 1px solid rgba(91, 130, 166, 0.25); }
.header-main { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.thinking-indicator { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; background: #5f6d7f; flex-shrink: 0; }
.thinking-indicator.active { background: #38bdf8; box-shadow: 0 0 10px rgba(56, 189, 248, 0.85); animation: graph-pulse 1.5s ease-in-out infinite; }
@keyframes graph-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.25); opacity: 0.62; } }
.header-copy h3 { margin: 0; color: #e6f2ff; font-size: 15px; }
.header-copy p { margin: 4px 0 0; color: #9fb8d0; font-size: 12px; }
.header-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.meta-chip { border: 1px solid rgba(118, 151, 182, 0.45); background: rgba(16, 39, 60, 0.76); border-radius: 999px; color: #b4cde3; font-size: 11px; padding: 3px 10px; }
.meta-chip.source-model { border-color: rgba(133, 104, 230, 0.55); color: #d8c4ff; }
.meta-chip.source-rule { border-color: rgba(80, 174, 166, 0.55); color: #b8efe8; }
.meta-chip.source-pending { border-color: rgba(126, 141, 158, 0.5); color: #b8c4d0; }
.overview-row { padding: 10px 16px 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.overview-item { border: 1px solid rgba(92, 128, 160, 0.35); border-radius: 10px; padding: 8px 10px; background: rgba(12, 32, 50, 0.72); display: grid; gap: 4px; }
.overview-item small { color: #96b4cf; font-size: 11px; }
.overview-item strong { color: #e8f4ff; font-size: 18px; line-height: 1; }
.insight-row { margin-top: 10px; padding: 0 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(240px, 1fr); gap: 10px; align-items: stretch; }
.insight-item { border: 1px solid rgba(99, 135, 166, 0.38); border-radius: 10px; padding: 8px 10px; background: rgba(11, 31, 48, 0.72); display: grid; gap: 6px; }
.insight-item small { color: #95b2cd; font-size: 11px; }
.insight-main { display: flex; align-items: baseline; gap: 6px; }
.insight-main strong { color: #ebf6ff; font-size: 18px; line-height: 1; }
.insight-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: 10px; color: #c9f6ef; border: 1px solid rgba(82, 177, 168, 0.6); background: rgba(27, 98, 90, 0.5); }
.insight-sub { color: #8eaec8; font-size: 11px; }
.preset-group { border: 1px solid rgba(99, 135, 166, 0.38); border-radius: 10px; padding: 8px 10px; background: rgba(11, 31, 48, 0.72); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; align-content: center; }
.preset-chip { border: 1px solid rgba(117, 153, 186, 0.44); background: rgba(14, 38, 58, 0.72); color: #c7dbef; border-radius: 999px; font-size: 11px; padding: 3px 9px; cursor: pointer; }
.preset-chip.active { border-color: rgba(78, 183, 167, 0.78); background: rgba(38, 104, 94, 0.72); color: #e3fffb; }
.preset-caption { margin-left: auto; color: #8aa8c1; font-size: 11px; }
.graph-toolbar { margin-top: 10px; padding: 0 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.filter-label { color: #8eabc6; font-size: 11px; }
.filter-chip,.mode-btn,.reset-btn { border: 1px solid rgba(117, 153, 186, 0.44); background: rgba(14, 38, 58, 0.72); color: #c7dbef; border-radius: 999px; font-size: 11px; padding: 3px 9px; cursor: pointer; }
.filter-chip.active,.mode-btn.active { border-color: rgba(78, 183, 167, 0.78); background: rgba(38, 104, 94, 0.72); color: #e3fffb; }
.search-input { width: 132px; height: 26px; border-radius: 999px; border: 1px solid rgba(117, 153, 186, 0.44); background: rgba(12, 34, 53, 0.82); color: #e2f2ff; font-size: 11px; padding: 0 10px; }
.graph-workbench { padding: 10px 16px 14px; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; min-height: 360px; }
.graph-viewport { position: relative; min-height: 350px; }
.graph-chart { min-height: 350px; height: 100%; border: 1px solid rgba(96, 134, 166, 0.35); border-radius: 12px; background: radial-gradient(circle at 0% 0%, rgba(41, 94, 135, 0.22), transparent 42%), radial-gradient(circle at 100% 100%, rgba(48, 123, 112, 0.2), transparent 46%), rgba(10, 26, 41, 0.74); }
.graph-empty-overlay { position: absolute; inset: 12px; border: 1px dashed rgba(133, 168, 199, 0.45); border-radius: 10px; background: linear-gradient(140deg, rgba(15, 41, 62, 0.84), rgba(13, 35, 56, 0.76)); display: grid; align-content: center; justify-items: center; gap: 7px; text-align: center; pointer-events: none; }
.graph-empty-overlay strong { color: #d7ebff; font-size: 15px; }
.graph-empty-overlay p { margin: 0; color: #9fbfdb; font-size: 12px; max-width: 320px; line-height: 1.5; }
.task-stream { border: 1px solid rgba(96, 134, 166, 0.35); border-radius: 12px; background: rgba(10, 28, 46, 0.84); padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 350px; }
.stream-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.stream-header h4 { margin: 0; color: #e1efff; font-size: 13px; }
.integration-badge { border-radius: 999px; border: 1px solid rgba(109, 149, 184, 0.5); color: #b8cee3; font-size: 10px; padding: 2px 8px; }
.integration-badge.mode-model { border-color: rgba(145, 123, 224, 0.7); color: #ddceff; }
.integration-badge.mode-rule,.integration-badge.mode-syncing { border-color: rgba(80, 174, 166, 0.7); color: #c4faf2; }
.stream-text { margin: 0; color: #9eb9d2; font-size: 12px; line-height: 1.45; }
.active-task { color: #d8ebff; }
.bottleneck-block { border: 1px solid rgba(98, 134, 165, 0.35); border-radius: 10px; background: rgba(11, 33, 52, 0.72); padding: 8px; display: grid; gap: 6px; }
.bottleneck-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bottleneck-head h5 { margin: 0; color: #dbecfe; font-size: 12px; }
.bottleneck-head span { color: #8dadc8; font-size: 10px; }
.bottleneck-item { border: 1px solid rgba(106, 140, 169, 0.45); border-radius: 8px; background: rgba(12, 38, 58, 0.76); padding: 7px 8px; text-align: left; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.bottleneck-item strong { color: #e6f3ff; font-size: 11px; }
.bottleneck-item span { color: #98b5d0; font-size: 10px; }
.bottleneck-item.status-running { border-color: rgba(58, 167, 255, 0.68); }
.bottleneck-item.status-blocked { border-color: rgba(239, 106, 83, 0.74); }
.bottleneck-item.status-pending { border-color: rgba(131, 153, 177, 0.64); }
.task-list { margin-top: 4px; display: grid; gap: 8px; overflow-y: auto; max-height: 228px; }
.task-item { border: 1px solid rgba(106, 140, 169, 0.45); border-radius: 10px; background: rgba(12, 38, 58, 0.76); padding: 8px; text-align: left; cursor: pointer; }
.task-item.focused { border-color: rgba(76, 203, 178, 0.84); box-shadow: 0 0 0 1px rgba(76, 203, 178, 0.42); }
.task-item.status-running { border-color: rgba(58, 167, 255, 0.74); }
.task-item.status-done { border-color: rgba(47, 191, 120, 0.72); }
.task-item.status-blocked { border-color: rgba(239, 106, 83, 0.76); }
.task-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.task-head strong { color: #ecf6ff; font-size: 12px; }
.task-head span { color: #99b7d3; font-size: 11px; }
.task-item p { margin: 6px 0 0; color: #b6cee3; font-size: 12px; line-height: 1.35; }
.task-meta { margin-top: 5px; display: flex; justify-content: space-between; gap: 8px; color: #8fb0cc; font-size: 11px; }
.task-progress { margin-top: 7px; height: 5px; border-radius: 999px; background: rgba(108, 137, 163, 0.42); overflow: hidden; }
.task-progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #2ea2ff 0%, #2fbf78 100%); }
.empty-state { margin: 0; color: #8aa8c4; font-size: 12px; }
@media (max-width: 1280px) { .insight-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } .preset-group { grid-column: span 2; } .graph-workbench { grid-template-columns: 1fr; } }
@media (max-width: 880px) { .graph-header { flex-direction: column; } .header-meta { justify-content: flex-start; } .overview-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } .insight-row { grid-template-columns: 1fr; } .preset-group { grid-column: auto; } .preset-caption { margin-left: 0; } .graph-viewport,.graph-chart { min-height: 280px; } }
@media (max-width: 560px) { .overview-row { grid-template-columns: 1fr; } }
</style>
