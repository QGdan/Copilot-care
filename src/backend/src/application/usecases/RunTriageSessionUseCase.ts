import {
  DebateResult,
  DebateRound,
  TriageRequest,
} from '@copilot-care/shared/types';
import { RequestValidationError } from '../errors/RequestValidationError';
import {
  StoredTriageIdempotencyEntry,
  TriageIdempotencyStorePort,
} from '../ports/TriageIdempotencyStorePort';
import {
  OrchestratorRunOptions,
  TriageOrchestratorPort,
} from '../ports/TriageOrchestratorPort';

export const TRIAGE_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

class MemoryTriageIdempotencyStore implements TriageIdempotencyStorePort {
  private readonly entries: Map<string, StoredTriageIdempotencyEntry>;

  constructor() {
    this.entries = new Map();
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

function formatRoundReasoning(round: DebateRound): string {
  return `Round ${round.roundNumber}: dissentIndex=${round.dissentIndex.toFixed(3)}, dissentBand=${round.dissentBand}`;
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of keys) {
      normalized[key] = canonicalizeValue(source[key]);
    }
    return normalized;
  }

  return value;
}

function buildRequestFingerprint(input: TriageRequest): string {
  return JSON.stringify({
    profile: canonicalizeValue(input.profile),
    signals: canonicalizeValue(input.signals ?? []),
    symptomText: input.symptomText ?? '',
    contextVersion: input.contextVersion ?? '',
    consentToken: input.consentToken ?? '',
  });
}

function resolveIdempotencyKey(input: TriageRequest): string | undefined {
  const requestId =
    typeof input.requestId === 'string' ? input.requestId.trim() : '';
  if (requestId) {
    return requestId;
  }

  const sessionId =
    typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  return sessionId || undefined;
}

export class RunTriageSessionUseCase {
  private readonly orchestrator: TriageOrchestratorPort;
  private readonly now: () => number;
  private readonly idempotencyStore: TriageIdempotencyStorePort;

  constructor(
    orchestrator: TriageOrchestratorPort,
    now: () => number = () => Date.now(),
    idempotencyStore: TriageIdempotencyStorePort = new MemoryTriageIdempotencyStore(),
  ) {
    this.orchestrator = orchestrator;
    this.now = now;
    this.idempotencyStore = idempotencyStore;
  }

  public async execute(
    input: TriageRequest,
    options?: OrchestratorRunOptions,
  ): Promise<DebateResult> {
    const nowMs = this.now();
    this.idempotencyStore.pruneExpired(nowMs, TRIAGE_IDEMPOTENCY_TTL_MS);

    const idempotencyKey = resolveIdempotencyKey(input);
    if (!idempotencyKey) {
      return this.orchestrator.runSession(input, options);
    }

    const requestFingerprint = buildRequestFingerprint(input);
    const existing = this.idempotencyStore.get(idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new RequestValidationError(
          'ERR_CONFLICT_UNRESOLVED',
          'requestId/sessionId already exists with a different payload.',
        );
      }

      if (options?.onWorkflowStage) {
        for (const stage of existing.result.workflowTrace ?? []) {
          options.onWorkflowStage(stage);
        }
      }

      if (options?.onReasoningStep) {
        for (const reason of existing.result.routing?.reasons ?? []) {
          options.onReasoningStep(reason);
        }
        for (const round of existing.result.rounds) {
          options.onReasoningStep(formatRoundReasoning(round));
        }
      }

      return existing.result;
    }

    const result = await this.orchestrator.runSession(input, options);
    this.idempotencyStore.set(idempotencyKey, {
      requestFingerprint,
      createdAtMs: nowMs,
      result,
    });

    return result;
  }
}
