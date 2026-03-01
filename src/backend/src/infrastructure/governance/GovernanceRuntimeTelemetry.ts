import {
  DebateResult,
  ErrorCode,
  TriageApiResponse,
  TriageRequest,
  TriageRouteMode,
  TriageStatus,
  TriageStreamStageStatus,
  WorkflowStage,
} from '@copilot-care/shared/types';
import {
  AUTHORITATIVE_GUIDELINE_REFERENCES,
  AUTHORITATIVE_RULE_CATALOG_VERSION,
} from '../../domain/rules/AuthoritativeMedicalRuleCatalog';

const ORDERED_STAGES: WorkflowStage[] = [
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

type SessionOutcome = TriageStatus | 'ERROR' | 'RUNNING';
type StageTransitionCounters = Record<TriageStreamStageStatus, number>;

interface StageTransitionRuntimeState {
  status: TriageStreamStageStatus;
  message: string;
  updatedAt: string;
  updatedAtMs: number;
}

interface ActiveSessionState {
  id: string;
  requestId?: string;
  sessionId?: string;
  patientId: string;
  startedAt: string;
  startedAtMs: number;
  transitions: number;
  repeatedTransitions: number;
  stageFailures: number;
  stageBlocked: number;
  touchedStages: Set<WorkflowStage>;
  seenTransitions: Set<string>;
  stageRuntime: Partial<Record<WorkflowStage, StageTransitionRuntimeState>>;
}

export interface GovernanceRuntimeSessionSummary {
  id: string;
  requestId?: string;
  patientId: string;
  outcome: SessionOutcome;
  routeMode?: TriageRouteMode;
  triageLevel?: string;
  destination?: string;
  complexityScore?: number;
  durationMs?: number;
  startedAt: string;
  endedAt?: string;
  errorCode?: ErrorCode;
}

export interface GovernanceRuntimeStageState {
  status: TriageStreamStageStatus;
  message: string;
  active: number;
  transitions: number;
  updatedAt: string;
}

export interface GovernanceRuntimeSnapshot {
  generatedAt: string;
  source: 'runtime';
  governanceContext: {
    catalogVersion: string;
    guidelineReferenceCount: number;
    evidenceGateCommands: string[];
  };
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
  recentSessions: GovernanceRuntimeSessionSummary[];
  stageRuntime: Record<WorkflowStage, GovernanceRuntimeStageState>;
  currentStage: WorkflowStage;
}

interface CompletedSessionStats {
  durationMs: number;
  repeatedTransitions: number;
  stageFailures: number;
  stageBlocked: number;
  complexityScore?: number;
}

function clampMetric(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function createEmptyStageCounters(): StageTransitionCounters {
  return {
    pending: 0,
    running: 0,
    blocked: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  };
}

function createStageCounters(): Record<WorkflowStage, StageTransitionCounters> {
  return {
    START: createEmptyStageCounters(),
    INFO_GATHER: createEmptyStageCounters(),
    RISK_ASSESS: createEmptyStageCounters(),
    ROUTING: createEmptyStageCounters(),
    DEBATE: createEmptyStageCounters(),
    CONSENSUS: createEmptyStageCounters(),
    REVIEW: createEmptyStageCounters(),
    OUTPUT: createEmptyStageCounters(),
    ESCALATION: createEmptyStageCounters(),
  };
}

function defaultStageMessage(
  stage: WorkflowStage,
  status: TriageStreamStageStatus,
): string {
  if (status === 'pending') {
    return `${stage} waiting`;
  }
  if (status === 'running') {
    return `${stage} running`;
  }
  if (status === 'done') {
    return `${stage} completed`;
  }
  if (status === 'blocked') {
    return `${stage} blocked`;
  }
  if (status === 'failed') {
    return `${stage} failed`;
  }
  return `${stage} skipped`;
}

function createEmptyStageRuntime(
  generatedAt: string,
): Record<WorkflowStage, GovernanceRuntimeStageState> {
  return {
    START: {
      status: 'pending',
      message: defaultStageMessage('START', 'pending'),
      active: 0,
      transitions: 0,
      updatedAt: generatedAt,
    },
    INFO_GATHER: {
      status: 'pending',
      message: defaultStageMessage('INFO_GATHER', 'pending'),
      active: 0,
      transitions: 0,
      updatedAt: generatedAt,
    },
    RISK_ASSESS: {
      status: 'pending',
      message: defaultStageMessage('RISK_ASSESS', 'pending'),
      active: 0,
      transitions: 0,
      updatedAt: generatedAt,
    },
    ROUTING: {
      status: 'pending',
      message: defaultStageMessage('ROUTING', 'pending'),
      active: 0,
      transitions: 0,
      updatedAt: generatedAt,
    },
    DEBATE: {
      status: 'pending',
      message: defaultStageMessage('DEBATE', 'pending'),
      active: 0,
      transitions: 0,
      updatedAt: generatedAt,
    },
    CONSENSUS: {
      status: 'pending',
      message: defaultStageMessage('CONSENSUS', 'pending'),
      active: 0,
      transitions: 0,
      updatedAt: generatedAt,
    },
    REVIEW: {
      status: 'pending',
      message: defaultStageMessage('REVIEW', 'pending'),
      active: 0,
      transitions: 0,
      updatedAt: generatedAt,
    },
    OUTPUT: {
      status: 'pending',
      message: defaultStageMessage('OUTPUT', 'pending'),
      active: 0,
      transitions: 0,
      updatedAt: generatedAt,
    },
    ESCALATION: {
      status: 'pending',
      message: defaultStageMessage('ESCALATION', 'pending'),
      active: 0,
      transitions: 0,
      updatedAt: generatedAt,
    },
  };
}

function toOutcome(payload: TriageApiResponse): SessionOutcome {
  if (payload.status === 'ERROR') {
    return 'ERROR';
  }
  return payload.status;
}

function mapOutcomeToQueueStatus(
  outcome: SessionOutcome,
): 'pending' | 'reviewing' | 'approved' | 'rejected' {
  if (outcome === 'RUNNING') {
    return 'pending';
  }
  if (outcome === 'ABSTAIN') {
    return 'reviewing';
  }
  if (outcome === 'OUTPUT') {
    return 'approved';
  }
  return 'rejected';
}

function createEmptySnapshot(): GovernanceRuntimeSnapshot {
  const generatedAt = nowIso();
  return {
    generatedAt,
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
    stageRuntime: createEmptyStageRuntime(generatedAt),
    currentStage: 'START',
  };
}

export class GovernanceRuntimeTelemetry {
  private readonly maxRecentSessions: number;
  private readonly activeSessions: Map<string, ActiveSessionState>;
  private readonly recentCompletedSessions: GovernanceRuntimeSessionSummary[];
  private readonly completedStats: CompletedSessionStats[];
  private readonly stageTransitionCounters: Record<
    WorkflowStage,
    StageTransitionCounters
  >;
  private readonly stageLatestRuntime: Partial<
    Record<WorkflowStage, StageTransitionRuntimeState>
  >;
  private totalSessions: number;
  private successSessions: number;
  private escalatedSessions: number;
  private errorSessions: number;

  constructor(maxRecentSessions: number = 80) {
    this.maxRecentSessions = maxRecentSessions;
    this.activeSessions = new Map<string, ActiveSessionState>();
    this.recentCompletedSessions = [];
    this.completedStats = [];
    this.stageTransitionCounters = createStageCounters();
    this.stageLatestRuntime = {};
    this.totalSessions = 0;
    this.successSessions = 0;
    this.escalatedSessions = 0;
    this.errorSessions = 0;
  }

  public startSession(input: TriageRequest): string {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const requestId = input.requestId?.trim() || undefined;
    const sessionId = input.sessionId?.trim() || undefined;
    const id = requestId || sessionId || `runtime-${startedAtMs}-${Math.random().toString(36).slice(2, 8)}`;

    this.activeSessions.set(id, {
      id,
      requestId,
      sessionId,
      patientId: input.profile.patientId,
      startedAt,
      startedAtMs,
      transitions: 0,
      repeatedTransitions: 0,
      stageFailures: 0,
      stageBlocked: 0,
      touchedStages: new Set<WorkflowStage>(),
      seenTransitions: new Set<string>(),
      stageRuntime: {},
    });
    return id;
  }

  public recordStageTransition(
    trackingId: string,
    stage: WorkflowStage,
    status: TriageStreamStageStatus,
    message?: string,
  ): void {
    const normalizedMessage = message?.trim() || defaultStageMessage(stage, status);
    const updatedAtMs = Date.now();
    const updatedAt = new Date(updatedAtMs).toISOString();
    this.stageTransitionCounters[stage][status] += 1;
    this.stageLatestRuntime[stage] = {
      status,
      message: normalizedMessage,
      updatedAt,
      updatedAtMs,
    };

    const active = this.activeSessions.get(trackingId);
    if (!active) {
      return;
    }

    const transitionKey = `${stage}:${status}`;
    if (active.seenTransitions.has(transitionKey)) {
      active.repeatedTransitions += 1;
    } else {
      active.seenTransitions.add(transitionKey);
    }

    active.transitions += 1;
    active.touchedStages.add(stage);
    active.stageRuntime[stage] = {
      status,
      message: normalizedMessage,
      updatedAt,
      updatedAtMs,
    };
    if (status === 'failed') {
      active.stageFailures += 1;
    }
    if (status === 'blocked') {
      active.stageBlocked += 1;
    }
  }

  public completeSession(
    trackingId: string,
    payload: TriageApiResponse,
    endedAtMs: number = Date.now(),
  ): void {
    const active = this.activeSessions.get(trackingId);
    if (!active) {
      return;
    }

    this.activeSessions.delete(trackingId);
    const durationMs = Math.max(1, endedAtMs - active.startedAtMs);
    const endedAt = new Date(endedAtMs).toISOString();
    const outcome = toOutcome(payload);
    const completedSummary: GovernanceRuntimeSessionSummary = {
      id: active.id,
      requestId: active.requestId,
      patientId: active.patientId,
      outcome,
      durationMs,
      startedAt: active.startedAt,
      endedAt,
    };

    if (payload.status !== 'ERROR') {
      completedSummary.routeMode = payload.routing?.routeMode;
      completedSummary.triageLevel = payload.triageResult?.triageLevel;
      completedSummary.destination = payload.triageResult?.destination;
      completedSummary.complexityScore = payload.routing?.complexityScore;
    } else {
      completedSummary.errorCode = payload.errorCode;
    }

    this.totalSessions += 1;
    if (outcome === 'OUTPUT') {
      this.successSessions += 1;
    }
    if (outcome === 'ESCALATE_TO_OFFLINE') {
      this.escalatedSessions += 1;
    }
    if (outcome === 'ERROR') {
      this.errorSessions += 1;
    }

    this.recentCompletedSessions.unshift(completedSummary);
    if (this.recentCompletedSessions.length > this.maxRecentSessions) {
      this.recentCompletedSessions.length = this.maxRecentSessions;
    }

    this.completedStats.unshift({
      durationMs,
      repeatedTransitions: active.repeatedTransitions,
      stageFailures: active.stageFailures,
      stageBlocked: active.stageBlocked,
      complexityScore:
        payload.status === 'ERROR' ? undefined : payload.routing?.complexityScore,
    });
    if (this.completedStats.length > this.maxRecentSessions) {
      this.completedStats.length = this.maxRecentSessions;
    }
  }

  public failSession(
    trackingId: string,
    errorCode: ErrorCode,
    endedAtMs: number = Date.now(),
  ): void {
    this.completeSession(
      trackingId,
      {
        status: 'ERROR',
        errorCode,
        notes: ['runtime failure'],
      },
      endedAtMs,
    );
  }

  private countActiveStageTransitions(
    stage: WorkflowStage,
    status: TriageStreamStageStatus,
  ): number {
    let count = 0;
    for (const active of this.activeSessions.values()) {
      const stageRuntime = active.stageRuntime[stage];
      if (stageRuntime?.status === status) {
        count += 1;
      }
    }
    return count;
  }

  private buildStageRuntime(
    generatedAt: string,
  ): Record<WorkflowStage, GovernanceRuntimeStageState> {
    const stageRuntime = createEmptyStageRuntime(generatedAt);

    for (const stage of ORDERED_STAGES) {
      const counters = this.stageTransitionCounters[stage];
      const transitions = Object.values(counters).reduce((sum, value) => {
        return sum + value;
      }, 0);
      const active = this.countActiveStageTransitions(stage, 'running');
      const latest = this.stageLatestRuntime[stage];
      let status: TriageStreamStageStatus = 'pending';
      let message = defaultStageMessage(stage, 'pending');

      if (active > 0) {
        status = 'running';
        message = latest?.status === 'running'
          ? latest.message
          : `${active} active session(s)`;
      } else if (latest) {
        if (latest.status === 'running') {
          if (counters.done > 0) {
            status = 'done';
            message = `completed ${counters.done} transition(s)`;
          } else {
            status = 'pending';
            message = defaultStageMessage(stage, 'pending');
          }
        } else {
          status = latest.status;
          message = latest.message;
        }
      } else if (counters.done > 0) {
        status = 'done';
        message = `completed ${counters.done} transition(s)`;
      }

      if (
        stage === 'START'
        && this.totalSessions > 0
        && status === 'pending'
        && active === 0
      ) {
        status = 'done';
        message = 'session bootstrap completed';
      }

      stageRuntime[stage] = {
        status,
        message,
        active,
        transitions,
        updatedAt: latest?.updatedAt ?? generatedAt,
      };
    }

    return stageRuntime;
  }

  private resolveCurrentStage(
    stageRuntime: Record<WorkflowStage, GovernanceRuntimeStageState>,
  ): WorkflowStage {
    const running = ORDERED_STAGES.find((stage) => {
      return stageRuntime[stage].status === 'running';
    });
    if (running) {
      return running;
    }

    const blockedOrFailed = ORDERED_STAGES.find((stage) => {
      const status = stageRuntime[stage].status;
      return status === 'blocked' || status === 'failed';
    });
    if (blockedOrFailed) {
      return blockedOrFailed;
    }

    const latest = ORDERED_STAGES
      .map((stage) => {
        const state = stageRuntime[stage];
        const timestampMs = Number.isFinite(Date.parse(state.updatedAt))
          ? Date.parse(state.updatedAt)
          : 0;
        return {
          stage,
          status: state.status,
          timestampMs,
        };
      })
      .filter((item) => item.status !== 'pending')
      .sort((left, right) => right.timestampMs - left.timestampMs)[0];

    if (latest) {
      return latest.stage;
    }

    if (this.totalSessions > 0) {
      return 'OUTPUT';
    }

    return 'START';
  }

  public getSnapshot(): GovernanceRuntimeSnapshot {
    if (this.totalSessions === 0 && this.activeSessions.size === 0) {
      return createEmptySnapshot();
    }

    const allRecentSessions: GovernanceRuntimeSessionSummary[] = [
      ...Array.from(this.activeSessions.values()).map((active) => {
        return {
          id: active.id,
          requestId: active.requestId,
          patientId: active.patientId,
          outcome: 'RUNNING' as const,
          startedAt: active.startedAt,
          durationMs: Math.max(1, Date.now() - active.startedAtMs),
        };
      }),
      ...this.recentCompletedSessions,
    ]
      .sort((left, right) => {
        return new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime();
      })
      .slice(0, this.maxRecentSessions);

    const queueOverview = {
      pending: 0,
      reviewing: 0,
      approved: 0,
      rejected: 0,
    };
    for (const session of allRecentSessions) {
      const mappedStatus = mapOutcomeToQueueStatus(session.outcome);
      queueOverview[mappedStatus] += 1;
    }

    const avgDuration = this.completedStats.length > 0
      ? this.completedStats.reduce((sum, item) => sum + item.durationMs, 0) / this.completedStats.length
      : 0;
    const avgRepeatedTransitions = this.completedStats.length > 0
      ? this.completedStats.reduce((sum, item) => sum + item.repeatedTransitions, 0) / this.completedStats.length
      : 0;
    const avgFailureWeight = this.completedStats.length > 0
      ? this.completedStats.reduce(
        (sum, item) => sum + item.stageFailures * 18 + item.stageBlocked * 14,
        0,
      ) / this.completedStats.length
      : 0;
    const complexitySamples = this.completedStats
      .map((item) => item.complexityScore)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const avgComplexity = complexitySamples.length > 0
      ? complexitySamples.reduce((sum, value) => sum + value, 0) / complexitySamples.length
      : 0;
    const closedSessions = Math.max(
      1,
      this.successSessions + this.escalatedSessions + this.errorSessions,
    );
    const rejectionPressure = ((this.escalatedSessions + this.errorSessions) / closedSessions) * 100;

    const latencyHeat = clampMetric((avgDuration - 700) / 35);
    const retryPressure = clampMetric(
      avgRepeatedTransitions * 20
        + this.activeSessions.size * 9
        + avgFailureWeight * 0.6,
    );
    const consensusConvergence = clampMetric(
      (this.successSessions / closedSessions) * 100
        - rejectionPressure * 0.42
        - avgRepeatedTransitions * 4,
    );
    const dissentSpread = clampMetric(
      rejectionPressure * 0.66
        + avgRepeatedTransitions * 16
        + this.activeSessions.size * 4,
    );
    const routingComplexity = clampMetric(
      avgComplexity * 14 + rejectionPressure * 0.35,
    );
    const generatedAt = nowIso();
    const stageRuntime = this.buildStageRuntime(generatedAt);

    return {
      generatedAt,
      source: 'runtime',
      governanceContext: {
        catalogVersion: AUTHORITATIVE_RULE_CATALOG_VERSION,
        guidelineReferenceCount: AUTHORITATIVE_GUIDELINE_REFERENCES.length,
        evidenceGateCommands: ['npm run gate:metrics', 'npm run gate:all'],
      },
      queueOverview,
      performance: {
        latencyHeat: Math.round(latencyHeat),
        retryPressure: Math.round(retryPressure),
        consensusConvergence: Math.round(consensusConvergence),
        dissentSpread: Math.round(dissentSpread),
        routingComplexity: Math.round(routingComplexity),
      },
      totals: {
        totalSessions: this.totalSessions,
        successSessions: this.successSessions,
        escalatedSessions: this.escalatedSessions,
        errorSessions: this.errorSessions,
        activeSessions: this.activeSessions.size,
      },
      recentSessions: allRecentSessions,
      stageRuntime,
      currentStage: this.resolveCurrentStage(stageRuntime),
    };
  }
}
