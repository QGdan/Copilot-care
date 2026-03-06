import fs from 'node:fs';
import path from 'node:path';
import cors, { CorsOptions } from 'cors';
import express, { Express } from 'express';
import { BackendRuntime } from './createRuntime';
import {
  isOriginAllowed,
  resolveBackendExposurePolicy,
} from '../config/runtimePolicy';
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

function createCorsOptions(env: NodeJS.ProcessEnv): CorsOptions {
  const policy = resolveBackendExposurePolicy(env);
  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (!policy.isProduction && policy.corsAllowedOrigins.length === 0) {
        callback(null, true);
        return;
      }

      callback(null, isOriginAllowed(origin, policy.corsAllowedOrigins));
    },
  };
}

export function createBackendApp(
  runtime: BackendRuntime,
  env: NodeJS.ProcessEnv = process.env,
): Express {
  const app = express();

  app.use(cors(createCorsOptions(env)));
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
  app.use('/interop', createInteropRouter(runtime.triageUseCase, env));
  app.use('/mcp', createMcpRouter(env));

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
