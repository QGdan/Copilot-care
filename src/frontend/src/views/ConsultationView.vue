<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import type { WorkflowStage } from '@copilot-care/shared/types';
import {
  useDemoMode,
  createDemoStepsFromReasoning,
  createCompetitionDemoScript,
} from '../composables/useDemoMode';
import { useConsultationChartRuntime } from '../composables/useConsultationChartRuntime';
import { useConsultationStreamState } from '../composables/useConsultationStreamState';
import { useConsultationReportExport } from '../composables/useConsultationReportExport';
import { useConsultationSessionRunner } from '../composables/useConsultationSessionRunner';
import { useConsultationViewModel } from '../composables/useConsultationViewModel';
import { useConsultationViewSync } from '../composables/useConsultationViewSync';
import { useConsultationReasoningMap } from '../composables/useConsultationReasoningMap';
import { useDecisionReasoningCockpit } from '../composables/useDecisionReasoningCockpit';
import { useSplitPaneLayout } from '../composables/useSplitPaneLayout';
import {
  useConsultationInputForm,
  type ConsultationQuickInput,
} from '../composables/useConsultationInputForm';
import {
  type ConsultationReasoningKind,
  type ConsultationStageRuntimeState,
} from '../composables/useConsultationCharts';
import type { VisualizationState } from '../types/visualization';
import ComplexityRoutingTree from '../components/ComplexityRoutingTree.vue';
import ReasoningTraceTimeline from '../components/ReasoningTraceTimeline.vue';
import DemoModePanel from '../components/DemoModePanel.vue';
import ConsultationResultPanel from '../components/ConsultationResultPanel.vue';
import ConsultationInputPanel from '../components/consultation/ConsultationInputPanel.vue';
import ConsultationReasoningCockpitCard from '../components/consultation/ConsultationReasoningCockpitCard.vue';
import ConsultationExecutionMetricsCard from '../components/consultation/ConsultationExecutionMetricsCard.vue';
import {
  COLLABORATION_LABELS,
  DEPARTMENT_LABELS,
  ROUTE_MODE_LABELS,
} from '../constants/triageLabels';
import {
  CONSULTATION_REASONING_KIND_LABELS,
  CONSULTATION_REQUIRED_FIELD_LABELS,
  CONSULTATION_SNAPSHOT_PHASE_LABELS,
  CONSULTATION_STAGE_LABELS,
  CONSULTATION_STATUS_LABELS,
  type ConsultationViewUiStatus,
} from '../constants/consultationCopy';

type UiStatus = ConsultationViewUiStatus;
type ReasoningKind = ConsultationReasoningKind;

interface ChatMessage {
  role: 'user' | 'system';
  content: string;
}

interface StageRuntimeState extends ConsultationStageRuntimeState {
  message: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
}

