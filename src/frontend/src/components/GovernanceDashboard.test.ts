import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GovernanceDashboard from './GovernanceDashboard.vue';

const WorkflowStateMachineStub = defineComponent({
  name: 'WorkflowStateMachine',
  emits: ['stage-click', 'stage-hover', 'stage-hover-leave'],
  template: `
    <div data-testid="workflow-state-machine">
      <button class="emit-stage-click" @click="$emit('stage-click', 'DEBATE')">
        stage-click
      </button>
    </div>
  `,
});

const WorkflowLayerMatrixStub = defineComponent({
  name: 'WorkflowLayerMatrix',
  emits: ['stage-click', 'stage-hover', 'stage-hover-leave'],
  template: `
    <div data-testid="workflow-layer-matrix">
      <button class="emit-layer-click" @click="$emit('stage-click', 'ROUTING')">
        layer-click
      </button>
    </div>
  `,
});

const ExecutionNeuralTopologyStub = defineComponent({
  name: 'ExecutionNeuralTopology',
  emits: ['node-focus', 'node-hover', 'node-hover-leave'],
  template: `
    <div data-testid="execution-neural-topology">
      <button
        class="emit-node-focus-escalation"
        @click="$emit('node-focus', { nodeId: 'safety', label: 'safety-governance', stage: 'ESCALATION' })"
      >
        node-focus-escalation
      </button>
    </div>
  `,
});

function mountDashboard() {
  return mount(GovernanceDashboard, {
    props: {
      queueOverview: {
        pending: 1,
        reviewing: 2,
        approved: 1,
        rejected: 1,
      },
    },
    global: {
      stubs: {
        WorkflowStateMachine: WorkflowStateMachineStub,
        WorkflowLayerMatrix: WorkflowLayerMatrixStub,
        ExecutionNeuralTopology: ExecutionNeuralTopologyStub,
      },
    },
  });
}

describe('GovernanceDashboard queue navigation behavior', () => {
  it('does not auto-emit queue-filter-change when stage is clicked', async () => {
    const wrapper = mountDashboard();
    await flushPromises();

    await wrapper.find('.emit-stage-click').trigger('click');

    expect(wrapper.emitted('queue-filter-change')).toBeUndefined();
    expect(wrapper.find('.queue-link-btn').exists()).toBe(true);
  });

  it('emits queue-filter-change only when clicking explicit queue navigation button', async () => {
    const wrapper = mountDashboard();
    await flushPromises();

    await wrapper.find('.emit-stage-click').trigger('click');
    await wrapper.find('.queue-link-btn').trigger('click');

    expect(wrapper.emitted('queue-filter-change')?.[0]).toEqual(['reviewing']);
  });

  it('maps topology focus to filter preview and jumps with mapped filter only on explicit action', async () => {
    const wrapper = mountDashboard();
    await flushPromises();

    await wrapper.find('.emit-node-focus-escalation').trigger('click');
    expect(wrapper.emitted('queue-filter-change')).toBeUndefined();

    await wrapper.find('.queue-link-btn').trigger('click');
    expect(wrapper.emitted('queue-filter-change')?.[0]).toEqual(['rejected']);
  });

  it('renders backend-factor panels and scenario evidence wall panels', async () => {
    const wrapper = mountDashboard();
    await flushPromises();

    expect(wrapper.find('[data-testid="latency-heat-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="agent-reasoning-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="routing-factor-list"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="trace-stream-list"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="orchestration-task-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="evidence-wall-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="evidence-detail"]').exists()).toBe(true);
  });

  it('toggles 3-minute briefing mode and updates visual state', async () => {
    const wrapper = mountDashboard();
    await flushPromises();

    const toggle = wrapper.find('[data-testid="briefing-toggle"]');
    expect(wrapper.find('[data-testid="briefing-panel"]').exists()).toBe(false);

    await toggle.trigger('click');
    expect(wrapper.find('[data-testid="briefing-panel"]').exists()).toBe(true);
    expect(wrapper.classes()).toContain('briefing-mode');
  });

  it('switches evidence detail when selecting a different evidence card', async () => {
    const wrapper = mountDashboard();
    await flushPromises();

    const cards = wrapper.findAll('.evidence-card-btn');
    expect(cards.length).toBeGreaterThan(1);

    const before = wrapper.find('[data-testid="evidence-detail"]').text();
    await cards[1].trigger('click');
    const after = wrapper.find('[data-testid="evidence-detail"]').text();

    expect(after).not.toBe(before);
  });
});
