import { Request, Response, Router } from 'express';
import {
  DebateResult,
  ErrorCode,
  OrchestrationSnapshot,
  RuleGovernanceSnapshot,
  TriageApiResponse,
  TriageErrorResponse,
  TriageRequest,
  TriageStreamEvent,
  TriageStreamStageStatus,
  WorkflowStage,
} from '@copilot-care/shared/types';
import { RequestValidationError } from '../../application/errors/RequestValidationError';
import { AuthoritativeMedicalSearchPort } from '../../application/ports/AuthoritativeMedicalSearchPort';
import { resolveNextAction } from '../../application/services/FlowControlNextActionService';
import { buildValidationErrorGovernanceSnapshot } from '../../application/services/RuleGovernanceService';
import { RunTriageSessionUseCase } from '../../application/usecases/RunTriageSessionUseCase';
import { listAuthoritativeMedicalSources } from '../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';
import {
  AUTHORITATIVE_GUIDELINE_REFERENCES,
  AUTHORITATIVE_RULE_CATALOG_VERSION,
  LAYERED_RULE_DESCRIPTORS,
  RED_FLAG_SYNONYM_SET_VERSION,
} from '../../domain/rules/AuthoritativeMedicalRuleCatalog';
import {
  CoordinatorSnapshotContext,
  CoordinatorSnapshotService,
} from '../../infrastructure/orchestration/CoordinatorSnapshotService';
import { GovernanceRuntimeTelemetry } from '../../infrastructure/governance/GovernanceRuntimeTelemetry';

interface RuntimeArchitectureView {
  experts: Record<
    string,
    {
      provider: string;
      source: string;
      llmEnabled: boolean;
      envKey: string;
    }
  >;
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

interface SnapshotStageState {
  status: TriageStreamStageStatus;
  message: string;
}

type SnapshotStageRuntime = Record<WorkflowStage, SnapshotStageState>;

const MODEL_SNAPSHOT_MIN_INTERVAL_MS = 8000;
const MODEL_SNAPSHOT_TICK_MS = 10000;

function buildErrorResponse(
  errorCode: ErrorCode,
  message: string,
  options?: {
    requiredFields?: string[];
    nextAction?: string;
    auditRef?: string;
    ruleGovernance?: RuleGovernanceSnapshot;
  },
): TriageErrorResponse {
  const nextAction =
    options?.nextAction
    ?? resolveNextAction({
      errorCode,
      requiredFields: options?.requiredFields,
    });
  return {
    status: 'ERROR',
    errorCode,
    notes: [message],
    requiredFields: options?.requiredFields,
    nextAction,
    auditRef: options?.auditRef,
    ruleGovernance: options?.ruleGovernance,
  };
}

function toApiResponse(result: DebateResult): TriageApiResponse {
  if (result.status === 'ERROR') {
    return buildErrorResponse(
      result.errorCode ?? 'ERR_MISSING_REQUIRED_DATA',
      result.notes.join('；') || 'Request validation failed.',
      {
        requiredFields: result.requiredFields,
        nextAction: result.nextAction,
        auditRef: result.auditRef,
        ruleGovernance: result.ruleGovernance,
      },
    );
  }
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseSourceIdList(value: unknown): string[] {
  const rawValues: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s|]+/)
      : [];
  const normalized = rawValues
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length > 0);
  return [...new Set(normalized)];
}

function writeStreamEvent(
  response: Response,
  event: TriageStreamEvent,
): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  response.write(`${JSON.stringify(event)}\n`);
}