const FLOW_STAGES: WorkflowStage[] = [
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
const CORE_STAGES: WorkflowStage[] = [
  'START',
  'INFO_GATHER',
  'RISK_ASSESS',
  'ROUTING',
  'DEBATE',
  'CONSENSUS',
  'REVIEW',
  'OUTPUT',
];

const STAGE_LABELS: Record<WorkflowStage, string> = CONSULTATION_STAGE_LABELS;
const STATUS_LABELS: Record<UiStatus, string> = CONSULTATION_STATUS_LABELS;
const REQUIRED_FIELD_LABELS: Record<string, string> =
  CONSULTATION_REQUIRED_FIELD_LABELS;
const REASONING_KIND_LABELS: Record<ReasoningKind, string> =
  CONSULTATION_REASONING_KIND_LABELS;
const SNAPSHOT_PHASE_LABELS = CONSULTATION_SNAPSHOT_PHASE_LABELS;
const ThinkingGraph = defineAsyncComponent(
  () => import('../components/ThinkingGraph.vue'),
);

const QUICK_INPUTS: ConsultationQuickInput[] = [
  {
    label: '血压波动',
    symptomText: '头晕，血压偏高，近期偶发乏力',
    age: 56,
    sex: 'male',
    systolicBPText: '148',
    diastolicBPText: '95',
    chronicDiseasesText: 'Hypertension',
    medicationHistoryText: 'amlodipine',
  },
  {
    label: '红旗排查',
    symptomText: '胸痛，呼吸困难，出冷汗',
    age: 68,
    sex: 'male',
    systolicBPText: '182',
    diastolicBPText: '112',
    chronicDiseasesText: 'Hypertension, Diabetes',
    medicationHistoryText: 'metformin',
  },
  {
    label: '代谢评估',
    symptomText: '近期乏力，多饮多尿，体重下降',
    age: 49,
    sex: 'female',
    systolicBPText: '138',
    diastolicBPText: '88',
    chronicDiseasesText: 'Prediabetes',
  },
];

function createInitialStageRuntime(): Record<WorkflowStage, StageRuntimeState> {
  return {
    START: { status: 'pending', message: '等待启动' },
    INFO_GATHER: { status: 'pending', message: '等待采集信息' },
    RISK_ASSESS: { status: 'pending', message: '等待风险评估' },
    ROUTING: { status: 'pending', message: '等待分流决策' },
    DEBATE: { status: 'pending', message: '等待讨论' },
    CONSENSUS: { status: 'pending', message: '等待共识收敛' },
    REVIEW: { status: 'pending', message: '等待审校复核' },
    OUTPUT: { status: 'pending', message: '等待输出' },
    ESCALATION: { status: 'pending', message: '按需触发' },
  };
}

function formatRequiredField(field: string): string {
  return REQUIRED_FIELD_LABELS[field] ?? field;
}

function classifyReasoningKind(message: string): ReasoningKind {
  const text = message.toLowerCase();
  if (/缺少|补充|required|missing/.test(text)) return 'query';
  if (/错误|异常|红旗|上转|阻断|风险/.test(text)) return 'warning';
  if (/路由|分诊|复杂度|决策|切换|会诊模式/.test(text)) return 'decision';
  if (/证据|依据|指标|评估|指数|检验|化验/.test(text)) return 'evidence';
  return 'system';
}

const {
  layoutRef,
  leftPaneStyle,
  startDragging,
  handleDragging,
  stopDragging,
} = useSplitPaneLayout({
  storageKey: 'copilot-care.split-left-ratio',
  minRatio: 30,
  maxRatio: 70,
  defaultRatio: 42,
});

let reasoningMapNodeClickDelegate: ((nodeId: string) => void) | null = null;
let resetReasoningMapSelectionDelegate: (() => void) | null = null;

function onReasoningMapNodeClick(nodeId: string): void {
  reasoningMapNodeClickDelegate?.(nodeId);
}

const reasoningMapRef = ref<HTMLElement | null>(null);
const {
  reasoningMapChart,
  initializeCharts,
  resizeCharts,
  disposeCharts,
} = useConsultationChartRuntime({
  reasoningMapRef,
  onReasoningMapNodeClick,
});

const {
  form,
  showAdvancedInputs,
  setAdvancedInputsVisible,
  toggleAdvancedInputs,
  applyQuickInput: applyFormQuickInput,
  buildRequestPayload,
  buildExportPatientProfile,
  validateInput,
} = useConsultationInputForm({
  contextVersion: 'v4.30',
  validationMessages: {
    symptomRequired: '请先输入当前症状或需求描述。',
    ageInvalid: '年龄必须是有效数字。',
    systolicNotGreaterThanDiastolic: '收缩压应大于舒张压。',
  },
});

const status = ref<UiStatus>('IDLE');
const microStatus = ref('等待输入需求。');
const {
  clarificationQuestion,
  requiredFields,
  systemError,
  stageRuntime,
  reasoningItems,
  rounds,
  finalConsensus,
  triageResult,
  routeInfo,
  routingPreview,
  explainableReport,
  resultNotes,
  orchestrationSnapshot,
  captureRoutingFromText,
  rememberStageEvent,
  rememberReasoning,
  shouldPushStageNarrative,
  pushReasoning,
  updateStage,
  resetStreamStateCore,
} = useConsultationStreamState({
  createInitialStageRuntime,
});

const messages = ref<ChatMessage[]>([
  {
    role: 'system',
    content: '您好，我是 CoPilot Care。请先输入当前症状或主要需求。',
  },
]);

const patientInsights = ref<string[]>([]);
const patientId = ref<string>('');

const demoMode = useDemoMode();
const competitionDemoScript = createCompetitionDemoScript();

const {
  loading,
  loadingSeconds,
  typedOutput,
  submitConsultation,
  disposeSessionRunner,
} = useConsultationSessionRunner({
  status,
  microStatus,
  showAdvancedInputs,
  messages,
  streamState: {
    clarificationQuestion,
    requiredFields,
    systemError,
    stageRuntime,
    reasoningItems,
    rounds,
    finalConsensus,
    triageResult,
    routeInfo,
    routingPreview,
    explainableReport,
    resultNotes,
    orchestrationSnapshot,
    captureRoutingFromText,
    rememberStageEvent,
    rememberReasoning,
    shouldPushStageNarrative,
    pushReasoning,
    updateStage,
    resetStreamStateCore,
  },
  validateInput,
  buildRequestPayload,
  classifyReasoningKind,
  formatRequiredField,
  stageLabels: STAGE_LABELS,
  statusLabels: STATUS_LABELS,
  snapshotPhaseLabels: SNAPSHOT_PHASE_LABELS,
  createDemoSteps: createDemoStepsFromReasoning,
  initDemoSteps: demoMode.initSteps,
  onResetView: () => {
    resetReasoningMapSelectionDelegate?.();
  },
});

const {
  exportingReport,
  reportExportError,
  reportExportSuccess,
  canExportReport,
  prefetchReportExporter,
  handleExportReport,
} = useConsultationReportExport({
  hasExportableContent: () => {
    return !!triageResult.value
      || !!explainableReport.value
      || typedOutput.value.trim().length > 0;
  },
  buildReportData: () => {
    return {
      patientProfile: buildExportPatientProfile(),
      triageResult: triageResult.value,
      routing: routeInfo.value,
      explainableReport: explainableReport.value,
      conclusion: typedOutput.value,
      actions: explainableReport.value?.actions || [],
      evidence: explainableReport.value?.basis || [],
      notes: resultNotes.value,
    };
  },
});

const hasPrefetchedReportExporter = ref(false);
watch(
  canExportReport,
  (canExport) => {
    if (!canExport || hasPrefetchedReportExporter.value) {
      return;
    }

    hasPrefetchedReportExporter.value = true;
    void prefetchReportExporter();
  },
  { immediate: true },
);

const {
  statusText,
  safetyBlockNote,
  isSafetyBlocked,
  coordinatorTasks,
  coordinatorSummary,
  coordinatorUpdatedAtText,
  coordinatorPhaseText,
  coordinatorSourceKind,
  coordinatorSourceText,
  coordinatorActiveTaskHint,
  stageLegend,
  currentStageInfo,
  progressPercent,
  riskSignal,
  sceneLevel,
  chartDensity,
  reasoningIntegrationMode,
  reasoningIntegrationText,
} = useConsultationViewModel({
  flowStages: FLOW_STAGES,
  coreStages: CORE_STAGES,
  stageLabels: STAGE_LABELS,
  statusLabels: STATUS_LABELS,
  snapshotPhaseLabels: SNAPSHOT_PHASE_LABELS,
  status,
  stageRuntime,
  routeInfo,
  routingPreview,
  resultNotes,
  orchestrationSnapshot,
});

const doneStageCount = computed<number>(() => {
  return stageLegend.value.filter((item) => item.status === 'done').length;
});

const runningStageCount = computed<number>(() => {
  return stageLegend.value.filter((item) => item.status === 'running').length;
});

const blockedStageCount = computed<number>(() => {
  return stageLegend.value.filter((item) => {
    return item.status === 'blocked' || item.status === 'failed';
  }).length;
});

const visualizationState = computed<VisualizationState>(() => {
  if (riskSignal.value === 'critical') {
    return 'blocked';
  }
  if (loading.value) {
    return 'running';
  }
  if (status.value === 'OUTPUT') {
    return 'done';
  }
  return 'idle';
});

const riskSignalLabel = computed<string>(() => {
  if (riskSignal.value === 'critical') {
    return '高风险';
  }
  if (riskSignal.value === 'warning') {
    return '中风险';
  }
  return '常规';
});

const chartDensityLabel = computed<string>(() => {
  return chartDensity.value === 'compact' ? '高密度' : '标准密度';
});

const completedTaskCount = computed<number>(() => {
  return coordinatorTasks.value.filter((task) => task.status === 'done').length;
});

const showMissionEmptyState = computed<boolean>(() => {
  const hasGraphNodes = (orchestrationSnapshot.value?.graph?.nodes?.length ?? 0) > 0;
  const hasGraphEdges = (orchestrationSnapshot.value?.graph?.edges?.length ?? 0) > 0;
  const hasTasks = (orchestrationSnapshot.value?.tasks?.length ?? 0) > 0;
  const hasStream = reasoningItems.value.length > 0 || rounds.value.length > 0;
  const hasResult = !!routeInfo.value || !!triageResult.value || !!finalConsensus.value;
  const hasOutput = typedOutput.value.trim().length > 0;

  return !loading.value
    && !hasGraphNodes
    && !hasGraphEdges
    && !hasTasks
    && !hasStream
    && !hasResult
    && !hasOutput;
});

const {
  showEvidenceBranches,
  selectedReasoningNode,
  toggleEvidenceBranches,
  renderReasoningMap,
  handleReasoningMapNodeClick: handleReasoningMapNodeClickFromState,
  resetReasoningMapSelection,
} = useConsultationReasoningMap({
  reasoningMapChart,
  formSymptomText: computed(() => form.value.symptomText),
  routeInfo,
  routingPreview,
  status,
  statusLabels: STATUS_LABELS,
  explainableReport,
  typedOutput,
  orchestrationSnapshot,
  reasoningItems,
  reasoningKindLabels: REASONING_KIND_LABELS,
  routeModeLabels: ROUTE_MODE_LABELS,
  departmentLabels: DEPARTMENT_LABELS,
  collaborationLabels: COLLABORATION_LABELS,
});

const {
  confidenceBadge,
  contributionCards,
  evidenceDigest,
  simulationPresets,
  selectedSimulationId,
  simulationInsight,
  toggleSimulation,
} = useDecisionReasoningCockpit({
  routeInfo,
  routingPreview,
  explainableReport,
  reasoningItems,
  orchestrationSnapshot,
  routeModeLabels: ROUTE_MODE_LABELS,
});

reasoningMapNodeClickDelegate = handleReasoningMapNodeClickFromState;
resetReasoningMapSelectionDelegate = resetReasoningMapSelection;

useConsultationViewSync({
  stageRuntime,
  reasoningItems,
  routeInfo,
  routingPreview,
  status,
  typedOutput,
  explainableReport,
  orchestrationSnapshot,
  requiredFields,
  renderReasoningMap,
  setAdvancedInputsVisible,
});

function applyQuickInput(input: ConsultationQuickInput): void {
  applyFormQuickInput(input, loading.value);
}

function onResize(): void {
  resizeCharts();
}
function isFieldRequired(field: string): boolean {
  return requiredFields.value.includes(field);
}

function handlePatientSelected(patientIdValue: string): void {
  patientId.value = patientIdValue;
}

function handleInsightsLoaded(insights: string[]): void {
  patientInsights.value = insights;
  if (insights.length > 0) {
    pushReasoning('evidence', `患者洞察：${insights.join('，')}`);
  }
}

function toggleDemoMode(): void {
  if (demoMode.isDemoMode.value) {
    demoMode.exitDemo();
    return;
  }
  if (demoMode.steps.value.length === 0) {
    demoMode.initSteps(competitionDemoScript);
  }
  demoMode.startDemo();
}

function formatStageDuration(stage: WorkflowStage): string {
  const duration = stageRuntime.value[stage]?.durationMs;
  if (typeof duration !== 'number' || duration <= 0) {
    return '--';
  }
  if (duration < 1000) {
    return `${duration}ms`;
  }
  return `${(duration / 1000).toFixed(1)}s`;
}

async function initializeConsultationCharts(): Promise<void> {
  await initializeCharts({
    onReasoningMapReady: renderReasoningMap,
  });
}

onMounted(() => {
  void initializeConsultationCharts();
  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', handleDragging);
  window.addEventListener('mouseup', stopDragging);
});

onBeforeUnmount(() => {
  disposeSessionRunner();
  window.removeEventListener('resize', onResize);
  window.removeEventListener('mousemove', handleDragging);
  window.removeEventListener('mouseup', stopDragging);
  disposeCharts();
});
</script>

<template>
  <div
    ref="layoutRef"
    class="split-layout"
    :class="[`scene-${sceneLevel}`, `risk-${riskSignal}`]"
  >
    <ConsultationInputPanel
      :left-pane-style="leftPaneStyle"
      :loading="loading"
      :quick-inputs="QUICK_INPUTS"
      :form="form"
      :show-advanced-inputs="showAdvancedInputs"
      :clarification-question="clarificationQuestion"
      :required-fields="requiredFields"
      :messages="messages"
      :micro-status="microStatus"
      :loading-seconds="loadingSeconds"
      :current-stage-label="currentStageInfo.label"
      :progress-percent="progressPercent"
      :risk-signal="riskSignal"
      :demo-mode-enabled="demoMode.isDemoMode.value"
      :is-field-required="isFieldRequired"
      :format-required-field="formatRequiredField"
      @apply-quick-input="applyQuickInput"
      @toggle-advanced-inputs="toggleAdvancedInputs"
      @submit-consultation="submitConsultation"
      @toggle-demo-mode="toggleDemoMode"
      @patient-selected="handlePatientSelected"
      @insights-loaded="handleInsightsLoaded"
    />

    <div class="splitter" @mousedown="startDragging">
      <span class="splitter-grip" />
    </div>

    <section class="right-pane">
      <header
        class="mission-hero"
        :class="[`risk-${riskSignal}`, `state-${visualizationState}`]"
      >
        <div class="mission-copy">
          <p class="mission-kicker">Clinical Mission Control</p>
          <h2>会诊指挥舱</h2>
          <p>{{ coordinatorActiveTaskHint }}</p>
        </div>
        <div class="mission-tags">
          <span class="status-chip">{{ currentStageInfo.label }}</span>
          <span class="status-chip">{{ statusText }}</span>
          <span class="status-chip">风险：{{ riskSignalLabel }}</span>
          <span class="status-chip">图表：{{ chartDensityLabel }}</span>
        </div>
        <div class="mission-kpis">
          <article class="kpi-card">
            <small>流程进度</small>
            <strong>{{ progressPercent }}%</strong>
          </article>
          <article class="kpi-card">
            <small>任务完成</small>
            <strong>{{ completedTaskCount }}/{{ coordinatorTasks.length }}</strong>
          </article>
          <article class="kpi-card">
            <small>审校阻断</small>
            <strong>{{ blockedStageCount }}</strong>
          </article>
          <article class="kpi-card">
            <small>推理来源</small>
            <strong>{{ coordinatorSourceText }}</strong>
          </article>
        </div>
      </header>

      <section v-if="showMissionEmptyState" class="panel-card mission-empty-state">
        <div class="mission-empty-head">
          <h3>等待会诊启动</h3>
          <span class="status-chip">右侧将实时联动</span>
        </div>
        <p class="mission-empty-desc">
          完成左侧输入后，这里会自动生成多 Agent 推理网络、复杂度路由树与执行指标。
        </p>
        <div class="mission-empty-checklist">
          <span>1. 录入核心症状</span>
          <span>2. 选填年龄与生命体征</span>
          <span>3. 提交会诊并观察推理轨迹</span>
        </div>
        <div class="mission-empty-actions">
          <button class="ghost-btn" type="button" @click="applyQuickInput(QUICK_INPUTS[0])">
            填入示例病例
          </button>
          <small>当前状态：{{ microStatus }}</small>
        </div>
      </section>

      <!-- 多Agent任务-推理一体化导图 -->
      <ThinkingGraph
        :nodes="orchestrationSnapshot?.graph?.nodes || []"
        :edges="orchestrationSnapshot?.graph?.edges || []"
        :tasks="orchestrationSnapshot?.tasks || []"
        :phase-text="coordinatorPhaseText"
        :source-text="coordinatorSourceText"
        :source-kind="coordinatorSourceKind"
        :updated-at-text="coordinatorUpdatedAtText"
        :summary="coordinatorSummary"
        :active-task-hint="coordinatorActiveTaskHint"
        :integration-text="reasoningIntegrationText"
        :integration-mode="reasoningIntegrationMode"
        :is-running="loading"
        :state="visualizationState"
        :density="chartDensity"
      />

      <ConsultationReasoningCockpitCard
        :confidence-badge="confidenceBadge"
        :contribution-cards="contributionCards"
        :evidence-digest="evidenceDigest"
        :simulation-presets="simulationPresets"
        :selected-simulation-id="selectedSimulationId"
        :simulation-insight="simulationInsight"
        :state="visualizationState"
        :density="chartDensity"
        @toggle-simulation="toggleSimulation"
      />

      <div class="panel-card">
        <div class="panel-head-row">
          <h3>深度推理图</h3>
          <div class="panel-head-actions">
            <button class="ghost-btn" type="button" @click="toggleEvidenceBranches">
              {{ showEvidenceBranches ? '折叠证据分支' : '展开证据分支' }}
            </button>
            <span class="status-chip">{{ currentStageInfo.label }}</span>
          </div>
        </div>
        <div ref="reasoningMapRef" class="reasoning-map-chart" />
        <p class="map-caption">{{ reasoningIntegrationText }}</p>
        <div v-if="selectedReasoningNode" class="map-detail-card">
          <h4>{{ selectedReasoningNode.title }}</h4>
          <p class="map-detail-summary">{{ selectedReasoningNode.summary }}</p>
          <pre
            v-if="selectedReasoningNode.raw && selectedReasoningNode.raw !== selectedReasoningNode.summary"
            class="map-detail-raw"
          >{{ selectedReasoningNode.raw }}</pre>
        </div>
      </div>

      <div class="two-col-grid metrics-grid">
        <div class="panel-card">
          <ComplexityRoutingTree
            :routing="routeInfo ?? routingPreview"
            :has-red-flag="status === 'ESCALATE_TO_OFFLINE'"
            :current-stage="currentStageInfo.stage"
            :state="visualizationState"
            :density="chartDensity"
          />
        </div>

        <ConsultationExecutionMetricsCard
          :current-stage-label="currentStageInfo.label"
          :progress-percent="progressPercent"
          :done-stage-count="doneStageCount"
          :running-stage-count="runningStageCount"
          :blocked-stage-count="blockedStageCount"
          :stage-legend="stageLegend"
          :format-stage-duration="formatStageDuration"
        />
      </div>

      <div class="panel-card">
        <ReasoningTraceTimeline
          :items="reasoningItems"
          :current-stage="currentStageInfo.stage"
          :max-items="100"
        />
        <p v-if="systemError" class="status-line">错误码：{{ systemError }}</p>
      </div>

      <div class="panel-card">
        <h3>生成建议（打字机输出）</h3>
        <pre class="typewriter-output">{{ typedOutput || '等待模型输出...' }}<span v-if="loading" class="typing-caret">|</span></pre>
      </div>

      <ConsultationResultPanel
        v-if="routeInfo || triageResult || finalConsensus"
        :route-info="routeInfo"
        :triage-result="triageResult"
        :explainable-report="explainableReport"
        :final-consensus="finalConsensus"
        :result-notes="resultNotes"
        :is-safety-blocked="isSafetyBlocked"
        :safety-block-note="safetyBlockNote"
        :can-export-report="canExportReport"
        :exporting-report="exportingReport"
        :report-export-error="reportExportError"
        :report-export-success="reportExportSuccess"
        @export="handleExportReport"
      />

      <div v-if="rounds.length > 0" class="panel-card">
        <h3>会诊轮次</h3>
        <article v-for="round in rounds" :key="round.roundNumber" class="round-card">
          <strong>第 {{ round.roundNumber }} 轮</strong>
          <span class="round-meta">分歧指数 {{ round.dissentIndex.toFixed(3) }}</span>
          <ul>
            <li v-for="opinion in round.opinions" :key="`${round.roundNumber}-${opinion.agentId}`">
              {{ opinion.agentName }}（{{ opinion.riskLevel }}）：{{ opinion.reasoning }}
            </li>
          </ul>
        </article>
      </div>
    </section>

    <DemoModePanel
      :steps="demoMode.steps.value"
      :current-step-index="demoMode.currentStepIndex.value"
      :is-demo-mode="demoMode.isDemoMode.value"
      :is-paused="demoMode.isPaused.value"
      :auto-play="demoMode.autoPlay.value"
      :speed="demoMode.speed.value"
      @toggle-demo="toggleDemoMode"
      @toggle-pause="demoMode.togglePause()"
      @toggle-auto="demoMode.toggleAutoPlay()"
      @reset="demoMode.resetDemo()"
      @prev="demoMode.prevStep()"
      @next="demoMode.nextStep()"
      @go-to="demoMode.goToStep"
      @set-speed="demoMode.setSpeed"
      @exit="demoMode.exitDemo()"
    />
  </div>
</template>

<style scoped>
.split-layout {
  --ink: var(--cc-text-strong);
  --muted: var(--cc-text-muted);
  --line: var(--cc-border-body);
  --surface-left: color-mix(in srgb, var(--cc-surface-1) 92%, #f6ead6);
  --surface-right: color-mix(in srgb, var(--cc-surface-1) 88%, #edf5fd);
  --card: var(--cc-surface-1);
  --accent: var(--cc-accent-teal-500);
  --danger: var(--cc-danger-500);
  height: 100vh;
  display: flex;
  color: var(--ink);
  background: var(--cc-scene-consultation);
  font-family: var(--font-sans);
}

.split-layout.scene-briefing {
  background: var(--cc-scene-consultation);
}

.split-layout.scene-active {
  background:
    radial-gradient(circle at 100% 0%, rgba(45, 122, 166, 0.22), transparent 40%),
    var(--cc-scene-consultation);
}

.split-layout.scene-critical {
  background:
    radial-gradient(circle at 96% 2%, rgba(193, 74, 53, 0.22), transparent 42%),
    var(--cc-scene-consultation);
}

.right-pane {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  box-sizing: border-box;
  flex: 1;
  background:
    radial-gradient(circle at 100% -4%, rgba(32, 114, 161, 0.22), transparent 42%),
    linear-gradient(180deg, var(--surface-right) 0%, color-mix(in srgb, #f9fcff 90%, var(--surface-right)) 100%);
}

.mission-hero {
  position: relative;
  overflow: hidden;
  margin-bottom: 12px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--line) 82%, transparent);
  padding: 16px;
  background:
    radial-gradient(circle at 100% 0%, rgba(58, 140, 186, 0.2), transparent 42%),
    radial-gradient(circle at 0% 100%, rgba(51, 163, 148, 0.17), transparent 46%),
    color-mix(in srgb, var(--card) 93%, transparent);
  box-shadow: 0 12px 26px rgba(14, 56, 93, 0.1);
}

.mission-hero::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--cc-accent-teal-500) 42%, transparent) 0%,
    color-mix(in srgb, var(--cc-accent-cyan-500) 62%, transparent) 50%,
    color-mix(in srgb, var(--cc-accent-amber-500) 55%, transparent) 100%
  );
}

