import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TriageApiResponse, TriageRequest } from '@copilot-care/shared/types';
import { GovernanceRuntimeTelemetry } from '../../infrastructure/governance/GovernanceRuntimeTelemetry';
import { FileBackedGovernanceRuntimeStateStore } from '../../infrastructure/governance/GovernanceRuntimeStateStore';

function createRequest(
  overrides: Partial<TriageRequest> = {},
): TriageRequest {
  return {
    requestId: 'telemetry-request-001',
    consentToken: 'consent_local_demo',
    symptomText: 'fatigue',
    profile: {
      patientId: 'telemetry-patient-001',
      age: 48,
      sex: 'female',
      symptoms: ['fatigue'],
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['amlodipine'],
      vitals: {
        systolicBP: 138,
        diastolicBP: 88,
      },
    },
    ...overrides,
  };
}

function createPayload(): TriageApiResponse {
  return {
    status: 'OUTPUT',
    sessionId: 'telemetry-session-001',
    requestId: 'telemetry-request-001',
    rounds: [],
    routing: {
      complexityScore: 2,
      routeMode: 'FAST_CONSENSUS',
      department: 'generalPractice',
      collaborationMode: 'SINGLE_SPECIALTY_PANEL',
      reasons: ['low complexity'],
    },
    triageResult: {
      patientId: 'telemetry-patient-001',
      triageLevel: 'routine',
      destination: 'outpatient',
      followupDays: 14,
      educationAdvice: ['monitor symptoms'],
    },
    dissentIndexHistory: [],
    notes: [],
    auditTrail: [],
  };
}

describe('Architecture Smoke - governance runtime persistence', () => {
  it('restores completed telemetry state from file storage', () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'copilot-care-telemetry-'),
    );
    const filePath = path.join(tempDirectory, 'governance.json');

    try {
      const firstTelemetry = new GovernanceRuntimeTelemetry(
        80,
        new FileBackedGovernanceRuntimeStateStore(filePath),
      );
      const trackingId = firstTelemetry.startSession(createRequest());
      firstTelemetry.recordStageTransition(
        trackingId,
        'START',
        'done',
        'session started',
      );
      firstTelemetry.completeSession(
        trackingId,
        createPayload(),
        Date.now() + 250,
      );

      const restoredTelemetry = new GovernanceRuntimeTelemetry(
        80,
        new FileBackedGovernanceRuntimeStateStore(filePath),
      );
      const snapshot = restoredTelemetry.getSnapshot();

      expect(snapshot.totals.totalSessions).toBe(1);
      expect(snapshot.totals.successSessions).toBe(1);
      expect(snapshot.recentSessions[0]?.requestId).toBe('telemetry-request-001');
      expect(snapshot.stageRuntime.START.transitions).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
