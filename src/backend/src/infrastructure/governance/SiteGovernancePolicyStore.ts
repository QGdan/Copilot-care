import { SiteGovernancePolicy } from '@copilot-care/shared/types';
import { readJsonFile, writeJsonFile } from '../persistence/jsonFileStore';
import { resolveRuntimeStateConfig } from '../persistence/runtimeStateConfig';

export interface SiteGovernancePolicyPersistentState {
  policies: Record<string, SiteGovernancePolicy>;
}

export interface SiteGovernancePolicyStore {
  load(): SiteGovernancePolicyPersistentState | undefined;
  save(state: SiteGovernancePolicyPersistentState): void;
}

export class InMemorySiteGovernancePolicyStore
  implements SiteGovernancePolicyStore
{
  private state?: SiteGovernancePolicyPersistentState;

  public load(): SiteGovernancePolicyPersistentState | undefined {
    return this.state;
  }

  public save(state: SiteGovernancePolicyPersistentState): void {
    this.state = state;
  }
}

function normalizeState(
  state: SiteGovernancePolicyPersistentState | undefined,
): SiteGovernancePolicyPersistentState | undefined {
  if (!state || typeof state !== 'object') {
    return undefined;
  }
  if (!state.policies || typeof state.policies !== 'object') {
    return undefined;
  }
  return state;
}

export class FileBackedSiteGovernancePolicyStore
  implements SiteGovernancePolicyStore
{
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public load(): SiteGovernancePolicyPersistentState | undefined {
    return normalizeState(
      readJsonFile<SiteGovernancePolicyPersistentState>(this.filePath),
    );
  }

  public save(state: SiteGovernancePolicyPersistentState): void {
    writeJsonFile(this.filePath, state);
  }
}

export function createSiteGovernancePolicyStore(
  env: NodeJS.ProcessEnv = process.env,
): SiteGovernancePolicyStore {
  const config = resolveRuntimeStateConfig(env);
  if (config.backend === 'file') {
    return new FileBackedSiteGovernancePolicyStore(
      config.siteGovernancePoliciesFilePath,
    );
  }
  return new InMemorySiteGovernancePolicyStore();
}
