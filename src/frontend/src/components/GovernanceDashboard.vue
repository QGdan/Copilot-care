<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type {
  TriageStreamStageStatus,
  WorkflowStage,
} from '@copilot-care/shared/types';
import { useGovernanceDashboard } from '../composables/useGovernanceDashboard';
import WorkflowLayerMatrix from './WorkflowLayerMatrix.vue';
import WorkflowStateMachine from './WorkflowStateMachine.vue';
import ExecutionNeuralTopology from './ExecutionNeuralTopology.vue';
import {
  GOVERNANCE_COLOR_BY_STATUS,
  METRIC_STATUS_LABELS,
  MILESTONE_STATUS_LABELS,
  RISK_SEVERITY_LABELS,
  type RiskTrigger,
} from '../features/governance/model';

interface QueueOverview {
  pending: number;
  reviewing: number;
  approved: number;
  rejected: number;
}

interface StageRuntimeState {
  status: TriageStreamStageStatus;
  message: string;
  durationMs?: number;
}

type QueueFilter = 'all' | 'pending' | 'reviewing' | 'approved' | 'rejected';
type AgentStance = 'support' | 'caution' | 'oppose';
type RoutingSignalLevel = 'positive' | 'neutral' | 'negative';
type TraceIntegrity = 'verified' | 'partial';
type OrchestratorTaskState = 'done' | 'running' | 'blocked' | 'pending';
type OrchestratorLane = 'planner' | 'executor' | 'reviewer';
type LatencyHeatBand = 'stable' | 'warm' | 'hot';

interface AgentReasoningNode {
  id: string;
  agent: string;
  domain: string;
  stance: AgentStance;
  confidence: number;
  citations: number;
  latencyMs: number;
  stage: WorkflowStage;
  keyEvidence: string;
  nextAction: string;
}

interface RoutingFactorNode {
  id: string;
  factor: string;
  contribution: number;
  stage: WorkflowStage;
  threshold: string;
  evidence: string;
  level: RoutingSignalLevel;
}

interface BackendTraceNode {
  id: string;
  stage: WorkflowStage;
  event: string;
  source: string;
  timestamp: string;
  checksum: string;
  integrity: TraceIntegrity;
}

interface OrchestratorTaskNode {
  id: string;
  lane: OrchestratorLane;
  task: string;
  owner: string;
  state: OrchestratorTaskState;
  durationMs: number;
  dependsOn: string[];
}

interface LatencyHeatNode {
  id: string;
  stage: WorkflowStage;
  latencyMs: number;
  retryCount: number;
  heat: number;
  band: LatencyHeatBand;
}

interface ScenarioEvidence {
  id: string;
  group: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  testCase: 'T-007' | 'T-008' | 'T-009' | 'T-010' | 'T-011' | 'T-012';
  title: string;
  input: string;
  trigger: string;
  output: string;
}

interface Props {
  queueOverview?: QueueOverview;
  externalFocusStage?: WorkflowStage | null;
}

interface Emits {
  (e: 'queue-filter-change', filter: QueueFilter): void;
}

const props = withDefaults(defineProps<Props>(), {
  queueOverview: () => ({
    pending: 0,
    reviewing: 0,
    approved: 0,
    rejected: 0,
  }),
  externalFocusStage: null,
});

const emit = defineEmits<Emits>();

const {
  metrics,
  milestones,
  riskTriggers,
  loading,
  lastUpdated,
  overallProgress,
  breachedMetrics,
  atRiskMetrics,
  unacknowledgedTriggers,
  refresh,
  acknowledgeTrigger,
} = useGovernanceDashboard();

const completedMilestones = computed<number>(
  () => milestones.value.filter((item) => item.status === 'done').length,
);

const progressSummary = computed<string>(() => {
  const totalMilestones = milestones.value.length;
  if (totalMilestones === 0) {
    return '当前无里程碑数据。';
  }

  return `按里程碑任务项完成度加权计算（${completedMilestones.value}/${totalMilestones} 已完成）。`;
});

const STAGE_LABELS: Record<WorkflowStage, string> = {
  START: '启动',
  INFO_GATHER: '信息采集',
  RISK_ASSESS: '风险评估',
  ROUTING: '复杂度路由',
  DEBATE: '多 Agent 协同',
  CONSENSUS: '共识收敛',
  REVIEW: '安全复核',
  OUTPUT: '输出归档',
  ESCALATION: '上转处置',
};

const FILTER_LABELS: Record<QueueFilter, string> = {
  all: '全部',
  pending: '待复核',
  reviewing: '复核中',
  approved: '已通过',
  rejected: '已驳回',
};

const STREAM_STATUS_LABELS: Record<TriageStreamStageStatus, string> = {
  pending: '待执行',
  running: '执行中',
  blocked: '阻断',
  done: '完成',
  failed: '失败',
  skipped: '跳过',
};

