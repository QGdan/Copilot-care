import { Request, Response, Router } from 'express';
import {
  AuditEvent,
  InteropJobResult,
  InteropRetryPolicy,
  TriageRequest,
  TriageStatus,
} from '@copilot-care/shared/types';
import { RequestValidationError } from '../../application/errors/RequestValidationError';
import { RunTriageSessionUseCase } from '../../application/usecases/RunTriageSessionUseCase';
import { resolveBackendExposurePolicy } from '../../config/runtimePolicy';
import { SmartAccessEnforcer } from '../../infrastructure/auth/SmartAccessEnforcer';
import { SmartTokenIntrospectionService } from '../../infrastructure/auth/SmartTokenIntrospectionService';
import { ObservationMapper } from '../../infrastructure/fhir/ObservationMapper';
import { PatientMapper } from '../../infrastructure/fhir/PatientMapper';
import { ProvenanceMapper } from '../../infrastructure/fhir/ProvenanceMapper';
import { Provenance } from '../../infrastructure/fhir/types';
import {
  InteropJobExecutionError,
  InteropSubmitJobService,
} from '../../infrastructure/interop/InteropSubmitJobService';
import { InteropWritebackAuditLogger } from '../../infrastructure/interop/InteropWritebackAuditLogger';

interface FhirBundleEntry {
  fullUrl?: string;
  resource: Record<string, unknown>;
}

interface FhirBundleDraftResponse {
  draft: true;
  generatedAt: string;
  triage: {
    sessionId: string;
    status: string;
    triageLevel?: string;
    destination?: string;
    ruleGovernance?: unknown;
    interopSummary: {
      resourceCounts: {
        patient: number;
        observation: number;
        provenance: number;
      };
      referenceIntegrity: {
        observationSubjectLinked: boolean;
        provenanceTargetLinked: boolean;
        provenanceObservationLinked: boolean;
      };
    };
  };
  bundle: {
    resourceType: 'Bundle';
    type: 'collection';
    timestamp: string;
    identifier: {
      system: string;
      value: string;
    };
    entry: FhirBundleEntry[];
  };
}

type InteropWritebackMode = 'mock' | 'real';

interface InteropWritebackRuntimeConfig {
  mode: InteropWritebackMode;
  fhirBaseUrl?: string;
  bundlePath: string;
  authToken?: string;
  timeoutMs: number;
}

