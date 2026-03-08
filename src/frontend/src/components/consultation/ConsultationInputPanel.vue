<script setup lang="ts">
import type { StyleValue } from 'vue';
import PatientDataSelector from '../PatientDataSelector.vue';
import type {
  ConsultationInputForm,
  ConsultationQuickInput,
} from '../../composables/useConsultationInputForm';
import type { MCPPatientResponse } from '../../services/api';
import type { RiskSignal } from '../../types/visualization';

interface ChatMessage {
  role: 'user' | 'system';
  content: string;
}

interface ConsultationInputPanelProps {
  leftPaneStyle: StyleValue;
  loading: boolean;
  quickInputs: ConsultationQuickInput[];
  form: ConsultationInputForm;
  showAdvancedInputs: boolean;
  clarificationQuestion: string;
  requiredFields: string[];
  nextAction: string;
  messages: ChatMessage[];
  microStatus: string;
  loadingSeconds: number;
  currentStageLabel: string;
  progressPercent: number;
  riskSignal: RiskSignal;
  demoModeEnabled: boolean;
  isFieldRequired: (field: string) => boolean;
  formatRequiredField: (field: string) => string;
}

const props = defineProps<ConsultationInputPanelProps>();

const emit = defineEmits<{
  (e: 'apply-quick-input', input: ConsultationQuickInput): void;
  (e: 'toggle-advanced-inputs'): void;
  (e: 'submit-consultation'): void;
  (e: 'toggle-demo-mode'): void;
  (e: 'patient-selected', patientId: string): void;
  (e: 'insights-loaded', insights: string[]): void;
  (e: 'patient-loaded', payload: {
    patientId: string;
    patientData: MCPPatientResponse | null;
  }): void;
}>();
</script>

