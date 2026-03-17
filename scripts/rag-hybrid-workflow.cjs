#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const ENGINE_PATH = path.join(ROOT, 'scripts', 'gap-remediation-workflow.cjs');
const DEFAULT_MANIFEST = 'docs/process/rag-hybrid-workflow.v1_00.json';
const DEFAULT_STATE = 'reports/todos/rag-hybrid-state.json';
const DEFAULT_REPORT = 'reports/todos/rag-hybrid.latest.json';

function main() {
  const command = process.argv[2] || 'status';
  const passthroughArgs = process.argv.slice(3);

  const args = [
    ENGINE_PATH,
    command,
    ...passthroughArgs,
    `--manifest=${DEFAULT_MANIFEST}`,
    `--state-file=${DEFAULT_STATE}`,
    `--report=${DEFAULT_REPORT}`,
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[rag-hybrid-workflow] FAIL: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status || 0;
}

main();