const ORDERED_STAGES: WorkflowStage[] = [
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

const AGENT_NODE_BASE: Array<{
  id: string;
  agent: string;
  domain: string;
  stage: WorkflowStage;
  keyEvidence: string;
  nextAction: string;
}> = [
  {
    id: 'AG-ROUTER',
    agent: 'Router Agent',
    domain: '复杂度路由',
    stage: 'ROUTING',
    keyEvidence: '病例结构完整度 + 风险阈值信号',
    nextAction: '更新路由模式并同步审计说明',
  },
  {
    id: 'AG-CARDIO',
    agent: 'Cardio Agent',
    domain: '心血管风险',
    stage: 'DEBATE',
    keyEvidence: '血压波动窗口 + 既往史匹配',
    nextAction: '补充并行证据引用并压缩不确定项',
  },
  {
    id: 'AG-META',
    agent: 'Metabolic Agent',
    domain: '代谢评估',
    stage: 'CONSENSUS',
    keyEvidence: '代谢随访曲线 + 药物依从性',
    nextAction: '校正长期风险与随访建议权重',
  },
  {
    id: 'AG-SAFETY',
    agent: 'Safety Guard',
    domain: '安全约束',
    stage: 'REVIEW',
    keyEvidence: '阻断规则 + 复核意见一致性',
    nextAction: '执行链路放行或上转分支',
  },
];

const ROUTING_FACTOR_BASE: Array<{
  id: string;
  factor: string;
  stage: WorkflowStage;
  threshold: string;
  evidence: string;
}> = [
  {
    id: 'RF-001',
    factor: '红旗风险密度',
    stage: 'RISK_ASSESS',
    threshold: '>= 1 个严重风险',
    evidence: 'riskTriggers + 命中安全规则',
  },
  {
    id: 'RF-002',
    factor: '多 Agent 分歧跨度',
    stage: 'CONSENSUS',
    threshold: '>= 18%',
    evidence: 'agent confidence spread',
  },
  {
    id: 'RF-003',
    factor: '复核队列负载',
    stage: 'REVIEW',
    threshold: '>= 3 项',
    evidence: 'pending + reviewing',
  },
  {
    id: 'RF-004',
    factor: '闭环完成抵扣',
    stage: 'OUTPUT',
    threshold: '>= 75%',
    evidence: 'governanceScore',
  },
];

const SCENARIO_EVIDENCE_WALL: ScenarioEvidence[] = [
  {
    id: 'EVI-A',
    group: 'A',
    testCase: 'T-007',
    title: '缺失关键主诉字段',
    input: '未提供持续时间与既往史，信息不完整。',
    trigger: 'ERR_MISSING_REQUIRED_DATA',
    output: '阻断自动结论，要求最小信息集补录。',
  },
  {
    id: 'EVI-B',
    group: 'B',
    testCase: 'T-008',
    title: '生命体征异常与噪声混入',
    input: '血压采样出现突增，存在设备漂移噪声。',
    trigger: 'ERR_INVALID_VITAL_SIGN',
    output: '切换人工核验并标记传感器校准任务。',
  },
  {
    id: 'EVI-C',
    group: 'C',
    testCase: 'T-009',
    title: '多 Agent 分歧未收敛',
    input: '心血管与代谢意见冲突且证据置信不足。',
    trigger: 'ERR_LOW_CONFIDENCE_ABSTAIN',
    output: '降级为只读评估并强制进入安全复核。',
  },
  {
    id: 'EVI-D',
    group: 'D',
    testCase: 'T-010',
    title: '临床安全约束触发',
    input: '存在高危药物相互作用且缺少监测计划。',
    trigger: 'ERR_ESCALATE_TO_OFFLINE',
    output: '自动上转线下会诊，锁定线上执行。',
  },
  {
    id: 'EVI-E',
    group: 'E',
    testCase: 'T-011',
    title: '提示注入攻击检测',
    input: '请求包含规避安全规则的恶意指令。',
    trigger: 'ERR_ADVERSARIAL_PROMPT_DETECTED',
    output: '拒绝生成并记录安全审计事件。',
  },
  {
    id: 'EVI-F',
    group: 'F',
    testCase: 'T-012',
    title: '模型响应超时回退',
    input: '主模型持续超时，超过重试阈值。',
    trigger: 'ERR_LLM_TIMEOUT',
    output: '切换降级模型并保留复核提示。',
  },
];

const BRIEFING_SCRIPT_STEPS = [
  '第 1 分钟：展示后端执行神经网络与当前焦点阶段。',
  '第 2 分钟：解释多 Agent 分歧收敛矩阵与复杂度路由因果树。',
  '第 3 分钟：联动审计溯源流、编排依赖图与证据墙完成闭环说明。',
];

const selectedStage = ref<WorkflowStage | null>(null);
const hoverStage = ref<WorkflowStage | null>(null);
const activeQueueFilter = ref<QueueFilter>('all');
const replayEnabled = ref(false);
const replayPlaying = ref(false);
const replayIndex = ref(0);
const briefingMode = ref(false);
const highContrastMode = ref(false);
const reducedMotionPreferred = ref(false);
const selectedEvidenceId = ref<string>(SCENARIO_EVIDENCE_WALL[0].id);
let replayTimer: ReturnType<typeof setInterval> | null = null;

const governanceScore = computed<number>(() => {
  const total = props.queueOverview.pending
    + props.queueOverview.reviewing
    + props.queueOverview.approved
    + props.queueOverview.rejected;
  if (total === 0) {
    return 0;
  }

  return Math.round(
    ((props.queueOverview.approved + props.queueOverview.rejected) / total) * 100,
  );
});

const governanceStageRuntime = computed<Record<WorkflowStage, StageRuntimeState>>(() => {
  const hasBreachedMetric = metrics.value.some((item) => item.status === 'breached');
  const hasAtRiskMetric = metrics.value.some((item) => item.status === 'at_risk');
  const reviewPressure = props.queueOverview.pending + props.queueOverview.reviewing;
  const closedCases = props.queueOverview.approved + props.queueOverview.rejected;
  const hasCriticalRisk = riskTriggers.value.some((item) => {
    return !item.acknowledged && item.severity === 'critical';
  });
  const hasEscalation = props.queueOverview.rejected > 0 || hasCriticalRisk;

  return {
    START: {
      status: lastUpdated.value ? 'done' : 'pending',
      message: lastUpdated.value ? '治理快照已加载。' : '等待治理快照加载。',
    },
    INFO_GATHER: {
      status: reviewPressure > 0 ? 'running' : closedCases > 0 ? 'done' : 'pending',
      message: reviewPressure > 0
        ? `复核队列处理中（${reviewPressure} 项）`
        : '复核输入已收敛。',
    },
    RISK_ASSESS: {
      status: hasCriticalRisk
        ? 'blocked'
        : unacknowledgedTriggers.value.length > 0
          ? 'running'
          : 'done',
      message: unacknowledgedTriggers.value.length > 0
        ? `待确认触发器 ${unacknowledgedTriggers.value.length} 条。`
        : '风险触发器已处置。',
    },
    ROUTING: {
      status: hasBreachedMetric
        ? 'blocked'
        : hasAtRiskMetric
          ? 'running'
          : metrics.value.length > 0
            ? 'done'
            : 'pending',
      message: hasBreachedMetric
        ? '存在超阈值指标，需要暂停自动链路。'
        : hasAtRiskMetric
          ? '指标处于风险走廊，持续观察中。'
          : '路由指标状态稳定。',
    },
    DEBATE: {
      status: props.queueOverview.reviewing > 0
        ? 'running'
        : closedCases > 0
          ? 'done'
          : 'pending',
      message: props.queueOverview.reviewing > 0
        ? `多 Agent 复核中（${props.queueOverview.reviewing} 项）`
        : '多 Agent 复核已完成。',
    },
    CONSENSUS: {
      status: governanceScore.value >= 75 && closedCases > 0
        ? 'done'
        : reviewPressure > 0
          ? 'running'
          : 'pending',
      message: governanceScore.value >= 75
        ? `闭环完成率 ${governanceScore.value}%`
        : '共识尚未收敛到阈值。',
    },
    REVIEW: {
      status: reviewPressure > 0 ? 'running' : closedCases > 0 ? 'done' : 'pending',
      message: reviewPressure > 0
        ? `治理审校中（${reviewPressure} 项）`
        : '治理审校完成。',
    },
    OUTPUT: {
      status: reviewPressure === 0 && closedCases > 0
        ? 'done'
        : props.queueOverview.approved > 0
          ? 'running'
          : 'pending',
      message: reviewPressure === 0 && closedCases > 0
        ? '输出归档与审计完成。'
        : '等待复核通过后归档。',
    },
    ESCALATION: {
      status: hasEscalation ? 'running' : 'pending',
      message: hasEscalation
        ? '存在驳回/上转分支，需要人工跟进。'
        : '未触发上转分支。',
    },
  };
});

const governanceCurrentStage = computed<WorkflowStage>(() => {
  const blocked = ORDERED_STAGES.find((stage) => {
    const status = governanceStageRuntime.value[stage].status;
    return status === 'blocked' || status === 'failed';
  });
  if (blocked) {
    return blocked;
  }

  const running = ORDERED_STAGES.find((stage) => {
    return governanceStageRuntime.value[stage].status === 'running';
  });
  if (running) {
    return running;
  }

  const done = [...ORDERED_STAGES].reverse().find((stage) => {
    return governanceStageRuntime.value[stage].status === 'done';
  });
  return done ?? 'START';
});

const replaySequence = computed(() => {
  return ORDERED_STAGES.map((stage) => ({
    stage,
    status: governanceStageRuntime.value[stage].status,
    message: governanceStageRuntime.value[stage].message,
  }));
});

const replayStage = computed<WorkflowStage>(() => {
  const maxIndex = Math.max(0, replaySequence.value.length - 1);
  const index = Math.min(replayIndex.value, maxIndex);
  return replaySequence.value[index]?.stage ?? governanceCurrentStage.value;
});

const visualFocusStage = computed<WorkflowStage>(() => {
  if (replayEnabled.value) {
    return replayStage.value;
  }
  if (props.externalFocusStage) {
    return props.externalFocusStage;
  }
  return governanceCurrentStage.value;
});

const governanceHasRedFlag = computed<boolean>(() => {
  return governanceStageRuntime.value.RISK_ASSESS.status === 'blocked'
    || governanceStageRuntime.value.ROUTING.status === 'blocked';
});

const governanceHasEscalation = computed<boolean>(() => {
  return governanceStageRuntime.value.ESCALATION.status === 'running';
});

const detailStage = computed<WorkflowStage>(() => {
  return selectedStage.value ?? visualFocusStage.value;
});

const focusStage = computed<WorkflowStage>(() => {
  return hoverStage.value ?? detailStage.value;
});

const focusModeLabel = computed<string>(() => {
  return hoverStage.value ? '悬停联动' : '固定焦点';
});

const selectedStageDetail = computed<StageRuntimeState>(() => {
  return governanceStageRuntime.value[focusStage.value];
});

const replayStageDetail = computed<StageRuntimeState>(() => {
  return governanceStageRuntime.value[visualFocusStage.value];
});

const stageFocusStatusLabel = computed<string>(() => {
  return STREAM_STATUS_LABELS[selectedStageDetail.value.status];
});

const focusChecklist = computed<string[]>(() => {
  if (focusStage.value === 'RISK_ASSESS') {
    return [
      '确认红旗信号证据是否齐全。',
      '核对风险阈值命中原因。',
      '必要时立即锁定上转分支。',
    ];
  }
  if (focusStage.value === 'ROUTING') {
    return [
      '复核复杂度评分与路由模式。',
      '确认协同模式是否匹配当前病例。',
      '保留路由切换的审计说明。',
    ];
  }
  if (focusStage.value === 'DEBATE' || focusStage.value === 'CONSENSUS') {
    return [
      '检查多 Agent 观点是否覆盖核心证据。',
      '确认分歧项已被收敛或解释。',
      '评估是否满足进入审校条件。',
    ];
  }
  if (focusStage.value === 'REVIEW' || focusStage.value === 'ESCALATION') {
    return [
      '核对安全边界与阻断条件。',
      '确认人工复核意见已记录。',
      '同步驳回或上转后的后续动作。',
    ];
  }
  if (focusStage.value === 'OUTPUT') {
    return [
      '确认输出结论可追溯。',
      '检查报告归档与审计链条完整性。',
      '验证交接建议与随访计划一致。',
    ];
  }

  return [
    '确认输入质量与基础信息完整。',
    '检查阶段状态是否符合预期。',
    '必要时锁定焦点并推进复核队列。',
  ];
});

const focusActionHint = computed<string>(() => {
  if (
    selectedStageDetail.value.status === 'blocked'
    || selectedStageDetail.value.status === 'failed'
  ) {
    return '当前阶段阻断，建议先执行风险排查与人工复核，再恢复主链路。';
  }
  if (selectedStageDetail.value.status === 'running') {
    return '当前阶段执行中，建议保持同层闭环并持续跟踪超时风险。';
  }
  if (selectedStageDetail.value.status === 'done') {
    return '当前阶段已完成，可推进下一阶段并保留审计说明。';
  }
  return '当前阶段尚未启动，建议确认上游依赖与输入完整性。';
});

const briefingStatusText = computed<string>(() => {
  if (briefingMode.value) {
    return '答辩模式已开启，界面聚焦 3 分钟演示主链路。';
  }
  return '答辩模式已关闭，显示完整治理运营视图。';
});

const agentReasoningNodes = computed<AgentReasoningNode[]>(() => {
  const reviewPressure = props.queueOverview.pending + props.queueOverview.reviewing;
  const queuePenalty = Math.min(0.18, reviewPressure * 0.03);
  const triggerPenalty = Math.min(0.15, unacknowledgedTriggers.value.length * 0.05);

  const clampConfidence = (value: number): number => {
    return Math.max(0.45, Math.min(0.97, value));
  };

  return AGENT_NODE_BASE.map((entry, index) => {
    let stance: AgentStance = 'support';
    if (
      entry.id === 'AG-SAFETY'
      && (governanceHasEscalation.value || unacknowledgedTriggers.value.length > 0)
    ) {
      stance = 'oppose';
    } else if (
      governanceHasRedFlag.value
      || reviewPressure > 2
      || (entry.id === 'AG-META' && governanceScore.value < 75)
    ) {
      stance = 'caution';
    }

    const confidenceLoss = queuePenalty
      + triggerPenalty
      + (stance === 'oppose' ? 0.14 : stance === 'caution' ? 0.08 : 0.03);
    const confidence = clampConfidence(0.94 - index * 0.04 - confidenceLoss);

    return {
      ...entry,
      stance,
      confidence,
      citations: 3 + index + (stance === 'oppose' ? 1 : 0),
      latencyMs: 760 + reviewPressure * 140 + index * 110 + (stance === 'oppose' ? 230 : 0),
      nextAction: stance === 'oppose'
        ? '阻断自动放行并进入人工安全复核'
        : entry.nextAction,
    };
  });
});

const consensusIndex = computed<number>(() => {
  if (agentReasoningNodes.value.length === 0) {
    return 0;
  }
  const stanceWeight: Record<AgentStance, number> = {
    support: 1,
    caution: 0.65,
    oppose: 0.2,
  };
  const total = agentReasoningNodes.value.reduce((sum, item) => {
    return sum + item.confidence * stanceWeight[item.stance];
  }, 0);
  return Math.round((total / agentReasoningNodes.value.length) * 100);
});

const dissentSpread = computed<number>(() => {
  if (agentReasoningNodes.value.length <= 1) {
    return 0;
  }
  const values = agentReasoningNodes.value.map((item) => item.confidence);
  const max = Math.max(...values);
  const min = Math.min(...values);
  return Math.round((max - min) * 100);
});

const routingFactorNodes = computed<RoutingFactorNode[]>(() => {
  const reviewPressure = props.queueOverview.pending + props.queueOverview.reviewing;
  const contributions = [
    governanceHasRedFlag.value ? 32 : 8,
    Math.round(dissentSpread.value * 0.7),
    reviewPressure * 9,
    -Math.round(governanceScore.value * 0.22),
  ];

  return ROUTING_FACTOR_BASE.map((item, index) => {
    const contribution = contributions[index] ?? 0;
    const level: RoutingSignalLevel = contribution > 6
      ? 'positive'
      : contribution < -3
        ? 'negative'
        : 'neutral';

    return {
      ...item,
      contribution,
      level,
    };
  });
});

const routeComplexityScore = computed<number>(() => {
  const base = 24;
  const total = routingFactorNodes.value.reduce((sum, item) => {
    return sum + item.contribution;
  }, base);
  return Math.max(0, Math.min(100, total));
});

const routeDecisionLabel = computed<string>(() => {
  if (routeComplexityScore.value >= 72) {
    return '高复杂度并行会诊 + 强制安全复核';
  }
  if (routeComplexityScore.value >= 48) {
    return '标准多 Agent 协同 + 条件复核';
  }
  return '快速通道 + 轻量复核';
});

const latencyHeatRows = computed<LatencyHeatNode[]>(() => {
  const queuePressure = props.queueOverview.pending + props.queueOverview.reviewing;
  const baseRows: Array<{
    id: string;
    stage: WorkflowStage;
    baseLatency: number;
    retryWeight: number;
  }> = [
    { id: 'L-INFO', stage: 'INFO_GATHER', baseLatency: 520, retryWeight: 1 },
    { id: 'L-ROUTING', stage: 'ROUTING', baseLatency: 740, retryWeight: 2 },
    { id: 'L-DEBATE', stage: 'DEBATE', baseLatency: 1280, retryWeight: 3 },
    { id: 'L-CONSENSUS', stage: 'CONSENSUS', baseLatency: 980, retryWeight: 2 },
    { id: 'L-REVIEW', stage: 'REVIEW', baseLatency: 860, retryWeight: 2 },
    { id: 'L-OUTPUT', stage: 'OUTPUT', baseLatency: 620, retryWeight: 1 },
  ];

  return baseRows.map((row) => {
    const runtimeState = governanceStageRuntime.value[row.stage].status;
    const stagePenalty = runtimeState === 'blocked'
      ? 22
      : runtimeState === 'running'
        ? 10
        : runtimeState === 'done'
          ? -6
          : 0;
    const retryCount = Math.max(
      0,
      Math.round(
        row.retryWeight
          + props.queueOverview.pending * 0.7
          + props.queueOverview.reviewing * 0.9
          + props.queueOverview.rejected * 1.4
          + (runtimeState === 'blocked' ? 2 : 0),
      ),
    );
    const latencyMs = row.baseLatency
      + queuePressure * 95
      + props.queueOverview.rejected * 140
      + stagePenalty * 8;
    const heat = Math.max(
      0,
      Math.min(100, Math.round((latencyMs - 420) / 18 + retryCount * 4 + stagePenalty)),
    );
    const band: LatencyHeatBand = heat >= 72 ? 'hot' : heat >= 45 ? 'warm' : 'stable';

    return {
      id: row.id,
      stage: row.stage,
      latencyMs,
      retryCount,
      heat,
      band,
    };
  });
});

const avgLatencyMs = computed<number>(() => {
  if (latencyHeatRows.value.length === 0) {
    return 0;
  }
  const total = latencyHeatRows.value.reduce((sum, item) => {
    return sum + item.latencyMs;
  }, 0);
  return Math.round(total / latencyHeatRows.value.length);
});

const totalRetryCount = computed<number>(() => {
  return latencyHeatRows.value.reduce((sum, item) => {
    return sum + item.retryCount;
  }, 0);
});

const backendTraceNodes = computed<BackendTraceNode[]>(() => {
  const baseDate = new Date(lastUpdated.value || Date.now());
  const stageSource: Record<WorkflowStage, string> = {
    START: 'interfaces/session-controller',
    INFO_GATHER: 'application/intake-orchestrator',
    RISK_ASSESS: 'application/risk-engine',
    ROUTING: 'application/complexity-router',
    DEBATE: 'core/debate-engine',
    CONSENSUS: 'core/consensus-engine',
    REVIEW: 'application/safety-output-guard',
    OUTPUT: 'interfaces/report-exporter',
    ESCALATION: 'interfaces/review-queue-gateway',
  };

  return ORDERED_STAGES.map((stage, index) => {
    const stageState = governanceStageRuntime.value[stage].status;
    const timestamp = new Date(
      baseDate.getTime() - (ORDERED_STAGES.length - index - 1) * 70 * 1000,
    ).toISOString();

    return {
      id: `TRACE-${index + 1}`,
      stage,
      event: governanceStageRuntime.value[stage].message,
      source: stageSource[stage],
      timestamp,
      checksum: `sha256:${stage.toLowerCase()}-${stageState}-${index + 1}`,
      integrity: stageState === 'done' ? 'verified' : 'partial',
    };
  });
});

const traceIntegrityRate = computed<number>(() => {
  if (backendTraceNodes.value.length === 0) {
    return 0;
  }
  const verifiedCount = backendTraceNodes.value.filter((item) => {
    return item.integrity === 'verified';
  }).length;
  return Math.round((verifiedCount / backendTraceNodes.value.length) * 100);
});

const orchestrationTasks = computed<OrchestratorTaskNode[]>(() => {
  const queuePressure = props.queueOverview.pending + props.queueOverview.reviewing;
  return [
    {
      id: 'TASK-PLAN-01',
      lane: 'planner',
      task: '入口结构化采集',
      owner: 'IntakeOrchestrator',
      state: toTaskState(governanceStageRuntime.value.INFO_GATHER.status),
      durationMs: 680 + queuePressure * 80,
      dependsOn: [],
    },
    {
      id: 'TASK-PLAN-02',
      lane: 'planner',
      task: '复杂度路由判定',
      owner: 'ComplexityRouter',
      state: toTaskState(governanceStageRuntime.value.ROUTING.status),
      durationMs: 740 + queuePressure * 110,
      dependsOn: ['TASK-PLAN-01'],
    },
    {
      id: 'TASK-EXEC-01',
      lane: 'executor',
      task: '多 Agent 并行辩论',
      owner: 'DebateEngine',
      state: toTaskState(governanceStageRuntime.value.DEBATE.status),
      durationMs: 1120 + queuePressure * 130,
      dependsOn: ['TASK-PLAN-02'],
    },
    {
      id: 'TASK-EXEC-02',
      lane: 'executor',
      task: '共识收敛与不确定项压缩',
      owner: 'ConsensusEngine',
      state: toTaskState(governanceStageRuntime.value.CONSENSUS.status),
      durationMs: 960 + queuePressure * 90,
      dependsOn: ['TASK-EXEC-01'],
    },
    {
      id: 'TASK-REV-01',
      lane: 'reviewer',
      task: '安全约束审校',
      owner: 'SafetyOutputGuard',
      state: toTaskState(governanceStageRuntime.value.REVIEW.status),
      durationMs: 900 + queuePressure * 120,
      dependsOn: ['TASK-EXEC-02'],
    },
    {
      id: 'TASK-REV-02',
      lane: 'reviewer',
      task: '输出归档与上转闭环',
      owner: 'ReviewQueueGateway',
      state: toTaskState(governanceStageRuntime.value.OUTPUT.status),
      durationMs: 610 + queuePressure * 70,
      dependsOn: ['TASK-REV-01'],
    },
  ];
});

const selectedEvidence = computed<ScenarioEvidence | null>(() => {
  return SCENARIO_EVIDENCE_WALL.find((item) => item.id === selectedEvidenceId.value) ?? null;
});

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }
  return date.toLocaleString('zh-CN');
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function metricDeviationClass(value: number): string {
  if (value <= 0) {
    return 'ok';
  }
  if (value <= 0.1) {
    return 'warn';
  }
  return 'bad';
}

