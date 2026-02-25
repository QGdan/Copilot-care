<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  fhirApi,
  type FHIRObservation,
  type FHIRPatient,
  type FHIRProvenance,
} from '../services/api';

type FHIRResource = FHIRPatient | FHIRObservation | FHIRProvenance;
type ResourceTypeFilter = 'all' | 'Patient' | 'Observation' | 'Provenance';

const resources = ref<FHIRResource[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const selectedType = ref<ResourceTypeFilter>('all');
const searchQuery = ref('');
const apiAvailable = ref<boolean | null>(null);

const resourceTypes: Array<{ value: ResourceTypeFilter; label: string }> = [
  { value: 'all', label: '全部资源' },
  { value: 'Patient', label: '患者（Patient）' },
  { value: 'Observation', label: '观察（Observation）' },
  { value: 'Provenance', label: '溯源（Provenance）' },
];

const typeDescriptions: Record<'Patient' | 'Observation' | 'Provenance', string> = {
  Patient: '人口学信息与患者身份字段。',
  Observation: '结构化生命体征与临床测量记录。',
  Provenance: '数据来源、作者动作与可追溯元数据。',
};

const filteredResources = computed(() => {
  let result = resources.value;

  if (selectedType.value !== 'all') {
    result = result.filter((resource) => resource.resourceType === selectedType.value);
  }

  const q = searchQuery.value.trim().toLowerCase();
  if (!q) {
    return result;
  }

  return result.filter((resource) => {
    const raw = JSON.stringify(resource).toLowerCase();
    return resource.id.toLowerCase().includes(q) || raw.includes(q);
  });
});

const groupedResources = computed(() => {
  const groups: Record<string, FHIRResource[]> = {};
  for (const resource of filteredResources.value) {
    if (!groups[resource.resourceType]) {
      groups[resource.resourceType] = [];
    }
    groups[resource.resourceType].push(resource);
  }
  return groups;
});

const totalTypes = computed(() => Object.keys(groupedResources.value).length);

const filterSummary = computed<string>(() => {
  const typeLabel = selectedType.value === 'all'
    ? '全部类型'
    : selectedType.value;
  const keyword = searchQuery.value.trim();
  if (keyword.length === 0) {
    return `当前筛选：${typeLabel}`;
  }
  return `当前筛选：${typeLabel} · 关键词「${keyword}」`;
});

function getResourceTitle(resource: FHIRResource): string {
  if (resource.resourceType === 'Patient') {
    const family = resource.name?.[0]?.family ?? '';
    const given = resource.name?.[0]?.given?.join(' ') ?? '';
    return `${family} ${given}`.trim() || '未命名患者';
  }

  if (resource.resourceType === 'Observation') {
    return resource.code?.text || resource.code?.coding?.[0]?.display || '观察记录';
  }

  return resource.activity?.text || resource.reason?.[0]?.text || '溯源记录';
}

function getResourceSubtitle(resource: FHIRResource): string {
  if (resource.resourceType === 'Patient') {
    return `${resource.gender || '未知性别'} · ${resource.birthDate || '生日未知'}`;
  }

  if (resource.resourceType === 'Observation') {
    const value = resource.valueQuantity?.value;
    const unit = resource.valueQuantity?.unit || '';
    const valueText = typeof value === 'number' ? `${value}${unit ? ` ${unit}` : ''}` : '无数值';
    return `${resource.status} · ${valueText}`;
  }

  return resource.recorded
    ? `记录时间 ${new Date(resource.recorded).toLocaleString('zh-CN')}`
    : '记录时间未知';
}

function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function getMockData(): FHIRResource[] {
  return [
    {
      resourceType: 'Patient',
      id: 'patient-001',
      active: true,
      gender: 'male',
      birthDate: '1970-03-10',
      name: [{ family: '张', given: ['三'] }],
      identifier: [
        {
          system: 'urn:oid:2.16.840.1.113883.2.4.6.3',
          value: 'patient-001',
        },
      ],
    },
    {
      resourceType: 'Patient',
      id: 'patient-002',
      active: true,
      gender: 'female',
      birthDate: '1985-11-23',
      name: [{ family: '李', given: ['四'] }],
      identifier: [
        {
          system: 'urn:oid:2.16.840.1.113883.2.4.6.3',
          value: 'patient-002',
        },
      ],
    },
    {
      resourceType: 'Observation',
      id: 'obs-001',
      status: 'final',
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '8480-6',
            display: '收缩压',
          },
        ],
        text: '收缩压',
      },
      subject: { reference: 'Patient/patient-001' },
      effectiveDateTime: new Date().toISOString(),
      valueQuantity: {
        value: 145,
        unit: 'mmHg',
        system: 'http://unitsofmeasure.org',
        code: 'mm[Hg]',
      },
    },
    {
      resourceType: 'Observation',
      id: 'obs-002',
      status: 'final',
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '8462-4',
            display: '舒张压',
          },
        ],
        text: '舒张压',
      },
      subject: { reference: 'Patient/patient-001' },
      effectiveDateTime: new Date().toISOString(),
      valueQuantity: {
        value: 92,
        unit: 'mmHg',
        system: 'http://unitsofmeasure.org',
        code: 'mm[Hg]',
      },
    },
    {
      resourceType: 'Provenance',
      id: 'prov-001',
      target: [{ reference: 'Observation/obs-001' }],
      recorded: new Date().toISOString(),
      agent: [
        {
          type: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type',
                code: 'author',
              },
            ],
          },
          who: { reference: 'Device/CoPilotCare' },
        },
      ],
      activity: { text: '自动采集入库' },
    },
  ];
}

