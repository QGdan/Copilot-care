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

function mountDashboard(
  propOverrides: Record<string, unknown> = {},
) {
  return mount(GovernanceDashboard, {
    props: {
      queueOverview: {
        pending: 1,
        reviewing: 2,
        approved: 1,
        rejected: 1,
      },
      ...propOverrides,
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
    expect(wrapper.find('[data-testid="rule-layer-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="guideline-reference-grid"]').exists()).toBe(true);
  });

  it('renders rule catalog layers and guideline references from runtime props', async () => {
    const wrapper = mountDashboard({
      ruleCatalogVersion: '2026.03-r1',
      ruleSynonymVersion: '2026.03-r1',
      ruleCatalogLayers: [
        {
          id: 'RULE-FC-MIS-GATE',
          layer: 'FLOW_CONTROL',
          title: 'Minimum Information Set Gate',
          summary: 'Requires minimal structured clinical data before routing.',
          implementationRefs: ['src/backend/src/application/services/MinimumInfoSetService.ts'],
        },
      ],
      ruleGuidelineReferences: [
        {
          id: 'NICE_NG136_2026',
          title: 'Hypertension in adults',
          publisher: 'NICE',
          publishedOn: '2026-01-01',
          url: 'https://www.nice.org.uk/guidance/ng136',
        },
      ],
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Catalog 2026.03-r1');
    expect(wrapper.find('[data-testid="rule-layer-grid"]').text()).toContain(
      'FLOW_CONTROL',
    );
    expect(wrapper.find('[data-testid="guideline-reference-grid"]').text()).toContain(
      'NICE_NG136_2026',
    );
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

  it('prefers runtime stage snapshot for workflow detail message and current stage', async () => {
    const wrapper = mountDashboard({
      runtimeCurrentStage: 'DEBATE',
      runtimeStageRuntime: {
        START: { status: 'done', message: 'runtime start done', active: 0, transitions: 1, updatedAt: '2026-02-25T10:00:00.000Z' },
        INFO_GATHER: { status: 'done', message: 'runtime gather done', active: 0, transitions: 1, updatedAt: '2026-02-25T10:00:01.000Z' },
        RISK_ASSESS: { status: 'done', message: 'runtime risk done', active: 0, transitions: 1, updatedAt: '2026-02-25T10:00:02.000Z' },
        ROUTING: { status: 'done', message: 'runtime routing done', active: 0, transitions: 1, updatedAt: '2026-02-25T10:00:03.000Z' },
        DEBATE: { status: 'running', message: 'runtime debate running', active: 1, transitions: 2, updatedAt: '2026-02-25T10:00:04.000Z' },
        CONSENSUS: { status: 'pending', message: 'runtime consensus pending', active: 0, transitions: 0, updatedAt: '2026-02-25T10:00:05.000Z' },
        REVIEW: { status: 'pending', message: 'runtime review pending', active: 0, transitions: 0, updatedAt: '2026-02-25T10:00:06.000Z' },
        OUTPUT: { status: 'pending', message: 'runtime output pending', active: 0, transitions: 0, updatedAt: '2026-02-25T10:00:07.000Z' },
        ESCALATION: { status: 'pending', message: 'runtime escalation pending', active: 0, transitions: 0, updatedAt: '2026-02-25T10:00:08.000Z' },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('runtime debate running');
  });
});
