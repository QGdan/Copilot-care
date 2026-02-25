import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { WorkflowStage } from '@copilot-care/shared/types';
import {
  useConsultationViewModel,
  type ConsultationUiStatus,
} from './useConsultationViewModel';

function createStageRuntime() {
  return {
    START: { status: 'pending', message: '等待启动' },
    INFO_GATHER: { status: 'pending', message: '等待采集信息' },
    RISK_ASSESS: { status: 'pending', message: '等待风险评估' },
    ROUTING: { status: 'pending', message: '等待分流决策' },
    DEBATE: { status: 'pending', message: '等待讨论' },
    CONSENSUS: { status: 'pending', message: '等待共识收敛' },
    REVIEW: { status: 'pending', message: '等待审校复核' },
    OUTPUT: { status: 'pending', message: '等待输出' },
    ESCALATION: { status: 'pending', message: '按需触发' },
  } as const;
}

function createViewModelState() {
  const flowStages: WorkflowStage[] = [
    'START',
    'INFO_GATHER',
    'RISK_ASSESS',
    'ROUTING',
    'DEBATE',
    'CONSENSUS',
    'REVIEW',
    'OUTPUT',
    'ESCALATION',
  ];
  const coreStages: WorkflowStage[] = [
    'START',
    'INFO_GATHER',
    'RISK_ASSESS',
    'ROUTING',
    'DEBATE',
    'CONSENSUS',
    'REVIEW',
    'OUTPUT',
  ];

  const stageLabels: Record<WorkflowStage, string> = {
    START: '启动',
    INFO_GATHER: '信息采集',
    RISK_ASSESS: '风险评估',
    ROUTING: '复杂度分流',
    DEBATE: '协同讨论',
    CONSENSUS: '共识收敛',
    REVIEW: '审校复核',
    OUTPUT: '输出结论',
    ESCALATION: '线下上转',
  };

  const statusLabels: Record<ConsultationUiStatus, string> = {
    IDLE: '待会诊',
    OUTPUT: '会诊完成',
    ESCALATE_TO_OFFLINE: '建议线下上转',
    ABSTAIN: '暂缓结论',
    ERROR: '会诊异常',
  };

  const snapshotPhaseLabels = {
    assignment: '任务拆分',
    analysis: '证据分析',
    execution: '协同执行',
    synthesis: '汇总结论',
    complete: '最终汇报',
  } as const;

  const status = ref<ConsultationUiStatus>('IDLE');
  const stageRuntime = ref(createStageRuntime());
  const routeInfo = ref<{
    complexityScore: number;
    routeMode: 'FAST_CONSENSUS' | 'LIGHT_DEBATE' | 'DEEP_DEBATE' | 'ESCALATE_TO_OFFLINE';
    department: 'cardiology' | 'generalPractice' | 'metabolic' | 'multiDisciplinary';
    collaborationMode: 'SINGLE_SPECIALTY_PANEL' | 'MULTI_DISCIPLINARY_CONSULT' | 'OFFLINE_ESCALATION';
    reasons: string[];
  } | null>(null);
  const routingPreview = ref<{
    routeMode?: string;
    department?: string;
    collaborationMode?: string;
    complexityScore?: number;
  }>({});
  const resultNotes = ref<string[]>([]);
  const orchestrationSnapshot = ref<{
    coordinator: string;
    phase: 'assignment' | 'analysis' | 'execution' | 'synthesis' | 'complete';
    summary: string;
    tasks: Array<{
      taskId: string;
      roleId: string;
      roleName: string;
      objective: string;
      status: 'pending' | 'running' | 'done' | 'blocked';
      progress: number;
      latestUpdate?: string;
    }>;
    graph: { nodes: never[]; edges: never[] };
    generatedAt: string;
    source: 'model' | 'rule';
  } | null>(null);

  const model = useConsultationViewModel({
    flowStages,
    coreStages,
    stageLabels,
    statusLabels,
    snapshotPhaseLabels,
    status,
    stageRuntime,
    routeInfo,
    routingPreview,
    resultNotes,
    orchestrationSnapshot,
  });

  return {
    status,
    stageRuntime,
    routeInfo,
    routingPreview,
    resultNotes,
    orchestrationSnapshot,
    model,
  };
}

