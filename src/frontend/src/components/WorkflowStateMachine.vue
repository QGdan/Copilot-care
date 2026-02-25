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
  ROUTING: '复杂度分流',
  DEBATE: '协同讨论',
  CONSENSUS: '共识收敛',
  REVIEW: '审校复核',
  OUTPUT: '输出结论',
  ESCALATION: '线下上转',
};

const STATUS_LABELS: Record<TriageStreamStageStatus, string> = {
  pending: '等待',
  running: '进行中',
  blocked: '阻断',
  done: '完成',
  failed: '失败',
  skipped: '跳过',
};

const LANE_CONFIG: Array<{ id: string; label: string; stages: WorkflowStage[] }> = [
  {
    id: 'lane-intake',
    label: '输入与评估',
    stages: ['START', 'INFO_GATHER', 'RISK_ASSESS'],
  },
  {
    id: 'lane-routing',
    label: '分流与协同',
    stages: ['ROUTING', 'DEBATE', 'CONSENSUS'],
  },
  {
    id: 'lane-governance',
    label: '治理与输出',
    stages: ['REVIEW', 'OUTPUT', 'ESCALATION'],
  },
];

function formatDuration(runtime: StageRuntimeState): string {
  if (typeof runtime.durationMs === 'number' && runtime.durationMs > 0) {
    if (runtime.durationMs < 1000) {
      return `${runtime.durationMs}ms`;
    }
    return `${(runtime.durationMs / 1000).toFixed(1)}s`;
  }

  if (runtime.status === 'running' && runtime.startTime) {
    const elapsed = Date.now() - new Date(runtime.startTime).getTime();
    if (Number.isFinite(elapsed) && elapsed > 0) {
      return `${(elapsed / 1000).toFixed(1)}s`;
    }
  }

  return '--';
}

function parseRetryCount(message: string): number {
  const match = /重试\s*(\d+)/.exec(message);
  if (!match) {
    return 0;
  }
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : 0;
}

const laneRows = computed(() => {
  return LANE_CONFIG.map((lane) => ({
    ...lane,
    cards: lane.stages.map((stage) => {
      const runtime = props.stageRuntime[stage];
      return {
        stage,
        label: STAGE_LABELS[stage],
        status: runtime.status,
        statusLabel: STATUS_LABELS[runtime.status],
        message: runtime.message,
        durationText: formatDuration(runtime),
        retryCount: parseRetryCount(runtime.message),
        active: props.currentStage === stage,
      };
    }),
  }));
});

const summary = computed(() => {
  const all = Object.values(props.stageRuntime);
  const done = all.filter((runtime) => runtime.status === 'done').length;
  const running = all.filter((runtime) => runtime.status === 'running').length;
  const blocked = all.filter(
    (runtime) => runtime.status === 'blocked' || runtime.status === 'failed',
  ).length;
  return {
    done,
    running,
    blocked,
  };
});

