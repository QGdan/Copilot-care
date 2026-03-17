import fs from 'node:fs';
import path from 'node:path';
import { InteropJobAttemptEvent } from './InteropSubmitJobService';

export interface InteropWritebackAuditLoggerOptions {
  env?: NodeJS.ProcessEnv;
}

interface InteropWritebackAuditLoggerConfig {
  enabled: boolean;
  filePath: string;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveConfig(env: NodeJS.ProcessEnv): InteropWritebackAuditLoggerConfig {
  const filePath = path.resolve(
    env.COPILOT_CARE_INTEROP_AUDIT_LOG_FILE
    || 'reports/runtime/interop-writeback.runtime.jsonl',
  );
  return {
    enabled: parseBooleanFlag(env.COPILOT_CARE_INTEROP_AUDIT_LOG_ENABLED, true),
    filePath,
  };
}

function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export class InteropWritebackAuditLogger {
  private readonly config: InteropWritebackAuditLoggerConfig;

  constructor(options: InteropWritebackAuditLoggerOptions = {}) {
    const env = options.env ?? process.env;
    this.config = resolveConfig(env);
  }

  public log(event: InteropJobAttemptEvent): void {
    if (!this.config.enabled) {
      return;
    }
    ensureParentDirectory(this.config.filePath);
    fs.appendFileSync(
      this.config.filePath,
      `${JSON.stringify(event)}\n`,
      'utf8',
    );
  }
}