function nowIso(): string {
  return new Date().toISOString();
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

function resolveInteropWritebackMode(
  env: NodeJS.ProcessEnv,
): InteropWritebackMode {
  const mode = (env.COPILOT_CARE_INTEROP_WRITEBACK_MODE ?? 'mock')
    .trim()
    .toLowerCase();
  return mode === 'real' ? 'real' : 'mock';
}

function normalizeBundlePath(value: string | undefined): string {
  const raw = (value ?? '/Bundle').trim();
  if (!raw) {
    return '/Bundle';
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function resolveInteropWritebackRuntimeConfig(
  env: NodeJS.ProcessEnv,
): InteropWritebackRuntimeConfig {
  const mode = resolveInteropWritebackMode(env);
  return {
    mode,
    fhirBaseUrl: (env.COPILOT_CARE_INTEROP_FHIR_BASE_URL ?? '').trim() || undefined,
    bundlePath: normalizeBundlePath(env.COPILOT_CARE_INTEROP_FHIR_BUNDLE_PATH),
    authToken: (env.COPILOT_CARE_INTEROP_FHIR_AUTH_TOKEN ?? '').trim() || undefined,
    timeoutMs: clampInteger(env.COPILOT_CARE_INTEROP_REAL_TIMEOUT_MS, 1000, 60000, 8000),
  };
}

function buildInteropWritebackTarget(
  config: InteropWritebackRuntimeConfig,
): string {
  if (config.mode !== 'real') {
    return 'internal_mock';
  }
  if (!config.fhirBaseUrl) {
    return 'real_missing_target';
  }
  const baseUrl = config.fhirBaseUrl.replace(/\/+$/, '');
  return `${baseUrl}${config.bundlePath}`;
}

function toOperationOutcome(
  diagnostics: string,
  statusCode: number,
): { statusCode: number; payload: Record<string, unknown> } {
  return {
    statusCode,
    payload: {
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: statusCode >= 500 ? 'error' : 'warning',
          code: statusCode === 403 ? 'forbidden' : 'processing',
          diagnostics,
        },
      ],
    },
  };
}

function parseRequestBody(body: unknown): TriageRequest {
  if (!body || typeof body !== 'object') {
    throw new RequestValidationError(
      'ERR_MISSING_REQUIRED_DATA',
      'Request body must include profile.',
    );
  }

  const candidate = body as Partial<TriageRequest>;
  if (!candidate.profile) {
    throw new RequestValidationError(
      'ERR_MISSING_REQUIRED_DATA',
      'Request body must include profile.',
    );
  }

  return {
    requestId:
      typeof candidate.requestId === 'string'
        ? candidate.requestId
        : undefined,
    profile: candidate.profile,
    signals: Array.isArray(candidate.signals) ? candidate.signals : undefined,
    symptomText:
      typeof candidate.symptomText === 'string'
        ? candidate.symptomText
        : undefined,
    contextVersion:
      typeof candidate.contextVersion === 'string'
        ? candidate.contextVersion
        : undefined,
    consentToken:
      typeof candidate.consentToken === 'string'
        ? candidate.consentToken
        : undefined,
    sessionId:
      typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
  };
}

function normalizeSmartScopeHeader(request: Request): string {
  const headerValue = request.header('x-smart-scope');
  if (typeof headerValue !== 'string') {
    return '';
  }
  return headerValue.trim();
}

function normalizeSmartTokenHeader(request: Request): string {
  const rawHeader = request.header('x-smart-token')
    || request.header('x-smart-access-token');
  if (typeof rawHeader !== 'string') {
    return '';
  }
  const normalized = rawHeader.trim();
  const bearerMatch = normalized.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1].trim();
  }
  return normalized;
}

function normalizeBearerToken(request: Request): string {
  const headerValue = request.header('authorization');
  if (typeof headerValue !== 'string') {
    return '';
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return '';
  }
  return match[1].trim();
}

function hasInteropScope(scopeString: string): boolean {
  if (!scopeString) {
    return false;
  }

  return (
    SmartAccessEnforcer.enforceFromScopeString(scopeString, 'Patient', 'read')
    && SmartAccessEnforcer.enforceFromScopeString(scopeString, 'Observation', 'read')
    && SmartAccessEnforcer.enforceFromScopeString(scopeString, 'Provenance', 'read')
  );
}

async function resolveInteropScope(
  request: Request,
  policy: ReturnType<typeof resolveBackendExposurePolicy>,
  smartIntrospectionService: SmartTokenIntrospectionService,
): Promise<{
  ok: boolean;
  scope?: string;
  source?: string;
  statusCode?: number;
  diagnostics?: string;
}> {
  const scopeHeader = normalizeSmartScopeHeader(request);
  const smartTokenHeader = normalizeSmartTokenHeader(request);
  const smartTokenFromAuthorization = policy.interopApiKey
    ? ''
    : normalizeBearerToken(request);
  const smartToken = smartTokenHeader || smartTokenFromAuthorization;

  const resolved = await smartIntrospectionService.resolveScope({
    token: smartToken,
    scopeHeader,
  });
  return {
    ok: resolved.ok,
    scope: resolved.scope,
    source: resolved.source,
    statusCode: resolved.statusCode,
    diagnostics: resolved.diagnostics,
  };
}

function ensureProvenanceTargets(
  provenance: Provenance,
  patientReference: string,
  observationReferences: string[],
): void {
  const targets = Array.isArray(provenance.target)
    ? [...provenance.target]
    : [];
  const existing = new Set(
    targets
      .map((item) => item.reference?.trim())
      .filter((value): value is string => Boolean(value)),
  );

  if (!existing.has(patientReference)) {
    targets.push({ reference: patientReference });
    existing.add(patientReference);
  }

  for (const observationReference of observationReferences) {
    if (!existing.has(observationReference)) {
      targets.push({ reference: observationReference });
      existing.add(observationReference);
    }
  }

  provenance.target = targets;
}