function hasActionableRisk(trigger: RiskTrigger): boolean {
  return !trigger.acknowledged;
}

function toTaskState(status: TriageStreamStageStatus): OrchestratorTaskState {
  if (status === 'blocked' || status === 'failed') {
    return 'blocked';
  }
  if (status === 'running') {
    return 'running';
  }
  if (status === 'done' || status === 'skipped') {
    return 'done';
  }
  return 'pending';
}

function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function agentStanceLabel(stance: AgentStance): string {
  if (stance === 'support') {
    return '支持';
  }
  if (stance === 'caution') {
    return '谨慎';
  }
  return '阻断';
}

function routingContributionLabel(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  return `${value}`;
}

function routingLevelLabel(level: RoutingSignalLevel): string {
  if (level === 'positive') {
    return '增压';
  }
  if (level === 'neutral') {
    return '平稳';
  }
  return '减压';
}

function latencyBandLabel(band: LatencyHeatBand): string {
  if (band === 'hot') {
    return '高压';
  }
  if (band === 'warm') {
    return '偏高';
  }
  return '稳定';
}

function traceIntegrityLabel(integrity: TraceIntegrity): string {
  if (integrity === 'verified') {
    return '已校验';
  }
  return '待补链';
}

function taskStateLabel(status: OrchestratorTaskState): string {
  if (status === 'done') {
    return '完成';
  }
  if (status === 'running') {
    return '执行中';
  }
  if (status === 'blocked') {
    return '阻断';
  }
  return '待启动';
}

