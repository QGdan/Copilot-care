<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { type ECharts, init, use } from 'echarts/core';
import { usePatientDashboard } from '../composables/usePatientDashboard';
import { buildVitalsChartOption } from '../features/patient/chart';
import {
  CONSULTATION_STATUS_COLORS,
  CONSULTATION_STATUS_LABELS,
  SEX_LABELS,
  TRIAGE_LEVEL_LABELS,
  type ConsultationRecord,
} from '../features/patient/model';

use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const route = useRoute();
const router = useRouter();

const chartRef = ref<HTMLElement | null>(null);
let vitalsChart: ECharts | null = null;

const {
  loading,
  error,
  patientData,
  patientInsights,
  vitalsRecords,
  consultationHistory,
  hasPatient,
  loadPatientData,
  clearError,
} = usePatientDashboard();

const patientId = computed<string>(() => {
  const raw = route.params.id;
  return typeof raw === 'string' ? raw : '';
});

const patientDisplayName = computed<string>(() => {
  if (patientData.value?.name) {
    return patientData.value.name;
  }
  if (patientId.value) {
    return `患者 ${patientId.value}`;
  }
  return '演示患者';
});

const patientMeta = computed<string[]>(() => {
  const items: string[] = [];

  if (patientData.value?.age !== undefined) {
    items.push(`${patientData.value.age} 岁`);
  } else {
    items.push('年龄未知');
  }

  const sexKey = patientData.value?.sex ?? 'other';
  items.push(SEX_LABELS[sexKey] ?? SEX_LABELS.other);

  if (patientData.value?.tcmConstitution) {
    items.push(patientData.value.tcmConstitution);
  }

  return items;
});

const latestVitals = computed(() => {
  if (vitalsRecords.value.length === 0) {
    return null;
  }
  return vitalsRecords.value[vitalsRecords.value.length - 1];
});

const escalatedCount = computed<number>(
  () =>
    consultationHistory.value.filter(
      (record) => record.status === 'ESCALATE_TO_OFFLINE',
    ).length,
);

const followupSignal = computed<'normal' | 'warning' | 'critical'>(() => {
  if (escalatedCount.value >= 2) {
    return 'critical';
  }
  if (escalatedCount.value > 0) {
    return 'warning';
  }
  return 'normal';
});

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMetric(value: number | undefined, unit: string): string {
  if (value === undefined) {
    return '--';
  }

  const precision = unit === 'mmHg' || unit === 'bpm' ? 0 : 1;
  return `${value.toFixed(precision)} ${unit}`;
}

function handleChartResize(): void {
  vitalsChart?.resize();
}

function renderVitalsChart(): void {
  if (!chartRef.value || vitalsRecords.value.length === 0) {
    return;
  }

  if (!vitalsChart) {
    vitalsChart = init(chartRef.value);
    window.addEventListener('resize', handleChartResize);
  }

  vitalsChart.setOption(buildVitalsChartOption(vitalsRecords.value), true);
}

async function refreshDashboard(): Promise<void> {
  await loadPatientData(patientId.value);
  await nextTick();
  renderVitalsChart();
}

function goBack(): void {
  if (window.history.length > 1) {
    router.back();
    return;
  }

  void router.push('/');
}

function goToConsultation(): void {
  if (patientId.value) {
    void router.push({
      path: '/',
      query: { patientId: patientId.value },
    });
    return;
  }

  void router.push('/');
}

function openConsultationRecord(record: ConsultationRecord): void {
  void router.push({
    path: '/',
    query: {
      patientId: patientId.value || patientData.value?.patientId || 'demo-001',
      consultationId: record.id,
    },
  });
}

function retryLoad(): void {
  clearError();
  void refreshDashboard();
}

watch(
  patientId,
  () => {
    void refreshDashboard();
  },
  { immediate: true },
);