describe('useConsultationViewModel', () => {
  it('maps status and safety block fields', () => {
    const state = createViewModelState();

    expect(state.model.statusText.value).toBe('待会诊');
    expect(state.model.isSafetyBlocked.value).toBe(false);
    expect(state.model.riskSignal.value).toBe('normal');
    expect(state.model.sceneLevel.value).toBe('briefing');

    state.status.value = 'ESCALATE_TO_OFFLINE';
    state.resultNotes.value = ['安全审校触发：阻断线上建议'];

    expect(state.model.safetyBlockNote.value).toContain('阻断');
    expect(state.model.isSafetyBlocked.value).toBe(true);
    expect(state.model.riskSignal.value).toBe('critical');
    expect(state.model.sceneLevel.value).toBe('critical');
  });

  it('sorts coordinator tasks and resolves active task hint', () => {
    const state = createViewModelState();

    state.orchestrationSnapshot.value = {
      coordinator: '总Agent',
      phase: 'execution',
      summary: '执行中',
      tasks: [
        {
          taskId: 'done-1',
          roleId: 'safety',
          roleName: '安全审校Agent',
          objective: '复核风险边界',
          status: 'done',
          progress: 100,
        },
        {
          taskId: 'run-1',
          roleId: 'planner',
          roleName: '计划Agent',
          objective: '等待共识形成后执行安全复核',
          status: 'running',
          progress: 40,
          latestUpdate: '复核风险边界并阻断不安全输出',
        },
        {
          taskId: 'pending-1',
          roleId: 'diag',
          roleName: '诊断Agent',
          objective: '等待输入',
          status: 'pending',
          progress: 0,
        },
      ],
      graph: { nodes: [], edges: [] },
      generatedAt: '2026-02-23T08:00:00.000Z',
      source: 'model',
    };

    expect(state.model.coordinatorTasks.value[0]?.taskId).toBe('run-1');
    expect(state.model.coordinatorPhaseText.value).toBe('协同执行');
    expect(state.model.coordinatorSourceKind.value).toBe('model');
    expect(state.model.coordinatorSourceText.value).toBe('AI动态');
    expect(state.model.coordinatorActiveTaskHint.value).toContain('计划Agent');
    expect(state.model.coordinatorActiveTaskHint.value).toContain('复核风险边界');
  });

  it('derives routing path and stage progress correctly', () => {
    const state = createViewModelState();

    state.routingPreview.value = {
      routeMode: 'DEEP_DEBATE',
      department: 'cardiology',
      collaborationMode: 'MULTI_DISCIPLINARY_CONSULT',
      complexityScore: 6.2,
    };
    state.stageRuntime.value.START.status = 'done';
    state.stageRuntime.value.START.message = '已启动';
    state.stageRuntime.value.INFO_GATHER.status = 'running';
    state.stageRuntime.value.INFO_GATHER.message = '采集中';

    expect(state.model.pathDepartmentText.value).toContain('心血管');
    expect(state.model.pathRouteModeText.value).toContain('深度辩论');
    expect(state.model.pathRouteModeText.value).toContain('6.2');
    expect(state.model.pathCollaborationText.value).toContain('多学科');
    expect(state.model.chartDensity.value).toBe('compact');
    expect(state.model.riskSignal.value).toBe('warning');

    expect(state.model.currentStageInfo.value.stage).toBe('INFO_GATHER');
    expect(state.model.currentStageInfo.value.status).toBe('running');
    expect(state.model.progressPercent.value).toBe(25);
  });

  it('computes reasoning integration text from runtime source', () => {
    const state = createViewModelState();

    expect(state.model.coordinatorSourceText.value).toBe('待判定');
    expect(state.model.reasoningIntegrationMode.value).toBe('waiting');
    expect(state.model.reasoningIntegrationText.value).toBe('等待会诊启动。');
    expect(state.model.sceneLevel.value).toBe('briefing');

    state.stageRuntime.value.START.status = 'running';
    expect(state.model.reasoningIntegrationMode.value).toBe('syncing');
    expect(state.model.reasoningIntegrationText.value).toBe('会诊已启动，等待图谱事件。');
    expect(state.model.sceneLevel.value).toBe('active');

    state.routingPreview.value.routeMode = 'LIGHT_DEBATE';
    expect(state.model.reasoningIntegrationMode.value).toBe('syncing');
    expect(state.model.reasoningIntegrationText.value).toBe('分流结果已生成，正在同步推理图。');
    expect(state.model.chartDensity.value).toBe('comfortable');

    state.orchestrationSnapshot.value = {
      coordinator: '总Agent',
      phase: 'analysis',
      summary: '分析中',
      tasks: [],
      graph: { nodes: [], edges: [] },
      generatedAt: '2026-02-23T08:00:00.000Z',
      source: 'rule',
    };
    expect(state.model.coordinatorSourceKind.value).toBe('rule');
    expect(state.model.reasoningIntegrationMode.value).toBe('rule');
    expect(state.model.reasoningIntegrationText.value).toBe('规则编排运行中，展示本地推理图。');

    state.orchestrationSnapshot.value.source = 'model';
    expect(state.model.coordinatorSourceKind.value).toBe('model');
    expect(state.model.reasoningIntegrationMode.value).toBe('model');
    expect(state.model.reasoningIntegrationText.value).toBe('AI 实时编排已接入，展示动态图谱。');
  });
});
