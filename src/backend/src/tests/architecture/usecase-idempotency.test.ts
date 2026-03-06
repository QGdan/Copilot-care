import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DebateResult,
  PatientProfile,
  TriageRequest,
} from '@copilot-care/shared/types';
import {
  OrchestratorRunOptions,
  TriageOrchestratorPort,
} from '../../application/ports/TriageOrchestratorPort';
import {
  RunTriageSessionUseCase,
  TRIAGE_IDEMPOTENCY_TTL_MS,
} from '../../application/usecases/RunTriageSessionUseCase';
import { FileBackedTriageIdempotencyStore } from '../../infrastructure/persistence/TriageIdempotencyStore';

function createProfile(overrides: Partial<PatientProfile> = {}): PatientProfile {
  return {
    patientId: 'patient-001',
    age: 56,
    sex: 'female',
    chronicDiseases: ['hypertension'],
    medicationHistory: ['amlodipine'],
    ...overrides,
  };
}

function createResult(sessionId: string): DebateResult {
  return {
    sessionId,
    status: 'OUTPUT',
    rounds: [],
    dissentIndexHistory: [],
    notes: [],
    auditTrail: [],
  };
}

describe('Architecture Smoke - use case idempotency', () => {
  it('returns cached result for same sessionId and same payload', async () => {
    const runSession = jest
      .fn<Promise<DebateResult>, [TriageRequest, OrchestratorRunOptions?]>()
      .mockResolvedValue(createResult('sess-a'));
    const orchestrator: TriageOrchestratorPort = { runSession };
    const useCase = new RunTriageSessionUseCase(orchestrator);

    const request: TriageRequest = {
      profile: createProfile(),
      sessionId: 'sess-a',
    };

    const first = await useCase.execute(request);
    const second = await useCase.execute(request);

    expect(runSession).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('rejects reuse of same sessionId with different payload', async () => {
    const runSession = jest
      .fn<Promise<DebateResult>, [TriageRequest, OrchestratorRunOptions?]>()
      .mockResolvedValue(createResult('sess-b'));
    const orchestrator: TriageOrchestratorPort = { runSession };
    const useCase = new RunTriageSessionUseCase(orchestrator);

    await useCase.execute({
      profile: createProfile(),
      sessionId: 'sess-b',
    });

    await expect(
      useCase.execute({
        profile: createProfile({ age: 57 }),
        sessionId: 'sess-b',
      }),
    ).rejects.toMatchObject({
      errorCode: 'ERR_CONFLICT_UNRESOLVED',
    });

    expect(runSession).toHaveBeenCalledTimes(1);
  });

  it('recomputes result after idempotency TTL expires', async () => {
    let now = 1000;
    const runSession = jest
      .fn<Promise<DebateResult>, [TriageRequest, OrchestratorRunOptions?]>()
      .mockResolvedValue(createResult('sess-c'));
    const orchestrator: TriageOrchestratorPort = { runSession };
    const useCase = new RunTriageSessionUseCase(orchestrator, () => now);

    const request: TriageRequest = {
      profile: createProfile(),
      sessionId: 'sess-c',
    };

    await useCase.execute(request);
    now += TRIAGE_IDEMPOTENCY_TTL_MS + 1;
    await useCase.execute(request);

    expect(runSession).toHaveBeenCalledTimes(2);
  });

  it('forwards orchestration callbacks when idempotency key is absent', async () => {
    const runSession = jest
      .fn<Promise<DebateResult>, [TriageRequest, OrchestratorRunOptions?]>()
      .mockResolvedValue(createResult('sess-d'));
    const orchestrator: TriageOrchestratorPort = { runSession };
    const useCase = new RunTriageSessionUseCase(orchestrator);

    const request: TriageRequest = {
      profile: createProfile(),
    };
    const options: OrchestratorRunOptions = {
      onWorkflowStage: jest.fn(),
      onReasoningStep: jest.fn(),
    };

    await useCase.execute(request, options);

    expect(runSession).toHaveBeenCalledTimes(1);
    expect(runSession).toHaveBeenCalledWith(request, options);
  });

  it('reuses persisted idempotency entries across use case instances', async () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'copilot-care-idempotency-'),
    );
    const filePath = path.join(tempDirectory, 'idempotency.json');

    try {
      const firstRunSession = jest
        .fn<Promise<DebateResult>, [TriageRequest, OrchestratorRunOptions?]>()
        .mockResolvedValue(createResult('sess-persisted'));
      const firstUseCase = new RunTriageSessionUseCase(
        { runSession: firstRunSession },
        () => 1000,
        new FileBackedTriageIdempotencyStore(filePath),
      );

      const request: TriageRequest = {
        profile: createProfile(),
        sessionId: 'sess-persisted',
      };

      const first = await firstUseCase.execute(request);

      const secondRunSession = jest
        .fn<Promise<DebateResult>, [TriageRequest, OrchestratorRunOptions?]>()
        .mockResolvedValue(createResult('sess-persisted-second'));
      const secondUseCase = new RunTriageSessionUseCase(
        { runSession: secondRunSession },
        () => 1000,
        new FileBackedTriageIdempotencyStore(filePath),
      );

      const second = await secondUseCase.execute(request);

      expect(firstRunSession).toHaveBeenCalledTimes(1);
      expect(secondRunSession).toHaveBeenCalledTimes(0);
      expect(second).toEqual(first);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
