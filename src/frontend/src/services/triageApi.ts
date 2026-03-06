import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type {
  OrchestrationSnapshot,
  RuleGovernanceSnapshot,
  TriageApiResponse,
  TriageErrorResponse,
  TriageRequest,
  TriageStreamStageStatus,
  TriageStreamEvent,
  WorkflowStage,
} from '@copilot-care/shared/types';

const configuredBaseURLRaw = import.meta.env.VITE_API_BASE_URL;
const configuredBaseURL =
  typeof configuredBaseURLRaw === 'string' && configuredBaseURLRaw.trim()
    ? configuredBaseURLRaw.trim()
    : undefined;
const DEFAULT_BASE_URLS = ['http://localhost:3001', 'http://localhost:8002'];
const timeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 300000);

const requestTimeoutMs =
  Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300000;

let preferredBaseURL: string | undefined = configuredBaseURL;

function getBaseCandidates(): string[] {
  if (configuredBaseURL) {
    return [configuredBaseURL];
  }

  if (preferredBaseURL) {
    return [
      preferredBaseURL,
      ...DEFAULT_BASE_URLS.filter((url) => url !== preferredBaseURL),
    ];
  }

  return [...DEFAULT_BASE_URLS];
}

function markPreferredBase(url: string): void {
  if (!configuredBaseURL) {
    preferredBaseURL = url;
  }
}

function shouldTryNextBase(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return true;
    }
    return error.response.status === 404;
  }

  if (error instanceof Error) {
    const match = /stream request failed: (\d+)/.exec(error.message);
    if (match) {
      const statusCode = Number(match[1]);
      return statusCode === 404 || statusCode >= 500;
    }
  }

  return true;
}

async function postToBase<T>(
  baseUrl: string,
  path: string,
  payload: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await axios.post<T>(`${baseUrl}${path}`, payload, {
    timeout: requestTimeoutMs,
    ...config,
  });
  return response.data;
}

async function getFromBase<T>(baseUrl: string, path: string): Promise<T> {
  const response = await axios.get<T>(`${baseUrl}${path}`, {
    timeout: requestTimeoutMs,
  });
  return response.data;
}

