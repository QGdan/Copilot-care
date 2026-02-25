<script setup lang="ts">
import { computed, ref } from 'vue';
import type { WorkflowStage } from '@copilot-care/shared/types';
import GovernanceDashboard from '../components/GovernanceDashboard.vue';
import ReviewQueue from '../components/ReviewQueue.vue';
import EvidenceDrawer from '../components/EvidenceDrawer.vue';
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

interface BackendFactorCard {
  key: BackendFactorKey;
  title: string;
  primary: string;
  secondary: string;
  state: BackendFactorState;
  hint: string;
}

const FILTER_LABELS: Record<QueueFilter, string> = {
  all: '全部',
  pending: '待复核',
  reviewing: '复核中',
  approved: '已通过',
  rejected: '已驳回',
};

const activeTab = ref<GovernanceTab>('dashboard');
const showEvidenceDrawer = ref<boolean>(false);
const selectedEvidences = ref<EvidenceItem[]>([]);
const reviewItems = ref<ReviewItem[]>(createMockReviewQueue());
const queueFilter = ref<QueueFilter>('all');
const dashboardFocusStage = ref<WorkflowStage | null>(null);

const pendingCount = computed<number>(
  () => reviewItems.value.filter((item) => item.status === 'pending').length,
);

const reviewingCount = computed<number>(
  () => reviewItems.value.filter((item) => item.status === 'reviewing').length,
);

const approvedCount = computed<number>(
  () => reviewItems.value.filter((item) => item.status === 'approved').length,
);

const rejectedCount = computed<number>(
  () => reviewItems.value.filter((item) => item.status === 'rejected').length,
);

const filteredReviewItems = computed<ReviewItem[]>(() => {
  if (queueFilter.value === 'all') {
    return reviewItems.value;
  }
  return reviewItems.value.filter((item) => item.status === queueFilter.value);
});

const governanceScore = computed<number>(() => {
  const total = reviewItems.value.length;
  if (total === 0) {
    return 100;
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

function clampMetric(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
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
  return clampMetric(
    22
      + reviewingCount.value * 18
      + pendingCount.value * 12
      + rejectedCount.value * 15,
  );
});

const retryPressure = computed<number>(() => {
  return pendingCount.value + reviewingCount.value * 2 + rejectedCount.value * 3;
});

const consensusConvergence = computed<number>(() => {
  return clampMetric(
    governanceScore.value
      - reviewingCount.value * 14
      - pendingCount.value * 9
      - rejectedCount.value * 18
      + approvedCount.value * 6,
  );
});

const dissentSpread = computed<number>(() => {
  return clampMetric(
    8
      + reviewingCount.value * 17
      + rejectedCount.value * 16
      + pendingCount.value * 10
      - approvedCount.value * 8,
  );
});

const routingComplexity = computed<number>(() => {
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
    return '聚焦推理时延与重试热力、分歧收敛曲线、路由因果瀑布三类核心执行因素。';
  }
  return `对分诊输出进行复核与裁决后再进入临床交接（当前过滤：${FILTER_LABELS[queueFilter.value]}）。`;
});

function updateQueueStatus(itemId: string, status: QueueUpdateStatus): void {
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
        </div>
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
            已聚焦推理时延与重试热力、分歧收敛矩阵、路由因果瀑布，并联动审计溯源流与编排依赖图。
          </span>
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
        <GovernanceDashboard
          :queue-overview="{
            pending: pendingCount,
            reviewing: reviewingCount,
            approved: approvedCount,
            rejected: rejectedCount,
          }"
          :external-focus-stage="dashboardFocusStage"
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
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  gap: 16px;
  margin-bottom: 16px;
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 0% 0%, rgba(223, 187, 118, 0.22), transparent 44%),
    radial-gradient(circle at 100% 100%, rgba(46, 134, 149, 0.16), transparent 42%),
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

.mission-chip {
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.mission-chip[data-signal='normal'] {
  color: #1d7f68;
  border-color: rgba(34, 149, 113, 0.28);
  background: rgba(34, 149, 113, 0.11);
}

.mission-chip[data-signal='warning'] {
  color: #916413;
  border-color: rgba(208, 145, 41, 0.3);
  background: rgba(208, 145, 41, 0.12);
}

.mission-chip[data-signal='critical'] {
  color: #b14f34;
  border-color: rgba(208, 87, 56, 0.34);
  background: rgba(208, 87, 56, 0.12);
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
  border-color: rgba(34, 149, 113, 0.34);
}

.factor-card[data-state='warning'] {
  border-color: rgba(208, 145, 41, 0.32);
  background: rgba(208, 145, 41, 0.09);
}

.factor-card[data-state='critical'] {
  border-color: rgba(208, 87, 56, 0.34);
  background: rgba(208, 87, 56, 0.08);
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
  color: #ffffff;
  background: linear-gradient(130deg, #1d8d88 0%, #156777 100%);
  box-shadow: 0 10px 20px rgba(21, 84, 99, 0.24);
}

.badge {
  font-size: 11px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 999px;
  color: #ffffff;
  background: #d05738;
}

.view-content {
  min-height: 440px;
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
  border: 1px solid #b5c7d9;
  border-radius: var(--radius-sm);
  background: #f7fbff;
  color: #2f5878;
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
}
</style>
