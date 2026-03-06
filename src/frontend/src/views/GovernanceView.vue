<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { WorkflowStage } from '@copilot-care/shared/types';
import GovernanceDashboard from '../components/GovernanceDashboard.vue';
import ReviewQueue from '../components/ReviewQueue.vue';
import EvidenceDrawer from '../components/EvidenceDrawer.vue';
import {
  fetchGovernanceRuleCatalog,
  fetchGovernanceRuleVersion,
  fetchGovernanceRuntime,
  type GovernanceRuleCatalogResponse,
  type GovernanceRuleVersionResponse,
  type GovernanceRuntimeResponse,
  type GovernanceRuntimeSession,
} from '../services/triageApi';
import {
  buildEvidenceBundle,
  createMockReviewQueue,
} from '../features/governance/mock';
import type {
  EvidenceItem,
  ReviewItem,
  ReviewStatus,
} from '../features/governance/model';

type GovernanceTab = 'dashboard' | 'queue';
type QueueFilter = 'all' | 'pending' | 'reviewing' | 'approved' | 'rejected';
type QueueUpdateStatus = Extract<ReviewStatus, 'approved' | 'rejected'>;
type BackendFactorState = 'normal' | 'warning' | 'critical';
type BackendFactorKey = 'latency-retry' | 'consensus' | 'routing-waterfall';
type GovernanceActionPriority = 'low' | 'medium' | 'high';

interface BackendFactorCard {
  key: BackendFactorKey;
  title: string;
  primary: string;
  secondary: string;
  state: BackendFactorState;
  hint: string;
}

interface GovernanceSignalCard {
  key: string;
  title: string;
  value: string;
  context: string;
  trend: string;
  state: BackendFactorState;
}

interface GovernanceStagePulse {
  key: string;
  label: string;
  value: number;
  benchmark: string;
  hint: string;
  state: BackendFactorState;
}

interface GovernanceActionItem {
  id: string;
  title: string;
  trigger: string;
  action: string;
  owner: string;
  eta: string;
  priority: GovernanceActionPriority;
}

const FILTER_LABELS: Record<QueueFilter, string> = {
  all: '全部',
  pending: '待复核',
  reviewing: '复核中',
  approved: '已通过',
  rejected: '已驳回',
};

const PRIORITY_LABELS: Record<GovernanceActionPriority, string> = {
  high: '高优先',
  medium: '中优先',
  low: '低优先',
};

const GOVERNANCE_RUNTIME_POLL_MS = 12000;
const allowDemoFallback = import.meta.env.MODE === 'test';

const activeTab = ref<GovernanceTab>('dashboard');
const showEvidenceDrawer = ref<boolean>(false);
const selectedEvidences = ref<EvidenceItem[]>([]);
const reviewItems = ref<ReviewItem[]>(
  allowDemoFallback ? createMockReviewQueue() : [],
);
const queueFilter = ref<QueueFilter>('all');
const dashboardFocusStage = ref<WorkflowStage | null>(null);
const runtimeSnapshot = ref<GovernanceRuntimeResponse | null>(null);
const ruleCatalog = ref<GovernanceRuleCatalogResponse | null>(null);
const ruleVersion = ref<GovernanceRuleVersionResponse | null>(null);
const runtimeLoading = ref<boolean>(false);
const runtimeLoadError = ref<string>('');
let runtimePollTimer: ReturnType<typeof setInterval> | null = null;

const localPendingCount = computed<number>(
  () => reviewItems.value.filter((item) => item.status === 'pending').length,
);

const localReviewingCount = computed<number>(
  () => reviewItems.value.filter((item) => item.status === 'reviewing').length,
);

const localApprovedCount = computed<number>(
  () => reviewItems.value.filter((item) => item.status === 'approved').length,
);

const localRejectedCount = computed<number>(
  () => reviewItems.value.filter((item) => item.status === 'rejected').length,
);

function mapRuntimeSessionStatus(session: GovernanceRuntimeSession): ReviewStatus {
  if (session.outcome === 'RUNNING') {
    return 'pending';
  }
  if (session.outcome === 'ABSTAIN') {
    return 'reviewing';
  }
  if (session.outcome === 'OUTPUT') {
    return 'approved';
  }
  return 'rejected';
}

const runtimeReviewItems = computed<ReviewItem[]>(() => {
  if (!runtimeSnapshot.value) {
    return [];
  }
  return runtimeSnapshot.value.recentSessions.map((session) => {
    const status = mapRuntimeSessionStatus(session);
    const summaryParts = [
      session.routeMode ? `路由 ${session.routeMode}` : '',
      typeof session.complexityScore === 'number'
        ? `复杂度 ${session.complexityScore.toFixed(1)}`
        : '',
      session.destination ? `去向 ${session.destination}` : '',
      typeof session.durationMs === 'number'
        ? `耗时 ${Math.max(1, Math.round(session.durationMs))}ms`
        : '',
    ].filter(Boolean);
    return {
      id: session.id,
      patientId: session.patientId,
      status,
      triageLevel: session.triageLevel ?? (status === 'rejected' ? '高风险' : '常规'),
      createdAt: session.startedAt,
      summary: summaryParts.length > 0
        ? summaryParts.join(' · ')
        : '运行会诊会话记录',
    };
  });
});

