import { InteropJob, TriageRequest } from '@copilot-care/shared/types';
import { readJsonFile, writeJsonFile } from '../persistence/jsonFileStore';
import { resolveRuntimeStateConfig } from '../persistence/runtimeStateConfig';

export interface InteropJobPersistentRecord {
  job: InteropJob;
  request: TriageRequest;
}

export interface InteropJobPersistentState {
  jobs: Record<string, InteropJobPersistentRecord>;
}

export interface InteropJobStore {
  load(): InteropJobPersistentState | undefined;
  save(state: InteropJobPersistentState): void;
}

export class InMemoryInteropJobStore implements InteropJobStore {
  private state?: InteropJobPersistentState;

  public load(): InteropJobPersistentState | undefined {
    return this.state;
  }

  public save(state: InteropJobPersistentState): void {
    this.state = state;
  }
}

function normalizeState(
  state: InteropJobPersistentState | undefined,
): InteropJobPersistentState | undefined {
  if (!state || typeof state !== 'object') {
    return undefined;
  }
  if (!state.jobs || typeof state.jobs !== 'object') {
    return undefined;
  }
  return state;
}

export class FileBackedInteropJobStore implements InteropJobStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public load(): InteropJobPersistentState | undefined {
    return normalizeState(
      readJsonFile<InteropJobPersistentState>(this.filePath),
    );
  }

  public save(state: InteropJobPersistentState): void {
    writeJsonFile(this.filePath, state);
  }
}

export function createInteropJobStore(
  env: NodeJS.ProcessEnv = process.env,
): InteropJobStore {
  const config = resolveRuntimeStateConfig(env);
  if (config.backend === 'file') {
    return new FileBackedInteropJobStore(config.interopJobsFilePath);
  }
  return new InMemoryInteropJobStore();
}
