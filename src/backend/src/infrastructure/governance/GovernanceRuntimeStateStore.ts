import {
  ErrorCode,
  TriageRouteMode,
  TriageStatus,
  TriageStreamStageStatus,
  WorkflowStage,
} from '@copilot-care/shared/types';
import { readJsonFile, writeJsonFile } from '../persistence/jsonFileStore';
import { resolveRuntimeStateConfig } from '../persistence/runtimeStateConfig';

type SessionOutcome = TriageStatus | 'ERROR' | 'RUNNING';

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

export interface GovernanceRuntimeCompletedSessionStats {
  durationMs: number;
  repeatedTransitions: number;
  stageFailures: number;
  stageBlocked: number;
  complexityScore?: number;
}

export interface GovernanceRuntimeStageTransitionRuntimeState {
  status: TriageStreamStageStatus;
  message: string;
  updatedAt: string;
  updatedAtMs: number;
}

export type GovernanceRuntimeStageTransitionCounters = Record<
  TriageStreamStageStatus,
  number
>;

export interface GovernanceRuntimePersistentState {
  recentCompletedSessions: GovernanceRuntimeSessionSummary[];
  completedStats: GovernanceRuntimeCompletedSessionStats[];
  stageTransitionCounters: Record<
    WorkflowStage,
    GovernanceRuntimeStageTransitionCounters
  >;
  stageLatestRuntime: Partial<
    Record<WorkflowStage, GovernanceRuntimeStageTransitionRuntimeState>
  >;
  totalSessions: number;
  successSessions: number;
  escalatedSessions: number;
  errorSessions: number;
}

export interface GovernanceRuntimeStateStore {
  load(): GovernanceRuntimePersistentState | undefined;
  save(state: GovernanceRuntimePersistentState): void;
}

export class InMemoryGovernanceRuntimeStateStore
  implements GovernanceRuntimeStateStore
{
  private state?: GovernanceRuntimePersistentState;

  public load(): GovernanceRuntimePersistentState | undefined {
    return this.state;
  }

  public save(state: GovernanceRuntimePersistentState): void {
    this.state = state;
  }
}

function isWorkflowStageRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function normalizePersistentState(
  value: GovernanceRuntimePersistentState | undefined,
): GovernanceRuntimePersistentState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (
    !Array.isArray(value.recentCompletedSessions)
    || !Array.isArray(value.completedStats)
    || !isWorkflowStageRecord(value.stageTransitionCounters)
    || !isWorkflowStageRecord(value.stageLatestRuntime)
  ) {
    return undefined;
  }

  return value;
}

export class FileBackedGovernanceRuntimeStateStore
  implements GovernanceRuntimeStateStore
{
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public load(): GovernanceRuntimePersistentState | undefined {
    return normalizePersistentState(
      readJsonFile<GovernanceRuntimePersistentState>(this.filePath),
    );
  }

  public save(state: GovernanceRuntimePersistentState): void {
    writeJsonFile(this.filePath, state);
  }
}

export function createGovernanceRuntimeStateStore(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceRuntimeStateStore {
  const config = resolveRuntimeStateConfig(env);
  if (config.backend === 'file') {
    return new FileBackedGovernanceRuntimeStateStore(
      config.governanceTelemetryFilePath,
    );
  }
  return new InMemoryGovernanceRuntimeStateStore();
}
