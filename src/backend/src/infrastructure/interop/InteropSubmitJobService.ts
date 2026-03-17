import {
  InteropJob,
  InteropJobAttempt,
  InteropJobResult,
  InteropRetryPolicy,
  TriageRequest,
} from '@copilot-care/shared/types';
import {
  createInteropJobStore,
  InteropJobPersistentState,
  InteropJobStore,
} from './InteropJobStore';

const DEFAULT_RETRY_POLICY: InteropRetryPolicy = {
  maxRetries: 2,
  retryDelayMs: 300,
  retryableErrorCodes: [
    'INTEROP_UPSTREAM_TIMEOUT',
    'INTEROP_UPSTREAM_UNAVAILABLE',
    'INTEROP_RUNTIME_FAILURE',
  ],
};

type SimulationMode = 'none' | 'fail_once' | 'fail_always';

interface InteropExecutionErrorShape {
  code: string;
  message: string;
  retriable: boolean;
}

export class InteropJobExecutionError extends Error {
  public readonly code: string;
  public readonly retriable: boolean;

  constructor(code: string, message: string, retriable: boolean) {
    super(message);
    this.name = 'InteropJobExecutionError';
    this.code = code;
    this.retriable = retriable;
  }
}

export interface SubmitInteropJobInput {
  request: TriageRequest;
  retryPolicy?: Partial<InteropRetryPolicy>;
}

export interface InteropSubmitJobServiceOptions {
  store?: InteropJobStore;
  env?: NodeJS.ProcessEnv;
  schedule?: (task: () => void, delayMs: number) => void;
  now?: () => Date;
  onAttemptEvent?: (event: InteropJobAttemptEvent) => void;
  auditContext?: Record<string, string | number | boolean | undefined>;
}

export type InteropJobAttemptEventStatus =
  | 'attempt_started'
  | 'attempt_succeeded'
  | 'attempt_failed'
  | 'retry_scheduled'
  | 'job_succeeded'
  | 'job_failed';

export interface InteropJobAttemptEvent {
  timestamp: string;
  status: InteropJobAttemptEventStatus;
  jobId: string;
  requestId?: string;
  patientId: string;
  attempt: number;
  maxRetries: number;
  retryDelayMs: number;
  errorCode?: string;
  message?: string;
  retriable?: boolean;
  nextRetryAt?: string;
  context?: Record<string, string | number | boolean | undefined>;
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed =
    typeof value === 'number' ? value : Number(value ?? Number.NaN);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeRetryableErrorCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_RETRY_POLICY.retryableErrorCodes];
  }
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length > 0);
  if (normalized.length === 0) {
    return [...DEFAULT_RETRY_POLICY.retryableErrorCodes];
  }
  return [...new Set(normalized)].slice(0, 16);
}

function normalizeRetryPolicy(
  policy: Partial<InteropRetryPolicy> | undefined,
  env: NodeJS.ProcessEnv,
): InteropRetryPolicy {
  const defaultMaxRetries = clampInteger(
    env.COPILOT_CARE_INTEROP_JOB_MAX_RETRIES,
    0,
    5,
    DEFAULT_RETRY_POLICY.maxRetries,
  );
  const defaultRetryDelayMs = clampInteger(
    env.COPILOT_CARE_INTEROP_JOB_RETRY_DELAY_MS,
    50,
    60000,
    DEFAULT_RETRY_POLICY.retryDelayMs,
  );

  return {
    maxRetries: clampInteger(
      policy?.maxRetries,
      0,
      5,
      defaultMaxRetries,
    ),
    retryDelayMs: clampInteger(
      policy?.retryDelayMs,
      50,
      60000,
      defaultRetryDelayMs,
    ),
    retryableErrorCodes: normalizeRetryableErrorCodes(
      policy?.retryableErrorCodes,
    ),
  };
}

function normalizeSimulationMode(
  env: NodeJS.ProcessEnv,
): SimulationMode {
  const normalized = (env.COPILOT_CARE_INTEROP_JOB_SIMULATION ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'fail_once') {
    return 'fail_once';
  }
  if (normalized === 'fail_always') {
    return 'fail_always';
  }
  return 'none';
}

