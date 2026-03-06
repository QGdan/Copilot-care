import { DebateResult } from '@copilot-care/shared/types';

export interface StoredTriageIdempotencyEntry {
  requestFingerprint: string;
  createdAtMs: number;
  result: DebateResult;
}

export interface TriageIdempotencyStorePort {
  pruneExpired(referenceTimeMs: number, ttlMs: number): void;
  get(key: string): StoredTriageIdempotencyEntry | undefined;
  set(key: string, entry: StoredTriageIdempotencyEntry): void;
}
