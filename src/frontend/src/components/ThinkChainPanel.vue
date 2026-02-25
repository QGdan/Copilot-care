<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { OrchestrationTask, OrchestrationSnapshot, ThinkStep } from '@copilot-care/shared/types';

interface ThinkChainPanelProps {
  snapshot?: OrchestrationSnapshot;
  isRunning?: boolean;
  showFlowchart?: boolean;
}

const props = withDefaults(defineProps<ThinkChainPanelProps>(), {
  isRunning: false,
  showFlowchart: false,
});

const emit = defineEmits<{
  (e: 'step-click', step: ThinkStep): void;
}>();

const expandedSteps = ref<Set<string>>(new Set());

const STAGE_CONFIG: Record<string, { icon: string; color: string; bgColor: string }> = {
  intent_understanding: { icon: '🔍', color: '#64c8ff', bgColor: 'rgba(100, 200, 255, 0.1)' },
  task_decomposition: { icon: '📋', color: '#00ff88', bgColor: 'rgba(0, 255, 136, 0.1)' },
  agent_dispatch: { icon: '🎯', color: '#ffc800', bgColor: 'rgba(255, 200, 0, 0.1)' },
  parallel_execution: { icon: '⚡', color: '#ff9f43', bgColor: 'rgba(255, 159, 67, 0.1)' },
  result_aggregation: { icon: '🔄', color: '#a55eea', bgColor: 'rgba(165, 94, 234, 0.1)' },
  decision_synthesis: { icon: '🎯', color: '#26de81', bgColor: 'rgba(38, 222, 129, 0.1)' },
};

const PROVIDER_ICONS: Record<string, string> = {
  deepseek: '🔵',
  gemini: '🟡',
  kimi: '🟣',
};

const PROVIDER_COLORS: Record<string, string> = {
  deepseek: '#3b82f6',
  gemini: '#fbbf24',
  kimi: '#a855f7',
};

const thinkSteps = computed<ThinkStep[]>(() => {
  const snapshot = props.snapshot;
  if (!snapshot?.tasks) return [];

  const steps: ThinkStep[] = [];
  const tasks = snapshot.tasks;

  const coordinatorTask = tasks.find(t => t.roleId === 'chief_coordinator');
  if (coordinatorTask) {
    steps.push({
      stepId: 'step_intent',
      kind: 'intent_understanding',
      title: '理解需求',
      description: coordinatorTask.latestUpdate || '总Agent正在分析患者需求',
      status: coordinatorTask.status,
      progress: coordinatorTask.progress,
      timestamp: snapshot.generatedAt,
    });
  }

  if (tasks.some(t => t.subTasks && t.subTasks.length > 0)) {
    const parentTask = tasks.find(t => t.subTasks && t.subTasks.length > 0);
    if (parentTask) {
      steps.push({
        stepId: 'step_decompose',
        kind: 'task_decomposition',
        title: '任务拆解',
        description: `拆解为 ${parentTask.subTasks?.length || 0} 个子任务`,
        status: parentTask.status,
        progress: parentTask.progress,
        timestamp: snapshot.generatedAt,
        subSteps: parentTask.subTasks?.map((sub, idx) => ({
          stepId: `sub_${idx}`,
          kind: 'agent_dispatch' as const,
          title: sub.roleName,
          description: sub.objective,
          agentName: sub.roleName,
          provider: sub.provider,
          status: sub.status,
          progress: sub.progress,
          timestamp: snapshot.generatedAt,
        })),
      });
    }
  }

  const executionTasks = tasks.filter(t => 
    t.roleId.includes('agent') || 
    t.roleId === 'specialist_panel' ||
    t.roleId === 'reviewer_agent'
  );

  if (executionTasks.length > 0) {
    const runningTasks = executionTasks.filter(t => t.status === 'running');
    const doneTasks = executionTasks.filter(t => t.status === 'done');

    if (runningTasks.length > 0 || doneTasks.length > 0) {
      steps.push({
        stepId: 'step_execute',
        kind: 'parallel_execution',
        title: '并行执行',
        description: `执行中: ${runningTasks.length}, 已完成: ${doneTasks.length}`,
        status: runningTasks.length > 0 ? 'running' : 'done',
        progress: Math.round(doneTasks.length / executionTasks.length * 100),
        timestamp: snapshot.generatedAt,
        subSteps: executionTasks.map(task => ({
          stepId: task.taskId,
          kind: 'agent_dispatch' as const,
          title: task.roleName,
          description: task.objective,
          agentName: task.roleName,
          provider: task.provider,
          status: task.status,
          progress: task.progress,
          timestamp: snapshot.generatedAt,
        })),
      });
    }
  }

  const outputTask = tasks.find(t => t.roleId === 'output_agent');
  if (outputTask) {
    steps.push({
      stepId: 'step_aggregate',
      kind: 'result_aggregation',
      title: '结果汇总',
      description: outputTask.latestUpdate || '汇总各Agent意见',
      status: outputTask.status,
      progress: outputTask.progress,
      timestamp: snapshot.generatedAt,
    });
  }

  if (snapshot.summary) {
    steps.push({
      stepId: 'step_synthesize',
      kind: 'decision_synthesis',
      title: '决策合成',
      description: snapshot.summary,
      status: 'done',
      progress: 100,
      timestamp: snapshot.generatedAt,
    });
  }

  return steps;
});

