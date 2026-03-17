#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const POWERSHELL_EXE =
  'C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe';
const DEFAULT_MANIFEST = path.join(
  ROOT,
  'docs',
  'process',
  'gap-remediation-workflow.v10_00.json',
);
const DEFAULT_STATE = path.join(
  ROOT,
  'reports',
  'todos',
  'gap-remediation-state.json',
);
const DEFAULT_REPORT = path.join(
  ROOT,
  'reports',
  'todos',
  'gap-remediation.latest.json',
);

const VALID_STATES = new Set([
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'done',
]);

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function log(message) {
  console.log(`[gap-remediation] ${message}`);
}

function fail(message, code = 1) {
  console.error(`[gap-remediation] FAIL: ${message}`);
  process.exit(code);
}

function parseOption(args, name) {
  const eqToken = `--${name}=`;
  const eqHit = args.find((arg) => arg.startsWith(eqToken));
  if (eqHit) {
    return eqHit.slice(eqToken.length);
  }

  const index = args.findIndex((arg) => arg === `--${name}`);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return null;
}

function parseNumberOption(args, name, fallback) {
  const value = parseOption(args, name);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function extractPositionalArgs(args) {
  const positional = [];
  const optionsWithValue = new Set([
    '--manifest',
    '--state-file',
    '--report',
    '--max',
    '--retries',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token.startsWith('--')) {
      if (optionsWithValue.has(token) && args[index + 1]) {
        index += 1;
      }
      continue;
    }
    positional.push(token);
  }

  return positional;
}

function resolvePath(input, fallbackAbsolutePath) {
  if (!input) {
    return fallbackAbsolutePath;
  }
  return path.isAbsolute(input) ? input : path.join(ROOT, input);
}

function normalizeWorkflowItems(manifest) {
  if (!Array.isArray(manifest.workflow) || manifest.workflow.length === 0) {
    fail('manifest.workflow must be a non-empty array');
  }

  const ids = new Set();
  const normalized = manifest.workflow.map((item) => {
    if (!item || typeof item !== 'object' || !item.id) {
      fail('workflow item must contain id');
    }
    if (ids.has(item.id)) {
      fail(`duplicated workflow id: ${item.id}`);
    }
    ids.add(item.id);

    const state = item.state || 'ready';
    if (!VALID_STATES.has(state)) {
      fail(`workflow item ${item.id} has invalid state: ${state}`);
    }

    const verify = Array.isArray(item.verify) ? item.verify : [];
    if (verify.length === 0) {
      fail(`workflow item ${item.id} must define verify commands`);
    }

    return {
      id: item.id,
      title: item.title || item.id,
      priority: item.priority || 'P1',
      state,
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn : [],
      verify,
      rollbackPaths: Array.isArray(item.rollbackPaths)
        ? item.rollbackPaths
        : [],
      evidence: Array.isArray(item.evidence) ? item.evidence : [],
    };
  });

  for (const item of normalized) {
    for (const depId of item.dependsOn) {
      if (!ids.has(depId)) {
        fail(`workflow item ${item.id} depends on unknown id: ${depId}`);
      }
      if (depId === item.id) {
        fail(`workflow item ${item.id} cannot depend on itself`);
      }
    }
  }

  return normalized;
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    fail(`manifest not found: ${path.relative(ROOT, manifestPath)}`);
  }
  const manifest = readJson(manifestPath);
  return {
    manifest,
    workflow: normalizeWorkflowItems(manifest),
  };
}