async function fetchFhirResources(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    apiAvailable.value = true;

    const [patientsBundle, observationsBundle, provenancesBundle] = await Promise.all([
      fhirApi.getPatients().catch(() => null),
      fhirApi.getObservations().catch(() => null),
      fhirApi.getProvenances().catch(() => null),
    ]);

    const fetchedResources: FHIRResource[] = [];

    if (patientsBundle?.entry) {
      for (const entry of patientsBundle.entry) {
        fetchedResources.push(entry.resource);
      }
    }

    if (observationsBundle?.entry) {
      for (const entry of observationsBundle.entry) {
        fetchedResources.push(entry.resource);
      }
    }

    if (provenancesBundle?.entry) {
      for (const entry of provenancesBundle.entry) {
        fetchedResources.push(entry.resource);
      }
    }

    resources.value = fetchedResources.length > 0 ? fetchedResources : getMockData();
  } catch (cause: unknown) {
    apiAvailable.value = false;
    error.value = cause instanceof Error ? cause.message : '加载 FHIR 资源失败';
    resources.value = getMockData();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void fetchFhirResources();
});
</script>

<template>
  <div class="fhir-page">
    <header class="hero">
      <div>
        <p class="eyebrow">互操作中心</p>
        <h1>FHIR R4 资源浏览台</h1>
        <p>
          查看 Patient、Observation、Provenance 载荷，并按类型与关键字过滤 JSON 详情。
        </p>
      </div>

      <div class="api-state" :class="apiAvailable === false ? 'offline' : 'online'">
        <span class="dot" />
        <span>
          {{ apiAvailable === false ? '当前使用本地 Mock 数据' : '已连接后端 FHIR 接口' }}
        </span>
      </div>
    </header>

    <section class="type-cards">
      <article class="type-card" v-for="type in ['Patient', 'Observation', 'Provenance']" :key="type">
        <h3>{{ type }}</h3>
        <p>{{ typeDescriptions[type as 'Patient' | 'Observation' | 'Provenance'] }}</p>
      </article>
    </section>

    <section class="toolbar">
      <label class="control">
        <span>资源类型</span>
        <select v-model="selectedType">
          <option v-for="type in resourceTypes" :key="type.value" :value="type.value">
            {{ type.label }}
          </option>
        </select>
      </label>

      <label class="control search">
        <span>搜索</span>
        <input v-model="searchQuery" type="text" placeholder="按 ID 或载荷字段搜索..." />
      </label>

      <button class="refresh-btn" :disabled="loading" @click="fetchFhirResources">
        {{ loading ? '加载中...' : '刷新' }}
      </button>
    </section>

    <p class="filter-summary">{{ filterSummary }}</p>

    <section class="stats-grid">
      <article class="stat">
        <span class="value">{{ resources.length }}</span>
        <span class="label">资源总数</span>
      </article>
      <article class="stat">
        <span class="value">{{ totalTypes }}</span>
        <span class="label">资源类型数</span>
      </article>
      <article class="stat">
        <span class="value">{{ filteredResources.length }}</span>
        <span class="label">筛选结果</span>
      </article>
    </section>

    <p v-if="error" class="error-box">{{ error }}</p>

    <section v-if="loading" class="loading-box">
      <div class="spinner" />
      <p>正在加载 FHIR 资源...</p>
    </section>

    <section v-else-if="filteredResources.length === 0" class="empty-box">
      当前筛选条件下没有匹配资源。
    </section>

    <section v-else class="resource-groups">
      <article
        v-for="(groupResources, resourceType) in groupedResources"
        :key="resourceType"
        class="resource-group"
      >
        <header class="group-head">
          <h2>{{ resourceType }}</h2>
          <span>{{ groupResources.length }} 条</span>
        </header>

        <div class="group-grid">
          <article v-for="resource in groupResources" :key="resource.id" class="resource-card">
            <div class="resource-meta">
              <strong>{{ getResourceTitle(resource) }}</strong>
              <span>{{ getResourceSubtitle(resource) }}</span>
            </div>
            <p class="resource-id">ID: {{ resource.id }}</p>
            <pre class="resource-json">{{ formatJson(resource) }}</pre>
          </article>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.fhir-page {
  min-height: 100%;
  padding: 18px;
  color: var(--color-text-primary);
}

