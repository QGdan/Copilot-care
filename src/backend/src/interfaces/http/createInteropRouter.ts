import { Request, Response, Router } from 'express';
import { TriageRequest } from '@copilot-care/shared/types';
import { RequestValidationError } from '../../application/errors/RequestValidationError';
import { RunTriageSessionUseCase } from '../../application/usecases/RunTriageSessionUseCase';
import { SmartAccessEnforcer } from '../../infrastructure/auth/SmartAccessEnforcer';
import { ObservationMapper } from '../../infrastructure/fhir/ObservationMapper';
import { PatientMapper } from '../../infrastructure/fhir/PatientMapper';
import { ProvenanceMapper } from '../../infrastructure/fhir/ProvenanceMapper';

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

function nowIso(): string {
  return new Date().toISOString();
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

export function createInteropRouter(useCase: RunTriageSessionUseCase): Router {
  const router = Router();

  router.post(
    '/fhir/triage-bundle',
    async (request: Request, response: Response) => {
      const scopeString = normalizeSmartScopeHeader(request);
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
        const result = await useCase.execute(input);

        if (result.status === 'ERROR') {
          const failed = toOperationOutcome(
            `Triage failed: ${result.errorCode ?? 'ERR_CONFLICT_UNRESOLVED'}`,
            400,
          );
          response.status(failed.statusCode).json(failed.payload);
          return;
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

        const payload: FhirBundleDraftResponse = {
          draft: true,
          generatedAt: nowIso(),
          triage: {
            sessionId: result.sessionId,
            status: result.status,
            triageLevel: result.triageResult?.triageLevel,
            destination: result.triageResult?.destination,
            ruleGovernance: result.ruleGovernance,
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

        response.status(200).json(payload);
      } catch (error) {
        if (error instanceof RequestValidationError) {
          const failed = toOperationOutcome(error.message, 400);
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

  return router;
}
