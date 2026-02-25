import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { TriageStreamStageStatus, WorkflowStage } from '@copilot-care/shared/types';
import WorkflowLayerMatrix from './WorkflowLayerMatrix.vue';

interface StageState {
  status: TriageStreamStageStatus;
  message: string;
}

function createStageRuntime(
  overrides: Partial<Record<WorkflowStage, StageState>> = {},
): Record<WorkflowStage, StageState> {
  const base: Record<WorkflowStage, StageState> = {
    START: { status: 'pending', message: '等待启动' },
    INFO_GATHER: { status: 'pending', message: '等待采集信息' },
    RISK_ASSESS: { status: 'pending', message: '等待风险评估' },
    ROUTING: { status: 'pending', message: '等待分流决策' },
    DEBATE: { status: 'pending', message: '等待讨论' },
    CONSENSUS: { status: 'pending', message: '等待共识收敛' },
    REVIEW: { status: 'pending', message: '等待审校复核' },
    OUTPUT: { status: 'pending', message: '等待输出' },
    ESCALATION: { status: 'pending', message: '按需触发' },
  };

  return {
    ...base,
    ...overrides,
  };
}

describe('WorkflowLayerMatrix', () => {
  it('renders seven layers and summary cards', () => {
    const wrapper = mount(WorkflowLayerMatrix, {
      props: {
        stageRuntime: createStageRuntime(),
        currentStage: 'START',
      },
    });

    expect(wrapper.findAll('.layer-card')).toHaveLength(7);
    expect(wrapper.findAll('.ops-card')).toHaveLength(3);
    expect(wrapper.text()).toContain('七层工作流模块');
    expect(wrapper.text()).toContain('完成度');
  });

  it('shows blocked layer in intervention queue', () => {
    const wrapper = mount(WorkflowLayerMatrix, {
      props: {
        stageRuntime: createStageRuntime({
          REVIEW: { status: 'blocked', message: '安全审校阻断' },
        }),
        currentStage: 'REVIEW',
      },
    });

    expect(wrapper.findAll('.layer-card.blocked').length).toBeGreaterThan(0);
    expect(wrapper.findAll('.queue-item.blocked').length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain('当前存在阻断层');
  });

  it('emits stage-click when stage pill clicked', async () => {
    const wrapper = mount(WorkflowLayerMatrix, {
      props: {
        stageRuntime: createStageRuntime({
          ROUTING: { status: 'running', message: '正在分流' },
        }),
        currentStage: 'ROUTING',
      },
    });

    const stagePill = wrapper
      .findAll('.stage-pill')
      .find((item) => item.text().includes('复杂度路由'));

    expect(stagePill).toBeTruthy();
    await stagePill?.trigger('click');

    expect(wrapper.emitted('stage-click')?.[0]).toEqual(['ROUTING']);
  });

  it('emits stage-hover and stage-hover-leave when hovering stage items', async () => {
    const wrapper = mount(WorkflowLayerMatrix, {
      props: {
        stageRuntime: createStageRuntime({
          ROUTING: { status: 'running', message: '正在分流' },
        }),
        currentStage: 'ROUTING',
      },
    });

    const stagePill = wrapper
      .findAll('.stage-pill')
      .find((item) => item.text().includes('复杂度路由'));
    expect(stagePill).toBeTruthy();

    await stagePill?.trigger('mouseenter');
    await stagePill?.trigger('mouseleave');

    expect(wrapper.emitted('stage-hover')?.[0]).toEqual(['ROUTING']);
    expect(wrapper.emitted('stage-hover-leave')).toHaveLength(1);
  });
});