const queueSourceItems = computed<ReviewItem[]>(() => {
  if (runtimeSnapshot.value) {
    return runtimeReviewItems.value;
  }
  if (allowDemoFallback) {
    return reviewItems.value;
  }
  return [];
});

const pendingCount = computed<number>(() => {
  if (runtimeSnapshot.value) {
    return runtimeSnapshot.value.queueOverview.pending;
  }
  if (allowDemoFallback) {
    return localPendingCount.value;
  }
  return 0;
});

const reviewingCount = computed<number>(() => {
  if (runtimeSnapshot.value) {
    return runtimeSnapshot.value.queueOverview.reviewing;
  }
  if (allowDemoFallback) {
    return localReviewingCount.value;
  }
  return 0;
});

const approvedCount = computed<number>(() => {
  if (runtimeSnapshot.value) {
    return runtimeSnapshot.value.queueOverview.approved;
  }
  if (allowDemoFallback) {
    return localApprovedCount.value;
  }
  return 0;
});

const rejectedCount = computed<number>(() => {
  if (runtimeSnapshot.value) {
    return runtimeSnapshot.value.queueOverview.rejected;
  }
  if (allowDemoFallback) {
    return localRejectedCount.value;
  }
  return 0;
});

const filteredReviewItems = computed<ReviewItem[]>(() => {
  if (queueFilter.value === 'all') {
    return queueSourceItems.value;
  }
  return queueSourceItems.value.filter((item) => item.status === queueFilter.value);
});

const governanceScore = computed<number>(() => {
  const total = pendingCount.value
    + reviewingCount.value
    + approvedCount.value
    + rejectedCount.value;
  if (total === 0) {
    return 0;
  }
  return Math.round((approvedCount.value / total) * 100);
});

const governanceSignal = computed<'normal' | 'warning' | 'critical'>(() => {
  if (pendingCount.value >= 4) {
    return 'critical';
  }
  if (pendingCount.value > 0 || reviewingCount.value > 0) {
    return 'warning';
  }
  return 'normal';
});

const totalCaseCount = computed<number>(() => {
  return pendingCount.value
    + reviewingCount.value
    + approvedCount.value
    + rejectedCount.value;
});

const backlogCount = computed<number>(() => {
  return pendingCount.value + reviewingCount.value;
});

function clampMetric(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function formatSignedValue(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) {
    return `+${rounded}`;
  }
  return String(rounded);
}

function resolveActionPriority(score: number): GovernanceActionPriority {
  if (score >= 68) {
    return 'high';
  }
  if (score >= 48) {
    return 'medium';
  }
  return 'low';
}

function resolveFactorState(
  value: number,
  warningThreshold: number,
  criticalThreshold: number,
): BackendFactorState {
  if (value >= criticalThreshold) {
    return 'critical';
  }
  if (value >= warningThreshold) {
    return 'warning';
  }
  return 'normal';
}

const latencyRetryHeat = computed<number>(() => {
  if (runtimeSnapshot.value) {
    return runtimeSnapshot.value.performance.latencyHeat;
  }
  return clampMetric(
    22
      + reviewingCount.value * 18
      + pendingCount.value * 12
      + rejectedCount.value * 15,
  );
});

const retryPressure = computed<number>(() => {
  if (runtimeSnapshot.value) {
    return runtimeSnapshot.value.performance.retryPressure;
  }
  return pendingCount.value + reviewingCount.value * 2 + rejectedCount.value * 3;
});

const consensusConvergence = computed<number>(() => {
  if (runtimeSnapshot.value) {
    return runtimeSnapshot.value.performance.consensusConvergence;
  }
  return clampMetric(
    governanceScore.value
      - reviewingCount.value * 14
      - pendingCount.value * 9
      - rejectedCount.value * 18
      + approvedCount.value * 6,
  );
});

const dissentSpread = computed<number>(() => {
  if (runtimeSnapshot.value) {
    return runtimeSnapshot.value.performance.dissentSpread;
  }
  return clampMetric(
    8
      + reviewingCount.value * 17
      + rejectedCount.value * 16
      + pendingCount.value * 10
      - approvedCount.value * 8,
  );
});

const routingComplexity = computed<number>(() => {
  if (runtimeSnapshot.value) {
    return runtimeSnapshot.value.performance.routingComplexity;
  }
  return clampMetric(
    28
      + pendingCount.value * 14
      + reviewingCount.value * 13
      + rejectedCount.value * 12
      - approvedCount.value * 7,
  );
});

const routingDecision = computed<string>(() => {
  if (routingComplexity.value >= 72) {
    return '并行会诊 + 强制复核';
  }
  if (routingComplexity.value >= 50) {
    return '标准会诊 + 条件复核';
  }
  return '快速通道 + 轻量复核';
});