.hero {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  gap: 12px;
  align-items: end;
  margin-bottom: 14px;
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 0% 0%, rgba(56, 143, 150, 0.17), transparent 42%),
    radial-gradient(circle at 100% 90%, rgba(227, 178, 103, 0.2), transparent 48%),
    var(--color-bg-primary);
  box-shadow: var(--shadow-md);
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.hero h1 {
  margin: 4px 0 8px;
  font-size: 30px;
  line-height: 1.08;
}

.hero p {
  margin: 0;
  color: var(--color-text-secondary);
}

.api-state {
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}

.api-state.online {
  color: #1d7f68;
  background: rgba(34, 149, 113, 0.12);
  border-color: rgba(34, 149, 113, 0.24);
}

.api-state.offline {
  color: #b85a34;
  background: rgba(208, 87, 56, 0.14);
  border-color: rgba(208, 87, 56, 0.3);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.type-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(170px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.type-card {
  padding: 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
}

.type-card h3 {
  margin: 0 0 6px;
  font-size: 15px;
}

.type-card p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(160px, 220px) 1fr auto;
  gap: 10px;
  align-items: end;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
}

.control {
  display: grid;
  gap: 6px;
}

.control span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.refresh-btn {
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: linear-gradient(125deg, #1f8f88 0%, #166675 100%);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  padding: 10px 14px;
  cursor: pointer;
  transition: all 160ms ease;
}

.refresh-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.refresh-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.filter-summary {
  margin: 0 0 12px;
  border: 1px solid var(--color-border-light);
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
  border-radius: 999px;
  padding: 6px 12px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.stat {
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
}

.value {
  display: block;
  font-size: 30px;
  line-height: 1;
  font-weight: 700;
}

.label {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.error-box {
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid rgba(208, 87, 56, 0.3);
  border-radius: var(--radius-sm);
  background: rgba(208, 87, 56, 0.12);
  color: #c86542;
}

.loading-box,
.empty-box {
  text-align: center;
  padding: 48px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
}

.spinner {
  width: 42px;
  height: 42px;
  margin: 0 auto 14px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 800ms linear infinite;
}

.resource-groups {
  display: grid;
  gap: 14px;
}

.resource-group {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
  overflow: hidden;
}

.group-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border-light);
  background: color-mix(in srgb, var(--color-bg-tertiary) 84%, transparent);
}

.group-head h2 {
  margin: 0;
  font-size: 16px;
}

.group-head span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  padding: 12px;
}

.resource-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 12px;
  background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
}

.resource-meta {
  display: grid;
  gap: 3px;
}

.resource-meta strong {
  font-size: 14px;
}

.resource-meta span {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.resource-id {
  margin: 8px 0;
  font-size: 12px;
  color: var(--color-text-muted);
}

.resource-json {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: color-mix(in srgb, var(--color-bg-tertiary) 90%, transparent);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1024px) {
  .hero {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .api-state {
    justify-self: start;
  }

  .type-cards {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .fhir-page {
    padding: 12px;
  }

  .hero {
    padding: 14px;
  }

  .hero h1 {
    font-size: 24px;
  }

  .toolbar {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .group-grid {
    grid-template-columns: 1fr;
  }
}
</style>
