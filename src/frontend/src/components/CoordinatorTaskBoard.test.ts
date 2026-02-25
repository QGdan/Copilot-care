import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CoordinatorTaskBoard from './CoordinatorTaskBoard.vue';

function createBaseProps() {
  return {
    phaseText: '协同执行',
    sourceText: 'AI动态',
    sourceKind: 'model' as const,
    updatedAtText: '08:00:00',
    summary: '多代理会诊执行中',
    activeTaskHint: '计划Agent：复核风险边界并阻断不安全输出',
    integrationText: 'AI 实时编排已接入，展示动态图谱。',
    integrationMode: 'model' as const,
    tasks: [
      {
        taskId: 'task-1',
        roleId: 'planner',
        roleName: '计划Agent',
        objective: '复核风险边界',
        status: 'running' as const,
        progress: 140,
        latestUpdate: '等待共识形成后执行安全复核',
      },
    ],
  };
}

describe('CoordinatorTaskBoard', () => {
  it('renders model integration state and clamps progress in UI', () => {
    const wrapper = mount(CoordinatorTaskBoard, {
      props: createBaseProps(),
    });

    expect(wrapper.text()).toContain('总Agent任务看板');
    expect(wrapper.text()).toContain('模型图谱');
    expect(wrapper.text()).toContain('AI 实时编排已接入，展示动态图谱。');
    expect(wrapper.text()).toContain('进度：100%');
    expect(wrapper.find('.status-chip.secondary.model').exists()).toBe(true);
    expect(wrapper.find('.integration-badge.model').exists()).toBe(true);
    expect(wrapper.find('.task-progress-fill').attributes('style')).toContain('100%');
  });

  it('renders waiting mode and empty fallback when no tasks are available', () => {
    const wrapper = mount(CoordinatorTaskBoard, {
      props: {
        ...createBaseProps(),
        sourceText: '待判定',
        sourceKind: 'pending',
        integrationText: '等待会诊启动。',
        integrationMode: 'waiting',
        tasks: [],
      },
    });

    expect(wrapper.text()).toContain('等待中');
    expect(wrapper.text()).toContain('等待会诊启动。');
    expect(wrapper.text()).toContain('等待总Agent分配任务...');
    expect(wrapper.find('.status-chip.secondary.pending').exists()).toBe(true);
    expect(wrapper.find('.integration-badge.waiting').exists()).toBe(true);
  });
});
