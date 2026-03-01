<script setup lang="ts">
import type {
  AgentOpinion,
  ExplainableReport,
  RuleGovernanceSnapshot,
  StructuredTriageResult,
  TriageRoutingInfo,
} from '@copilot-care/shared/types';
import {
  formatCollaboration,
  formatDepartment,
  formatRouteMode,
} from '../constants/triageLabels';

interface Props {
  routeInfo: TriageRoutingInfo | null;
  triageResult: StructuredTriageResult | null;
  ruleGovernance: RuleGovernanceSnapshot | null;
  explainableReport: ExplainableReport | null;
  finalConsensus: AgentOpinion | null;
  resultNotes: string[];
  isSafetyBlocked: boolean;
  safetyBlockNote: string;
  canExportReport: boolean;
  exportingReport: boolean;
  reportExportError: string;
  reportExportSuccess: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  export: [];
}>();

function handleExport(): void {
  emit('export');
}
</script>

<template>
  <div class="panel-card">
    <div class="panel-header-with-action">
      <h3>结构化结果</h3>
      <button
        v-if="props.triageResult || props.explainableReport"
        class="export-btn"
        :disabled="!props.canExportReport"
        @click="handleExport"
      >
        {{ props.exportingReport ? '导出中...' : '导出报告' }}
      </button>
    </div>
    <div class="summary-grid">
      <article v-if="props.routeInfo" class="summary-card">
        <h4>分流路径</h4>
        <p>
          {{ formatRouteMode(props.routeInfo.routeMode) }} /
          {{ formatDepartment(props.routeInfo.department) }} /
          {{ formatCollaboration(props.routeInfo.collaborationMode) }}
        </p>
        <small>复杂度 {{ props.routeInfo.complexityScore }}</small>
      </article>
      <article v-if="props.triageResult" class="summary-card">
        <h4>分诊结果</h4>
        <p>
          {{ props.triageResult.triageLevel }} /
          {{ props.triageResult.destination }}
        </p>
        <small>随访周期 {{ props.triageResult.followupDays }} 天</small>
      </article>
    </div>
    <article
      v-if="props.ruleGovernance"
      class="governance-card"
      data-testid="result-rule-governance"
    >
      <h4>规则治理快照</h4>
      <p>
        Catalog {{ props.ruleGovernance.catalogVersion }} /
        Evidence {{ props.ruleGovernance.evidenceTraceId }}
      </p>
      <small v-if="props.ruleGovernance.synonymSetVersion">
        同义词集版本 {{ props.ruleGovernance.synonymSetVersion }}
      </small>
      <small v-if="props.ruleGovernance.matchedRuleIds.length > 0">
        命中规则 {{ props.ruleGovernance.matchedRuleIds.join('、') }}
      </small>
      <small v-if="props.ruleGovernance.guidelineRefs.length > 0">
        指南引用 {{ props.ruleGovernance.guidelineRefs.join(' | ') }}
      </small>
      <ul class="layer-decision-list">
        <li
          v-for="decision in props.ruleGovernance.layerDecisions"
          :key="decision.layer"
        >
          {{ decision.layer }}: {{ decision.status }} / {{ decision.summary }}
        </li>
      </ul>
    </article>
    <article v-if="props.finalConsensus" class="consensus-card">
      <h4>最终结论</h4>
      <p>{{ props.finalConsensus.reasoning }}</p>
    </article>
    <div v-if="props.isSafetyBlocked" class="safety-block-alert">
      <strong>安全审校已阻断线上建议</strong>
      <p>{{ props.safetyBlockNote || '检测到潜在不安全输出，已切换为线下上转路径。' }}</p>
    </div>
    <ul v-if="props.resultNotes.length > 0" class="reasoning-list">
      <li v-for="(note, index) in props.resultNotes" :key="`note-${index}`">
        {{ note }}
      </li>
    </ul>
    <p v-if="props.reportExportError" class="export-status error">
      {{ props.reportExportError }}
    </p>
    <p v-else-if="props.reportExportSuccess" class="export-status success">
      {{ props.reportExportSuccess }}
    </p>
  </div>
</template>

<style scoped>
.panel-card {
  background: #ffffff;
  border: 1px solid #cad6e2;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 12px;
  box-shadow: 0 6px 18px rgba(17, 44, 72, 0.06);
  position: relative;
  overflow: hidden;
}

.panel-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6);
}

.panel-header-with-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.panel-header-with-action h3 {
  margin: 0;
  color: #1a365d;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.summary-card {
  border: 1px solid #c9d7e7;
  border-radius: 9px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.92);
}

.summary-card h4,
.consensus-card h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #4c6881;
}

.summary-card p,
.consensus-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #21445e;
}

.summary-card small {
  display: block;
  margin-top: 6px;
  color: #5d7890;
}

.consensus-card {
  margin-top: 10px;
  border: 1px solid #c9d7e7;
  border-radius: 9px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.95);
}

.governance-card {
  margin-top: 10px;
  border: 1px solid #bed4e2;
  border-radius: 9px;
  padding: 10px;
  background: #f7fbff;
  display: grid;
  gap: 6px;
}

.governance-card h4 {
  margin: 0;
  font-size: 12px;
  color: #365c7a;
}

.governance-card p {
  margin: 0;
  font-size: 13px;
  color: #21445e;
}

.governance-card small {
  display: block;
  color: #496985;
  line-height: 1.45;
}

.layer-decision-list {
  margin: 2px 0 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: #365a74;
}

.export-btn {
  padding: 6px 14px;
  background: linear-gradient(135deg, #0e8d8f 0%, #0a7072 100%);
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(14, 141, 143, 0.3);
}

.export-btn:hover {
  background: linear-gradient(135deg, #0a7072 0%, #085557 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(14, 141, 143, 0.4);
}

.export-btn:disabled {
  background: #86a9ab;
  cursor: not-allowed;
  box-shadow: none;
}

.safety-block-alert {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #e0a18c;
  background: #fff4ef;
  color: #9b3f25;
}

.safety-block-alert strong {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
}

.safety-block-alert p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

.reasoning-list {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 13px;
  color: #3c5b75;
  line-height: 1.5;
}

.export-status {
  margin: 10px 0 0;
  font-size: 12px;
}

.export-status.error {
  color: #b23f29;
}

.export-status.success {
  color: #1e7e58;
}

@media (max-width: 980px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>