watch(vitalsRecords, () => {
  void nextTick().then(() => renderVitalsChart());
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleChartResize);

  if (!vitalsChart) {
    return;
  }

  vitalsChart.dispose();
  vitalsChart = null;
});
</script>

<template>
  <div class="patient-dashboard">
    <header class="page-hero">
      <button class="ghost-btn" @click="goBack">返回</button>

      <div class="hero-copy">
        <p class="eyebrow">患者看板</p>
        <h1>{{ patientDisplayName }}</h1>
        <p>纵向画像、生命体征趋势与历史会诊时间线。</p>
        <div class="hero-chips">
          <span class="hero-chip">累计会诊 {{ consultationHistory.length }} 次</span>
          <span class="hero-chip" :data-signal="followupSignal">
            {{ followupSignal === 'critical' ? '需重点随访' : followupSignal === 'warning' ? '建议跟踪' : '趋势稳定' }}
          </span>
        </div>
      </div>

      <button class="primary-btn" @click="goToConsultation">
        发起会诊
      </button>
    </header>

    <section v-if="loading" class="state-panel">
      <div class="spinner" />
      <p>正在加载患者看板...</p>
    </section>

    <section v-else-if="error" class="state-panel error-panel">
      <h3>患者数据加载不完整</h3>
      <p>{{ error }}</p>
      <button class="primary-btn" @click="retryLoad">重试</button>
    </section>

    <template v-else-if="hasPatient && patientData">
      <section class="summary-grid">
        <article class="profile-card">
          <div class="profile-head">
            <div class="avatar">PT</div>
            <div>
              <h2>{{ patientDisplayName }}</h2>
              <div class="meta-list">
                <span v-for="metaItem in patientMeta" :key="metaItem" class="meta-pill">
                  {{ metaItem }}
                </span>
              </div>
            </div>
          </div>

          <div class="profile-body">
            <div class="detail-block">
              <h4>主诉</h4>
              <p>
                {{
                  patientData.chiefComplaint ||
                  '当前患者未填写主诉信息。'
                }}
              </p>
            </div>

            <div class="detail-columns">
              <div class="detail-block">
                <h4>慢病史</h4>
                <div class="tag-list">
                  <span
                    v-for="disease in patientData.chronicDiseases || []"
                    :key="disease"
                    class="tag danger"
                  >
                    {{ disease }}
                  </span>
                  <span v-if="(patientData.chronicDiseases || []).length === 0" class="tag empty">
                    暂无
                  </span>
                </div>
              </div>

              <div class="detail-block">
                <h4>用药史</h4>
                <div class="tag-list">
                  <span
                    v-for="medication in patientData.medicationHistory || []"
                    :key="medication"
                    class="tag info"
                  >
                    {{ medication }}
                  </span>
                  <span
                    v-if="(patientData.medicationHistory || []).length === 0"
                    class="tag empty"
                  >
                    暂无
                  </span>
                </div>
              </div>

              <div class="detail-block">
                <h4>生活方式标签</h4>
                <div class="tag-list">
                  <span
                    v-for="lifestyleTag in patientData.lifestyleTags || []"
                    :key="lifestyleTag"
                    class="tag neutral"
                  >
                    {{ lifestyleTag }}
                  </span>
                  <span v-if="(patientData.lifestyleTags || []).length === 0" class="tag empty">
                    暂无
                  </span>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article class="stat-card">
          <h3>最新血压</h3>
          <strong>
            {{ formatMetric(latestVitals?.systolicBP, 'mmHg') }} /
            {{ formatMetric(latestVitals?.diastolicBP, 'mmHg') }}
          </strong>
          <p>最近一次收缩压与舒张压记录。</p>
        </article>

        <article class="stat-card">
          <h3>最新心率</h3>
          <strong>{{ formatMetric(latestVitals?.heartRate, 'bpm') }}</strong>
          <p>来自监测流的最近一次观察值。</p>
        </article>

        <article class="stat-card">
          <h3>线下转诊次数</h3>
          <strong>{{ escalatedCount }}</strong>
          <p>历史会诊中触发线下跟进的次数。</p>
        </article>
      </section>

      <section class="panel-card vitals-panel">
        <header class="panel-header">
          <h3>生命体征趋势</h3>
          <span class="panel-meta">最近 30 天轨迹</span>
        </header>
        <div ref="chartRef" class="chart-container" />
      </section>

      <section v-if="patientInsights.length > 0" class="panel-card">
        <header class="panel-header">
          <h3>临床洞察</h3>
          <span class="panel-meta">基于画像与观察数据生成</span>
        </header>
        <ul class="insights-list">
          <li v-for="(insight, index) in patientInsights" :key="`${index}-${insight}`">
            {{ insight }}
          </li>
        </ul>
      </section>

      <section class="panel-card">
        <header class="panel-header">
          <h3>会诊历史</h3>
          <button class="ghost-btn small" @click="goToConsultation">
            新建会诊
          </button>
        </header>

        <div class="history-list">
          <article
            v-for="record in consultationHistory"
            :key="record.id"
            class="history-item"
            @click="openConsultationRecord(record)"
          >
            <div class="history-date">{{ formatDate(record.date) }}</div>

            <div class="history-main">
              <span class="department-chip">{{ record.department }}</span>
              <p>{{ record.conclusion }}</p>
            </div>

            <div class="history-meta">
              <span
                class="status-pill"
                :style="{
                  borderColor: `${CONSULTATION_STATUS_COLORS[record.status]}66`,
                  backgroundColor: `${CONSULTATION_STATUS_COLORS[record.status]}20`,
                  color: CONSULTATION_STATUS_COLORS[record.status],
                }"
              >
                {{ CONSULTATION_STATUS_LABELS[record.status] }}
              </span>
              <small>
                {{
                  record.triageLevel
                    ? TRIAGE_LEVEL_LABELS[record.triageLevel]
                    : '无风险等级'
                }}
              </small>
            </div>
          </article>
        </div>
      </section>
    </template>

    <section v-else class="state-panel">
      <h3>暂无患者资料</h3>
      <p>请先选择患者，或进入会诊页补充数据。</p>
      <button class="primary-btn" @click="goToConsultation">前往会诊页</button>
    </section>
  </div>
