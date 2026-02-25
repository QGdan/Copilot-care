<script setup lang="ts">
import type {
  CockpitConfidenceBadge,
  CockpitContributionCard,
  CockpitEvidenceDigest,
  CockpitSimulationPreset,
} from '../../composables/useDecisionReasoningCockpit';
import type {
  ChartDensity,
  VisualizationState,
} from '../../types/visualization';

interface ConsultationReasoningCockpitCardProps {
  confidenceBadge: CockpitConfidenceBadge;
  contributionCards: CockpitContributionCard[];
  evidenceDigest: CockpitEvidenceDigest;
  simulationPresets: CockpitSimulationPreset[];
  selectedSimulationId: string | null;
  simulationInsight: string;
  state?: VisualizationState;
  density?: ChartDensity;
}

const props = withDefaults(defineProps<ConsultationReasoningCockpitCardProps>(), {
  state: 'idle',
  density: 'comfortable',
});

const emit = defineEmits<{
  (e: 'toggle-simulation', presetId: string): void;
}>();
</script>

<template>
  <div
    class="panel-card cockpit-card"
    :class="[`state-${props.state}`, `density-${props.density}`]"
  >
    <div class="panel-head-row">
      <h3>决策推理驾驶舱</h3>
      <span
        :class="[
          'status-chip',
          'secondary',
          `confidence-${props.confidenceBadge.level}`,
        ]"
      >
        {{ props.confidenceBadge.label }} · {{ props.confidenceBadge.percentText }}
      </span>
    </div>
    <p class="cockpit-summary">{{ props.confidenceBadge.description }}</p>

    <div class="cockpit-grid">
      <article
        v-for="card in props.contributionCards"
        :key="card.id"
        class="cockpit-metric-card"
      >
        <div class="cockpit-metric-head">
          <strong>{{ card.label }}</strong>
          <span>{{ card.score }}%</span>
        </div>
        <div class="cockpit-metric-track">
          <div class="cockpit-metric-fill" :style="{ width: `${card.score}%` }" />
        </div>
        <p>{{ card.summary }}</p>
      </article>
    </div>

    <section class="cockpit-evidence-card">
      <div class="cockpit-subheader">
        <h4>关键证据摘要</h4>
        <span>{{ props.evidenceDigest.total }} 条</span>
      </div>
      <p class="cockpit-summary">{{ props.evidenceDigest.summary }}</p>
      <ul v-if="props.evidenceDigest.items.length > 0" class="cockpit-evidence-list">
        <li v-for="item in props.evidenceDigest.items" :key="item">{{ item }}</li>
      </ul>
      <p v-else class="empty-text">暂无证据摘要。</p>
    </section>

    <section class="cockpit-simulation-card">
      <div class="cockpit-subheader">
        <h4>情景推演</h4>
        <span>用于答辩演示</span>
      </div>
      <div class="simulation-actions">
        <button
          v-for="preset in props.simulationPresets"
          :key="preset.id"
          class="simulation-btn"
          :class="{ active: props.selectedSimulationId === preset.id }"
          @click="emit('toggle-simulation', preset.id)"
        >
          {{ preset.label }}
        </button>
      </div>
      <p class="cockpit-summary">{{ props.simulationInsight }}</p>
    </section>
  </div>
</template>

<style scoped>
.panel-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 12px;
  box-shadow: 0 6px 18px rgba(17, 44, 72, 0.06);
}

.panel-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.status-chip {
  font-size: 12px;
  color: #0f5e65;
  background: #e8f7f7;
  border: 1px solid #a8d8dc;
  border-radius: 999px;
  padding: 2px 10px;
}

.status-chip.secondary {
  color: #2f5878;
  background: #eef5ff;
  border-color: #bdd0e4;
}

.status-chip.confidence-high {
  color: #1d6a41;
  background: #e7f6ee;
  border-color: #98d9b7;
}

.status-chip.confidence-medium {
  color: #8a5c08;
  background: #fff5e2;
  border-color: #f0cd87;
}

.status-chip.confidence-low {
  color: #8f2b18;
  background: #ffede8;
  border-color: #efb2a3;
}

.cockpit-card {
  background:
    linear-gradient(150deg, rgba(221, 242, 255, 0.55) 0%, rgba(255, 249, 234, 0.72) 100%),
    #ffffff;
  position: relative;
  overflow: hidden;
}

.cockpit-card.state-running {
  border-color: rgba(36, 132, 163, 0.46);
}

.cockpit-card.state-done {
  border-color: rgba(31, 139, 97, 0.44);
}

.cockpit-card.state-blocked {
  border-color: rgba(184, 74, 56, 0.5);
}

.cockpit-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #1f7b80, #2e9156, #3b82f6);
}

.cockpit-summary {
  margin: 6px 0 0;
  color: #3c5771;
  font-size: 12px;
  line-height: 1.5;
}

.cockpit-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.cockpit-card.density-compact .cockpit-grid {
  grid-template-columns: 1fr;
}

.cockpit-metric-card {
  border: 1px solid #c7d8e8;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
  padding: 10px;
}

.cockpit-metric-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #1b4666;
}

.cockpit-metric-track {
  margin-top: 6px;
  width: 100%;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: #dbe7f3;
}

.cockpit-metric-fill {
  height: 100%;
  background: linear-gradient(90deg, #1f7b80 0%, #2e9156 100%);
  transition: width 220ms ease;
  border-radius: 999px;
  position: relative;
}

.cockpit-metric-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.cockpit-metric-card p {
  margin: 8px 0 0;
  font-size: 12px;
  color: #3f5d78;
  line-height: 1.45;
}

.cockpit-evidence-card,
.cockpit-simulation-card {
  margin-top: 10px;
  border: 1px solid #c7d8e8;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  padding: 10px;
}

.cockpit-subheader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cockpit-subheader h4 {
  margin: 0;
  font-size: 13px;
  color: #1c4768;
}

.cockpit-subheader span {
  font-size: 11px;
  color: #50708e;
}

.cockpit-evidence-list {
  margin: 8px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
  color: #314f69;
  font-size: 12px;
}

.simulation-actions {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.simulation-btn {
  border: 1px solid #96b5cc;
  border-radius: 999px;
  background: #f6fbff;
  color: #2f5a7a;
  font-size: 12px;
  padding: 4px 11px;
  cursor: pointer;
}

.simulation-btn:hover {
  border-color: #6196bc;
  background: #eaf5ff;
}

.simulation-btn.active {
  border-color: #0e8d8f;
  color: #0f6768;
  background: #dcf1f2;
}

.empty-text {
  color: var(--muted);
  margin: 0;
}

@media (max-width: 1100px) {
  .cockpit-grid {
    grid-template-columns: 1fr;
  }
}
</style>
