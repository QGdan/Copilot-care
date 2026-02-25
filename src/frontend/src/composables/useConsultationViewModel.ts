import { computed, type Ref } from 'vue';
import type {
  OrchestrationSnapshot,
  OrchestrationTask,
  TriageRoutingInfo,
  TriageStreamStageStatus,
  WorkflowStage,
} from '@copilot-care/shared/types';
import {
  ROUTE_MODE_TO_COLLABORATION,
  formatCollaboration,
  formatDepartment,
  formatRouteMode,
} from '../constants/triageLabels';
import type {
  ChartDensity,
  RiskSignal,
  SceneLevel,
} from '../types/visualization';

export type ConsultationUiStatus =
  | 'IDLE'
  | 'OUTPUT'
  | 'ESCALATE_TO_OFFLINE'
  | 'ABSTAIN'
  | 'ERROR';
export type CoordinatorSourceKind = 'pending' | 'rule' | 'model';
export type ReasoningIntegrationMode = 'waiting' | 'syncing' | 'rule' | 'model';

interface StageRuntimeState {
  status: TriageStreamStageStatus;
  message: string;
}

interface RoutingPreviewState {
  routeMode?: string;
  department?: string;
  collaborationMode?: string;
  complexityScore?: number;
}

interface CurrentStageInfo {
  stage: WorkflowStage;
  label: string;
  status: TriageStreamStageStatus;
  message: string;
}

interface UseConsultationViewModelOptions {
  flowStages: WorkflowStage[];
  coreStages: WorkflowStage[];
  stageLabels: Record<WorkflowStage, string>;
  statusLabels: Record<ConsultationUiStatus, string>;
  snapshotPhaseLabels: Record<OrchestrationSnapshot['phase'], string>;
  status: Ref<ConsultationUiStatus>;
  stageRuntime: Ref<Record<WorkflowStage, StageRuntimeState>>;
  routeInfo: Ref<TriageRoutingInfo | null>;
  routingPreview: Ref<RoutingPreviewState>;
  resultNotes: Ref<string[]>;
  orchestrationSnapshot: Ref<OrchestrationSnapshot | null>;
}

const SAFETY_BLOCK_NOTE_PATTERN = /安全审校触发|阻断/i;