function laneLabel(lane: OrchestratorLane): string {
  if (lane === 'planner') {
    return '规划层';
  }
  if (lane === 'executor') {
    return '执行层';
  }
  return '复核层';
}

function toggleBriefingMode(): void {
  briefingMode.value = !briefingMode.value;
}

function toggleHighContrastMode(): void {
  highContrastMode.value = !highContrastMode.value;
}

function selectScenarioEvidence(id: string): void {
  selectedEvidenceId.value = id;
}

function queueFilterFromStage(stage: WorkflowStage | null): QueueFilter {
  if (!stage) {
    return 'all';
  }
  if (stage === 'OUTPUT') {
    return 'approved';
  }
  if (stage === 'ESCALATION') {
    return 'rejected';
  }
  if (stage === 'DEBATE' || stage === 'CONSENSUS') {
    return 'reviewing';
  }
  return 'pending';
}

function setPreviewQueueFilter(filter: QueueFilter): void {
  activeQueueFilter.value = filter;
}

function syncFocus(stage: WorkflowStage): void {
  selectedStage.value = stage;
  hoverStage.value = null;
  setPreviewQueueFilter(queueFilterFromStage(stage));
}

function jumpToReviewQueue(): void {
  if (hoverStage.value !== null) {
    syncFocus(hoverStage.value);
  }
  emit('queue-filter-change', activeQueueFilter.value);
}

