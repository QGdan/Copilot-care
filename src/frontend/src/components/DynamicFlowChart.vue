<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { GraphChart } from 'echarts/charts';
import { TooltipComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { ECharts, init, use } from 'echarts/core';
import type { WorkflowStage } from '@copilot-care/shared/types';
import type {
  ChartDensity,
  VisualizationState,
} from '../types/visualization';

use([GraphChart, TooltipComponent, TitleComponent, CanvasRenderer]);

interface StageState {
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'blocked';
  message: string;
}

interface DynamicFlowChartProps {
  stageRuntime?: Record<WorkflowStage, StageState>;
  currentStage?: WorkflowStage;
  hasRedFlag?: boolean;
  isRunning?: boolean;
  state?: VisualizationState;
  density?: ChartDensity;
}

const props = withDefaults(defineProps<DynamicFlowChartProps>(), {
  stageRuntime: undefined,
  currentStage: 'START',
  hasRedFlag: false,
  isRunning: false,
  state: 'idle',
  density: 'comfortable',
});

const emit = defineEmits<{
  (e: 'stage-click', stage: WorkflowStage): void;
}>();

const chartRef = ref<HTMLDivElement | null>(null);
let chartInstance: ECharts | null = null;

const WORKFLOW_STAGES: WorkflowStage[] = [
  'START',
  'INFO_GATHER',
  'RISK_ASSESS',
  'ROUTING',
  'DEBATE',
  'CONSENSUS',
  'REVIEW',
  'OUTPUT',
];

const STAGE_CONFIG: Record<WorkflowStage, { label: string; icon: string; color: string }> = {
  START: { label: '启动', icon: '🚀', color: '#6366f1' },
  INFO_GATHER: { label: '信息采集', icon: '📋', color: '#3b82f6' },
  RISK_ASSESS: { label: '风险评估', icon: '⚠️', color: '#ef4444' },
  ROUTING: { label: '复杂度路由', icon: '🔀', color: '#8b5cf6' },
  DEBATE: { label: '多Agent辩论', icon: '⚡', color: '#f59e0b' },
  CONSENSUS: { label: '共识收敛', icon: '✅', color: '#10b981' },
  REVIEW: { label: '审校复核', icon: '🔍', color: '#06b6d4' },
  OUTPUT: { label: '输出报告', icon: '📊', color: '#14b8a6' },
  ESCALATION: { label: '线下上转', icon: '🏥', color: '#dc2626' },
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280',
  running: '#3b82f6',
  done: '#10b981',
  failed: '#ef4444',
  skipped: '#f59e0b',
};

interface FlowNode {
  id: string;
  name: string;
  stage: WorkflowStage;
  status: string;
  message?: string;
}

const nodes = computed<FlowNode[]>(() => {
  const runtime = props.stageRuntime as Record<WorkflowStage, StageState> | undefined;
  return WORKFLOW_STAGES.map((stage) => {
    const config = STAGE_CONFIG[stage];
    const stageRuntime = runtime?.[stage];
    return {
      id: stage,
      name: `${config.icon} ${config.label}`,
      stage,
      status: stageRuntime?.status || 'pending',
      message: stageRuntime?.message || '',
    };
  });
});

const edges = computed(() => {
  const result: { source: string; target: string }[] = [];
  for (let i = 0; i < WORKFLOW_STAGES.length - 1; i++) {
    result.push({
      source: WORKFLOW_STAGES[i],
      target: WORKFLOW_STAGES[i + 1],
    });
  }
  return result;
});

const chartOption = computed(() => {
  const nodeList = nodes.value;
  const edgeList = edges.value;
  const dense = props.density === 'compact';
  const stageGap = dense ? 112 : 130;
  const baseNodeSize = dense ? [84, 40] : [96, 48];
  const currentNodeSize = dense ? [92, 44] : [104, 54];

  return {
    backgroundColor: 'transparent',
    tooltip: {
      show: true,
      trigger: 'item',
      triggerOn: 'mousemove',
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: '#334155',
      textStyle: {
        color: '#e2e8f0',
        fontSize: 12,
      },
      formatter: (params: any) => {
        if (params.dataType === 'node' && params.data) {
          const node = params.data;
          const statusColor = STATUS_COLORS[node.status] || '#6b7280';
          return `
            <div style="padding: 8px;">
              <div style="font-weight: 600; margin-bottom: 4px;">${node.name}</div>
              <div style="color: #94a3b8; font-size: 11px;">${node.message || ''}</div>
              <div style="margin-top: 6px; color: ${statusColor}; font-size: 11px;">
                状态: ${getStatusText(node.status)}
              </div>
            </div>
          `;
        }
        return '';
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'none',
        animation: true,
        animationDuration: 800,
        animationEasing: 'cubicOut',
        roam: false,
        draggable: false,
        symbol: 'rect',
        symbolSize: [90, 45],
        label: {
          show: true,
          position: 'inside',
          formatter: '{b}',
          fontSize: 12,
          color: '#fff',
          fontWeight: 600,
        },
        edgeSymbol: ['circle', 'arrow'],
        edgeSymbolSize: [8, 12],
        lineStyle: {
          width: 2,
          curveness: 0,
          color: '#475569',
        },
        emphasis: {
          focus: 'adjacency',
          scale: 1.05,
          itemStyle: {
            shadowBlur: 15,
            shadowColor: 'rgba(255, 255, 255, 0.3)',
          },
        },
        data: nodeList.map((node, index) => {
          const config = STAGE_CONFIG[node.stage];
          const isCurrent = node.stage === props.currentStage;
          return {
            id: node.id,
            name: node.name,
            x: index * stageGap,
            y: 0,
            symbolSize: isCurrent ? currentNodeSize : baseNodeSize,
            itemStyle: {
              color: config.color,
              borderColor: isCurrent ? '#fff' : config.color,
              borderWidth: isCurrent ? 3 : 2,
              shadowColor: node.status === 'running' ? config.color : 'rgba(0,0,0,0.2)',
              shadowBlur: node.status === 'running' ? 15 : 5,
            },
            status: node.status,
            message: node.message,
          };
        }),
        links: edgeList.map((edge, idx) => {
          const sourceNode = nodeList.find(n => n.id === edge.source);
          const isActive = sourceNode?.status === 'done';
          return {
            source: edge.source,
            target: edge.target,
            lineStyle: {
              color: isActive ? '#10b981' : '#475569',
              width: isActive ? 2 : 1,
              curveness: 0,
            },
            symbol: isActive ? ['none', 'arrow'] : ['none', 'arrow'],
            symbolSize: [8, 10],
          };
        }),
      },
    ],
  };
});

function getStatusText(status: string): string {
  const texts: Record<string, string> = {
    pending: '等待',
    running: '进行中',
    done: '已完成',
    failed: '失败',
    skipped: '跳过',
  };
  return texts[status] || status;
}

function initChart(): void {
  if (!chartRef.value) return;

  chartInstance = init(chartRef.value, undefined, {
    renderer: 'canvas',
  });

  chartInstance.setOption(chartOption.value);

  chartInstance.on('click', (params: any) => {
    if (params.dataType === 'node' && params.data) {
      const stage = params.data.id as WorkflowStage;
      emit('stage-click', stage);
    }
  });

  window.addEventListener('resize', handleResize);
}

function handleResize(): void {
  chartInstance?.resize();
}

function updateChart(): void {
  if (chartInstance) {
    chartInstance.setOption(chartOption.value, { notMerge: true });
  }
}

watch([() => props.stageRuntime, () => props.currentStage], updateChart, { deep: true });

onMounted(() => {
  initChart();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  chartInstance?.dispose();
  chartInstance = null;
});

defineExpose({
  refresh: updateChart,
});
</script>

<template>
  <div
    class="workflow-flow-chart"
    :class="[`state-${state}`, `density-${density}`]"
  >
    <div class="flow-header">
      <div class="header-left">
        <span
          class="flow-indicator"
          :class="{ active: isRunning }"
        ></span>
        <h3>🔄 七层工作流</h3>
      </div>
      <div class="header-stats">
        <span class="stat-badge">{{ nodes.filter(n => n.status === 'done').length }}/{{ nodes.length }} 阶段</span>
        <span v-if="hasRedFlag" class="red-flag-badge">🚨 红旗</span>
      </div>
    </div>

    <div ref="chartRef" class="flow-chart"></div>
  </div>
</template>

<style scoped>
.workflow-flow-chart {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  border-radius: 12px;
  border: 1px solid rgba(100, 200, 255, 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 200px;
}

.workflow-flow-chart.state-running {
  border-color: rgba(100, 200, 255, 0.3);
  box-shadow: 0 0 0 1px rgba(100, 200, 255, 0.2);
}

.workflow-flow-chart.state-done {
  border-color: rgba(29, 139, 97, 0.4);
}

.workflow-flow-chart.state-blocked {
  border-color: rgba(239, 68, 68, 0.45);
}

.workflow-flow-chart.density-compact .flow-chart {
  min-height: 180px;
}

.workflow-flow-chart.density-comfortable .flow-chart {
  min-height: 210px;
}

.flow-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(100, 200, 255, 0.1);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.flow-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4b5563;
  transition: all 0.3s ease;
}

.flow-indicator.active {
  background: #10b981;
  box-shadow: 0 0 10px #10b981;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.3); }
}

.flow-header h3 {
  margin: 0;
  font-size: 14px;
  color: #e2e8f0;
  font-weight: 600;
}

.header-stats {
  display: flex;
  gap: 8px;
  align-items: center;
}

.stat-badge {
  font-size: 11px;
  padding: 4px 10px;
  background: rgba(100, 200, 255, 0.1);
  border-radius: 12px;
  color: #94a3b8;
}

.red-flag-badge {
  font-size: 11px;
  padding: 4px 10px;
  background: rgba(239, 68, 68, 0.2);
  border-radius: 12px;
  color: #ef4444;
}

.flow-chart {
  flex: 1;
  min-height: 150px;
}
</style>