function loadAndSyncState(manifestPath, workflow, statePath) {
  const state = fs.existsSync(statePath)
    ? readJson(statePath)
    : {
        version: 'v10.00',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        tasks: {},
      };

  if (!state.tasks || typeof state.tasks !== 'object') {
    state.tasks = {};
  }

  let changed = false;
  let added = 0;

  for (const item of workflow) {
    const current = state.tasks[item.id];
    if (!current) {
      state.tasks[item.id] = {
        state: item.state,
        updatedAt: nowIso(),
        notes: '',
        evidence: [],
      };
      changed = true;
      added += 1;
      continue;
    }

    const normalizedState = VALID_STATES.has(current.state)
      ? current.state
      : item.state;
    const normalizedNotes = typeof current.notes === 'string'
      ? current.notes
      : '';
    const normalizedEvidence = Array.isArray(current.evidence)
      ? current.evidence
      : [];

    if (
      normalizedState !== current.state
      || normalizedNotes !== current.notes
      || normalizedEvidence.length !== (current.evidence || []).length
    ) {
      state.tasks[item.id] = {
        state: normalizedState,
        updatedAt: current.updatedAt || nowIso(),
        notes: normalizedNotes,
        evidence: normalizedEvidence,
      };
      changed = true;
    }
  }

  for (const taskId of Object.keys(state.tasks)) {
    if (!workflow.some((item) => item.id === taskId)) {
      delete state.tasks[taskId];
      changed = true;
    }
  }

  state.updatedAt = nowIso();
  state.lastManifest = path.relative(ROOT, manifestPath);

  if (changed) {
    writeJson(statePath, state);
  }

  return { state, changed, added };
}

function getTaskState(state, item) {
  return state.tasks[item.id]?.state || item.state;
}

function isDone(stateValue) {
  return stateValue === 'done';
}

function isReady(item, state) {
  const stateValue = getTaskState(state, item);
  if (!['ready', 'backlog'].includes(stateValue)) {
    return false;
  }
  return item.dependsOn.every((depId) => isDone(state.tasks[depId]?.state));
}

function printStatus(manifestPath, workflow, state) {
  const counts = {
    backlog: 0,
    ready: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
  };

  for (const item of workflow) {
    const value = getTaskState(state, item);
    counts[value] = (counts[value] || 0) + 1;
  }

  const total = workflow.length;
  const done = counts.done || 0;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  console.log('== Gap Remediation Workflow ==');
  console.log(`manifest: ${path.relative(ROOT, manifestPath)}`);
  console.log(`updatedAt: ${state.updatedAt || '-'}`);
  console.log(`progress: ${done}/${total} (${percent}%)`);
  console.log(
    `counts: backlog=${counts.backlog}, ready=${counts.ready}, in_progress=${counts.in_progress}, blocked=${counts.blocked}, done=${counts.done}`,
  );
}

function printNext(workflow, state) {
  const rows = workflow.filter((item) => isReady(item, state));
  console.log('\n== Next Ready Tasks ==');
  if (rows.length === 0) {
    console.log('none');
    return;
  }

  for (const item of rows) {
    const deps = item.dependsOn.length === 0 ? '-' : item.dependsOn.join(',');
    console.log(`${item.id} [${item.priority}] ${item.title} | deps=${deps}`);
  }
}

function runPowerShell(command) {
  log(`run: ${command}`);
  const startedAt = Date.now();
  const result = spawnSync(POWERSHELL_EXE, ['-Command', command], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const durationMs = Date.now() - startedAt;

  if (result.error) {
    return {
      command,
      success: false,
      status: 1,
      durationMs,
      error: result.error.message,
      attempt: 1,
    };
  }

  return {
    command,
    success: result.status === 0,
    status: result.status || 0,
    durationMs,
    error: null,
    attempt: 1,
  };
}

function runPowerShellWithRetry(command, retries) {
  const maxAttempts = Math.max(1, retries);
  let latest = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runPowerShell(command);
    result.attempt = attempt;
    latest = result;
    if (result.success) {
      return result;
    }
    if (attempt < maxAttempts) {
      log(`retry command="${command}" attempt=${attempt + 1}/${maxAttempts}`);
    }
  }

  return latest;
}