function createJobId(): string {
  return `interop-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePersistentState(
  state: InteropJobPersistentState | undefined,
): InteropJobPersistentState {
  if (!state || typeof state !== 'object' || !state.jobs) {
    return { jobs: {} };
  }
  return state;
}

function toInteropExecutionError(error: unknown): InteropExecutionErrorShape {
  if (error instanceof InteropJobExecutionError) {
    return {
      code: error.code,
      message: error.message,
      retriable: error.retriable,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'INTEROP_RUNTIME_FAILURE',
      message: error.message,
      retriable: true,
    };
  }

  return {
    code: 'INTEROP_RUNTIME_FAILURE',
    message: 'Unknown interop runtime failure.',
    retriable: true,
  };
}

function cloneRequest(request: TriageRequest): TriageRequest {
  return JSON.parse(JSON.stringify(request)) as TriageRequest;
}

function cloneJob(job: InteropJob): InteropJob {
  return JSON.parse(JSON.stringify(job)) as InteropJob;
}

export class InteropSubmitJobService {
  private readonly jobs: Map<string, InteropJob>;
  private readonly requests: Map<string, TriageRequest>;
  private readonly processingJobs: Set<string>;
  private readonly store: InteropJobStore;
  private readonly schedule: (task: () => void, delayMs: number) => void;
  private readonly now: () => Date;
  private readonly simulationMode: SimulationMode;
  private readonly executeInteropJob: (
    input: TriageRequest,
  ) => Promise<InteropJobResult>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly onAttemptEvent?: (event: InteropJobAttemptEvent) => void;
  private readonly auditContext?: Record<
    string,
    string | number | boolean | undefined
  >;

  constructor(
    executeInteropJob: (input: TriageRequest) => Promise<InteropJobResult>,
    options: InteropSubmitJobServiceOptions = {},
  ) {
    this.executeInteropJob = executeInteropJob;
    this.env = options.env ?? process.env;
    this.store = options.store ?? createInteropJobStore(this.env);
    this.schedule =
      options.schedule ?? ((task: () => void, delayMs: number) => {
        setTimeout(task, delayMs);
      });
    this.now = options.now ?? (() => new Date());
    this.simulationMode = normalizeSimulationMode(this.env);
    this.onAttemptEvent = options.onAttemptEvent;
    this.auditContext = options.auditContext;
    this.jobs = new Map<string, InteropJob>();
    this.requests = new Map<string, TriageRequest>();
    this.processingJobs = new Set<string>();

    const persisted = normalizePersistentState(this.store.load());
    for (const [jobId, record] of Object.entries(persisted.jobs)) {
      if (
        !record
        || typeof record !== 'object'
        || !record.job
        || !record.request
      ) {
        continue;
      }
      this.jobs.set(jobId, cloneJob(record.job));
      this.requests.set(jobId, cloneRequest(record.request));
    }
  }

  private persist(): void {
    const jobs: InteropJobPersistentState['jobs'] = {};
    for (const [jobId, job] of this.jobs.entries()) {
      const request = this.requests.get(jobId);
      if (!request) {
        continue;
      }
      jobs[jobId] = {
        job: cloneJob(job),
        request: cloneRequest(request),
      };
    }
    this.store.save({ jobs });
  }

  private applySimulationFailure(attempt: number): void {
    if (this.simulationMode === 'none') {
      return;
    }
    if (this.simulationMode === 'fail_once' && attempt === 1) {
      throw new InteropJobExecutionError(
        'INTEROP_UPSTREAM_TIMEOUT',
        'Simulated upstream timeout on first writeback attempt.',
        true,
      );
    }
    if (this.simulationMode === 'fail_always') {
      throw new InteropJobExecutionError(
        'INTEROP_UPSTREAM_UNAVAILABLE',
        'Simulated upstream unavailable for interop writeback.',
        true,
      );
    }
  }

  private scheduleProcessing(jobId: string, delayMs: number): void {
    this.schedule(() => {
      void this.process(jobId);
    }, delayMs);
  }

  private emitAttemptEvent(
    event: Omit<InteropJobAttemptEvent, 'timestamp' | 'context'>,
  ): void {
    if (!this.onAttemptEvent) {
      return;
    }
    try {
      this.onAttemptEvent({
        ...event,
        timestamp: nowIso(this.now),
        context: this.auditContext,
      });
    } catch {
      // no-op: audit logging must not interrupt writeback processing
    }
  }

  private async process(jobId: string): Promise<void> {
    if (this.processingJobs.has(jobId)) {
      return;
    }
    const currentJob = this.jobs.get(jobId);
    if (!currentJob) {
      return;
    }
    if (currentJob.status === 'succeeded' || currentJob.status === 'failed') {
      return;
    }

    const request = this.requests.get(jobId);
    if (!request) {
      currentJob.status = 'failed';
      currentJob.lastErrorCode = 'INTEROP_JOB_REQUEST_MISSING';
      currentJob.lastErrorMessage =
        'Interop job request payload is missing.';
      currentJob.completedAt = nowIso(this.now);
      currentJob.updatedAt = currentJob.completedAt;
      this.persist();
      return;
    }

    this.processingJobs.add(jobId);
    const attempt = currentJob.attempts + 1;
    const startedAt = nowIso(this.now);
    currentJob.status = 'running';
    currentJob.attempts = attempt;
    currentJob.startedAt = currentJob.startedAt ?? startedAt;
    currentJob.updatedAt = startedAt;
    currentJob.nextRetryAt = undefined;
    this.persist();
    this.emitAttemptEvent({
      status: 'attempt_started',
      jobId: currentJob.jobId,
      requestId: currentJob.requestId,
      patientId: currentJob.patientId,
      attempt,
      maxRetries: currentJob.retryPolicy.maxRetries,
      retryDelayMs: currentJob.retryPolicy.retryDelayMs,
      message: 'Interop writeback attempt started.',
    });

    const historyEntry: InteropJobAttempt = {
      attempt,
      startedAt,
      status: 'failed',
    };

    try {
      this.applySimulationFailure(attempt);
      const result = await this.executeInteropJob(cloneRequest(request));
      const finishedAt = nowIso(this.now);

      historyEntry.status = 'succeeded';
      historyEntry.finishedAt = finishedAt;
      historyEntry.message = 'FHIR interop writeback job succeeded.';
      currentJob.history.push(historyEntry);

      currentJob.result = result;
      currentJob.status = 'succeeded';
      currentJob.completedAt = finishedAt;
      currentJob.updatedAt = finishedAt;
      currentJob.lastErrorCode = undefined;
      currentJob.lastErrorMessage = undefined;
      currentJob.nextRetryAt = undefined;
      this.persist();
      this.emitAttemptEvent({
        status: 'attempt_succeeded',
        jobId: currentJob.jobId,
        requestId: currentJob.requestId,
        patientId: currentJob.patientId,
        attempt,
        maxRetries: currentJob.retryPolicy.maxRetries,
        retryDelayMs: currentJob.retryPolicy.retryDelayMs,
        message: historyEntry.message,
      });
      this.emitAttemptEvent({
        status: 'job_succeeded',
        jobId: currentJob.jobId,
        requestId: currentJob.requestId,
        patientId: currentJob.patientId,
        attempt,
        maxRetries: currentJob.retryPolicy.maxRetries,
        retryDelayMs: currentJob.retryPolicy.retryDelayMs,
        message: 'Interop writeback job completed successfully.',
      });
    } catch (error) {
      const normalized = toInteropExecutionError(error);
      const finishedAt = nowIso(this.now);

      historyEntry.status = 'failed';
      historyEntry.finishedAt = finishedAt;
      historyEntry.errorCode = normalized.code;
      historyEntry.message = normalized.message;
      historyEntry.retriable = normalized.retriable;
      currentJob.history.push(historyEntry);

      currentJob.lastErrorCode = normalized.code;
      currentJob.lastErrorMessage = normalized.message;
      currentJob.updatedAt = finishedAt;

      const retryableByPolicy =
        normalized.retriable
        && currentJob.retryPolicy.retryableErrorCodes.includes(normalized.code);
      const retriesUsed = attempt - 1;
      const shouldRetry =
        retryableByPolicy && retriesUsed < currentJob.retryPolicy.maxRetries;
      this.emitAttemptEvent({
        status: 'attempt_failed',
        jobId: currentJob.jobId,
        requestId: currentJob.requestId,
        patientId: currentJob.patientId,
        attempt,
        maxRetries: currentJob.retryPolicy.maxRetries,
        retryDelayMs: currentJob.retryPolicy.retryDelayMs,
        errorCode: normalized.code,
        message: normalized.message,
        retriable: retryableByPolicy,
      });

      if (shouldRetry) {
        const nextRetryAtMs =
          this.now().getTime() + currentJob.retryPolicy.retryDelayMs;
        currentJob.status = 'retrying';
        currentJob.nextRetryAt = new Date(nextRetryAtMs).toISOString();
        this.persist();
        this.emitAttemptEvent({
          status: 'retry_scheduled',
          jobId: currentJob.jobId,
          requestId: currentJob.requestId,
          patientId: currentJob.patientId,
          attempt,
          maxRetries: currentJob.retryPolicy.maxRetries,
          retryDelayMs: currentJob.retryPolicy.retryDelayMs,
          errorCode: normalized.code,
          message: 'Retry scheduled after failed writeback attempt.',
          retriable: retryableByPolicy,
          nextRetryAt: currentJob.nextRetryAt,
        });
        this.scheduleProcessing(jobId, currentJob.retryPolicy.retryDelayMs);
      } else {
        currentJob.status = 'failed';
        currentJob.completedAt = finishedAt;
        currentJob.nextRetryAt = undefined;
        this.persist();
        this.emitAttemptEvent({
          status: 'job_failed',
          jobId: currentJob.jobId,
          requestId: currentJob.requestId,
          patientId: currentJob.patientId,
          attempt,
          maxRetries: currentJob.retryPolicy.maxRetries,
          retryDelayMs: currentJob.retryPolicy.retryDelayMs,
          errorCode: normalized.code,
          message: normalized.message,
          retriable: retryableByPolicy,
        });
      }
    } finally {
      this.processingJobs.delete(jobId);
    }
  }

  public submit(input: SubmitInteropJobInput): InteropJob {
    const createdAt = nowIso(this.now);
    const jobId = createJobId();
    const retryPolicy = normalizeRetryPolicy(input.retryPolicy, this.env);
    const request = cloneRequest(input.request);

    const job: InteropJob = {
      jobId,
      requestId: request.requestId,
      patientId: request.profile.patientId,
      status: 'queued',
      createdAt,
      updatedAt: createdAt,
      attempts: 0,
      retryPolicy,
      history: [],
    };

    this.jobs.set(jobId, job);
    this.requests.set(jobId, request);
    this.persist();
    this.scheduleProcessing(jobId, 0);
    return cloneJob(job);
  }

  public get(jobId: string): InteropJob | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    return cloneJob(job);
  }
}