const backlogRatio = computed<number>(() => {
  if (totalCaseCount.value === 0) {
    return 0;
  }
  return clampMetric((backlogCount.value / totalCaseCount.value) * 100);
});

const escalationExposure = computed<number>(() => {
  if (totalCaseCount.value === 0) {
    return 0;
  }
  return clampMetric((rejectedCount.value / totalCaseCount.value) * 100);
});

const routingStability = computed<number>(() => {
  return clampMetric(
    100
      - routingComplexity.value
      + approvedCount.value * 4
      - rejectedCount.value * 5,
  );
});

const throughputVelocity = computed<number>(() => {
  return clampMetric(
    35
      + approvedCount.value * 15
      - pendingCount.value * 10
      - reviewingCount.value * 8
      - rejectedCount.value * 6,
  );
});

const qualityMomentum = computed<number>(() => {
  return approvedCount.value * 12
    - rejectedCount.value * 16
    - pendingCount.value * 6;
});

const governanceSignalCards = computed<GovernanceSignalCard[]>(() => {
  const backlogPercent = Math.round(backlogRatio.value);
  const convergencePercent = Math.round(consensusConvergence.value);
  const stabilityPercent = Math.round(routingStability.value);
  const escalationPercent = Math.round(escalationExposure.value);

  return [
    {
      key: 'backlog-load',
      title: '复核积压负载',
      value: `${backlogPercent}%`,
      context: `待处理 ${backlogCount.value} / ${totalCaseCount.value}`,
      trend: backlogPercent >= 55 ? '压力升高' : backlogPercent >= 35 ? '持续观察' : '处于安全区',
      state: resolveFactorState(backlogPercent, 35, 55),
    },
    {
      key: 'consensus-health',
      title: '共识健康度',
      value: `${convergencePercent}%`,
      context: `动量 ${formatSignedValue(qualityMomentum.value)}`,
      trend: convergencePercent >= 75 ? '收敛健康' : convergencePercent >= 58 ? '存在波动' : '需要干预',
      state: resolveFactorState(100 - convergencePercent, 28, 45),
    },
    {
      key: 'routing-stability',
      title: '路由稳定度',
      value: `${stabilityPercent}%`,
      context: `决策速率 ${Math.round(throughputVelocity.value)}%`,
      trend: stabilityPercent >= 74 ? '路径稳定' : stabilityPercent >= 52 ? '偶发偏移' : '决策抖动',
      state: resolveFactorState(100 - stabilityPercent, 24, 42),
    },
    {
      key: 'escalation-exposure',
      title: '升级暴露率',
      value: `${escalationPercent}%`,
      context: `驳回 ${rejectedCount.value} 例`,
      trend: escalationPercent >= 30 ? '高暴露' : escalationPercent >= 18 ? '可控预警' : '低暴露',
      state: resolveFactorState(escalationPercent, 18, 30),
    },
  ];
});

const governanceStagePulse = computed<GovernanceStagePulse[]>(() => {
  const routingPulse = Math.round(clampMetric(routingComplexity.value));
  const debatePulse = Math.round(
    clampMetric(dissentSpread.value + reviewingCount.value * 6),
  );
  const reviewPulse = Math.round(
    clampMetric(backlogRatio.value + pendingCount.value * 8 + rejectedCount.value * 6),
  );

  return [
    {
      key: 'routing',
      label: '路由判定阶段',
      value: routingPulse,
      benchmark: '< 55',
      hint: '复杂度越高，越需要会诊路径解释与二次确认。',
      state: resolveFactorState(routingPulse, 55, 72),
    },
    {
      key: 'debate',
      label: '分歧辩论阶段',
      value: debatePulse,
      benchmark: '< 50',
      hint: '分歧脉冲持续偏高时，建议提前触发主持 Agent 收敛。',
      state: resolveFactorState(debatePulse, 50, 68),
    },
    {
      key: 'review',
      label: '复核交接阶段',
      value: reviewPulse,
      benchmark: '< 45',
      hint: '复核债务累积会直接影响临床交接时效与风险。',
      state: resolveFactorState(reviewPulse, 45, 62),
    },
  ];
});