</template>

<style scoped>
.patient-dashboard {
  max-width: 1260px;
  margin: 0 auto;
  padding: 18px;
  display: grid;
  gap: 14px;
}

.page-hero {
  display: grid;
  grid-template-columns: auto minmax(280px, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 8% 5%, rgba(225, 187, 116, 0.24), transparent 42%),
    radial-gradient(circle at 94% 86%, rgba(58, 139, 158, 0.18), transparent 40%),
    var(--color-bg-primary);
  box-shadow: var(--shadow-md);
}

.hero-chips {
  margin-top: 10px;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hero-chip {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-text-muted);
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
}

.hero-chip[data-signal='normal'] {
  color: #1d7f68;
  border-color: rgba(34, 149, 113, 0.3);
  background: rgba(34, 149, 113, 0.12);
}

.hero-chip[data-signal='warning'] {
  color: #8e6114;
  border-color: rgba(208, 145, 41, 0.3);
  background: rgba(208, 145, 41, 0.13);
}

.hero-chip[data-signal='critical'] {
  color: #a94732;
  border-color: rgba(208, 87, 56, 0.33);
  background: rgba(208, 87, 56, 0.13);
}

.hero-copy h1 {
  margin: 2px 0 8px;
  font-size: 30px;
  line-height: 1.08;
}

.hero-copy p {
  margin: 0;
  color: var(--color-text-secondary);
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.primary-btn,
.ghost-btn {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 8px 13px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 140ms ease;
}

.primary-btn {
  color: #ffffff;
  border-color: transparent;
  background: linear-gradient(130deg, #1d8d88 0%, #156777 100%);
  box-shadow: 0 8px 20px rgba(21, 94, 106, 0.25);
}

.primary-btn:hover,
.ghost-btn:hover {
  transform: translateY(-1px);
}

.ghost-btn {
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-bg-primary) 86%, transparent);
}