function createFallbackInteropAuditEvent(sessionId: string): AuditEvent {
  return {
    eventId: `interop_evt_${Date.now()}`,
    sessionId,
    timestamp: nowIso(),
    phase: 'OUTPUT',
    eventType: 'FINALIZED',
    details: 'FHIR draft bundle generated by interop adapter.',
    actor: 'CoPilotCare',
    action: 'interop.fhir.bundle.draft',
  };
}

function toInteropJobResult(
  payload: FhirBundleDraftResponse,
): InteropJobResult {
  return {
    generatedAt: payload.generatedAt,
    sessionId: payload.triage.sessionId,
    triageStatus: payload.triage.status as TriageStatus,
    resourceCounts: payload.triage.interopSummary.resourceCounts,
    bundleIdentifier: payload.bundle.identifier.value,
  };
}

function mapUpstreamStatusToInteropError(
  statusCode: number,
): { code: string; retriable: boolean } {
  if (statusCode === 408 || statusCode === 429) {
    return {
      code: 'INTEROP_UPSTREAM_TIMEOUT',
      retriable: true,
    };
  }

  if (statusCode >= 500) {
    return {
      code: 'INTEROP_UPSTREAM_UNAVAILABLE',
      retriable: true,
    };
  }

  if (statusCode >= 400) {
    return {
      code: 'INTEROP_UPSTREAM_REJECTED',
      retriable: false,
    };
  }

  return {
    code: 'INTEROP_RUNTIME_FAILURE',
    retriable: true,
  };
}

async function readUpstreamResponseBody(
  response: globalThis.Response,
): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 400);
  } catch {
    return '';
  }
}

async function submitBundleToUpstream(
  payload: FhirBundleDraftResponse,
  config: InteropWritebackRuntimeConfig,
): Promise<void> {
  if (config.mode !== 'real') {
    return;
  }
  if (!config.fhirBaseUrl) {
    throw new InteropJobExecutionError(
      'INTEROP_WRITEBACK_TARGET_MISSING',
      'Real writeback mode requires COPILOT_CARE_INTEROP_FHIR_BASE_URL.',
      false,
    );
  }

  const targetUrl = buildInteropWritebackTarget(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/fhir+json',
      accept: 'application/fhir+json, application/json',
    };
    if (config.authToken) {
      headers.authorization = `Bearer ${config.authToken}`;
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload.bundle),
      signal: controller.signal,
    });

    if (response.ok) {
      return;
    }

    const errorBody = await readUpstreamResponseBody(response);
    const mappedError = mapUpstreamStatusToInteropError(response.status);
    throw new InteropJobExecutionError(
      mappedError.code,
      `FHIR writeback failed (${response.status})${errorBody ? `: ${errorBody}` : ''}`,
      mappedError.retriable,
    );
  } catch (error) {
    if (error instanceof InteropJobExecutionError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new InteropJobExecutionError(
        'INTEROP_UPSTREAM_TIMEOUT',
        `FHIR writeback request timeout after ${config.timeoutMs}ms.`,
        true,
      );
    }

    if (error instanceof Error) {
      throw new InteropJobExecutionError(
        'INTEROP_UPSTREAM_UNAVAILABLE',
        `FHIR writeback transport error: ${error.message}`,
        true,
      );
    }

    throw new InteropJobExecutionError(
      'INTEROP_RUNTIME_FAILURE',
      'Unknown writeback runtime failure.',
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseRetryPolicy(
  value: unknown,
): { retryPolicy?: Partial<InteropRetryPolicy>; error?: string } {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'retryPolicy must be an object' };
  }

  const raw = value as Partial<InteropRetryPolicy>;
  const retryPolicy: Partial<InteropRetryPolicy> = {};

  if (raw.maxRetries !== undefined) {
    const maxRetries = Number(raw.maxRetries);
    if (!Number.isFinite(maxRetries) || maxRetries < 0 || maxRetries > 5) {
      return { error: 'retryPolicy.maxRetries must be an integer between 0 and 5' };
    }
    retryPolicy.maxRetries = Math.floor(maxRetries);
  }

  if (raw.retryDelayMs !== undefined) {
    const retryDelayMs = Number(raw.retryDelayMs);
    if (
      !Number.isFinite(retryDelayMs)
      || retryDelayMs < 50
      || retryDelayMs > 60000
    ) {
      return {
        error:
          'retryPolicy.retryDelayMs must be an integer between 50 and 60000',
      };
    }
    retryPolicy.retryDelayMs = Math.floor(retryDelayMs);
  }

  if (raw.retryableErrorCodes !== undefined) {
    if (!Array.isArray(raw.retryableErrorCodes)) {
      return { error: 'retryPolicy.retryableErrorCodes must be a string array' };
    }
    const normalizedCodes = raw.retryableErrorCodes
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length > 0);
    if (normalizedCodes.length === 0 || normalizedCodes.length > 16) {
      return {
        error:
          'retryPolicy.retryableErrorCodes must include 1-16 non-empty strings',
      };
    }
    retryPolicy.retryableErrorCodes = [...new Set(normalizedCodes)];
  }

  return { retryPolicy };
}

