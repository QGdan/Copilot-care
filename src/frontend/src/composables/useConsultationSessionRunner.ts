import { ref, type Ref } from 'vue';
import type {
  AgentOpinion,
  AuthoritativeSearchDiagnostics,
  DebateRound,
  ExplainableReport,
  OrchestrationSnapshot,
  RuleGovernanceSnapshot,
  StructuredTriageResult,
  TriageApiResponse,
  TriageBlockingReason,
  TriageErrorResponse,
  TriageRequest,
  TriageRoutingInfo,
  TriageStreamEvent,
  TriageStreamStageStatus,
  WorkflowStage,
} from '@copilot-care/shared/types';
import {
  orchestrateTriageStream,
  type StreamOptions,
} from '../services/triageApi';
import {
  formatDestination,
  formatTriageLevel,
} from '../constants/triageLabels';
import type { DemoStep } from './useDemoMode';

export type ConsultationRunnerUiStatus =
  | 'IDLE'
  | 'OUTPUT'
  | 'ESCALATE_TO_OFFLINE'
  | 'ABSTAIN'
  | 'ERROR';

export type ConsultationRunnerReasoningKind =
  | 'system'
  | 'evidence'
  | 'decision'
  | 'warning'
  | 'query';

export interface ConsultationChatMessage {
  role: 'user' | 'system';
  content: string;
}

export interface ConsultationInputForm {
  symptomText: string;
  age: number;
  sex: 'male' | 'female' | 'other';
  chronicDiseasesText: string;
  medicationHistoryText: string;
  systolicBPText: string;
  diastolicBPText: string;
  consentToken: string;
}

interface StageRuntimeState {
  status: TriageStreamStageStatus;
  message: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
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

interface SnapshotPhaseLabels {
  assignment: string;
  analysis: string;
  execution: string;
  synthesis: string;
  complete: string;
}

interface StreamStateBindings {
  clarificationQuestion: Ref<string>;
  requiredFields: Ref<string[]>;
  nextAction: Ref<string>;
  systemError: Ref<string>;
  blockingReason: Ref<TriageBlockingReason | null>;
  stageRuntime: Ref<Record<WorkflowStage, StageRuntimeState>>;
  reasoningItems: Ref<
    Array<{
      kind: ConsultationRunnerReasoningKind;
      text: string;
      stage?: WorkflowStage;
    }>
  >;
  rounds: Ref<DebateRound[]>;
  finalConsensus: Ref<AgentOpinion | null>;
  triageResult: Ref<StructuredTriageResult | null>;
  ruleGovernance: Ref<RuleGovernanceSnapshot | null>;
  routeInfo: Ref<TriageRoutingInfo | null>;
  routingPreview: Ref<RoutingPreviewState>;
  explainableReport: Ref<ExplainableReport | null>;
  authoritativeSearch: Ref<AuthoritativeSearchDiagnostics | null>;
  resultNotes: Ref<string[]>;
  orchestrationSnapshot: Ref<OrchestrationSnapshot | null>;
  captureRoutingFromText: (text: string) => void;
  rememberStageEvent: (event: StageUpdateEvent) => boolean;
  rememberReasoning: (message: string) => boolean;
  shouldPushStageNarrative: (event: StageUpdateEvent) => boolean;
  pushReasoning: (
    kind: ConsultationRunnerReasoningKind,
    text: string,
    stage?: WorkflowStage,
  ) => void;
  updateStage: (
    stage: WorkflowStage,
    statusValue: TriageStreamStageStatus,
    message: string,
  ) => void;
  resetStreamStateCore: () => void;
}

export interface UseConsultationSessionRunnerOptions {
  status: Ref<ConsultationRunnerUiStatus>;
  microStatus: Ref<string>;
  showAdvancedInputs: Ref<boolean>;
  messages: Ref<ConsultationChatMessage[]>;
  streamState: StreamStateBindings;
  validateInput: () => string | null;
  buildRequestPayload: () => TriageRequest;
  classifyReasoningKind: (
    message: string,
  ) => ConsultationRunnerReasoningKind;
  formatRequiredField: (field: string) => string;
  stageLabels: Record<WorkflowStage, string>;
  statusLabels: Record<ConsultationRunnerUiStatus, string>;
  snapshotPhaseLabels: SnapshotPhaseLabels;
  createDemoSteps: (
    reasoningItems: Array<{ kind: string; text: string; stage?: string }>,
    stageRuntime: Record<string, { status: string; message: string }>,
  ) => DemoStep[];
  initDemoSteps: (steps: DemoStep[]) => void;
  onResetView?: () => void;
  streamRequest?: (
    payload: TriageRequest,
    options: StreamOptions,
  ) => Promise<void>;
}

export interface ConsultationSessionRunnerState {
  loading: Ref<boolean>;
  loadingSeconds: Ref<number>;
  typedOutput: Ref<string>;
  submitConsultation: () => Promise<void>;
  disposeSessionRunner: () => void;
}

function isErrorResponse(
  payload: TriageApiResponse,
): payload is TriageErrorResponse {
  return payload.status === 'ERROR';
}

const STAGE_ORDER: WorkflowStage[] = [
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

function resolveRunningStage(
  stageRuntime: Record<WorkflowStage, StageRuntimeState>,
): WorkflowStage | undefined {
  for (const stage of STAGE_ORDER) {
    if (stageRuntime[stage]?.status === 'running') {
      return stage;
    }
  }
  return undefined;
}

const SUMMARY_SECTION_PATTERN = /(当前结论[:：]|结论[:：]|分诊[:：]|建议[:：])/g;

function normalizeSummaryTextForCompare(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[，。；、:：,./\\\-_\s()（）[\]【】]/g, '');
}

function dedupeSummaryLines(lines: string[]): string[] {
  const selected: string[] = [];
  const selectedNorm: string[] = [];
  for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
    const normalized = normalizeSummaryTextForCompare(line);
    if (!normalized) {
      continue;
    }
    const duplicated = selectedNorm.some((existing) =>
      existing === normalized
      || existing.includes(normalized)
      || normalized.includes(existing),
    );
    if (duplicated) {
      continue;
    }
    selected.push(line);
    selectedNorm.push(normalized);
  }
  return selected;
}