.mission-kicker {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--muted) 86%, transparent);
}

.mission-copy h2 {
  margin: 4px 0 6px;
  font-size: 25px;
  letter-spacing: 0.01em;
}

.mission-copy p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.mission-tags {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mission-kpis {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
  border-radius: 10px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--card) 92%, transparent);
}

.kpi-card small {
  font-size: 11px;
  color: var(--muted);
}

.kpi-card strong {
  font-size: 17px;
  line-height: 1;
  color: var(--ink);
}

.mission-hero.state-running {
  border-color: color-mix(in srgb, var(--cc-accent-cyan-500) 46%, var(--line));
}

.mission-hero.state-done {
  border-color: color-mix(in srgb, var(--cc-success-500) 52%, var(--line));
}

.mission-hero.state-blocked,
.mission-hero.risk-critical {
  border-color: color-mix(in srgb, var(--cc-danger-500) 56%, var(--line));
}

.mission-empty-state {
  border-style: dashed;
  background:
    linear-gradient(150deg, rgba(236, 245, 254, 0.78), rgba(241, 250, 247, 0.76)),
    var(--card);
}

.mission-empty-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.mission-empty-head h3 {
  margin: 0;
  font-size: 18px;
  color: #214a67;
}

.mission-empty-desc {
  margin: 8px 0 0;
  color: #446681;
  font-size: 13px;
  line-height: 1.5;
}