function toggleExpand(stepId: string) {
  if (expandedSteps.value.has(stepId)) {
    expandedSteps.value.delete(stepId);
  } else {
    expandedSteps.value.add(stepId);
  }
}

function isExpanded(stepId: string): boolean {
  return expandedSteps.value.has(stepId);
}

function getStepIcon(kind: string): string {
  return STAGE_CONFIG[kind]?.icon || '🤔';
}

function getStepColor(kind: string): string {
  return STAGE_CONFIG[kind]?.color || '#64c8ff';
}

function getStepBgColor(kind: string): string {
  return STAGE_CONFIG[kind]?.bgColor || 'rgba(100, 200, 255, 0.1)';
}

function getProviderIcon(provider?: string): string {
  if (!provider) return '🤖';
  return PROVIDER_ICONS[provider] || '🤖';
}

function getProviderColor(provider?: string): string {
  if (!provider) return '#8b92a8';
  return PROVIDER_COLORS[provider] || '#8b92a8';
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '等待',
    running: '进行中',
    done: '已完成',
    blocked: '阻塞',
  };
  return labels[status] || status;
}

function getProgressColor(progress: number): string {
  if (progress >= 100) return '#00ff88';
  if (progress >= 50) return '#ffc800';
  return '#64c8ff';
}
</script>