const governanceActionItems = computed<GovernanceActionItem[]>(() => {
  const candidates = [
    {
      id: 'action-consensus',
      title: '加速共识收敛',
      trigger: `收敛指数 ${Math.round(consensusConvergence.value)}%`,
      action: '对分歧最高病例启用双人复核，并记录驳回原因模板。',
      owner: '复核负责人',
      eta: '45 分钟',
      score: clampMetric(
        (100 - consensusConvergence.value)
          + reviewingCount.value * 6
          + rejectedCount.value * 8,
      ),
    },
    {
      id: 'action-backlog',
      title: '削峰复核积压',
      trigger: `积压率 ${Math.round(backlogRatio.value)}%`,
      action: '将待复核病例按红旗信号和复杂度排序，优先处理 Top 30%。',
      owner: '审核协调员',
      eta: '30 分钟',
      score: clampMetric(backlogRatio.value + pendingCount.value * 4),
    },
    {
      id: 'action-latency',
      title: '压降时延重试热力',
      trigger: `热度 ${Math.round(latencyRetryHeat.value)} / 100`,
      action: '限制高频重试会话并切换到简化编排路径，降低系统抖动。',
      owner: '平台值班',
      eta: '20 分钟',
      score: clampMetric(latencyRetryHeat.value + retryPressure.value * 2),
    },
    {
      id: 'action-routing',
      title: '强化路由可解释复核',
      trigger: `复杂度 ${Math.round(routingComplexity.value)} / 100`,
      action: '对高复杂路由补充因果依据摘要后再进入临床交接。',
      owner: '路由审校',
      eta: '60 分钟',
      score: clampMetric(routingComplexity.value + (100 - routingStability.value) * 0.5),
    },
    {
      id: 'action-escalation',
      title: '降低升级暴露',
      trigger: `升级暴露率 ${Math.round(escalationExposure.value)}%`,
      action: '对驳回病例回溯触发规则，补齐高风险案例的前置筛查。',
      owner: '风险治理',
      eta: '90 分钟',
      score: clampMetric(escalationExposure.value * 1.8 + rejectedCount.value * 6),
    },
  ]
    .filter((candidate) => candidate.score >= 45)
    .map((candidate) => {
      return {
        ...candidate,
        priority: resolveActionPriority(candidate.score),
      };
    })
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return [
      {
        id: 'action-routine',
        title: '维持抽样审计节奏',
        trigger: '系统态势稳定',
        action: '按小时抽检已通过样本，持续校验证据完整性与可追溯性。',
        owner: '治理运营',
        eta: '持续执行',
        priority: 'low',
      },
    ];
  }

  return candidates.slice(0, 3).map((candidate) => {
    return {
      id: candidate.id,
      title: candidate.title,
      trigger: candidate.trigger,
      action: candidate.action,
      owner: candidate.owner,
      eta: candidate.eta,
      priority: candidate.priority,
    };
  });
});

const missionNarratives = computed<string[]>(() => {
  const signalText = governanceSignal.value === 'critical'
    ? '当前处于告警态势，建议启动强制复核。'
    : governanceSignal.value === 'warning'
      ? '当前处于观察态势，建议优先压降积压与分歧。'
      : '当前处于稳定态势，可维持抽样审计。';

  return [
    `复核池规模 ${totalCaseCount.value}，待处理 ${backlogCount.value}，积压率 ${Math.round(backlogRatio.value)}%。`,
    `收敛指数 ${Math.round(consensusConvergence.value)}%，路由稳定度 ${Math.round(routingStability.value)}%，升级暴露率 ${Math.round(escalationExposure.value)}%。`,
    signalText,
  ];
});

const backendFactorCards = computed<BackendFactorCard[]>(() => {
  const convergenceRisk = 100 - consensusConvergence.value;

  return [
    {
      key: 'latency-retry',
      title: '推理时延与重试热力',
      primary: `热度 ${Math.round(latencyRetryHeat.value)} / 100`,
      secondary: `重试压力 ${retryPressure.value}`,
      state: resolveFactorState(latencyRetryHeat.value, 45, 70),
      hint: '用于识别高负载阶段与潜在超时风险',
    },
    {
      key: 'consensus',
      title: '分歧收敛曲线',
      primary: `收敛指数 ${Math.round(consensusConvergence.value)}%`,
      secondary: `分歧跨度 ${Math.round(dissentSpread.value)}%`,
      state: resolveFactorState(convergenceRisk, 30, 55),
      hint: '用于评估多 Agent 观点是否达到可交付阈值',
    },
    {
      key: 'routing-waterfall',
      title: '路由因果瀑布',
      primary: `复杂度 ${Math.round(routingComplexity.value)} / 100`,
      secondary: routingDecision.value,
      state: resolveFactorState(routingComplexity.value, 50, 72),
      hint: '用于解释病例为何进入当前协同路径',
    },
  ];
});

const pageSummary = computed<string>(() => {
  if (activeTab.value === 'dashboard') {
    return '聚焦治理信号面板、阶段执行脉冲与行动清单，形成可执行的复核闭环。';
  }
  return `对分诊输出进行复核与裁决后再进入临床交接（当前过滤：${FILTER_LABELS[queueFilter.value]}）。`;
});

const governanceUpgradeTip = computed<string>(() => {
  if (runtimeSnapshot.value) {
    return '已连接后端实时治理快照，当前展示为运行态可视化。';
  }
  return '治理看板为后端运行态可视化，请保持后端服务可用。';
});

function updateQueueStatus(itemId: string, status: QueueUpdateStatus): void {
  if (runtimeSnapshot.value || !allowDemoFallback) {
    return;
  }

  reviewItems.value = reviewItems.value.map((item) => {
    if (item.id !== itemId) {
      return item;
    }

    return {
      ...item,
      status,
    };
  });
}