async function buildFhirBundleDraftResponse(
  useCase: RunTriageSessionUseCase,
  input: TriageRequest,
): Promise<FhirBundleDraftResponse> {
  const result = await useCase.execute(input);

  if (result.status === 'ERROR') {
    throw new InteropJobExecutionError(
      result.errorCode ?? 'ERR_CONFLICT_UNRESOLVED',
      `Triage failed: ${result.errorCode ?? 'ERR_CONFLICT_UNRESOLVED'}`,
      false,
    );
  }

  const patient = PatientMapper.toFHIR(input.profile);
  const patientId = patient.id ?? input.profile.patientId;
  patient.id = patientId;

  const inferredSignal =
    input.profile.vitals
      ? [
          {
            timestamp: nowIso(),
            source: 'manual' as const,
            systolicBP: input.profile.vitals.systolicBP,
            diastolicBP: input.profile.vitals.diastolicBP,
            heartRate: input.profile.vitals.heartRate,
            spo2: input.profile.vitals.spo2,
            bloodGlucose: input.profile.vitals.bloodGlucose,
            bloodLipid: input.profile.vitals.bloodLipid,
          },
        ]
      : [];
  const allSignals = [...(input.signals ?? []), ...inferredSignal];
  const observations = allSignals.flatMap((signal) =>
    ObservationMapper.toFHIR(signal, patientId),
  );
  const provenances = result.auditTrail.map((event) =>
    ProvenanceMapper.toFHIR(event, patientId),
  );

  observations.forEach((item, index) => {
    if (!item.id) {
      item.id = `${result.sessionId}-obs-${index + 1}`;
    }
  });
  provenances.forEach((item, index) => {
    if (!item.id) {
      item.id = `${result.sessionId}-prov-${index + 1}`;
    }
  });

  if (provenances.length === 0) {
    const fallbackEvent = createFallbackInteropAuditEvent(result.sessionId);
    const fallbackProvenance = ProvenanceMapper.toFHIR(
      fallbackEvent,
      patientId,
    );
    if (!fallbackProvenance.id) {
      fallbackProvenance.id = `${result.sessionId}-prov-1`;
    }
    provenances.push(fallbackProvenance);
  }

  const patientReference = `Patient/${patientId}`;
  const observationReferences = observations
    .map((item) => item.id)
    .filter((value): value is string => Boolean(value))
    .map((id) => `Observation/${id}`);

  for (const provenance of provenances) {
    ensureProvenanceTargets(
      provenance,
      patientReference,
      observationReferences,
    );
  }

  const interopSummary: FhirBundleDraftResponse['triage']['interopSummary'] = {
    resourceCounts: {
      patient: 1,
      observation: observations.length,
      provenance: provenances.length,
    },
    referenceIntegrity: {
      observationSubjectLinked: observations.every(
        (item) => item.subject?.reference === patientReference,
      ),
      provenanceTargetLinked: provenances.every((item) =>
        item.target.some((target) => target.reference === patientReference),
      ),
      provenanceObservationLinked:
        observationReferences.length === 0
        || provenances.every((item) =>
          observationReferences.every((observationReference) =>
            item.target.some(
              (target) => target.reference === observationReference,
            ),
          ),
        ),
    },
  };

  const entries: FhirBundleEntry[] = [
    {
      fullUrl: `urn:uuid:patient-${patientId}`,
      resource: patient as unknown as Record<string, unknown>,
    },
    ...observations.map((observation) => ({
      fullUrl: `urn:uuid:${observation.id}`,
      resource: observation as unknown as Record<string, unknown>,
    })),
    ...provenances.map((provenance) => ({
      fullUrl: `urn:uuid:${provenance.id}`,
      resource: provenance as unknown as Record<string, unknown>,
    })),
  ];

  return {
    draft: true,
    generatedAt: nowIso(),
    triage: {
      sessionId: result.sessionId,
      status: result.status,
      triageLevel: result.triageResult?.triageLevel,
      destination: result.triageResult?.destination,
      ruleGovernance: result.ruleGovernance,
      interopSummary,
    },
    bundle: {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: nowIso(),
      identifier: {
        system: 'urn:copilot-care:interop:triage-bundle',
        value: `triage-${result.sessionId}`,
      },
      entry: entries,
    },
  };
}

