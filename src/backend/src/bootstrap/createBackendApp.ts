import cors from 'cors';
import express, { Express } from 'express';
import { BackendRuntime } from './createRuntime';
import { createTriageRouter } from '../interfaces/http/createTriageRouter';
import { createFhirRouter } from '../interfaces/http/createFhirRouter';
import { createInteropRouter } from '../interfaces/http/createInteropRouter';
import { createMcpRouter } from '../interfaces/http/createMcpRouter';

export function createBackendApp(runtime: BackendRuntime): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use(
    createTriageRouter(
      runtime.triageUseCase,
      runtime.architecture,
      runtime.coordinatorSnapshotService,
      runtime.governanceRuntimeTelemetry,
    ),
  );

  app.use('/fhir', createFhirRouter());
  app.use('/interop', createInteropRouter(runtime.triageUseCase));
  app.use('/mcp', createMcpRouter());

  return app;
}