function resolveFocusStage(status: ReviewStatus): WorkflowStage {
  if (status === 'reviewing') return 'DEBATE';
  if (status === 'approved') return 'OUTPUT';
  if (status === 'rejected') return 'ESCALATION';
  return 'REVIEW';
}

function handleSelectReview(item: ReviewItem): void {
  selectedEvidences.value = buildEvidenceBundle(item);
  showEvidenceDrawer.value = true;
  dashboardFocusStage.value = resolveFocusStage(item.status);
}

function handleApproveReview(item: ReviewItem): void {
  updateQueueStatus(item.id, 'approved');
}

function handleRejectReview(item: ReviewItem): void {
  updateQueueStatus(item.id, 'rejected');
}

function handleDashboardQueueFilterChange(filter: QueueFilter): void {
  queueFilter.value = filter;
  activeTab.value = 'queue';
}

function clearQueueFilter(): void {
  queueFilter.value = 'all';
}

function formatRuntimeUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const runtimeUpdatedAtText = computed<string>(() => {
  if (!runtimeSnapshot.value) {
    return '--';
  }
  return formatRuntimeUpdatedAt(runtimeSnapshot.value.generatedAt);
});

const ruleCatalogVersionText = computed<string>(() => {
  return (
    ruleVersion.value?.catalogVersion
    || ruleCatalog.value?.catalogVersion
    || '--'
  );
});

const ruleSynonymVersionText = computed<string>(() => {
  return (
    ruleVersion.value?.synonymSetVersion
    || ruleCatalog.value?.synonymSetVersion
    || '--'
  );
});

const ruleGuidelineCountText = computed<string>(() => {
  if (typeof ruleVersion.value?.guidelineCount === 'number') {
    return String(ruleVersion.value.guidelineCount);
  }
  if (ruleCatalog.value) {
    return String(ruleCatalog.value.guidelineReferences.length);
  }
  return '--';
});

const ruleLayerCountText = computed<string>(() => {
  if (!ruleCatalog.value) {
    return '--';
  }
  return String(ruleCatalog.value.layers.length);
});

const isRuntimeLinked = computed<boolean>(() => {
  return runtimeSnapshot.value !== null;
});

async function refreshRuntimeSnapshot(): Promise<void> {
  runtimeLoading.value = true;
  try {
    runtimeSnapshot.value = await fetchGovernanceRuntime();
    runtimeLoadError.value = '';
  } catch {
    runtimeSnapshot.value = null;
    runtimeLoadError.value = '后端治理实时数据不可用，请确认后端服务与 /governance/runtime 接口。';
  } finally {
    runtimeLoading.value = false;
  }
}

async function refreshRuleGovernanceMetadata(): Promise<void> {
  try {
    const [catalog, version] = await Promise.all([
      fetchGovernanceRuleCatalog(),
      fetchGovernanceRuleVersion(),
    ]);
    ruleCatalog.value = catalog;
    ruleVersion.value = version;
  } catch {
    ruleCatalog.value = null;
    ruleVersion.value = null;
  }
}

onMounted(() => {
  if (import.meta.env.MODE === 'test') {
    return;
  }

  void refreshRuleGovernanceMetadata();
  void refreshRuntimeSnapshot();
  runtimePollTimer = setInterval(() => {
    void refreshRuntimeSnapshot();
  }, GOVERNANCE_RUNTIME_POLL_MS);
});

onBeforeUnmount(() => {
  if (runtimePollTimer) {
    clearInterval(runtimePollTimer);
    runtimePollTimer = null;
  }
});
</script>

