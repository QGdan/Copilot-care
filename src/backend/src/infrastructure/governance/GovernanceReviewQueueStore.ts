import { ReviewCase } from '@copilot-care/shared/types';
import { readJsonFile, writeJsonFile } from '../persistence/jsonFileStore';
import { resolveRuntimeStateConfig } from '../persistence/runtimeStateConfig';

export interface GovernanceReviewQueuePersistentState {
  cases: Record<string, ReviewCase>;
}

export interface GovernanceReviewQueueStore {
  load(): GovernanceReviewQueuePersistentState | undefined;
  save(state: GovernanceReviewQueuePersistentState): void;
}

export class InMemoryGovernanceReviewQueueStore
  implements GovernanceReviewQueueStore
{
  private state?: GovernanceReviewQueuePersistentState;

  public load(): GovernanceReviewQueuePersistentState | undefined {
    return this.state;
  }

  public save(state: GovernanceReviewQueuePersistentState): void {
    this.state = state;
  }
}

function normalizeState(
  state: GovernanceReviewQueuePersistentState | undefined,
): GovernanceReviewQueuePersistentState | undefined {
  if (!state || typeof state !== 'object') {
    return undefined;
  }
  if (!state.cases || typeof state.cases !== 'object') {
    return undefined;
  }
  return state;
}

export class FileBackedGovernanceReviewQueueStore
  implements GovernanceReviewQueueStore
{
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public load(): GovernanceReviewQueuePersistentState | undefined {
    return normalizeState(
      readJsonFile<GovernanceReviewQueuePersistentState>(this.filePath),
    );
  }

  public save(state: GovernanceReviewQueuePersistentState): void {
    writeJsonFile(this.filePath, state);
  }
}

export function createGovernanceReviewQueueStore(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceReviewQueueStore {
  const config = resolveRuntimeStateConfig(env);
  if (config.backend === 'file') {
    return new FileBackedGovernanceReviewQueueStore(
      config.governanceReviewQueueFilePath,
    );
  }
  return new InMemoryGovernanceReviewQueueStore();
}
