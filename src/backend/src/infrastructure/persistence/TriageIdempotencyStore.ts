import {
  StoredTriageIdempotencyEntry,
  TriageIdempotencyStorePort,
} from '../../application/ports/TriageIdempotencyStorePort';
import { readJsonFile, writeJsonFile } from './jsonFileStore';
import { resolveRuntimeStateConfig } from './runtimeStateConfig';

interface PersistedIdempotencyState {
  entries: Record<string, StoredTriageIdempotencyEntry>;
}

function normalizeState(
  value: PersistedIdempotencyState | undefined,
): PersistedIdempotencyState {
  if (!value || typeof value !== 'object' || !value.entries) {
    return { entries: {} };
  }
  return {
    entries: value.entries,
  };
}

export class InMemoryTriageIdempotencyStore
  implements TriageIdempotencyStorePort
{
  private readonly entries: Map<string, StoredTriageIdempotencyEntry>;

  constructor(
    initialEntries?: Iterable<[string, StoredTriageIdempotencyEntry]>,
  ) {
    this.entries = new Map(initialEntries);
  }

  public pruneExpired(referenceTimeMs: number, ttlMs: number): void {
    for (const [key, entry] of this.entries.entries()) {
      if (referenceTimeMs - entry.createdAtMs > ttlMs) {
        this.entries.delete(key);
      }
    }
  }

  public get(key: string): StoredTriageIdempotencyEntry | undefined {
    return this.entries.get(key);
  }

  public set(key: string, entry: StoredTriageIdempotencyEntry): void {
    this.entries.set(key, entry);
  }
}

export class FileBackedTriageIdempotencyStore
  implements TriageIdempotencyStorePort
{
  private readonly filePath: string;
  private readonly entries: Map<string, StoredTriageIdempotencyEntry>;

  constructor(filePath: string) {
    this.filePath = filePath;
    const persisted = normalizeState(
      readJsonFile<PersistedIdempotencyState>(filePath),
    );
    this.entries = new Map(Object.entries(persisted.entries));
  }

  private persist(): void {
    writeJsonFile(this.filePath, {
      entries: Object.fromEntries(this.entries.entries()),
    } satisfies PersistedIdempotencyState);
  }

  public pruneExpired(referenceTimeMs: number, ttlMs: number): void {
    let changed = false;
    for (const [key, entry] of this.entries.entries()) {
      if (referenceTimeMs - entry.createdAtMs > ttlMs) {
        this.entries.delete(key);
        changed = true;
      }
    }
    if (changed) {
      this.persist();
    }
  }

  public get(key: string): StoredTriageIdempotencyEntry | undefined {
    return this.entries.get(key);
  }

  public set(key: string, entry: StoredTriageIdempotencyEntry): void {
    this.entries.set(key, entry);
    this.persist();
  }
}

export function createTriageIdempotencyStore(
  env: NodeJS.ProcessEnv = process.env,
): TriageIdempotencyStorePort {
  const config = resolveRuntimeStateConfig(env);
  if (config.backend === 'file') {
    return new FileBackedTriageIdempotencyStore(config.idempotencyFilePath);
  }
  return new InMemoryTriageIdempotencyStore();
}