function buildClarificationQuestion(requiredFields: string[]): string {
  if (requiredFields.length === 0) {
    return '请补充缺失信息后继续。';
  }
  return `请补充以下信息后继续会诊：${requiredFields.join('、')}。`;
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

function buildTypewriterSummary(result: DebateResult): string {
  const conclusion = result.explainableReport?.conclusion ?? '';
  const actions = dedupeSummaryLines(result.explainableReport?.actions ?? []);
  const destination = result.triageResult?.destination ?? '';
  const triageLevel = result.triageResult?.triageLevel ?? '';
  const normalizedConclusion = normalizeSummaryTextForCompare(conclusion);
  const triageLine = triageLevel || destination
    ? `分诊：${triageLevel || '-'} / 去向：${destination || '-'}`
    : '';
  const shouldAddTriageLine = triageLine
    && !normalizedConclusion.includes(normalizeSummaryTextForCompare(triageLine));
  const actionLine = actions.length > 0 ? `建议：${actions.join('；')}` : '';
  const shouldAddActionLine = actionLine
    && !normalizedConclusion.includes(normalizeSummaryTextForCompare(actionLine));
  const sections = dedupeSummaryLines([
    conclusion ? `结论：${conclusion}` : '',
    shouldAddTriageLine ? triageLine : '',
    shouldAddActionLine ? actionLine : '',
  ]);

  return collapseRepeatedSummaryBlocks(sections.join('\n'));
}

function createInitialSnapshotStageRuntime(): SnapshotStageRuntime {
  return {
    START: { status: 'pending', message: '等待启动' },
    INFO_GATHER: { status: 'pending', message: '等待信息采集' },
    RISK_ASSESS: { status: 'pending', message: '等待风险评估' },
    ROUTING: { status: 'pending', message: '等待复杂度分流' },
    DEBATE: { status: 'pending', message: '等待协同会诊' },
    CONSENSUS: { status: 'pending', message: '等待共识收敛' },
    REVIEW: { status: 'pending', message: '等待安全复核' },
    OUTPUT: { status: 'pending', message: '等待输出结论' },
    ESCALATION: { status: 'pending', message: '按需触发线下上转' },
  };
}

function resolveSnapshotPhase(
  stageRuntime: SnapshotStageRuntime,
  finalized: boolean,
): OrchestrationSnapshot['phase'] {
  if (finalized || stageRuntime.OUTPUT.status === 'done') {
    return 'complete';
  }
  if (
    stageRuntime.REVIEW.status === 'running' ||
    stageRuntime.REVIEW.status === 'done' ||
    stageRuntime.OUTPUT.status === 'running'
  ) {
    return 'synthesis';
  }
  if (
    stageRuntime.DEBATE.status === 'running' ||
    stageRuntime.CONSENSUS.status === 'running'
  ) {
    return 'execution';
  }
  if (
    stageRuntime.RISK_ASSESS.status !== 'pending' ||
    stageRuntime.ROUTING.status !== 'pending'
  ) {
    return 'analysis';
  }
  return 'assignment';
}

function parseRequestBody(body: unknown): TriageRequest {
  if (!body || typeof body !== 'object') {
    throw new RequestValidationError(
      'ERR_MISSING_REQUIRED_DATA',
      'Request body must include profile.',
    );
  }

  const candidate = body as Partial<TriageRequest>;
  if (!candidate.profile) {
    throw new RequestValidationError(
      'ERR_MISSING_REQUIRED_DATA',
      'Request body must include profile.',
    );
  }

  return {
    requestId:
      typeof candidate.requestId === 'string'
        ? candidate.requestId
        : undefined,
    profile: candidate.profile,
    signals: Array.isArray(candidate.signals) ? candidate.signals : undefined,
    symptomText:
      typeof candidate.symptomText === 'string'
        ? candidate.symptomText
        : undefined,
    contextVersion:
      typeof candidate.contextVersion === 'string'
        ? candidate.contextVersion
        : undefined,
    consentToken:
      typeof candidate.consentToken === 'string'
        ? candidate.consentToken
        : undefined,
    sessionId:
      typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
  };
}

function toRuntimeStageStatus(
  status: 'done' | 'failed' | 'skipped',
): TriageStreamStageStatus {
  if (status === 'done') {
    return 'done';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'skipped';
}

export function createTriageRouter(
  useCase: RunTriageSessionUseCase,
  architecture?: RuntimeArchitectureView,
  coordinatorSnapshotService?: CoordinatorSnapshotService,
  governanceRuntimeTelemetry?: GovernanceRuntimeTelemetry,
  authoritativeMedicalSearch?: AuthoritativeMedicalSearchPort,
): Router {
  const router = Router();

  router.get('/health', (_request: Request, response: Response) => {
    response.status(200).json({ status: 'ok' });
  });

  router.get('/architecture/experts', (_request: Request, response: Response) => {
    response.status(200).json(
      architecture ?? {
        experts: {},
      },
    );
  });

  router.get('/governance/runtime', (_request: Request, response: Response) => {
    response.status(200).json(
      governanceRuntimeTelemetry?.getSnapshot() ?? {
        generatedAt: nowIso(),
        source: 'runtime',
        governanceContext: {
          catalogVersion: AUTHORITATIVE_RULE_CATALOG_VERSION,
          guidelineReferenceCount: AUTHORITATIVE_GUIDELINE_REFERENCES.length,
          evidenceGateCommands: ['npm run gate:metrics', 'npm run gate:all'],
        },
        queueOverview: {
          pending: 0,
          reviewing: 0,
          approved: 0,
          rejected: 0,
        },
        performance: {
          latencyHeat: 0,
          retryPressure: 0,
          consensusConvergence: 100,
          dissentSpread: 0,
          routingComplexity: 0,
        },
        totals: {
          totalSessions: 0,
          successSessions: 0,
          escalatedSessions: 0,
          errorSessions: 0,
          activeSessions: 0,
        },
        recentSessions: [],
        stageRuntime: {
          START: {
            status: 'pending',
            message: 'START waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          INFO_GATHER: {
            status: 'pending',
            message: 'INFO_GATHER waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          RISK_ASSESS: {
            status: 'pending',
            message: 'RISK_ASSESS waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          ROUTING: {
            status: 'pending',
            message: 'ROUTING waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          DEBATE: {
            status: 'pending',
            message: 'DEBATE waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          CONSENSUS: {
            status: 'pending',
            message: 'CONSENSUS waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          REVIEW: {
            status: 'pending',
            message: 'REVIEW waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          OUTPUT: {
            status: 'pending',
            message: 'OUTPUT waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
          ESCALATION: {
            status: 'pending',
            message: 'ESCALATION waiting',
            active: 0,
            transitions: 0,
            updatedAt: nowIso(),
          },
        },
        currentStage: 'START',
      },
    );
  });

  router.get('/governance/rules/catalog', (_request: Request, response: Response) => {
    response.status(200).json({
      catalogVersion: AUTHORITATIVE_RULE_CATALOG_VERSION,
      synonymSetVersion: RED_FLAG_SYNONYM_SET_VERSION,
      layers: LAYERED_RULE_DESCRIPTORS,
      guidelineReferences: AUTHORITATIVE_GUIDELINE_REFERENCES,
      generatedAt: nowIso(),
    });
  });

  router.get('/governance/rules/version', (_request: Request, response: Response) => {
    response.status(200).json({
      catalogVersion: AUTHORITATIVE_RULE_CATALOG_VERSION,
      synonymSetVersion: RED_FLAG_SYNONYM_SET_VERSION,
      guidelineCount: AUTHORITATIVE_GUIDELINE_REFERENCES.length,
      generatedAt: nowIso(),
    });
  });

  router.get('/governance/medical-sources', (_request: Request, response: Response) => {
    const sources =
      authoritativeMedicalSearch?.getSources() ?? listAuthoritativeMedicalSources();
    response.status(200).json({
      enabled: authoritativeMedicalSearch?.isEnabled() ?? false,
      strictWhitelist: true,
      sources,
      generatedAt: nowIso(),
    });
  });

  router.get('/governance/medical-search/runtime', (_request: Request, response: Response) => {
    const runtime = authoritativeMedicalSearch?.getRuntimeStats?.();
    response.status(200).json({
      enabled: authoritativeMedicalSearch?.isEnabled() ?? false,
      strictWhitelist: true,
      runtime:
        runtime ?? {
          generatedAt: nowIso(),
          searches: 0,
          cacheHits: 0,
          cacheMisses: 0,
          fallbackAppliedCount: 0,
          providerStats: [],
        },
      generatedAt: nowIso(),
    });
  });

  router.post('/governance/medical-search', async (request: Request, response: Response) => {
    const body = request.body as {
      query?: unknown;
      limit?: unknown;
      sourceFilter?: unknown;
      requiredSources?: unknown;
    } | null;
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    const rawLimit =
      typeof body?.limit === 'number'
        ? body.limit
        : Number(body?.limit ?? Number.NaN);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(20, Math.max(1, Math.floor(rawLimit)))
      : 8;
    const sourceFilter = parseSourceIdList(body?.sourceFilter);
    const requiredSources = parseSourceIdList(body?.requiredSources);
    const availableSources =
      authoritativeMedicalSearch?.getSources() ?? listAuthoritativeMedicalSources();
    const availableSourceIds = new Set(availableSources.map((item) => item.id));
    const invalidSourceFilter = sourceFilter.filter(
      (sourceId) => !availableSourceIds.has(sourceId),
    );
    const invalidRequiredSources = requiredSources.filter(
      (sourceId) => !availableSourceIds.has(sourceId),
    );

    if (invalidSourceFilter.length > 0 || invalidRequiredSources.length > 0) {
      response.status(400).json({
        error: 'invalid_sources',
        message: 'sourceFilter/requiredSources contains unknown source ids',
        invalidSourceFilter,
        invalidRequiredSources,
        availableSources: availableSources.map((item) => item.id),
      });
      return;
    }

    if (sourceFilter.length > 0) {
      const missingRequiredSources = requiredSources.filter(
        (sourceId) => !sourceFilter.includes(sourceId),
      );
      if (missingRequiredSources.length > 0) {
        response.status(400).json({
          error: 'invalid_source_constraints',
          message: 'requiredSources must be a subset of sourceFilter',
          missingRequiredSources,
        });
        return;
      }
    }

    if (query.length < 2) {
      response.status(400).json({
        error: 'invalid_query',
        message: 'query must contain at least 2 characters',
      });
      return;
    }

    if (!authoritativeMedicalSearch || !authoritativeMedicalSearch.isEnabled()) {
      response.status(503).json({
        error: 'medical_search_disabled',
        message: 'authoritative medical search is disabled',
        strictWhitelist: true,
        sources:
          authoritativeMedicalSearch?.getSources() ?? listAuthoritativeMedicalSources(),
      });
      return;
    }

    try {
      const result = await authoritativeMedicalSearch.search({
        query,
        limit,
        sourceFilter: sourceFilter.length > 0 ? sourceFilter : undefined,
        requiredSources: requiredSources.length > 0 ? requiredSources : undefined,
      });
      response.status(200).json({
        ...result,
        policy: {
          strictWhitelist: true,
          allowedSources: authoritativeMedicalSearch.getSources(),
          sourceFilter,
          requiredSources,
        },
      });
    } catch {
      response.status(502).json({
        error: 'medical_search_unavailable',
        message: 'authoritative medical search failed',
      });
    }
  });

  router.post(
    '/orchestrate_triage',
    async (request: Request, response: Response<TriageApiResponse>) => {
      let telemetryTrackingId: string | null = null;
      try {
        const input = parseRequestBody(request.body);
        telemetryTrackingId =
          governanceRuntimeTelemetry?.startSession(input) ?? null;
        const result = await useCase.execute(input);
        const payload = toApiResponse(result);

        if (telemetryTrackingId && governanceRuntimeTelemetry) {
          for (const trace of result.workflowTrace ?? []) {
            governanceRuntimeTelemetry.recordStageTransition(
              telemetryTrackingId,
              trace.stage,
              toRuntimeStageStatus(trace.status),
              trace.detail,
            );
          }
          governanceRuntimeTelemetry.completeSession(
            telemetryTrackingId,
            payload,
            Date.now(),
          );
          telemetryTrackingId = null;
        }

        if (payload.status === 'ERROR') {
          response.status(400).json(payload);
          return;
        }

        response.status(200).json(payload);
      } catch (error) {
        if (telemetryTrackingId && governanceRuntimeTelemetry) {
          const telemetryErrorCode =
            error instanceof RequestValidationError
              ? error.errorCode
              : 'ERR_CONFLICT_UNRESOLVED';
          governanceRuntimeTelemetry.failSession(
            telemetryTrackingId,
            telemetryErrorCode,
            Date.now(),
          );
          telemetryTrackingId = null;
        }

        if (error instanceof RequestValidationError) {
          const fallbackSessionId = `validation-${Date.now()}`;
          const auditRef = `audit_${fallbackSessionId}`;
          response
            .status(400)
            .json(
              buildErrorResponse(error.errorCode, error.message, {
                requiredFields: ['profile'],
                auditRef,
                ruleGovernance: buildValidationErrorGovernanceSnapshot({
                  sessionId: fallbackSessionId,
                  auditRef,
                  errorCode: error.errorCode,
                }),
              }),
            );
          return;
        }

        const fallbackSessionId = `runtime-${Date.now()}`;
        const auditRef = `audit_${fallbackSessionId}`;
        response.status(500).json(
          buildErrorResponse(
            'ERR_CONFLICT_UNRESOLVED',
            'Unexpected runtime error. See backend logs.',
            {
              auditRef,
              ruleGovernance: buildValidationErrorGovernanceSnapshot({
                sessionId: fallbackSessionId,
                auditRef,
                errorCode: 'ERR_CONFLICT_UNRESOLVED',
              }),
            },
          ),
        );
      }
    },
  );

  router.post(
    '/orchestrate_triage/stream',
    async (request: Request, response: Response) => {
      response.status(200);
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();

      const streamStartedAt = Date.now();
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let modelSnapshotTimer: ReturnType<typeof setInterval> | null = null;
      const emittedStageEvents = new Set<string>();
      const emittedReasoningMessages = new Set<string>();
      const stageLabels: Record<WorkflowStage, string> = {
        START: '启动',
        INFO_GATHER: '信息采集',
        RISK_ASSESS: '风险评估',
        ROUTING: '复杂度分流',
        DEBATE: '协同会诊',
        CONSENSUS: '共识收敛',
        REVIEW: '安全复核',
        OUTPUT: '输出结论',
        ESCALATION: '线下上转',
      };
      let activeStage: WorkflowStage = 'INFO_GATHER';
      let inputForSnapshot: TriageRequest | null = null;
      const stageRuntime = createInitialSnapshotStageRuntime();
      const reasoningHistory: string[] = [];
      let latestRouteInfo: DebateResult['routing'];
      let latestFinalStatus = '';
      let lastSnapshotEmitAt = 0;
      let lastModelSnapshotAt = 0;
      let modelSnapshotInFlight = false;
      let snapshotRuntimeRevision = 0;
      let telemetryTrackingId: string | null = null;
      let telemetryCompleted = false;

      const completeTelemetry = (payload: TriageApiResponse): void => {
        if (
          !governanceRuntimeTelemetry
          || !telemetryTrackingId
          || telemetryCompleted
        ) {
          return;
        }

        governanceRuntimeTelemetry.completeSession(
          telemetryTrackingId,
          payload,
          Date.now(),
        );
        telemetryCompleted = true;
      };

      const failTelemetry = (errorCode: ErrorCode): void => {
        if (
          !governanceRuntimeTelemetry
          || !telemetryTrackingId
          || telemetryCompleted
        ) {
          return;
        }

        governanceRuntimeTelemetry.failSession(
          telemetryTrackingId,
          errorCode,
          Date.now(),
        );
        telemetryCompleted = true;
      };

      const buildSnapshotContext = (): CoordinatorSnapshotContext | null => {
        if (!inputForSnapshot) {
          return null;
        }
        const mcpInsights = reasoningHistory
          .filter((item) => /MCP/.test(item))
          .slice(-6);
        return {
          profile: inputForSnapshot.profile,
          symptomText:
            inputForSnapshot.symptomText || inputForSnapshot.profile.chiefComplaint,
          stageRuntime,
          reasoning: reasoningHistory.slice(-60),
          routeInfo: latestRouteInfo,
          finalStatus: latestFinalStatus || undefined,
          mcpInsights,
        };
      };

      const writeSnapshot = (snapshot: OrchestrationSnapshot): void => {
        writeStreamEvent(response, {
          type: 'orchestration_snapshot',
          timestamp: nowIso(),
          snapshot,
        });
      };

      const emitRuleSnapshot = (
        finalized: boolean,
        force: boolean = false,
      ): void => {
        if (!coordinatorSnapshotService) {
          return;
        }
        if (!force && Date.now() - lastSnapshotEmitAt < 500) {
          return;
        }
        const context = buildSnapshotContext();
        if (!context) {
          return;
        }
        const phase = resolveSnapshotPhase(stageRuntime, finalized);
        const snapshot = coordinatorSnapshotService.createRuleSnapshot(
          context,
          phase,
        );
        writeSnapshot(snapshot);
        lastSnapshotEmitAt = Date.now();
      };

      const maybeEmitModelSnapshot = async (
        finalized: boolean,
        force: boolean = false,
      ): Promise<void> => {
        if (!coordinatorSnapshotService) {
          return;
        }
        if (modelSnapshotInFlight) {
          if (force) {
            emitRuleSnapshot(finalized, true);
          }
          return;
        }
        const now = Date.now();
        if (!force && now - lastModelSnapshotAt < MODEL_SNAPSHOT_MIN_INTERVAL_MS) {
          return;
        }
        const context = buildSnapshotContext();
        if (!context) {
          return;
        }
        const snapshotRevisionAtStart = snapshotRuntimeRevision;
        modelSnapshotInFlight = true;
        try {
          const phase = resolveSnapshotPhase(stageRuntime, finalized);
          const snapshot = await coordinatorSnapshotService.createModelSnapshot(
            context,
            phase,
          );
          if (!force && snapshotRevisionAtStart !== snapshotRuntimeRevision) {
            return;
          }
          if (snapshot) {
            writeSnapshot(snapshot);
            lastSnapshotEmitAt = Date.now();
            lastModelSnapshotAt = Date.now();
            return;
          }
          emitRuleSnapshot(finalized, true);
        } finally {
          modelSnapshotInFlight = false;
        }
      };

      const emitStageUpdate = (
        stage: WorkflowStage,
        status: TriageStreamStageStatus,
        message: string,
      ): void => {
        const key = `${String(stage)}|${String(status)}|${message}`;
        if (emittedStageEvents.has(key)) {
          return;
        }
        emittedStageEvents.add(key);
        stageRuntime[stage] = {
          status,
          message,
        };
        if (governanceRuntimeTelemetry && telemetryTrackingId) {
          governanceRuntimeTelemetry.recordStageTransition(
            telemetryTrackingId,
            stage,
            status,
            message,
          );
        }
        snapshotRuntimeRevision += 1;
        if (status === 'running') {
          activeStage = stage;
        }
        writeStreamEvent(response, {
          type: 'stage_update',
          timestamp: nowIso(),
          stage,
          status,
          message,
        });
        emitRuleSnapshot(false);
        if (
          status !== 'pending' &&
          ['RISK_ASSESS', 'ROUTING', 'DEBATE', 'CONSENSUS', 'REVIEW', 'OUTPUT'].includes(stage)
        ) {
          void maybeEmitModelSnapshot(false);
        }
      };

      const emitReasoningStep = (message: string): void => {
        if (!message.trim()) {
          return;
        }
        if (emittedReasoningMessages.has(message)) {
          return;
        }
        emittedReasoningMessages.add(message);
        reasoningHistory.push(message);
        if (reasoningHistory.length > 160) {
          reasoningHistory.shift();
        }
        writeStreamEvent(response, {
          type: 'reasoning_step',
          timestamp: nowIso(),
          message,
        });
      };

      try {
        const input = parseRequestBody(request.body);
        inputForSnapshot = input;
        telemetryTrackingId =
          governanceRuntimeTelemetry?.startSession(input) ?? null;

        emitStageUpdate('START', 'running', '会诊流程启动');
        emitStageUpdate('INFO_GATHER', 'running', '正在校验授权并收集最小信息集');
        emitReasoningStep('总Agent：已完成任务拆分，信息采集子任务开始执行。');
        emitStageUpdate('RISK_ASSESS', 'pending', '等待信息采集完成后执行风险评估');
        emitStageUpdate('ROUTING', 'pending', '等待风险评估结果后执行复杂度分流');
        emitStageUpdate('DEBATE', 'pending', '等待分流完成后启动专家协同');
        emitStageUpdate('CONSENSUS', 'pending', '等待专家协同后进入共识收敛');
        emitStageUpdate('REVIEW', 'pending', '等待共识形成后执行安全复核');
        emitStageUpdate('OUTPUT', 'pending', '等待复核通过后输出可解释建议');
        emitStageUpdate('ESCALATION', 'pending', '命中红旗时触发线下上转');
        emitRuleSnapshot(false, true);

        heartbeatTimer = setInterval(() => {
          if (response.writableEnded || response.destroyed) {
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
            return;
          }
          const elapsedSec = Math.max(
            1,
            Math.floor((Date.now() - streamStartedAt) / 1000),
          );
          writeStreamEvent(response, {
            type: 'heartbeat',
            timestamp: nowIso(),
            message: `会诊进行中（${elapsedSec}s）：${stageLabels[activeStage]}`,
          });
        }, 1200);

        modelSnapshotTimer = setInterval(() => {
          if (response.writableEnded || response.destroyed) {
            if (modelSnapshotTimer) {
              clearInterval(modelSnapshotTimer);
              modelSnapshotTimer = null;
            }
            return;
          }
          void maybeEmitModelSnapshot(false);
        }, MODEL_SNAPSHOT_TICK_MS);

        const result = await useCase.execute(input, {
          onWorkflowStage: (stage) => {
            emitStageUpdate(stage.stage, stage.status, stage.detail);
          },
          onReasoningStep: (message) => {
            emitReasoningStep(message);
          },
        });
        latestRouteInfo = result.routing;
        latestFinalStatus = result.status;
        const payload = toApiResponse(result);

        if (Array.isArray(result.workflowTrace)) {
          for (const trace of result.workflowTrace) {
            emitStageUpdate(trace.stage, trace.status, trace.detail);
          }
        }

        if (result.routing?.reasons?.length) {
          for (const reason of result.routing.reasons) {
            emitReasoningStep(reason);
          }
        }

        if (result.rounds.length > 0) {
          for (const round of result.rounds) {
            emitReasoningStep(
              `第${round.roundNumber}轮：分歧指数=${round.dissentIndex.toFixed(3)}，分歧带=${round.dissentBand}`,
            );
          }
        }

        if (payload.status === 'ERROR') {
          if (stageRuntime.REVIEW.status === 'pending') {
            emitStageUpdate('REVIEW', 'blocked', '流程提前终止，未进入安全复核');
          }
          if (stageRuntime.OUTPUT.status === 'pending') {
            emitStageUpdate('OUTPUT', 'failed', '流程提前终止，未生成输出结论');
          }
          await maybeEmitModelSnapshot(true, true);
          writeStreamEvent(response, {
            type: 'clarification_request',
            timestamp: nowIso(),
            requiredFields: payload.requiredFields ?? [],
            question: buildClarificationQuestion(payload.requiredFields ?? []),
            nextAction:
              payload.nextAction
              ?? resolveNextAction({
                errorCode: payload.errorCode,
                requiredFields: payload.requiredFields,
              }),
          });
          writeStreamEvent(response, {
            type: 'error',
            timestamp: nowIso(),
            errorCode: payload.errorCode ?? 'ERR_MISSING_REQUIRED_DATA',
            message: payload.notes.join('；') || '请求失败',
            requiredFields: payload.requiredFields,
            nextAction:
              payload.nextAction
              ?? resolveNextAction({
                errorCode: payload.errorCode,
                requiredFields: payload.requiredFields,
              }),
          });
          writeStreamEvent(response, {
            type: 'final_result',
            timestamp: nowIso(),
            result: payload,
          });
          completeTelemetry(payload);
          response.end();
          return;
        }

        await maybeEmitModelSnapshot(true, true);
        const summaryText = buildTypewriterSummary(result);
        for (const token of summaryText) {
          writeStreamEvent(response, {
            type: 'token',
            timestamp: nowIso(),
            token,
          });
        }

        writeStreamEvent(response, {
          type: 'final_result',
          timestamp: nowIso(),
          result: payload,
        });
        completeTelemetry(payload);
        response.end();
      } catch (error) {
        const validationError =
          error instanceof RequestValidationError ? error : undefined;
        const fallbackSessionId =
          inputForSnapshot?.requestId
          || inputForSnapshot?.sessionId
          || `stream-runtime-${Date.now()}`;
        const auditRef = `audit_${fallbackSessionId}`;
        const errorPayload = buildErrorResponse(
          validationError?.errorCode ?? 'ERR_CONFLICT_UNRESOLVED',
          validationError?.message ?? 'Unexpected runtime error. See backend logs.',
          {
            requiredFields: validationError ? ['profile'] : undefined,
            auditRef,
            ruleGovernance: buildValidationErrorGovernanceSnapshot({
              sessionId: fallbackSessionId,
              auditRef,
              errorCode:
                validationError?.errorCode ?? 'ERR_CONFLICT_UNRESOLVED',
            }),
          },
        );
        latestFinalStatus = 'ERROR';
        if (stageRuntime.REVIEW.status === 'pending') {
          emitStageUpdate('REVIEW', 'blocked', '流程异常终止，未进入安全复核');
        }
        if (stageRuntime.OUTPUT.status === 'pending') {
          emitStageUpdate('OUTPUT', 'failed', '流程异常终止，未生成输出结论');
        }
        emitRuleSnapshot(true, true);
        writeStreamEvent(response, {
          type: 'error',
          timestamp: nowIso(),
          errorCode: errorPayload.errorCode,
          message: errorPayload.notes.join('；'),
          requiredFields: errorPayload.requiredFields,
          nextAction: errorPayload.nextAction,
        });
        writeStreamEvent(response, {
          type: 'final_result',
          timestamp: nowIso(),
          result: errorPayload,
        });
        failTelemetry(errorPayload.errorCode);
        response.end();
      } finally {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (modelSnapshotTimer) {
          clearInterval(modelSnapshotTimer);
          modelSnapshotTimer = null;
        }
      }
    },
  );

  return router;
}