function pinFocusStage(): void {
  syncFocus(focusStage.value);
}

function handleStageClick(stage: WorkflowStage): void {
  syncFocus(stage);
}

function handleStageHover(stage: WorkflowStage): void {
  hoverStage.value = stage;
}

function handleStageHoverLeave(): void {
  hoverStage.value = null;
}

function handleTopologyNodeFocus(payload: {
  nodeId: string;
  label: string;
  stage: WorkflowStage | null;
}): void {
  if (payload.stage) {
    syncFocus(payload.stage);
  }
}

function handleTopologyNodeHover(payload: {
  nodeId: string;
  label: string;
  stage: WorkflowStage | null;
}): void {
  if (payload.stage) {
    hoverStage.value = payload.stage;
  }
}

function handleTopologyNodeHoverLeave(): void {
  hoverStage.value = null;
}

function stopReplayTimer(): void {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
  }
  replayPlaying.value = false;
}

function stepReplay(delta: number): void {
  hoverStage.value = null;
  const maxIndex = Math.max(0, replaySequence.value.length - 1);
  const next = replayIndex.value + delta;
  replayIndex.value = Math.max(0, Math.min(maxIndex, next));
}

function toggleReplayMode(): void {
  replayEnabled.value = !replayEnabled.value;
  hoverStage.value = null;
  if (!replayEnabled.value) {
    stopReplayTimer();
    return;
  }
  replayIndex.value = ORDERED_STAGES.indexOf(governanceCurrentStage.value);
}

function toggleReplayPlaying(): void {
  if (!replayEnabled.value) {
    replayEnabled.value = true;
  }
  if (replayPlaying.value) {
    stopReplayTimer();
    return;
  }

  hoverStage.value = null;
  replayPlaying.value = true;
  replayTimer = setInterval(() => {
    const maxIndex = Math.max(0, replaySequence.value.length - 1);
    if (replayIndex.value >= maxIndex) {
      stopReplayTimer();
      return;
    }
    replayIndex.value += 1;
  }, 1500);
}

function resetReplay(): void {
  stopReplayTimer();
  replayEnabled.value = false;
  replayIndex.value = ORDERED_STAGES.indexOf(governanceCurrentStage.value);
}

watch(
  () => props.externalFocusStage,
  (stage) => {
    if (!stage) {
      return;
    }
    syncFocus(stage);
  },
  { immediate: true },
);

