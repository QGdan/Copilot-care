import { ref } from 'vue';
import type {
  AgentOpinion,
  AuthoritativeSearchDiagnostics,
  DebateRound,
  ExplainableReport,
  OrchestrationSnapshot,
  RuleGovernanceSnapshot,
  StructuredTriageResult,
  TriageBlockingReason,
  TriageRoutingInfo,
  TriageStreamStageStatus,
  WorkflowStage,
} from '@copilot-care/shared/types';

type StreamReasoningKind = 'system' | 'evidence' | 'decision' | 'warning' | 'query';

interface StageRuntimeState {
  status: TriageStreamStageStatus;
  message: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
}

interface ReasoningItem {
  id: string;
  kind: StreamReasoningKind;
  text: string;
  timestamp: string;
  stage?: WorkflowStage;
}

interface RoutingPreviewState {
  routeMode?: string;
  department?: string;
  collaborationMode?: string;
  complexityScore?: number;
}

interface StageUpdateEvent {
  stage: WorkflowStage;
  status: TriageStreamStageStatus;
  message: string;
}

interface UseConsultationStreamStateOptions {
  createInitialStageRuntime: () => Record<WorkflowStage, StageRuntimeState>;
}

const MAX_REASONING_ITEMS = 120;

function nowIso(): string {
  return new Date().toISOString();
}

export function useConsultationStreamState(
  options: UseConsultationStreamStateOptions,
) {
  const clarificationQuestion = ref('');
  const requiredFields = ref<string[]>([]);
  const nextAction = ref('');
  const systemError = ref('');
  const blockingReason = ref<TriageBlockingReason | null>(null);

  const stageRuntime = ref<Record<WorkflowStage, StageRuntimeState>>(
    options.createInitialStageRuntime(),
  );
  const reasoningItems = ref<ReasoningItem[]>([]);
  const rounds = ref<DebateRound[]>([]);
  const finalConsensus = ref<AgentOpinion | null>(null);
  const triageResult = ref<StructuredTriageResult | null>(null);
  const ruleGovernance = ref<RuleGovernanceSnapshot | null>(null);
  const routeInfo = ref<TriageRoutingInfo | null>(null);
  const routingPreview = ref<RoutingPreviewState>({});
  const explainableReport = ref<ExplainableReport | null>(null);
  const authoritativeSearch = ref<AuthoritativeSearchDiagnostics | null>(null);
  const resultNotes = ref<string[]>([]);
  const orchestrationSnapshot = ref<OrchestrationSnapshot | null>(null);

  let reasoningCounter = 0;
  let stageEventSeen = new Set<string>();
  let reasoningSeen = new Set<string>();
  let stageNarrativeByStage = new Map<WorkflowStage, string>();

  function captureRoutingFromText(text: string): void {
    const routeMatch = /路由=([A-Z_]+)/.exec(text);
    if (routeMatch) {
      routingPreview.value.routeMode = routeMatch[1];
    }

    const departmentMatch = /科室=([a-zA-Z]+)/.exec(text);
    if (departmentMatch) {
      routingPreview.value.department = departmentMatch[1];
    }

    const scoreMatch = /ComplexityScore=([0-9.]+)/i.exec(text);
    if (scoreMatch) {
      const score = Number(scoreMatch[1]);
      if (Number.isFinite(score)) {
        routingPreview.value.complexityScore = score;
      }
    }

    const collaborationMatch = /协同模式=([^;；]+)/.exec(text);
    if (collaborationMatch) {
      routingPreview.value.collaborationMode = collaborationMatch[1].trim();
    }
  }

  function rememberStageEvent(event: StageUpdateEvent): boolean {
    const key = `${event.stage}|${event.status}|${event.message}`;
    if (stageEventSeen.has(key)) {
      return false;
    }
    stageEventSeen.add(key);
    return true;
  }

  function rememberReasoning(message: string): boolean {
    if (reasoningSeen.has(message)) {
      return false;
    }
    reasoningSeen.add(message);
    return true;
  }

  function shouldPushStageNarrative(event: StageUpdateEvent): boolean {
    if (event.status === 'pending') {
      return false;
    }
    const previous = stageNarrativeByStage.get(event.stage);
    if (previous === event.message) {
      return false;
    }
    stageNarrativeByStage.set(event.stage, event.message);
    return true;
  }

  function pushReasoning(
    kind: StreamReasoningKind,
    text: string,
    stage?: WorkflowStage,
  ): void {
    reasoningCounter += 1;
    reasoningItems.value.push({
      id: `reason-${reasoningCounter}`,
      kind,
      text,
      timestamp: nowIso(),
      stage,
    });

    if (reasoningItems.value.length > MAX_REASONING_ITEMS) {
      reasoningItems.value.shift();
    }
  }

  function updateStage(
    stage: WorkflowStage,
    statusValue: TriageStreamStageStatus,
    message: string,
  ): void {
    const prev = stageRuntime.value[stage];
    const now = nowIso();
    let startTime = prev.startTime;
    let endTime = prev.endTime;
    let durationMs = prev.durationMs;

    if (statusValue === 'running' && prev.status !== 'running') {
      startTime = now;
      endTime = undefined;
      durationMs = undefined;
    } else if (
      (statusValue === 'done' || statusValue === 'blocked' || statusValue === 'skipped')
      && prev.status === 'running'
    ) {
      endTime = now;
      if (startTime) {
        durationMs = new Date(now).getTime() - new Date(startTime).getTime();
      }
    }

    stageRuntime.value = {
      ...stageRuntime.value,
      [stage]: { status: statusValue, message, startTime, endTime, durationMs },
    };
  }

  function resetStreamStateCore(): void {
    clarificationQuestion.value = '';
    requiredFields.value = [];
    nextAction.value = '';
    systemError.value = '';
    blockingReason.value = null;

    stageRuntime.value = options.createInitialStageRuntime();
    reasoningItems.value = [];
    rounds.value = [];
    finalConsensus.value = null;
    triageResult.value = null;
    ruleGovernance.value = null;
    routeInfo.value = null;
    routingPreview.value = {};
    explainableReport.value = null;
    authoritativeSearch.value = null;
    resultNotes.value = [];
    orchestrationSnapshot.value = null;

    reasoningCounter = 0;
    stageEventSeen = new Set<string>();
    reasoningSeen = new Set<string>();
    stageNarrativeByStage = new Map<WorkflowStage, string>();
  }

  return {
    clarificationQuestion,
    requiredFields,
    nextAction,
    systemError,
    blockingReason,
    stageRuntime,
    reasoningItems,
    rounds,
    finalConsensus,
    triageResult,
    ruleGovernance,
    routeInfo,
    routingPreview,
    explainableReport,
    authoritativeSearch,
    resultNotes,
    orchestrationSnapshot,
    captureRoutingFromText,
    rememberStageEvent,
    rememberReasoning,
    shouldPushStageNarrative,
    pushReasoning,
    updateStage,
    resetStreamStateCore,
  };
}
