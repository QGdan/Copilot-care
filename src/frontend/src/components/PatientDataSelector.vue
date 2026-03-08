<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { mcpApi, fhirApi, type MCPPatientResponse, type MCPInsightsResponse } from '../services/api';

interface Props {
  disabled?: boolean;
}

interface Emits {
  (e: 'patient-selected', patientId: string): void;
  (e: 'insights-loaded', insights: string[]): void;
  (e: 'patient-loaded', payload: {
    patientId: string;
    patientData: MCPPatientResponse | null;
  }): void;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});

const emit = defineEmits<Emits>();

const patients = ref<Array<{ id: string; label: string }>>([]);
const selectedPatientId = ref<string>('');
const patientData = ref<MCPPatientResponse | null>(null);
const patientInsights = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const mcpAvailable = ref<boolean | null>(null);

const hasPatient = computed(() => !!patientData.value);

async function loadPatients() {
  loading.value = true;
  error.value = null;
  
  try {
    const bundle = await fhirApi.getPatients();
    if (bundle.entry) {
      patients.value = bundle.entry.map(e => {
        const patient = e.resource;
        const name = patient.name?.[0];
        const displayName = name 
          ? `${name.family || ''}${name.given?.join('') || ''}`
          : patient.id;
        return {
          id: patient.id,
          label: `${displayName} (${patient.gender || '未知'} ${patient.birthDate || ''})`,
        };
      });
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载患者列表失败';
  } finally {
    loading.value = false;
  }
}

async function loadPatientData() {
  if (!selectedPatientId.value) {
    patientData.value = null;
    patientInsights.value = [];
    emit('patient-selected', '');
    emit('insights-loaded', []);
    emit('patient-loaded', {
      patientId: '',
      patientData: null,
    });
    return;
  }

  loading.value = true;
  error.value = null;
  mcpAvailable.value = false;
  emit('patient-selected', selectedPatientId.value);

  try {
    const [patient, insights] = await Promise.all([
      mcpApi.getPatient(selectedPatientId.value).catch(() => null),
      mcpApi.getPatientInsights(selectedPatientId.value).catch(() => null),
    ]);

    mcpAvailable.value = true;
    patientData.value = patient;
    patientInsights.value = insights?.insights || [];
    
    emit('insights-loaded', patientInsights.value);
    emit('patient-loaded', {
      patientId: selectedPatientId.value,
      patientData: patientData.value,
    });
  } catch (e) {
    mcpAvailable.value = false;
    error.value = e instanceof Error ? e.message : '加载患者数据失败';
    patientData.value = null;
    patientInsights.value = [];
    emit('patient-loaded', {
      patientId: selectedPatientId.value,
      patientData: null,
    });
  } finally {
    loading.value = false;
  }
}

function clearPatient() {
  selectedPatientId.value = '';
  patientData.value = null;
  patientInsights.value = [];
  emit('patient-selected', '');
  emit('insights-loaded', []);
  emit('patient-loaded', {
    patientId: '',
    patientData: null,
  });
}

onMounted(() => {
  loadPatients();
});

defineExpose({
  loadPatients,
  loadPatientData,
  patientData,
  patientInsights,
  selectedPatientId,
});
</script>

<template>
  <div class="patient-selector">
    <div class="selector-header">
      <h4>👤 患者数据</h4>
      <span v-if="mcpAvailable === true" class="mcp-badge connected">MCP 已连接</span>
      <span v-else-if="mcpAvailable === false" class="mcp-badge disconnected">MCP 未连接</span>
    </div>

    <div class="selector-controls">
      <select
        v-model="selectedPatientId"
        :disabled="props.disabled || loading"
        @change="loadPatientData"
      >
        <option value="">-- 选择患者 --</option>
        <option v-for="p in patients" :key="p.id" :value="p.id">
          {{ p.label }}
        </option>
      </select>
      
      <button
        v-if="selectedPatientId"
        class="clear-btn"
        :disabled="props.disabled || loading"
        @click="clearPatient"
      >
        清除
      </button>
    </div>

    <div v-if="loading" class="loading-indicator">
      <span class="spinner"></span>
      加载中...
    </div>

    <div v-else-if="error" class="error-message">
      {{ error }}
    </div>

    <div v-else-if="patientData" class="patient-info">
      <div class="info-card">
        <div class="info-row">
          <span class="label">姓名:</span>
          <span class="value">{{ patientData.name || '-' }}</span>
        </div>
        <div class="info-row">
          <span class="label">年龄:</span>
          <span class="value">{{ patientData.age || '-' }}</span>
        </div>
        <div class="info-row">
          <span class="label">性别:</span>
          <span class="value">{{ patientData.sex === 'male' ? '男' : patientData.sex === 'female' ? '女' : '-' }}</span>
        </div>
        <div class="info-row">
          <span class="label">主诉:</span>
          <span class="value">{{ patientData.chiefComplaint || '-' }}</span>
        </div>
        <div v-if="patientData.chronicDiseases?.length" class="info-row">
          <span class="label">病史:</span>
          <span class="value">{{ patientData.chronicDiseases.join(', ') }}</span>
        </div>
        <div v-if="patientData.medicationHistory?.length" class="info-row">
          <span class="label">用药:</span>
          <span class="value">{{ patientData.medicationHistory.join(', ') }}</span>
        </div>
        <div v-if="patientData.tcmConstitution" class="info-row">
          <span class="label">体质:</span>
          <span class="value">{{ patientData.tcmConstitution }}</span>
        </div>
      </div>

      <div v-if="patientInsights.length > 0" class="insights-card">
        <h5>📊 患者洞察</h5>
        <ul class="insights-list">
          <li v-for="(insight, idx) in patientInsights" :key="idx">
            {{ insight }}
          </li>
        </ul>
      </div>
    </div>

    <div v-else class="empty-hint">
      选择患者后，系统将自动从云端获取该患者的病史、用药和健康洞察数据
    </div>
  </div>
</template>

<style scoped>
.patient-selector {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.selector-header h4 {
  margin: 0;
  font-size: 14px;
  color: #1a3a4d;
}

.mcp-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
}

.mcp-badge.connected {
  background: #ecfdf5;
  color: #059669;
}

.mcp-badge.disconnected {
  background: #fef2f2;
  color: #dc2626;
}

.selector-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.selector-controls select {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d1d9e0;
  border-radius: 4px;
  font-size: 13px;
  background: #fff;
}

.selector-controls select:disabled {
  background: #f3f4f6;
  cursor: not-allowed;
}

.clear-btn {
  padding: 8px 16px;
  background: #f3f4f6;
  color: #6b7280;
  border: 1px solid #d1d9e0;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.clear-btn:hover:not(:disabled) {
  background: #e5e7eb;
}

.clear-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  color: #6b7280;
  font-size: 13px;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #e5e7eb;
  border-top-color: #0e8d8f;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-message {
  padding: 12px;
  background: #fef2f2;
  color: #dc2626;
  border-radius: 6px;
  font-size: 13px;
}

.patient-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info-card {
  background: #f9fafb;
  border-radius: 6px;
  padding: 12px;
}

.info-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-row .label {
  color: #6b7280;
  min-width: 50px;
}

.info-row .value {
  color: #1a3a4d;
  flex: 1;
  word-break: break-word;
}

.insights-card {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 12px;
}

.insights-card h5 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #1d4ed8;
}

.insights-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  color: #1e40af;
  line-height: 1.6;
}

.insights-list li {
  margin-bottom: 4px;
}

.empty-hint {
  padding: 12px;
  background: #f9fafb;
  border-radius: 6px;
  color: #6b7280;
  font-size: 12px;
  text-align: center;
}
</style>