.mission-empty-checklist {
  margin-top: 10px;
  display: grid;
  gap: 6px;
  color: #2f5878;
  font-size: 12px;
}

.mission-empty-actions {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.mission-empty-actions small {
  color: #557691;
  font-size: 12px;
}

.two-col-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.metrics-grid {
  margin-bottom: 12px;
}

.splitter {
  width: 10px;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #dae3ed 0%, #c6d3e0 100%);
}

.splitter-grip {
  width: 3px;
  height: 60px;
  border-radius: 99px;
  background: #73889d;
}

.pane-header h2 {
  margin: 0;
  font-size: 22px;
}

.pane-header p {
  margin: 6px 0 14px;
  color: var(--muted);
  font-size: 13px;
}

.panel-card {
  background: var(--card);
  border: 1px solid color-mix(in srgb, var(--line) 88%, transparent);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 12px;
  box-shadow: 0 8px 20px rgba(17, 44, 72, 0.08);
}

.panel-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.panel-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-chip {
  font-size: 12px;
  color: color-mix(in srgb, var(--cc-accent-teal-600) 88%, #1f4157);
  background: color-mix(in srgb, var(--cc-accent-teal-500) 10%, var(--card));
  border: 1px solid color-mix(in srgb, var(--cc-accent-teal-500) 28%, var(--line));
  border-radius: 999px;
  padding: 2px 10px;
}

.ghost-btn {
  border: 1px solid #9eb6cc;
  background: #f8fcff;
  color: #2f5878;
  border-radius: 8px;
  font-size: 12px;
  padding: 4px 9px;
  cursor: pointer;
}

.ghost-btn:hover {
  border-color: #79a1c2;
  background: #eef7ff;
}

.reasoning-map-chart {
  width: 100%;
  height: 300px;
  border: 1px solid #d7e1ec;
  border-radius: 10px;
  background:
    radial-gradient(circle at 0% 0%, rgba(234, 245, 255, 0.8), transparent 45%),
    radial-gradient(circle at 100% 100%, rgba(230, 250, 244, 0.7), transparent 45%),
    #fbfdff;
}

.map-caption {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.map-detail-card {
  margin-top: 10px;
  border: 1px solid #d3deea;
  border-radius: 9px;
  background: #f9fcff;
  padding: 10px;
}

.map-detail-card h4 {
  margin: 0 0 6px;
  font-size: 14px;
  color: #244764;
}

.map-detail-summary {
  margin: 0;
  font-size: 13px;
  color: #385a75;
  line-height: 1.5;
}

.map-detail-raw {
  margin: 8px 0 0;
  max-height: 120px;
  overflow-y: auto;
  background: #ffffff;
  border: 1px dashed #c2d1e0;
  border-radius: 8px;
  padding: 8px;
  font-size: 12px;
  white-space: pre-wrap;
  line-height: 1.45;
  color: #32506a;
}

.status-line {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 13px;
}

.typewriter-output {
  margin: 0;
  min-height: 110px;
  max-height: 260px;
  overflow-y: auto;
  white-space: pre-wrap;
  line-height: 1.6;
  background: #fbfeff;
  border: 1px dashed #c0d0df;
  border-radius: 8px;
  padding: 10px;
  font-size: 14px;
}

.typing-caret {
  display: inline-block;
  margin-left: 2px;
  color: #0e8d8f;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%,
  45% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

.round-card {
  border: 1px solid #d3deea;
  border-radius: 8px;
  padding: 10px;
  margin-top: 8px;
  background: #fcfdff;
}

.round-meta {
  margin-left: 10px;
  font-size: 12px;
  color: var(--muted);
}

@media (max-width: 1100px) {
  .split-layout {
    flex-direction: column;
    height: auto;
    min-height: 100vh;
  }

  .mission-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .two-col-grid {
    grid-template-columns: 1fr;
  }

  .panel-head-row {
    align-items: flex-start;
  }

  .panel-head-actions {
    width: 100%;
    justify-content: space-between;
  }

  .right-pane {
    width: 100% !important;
    height: auto;
    max-height: none;
  }

  .splitter {
    width: 100%;
    height: 10px;
    cursor: row-resize;
  }

  .splitter-grip {
    width: 64px;
    height: 3px;
  }
}

@media (max-width: 760px) {
  .mission-copy h2 {
    font-size: 21px;
  }

  .mission-kpis {
    grid-template-columns: 1fr;
  }

  .right-pane {
    padding: 12px;
  }
}

</style>