function runGitRestore(pathsToRestore) {
  if (!Array.isArray(pathsToRestore) || pathsToRestore.length === 0) {
    return {
      command: 'git restore --worktree --staged -- <none>',
      success: true,
      status: 0,
      durationMs: 0,
      skipped: true,
    };
  }

  const command = `git restore --worktree --staged -- ${pathsToRestore.join(' ')}`;
  log(`rollback: ${command}`);
  const startedAt = Date.now();
  const result = spawnSync(
    'git',
    ['restore', '--worktree', '--staged', '--', ...pathsToRestore],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );
  const durationMs = Date.now() - startedAt;

  if (result.error) {
    return {
      command,
      success: false,
      status: 1,
      durationMs,
      error: result.error.message,
    };
  }

  return {
    command,
    success: result.status === 0,
    status: result.status || 0,
    durationMs,
    error: null,
  };
}

function saveState(statePath, state) {
  state.updatedAt = nowIso();
  writeJson(statePath, state);
}

function setTaskState(state, itemId, nextState, note, evidence) {
  if (!state.tasks[itemId]) {
    state.tasks[itemId] = {
      state: nextState,
      updatedAt: nowIso(),
      notes: note || '',
      evidence: evidence || [],
    };
    return;
  }

  const current = state.tasks[itemId];
  const mergedEvidence = Array.from(
    new Set([
      ...(Array.isArray(current.evidence) ? current.evidence : []),
      ...(Array.isArray(evidence) ? evidence : []),
    ]),
  );

  state.tasks[itemId] = {
    state: nextState,
    updatedAt: nowIso(),
    notes: note || current.notes || '',
    evidence: mergedEvidence,
  };
}

function executeTask(statePath, state, item, options) {
  setTaskState(state, item.id, 'in_progress', 'workflow running', []);
  saveState(statePath, state);

  const checks = [];
  for (const command of item.verify) {
    const result = runPowerShellWithRetry(command, options.retries);
    checks.push(result);
    if (!result.success) {
      let rollbackResult = null;
      if (options.rollbackOnFailure) {
        rollbackResult = runGitRestore(item.rollbackPaths);
      }

      setTaskState(
        state,
        item.id,
        'blocked',
        `failed command: ${command}`,
        [],
      );
      saveState(statePath, state);
      return {
        id: item.id,
        title: item.title,
        success: false,
        checks,
        rollback: rollbackResult,
      };
    }
  }

  setTaskState(
    state,
    item.id,
    'done',
    'all verification commands passed',
    item.evidence,
  );
  saveState(statePath, state);

  return {
    id: item.id,
    title: item.title,
    success: true,
    checks,
    rollback: null,
  };
}

function saveReport(reportPath, payload) {
  writeJson(reportPath, payload);
  log(`report written: ${path.relative(ROOT, reportPath)}`);
}

function runWorkflow(manifestPath, workflow, statePath, state, reportPath, options) {
  const max = Math.max(1, options.max);
  const executed = [];
  let failed = false;

  while (executed.length < max) {
    const next = workflow.find((item) => isReady(item, state));
    if (!next) {
      break;
    }
    log(`execute ${next.id} ${next.title}`);
    const result = executeTask(statePath, state, next, options);
    executed.push(result);
    if (!result.success) {
      failed = true;
      if (!options.continueOnError) {
        break;
      }
    }
  }

  const done = workflow.filter((item) => getTaskState(state, item) === 'done').length;
  const blocked = workflow.filter(
    (item) => getTaskState(state, item) === 'blocked',
  ).length;

  const report = {
    generatedAt: nowIso(),
    manifestPath: path.relative(ROOT, manifestPath),
    options: {
      max,
      retries: options.retries,
      continueOnError: options.continueOnError,
      rollbackOnFailure: options.rollbackOnFailure,
    },
    summary: {
      executed: executed.length,
      failed,
      done,
      total: workflow.length,
      blocked,
      percent: workflow.length === 0 ? 0 : Math.round((done / workflow.length) * 100),
    },
    executed,
  };
  saveReport(reportPath, report);
  printStatus(manifestPath, workflow, state);
  printNext(workflow, state);

  if (failed) {
    fail('workflow stopped because at least one task failed');
  }
}