<template>
  <div class="governance-view">
    <header class="hero">
      <div class="hero-copy">
        <p class="eyebrow">治理运营</p>
        <h1>协同态势与临床复核</h1>
        <p>{{ pageSummary }}</p>
        <div class="mission-meta">
          <span class="mission-chip">
            复核通过率 {{ governanceScore }}%
          </span>
          <span class="mission-chip" :data-signal="governanceSignal">
            {{ governanceSignal === 'critical' ? '告警态势' : governanceSignal === 'warning' ? '观察态势' : '稳定态势' }}
          </span>
          <span class="mission-chip" :data-source="isRuntimeLinked ? 'runtime' : 'offline'">
            {{ isRuntimeLinked ? `实时数据 ${runtimeUpdatedAtText}` : '后端未连接' }}
          </span>
          <span class="mission-chip" data-testid="governance-catalog-version">
            规则库 {{ ruleCatalogVersionText }}
          </span>
          <span class="mission-chip" data-testid="governance-guideline-count">
            指南 {{ ruleGuidelineCountText }}
          </span>
        </div>
        <ul class="mission-narratives" data-testid="governance-mission-narratives">
          <li v-for="line in missionNarratives" :key="line">{{ line }}</li>
        </ul>
        <section
          class="backend-factor-strip"
          aria-label="后端执行因素总览"
          data-testid="backend-factor-strip"
        >
          <article
            v-for="factor in backendFactorCards"
            :key="factor.key"
            class="factor-card"
            :data-state="factor.state"
            :data-factor="factor.key"
          >
            <header>
              <strong>{{ factor.title }}</strong>
              <span>
                {{ factor.state === 'critical' ? '高压' : factor.state === 'warning' ? '波动' : '稳定' }}
              </span>
            </header>
            <p class="factor-primary">{{ factor.primary }}</p>
            <p class="factor-secondary">{{ factor.secondary }}</p>
            <small>{{ factor.hint }}</small>
          </article>
        </section>
        <div class="hero-actions">
          <a class="fhir-link" href="/fhir">前往 FHIR 资源浏览</a>
          <span class="governance-upgrade-tip">
            {{ governanceUpgradeTip }}
          </span>
          <span
            class="governance-upgrade-tip"
            data-testid="governance-rule-version-hint"
          >
            Synonym {{ ruleSynonymVersionText }} · Layers {{ ruleLayerCountText }}
          </span>
          <span v-if="runtimeLoadError" class="runtime-error-tip">{{ runtimeLoadError }}</span>
        </div>
      </div>

      <div class="hero-stats">
        <article class="stat-card">
          <span class="stat-value">{{ pendingCount }}</span>
          <span class="stat-label">待复核</span>
        </article>
        <article class="stat-card">
          <span class="stat-value">{{ reviewingCount }}</span>
          <span class="stat-label">复核中</span>
        </article>
        <article class="stat-card">
          <span class="stat-value">{{ approvedCount }}</span>
          <span class="stat-label">已通过</span>
        </article>
      </div>
    </header>

    <nav class="tab-nav" aria-label="治理视图切换">
      <button
        :class="{ active: activeTab === 'dashboard' }"
        @click="activeTab = 'dashboard'"
      >
        治理看板
      </button>
      <button :class="{ active: activeTab === 'queue' }" @click="activeTab = 'queue'">
        复核队列
        <span v-if="pendingCount > 0" class="badge">{{ pendingCount }}</span>
      </button>
    </nav>

    <main class="view-content">
      <section v-if="activeTab === 'dashboard'" class="tab-content">
        <section class="dashboard-intelligence-grid" data-testid="governance-intelligence-grid">
          <article class="intel-panel">
            <header class="intel-head">
              <h3>治理信号面板</h3>
              <span>跨队列关键风险</span>
            </header>
            <div class="intel-signal-grid">
              <article
                v-for="card in governanceSignalCards"
                :key="card.key"
                class="intel-signal-card"
                :data-state="card.state"
              >
                <div class="intel-signal-head">
                  <strong>{{ card.title }}</strong>
                  <span>{{ card.trend }}</span>
                </div>
                <p class="intel-signal-value">{{ card.value }}</p>
                <p class="intel-signal-context">{{ card.context }}</p>
              </article>
            </div>
          </article>

          <article class="intel-panel">
            <header class="intel-head">
              <h3>阶段执行脉冲</h3>
              <span>按阶段识别波动</span>
            </header>
            <ul class="stage-pulse-list">
              <li
                v-for="stage in governanceStagePulse"
                :key="stage.key"
                class="stage-pulse-item"
                :data-state="stage.state"
              >
                <div class="stage-pulse-head">
                  <strong>{{ stage.label }}</strong>
                  <span>{{ stage.value }}%</span>
                </div>
                <div class="stage-pulse-track">
                  <span :style="{ width: `${stage.value}%` }" />
                </div>
                <p>{{ stage.hint }}</p>
                <small>目标阈值：{{ stage.benchmark }}</small>
              </li>
            </ul>
          </article>

          <article class="intel-panel action-panel" data-testid="governance-action-list">
            <header class="intel-head">
              <h3>治理行动清单</h3>
              <span>按优先级闭环执行</span>
            </header>
            <ol class="action-items">
              <li
                v-for="action in governanceActionItems"
                :key="action.id"
                class="action-item"
                :data-priority="action.priority"
              >
                <div class="action-item-head">
                  <strong>{{ action.title }}</strong>
                  <span>{{ PRIORITY_LABELS[action.priority] }}</span>
                </div>
                <p>{{ action.action }}</p>
                <small>
                  触发：{{ action.trigger }} ｜ 责任：{{ action.owner }} ｜ 时限：{{ action.eta }}
                </small>
              </li>
            </ol>
          </article>
        </section>

        <GovernanceDashboard
          :queue-overview="{
            pending: pendingCount,
            reviewing: reviewingCount,
            approved: approvedCount,
            rejected: rejectedCount,
          }"
          :external-focus-stage="dashboardFocusStage"
          :runtime-stage-runtime="runtimeSnapshot?.stageRuntime ?? null"
          :runtime-current-stage="runtimeSnapshot?.currentStage ?? null"
          :rule-catalog-layers="ruleCatalog?.layers ?? []"
          :rule-guideline-references="ruleCatalog?.guidelineReferences ?? []"
          :rule-catalog-version="ruleCatalogVersionText === '--' ? null : ruleCatalogVersionText"
          :rule-synonym-version="ruleSynonymVersionText === '--' ? null : ruleSynonymVersionText"
          @queue-filter-change="handleDashboardQueueFilterChange"
        />
      </section>

      <section v-else class="tab-content queue-layout">
        <article class="queue-panel">
          <div class="queue-filter-bar">
            <span>当前过滤：{{ FILTER_LABELS[queueFilter] }}</span>
            <button type="button" @click="clearQueueFilter">清除过滤</button>
          </div>
          <ReviewQueue
            :items="filteredReviewItems"
            :loading="runtimeLoading"
            @select="handleSelectReview"
            @approve="handleApproveReview"
            @reject="handleRejectReview"
          />
        </article>
        <aside class="queue-note">
          <h3>复核清单</h3>
          <ol>
            <li>确认该病例关键证据齐全。</li>
            <li>核对推理依据、引用来源和安全状态。</li>
            <li>明确通过/驳回，并给出后续纠正动作。</li>
          </ol>
        </aside>
      </section>
    </main>

    <EvidenceDrawer
      :visible="showEvidenceDrawer"
      :evidences="selectedEvidences"
      title="复核证据包"
      @close="showEvidenceDrawer = false"
    />
  </div>