<template>
  <div class="think-chain-panel">
    <div class="panel-header">
      <div class="header-left">
        <span 
          class="thinking-indicator" 
          :class="{ active: isRunning }"
        ></span>
        <h3>🧠 AI深度思考过程</h3>
      </div>
      <div class="header-stats">
        <span class="stat-badge">{{ thinkSteps.length }} 步</span>
        <span class="stat-badge">{{ snapshot?.tasks?.length || 0 }} 任务</span>
      </div>
    </div>

    <div class="thinking-chain">
      <div
        v-for="(step, index) in thinkSteps"
        :key="step.stepId"
        class="think-step"
        :class="{ 
          expanded: isExpanded(step.stepId),
          running: step.status === 'running',
          done: step.status === 'done'
        }"
      >
        <div 
          class="step-connector"
          @click="toggleExpand(step.stepId)"
        >
          <div class="connector-line"></div>
          <div 
            class="connector-dot"
            :style="{ 
              background: getStepColor(step.kind),
              boxShadow: `0 0 10px ${getStepColor(step.kind)}`
            }"
          >
            <span class="step-number">{{ index + 1 }}</span>
          </div>
        </div>

        <div 
          class="step-content"
          @click="toggleExpand(step.stepId)"
        >
          <div class="step-header">
            <span 
              class="step-icon"
              :style="{ 
                background: getStepBgColor(step.kind),
                borderColor: getStepColor(step.kind)
              }"
            >
              {{ getStepIcon(step.kind) }}
            </span>
            <span class="step-title">{{ step.title }}</span>
            <span 
              class="step-status"
              :style="{ color: step.status === 'done' ? '#00ff88' : '#ffc800' }"
            >
              {{ getStatusLabel(step.status) }}
            </span>
            <div class="step-progress">
              <div 
                class="progress-bar"
                :style="{ 
                  width: `${step.progress}%`,
                  background: getProgressColor(step.progress)
                }"
              ></div>
            </div>
          </div>

          <p class="step-description">{{ step.description }}</p>

          <div v-if="step.subSteps && step.subSteps.length > 0" class="sub-steps">
            <div
              v-for="subStep in step.subSteps"
              :key="subStep.stepId"
              class="sub-step"
              :class="{ done: subStep.status === 'done' }"
            >
              <span class="sub-step-icon">{{ getProviderIcon(subStep.provider) }}</span>
              <span class="sub-step-title">{{ subStep.title }}</span>
              <span 
                class="sub-step-provider"
                :style="{ color: getProviderColor(subStep.provider) }"
              >
                {{ subStep.provider }}
              </span>
              <div class="sub-progress">
                <div 
                  class="progress-bar small"
                  :style="{ 
                    width: `${subStep.progress}%`,
                    background: getProgressColor(subStep.progress)
                  }"
                ></div>
              </div>
              <span class="sub-step-status">{{ getStatusLabel(subStep.status) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="thinkSteps.length === 0" class="empty-state">
        <span class="empty-icon">🧠</span>
        <p>等待AI思考过程...</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.think-chain-panel {
  background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
  border-radius: 16px;
  border: 1px solid rgba(100, 200, 255, 0.15);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(100, 200, 255, 0.1);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.thinking-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4a5568;
  transition: all 0.3s ease;
}

.thinking-indicator.active {
  background: #00ff88;
  box-shadow: 0 0 10px #00ff88;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.2); }
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e6edf3;
  font-weight: 600;
}

.header-stats {
  display: flex;
  gap: 8px;
}

.stat-badge {
  font-size: 12px;
  padding: 4px 12px;
  background: rgba(100, 200, 255, 0.1);
  border-radius: 20px;
  color: #8b92a8;
}

.thinking-chain {
  padding: 20px;
  max-height: 500px;
  overflow-y: auto;
}

.think-step {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  transition: all 0.3s ease;
}

.think-step.running {
  background: rgba(100, 200, 255, 0.05);
  border-radius: 12px;
  padding: 12px;
}

.step-connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
}

.connector-line {
  width: 2px;
  height: 20px;
  background: rgba(100, 200, 255, 0.2);
}

.connector-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.step-number {
  font-size: 12px;
  font-weight: 600;
  color: #0d1117;
}

.step-content {
  flex: 1;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.step-content:hover {
  background: rgba(255, 255, 255, 0.05);
  transform: translateX(4px);
}

.step-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.step-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  border: 1px solid;
}

.step-title {
  font-size: 14px;
  font-weight: 600;
  color: #e6edf3;
}

.step-status {
  font-size: 12px;
  margin-left: auto;
}

.step-progress {
  width: 100px;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
  margin-left: 12px;
}

.progress-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-bar.small {
  height: 4px;
}

.step-description {
  font-size: 13px;
  color: #8b92a8;
  margin: 0;
  line-height: 1.5;
}

.sub-steps {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.sub-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  margin-bottom: 6px;
}

.sub-step.done {
  opacity: 0.7;
}

.sub-step-icon {
  font-size: 14px;
}

.sub-step-title {
  font-size: 12px;
  color: #c0c8d8;
  flex: 1;
}

.sub-step-provider {
  font-size: 10px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.sub-progress {
  width: 60px;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.sub-step-status {
  font-size: 10px;
  color: #8b92a8;
  min-width: 40px;
  text-align: right;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #5a6078;
}

.empty-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}
</style>
