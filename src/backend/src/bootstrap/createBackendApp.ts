import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { Express } from 'express';
import { BackendRuntime } from './createRuntime';
import { createTriageRouter } from '../interfaces/http/createTriageRouter';
import { createFhirRouter } from '../interfaces/http/createFhirRouter';
import { createInteropRouter } from '../interfaces/http/createInteropRouter';
import { createMcpRouter } from '../interfaces/http/createMcpRouter';

const STATIC_FALLBACK_BLOCKLIST_PREFIXES = [
  '/health',
  '/orchestrate_triage',
  '/governance',
  '/architecture',
  '/fhir',
  '/interop',
  '/mcp',
] as const;

function resolveFrontendDistDirectory(): string | null {
  const configuredPath = process.env.COPILOT_CARE_FRONTEND_DIST;
  const candidates = [
    configuredPath,
    path.resolve(process.cwd(), 'src/frontend/dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), '../../frontend/dist'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const normalizedPath = path.resolve(candidate);
    if (!fs.existsSync(normalizedPath)) {
      continue;
    }

    const stats = fs.statSync(normalizedPath);
    if (stats.isDirectory()) {
      return normalizedPath;
    }
  }

  return null;
}

function shouldSkipSpaFallback(requestPath: string): boolean {
  if (requestPath.includes('.')) {
    return true;
  }

  return STATIC_FALLBACK_BLOCKLIST_PREFIXES.some((prefix) =>
    requestPath.startsWith(prefix),
  );
}

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
      runtime.authoritativeMedicalSearch,
    ),
  );

  app.use('/fhir', createFhirRouter());
  app.use('/interop', createInteropRouter(runtime.triageUseCase));
  app.use('/mcp', createMcpRouter());

  const frontendDistDirectory = resolveFrontendDistDirectory();
  if (frontendDistDirectory) {
    app.use(express.static(frontendDistDirectory));
    app.get('*', (request, response, next) => {
      if (shouldSkipSpaFallback(request.path)) {
        next();
        return;
      }

      response.sendFile(path.join(frontendDistDirectory, 'index.html'));
    });
  }

  return app;
}