</template>

<style scoped>
.governance-view {
  min-height: 100%;
  padding: 18px;
  color: var(--color-text-primary);
}

.hero {
  --hero-glow-warm: color-mix(in srgb, var(--color-warning) 22%, transparent);
  --hero-glow-cool: color-mix(in srgb, var(--color-info) 18%, transparent);
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  gap: 16px;
  margin-bottom: 16px;
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 0% 0%, var(--hero-glow-warm), transparent 44%),
    radial-gradient(circle at 100% 100%, var(--hero-glow-cool), transparent 42%),
    var(--color-bg-primary);
  box-shadow: var(--shadow-md);
}

.hero-copy h1 {
  margin: 2px 0 8px;
  font-size: 32px;
  line-height: 1.08;
}

.hero-copy p {
  margin: 0;
  max-width: 62ch;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.55;
}

.mission-meta {
  margin-top: 10px;
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mission-narratives {
  margin: 12px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.45;
}

.mission-chip {
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.mission-chip[data-signal='normal'] {
  color: var(--color-risk-normal-fg);
  border-color: var(--color-risk-normal-border);
  background: var(--color-risk-normal-bg);
}

.mission-chip[data-signal='warning'] {
  color: var(--color-risk-warning-fg);
  border-color: var(--color-risk-warning-border);
  background: var(--color-risk-warning-bg);
}

.mission-chip[data-signal='critical'] {
  color: var(--color-risk-critical-fg);
  border-color: var(--color-risk-critical-border);
  background: var(--color-risk-critical-bg);
}

.mission-chip[data-source='runtime'] {
  color: var(--color-primary-dark);
  border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.mission-chip[data-source='offline'] {
  color: var(--color-text-muted);
  border-color: var(--color-border);
  background: color-mix(in srgb, var(--color-bg-tertiary) 82%, transparent);
}

.backend-factor-strip {
  margin-top: 12px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
  border-radius: var(--radius-md);
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  background: color-mix(in srgb, var(--color-bg-primary) 86%, transparent);
}

.factor-card {
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  padding: 8px 10px;
  display: grid;
  gap: 6px;
}

.factor-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.factor-card header strong {
  font-size: 13px;
  color: var(--color-text-primary);
}

.factor-card header span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.factor-card .factor-primary {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.factor-card .factor-secondary {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.factor-card small {
  font-size: 12px;
  color: var(--color-text-muted);
}

.factor-card[data-state='normal'] {
  border-color: var(--color-risk-normal-border);
}

.factor-card[data-state='warning'] {
  border-color: var(--color-risk-warning-border);
  background: var(--color-risk-warning-bg);
}

.factor-card[data-state='critical'] {
  border-color: var(--color-risk-critical-border);
  background: var(--color-risk-critical-bg);
}

.hero-actions {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.fhir-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  color: var(--color-text-primary);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}

.fhir-link:hover {
  border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-primary));
}

.governance-upgrade-tip {
  font-size: 13px;
  color: var(--color-text-muted);
}

.runtime-error-tip {
  font-size: 12px;
  color: var(--color-risk-warning-fg);
  border: 1px solid var(--color-risk-warning-border);
  background: var(--color-risk-warning-bg);
  border-radius: 999px;
  padding: 4px 10px;
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(110px, 1fr));
  gap: 10px;
}

.stat-card {
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 86%, transparent);
}

.stat-value {
  display: block;
  font-size: 30px;
  line-height: 1;
  font-weight: 700;
}

.stat-label {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.tab-nav {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-bg-primary) 86%, transparent);
}

.tab-nav button {
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-secondary);
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 160ms ease;
}

.tab-nav button:hover {
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-bg-tertiary) 84%, transparent);
}

