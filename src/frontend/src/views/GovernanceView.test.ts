import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GovernanceView from './GovernanceView.vue';

const GovernanceDashboardStub = defineComponent({
  name: 'GovernanceDashboard',
  emits: ['queue-filter-change'],
  template: `
    <div data-testid="governance-dashboard">
      dashboard
      <button class="emit-dashboard-filter" @click="$emit('queue-filter-change', 'reviewing')">
        filter
      </button>
    </div>
  `,
});

const ReviewQueueStub = defineComponent({
  name: 'ReviewQueue',
  props: {
    items: {
      type: Array,
      required: true,
    },
  },
  emits: ['select', 'approve', 'reject'],
  template: `
    <div data-testid="review-queue">
      <div class="items-count" :data-count="String(items.length)"></div>
      <button class="emit-select" @click="$emit('select', items[0])">select</button>
      <button class="emit-approve" @click="$emit('approve', items[0])">approve</button>
      <button class="emit-reject" @click="$emit('reject', items[1])">reject</button>
    </div>
  `,
});

const EvidenceDrawerStub = defineComponent({
  name: 'EvidenceDrawer',
  props: {
    visible: {
      type: Boolean,
      required: true,
    },
    evidences: {
      type: Array,
      required: true,
    },
  },
  template:
    '<div data-testid="evidence-drawer" :data-visible="String(visible)" :data-count="String(evidences.length)" />',
});

describe('GovernanceView interactions', () => {
  function readStatValue(wrapper: ReturnType<typeof mount>, label: string): string {
    const statCards = wrapper.findAll('.stat-card');
    const targetCard = statCards.find(
      (card) => card.find('.stat-label').text() === label,
    );
    if (!targetCard) {
      return '';
    }
    return targetCard.find('.stat-value').text();
  }

  it('switches tab and updates counts after queue events', async () => {
    const wrapper = mount(GovernanceView, {
      global: {
        stubs: {
          GovernanceDashboard: GovernanceDashboardStub,
          ReviewQueue: ReviewQueueStub,
          EvidenceDrawer: EvidenceDrawerStub,
        },
      },
    });

    expect(wrapper.text()).toContain('待复核');
    expect(wrapper.text()).toContain('已通过');

    const tabButtons = wrapper.findAll('.tab-nav button');
    await tabButtons[1].trigger('click');

    expect(wrapper.find('[data-testid="review-queue"]').exists()).toBe(true);

    expect(readStatValue(wrapper, '已通过')).toBe('1');

    await wrapper.find('.emit-approve').trigger('click');
    expect(readStatValue(wrapper, '已通过')).toBe('2');

    await wrapper.find('.emit-select').trigger('click');
    const drawer = wrapper.find('[data-testid="evidence-drawer"]');
    expect(drawer.attributes('data-visible')).toBe('true');
    expect(Number(drawer.attributes('data-count'))).toBeGreaterThan(0);
  });

  it('switches to queue tab and applies filter when dashboard emits queue-filter-change', async () => {
    const wrapper = mount(GovernanceView, {
      global: {
        stubs: {
          GovernanceDashboard: GovernanceDashboardStub,
          ReviewQueue: ReviewQueueStub,
          EvidenceDrawer: EvidenceDrawerStub,
        },
      },
    });

    await wrapper.find('.emit-dashboard-filter').trigger('click');

    expect(wrapper.find('[data-testid="review-queue"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('当前过滤：复核中');
    expect(wrapper.find('.items-count').attributes('data-count')).toBe('1');
  });

  it('handles reject event without breaking queue rendering', async () => {
    const wrapper = mount(GovernanceView, {
      global: {
        stubs: {
          GovernanceDashboard: GovernanceDashboardStub,
          ReviewQueue: ReviewQueueStub,
          EvidenceDrawer: EvidenceDrawerStub,
        },
      },
    });

    await wrapper.findAll('.tab-nav button')[1].trigger('click');
    await wrapper.find('.emit-reject').trigger('click');

    expect(wrapper.find('[data-testid="review-queue"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('复核队列');
  });

  it('shows a dedicated entry to the standalone FHIR explorer page', () => {
    const wrapper = mount(GovernanceView, {
      global: {
        stubs: {
          GovernanceDashboard: GovernanceDashboardStub,
          ReviewQueue: ReviewQueueStub,
          EvidenceDrawer: EvidenceDrawerStub,
        },
      },
    });

    const fhirLink = wrapper.find('a.fhir-link');
    expect(fhirLink.exists()).toBe(true);
    expect(fhirLink.attributes('href')).toBe('/fhir');
  });

  it('shows backend factor strip with latency/retry, consensus and routing waterfall factors', () => {
    const wrapper = mount(GovernanceView, {
      global: {
        stubs: {
          GovernanceDashboard: GovernanceDashboardStub,
          ReviewQueue: ReviewQueueStub,
          EvidenceDrawer: EvidenceDrawerStub,
        },
      },
    });

    const factorStrip = wrapper.find('[data-testid="backend-factor-strip"]');
    const factorCards = wrapper.findAll('.factor-card');
    const latencyCard = wrapper.find('[data-factor="latency-retry"]');
    const consensusCard = wrapper.find('[data-factor="consensus"]');
    const routingCard = wrapper.find('[data-factor="routing-waterfall"]');

    expect(factorStrip.exists()).toBe(true);
    expect(factorCards.length).toBe(3);
    expect(latencyCard.exists()).toBe(true);
    expect(consensusCard.exists()).toBe(true);
    expect(routingCard.exists()).toBe(true);
    expect(wrapper.text()).toContain('推理时延与重试热力');
    expect(wrapper.text()).toContain('分歧收敛曲线');
    expect(wrapper.text()).toContain('路由因果瀑布');
  });
});