function splitSummaryLines(text: string): string[] {
  const normalized = text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/([\\/]\s*){3,}/g, ' ')
    .trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .replace(SUMMARY_SECTION_PATTERN, '\n$1')
    .replace(/\n+/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveSummarySectionKey(line: string): 'conclusion' | 'triage' | 'advice' | null {
  if (/^(?:当前)?结论[:：]/.test(line)) {
    return 'conclusion';
  }
  if (/^分诊[:：]/.test(line)) {
    return 'triage';
  }
  if (/^建议[:：]/.test(line)) {
    return 'advice';
  }
  return null;
}

function collapseRepeatedSummaryBlocks(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const lines = splitSummaryLines(trimmed);
  if (lines.length === 0) {
    return '';
  }
  if (lines.length >= 2 && lines.length % 2 === 0) {
    const half = lines.length / 2;
    const firstHalf = lines.slice(0, half);
    const secondHalf = lines.slice(half);
    const same = firstHalf.every(
      (line, index) =>
        normalizeSummaryTextForCompare(line)
        === normalizeSummaryTextForCompare(secondHalf[index] ?? ''),
    );
    if (same) {
      return firstHalf.join('\n');
    }
  }

  const output: string[] = [];
  const sectionLines = new Map<'conclusion' | 'triage' | 'advice', string>();
  for (const line of dedupeSummaryLines(lines)) {
    const sectionKey = resolveSummarySectionKey(line);
    if (!sectionKey) {
      output.push(line);
      continue;
    }

    const existingLine = sectionLines.get(sectionKey);
    if (!existingLine) {
      sectionLines.set(sectionKey, line);
      output.push(line);
      continue;
    }

    const existingNormalized = normalizeSummaryTextForCompare(existingLine);
    const currentNormalized = normalizeSummaryTextForCompare(line);
    if (
      existingNormalized === currentNormalized
      || existingNormalized.includes(currentNormalized)
    ) {
      continue;
    }
    if (
      currentNormalized.includes(existingNormalized)
      || line.length > existingLine.length
    ) {
      const index = output.findIndex((entry) => entry === existingLine);
      if (index >= 0) {
        output[index] = line;
      }
      sectionLines.set(sectionKey, line);
      continue;
    }
  }

  return output.join('\n');
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function shouldPreferFallbackSummary(
  streamSummary: string,
  fallbackSummary: string,
): boolean {
  if (!fallbackSummary.trim()) {
    return false;
  }

  const summary = streamSummary.trim();
  if (!summary) {
    return true;
  }

  const repeatedSections = [
    /(?:当前)?结论[:：]/g,
    /分诊[:：]/g,
    /建议[:：]/g,
  ].some((pattern) => countMatches(summary, pattern) > 1);
  const slashNoise = /([\\/]\s*){3,}/.test(summary);
  const normalizedSummary = normalizeSummaryTextForCompare(summary);
  const normalizedFallback = normalizeSummaryTextForCompare(fallbackSummary);
  const fallbackRepeated =
    normalizedFallback.length > 0
    && normalizedSummary.includes(normalizedFallback)
    && normalizedSummary.indexOf(normalizedFallback)
      !== normalizedSummary.lastIndexOf(normalizedFallback);

  return repeatedSections || slashNoise || fallbackRepeated;
}

function buildFallbackTypedSummary(
  payload: Exclude<TriageApiResponse, { status: 'ERROR' }>,
): string {
  const conclusion = payload.explainableReport?.conclusion ?? '';
  const normalizedConclusion = normalizeSummaryTextForCompare(conclusion);
  const triageLine = payload.triageResult
    ? `分诊：${formatTriageLevel(payload.triageResult.triageLevel)} / 去向：${formatDestination(payload.triageResult.destination)}`
    : '';
  const actions = dedupeSummaryLines(payload.explainableReport?.actions ?? []);
  const actionLine = actions.length > 0 ? `建议：${actions.join('；')}` : '';

  const lines = dedupeSummaryLines([
    conclusion ? `结论：${conclusion}` : '',
    triageLine
      && !normalizedConclusion.includes(normalizeSummaryTextForCompare(triageLine))
      ? triageLine
      : '',
    actionLine
      && !normalizedConclusion.includes(normalizeSummaryTextForCompare(actionLine))
      ? actionLine
      : '',
  ]);

  return collapseRepeatedSummaryBlocks(lines.join('\n'));
}

export function useConsultationSessionRunner(
  options: UseConsultationSessionRunnerOptions,
): ConsultationSessionRunnerState {
  const streamRequest = options.streamRequest ?? orchestrateTriageStream;

  const loading = ref<boolean>(false);
  const loadingSeconds = ref<number>(0);
  const typedOutput = ref<string>('');
  const tokenQueue = ref<string[]>([]);

  let typewriterTimer: ReturnType<typeof setInterval> | null = null;
  let loadingTimer: ReturnType<typeof setInterval> | null = null;
  let activeController: AbortController | null = null;
  let pendingFinalSummaryCleanup = false;
  let finalFallbackSummary = '';

  function finalizeTypedOutput(): void {
    const cleanedStreamSummary = collapseRepeatedSummaryBlocks(typedOutput.value);
    if (shouldPreferFallbackSummary(cleanedStreamSummary, finalFallbackSummary)) {
      typedOutput.value = finalFallbackSummary;
      return;
    }

    typedOutput.value = cleanedStreamSummary || finalFallbackSummary;
  }

  function startTypewriter(): void {
    if (typewriterTimer) {
      return;
    }
    typewriterTimer = setInterval(() => {
      const token = tokenQueue.value.shift();
      if (typeof token !== 'string') {
        clearInterval(typewriterTimer as ReturnType<typeof setInterval>);
        typewriterTimer = null;
        if (pendingFinalSummaryCleanup) {
          pendingFinalSummaryCleanup = false;
          finalizeTypedOutput();
        }
        return;
      }
      typedOutput.value += token;
    }, 20);
  }

  function enqueueTokens(text: string): void {
    for (const token of text) {
      tokenQueue.value.push(token);
    }
    startTypewriter();
  }

  function clearTypewriter(): void {
    typedOutput.value = '';
    tokenQueue.value = [];
    pendingFinalSummaryCleanup = false;
    finalFallbackSummary = '';
    if (typewriterTimer) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
    }
  }

  function resetRuntimeView(): void {
    options.streamState.resetStreamStateCore();
    options.onResetView?.();
    clearTypewriter();
  }

  function applyFinalResult(payload: TriageApiResponse): void {
    if (isErrorResponse(payload)) {
      options.status.value = 'ERROR';
      options.streamState.requiredFields.value = payload.requiredFields ?? [];
      options.streamState.nextAction.value = payload.nextAction ?? '';
      options.streamState.resultNotes.value = payload.notes;
      options.streamState.systemError.value = payload.errorCode;
      options.streamState.blockingReason.value = payload.blockingReason ?? null;
      options.streamState.ruleGovernance.value = payload.ruleGovernance ?? null;
      options.streamState.authoritativeSearch.value =
        payload.authoritativeSearch ?? null;
      options.microStatus.value = `会诊未完成：${payload.notes.join('；')}`;
      options.streamState.pushReasoning('warning', options.microStatus.value);
      if (payload.requiredFields && payload.requiredFields.length > 0) {
        options.streamState.clarificationQuestion.value = `请补充：${payload.requiredFields
          .map(options.formatRequiredField)
          .join('、')}`;
        options.streamState.pushReasoning(
          'query',
          options.streamState.clarificationQuestion.value,
        );
      }
      options.messages.value.push({
        role: 'system',
        content: options.microStatus.value,
      });
      return;
    }

    options.status.value = payload.status as ConsultationRunnerUiStatus;
    options.streamState.rounds.value = payload.rounds;
    options.streamState.routeInfo.value = payload.routing ?? null;
    if (payload.routing) {
      options.streamState.routingPreview.value = {
        routeMode: payload.routing.routeMode,
        department: payload.routing.department,
        collaborationMode: payload.routing.collaborationMode,
        complexityScore: payload.routing.complexityScore,
      };
    }
    options.streamState.triageResult.value = payload.triageResult ?? null;
    options.streamState.nextAction.value = payload.nextAction ?? '';
    options.streamState.blockingReason.value = payload.blockingReason ?? null;
    options.streamState.ruleGovernance.value = payload.ruleGovernance ?? null;
    options.streamState.explainableReport.value = payload.explainableReport ?? null;
    options.streamState.authoritativeSearch.value =
      payload.authoritativeSearch ?? null;
    options.streamState.finalConsensus.value = payload.finalConsensus ?? null;
    options.streamState.resultNotes.value = payload.notes;
    options.microStatus.value = `会诊完成：${options.statusLabels[options.status.value]}`;
    options.streamState.pushReasoning('decision', options.microStatus.value);

    finalFallbackSummary = buildFallbackTypedSummary(payload);
    pendingFinalSummaryCleanup = true;
    if (!typewriterTimer && tokenQueue.value.length === 0) {
      pendingFinalSummaryCleanup = false;
      finalizeTypedOutput();
    }

    options.messages.value.push({
      role: 'system',
      content: options.microStatus.value,
    });

    const demoSteps = options.createDemoSteps(
      options.streamState.reasoningItems.value.map((item) => ({
        kind: item.kind,
        text: item.text,
        stage: item.stage,
      })),
      options.streamState.stageRuntime.value as Record<
        string,
        { status: string; message: string }
      >,
    );

    if (demoSteps.length > 0) {
      options.initDemoSteps(demoSteps);
    }
  }

  function handleStreamEvent(event: TriageStreamEvent): void {
    if (event.type === 'stage_update') {
      if (!options.streamState.rememberStageEvent(event)) {
        return;
      }
      options.streamState.updateStage(event.stage, event.status, event.message);
      options.streamState.captureRoutingFromText(event.message);
      options.microStatus.value = `${options.stageLabels[event.stage]}：${event.message}`;
      if (options.streamState.shouldPushStageNarrative(event)) {
        options.streamState.pushReasoning(
          'system',
          options.microStatus.value,
          event.stage,
        );
      }
      return;
    }

    if (event.type === 'orchestration_snapshot') {
      options.streamState.orchestrationSnapshot.value = event.snapshot;
      const summary = event.snapshot.summary.trim();
      const activeTask = event.snapshot.tasks.find(
        (item) => item.status === 'running',
      );
      if (summary) {
        options.microStatus.value = `总Agent(${options.snapshotPhaseLabels[event.snapshot.phase]})：${summary}${activeTask ? ` · ${activeTask.roleName}` : ''}`;
        if (options.streamState.rememberReasoning(`snapshot:${summary}`)) {
          options.streamState.pushReasoning('system', `总Agent：${summary}`);
        }
      }
      return;
    }

    if (event.type === 'reasoning_step') {
      if (!options.streamState.rememberReasoning(event.message)) {
        return;
      }
      options.streamState.captureRoutingFromText(event.message);
      const runningStage = resolveRunningStage(
        options.streamState.stageRuntime.value,
      );
      options.streamState.pushReasoning(
        options.classifyReasoningKind(event.message),
        event.message,
        runningStage,
      );
      return;
    }

    if (event.type === 'clarification_request') {
      options.streamState.clarificationQuestion.value = event.question;
      options.streamState.requiredFields.value = event.requiredFields;
      options.streamState.nextAction.value = event.nextAction ?? '';
      options.showAdvancedInputs.value = true;
      options.streamState.pushReasoning('query', `补充信息请求：${event.question}`);
      options.microStatus.value = event.question;
      return;
    }

    if (event.type === 'token') {
      enqueueTokens(event.token);
      return;
    }

    if (event.type === 'heartbeat') {
      if (event.message) {
        options.microStatus.value = event.message;
      }
      return;
    }

    if (event.type === 'error') {
      options.status.value = 'ERROR';
      options.streamState.systemError.value = event.errorCode;
      options.streamState.nextAction.value = event.nextAction ?? '';
      options.streamState.blockingReason.value = event.blockingReason ?? null;
      if (event.requiredFields && event.requiredFields.length > 0) {
        options.streamState.requiredFields.value = event.requiredFields;
        options.showAdvancedInputs.value = true;
      }
      options.microStatus.value = event.message;
      options.streamState.pushReasoning('warning', `错误：${event.message}`);
      return;
    }

    if (event.type === 'final_result') {
      applyFinalResult(event.result);
    }
  }

  async function submitConsultation(): Promise<void> {
    if (loading.value) {
      return;
    }

    const validationError = options.validateInput();
    if (validationError) {
      options.microStatus.value = validationError;
      options.messages.value.push({ role: 'system', content: validationError });
      return;
    }

    if (activeController) {
      activeController.abort();
      activeController = null;
    }

    const payload = options.buildRequestPayload();
    options.messages.value.push({
      role: 'user',
      content: payload.symptomText ?? '',
    });

    resetRuntimeView();
    loading.value = true;
    options.status.value = 'IDLE';
    options.microStatus.value = '正在启动会诊流程...';
    options.streamState.pushReasoning(
      'system',
      '已提交需求，系统开始执行状态机流程。',
    );

    loadingSeconds.value = 0;
    if (loadingTimer) {
      clearInterval(loadingTimer);
    }
    loadingTimer = setInterval(() => {
      loadingSeconds.value += 1;
    }, 1000);

    activeController = new AbortController();

    try {
      await streamRequest(payload, {
        signal: activeController.signal,
        onEvent: handleStreamEvent,
      });
    } catch (cause: unknown) {
      options.status.value = 'ERROR';
      options.microStatus.value =
        cause instanceof Error
          ? `会诊流中断：${cause.message}`
          : '会诊流中断，请稍后重试。';
      options.streamState.pushReasoning('warning', options.microStatus.value);
      options.messages.value.push({
        role: 'system',
        content: options.microStatus.value,
      });
    } finally {
      loading.value = false;
      if (loadingTimer) {
        clearInterval(loadingTimer);
        loadingTimer = null;
      }
      activeController = null;
    }
  }

  function disposeSessionRunner(): void {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
    if (loadingTimer) {
      clearInterval(loadingTimer);
      loadingTimer = null;
    }
    if (typewriterTimer) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
    }
  }

  return {
    loading,
    loadingSeconds,
    typedOutput,
    submitConsultation,
    disposeSessionRunner,
  };
}