export function createInteropRouter(
  useCase: RunTriageSessionUseCase,
  env: NodeJS.ProcessEnv = process.env,
): Router {
  const router = Router();
  const policy = resolveBackendExposurePolicy(env);
  const smartIntrospectionService = new SmartTokenIntrospectionService(env);
  const writebackConfig = resolveInteropWritebackRuntimeConfig(env);
  const writebackTarget = buildInteropWritebackTarget(writebackConfig);
  const writebackAuditLogger = new InteropWritebackAuditLogger({ env });
  const interopSubmitJobService = new InteropSubmitJobService(
    async (input: TriageRequest) => {
      const payload = await buildFhirBundleDraftResponse(useCase, input);
      await submitBundleToUpstream(payload, writebackConfig);
      return toInteropJobResult(payload);
    },
    {
      env,
      onAttemptEvent: (event) => {
        writebackAuditLogger.log(event);
      },
      auditContext: {
        mode: writebackConfig.mode,
        target: writebackTarget,
      },
    },
  );

  router.use((request: Request, response: Response, next) => {
    if (!policy.interopEnabled) {
      const denied = toOperationOutcome(
        'FHIR interop route is disabled in this environment.',
        404,
      );
      response.status(denied.statusCode).json(denied.payload);
      return;
    }

    if (policy.isProduction && !policy.interopApiKey) {
      const failed = toOperationOutcome(
        'FHIR interop route is not configured for production access.',
        503,
      );
      response.status(failed.statusCode).json(failed.payload);
      return;
    }

    if (policy.interopApiKey) {
      const bearerToken = normalizeBearerToken(request);
      if (bearerToken !== policy.interopApiKey) {
        const denied = toOperationOutcome(
          'Authorization bearer token required for FHIR interop access.',
          401,
        );
        response.status(denied.statusCode).json(denied.payload);
        return;
      }
    }

    next();
  });

  router.post(
    '/fhir/triage-bundle',
    async (request: Request, response: Response) => {
      const scopeResolution = await resolveInteropScope(
        request,
        policy,
        smartIntrospectionService,
      );
      if (!scopeResolution.ok) {
        const denied = toOperationOutcome(
          scopeResolution.diagnostics
            || 'SMART scope authorization failed.',
          scopeResolution.statusCode ?? 403,
        );
        response.status(denied.statusCode).json(denied.payload);
        return;
      }

      const scopeString = scopeResolution.scope ?? '';
      if (!hasInteropScope(scopeString)) {
        const denied = toOperationOutcome(
          'SMART scope missing required read grants for Patient/Observation/Provenance.',
          403,
        );
        response.status(denied.statusCode).json(denied.payload);
        return;
      }

      try {
        const input = parseRequestBody(request.body);
        const payload = await buildFhirBundleDraftResponse(useCase, input);

        response.status(200).json({
          ...payload,
          writeback: {
            mode: writebackConfig.mode,
            target: writebackTarget,
          },
        });
      } catch (error) {
        if (error instanceof RequestValidationError) {
          const failed = toOperationOutcome(error.message, 400);
          response.status(failed.statusCode).json(failed.payload);
          return;
        }
        if (error instanceof InteropJobExecutionError) {
          const failed = toOperationOutcome(
            error.message,
            error.retriable ? 502 : 400,
          );
          response.status(failed.statusCode).json(failed.payload);
          return;
        }

        const failed = toOperationOutcome(
          'Unexpected runtime error while generating FHIR bundle draft.',
          500,
        );
        response.status(failed.statusCode).json(failed.payload);
      }
    },
  );

  router.post(
    '/fhir/triage-bundle/submit',
    async (request: Request, response: Response) => {
      const scopeResolution = await resolveInteropScope(
        request,
        policy,
        smartIntrospectionService,
      );
      if (!scopeResolution.ok) {
        const denied = toOperationOutcome(
          scopeResolution.diagnostics
            || 'SMART scope authorization failed.',
          scopeResolution.statusCode ?? 403,
        );
        response.status(denied.statusCode).json(denied.payload);
        return;
      }

      const scopeString = scopeResolution.scope ?? '';
      if (!hasInteropScope(scopeString)) {
        const denied = toOperationOutcome(
          'SMART scope missing required read grants for Patient/Observation/Provenance.',
          403,
        );
        response.status(denied.statusCode).json(denied.payload);
        return;
      }
      if (writebackConfig.mode === 'real' && !writebackConfig.fhirBaseUrl) {
        const failed = toOperationOutcome(
          'Real writeback mode requires COPILOT_CARE_INTEROP_FHIR_BASE_URL.',
          503,
        );
        response.status(failed.statusCode).json(failed.payload);
        return;
      }

      try {
        const input = parseRequestBody(request.body);
        const retryPolicyParse = parseRetryPolicy(
          (request.body as { retryPolicy?: unknown } | null)?.retryPolicy,
        );
        if (retryPolicyParse.error) {
          const failed = toOperationOutcome(retryPolicyParse.error, 400);
          response.status(failed.statusCode).json(failed.payload);
          return;
        }

        const job = interopSubmitJobService.submit({
          request: input,
          retryPolicy: retryPolicyParse.retryPolicy,
        });

        response.status(202).json({
          accepted: true,
          generatedAt: nowIso(),
          writeback: {
            mode: writebackConfig.mode,
            target: writebackTarget,
          },
          job: {
            jobId: job.jobId,
            status: job.status,
            attempts: job.attempts,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            retryPolicy: job.retryPolicy,
          },
          links: {
            status: `/interop/jobs/${job.jobId}`,
          },
        });
      } catch (error) {
        if (error instanceof RequestValidationError) {
          const failed = toOperationOutcome(error.message, 400);
          response.status(failed.statusCode).json(failed.payload);
          return;
        }
        const failed = toOperationOutcome(
          'Unexpected runtime error while submitting interop writeback job.',
          500,
        );
        response.status(failed.statusCode).json(failed.payload);
      }
    },
  );

  router.get('/jobs/:id', (request: Request, response: Response) => {
    const jobId =
      typeof request.params.id === 'string' ? request.params.id.trim() : '';
    if (!jobId) {
      const failed = toOperationOutcome('interop job id is required', 400);
      response.status(failed.statusCode).json(failed.payload);
      return;
    }

    const job = interopSubmitJobService.get(jobId);
    if (!job) {
      const failed = toOperationOutcome(
        `interop job not found: ${jobId}`,
        404,
      );
      response.status(failed.statusCode).json(failed.payload);
      return;
    }

    response.status(200).json({
      generatedAt: nowIso(),
      writeback: {
        mode: writebackConfig.mode,
        target: writebackTarget,
      },
      job,
      terminal: job.status === 'succeeded' || job.status === 'failed',
    });
  });

  return router;
}