.tab-nav button.active {
  color: var(--cc-text-inverse);
  background: linear-gradient(
    130deg,
    var(--color-primary) 0%,
    var(--color-primary-dark) 100%
  );
  box-shadow: var(--shadow-sm);
}

.badge {
  font-size: 11px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 999px;
  color: var(--cc-text-inverse);
  background: var(--color-danger);
}

.view-content {
  min-height: 440px;
}

.dashboard-intelligence-grid {
  margin-bottom: 14px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.intel-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  padding: 12px;
  box-shadow: var(--shadow-sm);
}

.intel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.intel-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--color-text-primary);
}

.intel-head span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.intel-signal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.intel-signal-card {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 8px;
  background: color-mix(in srgb, var(--color-surface-elevated) 88%, transparent);
  display: grid;
  gap: 5px;
}

.intel-signal-card[data-state='normal'] {
  border-color: var(--color-risk-normal-border);
}

.intel-signal-card[data-state='warning'] {
  border-color: var(--color-risk-warning-border);
  background: var(--color-risk-warning-bg);
}

.intel-signal-card[data-state='critical'] {
  border-color: var(--color-risk-critical-border);
  background: var(--color-risk-critical-bg);
}

.intel-signal-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.intel-signal-head strong {
  font-size: 12px;
  color: var(--color-text-primary);
}

.intel-signal-head span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.intel-signal-value {
  margin: 0;
  font-size: 20px;
  line-height: 1.05;
  font-weight: 700;
  color: var(--color-text-primary);
}

.intel-signal-context {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.stage-pulse-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.stage-pulse-item {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 8px;
  background: color-mix(in srgb, var(--color-surface-elevated) 88%, transparent);
  display: grid;
  gap: 6px;
}

.stage-pulse-item[data-state='normal'] {
  border-color: var(--color-risk-normal-border);
}

.stage-pulse-item[data-state='warning'] {
  border-color: var(--color-risk-warning-border);
  background: var(--color-risk-warning-bg);
}

.stage-pulse-item[data-state='critical'] {
  border-color: var(--color-risk-critical-border);
  background: var(--color-risk-critical-bg);
}

.stage-pulse-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.stage-pulse-head strong {
  font-size: 12px;
  color: var(--color-text-primary);
}

.stage-pulse-head span {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stage-pulse-track {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-border-light) 86%, transparent);
  overflow: hidden;
}

.stage-pulse-track span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    var(--color-primary) 0%,
    var(--color-info) 100%
  );
}

.stage-pulse-item p {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.stage-pulse-item small {
  font-size: 11px;
  color: var(--color-text-muted);
}

.action-items {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
}

.action-item {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-surface-elevated) 90%, transparent);
  padding: 8px;
  list-style-position: inside;
  display: grid;
  gap: 5px;
}

.action-item[data-priority='high'] {
  border-color: var(--color-risk-critical-border);
  background: var(--color-risk-critical-bg);
}

.action-item[data-priority='medium'] {
  border-color: var(--color-risk-warning-border);
  background: var(--color-risk-warning-bg);
}

.action-item[data-priority='low'] {
  border-color: var(--color-risk-normal-border);
  background: var(--color-risk-normal-bg);
}

.action-item-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.action-item-head strong {
  font-size: 13px;
  color: var(--color-text-primary);
}

.action-item-head span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.action-item p {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.45;
}

.action-item small {
  font-size: 11px;
  color: var(--color-text-muted);
}

.tab-content {
  animation: panel-in 220ms ease;
}

.queue-layout {
  display: grid;
  grid-template-columns: minmax(280px, 520px) minmax(220px, 1fr);
  gap: 16px;
}

.queue-panel {
  min-height: 500px;
}

.queue-filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.queue-filter-bar button {
  border: 1px solid var(--color-border-interactive);
  border-radius: var(--radius-sm);
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
}

.queue-note {
  align-self: start;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 16px;
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
  box-shadow: var(--shadow-sm);
}

.queue-note h3 {
  margin: 0 0 10px;
  font-size: 16px;
}

.queue-note ol {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1080px) {
  .hero {
    grid-template-columns: 1fr;
  }

  .hero-stats {
    grid-template-columns: repeat(3, minmax(90px, 1fr));
  }

  .queue-layout {
    grid-template-columns: 1fr;
  }

  .backend-factor-strip {
    grid-template-columns: 1fr;
  }

  .dashboard-intelligence-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .governance-view {
    padding: 12px;
  }

  .hero {
    padding: 14px;
  }

  .hero-copy h1 {
    font-size: 24px;
  }

  .hero-stats {
    grid-template-columns: 1fr;
  }

  .tab-nav {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-radius: 14px;
  }

  .tab-nav button {
    justify-content: center;
  }

  .queue-filter-bar {
    flex-direction: column;
    align-items: flex-start;
  }

  .mission-narratives {
    padding-left: 16px;
    font-size: 12px;
  }

  .intel-panel {
    padding: 10px;
  }

  .intel-signal-grid {
    grid-template-columns: 1fr;
  }
}
</style>