const escalationPathActive = computed(() => {
  if (props.hasRedFlag || props.hasEscalation) {
    return true;
  }
  return props.stageRuntime.ESCALATION.status !== 'pending';
});

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
  <div class="stageboard-container">
    <div class="stageboard-header">
      <h3>多泳道执行看板</h3>
      <div class="summary-row">
        <span class="summary-chip done">完成 {{ summary.done }}</span>
        <span class="summary-chip running">进行中 {{ summary.running }}</span>
        <span class="summary-chip blocked">风险阻断 {{ summary.blocked }}</span>
      </div>
    </div>

    <div class="lane-grid">
      <section v-for="lane in laneRows" :key="lane.id" class="lane-card">
        <header class="lane-head">
          <h4>{{ lane.label }}</h4>
          <small>{{ lane.cards.length }} 阶段</small>
        </header>
        <div class="stage-list">
          <button
            v-for="card in lane.cards"
            :key="card.stage"
            class="stage-card"
            :class="[
              card.status,
              { active: card.active },
              {
                escalation: card.stage === 'ESCALATION' && escalationPathActive,
              },
            ]"
            type="button"
            @click="handleStageClick(card.stage)"
            @mouseenter="handleStageHover(card.stage)"
            @mouseleave="handleStageHoverLeave"
            @focus="handleStageHover(card.stage)"
            @blur="handleStageHoverLeave"
          >
            <div class="stage-card-head">
              <strong>{{ card.label }}</strong>
              <span>{{ card.statusLabel }}</span>
            </div>
            <p>{{ card.message }}</p>
            <div class="stage-card-meta">
              <span>耗时 {{ card.durationText }}</span>
              <span v-if="card.retryCount > 0">重试 {{ card.retryCount }} 次</span>
            </div>
          </button>
        </div>
      </section>
    </div>

    <div class="escalation-path" :class="{ active: escalationPathActive }">
      <strong>上转分支</strong>
      <p>
        <template v-if="escalationPathActive">
          已激活线下上转路径，系统将优先执行安全边界策略。
        </template>
        <template v-else>
          未激活上转分支，默认继续在线协同流程。
        </template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.stageboard-container {
  border: 1px solid #d1dcea;
  border-radius: 10px;
  background:
    radial-gradient(circle at 4% 8%, rgba(226, 247, 255, 0.7), transparent 52%),
    radial-gradient(circle at 96% 92%, rgba(245, 237, 220, 0.55), transparent 44%),
    #ffffff;
  padding: 12px;
}

.stageboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.stageboard-header h3 {
  margin: 0;
  font-size: 14px;
  color: #1a3d58;
}

.summary-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.summary-chip {
  font-size: 11px;
  border-radius: 999px;
  padding: 3px 8px;
  border: 1px solid transparent;
}

.summary-chip.done {
  color: #1f6a43;
  background: #e7f6ee;
  border-color: #9fd6b9;
}

.summary-chip.running {
  color: #1b4f76;
  background: #e8f3ff;
  border-color: #9ec1e1;
}

.summary-chip.blocked {
  color: #8c2f1c;
  background: #ffece7;
  border-color: #efb8ab;
}

.lane-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.lane-card {
  border: 1px solid #cfdae7;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  padding: 8px;
}

.lane-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.lane-head h4 {
  margin: 0;
  font-size: 12px;
  color: #305371;
}

.lane-head small {
  color: #6a8096;
  font-size: 11px;
}

.stage-list {
  margin-top: 8px;
  display: grid;
  gap: 6px;
}

.stage-card {
  width: 100%;
  text-align: left;
  border: 1px solid #d4deea;
  border-radius: 7px;
  background: #f9fcff;
  padding: 8px;
  cursor: pointer;
  color: #274965;
}

.stage-card.active {
  border-color: #1f7b80;
  box-shadow: 0 0 0 1px rgba(31, 123, 128, 0.2);
}

.stage-card.running {
  background: #e8f3ff;
  border-color: #9fc1df;
}

.stage-card.done {
  background: #edf9f1;
  border-color: #a8d7ba;
}

.stage-card.blocked,
.stage-card.failed {
  background: #ffefeb;
  border-color: #efb8ac;
}

.stage-card.skipped {
  background: #f4f4f5;
  border-color: #d6d6d8;
}

.stage-card.escalation {
  border-color: #c3472a;
}

.stage-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.stage-card-head span {
  font-size: 11px;
  color: #496784;
}

.stage-card p {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: #3e607d;
}

.stage-card-meta {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #607a92;
}

.escalation-path {
  margin-top: 10px;
  border-radius: 8px;
  border: 1px dashed #c9d8e6;
  background: #f8fbff;
  padding: 8px;
}

.escalation-path.active {
  border-color: #c3472a;
  background: #fff2ee;
}

.escalation-path strong {
  font-size: 12px;
  color: #31516b;
}

.escalation-path.active strong {
  color: #8f2f1f;
}

.escalation-path p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #4a6883;
}

.escalation-path.active p {
  color: #8f3f2f;
}

@media (max-width: 900px) {
  .stageboard-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .lane-grid {
    grid-template-columns: 1fr;
  }
}
</style>
