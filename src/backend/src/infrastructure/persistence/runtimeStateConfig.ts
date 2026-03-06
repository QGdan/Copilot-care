import path from 'node:path';
import { isProductionEnvironment } from '../../config/runtimePolicy';

export type RuntimeStateBackend = 'memory' | 'file';

export interface RuntimeStateConfig {
  backend: RuntimeStateBackend;
  directoryPath: string;
  idempotencyFilePath: string;
  governanceTelemetryFilePath: string;
}

function normalizeBackend(value: string | undefined): RuntimeStateBackend {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'file') {
    return 'file';
  }
  return 'memory';
}

export function resolveRuntimeStateConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeStateConfig {
  const backend = normalizeBackend(env.COPILOT_CARE_RUNTIME_STATE_BACKEND);
  const directoryPath = path.resolve(
    env.COPILOT_CARE_RUNTIME_STATE_DIR || 'reports/runtime/state',
  );

  return {
    backend,
    directoryPath,
    idempotencyFilePath: path.join(directoryPath, 'triage-idempotency.json'),
    governanceTelemetryFilePath: path.join(
      directoryPath,
      'governance-telemetry.json',
    ),
  };
}

export function shouldUsePersistentRuntimeState(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveRuntimeStateConfig(env).backend === 'file';
}

export function runtimeStateBackendHint(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeStateBackend {
  if (isProductionEnvironment(env)) {
    return resolveRuntimeStateConfig(env).backend;
  }
  return resolveRuntimeStateConfig(env).backend;
}