async function postWithBaseFallback<T>(
  path: string,
  payload: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  let lastError: unknown;

  for (const baseUrl of getBaseCandidates()) {
    try {
      const data = await postToBase<T>(baseUrl, path, payload, config);
      markPreferredBase(baseUrl);
      return data;
    } catch (error) {
      lastError = error;
      if (!shouldTryNextBase(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('request failed');
}

async function getWithBaseFallback<T>(path: string): Promise<T> {
  let lastError: unknown;

  for (const baseUrl of getBaseCandidates()) {
    try {
      const data = await getFromBase<T>(baseUrl, path);
      markPreferredBase(baseUrl);
      return data;
    } catch (error) {
      lastError = error;
      if (!shouldTryNextBase(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('request failed');
}

export interface ExpertArchitectureItem {
  provider: string;
  source: string;
  llmEnabled: boolean;
  envKey: string;
}

export interface ExpertArchitectureResponse {
  experts: Record<string, ExpertArchitectureItem>;
  routing?: {
    policyVersion: string;
    complexityThresholds: {
      fastConsensusMax: number;
      lightDebateMax: number;
      deepDebateMin: number;
    };
    panelProviders: Record<
      string,
      Array<{
        provider: string;
        llmEnabled: boolean;
      }>
    >;
  };
}

export type GovernanceRuntimeOutcome =
  | 'OUTPUT'
  | 'ESCALATE_TO_OFFLINE'
  | 'ABSTAIN'
  | 'ERROR'
  | 'RUNNING';

export interface GovernanceRuntimeSession {
  id: string;
  requestId?: string;
  patientId: string;
  outcome: GovernanceRuntimeOutcome;
  routeMode?: string;
  triageLevel?: string;
  destination?: string;
  complexityScore?: number;
  durationMs?: number;
  startedAt: string;
  endedAt?: string;
  errorCode?: string;
}

export interface GovernanceRuntimeResponse {
  generatedAt: string;
  source: 'runtime';
  queueOverview: {
    pending: number;
    reviewing: number;
    approved: number;
    rejected: number;
  };
  performance: {
    latencyHeat: number;
    retryPressure: number;
    consensusConvergence: number;
    dissentSpread: number;
    routingComplexity: number;
  };
  totals: {
    totalSessions: number;
    successSessions: number;
    escalatedSessions: number;
    errorSessions: number;
    activeSessions: number;
  };
  recentSessions: GovernanceRuntimeSession[];
  stageRuntime: Record<WorkflowStage, GovernanceRuntimeStageState>;
  currentStage: WorkflowStage;
}

export interface GovernanceRuntimeStageState {
  status: TriageStreamStageStatus;
  message: string;
  active: number;
  transitions: number;
  updatedAt: string;
}

export type GovernanceRuleLayer =
  | 'BASIC_SAFETY'
  | 'FLOW_CONTROL'
  | 'INTELLIGENT_COLLABORATION'
  | 'OPERATIONS';

export interface GovernanceRuleLayerDescriptor {
  id: string;
  layer: GovernanceRuleLayer;
  title: string;
  summary: string;
  implementationRefs: string[];
}

export interface GovernanceGuidelineReference {
  id: string;
  title: string;
  publisher: string;
  publishedOn: string;
  lastUpdatedOn?: string;
  url: string;
}

export interface GovernanceRuleCatalogResponse {
  catalogVersion: string;
  synonymSetVersion?: string;
  layers: GovernanceRuleLayerDescriptor[];
  guidelineReferences: GovernanceGuidelineReference[];
  generatedAt: string;
}

export interface GovernanceRuleVersionResponse {
  catalogVersion: string;
  synonymSetVersion?: string;
  guidelineCount: number;
  generatedAt: string;
}

export interface InteropFhirBundleDraftResponse {
  draft: true;
  generatedAt: string;
  triage: {
    sessionId: string;
    status: string;
    triageLevel?: string;
    destination?: string;
    ruleGovernance?: RuleGovernanceSnapshot;
    interopSummary?: {
      resourceCounts: {
        patient: number;
        observation: number;
        provenance: number;
      };
      referenceIntegrity: {
        observationSubjectLinked: boolean;
        provenanceTargetLinked: boolean;
        provenanceObservationLinked: boolean;
      };
    };
  };
  bundle: {
    resourceType: 'Bundle';
    type: 'collection';
    timestamp: string;
    identifier: {
      system: string;
      value: string;
    };
    entry: Array<{
      fullUrl?: string;
      resource: Record<string, unknown>;
    }>;
  };
}

export async function orchestrateTriage(
  payload: TriageRequest,
): Promise<TriageApiResponse> {
  return postWithBaseFallback<TriageApiResponse>('/orchestrate_triage', payload);
}

export async function fetchExpertArchitecture(): Promise<ExpertArchitectureResponse> {
  return getWithBaseFallback<ExpertArchitectureResponse>('/architecture/experts');
}

export async function fetchGovernanceRuntime(): Promise<GovernanceRuntimeResponse> {
  return getWithBaseFallback<GovernanceRuntimeResponse>('/governance/runtime');
}

export async function fetchGovernanceRuleCatalog(): Promise<GovernanceRuleCatalogResponse> {
  return getWithBaseFallback<GovernanceRuleCatalogResponse>(
    '/governance/rules/catalog',
  );
}

export async function fetchGovernanceRuleVersion(): Promise<GovernanceRuleVersionResponse> {
  return getWithBaseFallback<GovernanceRuleVersionResponse>(
    '/governance/rules/version',
  );
}

export interface InteropFhirBundleOptions {
  smartScope?: string;
}

const DEFAULT_SMART_SCOPE =
  'patient/Patient.read patient/Observation.read patient/Provenance.read';

export async function createInteropFhirTriageBundle(
  payload: TriageRequest,
  options?: InteropFhirBundleOptions,
): Promise<InteropFhirBundleDraftResponse> {
  const smartScope = options?.smartScope?.trim() || DEFAULT_SMART_SCOPE;
  return postWithBaseFallback<InteropFhirBundleDraftResponse>(
    '/interop/fhir/triage-bundle',
    payload,
    {
      headers: {
        'x-smart-scope': smartScope,
      },
    },
  );
}

export interface StreamOptions {
  signal?: AbortSignal;
  onEvent: (event: TriageStreamEvent) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isErrorResponse(
  payload: TriageApiResponse,
): payload is TriageErrorResponse {
  return payload.status === 'ERROR';
}

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

function collapseRepeatedSummaryBlocks(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.length % 2 === 0) {
    const half = lines.length / 2;
    const firstHalf = lines.slice(0, half);
    const secondHalf = lines.slice(half);
    const same = firstHalf.every((line, index) => line === secondHalf[index]);
    if (same) {
      return firstHalf.join('\n');
    }
  }
  return dedupeSummaryLines(lines).join('\n');
}

function buildFallbackSummary(
  payload: Exclude<TriageApiResponse, { status: 'ERROR' }>,
): string {
  const actions = dedupeSummaryLines(payload.explainableReport?.actions ?? []);
  const conclusion = payload.explainableReport?.conclusion ?? '';
  const normalizedConclusion = normalizeSummaryTextForCompare(conclusion);
  const triageLine = payload.triageResult
    ? `分诊：${payload.triageResult.triageLevel} / 去向：${payload.triageResult.destination}`
    : '';
  const actionLine = actions.length > 0 ? `建议：${actions.join('；')}` : '';

  const parts = dedupeSummaryLines([
    payload.explainableReport?.conclusion
      ? `结论：${payload.explainableReport.conclusion}`
      : '',
    triageLine
      && !normalizedConclusion.includes(normalizeSummaryTextForCompare(triageLine))
      ? triageLine
      : '',
    actionLine
      && !normalizedConclusion.includes(normalizeSummaryTextForCompare(actionLine))
      ? actionLine
      : '',
  ]);

  return collapseRepeatedSummaryBlocks(parts.join('\n'));
}

function buildFallbackSnapshot(summary: string): OrchestrationSnapshot {
  return {
    coordinator: '总Agent',
    phase: 'synthesis',
    summary,
    tasks: [
      {
        taskId: 'fallback_overall',
        roleId: 'chief_coordinator',
        roleName: '总Agent',
        objective: '兼容模式下汇总当前会诊结果',
        status: 'running',
        progress: 80,
      },
    ],
    graph: {
      nodes: [
        {
          id: 'fallback_input',
          label: '输入',
          kind: 'input',
          detail: '后端流式接口不可用，使用兼容模式',
        },
        {
          id: 'fallback_output',
          label: '结论',
          kind: 'output',
          detail: summary,
        },
      ],
      edges: [
        {
          source: 'fallback_input',
          target: 'fallback_output',
          label: '降级处理',
        },
      ],
    },
    generatedAt: nowIso(),
    source: 'rule',
  };
}

function emitFallbackEvents(
  payload: TriageApiResponse,
  onEvent: (event: TriageStreamEvent) => void,
): void {
  const fallbackSummary = '后端未启用流式接口，已自动切换兼容模式。';
  onEvent({
    type: 'stage_update',
    timestamp: nowIso(),
    stage: 'START',
    status: 'running',
    message: fallbackSummary,
  });
  onEvent({
    type: 'orchestration_snapshot',
    timestamp: nowIso(),
    snapshot: buildFallbackSnapshot(fallbackSummary),
  });

  if (isErrorResponse(payload)) {
    onEvent({
      type: 'clarification_request',
      timestamp: nowIso(),
      question: `请补充以下信息后继续会诊：${
        (payload.requiredFields ?? []).join('、') || '必填项'
      }。`,
      requiredFields: payload.requiredFields ?? [],
      nextAction: payload.nextAction,
    });
    onEvent({
      type: 'error',
      timestamp: nowIso(),
      errorCode: payload.errorCode,
      message: payload.notes.join('；') || '请求失败',
      requiredFields: payload.requiredFields,
      nextAction: payload.nextAction,
    });
    onEvent({
      type: 'final_result',
      timestamp: nowIso(),
      result: payload,
    });
    return;
  }

  const workflowTrace = Array.isArray(payload.workflowTrace)
    ? payload.workflowTrace
    : [];
  for (const stage of workflowTrace) {
    onEvent({
      type: 'stage_update',
      timestamp: nowIso(),
      stage: stage.stage,
      status: stage.status,
      message: stage.detail,
    });
  }

  const reasons = payload.routing?.reasons ?? [];
  for (const reason of reasons) {
    onEvent({
      type: 'reasoning_step',
      timestamp: nowIso(),
      message: reason,
    });
  }

  const summary = buildFallbackSummary(payload);
  for (const token of summary) {
    onEvent({
      type: 'token',
      timestamp: nowIso(),
      token,
    });
  }

  onEvent({
    type: 'final_result',
    timestamp: nowIso(),
    result: payload,
  });
}

function emitStreamEvent(
  line: string,
  onEvent: (event: TriageStreamEvent) => void,
): boolean {
  const event = JSON.parse(line) as TriageStreamEvent;
  onEvent(event);
  return event.type === 'final_result';
}

export async function orchestrateTriageStream(
  payload: TriageRequest,
  options: StreamOptions,
): Promise<void> {
  let lastError: unknown;

  for (const baseUrl of getBaseCandidates()) {
    try {
      const response = await fetch(`${baseUrl}/orchestrate_triage/stream`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: options.signal,
      });

      if (response.status === 404) {
        try {
          const fallbackPayload = await postToBase<TriageApiResponse>(
            baseUrl,
            '/orchestrate_triage',
            payload,
          );
          markPreferredBase(baseUrl);
          emitFallbackEvents(fallbackPayload, options.onEvent);
          return;
        } catch (fallbackError) {
          lastError = fallbackError;
          if (shouldTryNextBase(fallbackError)) {
            continue;
          }
          throw fallbackError;
        }
      }

      if (!response.ok || !response.body) {
        throw new Error(`stream request failed: ${response.status}`);
      }

      markPreferredBase(baseUrl);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let hasFinalResult = false;

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }

        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const text = line.trim();
          if (!text) {
            continue;
          }
          if (emitStreamEvent(text, options.onEvent)) {
            hasFinalResult = true;
          }
        }
      }

      buffer += decoder.decode();

      if (buffer.trim()) {
        if (emitStreamEvent(buffer.trim(), options.onEvent)) {
          hasFinalResult = true;
        }
      }

      if (!hasFinalResult) {
        const fallbackPayload = await postToBase<TriageApiResponse>(
          baseUrl,
          '/orchestrate_triage',
          payload,
        );
        emitFallbackEvents(fallbackPayload, options.onEvent);
      }
      return;
    } catch (error) {
      lastError = error;
      if (!shouldTryNextBase(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('stream request failed');
}