function runSingleTask(manifestPath, workflow, statePath, state, reportPath, taskId, options) {
  const item = workflow.find((task) => task.id === taskId);
  if (!item) {
    fail(`task not found: ${taskId}`);
  }

  const blockedBy = item.dependsOn.filter(
    (depId) => !isDone(state.tasks[depId]?.state),
  );
  if (blockedBy.length > 0) {
    fail(`task ${taskId} blocked by dependencies: ${blockedBy.join(', ')}`);
  }

  const result = executeTask(statePath, state, item, options);
  const report = {
    generatedAt: nowIso(),
    manifestPath: path.relative(ROOT, manifestPath),
    mode: 'accept',
    taskId,
    options: {
      retries: options.retries,
      rollbackOnFailure: options.rollbackOnFailure,
    },
    result,
  };
  saveReport(reportPath, report);
  printStatus(manifestPath, workflow, state);
  printNext(workflow, state);

  if (!result.success) {
    fail(`task ${taskId} failed verification`);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/gap-remediation-workflow.cjs sync [--manifest=docs/process/gap-remediation-workflow.v10_00.json] [--state-file=reports/todos/gap-remediation-state.json]
  node scripts/gap-remediation-workflow.cjs status [--manifest=...] [--state-file=...]
  node scripts/gap-remediation-workflow.cjs next [--manifest=...] [--state-file=...]
  node scripts/gap-remediation-workflow.cjs run [--manifest=...] [--state-file=...] [--report=reports/todos/gap-remediation.latest.json] [--max=6] [--retries=1] [--continue-on-error] [--no-rollback]
  node scripts/gap-remediation-workflow.cjs accept <TASK_ID> [--manifest=...] [--state-file=...] [--report=...] [--retries=1] [--no-rollback]
`);
}

function main() {
  const command = process.argv[2] || 'status';
  if (['help', '--help', '-h'].includes(command)) {
    printHelp();
    return;
  }

  const args = process.argv.slice(3);
  const manifestPath = resolvePath(parseOption(args, 'manifest'), DEFAULT_MANIFEST);
  const statePath = resolvePath(parseOption(args, 'state-file'), DEFAULT_STATE);
  const reportPath = resolvePath(parseOption(args, 'report'), DEFAULT_REPORT);

  const { workflow } = loadManifest(manifestPath);
  const sync = loadAndSyncState(manifestPath, workflow, statePath);

  if (command === 'sync') {
    log(
      `synced manifest=${path.relative(ROOT, manifestPath)} changed=${sync.changed} added=${sync.added}`,
    );
    return;
  }

  if (command === 'status') {
    printStatus(manifestPath, workflow, sync.state);
    return;
  }

  if (command === 'next') {
    printStatus(manifestPath, workflow, sync.state);
    printNext(workflow, sync.state);
    return;
  }

  const options = {
    max: parseNumberOption(args, 'max', workflow.length),
    retries: Math.max(1, parseNumberOption(args, 'retries', 1)),
    continueOnError: args.includes('--continue-on-error'),
    rollbackOnFailure: !args.includes('--no-rollback'),
  };

  if (command === 'run') {
    runWorkflow(
      manifestPath,
      workflow,
      statePath,
      sync.state,
      reportPath,
      options,
    );
    return;
  }

  if (command === 'accept') {
    const positional = extractPositionalArgs(args);
    const taskId = positional[0];
    if (!taskId) {
      fail('accept requires TASK_ID');
    }
    const acceptArgs = args;
    const acceptOptions = {
      retries: Math.max(1, parseNumberOption(acceptArgs, 'retries', 1)),
      rollbackOnFailure: !acceptArgs.includes('--no-rollback'),
    };
    runSingleTask(
      manifestPath,
      workflow,
      statePath,
      sync.state,
      reportPath,
      taskId,
      acceptOptions,
    );
    return;
  }

  printHelp();
  fail(`unknown command: ${command}`, 2);
}

main();