export function useConsultationViewModel(
  options: UseConsultationViewModelOptions,
) {
  const statusText = computed<string>(() => {
    return options.statusLabels[options.status.value];
  });

  const safetyBlockNote = computed<string>(() => {
    return (
      options.resultNotes.value.find((note) => SAFETY_BLOCK_NOTE_PATTERN.test(note))
      ?? ''
    );
  });

  const isSafetyBlocked = computed<boolean>(() => {
    return (
      options.status.value === 'ESCALATE_TO_OFFLINE'
      && safetyBlockNote.value.length > 0
    );
  });

  const coordinatorTasks = computed<OrchestrationTask[]>(() => {
    const source = options.orchestrationSnapshot.value?.tasks ?? [];
    const statusRank: Record<OrchestrationTask['status'], number> = {
      running: 0,
      pending: 1,
      blocked: 2,
      done: 3,
    };

    return [...source].sort((left, right) => {
      const rankGap = statusRank[left.status] - statusRank[right.status];
      if (rankGap !== 0) {
        return rankGap;
      }
      return right.progress - left.progress;
    });
  });

  const coordinatorSummary = computed<string>(() => {
    return options.orchestrationSnapshot.value?.summary
      ?? '等待总Agent分配任务...';
  });

  const coordinatorUpdatedAtText = computed<string>(() => {
    const generatedAt = options.orchestrationSnapshot.value?.generatedAt;
    if (!generatedAt) {
      return '--:--:--';
    }

    const date = new Date(generatedAt);
    if (Number.isNaN(date.getTime())) {
      return '--:--:--';
    }

    return date.toLocaleTimeString('zh-CN', { hour12: false });
  });

  const coordinatorPhaseText = computed<string>(() => {
    const phase = options.orchestrationSnapshot.value?.phase;
    if (!phase) {
      return '未启动';
    }

    return options.snapshotPhaseLabels[phase] ?? phase;
  });

  const coordinatorSourceKind = computed<CoordinatorSourceKind>(() => {
    const source = options.orchestrationSnapshot.value?.source;
    if (!source) {
      return 'pending';
    }
    return source === 'model' ? 'model' : 'rule';
  });

  const coordinatorSourceText = computed<string>(() => {
    if (coordinatorSourceKind.value === 'model') {
      return 'AI动态';
    }
    if (coordinatorSourceKind.value === 'rule') {
      return '规则';
    }
    return '待判定';
  });

  const coordinatorActiveTaskHint = computed<string>(() => {
    const activeTask = coordinatorTasks.value.find(
      (item) => item.status === 'running',
    );
    if (activeTask) {
      const update = activeTask.latestUpdate?.trim();
      return `${activeTask.roleName}：${update || activeTask.objective}`;
    }
    if (coordinatorTasks.value.length > 0) {
      return '总Agent正在等待下一阶段触发。';
    }
    return '等待总Agent分配任务...';
  });

  const stageLegend = computed(() => {
    return options.flowStages.map((stage) => ({
      stage,
      label: options.stageLabels[stage],
      status: options.stageRuntime.value[stage].status,
      message: options.stageRuntime.value[stage].message,
    }));
  });

  const currentStageInfo = computed<CurrentStageInfo>(() => {
    const runningStage = options.flowStages.find((stage) => {
      return options.stageRuntime.value[stage].status === 'running';
    });

    if (runningStage) {
      return {
        stage: runningStage,
        label: options.stageLabels[runningStage],
        status: 'running',
        message: options.stageRuntime.value[runningStage].message,
      };
    }

    const completedStage = [...options.flowStages]
      .reverse()
      .find((stage) => options.stageRuntime.value[stage].status !== 'pending');

    if (!completedStage) {
      return {
        stage: 'START',
        label: options.stageLabels.START,
        status: 'pending',
        message: '等待任务启动',
      };
    }

    return {
      stage: completedStage,
      label: options.stageLabels[completedStage],
      status: options.stageRuntime.value[completedStage].status,
      message: options.stageRuntime.value[completedStage].message,
    };
  });

  const progressPercent = computed<number>(() => {
    const completedCount = options.coreStages.filter((stage) => {
      return options.stageRuntime.value[stage].status !== 'pending';
    }).length;

    return Math.round((completedCount / options.coreStages.length) * 100);
  });

  const pathDepartmentText = computed<string>(() => {
    if (options.routeInfo.value) {
      return formatDepartment(options.routeInfo.value.department);
    }
    if (options.routingPreview.value.department) {
      return formatDepartment(options.routingPreview.value.department);
    }
    if (options.stageRuntime.value.ROUTING.status === 'running') {
      return '正在判定首轮分诊科室...';
    }
    return '等待分诊结果';
  });

  const pathRouteModeText = computed<string>(() => {
    if (options.routeInfo.value) {
      return `${formatRouteMode(options.routeInfo.value.routeMode)}（复杂度 ${options.routeInfo.value.complexityScore}）`;
    }
    if (options.routingPreview.value.routeMode) {
      const complexity = typeof options.routingPreview.value.complexityScore === 'number'
        ? `（复杂度 ${options.routingPreview.value.complexityScore}）`
        : '';
      return `${formatRouteMode(options.routingPreview.value.routeMode)}${complexity}`;
    }
    if (options.stageRuntime.value.ROUTING.status !== 'pending') {
      return '正在计算复杂度分流策略...';
    }
    return '等待复杂度评估';
  });

  const pathCollaborationText = computed<string>(() => {
    if (options.routeInfo.value) {
      return formatCollaboration(options.routeInfo.value.collaborationMode);
    }
    if (options.routingPreview.value.collaborationMode) {
      return formatCollaboration(options.routingPreview.value.collaborationMode);
    }
    if (options.routingPreview.value.routeMode) {
      const inferred = ROUTE_MODE_TO_COLLABORATION[
        options.routingPreview.value.routeMode
      ];
      if (inferred) {
        return formatCollaboration(inferred);
      }
    }
    if (options.stageRuntime.value.DEBATE.status === 'running') {
      return '协同模式准备中...';
    }
    return '等待协同模式确定';
  });

  const reasoningIntegrationMode = computed<ReasoningIntegrationMode>(() => {
    if (coordinatorSourceKind.value === 'model') {
      return 'model';
    }
    if (coordinatorSourceKind.value === 'rule') {
      return 'rule';
    }
    if (
      options.routeInfo.value
      || options.routingPreview.value.routeMode
      || options.stageRuntime.value.START.status !== 'pending'
    ) {
      return 'syncing';
    }
    return 'waiting';
  });

  const reasoningIntegrationText = computed<string>(() => {
    if (reasoningIntegrationMode.value === 'model') {
      return 'AI 实时编排已接入，展示动态图谱。';
    }
    if (reasoningIntegrationMode.value === 'rule') {
      return '规则编排运行中，展示本地推理图。';
    }
    if (options.routeInfo.value || options.routingPreview.value.routeMode) {
      return '分流结果已生成，正在同步推理图。';
    }
    if (reasoningIntegrationMode.value === 'syncing') {
      return '会诊已启动，等待图谱事件。';
    }
    return '等待会诊启动。';
  });

  const riskSignal = computed<RiskSignal>(() => {
    if (isSafetyBlocked.value) {
      return 'critical';
    }

    if (
      options.status.value === 'ESCALATE_TO_OFFLINE'
      || options.stageRuntime.value.ESCALATION.status === 'done'
    ) {
      return 'critical';
    }

    if (
      options.status.value === 'ERROR'
      || options.flowStages.some((stage) => {
        const status = options.stageRuntime.value[stage].status;
        return status === 'blocked' || status === 'failed';
      })
    ) {
      return 'warning';
    }

    const complexity = options.routeInfo.value?.complexityScore
      ?? options.routingPreview.value.complexityScore;
    if (typeof complexity === 'number' && complexity >= 6) {
      return 'warning';
    }

    if (options.status.value === 'OUTPUT') {
      return 'normal';
    }

    return options.stageRuntime.value.START.status === 'pending'
      ? 'normal'
      : 'warning';
  });

  const sceneLevel = computed<SceneLevel>(() => {
    if (riskSignal.value === 'critical') {
      return 'critical';
    }

    if (
      options.status.value === 'OUTPUT'
      || options.flowStages.some((stage) => {
        return options.stageRuntime.value[stage].status === 'running';
      })
    ) {
      return 'active';
    }

    return 'briefing';
  });

  const chartDensity = computed<ChartDensity>(() => {
    const routeMode = options.routeInfo.value?.routeMode
      ?? options.routingPreview.value.routeMode;
    if (routeMode === 'DEEP_DEBATE') {
      return 'compact';
    }

    const taskCount = options.orchestrationSnapshot.value?.tasks.length ?? 0;
    if (taskCount >= 7) {
      return 'compact';
    }

    return 'comfortable';
  });

  return {
    statusText,
    safetyBlockNote,
    isSafetyBlocked,
    coordinatorTasks,
    coordinatorSummary,
    coordinatorUpdatedAtText,
    coordinatorPhaseText,
    coordinatorSourceKind,
    coordinatorSourceText,
    coordinatorActiveTaskHint,
    stageLegend,
    currentStageInfo,
    progressPercent,
    pathDepartmentText,
    pathRouteModeText,
    pathCollaborationText,
    riskSignal,
    sceneLevel,
    chartDensity,
    reasoningIntegrationMode,
    reasoningIntegrationText,
  };
}