.ghost-btn.small {
  font-size: 11px;
  padding: 6px 10px;
}

.state-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 42px 20px;
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
  box-shadow: var(--shadow-sm);
  text-align: center;
  display: grid;
  justify-items: center;
  gap: 10px;
}

.error-panel {
  border-color: color-mix(in srgb, var(--color-danger) 34%, var(--color-border));
}

.state-panel h3,
.state-panel p {
  margin: 0;
}

.state-panel p {
  color: var(--color-text-secondary);
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--color-border-light);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 900ms linear infinite;
}

.summary-grid {
  display: grid;
  grid-template-columns: minmax(300px, 1.6fr) repeat(3, minmax(140px, 1fr));
  gap: 12px;
}

.profile-card,
.stat-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-bg-primary) 91%, transparent);
  box-shadow: var(--shadow-sm);
}

.profile-card {
  padding: 14px;
}

.profile-head {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.avatar {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #ffffff;
  background: linear-gradient(135deg, #126d73 0%, #1f9c8f 55%, #d7a846 100%);
}

.profile-head h2 {
  margin: 0;
  font-size: 20px;
}

.meta-list {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid var(--color-border-light);
  background: color-mix(in srgb, var(--color-bg-tertiary) 92%, transparent);
  padding: 3px 8px;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.profile-body {
  display: grid;
  gap: 12px;
}

.detail-columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.detail-block {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: color-mix(in srgb, var(--color-bg-tertiary) 90%, transparent);
}

.detail-block h4 {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.detail-block p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.45;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
}

.tag.danger {
  border-color: color-mix(in srgb, var(--color-danger) 40%, var(--color-border));
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}

.tag.info {
  border-color: color-mix(in srgb, var(--color-info) 40%, var(--color-border));
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  color: var(--color-info);
}

.tag.neutral {
  border-color: var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 82%, transparent);
  color: var(--color-text-secondary);
}

.tag.empty {
  border-color: var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 82%, transparent);
  color: var(--color-text-muted);
}

.stat-card {
  padding: 14px;
  display: grid;
  align-content: center;
  gap: 8px;
}

.stat-card h3 {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.stat-card strong {
  font-size: 26px;
  line-height: 1.05;
}

.stat-card p {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
}

.panel-meta {
  font-size: 12px;
  color: var(--color-text-muted);
}

.vitals-panel {
  padding: 14px;
}

.chart-container {
  width: 100%;
  height: 320px;
}

.insights-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.history-list {
  display: grid;
  gap: 10px;
}

.history-item {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-bg-tertiary) 88%, transparent);
  padding: 10px;
  display: grid;
  grid-template-columns: minmax(120px, auto) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  transition: all 140ms ease;
}

.history-item:hover {
  transform: translateY(-1px);
  border-color: var(--color-border);
}

.history-date {
  font-size: 12px;
  color: var(--color-text-muted);
}

.history-main {
  min-width: 0;
}

.history-main p {
  margin: 7px 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.department-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-info) 36%, var(--color-border));
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  color: var(--color-info);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
}

.history-meta {
  display: grid;
  justify-items: end;
  gap: 6px;
}

.history-meta small {
  font-size: 11px;
  color: var(--color-text-muted);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1080px) {
  .page-hero {
    grid-template-columns: 1fr auto;
  }

  .hero-copy {
    grid-column: 1 / -1;
    order: 3;
  }

  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }

  .profile-card {
    grid-column: 1 / -1;
  }

  .detail-columns {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .patient-dashboard {
    padding: 12px;
  }

  .page-hero {
    grid-template-columns: 1fr;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .history-item {
    grid-template-columns: 1fr;
  }

  .history-meta {
    justify-items: start;
  }
}
</style>
