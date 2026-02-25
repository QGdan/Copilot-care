import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { WorkflowStage } from '@copilot-care/shared/types';
import WorkflowStateMachine from './WorkflowStateMachine.vue';

function createStageRuntime() {
  return {
    START: { status: 'done', message: '已启动', durationMs: 520 },
    INFO_GATHER: { status: 'done', message: '信息采集完成', durationMs: 1800 },
    RISK_ASSESS: { status: 'done', message: '风险评估完成', durationMs: 2300 },
    ROUTING: {
      status: 'running',
      message: '分流决策中，重试 2',
      startTime: new Date(Date.now() - 1800).toISOString(),
    },
    DEBATE: { status: 'pending', message: '等待讨论' },
    CONSENSUS: { status: 'pending', message: '等待共识收敛' },
    REVIEW: { status: 'pending', message: '等待审校复核' },
    OUTPUT: { status: 'pending', message: '等待输出' },
    ESCALATION: { status: 'pending', message: '按需触发' },
  } as const;
}

describe('WorkflowStateMachine', () => {
  it('renders multi-lane stageboard and stage metadata', () => {
    const wrapper = mount(WorkflowStateMachine, {
      props: {
        stageRuntime: createStageRuntime(),
        currentStage: 'ROUTING',
      },
    });

    expect(wrapper.text()).toContain('多泳道执行看板');
    expect(wrapper.text()).toContain('输入与评估');
    expect(wrapper.text()).toContain('分流与协同');
    expect(wrapper.text()).toContain('治理与输出');
    expect(wrapper.findAll('.stage-card')).toHaveLength(9);
    expect(wrapper.text()).toContain('重试 2 次');
  });

  it('emits stage-click and highlights escalation branch states', async () => {
    const wrapper = mount(WorkflowStateMachine, {
      props: {
        stageRuntime: createStageRuntime(),
        currentStage: 'ROUTING' as WorkflowStage,
        hasRedFlag: true,
      },
    });

    expect(wrapper.find('.escalation-path').classes()).toContain('active');
    expect(wrapper.text()).toContain('已激活线下上转路径');

    const routingCard = wrapper
      .findAll('.stage-card')
      .find((card) => card.text().includes('复杂度分流'));
    expect(routingCard).toBeTruthy();

    await routingCard?.trigger('click');
    expect(wrapper.emitted('stage-click')?.[0]).toEqual(['ROUTING']);
  });

  it('emits stage-hover and stage-hover-leave while previewing stages', async () => {
    const wrapper = mount(WorkflowStateMachine, {
      props: {
        stageRuntime: createStageRuntime(),
        currentStage: 'ROUTING',
      },
    });

    const routingCard = wrapper
      .findAll('.stage-card')
      .find((card) => card.text().includes('复杂度分流'));
    expect(routingCard).toBeTruthy();

    await routingCard?.trigger('mouseenter');
    await routingCard?.trigger('mouseleave');

    expect(wrapper.emitted('stage-hover')?.[0]).toEqual(['ROUTING']);
    expect(wrapper.emitted('stage-hover-leave')).toHaveLength(1);
  });
});
