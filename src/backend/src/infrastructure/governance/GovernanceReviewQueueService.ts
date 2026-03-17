import {
  ReviewCase,
  ReviewCaseStatus,
  ReviewDecision,
  ReviewDecisionOutcome,
  TriageApiResponse,
  TriageRequest,
} from '@copilot-care/shared/types';
import {
  GovernanceReviewQueuePersistentState,
  GovernanceReviewQueueStore,
  InMemoryGovernanceReviewQueueStore,
} from './GovernanceReviewQueueStore';

export interface RecordReviewCaseInput {
  request: TriageRequest;
  response: TriageApiResponse;
}

export interface DecideReviewCaseInput {
  decision: ReviewDecisionOutcome;
  reviewerId?: string;
  note?: string;
}

export interface ListReviewCasesInput {
  status?: ReviewCaseStatus[];
  limit?: number;
  patientId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveCaseId(input: RecordReviewCaseInput): string {
  const fromResponse =
    input.response.auditRef
    || ('sessionId' in input.response ? input.response.sessionId : undefined)
    || ('requestId' in input.response ? input.response.requestId : undefined);
  const fromRequest = input.request.requestId || input.request.sessionId;
  return (fromResponse || fromRequest || `review-${Date.now()}`).trim();
}

function buildSummary(input: RecordReviewCaseInput): string {
  if (input.response.status === 'ERROR') {
    return input.response.notes[0] || 'review required for error outcome';
  }

  const reportSummary = input.response.explainableReport?.conclusion;
  const noteSummary = input.response.notes[0];
  return reportSummary || noteSummary || 'review required for triage outcome';
}

function resolveInitialStatus(outcome: ReviewCase['triggerOutcome']): ReviewCaseStatus {
  if (outcome === 'ABSTAIN') {
    return 'reviewing';
  }
  return 'pending';
}

function mapDecisionToStatus(
  decision: ReviewDecisionOutcome,
): ReviewCaseStatus {
  if (decision === 'approve') {
    return 'approved';
  }
  if (decision === 'reject') {
    return 'rejected';
  }
  return 'reviewing';
}

function normalizeState(
  state: GovernanceReviewQueuePersistentState | undefined,
): GovernanceReviewQueuePersistentState {
  if (!state || typeof state !== 'object' || !state.cases) {
    return { cases: {} };
  }
  return state;
}

function shouldEnqueue(response: TriageApiResponse): boolean {
  return (
    response.status === 'ERROR'
    || response.status === 'ABSTAIN'
    || response.status === 'ESCALATE_TO_OFFLINE'
  );
}

export class GovernanceReviewQueueService {
  private readonly store: GovernanceReviewQueueStore;
  private readonly cases: Map<string, ReviewCase>;

  constructor(
    store: GovernanceReviewQueueStore = new InMemoryGovernanceReviewQueueStore(),
  ) {
    this.store = store;
    const persisted = normalizeState(this.store.load());
    this.cases = new Map(Object.entries(persisted.cases));
  }

  private persist(): void {
    this.store.save({
      cases: Object.fromEntries(this.cases.entries()),
    });
  }

  public recordFromTriage(input: RecordReviewCaseInput): ReviewCase | null {
    if (!shouldEnqueue(input.response)) {
      return null;
    }

    const caseId = resolveCaseId(input);
    const existing = this.cases.get(caseId);
    const createdAt = existing?.createdAt ?? nowIso();
    const updatedAt = nowIso();
    const nextStatus = existing?.status ?? resolveInitialStatus(input.response.status);

    const merged: ReviewCase = {
      caseId,
      requestId:
        input.request.requestId
        || ('requestId' in input.response ? input.response.requestId : undefined),
      sessionId:
        input.request.sessionId
        || ('sessionId' in input.response ? input.response.sessionId : undefined),
      patientId: input.request.profile.patientId,
      triggerOutcome: input.response.status,
      errorCode: input.response.status === 'ERROR'
        ? input.response.errorCode
        : input.response.errorCode,
      summary: buildSummary(input),
      nextAction: input.response.nextAction,
      triageLevel:
        input.response.status === 'ERROR'
          ? undefined
          : input.response.triageResult?.triageLevel,
      destination:
        input.response.status === 'ERROR'
          ? undefined
          : input.response.triageResult?.destination,
      auditRef: input.response.auditRef,
      status: nextStatus,
      createdAt,
      updatedAt,
      decision: existing?.decision,
    };

    this.cases.set(caseId, merged);
    this.persist();
    return merged;
  }

  public list(input: ListReviewCasesInput = {}): ReviewCase[] {
    const limit = Number.isFinite(input.limit)
      ? Math.min(200, Math.max(1, Math.floor(input.limit as number)))
      : 50;
    const patientIdFilter = input.patientId?.trim() || '';
    const statusSet =
      input.status && input.status.length > 0
        ? new Set(input.status)
        : null;

    return [...this.cases.values()]
      .filter((item) => {
        if (patientIdFilter && item.patientId !== patientIdFilter) {
          return false;
        }
        if (!statusSet) {
          return true;
        }
        return statusSet.has(item.status);
      })
      .sort((left, right) => {
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })
      .slice(0, limit);
  }

  public get(caseId: string): ReviewCase | undefined {
    return this.cases.get(caseId);
  }

  public decide(
    caseId: string,
    input: DecideReviewCaseInput,
  ): ReviewCase | null {
    const existing = this.cases.get(caseId);
    if (!existing) {
      return null;
    }

    const decision: ReviewDecision = {
      decision: input.decision,
      reviewerId: input.reviewerId?.trim() || undefined,
      note: input.note?.trim() || undefined,
      decidedAt: nowIso(),
    };

    const updated: ReviewCase = {
      ...existing,
      status: mapDecisionToStatus(input.decision),
      updatedAt: nowIso(),
      decision,
    };
    this.cases.set(caseId, updated);
    this.persist();
    return updated;
  }

  public getQueueOverview(): Record<ReviewCaseStatus, number> {
    const overview: Record<ReviewCaseStatus, number> = {
      pending: 0,
      reviewing: 0,
      approved: 0,
      rejected: 0,
    };
    for (const item of this.cases.values()) {
      overview[item.status] += 1;
    }
    return overview;
  }
}