watch(
  governanceCurrentStage,
  (stage) => {
    if (selectedStage.value === null && hoverStage.value === null) {
      setPreviewQueueFilter(queueFilterFromStage(stage));
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (
    typeof window !== 'undefined'
    && 'matchMedia' in window
    && typeof window.matchMedia === 'function'
  ) {
    reducedMotionPreferred.value = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  }
  refresh();
});

onBeforeUnmount(() => {
  stopReplayTimer();
});
</script>

<template>
  <section
    class="dashboard-root"
    :class="{ 'briefing-mode': briefingMode, 'high-contrast': highContrastMode }"
  >
    <header class="dashboard-header">
      <div>
        <p class="eyebrow">治理指标</p>
        <h2>后端执行与治理神经中枢</h2>
      </div>
      <div class="header-actions">
        <span class="last-updated">更新时间：{{ formatTime(lastUpdated) }}</span>
        <button class="refresh-btn" :disabled="loading" @click="refresh">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
        <button
          type="button"
          class="refresh-btn mode-btn"
          :aria-pressed="briefingMode ? 'true' : 'false'"
          data-testid="briefing-toggle"
          @click="toggleBriefingMode"
        >
          {{ briefingMode ? '退出 3 分钟答辩模式' : '进入 3 分钟答辩模式' }}
        </button>
        <button
          type="button"
          class="refresh-btn mode-btn"
          :aria-pressed="highContrastMode ? 'true' : 'false'"
          data-testid="contrast-toggle"
          @click="toggleHighContrastMode"
        >
          {{ highContrastMode ? '关闭高对比度' : '开启高对比度' }}
        </button>
      </div>
    </header>
    <p class="sr-only" aria-live="polite">{{ briefingStatusText }}</p>

    <section v-if="loading" class="loading-state">
      <div class="spinner" />
      <p>正在加载治理快照...</p>
    </section>

    <template v-else>
      <section class="overview-grid">
        <article class="progress-card">
          <div class="ring-wrap">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="44" class="ring-base" />
              <circle
                cx="50"
                cy="50"
                r="44"
                class="ring-fill"
                :stroke-dasharray="`${overallProgress * 2.764} 276.4`"
              />
            </svg>
            <div class="ring-value">{{ overallProgress }}%</div>
          </div>
          <div class="progress-copy">
            <h3>总体完成度</h3>
            <p>{{ progressSummary }}</p>
          </div>
        </article>

        <article class="kpi-card">
          <span class="kpi-value">{{ completedMilestones }}</span>
          <span class="kpi-label">已完成里程碑</span>
        </article>
        <article class="kpi-card">
          <span class="kpi-value">{{ breachedMetrics.length + atRiskMetrics.length }}</span>
          <span class="kpi-label">风险指标数</span>
        </article>
        <article class="kpi-card">
          <span class="kpi-value">{{ unacknowledgedTriggers.length }}</span>
          <span class="kpi-label">待确认触发器</span>
        </article>
      </section>

      <section v-if="briefingMode" class="panel briefing-panel" data-testid="briefing-panel">
        <h3>答辩模式脚本（3 分钟）</h3>
        <ol>
          <li v-for="step in BRIEFING_SCRIPT_STEPS" :key="step">{{ step }}</li>
        </ol>
        <p class="briefing-note">
          {{ reducedMotionPreferred ? '检测到系统偏好减少动效，回放将保持静态节奏。' : '可配合阶段回放演示主链路与异常分支。' }}
        </p>
      </section>

      <section class="panel replay-panel">
        <div class="replay-head">
          <div>
            <h3>阶段回放时间轴</h3>
            <p>用于答辩演示流程推进与异常分支的可解释回放。</p>
          </div>
          <div class="replay-meta">
            <span class="replay-chip">当前阶段：{{ STAGE_LABELS[focusStage] }}</span>
            <span class="replay-chip">焦点模式：{{ focusModeLabel }}</span>
            <span class="replay-chip">队列过滤：{{ FILTER_LABELS[activeQueueFilter] }}</span>
          </div>
        </div>

        <div class="replay-controls">
          <button type="button" class="control-btn" @click="toggleReplayMode">
            {{ replayEnabled ? '退出回放' : '进入回放' }}
          </button>
          <button type="button" class="control-btn" :disabled="!replayEnabled" @click="stepReplay(-1)">
            上一步
          </button>
          <button
            type="button"
            class="control-btn"
            :disabled="!replayEnabled"
            @click="toggleReplayPlaying"
          >
            {{ replayPlaying ? '暂停' : '播放' }}
          </button>
          <button type="button" class="control-btn" :disabled="!replayEnabled" @click="stepReplay(1)">
            下一步
          </button>
          <button type="button" class="control-btn" @click="resetReplay">
            重置
          </button>
          <input
            v-model.number="replayIndex"
            class="replay-range"
            type="range"
            min="0"
            :max="Math.max(0, replaySequence.length - 1)"
            :disabled="!replayEnabled"
          />
        </div>
        <p class="replay-note">{{ replayStageDetail.message }}</p>
      </section>

      <section class="panel architecture-panel">
        <ExecutionNeuralTopology
          :metrics="metrics"
          :risk-triggers="riskTriggers"
          :stage-runtime="governanceStageRuntime"
          :current-stage="focusStage"
          :queue-overview="props.queueOverview"
          @node-focus="handleTopologyNodeFocus"
          @node-hover="handleTopologyNodeHover"
          @node-hover-leave="handleTopologyNodeHoverLeave"
        />
      </section>

      <section class="panel workflow-panel">
        <div class="workflow-head">
          <div>
            <h3>工作流状态机（明细）</h3>
            <p>状态机明细与分层矩阵联动，支持按阶段回放与队列过滤。</p>
          </div>
          <span class="replay-chip">焦点阶段：{{ STAGE_LABELS[focusStage] }}</span>
        </div>

        <div class="workflow-grid">
          <WorkflowStateMachine
            :stage-runtime="governanceStageRuntime"
            :current-stage="focusStage"
            :has-red-flag="governanceHasRedFlag"
            :has-escalation="governanceHasEscalation"
            @stage-click="handleStageClick"
            @stage-hover="handleStageHover"
            @stage-hover-leave="handleStageHoverLeave"
          />
          <WorkflowLayerMatrix
            :stage-runtime="governanceStageRuntime"
            :current-stage="focusStage"
            :has-red-flag="governanceHasRedFlag"
            :has-escalation="governanceHasEscalation"
            @stage-click="handleStageClick"
            @stage-hover="handleStageHover"
            @stage-hover-leave="handleStageHoverLeave"
          />
        </div>

        <article class="workflow-detail" :class="{ preview: hoverStage !== null }">
          <h4>{{ STAGE_LABELS[focusStage] }}</h4>
          <p>{{ selectedStageDetail.message }}</p>

          <div class="focus-metrics">
            <div class="focus-metric">
              <span>当前焦点</span>
              <strong>{{ STAGE_LABELS[focusStage] }}</strong>
            </div>
            <div class="focus-metric">
              <span>阶段状态</span>
              <strong>{{ stageFocusStatusLabel }}</strong>
            </div>
            <div class="focus-metric">
              <span>队列预览</span>
              <strong>{{ FILTER_LABELS[activeQueueFilter] }}</strong>
            </div>
          </div>

          <p class="focus-hint">{{ focusActionHint }}</p>

          <ol class="focus-checklist">
            <li v-for="item in focusChecklist" :key="item">{{ item }}</li>
          </ol>

          <div class="focus-actions">
            <button type="button" class="control-btn" @click="pinFocusStage">
              锁定当前焦点
            </button>
            <button type="button" class="queue-link-btn" @click="jumpToReviewQueue">
              前往复核队列（{{ FILTER_LABELS[activeQueueFilter] }}）
            </button>
          </div>

          <small v-if="hoverStage !== null">悬停预览中，点击可锁定焦点。</small>
          <small>图表点击只更新焦点与过滤预览，不会自动跳转。</small>
        </article>
      </section>

      <section class="panel latency-heat-panel" aria-label="推理时延与重试热力图">
        <div class="panel-head">
          <h3>推理时延与重试热力图</h3>
          <span class="replay-chip">
            平均时延 {{ formatMs(avgLatencyMs) }} · 重试 {{ totalRetryCount }} 次
          </span>
        </div>
        <div class="latency-heat-grid" data-testid="latency-heat-grid">
          <article
            v-for="row in latencyHeatRows"
            :key="row.id"
            class="latency-heat-node"
            :data-band="row.band"
          >
            <div class="latency-row-head">
              <strong>{{ STAGE_LABELS[row.stage] }}</strong>
              <span>{{ latencyBandLabel(row.band) }}</span>
            </div>
            <div class="latency-meter">
              <span :style="{ width: `${row.heat}%` }" />
            </div>
            <small>
              时延 {{ formatMs(row.latencyMs) }} · 重试 {{ row.retryCount }} 次 · 热度 {{ row.heat }}
            </small>
          </article>
        </div>
      </section>

      <section class="panel backend-factor-panel" aria-label="多 Agent 分歧收敛矩阵">
        <div class="panel-head">
          <h3>多 Agent 分歧收敛矩阵</h3>
          <span class="replay-chip">收敛指数 {{ consensusIndex }}%</span>
        </div>
        <div class="factor-summary">
          <span class="factor-chip">分歧跨度 {{ dissentSpread }}%</span>
          <span class="factor-chip">复杂度 {{ routeComplexityScore }}/100</span>
          <span class="factor-chip decision">{{ routeDecisionLabel }}</span>
        </div>
        <div class="agent-reasoning-grid" data-testid="agent-reasoning-grid">
          <article
            v-for="agent in agentReasoningNodes"
            :key="agent.id"
            class="agent-node"
            :data-stance="agent.stance"
          >
            <header>
              <strong>{{ agent.agent }}</strong>
              <span>{{ agentStanceLabel(agent.stance) }}</span>
            </header>
            <p>{{ agent.domain }} · {{ STAGE_LABELS[agent.stage] }}</p>
            <small>置信度 {{ Math.round(agent.confidence * 100) }}% · 引用 {{ agent.citations }} · 延迟 {{ formatMs(agent.latencyMs) }}</small>
            <small>证据：{{ agent.keyEvidence }}</small>
            <small>动作：{{ agent.nextAction }}</small>
          </article>
        </div>
      </section>

      <section class="panel routing-causal-panel" aria-label="复杂度路由因果瀑布">
        <div class="panel-head">
          <h3>复杂度路由因果瀑布</h3>
          <span class="replay-chip">最终评分 {{ routeComplexityScore }} / 100</span>
        </div>
        <ol class="routing-factor-list" data-testid="routing-factor-list">
          <li
            v-for="factor in routingFactorNodes"
            :key="factor.id"
            :data-level="factor.level"
          >
            <div class="routing-row">
              <strong>{{ factor.factor }}</strong>
              <span>{{ routingContributionLabel(factor.contribution) }}</span>
            </div>
            <p>{{ factor.evidence }}</p>
            <small>{{ STAGE_LABELS[factor.stage] }} · 阈值 {{ factor.threshold }} · {{ routingLevelLabel(factor.level) }}</small>
          </li>
        </ol>
      </section>

      <section class="panel trace-panel" aria-label="后端执行审计溯源流">
        <div class="panel-head">
          <h3>后端执行审计溯源流</h3>
          <span class="replay-chip">链路完整度 {{ traceIntegrityRate }}%</span>
        </div>
        <ol class="trace-stream-list" data-testid="trace-stream-list">
          <li
            v-for="trace in backendTraceNodes"
            :key="trace.id"
            :data-integrity="trace.integrity"
          >
            <div class="trace-head">
              <strong>{{ STAGE_LABELS[trace.stage] }}</strong>
              <span>{{ traceIntegrityLabel(trace.integrity) }}</span>
            </div>
            <p>{{ trace.event }}</p>
            <small>{{ trace.source }} · {{ formatTime(trace.timestamp) }}</small>
            <code>{{ trace.checksum }}</code>
          </li>
        </ol>
      </section>

      <section class="panel orchestration-panel" aria-label="编排任务依赖图">
        <h3>编排任务依赖图</h3>
        <div class="orchestration-task-grid" data-testid="orchestration-task-grid">
          <article
            v-for="task in orchestrationTasks"
            :key="task.id"
            class="task-node"
            :data-state="task.state"
          >
            <header>
              <strong>{{ task.task }}</strong>
              <span>{{ taskStateLabel(task.state) }}</span>
            </header>
            <p>{{ laneLabel(task.lane) }} · {{ task.owner }}</p>
            <small>
              耗时 {{ formatMs(task.durationMs) }} · 依赖
              {{ task.dependsOn.length > 0 ? task.dependsOn.join(' -> ') : '无' }}
            </small>
          </article>
        </div>
      </section>

      <section class="panel evidence-wall-panel" aria-label="A-F 场景与测试证据墙">
        <h3>A-F 场景与 T-007~T-012 证据墙</h3>
        <div class="evidence-wall-grid" data-testid="evidence-wall-grid">
          <button
            v-for="item in SCENARIO_EVIDENCE_WALL"
            :key="item.id"
            type="button"
            class="evidence-card-btn"
            :class="{ active: item.id === selectedEvidenceId }"
            @click="selectScenarioEvidence(item.id)"
          >
            <strong>{{ item.group }} 组 · {{ item.testCase }}</strong>
            <span>{{ item.title }}</span>
            <small>触发：{{ item.trigger }}</small>
          </button>
        </div>
        <article v-if="selectedEvidence" class="evidence-detail" data-testid="evidence-detail">
          <h4>{{ selectedEvidence.title }}</h4>
          <p><strong>输入条件：</strong>{{ selectedEvidence.input }}</p>
          <p><strong>触发机制：</strong>{{ selectedEvidence.trigger }}</p>
          <p><strong>输出动作：</strong>{{ selectedEvidence.output }}</p>
        </article>
      </section>

      <section class="panel">
        <h3>里程碑进度</h3>
        <div class="milestone-grid">
          <article v-for="milestone in milestones" :key="milestone.id" class="milestone-item">
            <header>
              <strong>{{ milestone.id }}</strong>
              <span :style="{ color: GOVERNANCE_COLOR_BY_STATUS[milestone.status] }">
                {{ MILESTONE_STATUS_LABELS[milestone.status] }}
              </span>
            </header>
            <p>{{ milestone.title }}</p>
            <div class="bar-track">
              <div
                class="bar-fill"
                :style="{
                  width: `${(milestone.completed / milestone.total) * 100}%`,
                  backgroundColor: GOVERNANCE_COLOR_BY_STATUS[milestone.status],
                }"
              />
            </div>
            <small>{{ milestone.completed }}/{{ milestone.total }}</small>
          </article>
        </div>
      </section>

      <section class="panel">
        <h3>指标偏差台账</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>里程碑</th>
                <th>指标项</th>
                <th>目标</th>
                <th>实际</th>
                <th>偏差</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in metrics" :key="`${metric.milestoneId}-${metric.metricName}`">
                <td>{{ metric.milestoneId }}</td>
                <td>{{ metric.metricName }}</td>
                <td>{{ formatPercent(metric.targetValue) }}</td>
                <td>{{ formatPercent(metric.actualValue) }}</td>
                <td :class="metricDeviationClass(metric.deviation)">
                  {{ metric.deviation > 0 ? '+' : '' }}{{ formatPercent(metric.deviation) }}
                </td>
                <td>
                  <span
                    class="status-badge"
                    :style="{ backgroundColor: GOVERNANCE_COLOR_BY_STATUS[metric.status] }"
                  >
                    {{ METRIC_STATUS_LABELS[metric.status] }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <h3>风险触发器</h3>
        <div class="trigger-list">
          <article v-for="trigger in riskTriggers" :key="trigger.id" class="trigger-item">
            <div class="trigger-head">
              <span
                class="status-badge"
                :style="{ backgroundColor: GOVERNANCE_COLOR_BY_STATUS[trigger.severity] }"
              >
                {{ RISK_SEVERITY_LABELS[trigger.severity] }}
              </span>
              <small>{{ trigger.type }}</small>
              <small>{{ formatTime(trigger.timestamp) }}</small>
            </div>
            <p>{{ trigger.message }}</p>
            <button
              v-if="hasActionableRisk(trigger)"
              class="ack-btn"
              @click="acknowledgeTrigger(trigger.id)"
            >
              标记已确认
            </button>
            <small v-else class="ack-text">已确认</small>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.dashboard-root {
  display: grid;
  gap: 16px;
  color: var(--color-text-primary);
}

.dashboard-root.high-contrast {
  --panel-border: #183a5a;
  --panel-bg: #ffffff;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: end;
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.dashboard-header h2 {
  margin: 4px 0 0;
  font-size: 27px;
  line-height: 1.08;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.last-updated {
  font-size: 13px;
  color: var(--color-text-muted);
}

.refresh-btn {
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
  color: var(--color-text-primary);
  border-radius: var(--radius-sm);
  padding: 9px 13px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.loading-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 44px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 900ms linear infinite;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) repeat(3, minmax(140px, 1fr));
  gap: 12px;
}

.progress-card,
.kpi-card,
.panel {
  border: 1px solid var(--panel-border, var(--color-border));
  border-radius: var(--radius-md);
  background: var(
    --panel-bg,
    color-mix(in srgb, var(--color-bg-primary) 92%, transparent)
  );
  box-shadow: var(--shadow-sm);
}

.progress-card {
  padding: 16px;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 16px;
}

.ring-wrap {
  position: relative;
  width: 98px;
  height: 98px;
}

.ring-wrap svg {
  width: 100%;
  height: 100%;
}

.ring-base {
  fill: none;
  stroke: color-mix(in srgb, var(--color-border) 80%, transparent);
  stroke-width: 8;
}

.ring-fill {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 8;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
}

.ring-value {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 700;
}

.progress-copy h3 {
  margin: 0 0 6px;
  font-size: 17px;
}

.progress-copy p {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.kpi-card {
  padding: 16px;
  display: grid;
  gap: 8px;
  align-content: center;
}

.kpi-value {
  font-size: 34px;
  line-height: 1;
  font-weight: 700;
}

.kpi-label {
  font-size: 13px;
  line-height: 1.35;
  color: var(--color-text-muted);
}

.panel {
  padding: 16px;
}

.panel h3 {
  margin: 0 0 10px;
  font-size: 17px;
}

.briefing-panel ol {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.briefing-note {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--color-text-muted);
}

.replay-panel,
.architecture-panel,
.workflow-panel {
  padding: 14px;
}

.replay-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.replay-head h3 {
  margin: 0;
  font-size: 16px;
}

.replay-head p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.replay-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.replay-chip {
  border: 1px solid #c5d3e2;
  border-radius: 999px;
  padding: 4px 11px;
  font-size: 12px;
  color: #36546d;
  background: #f3f8fd;
}

.replay-controls {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(5, max-content) minmax(120px, 1fr);
  gap: 8px;
  align-items: center;
}

.control-btn {
  border: 1px solid #b8c9dc;
  background: #f8fcff;
  color: #2f5878;
  border-radius: 8px;
  font-size: 13px;
  padding: 6px 10px;
  cursor: pointer;
}

.mode-btn {
  font-weight: 700;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.control-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.replay-range {
  width: 100%;
}

.replay-note {
  margin: 8px 0 0;
  color: #466783;
  font-size: 13px;
  line-height: 1.45;
}

.workflow-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}

.workflow-head h3 {
  margin: 0;
  font-size: 16px;
}

.workflow-head p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.workflow-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(280px, 1fr));
  gap: 10px;
  align-items: start;
}

.workflow-detail {
  margin-top: 10px;
  border: 1px solid #d2e0ee;
  border-radius: 10px;
  background: #f8fcff;
  padding: 10px 12px;
}

.workflow-detail.preview {
  border-color: #7da7ce;
  background: #eef6ff;
}

.workflow-detail h4 {
  margin: 0 0 4px;
  font-size: 15px;
  color: #244764;
}

.workflow-detail p {
  margin: 0;
  font-size: 14px;
  color: #42637e;
  line-height: 1.5;
}

.workflow-detail small {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: #5a7a96;
}

.focus-metrics {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.focus-metric {
  border: 1px solid #d4e1ee;
  border-radius: 9px;
  background: #ffffff;
  padding: 8px;
  display: grid;
  gap: 4px;
}

.focus-metric span {
  color: #67839d;
  font-size: 12px;
}

.focus-metric strong {
  color: #224764;
  font-size: 14px;
}

.focus-hint {
  margin: 10px 0 0;
  color: #345d7d;
  font-size: 13px;
  line-height: 1.5;
}

.focus-checklist {
  margin: 8px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 5px;
}

.focus-checklist li {
  color: #466b88;
  font-size: 13px;
  line-height: 1.45;
}

.focus-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.queue-link-btn {
  border: 1px solid #9bb6cf;
  background: #f2f8ff;
  color: #2d5879;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  padding: 5px 10px;
  cursor: pointer;
}

.queue-link-btn:hover {
  background: #e8f2ff;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}

.latency-heat-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.latency-heat-node {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  padding: 10px;
  display: grid;
  gap: 7px;
}

.latency-row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.latency-row-head strong {
  font-size: 12px;
  color: var(--color-text-primary);
}

.latency-row-head span {
  font-size: 11px;
  border-radius: 999px;
  padding: 2px 8px;
}

.latency-meter {
  height: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-bg-tertiary) 75%, transparent);
  overflow: hidden;
}

.latency-meter span {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 220ms ease;
  background: linear-gradient(90deg, #1e8f82 0%, #d4a24a 58%, #c7593a 100%);
}

.latency-heat-node small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.latency-heat-node[data-band='stable'] .latency-row-head span {
  color: #1d7f68;
  background: rgba(34, 149, 113, 0.12);
}

.latency-heat-node[data-band='warm'] .latency-row-head span {
  color: #916413;
  background: rgba(208, 145, 41, 0.14);
}

.latency-heat-node[data-band='hot'] .latency-row-head span {
  color: #b14f34;
  background: rgba(208, 87, 56, 0.15);
}

.factor-summary {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.factor-chip {
  border: 1px solid #c4d4e4;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  color: #335a79;
  background: #f3f8fd;
}

.factor-chip.decision {
  border-color: rgba(34, 149, 113, 0.34);
  background: rgba(34, 149, 113, 0.12);
  color: #1d7f68;
}

.agent-reasoning-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
}

.agent-node {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  padding: 10px;
  display: grid;
  gap: 5px;
}

.agent-node header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agent-node header span {
  font-size: 11px;
  border-radius: 999px;
  padding: 2px 8px;
}

.agent-node p {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.agent-node small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.agent-node[data-stance='support'] header span {
  color: #1d7f68;
  background: rgba(34, 149, 113, 0.12);
}

.agent-node[data-stance='caution'] header span {
  color: #916413;
  background: rgba(208, 145, 41, 0.14);
}

.agent-node[data-stance='oppose'] header span {
  color: #b14f34;
  background: rgba(208, 87, 56, 0.14);
}

.routing-factor-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.routing-factor-list li {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
}

.routing-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

.routing-row span {
  font-weight: 700;
  font-size: 12px;
}

.routing-factor-list li p {
  margin: 0 0 4px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.routing-factor-list li small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.routing-factor-list li[data-level='positive'] {
  border-left: 4px solid #cf912f;
}

.routing-factor-list li[data-level='neutral'] {
  border-left: 4px solid #6e8aa2;
}

.routing-factor-list li[data-level='negative'] {
  border-left: 4px solid #23916b;
}

.trace-stream-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.trace-stream-list li {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  display: grid;
  gap: 4px;
}

.trace-stream-list li[data-integrity='verified'] {
  border-left: 4px solid #23916b;
}

.trace-stream-list li[data-integrity='partial'] {
  border-left: 4px solid #cf912f;
}

.trace-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.trace-head span {
  font-size: 11px;
  color: #36546d;
}

.trace-stream-list li p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.trace-stream-list li small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.trace-stream-list li code {
  font-size: 11px;
  color: #4f6f8b;
}

.orchestration-task-grid {
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
}

.task-node {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  padding: 10px;
  display: grid;
  gap: 4px;
}

.task-node header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.task-node p {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.task-node small {
  font-size: 11px;
  color: var(--color-text-muted);
}

.task-node[data-state='running'] {
  border-left: 4px solid #1c8c88;
}

.task-node[data-state='done'] {
  border-left: 4px solid #23916b;
}

.task-node[data-state='blocked'] {
  border-left: 4px solid #d15e3f;
}

.task-node[data-state='pending'] {
  border-left: 4px solid #70879a;
}

.evidence-wall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}

.evidence-card-btn {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  padding: 9px;
  text-align: left;
  display: grid;
  gap: 4px;
  cursor: pointer;
}

.evidence-card-btn strong {
  font-size: 12px;
  color: var(--color-text-primary);
}

.evidence-card-btn span {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.evidence-card-btn small {
  font-size: 11px;
  color: var(--color-text-muted);
}

.evidence-card-btn.active {
  border-color: color-mix(in srgb, var(--color-primary) 50%, var(--color-border));
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-primary));
}

.evidence-detail {
  margin-top: 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
  padding: 10px;
}

.evidence-detail h4 {
  margin: 0 0 8px;
  font-size: 14px;
}

.evidence-detail p {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.milestone-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}

.milestone-item {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: color-mix(in srgb, var(--color-bg-tertiary) 88%, transparent);
}

.milestone-item header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.milestone-item p {
  margin: 8px 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.bar-track {
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--color-border-light);
  background: var(--color-bg-tertiary);
}

.bar-fill {
  height: 100%;
  border-radius: inherit;
}

.milestone-item small {
  display: block;
  margin-top: 7px;
  color: var(--color-text-muted);
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;
}

th,
td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border-light);
  font-size: 12px;
}

th {
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

td.ok {
  color: var(--color-success);
}

td.warn {
  color: var(--color-warning);
}

td.bad {
  color: var(--color-danger);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
}

.trigger-list {
  display: grid;
  gap: 8px;
}

.trigger-item {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: color-mix(in srgb, var(--color-bg-tertiary) 88%, transparent);
}

.trigger-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.trigger-head small {
  font-size: 11px;
  color: var(--color-text-muted);
}

.trigger-head small:last-child {
  margin-left: auto;
}

.trigger-item p {
  margin: 8px 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.ack-btn {
  border: 1px solid color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary-dark);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
  cursor: pointer;
}

.ack-text {
  color: var(--color-text-muted);
  font-size: 11px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1180px) {
  .replay-controls {
    grid-template-columns: repeat(3, max-content) minmax(120px, 1fr);
  }
}

@media (max-width: 1080px) {
  .overview-grid {
    grid-template-columns: 1fr 1fr;
  }

  .focus-metrics {
    grid-template-columns: 1fr 1fr;
  }

  .workflow-grid {
    grid-template-columns: 1fr;
  }

  .progress-card {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .replay-head {
    flex-direction: column;
  }

  .replay-meta {
    justify-content: flex-start;
  }

  .workflow-head {
    flex-direction: column;
  }

  .focus-metrics {
    grid-template-columns: 1fr;
  }

  .replay-controls {
    grid-template-columns: 1fr 1fr;
  }

  .replay-range {
    grid-column: 1 / -1;
  }
}

@media (max-width: 680px) {
  .dashboard-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }

  .progress-card {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }
}
</style>