<template>
  <section class="left-pane" :style="leftPaneStyle">
    <header class="pane-header">
      <h2>会诊输入台</h2>
      <p>先输入核心诉求，系统会边推理边反馈当前步骤。</p>
    </header>

    <div class="form-card">
      <PatientDataSelector
        :disabled="loading"
        @patient-selected="(patientId) => emit('patient-selected', patientId)"
        @insights-loaded="(insights) => emit('insights-loaded', insights)"
        @patient-loaded="(payload) => emit('patient-loaded', payload)"
      />

      <div class="divider"></div>

      <div class="quick-row">
        <button
          v-for="item in quickInputs"
          :key="item.label"
          :disabled="loading"
          class="quick-btn"
          @click="emit('apply-quick-input', item)"
        >
          {{ item.label }}
        </button>
      </div>

      <label class="field wide" :class="{ required: isFieldRequired('symptomText') }">
        症状/需求
        <textarea
          v-model="form.symptomText"
          :disabled="loading"
          placeholder="例如：头晕、血压偏高、近期乏力"
          rows="3"
        />
      </label>

      <div class="field-grid">
        <label class="field" :class="{ required: isFieldRequired('ageOrSex') }">
          年龄
          <input v-model.number="form.age" :disabled="loading" type="number" min="1" max="120" />
        </label>
        <label class="field" :class="{ required: isFieldRequired('ageOrSex') }">
          性别
          <select v-model="form.sex" :disabled="loading">
            <option value="male">男</option>
            <option value="female">女</option>
            <option value="other">其他</option>
          </select>
        </label>
      </div>

      <button
        class="toggle-btn"
        type="button"
        :disabled="loading"
        @click="emit('toggle-advanced-inputs')"
      >
        {{ showAdvancedInputs ? '收起补充信息' : '展开补充信息（血压/病史/授权）' }}
      </button>

      <div v-if="showAdvancedInputs" class="advanced-grid">
        <label class="field" :class="{ required: isFieldRequired('systolicBP') }">
          收缩压
          <input
            v-model="form.systolicBPText"
            :disabled="loading"
            type="number"
            placeholder="可选"
          />
        </label>
        <label class="field" :class="{ required: isFieldRequired('diastolicBP') }">
          舒张压
          <input
            v-model="form.diastolicBPText"
            :disabled="loading"
            type="number"
            placeholder="可选"
          />
        </label>
        <label class="field wide" :class="{ required: isFieldRequired('chronicDiseasesOrMedicationHistory') }">
          慢病史（逗号分隔）
          <input
            v-model="form.chronicDiseasesText"
            :disabled="loading"
            placeholder="Hypertension, Diabetes"
          />
        </label>
        <label class="field wide" :class="{ required: isFieldRequired('chronicDiseasesOrMedicationHistory') }">
          用药史（逗号分隔）
          <input
            v-model="form.medicationHistoryText"
            :disabled="loading"
            placeholder="amlodipine, metformin"
          />
        </label>
        <label class="field wide" :class="{ required: isFieldRequired('consentToken') }">
          授权 token
          <input v-model="form.consentToken" :disabled="loading" placeholder="consent_xxx" />
        </label>
      </div>

      <div class="actions">
        <div class="risk-banner" :class="`risk-${riskSignal}`">
          <strong>风险信号</strong>
          <span>
            {{
              riskSignal === 'critical'
                ? '高风险：建议优先关注红旗症状与线下上转条件'
                : riskSignal === 'warning'
                  ? '中风险：建议补全关键信息后继续会诊'
                  : '正常：可按标准路径发起会诊'
            }}
          </span>
        </div>
        <button :disabled="loading" @click="emit('submit-consultation')">
          {{ loading ? '会诊进行中...' : '提交会诊' }}
        </button>
        <button
          class="demo-btn"
          :class="{ active: demoModeEnabled }"
          @click="emit('toggle-demo-mode')"
        >
          {{ demoModeEnabled ? '退出演示' : '演示模式（答辩）' }}
        </button>
        <small class="micro-status">
          {{ microStatus }}
          <template v-if="loading">（{{ loadingSeconds }}s）</template>
        </small>
        <small class="micro-stage">
          当前阶段：{{ currentStageLabel }} / 进度 {{ progressPercent }}%
        </small>
      </div>
    </div>

    <div v-if="clarificationQuestion" class="clarify-card">
      <h3>中途补充信息</h3>
      <p>{{ clarificationQuestion }}</p>
      <p v-if="nextAction" class="next-action-tip">
        下一步：{{ nextAction }}
      </p>
      <div class="chips">
        <span v-for="field in requiredFields" :key="field" class="chip">
          {{ formatRequiredField(field) }}
        </span>
      </div>
    </div>

    <div class="log-card">
      <h3>交互记录</h3>
      <div class="message-list">
        <article
          v-for="(message, index) in messages"
          :key="`${index}-${message.role}`"
          class="message"
          :class="message.role"
        >
          {{ message.content }}
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.left-pane {
  height: 100%;
  overflow-y: auto;
  padding: 18px;
  box-sizing: border-box;
  background: linear-gradient(180deg, var(--surface-left) 0%, #f1f6fa 100%);
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

.divider {
  height: 1px;
  background: var(--line);
  margin: 14px 0;
}

.form-card,
.log-card,
.clarify-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 12px;
  box-shadow: 0 6px 18px rgba(17, 44, 72, 0.06);
}

.quick-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.quick-btn {
  border: 1px solid #9eb6cc;
  background: #f9fcff;
  color: #2a4e6c;
  border-radius: 999px;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
}

.quick-btn:disabled {
  cursor: not-allowed;
  color: #8ba3b8;
  border-color: #c7d5e4;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 10px;
}

.field.required {
  color: #9e3e1e;
}

.field.required::after {
  content: '补充必填';
  align-self: flex-end;
  font-size: 11px;
  color: #b45e3f;
}

.field input,
.field textarea,
.field select {
  border: 1px solid #b8c7d7;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
  background: #ffffff;
  color: var(--ink);
}

.field-grid,
.advanced-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.field.wide {
  width: 100%;
  grid-column: 1 / -1;
}

.toggle-btn {
  border: 1px solid #99aec5;
  border-radius: 8px;
  background: #f7fbff;
  color: #35556f;
  font-size: 13px;
  padding: 8px 10px;
  margin: 2px 0 10px;
  cursor: pointer;
}

.toggle-btn:disabled {
  color: #8ba3b8;
  border-color: #c7d5e4;
  cursor: not-allowed;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.risk-banner {
  display: grid;
  gap: 4px;
  border-radius: 8px;
  border: 1px solid #c3d4e6;
  background: #f4f8fd;
  padding: 8px 10px;
  font-size: 12px;
  color: #3f5f78;
}

.risk-banner strong {
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #4e6d86;
}

.risk-banner.risk-normal {
  border-color: #b6dbca;
  background: #edf8f3;
  color: #2a6449;
}

.risk-banner.risk-warning {
  border-color: #e6d2aa;
  background: #fff7e9;
  color: #7b5b19;
}

.risk-banner.risk-critical {
  border-color: #e8b8af;
  background: #fff0ec;
  color: #8b3a29;
}

.actions button {
  border: none;
  border-radius: 9px;
  padding: 10px 12px;
  color: #ffffff;
  font-weight: 600;
  background: linear-gradient(110deg, #1f7b80 0%, #165f6f 100%);
  cursor: pointer;
}

.actions button:disabled {
  background: #8aa2b8;
  cursor: not-allowed;
}

.demo-btn {
  padding: 10px 16px;
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

.demo-btn:hover {
  background: #4f46e5;
}

.demo-btn.active {
  background: #ec4899;
}

.micro-status,
.micro-stage {
  color: var(--muted);
  font-size: 12px;
}

.next-action-tip {
  margin: 8px 0 0;
  font-size: 12px;
  color: #3f5f78;
}

.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.chip {
  border: 1px solid #d89f86;
  color: #8f4528;
  background: #fff4ef;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
}

.message {
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
}

.message.user {
  align-self: flex-end;
  background: #d7f0ea;
}

.message.system {
  align-self: flex-start;
  background: #f8fbff;
  border: 1px solid #d4deea;
}

@media (max-width: 1100px) {
  .left-pane {
    width: 100% !important;
    height: auto;
    max-height: none;
  }

  .field-grid,
  .advanced-grid {
    grid-template-columns: 1fr;
  }
}
</style>
