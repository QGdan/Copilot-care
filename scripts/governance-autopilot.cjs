#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const POWERSHELL_EXE = 'C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe';
const DEFAULT_MANIFEST = path.join(
  ROOT,
  'docs',
  'process',
  'todos-workflow.v9_50-governance-autopilot.json',
);
const DEFAULT_STATE = path.join(ROOT, 'reports', 'todos', 'workflow-state.json');
const DEFAULT_REPORT = path.join(
  ROOT,
  'reports',
  'todos',
  'governance-v950-autopilot.latest.json',
);

const VALID_STATES = new Set([
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'review',
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
  console.log(`[governance-autopilot] ${message}`);
}

function fail(message, code = 1) {
  console.error(`[governance-autopilot] FAIL: ${message}`);
  process.exit(code);
}

function parseOption(args, name) {
  const eqToken = `--${name}=`;
  const eqHit = args.find((arg) => arg.startsWith(eqToken));
  if (eqHit) {
    return eqHit.slice(eqToken.length);
  }

  const idx = args.findIndex((arg) => arg === `--${name}`);
  if (idx >= 0 && args[idx + 1]) {
    return args[idx + 1];
  }
  return null;
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

  return manifest.workflow.map((item) => {
    if (!item || typeof item !== 'object' || !item.id) {
      fail('workflow item must contain id');
    }

    const state = item.state || item.defaultState || 'ready';
    if (!VALID_STATES.has(state)) {
      fail(`workflow item ${item.id} has invalid state: ${state}`);
    }

    const dependsOn = Array.isArray(item.dependsOn) ? item.dependsOn : [];
    const verify = Array.isArray(item.verify) ? item.verify : [];
    if (verify.length === 0) {
      fail(`workflow item ${item.id} must define verify commands`);
    }

    const evidence = Array.isArray(item.evidence) ? item.evidence : [];

    return {
      id: item.id,
      title: item.title || item.id,
      state,
      dependsOn,
      verify,
      evidence,
    };
  });
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    fail(`manifest not found: ${path.relative(ROOT, manifestPath)}`);
  }
  const manifest = readJson(manifestPath);
  const workflow = normalizeWorkflowItems(manifest);
  return {
    manifest,
    workflow,
  };
}

function loadAndSyncState(manifestPath, workflow, statePath) {
  const state = fs.existsSync(statePath)
    ? readJson(statePath)
    : {
        version: 'v9.50',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        todos: {},
      };

  if (!state.todos || typeof state.todos !== 'object') {
    state.todos = {};
  }

  let changed = false;
  let added = 0;

  for (const item of workflow) {
    const current = state.todos[item.id];
    if (!current) {
      state.todos[item.id] = {
        state: item.state,
        updatedAt: nowIso(),
        notes: '',
        evidence: [],
      };
      added += 1;
      changed = true;
      continue;
    }

    const normalizedState = VALID_STATES.has(current.state) ? current.state : item.state;
    const normalizedNotes = typeof current.notes === 'string' ? current.notes : '';
    const normalizedEvidence = Array.isArray(current.evidence) ? current.evidence : [];

    if (
      normalizedState !== current.state
      || normalizedNotes !== current.notes
      || normalizedEvidence.length !== (current.evidence || []).length
    ) {
      state.todos[item.id] = {
        state: normalizedState,
        updatedAt: current.updatedAt || nowIso(),
        notes: normalizedNotes,
        evidence: normalizedEvidence,
      };
      changed = true;
    }
  }

  state.updatedAt = nowIso();
  state.lastGovernanceManifest = path.relative(ROOT, manifestPath);
  state.syncedManifests = Array.isArray(state.syncedManifests)
    ? Array.from(new Set([...state.syncedManifests, path.relative(ROOT, manifestPath)]))
    : [path.relative(ROOT, manifestPath)];

  if (changed) {
    writeJson(statePath, state);
  }

  return { state, changed, added };
}

function getTodoState(state, item) {
  return state.todos[item.id]?.state || item.state;
}

function isDone(stateValue) {
  return stateValue === 'done';
}

function isReady(item, state) {
  const value = getTodoState(state, item);
  if (!['ready', 'backlog'].includes(value)) {
    return false;
  }
  if (!Array.isArray(item.dependsOn) || item.dependsOn.length === 0) {
    return true;
  }
  return item.dependsOn.every((depId) => {
    const depState = state.todos[depId]?.state;
    return isDone(depState);
  });
}

function printStatus(manifestPath, workflow, state) {
  const counts = {
    backlog: 0,
    ready: 0,
    in_progress: 0,
    blocked: 0,
    review: 0,
    done: 0,
  };

  for (const item of workflow) {
    const value = getTodoState(state, item);
    counts[value] = (counts[value] || 0) + 1;
  }

  const total = workflow.length;
  const done = counts.done || 0;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  console.log('== Governance Autopilot ==');
  console.log(`manifest: ${path.relative(ROOT, manifestPath)}`);
  console.log(`updatedAt: ${state.updatedAt || '-'}`);
  console.log(`progress: ${done}/${total} (${pct}%)`);
  console.log(
    `counts: backlog=${counts.backlog}, ready=${counts.ready}, in_progress=${counts.in_progress}, blocked=${counts.blocked}, review=${counts.review}, done=${counts.done}`,
  );
}

function printNext(workflow, state) {
  const rows = workflow.filter((item) => isReady(item, state));
  console.log('\n== Next Ready Items ==');
  if (rows.length === 0) {
    console.log('none');
    return;
  }

  for (const item of rows) {
    const deps = item.dependsOn.length === 0 ? '-' : item.dependsOn.join(',');
    console.log(`${item.id} ${item.title} | deps=${deps}`);
  }
}

function runShell(command) {
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

function runShellWithRetry(command, retries) {
  const maxAttempts = Math.max(1, retries);
  let last = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runShell(command);
    result.attempt = attempt;
    last = result;

    if (result.success) {
      return result;
    }

    if (attempt < maxAttempts) {
      log(`retry command="${command}" attempt=${attempt + 1}/${maxAttempts}`);
    }
  }

  return last;
}

function saveState(statePath, state) {
  state.updatedAt = nowIso();
  writeJson(statePath, state);
}

function setTodoState(state, itemId, nextState, note, evidence) {
  if (!state.todos[itemId]) {
    state.todos[itemId] = {
      state: nextState,
      updatedAt: nowIso(),
      notes: note || '',
      evidence: evidence || [],
    };
    return;
  }

  const current = state.todos[itemId];
  const mergedEvidence = Array.from(
    new Set([
      ...(Array.isArray(current.evidence) ? current.evidence : []),
      ...(Array.isArray(evidence) ? evidence : []),
    ]),
  );

  state.todos[itemId] = {
    state: nextState,
    updatedAt: nowIso(),
    notes: note || current.notes || '',
    evidence: mergedEvidence,
  };
}

function runItem(statePath, state, item, retries) {
  setTodoState(state, item.id, 'in_progress', 'autopilot running', []);
  saveState(statePath, state);

  const checks = [];
  for (const command of item.verify) {
    const result = runShellWithRetry(command, retries);
    checks.push(result);
    if (!result.success) {
      setTodoState(
        state,
        item.id,
        'blocked',
        `autopilot failed: ${command}`,
        [],
      );
      saveState(statePath, state);
      return {
        id: item.id,
        title: item.title,
        success: false,
        checks,
      };
    }
  }

  setTodoState(
    state,
    item.id,
    'done',
    'autopilot passed all verify commands',
    item.evidence,
  );
  saveState(statePath, state);

  return {
    id: item.id,
    title: item.title,
    success: true,
    checks,
  };
}

function runAutopilot(manifestPath, workflow, statePath, state, reportPath, options) {
  const max = Math.max(1, options.max);
  const retries = Math.max(1, options.retries);
  const continueOnError = options.continueOnError;

  const executed = [];
  let failed = false;

  while (executed.length < max) {
    const next = workflow.find((item) => isReady(item, state));
    if (!next) {
      break;
    }

    log(`autopilot executing ${next.id} ${next.title}`);
    const result = runItem(statePath, state, next, retries);
    executed.push(result);

    if (!result.success) {
      failed = true;
      if (!continueOnError) {
        break;
      }
    }
  }

  const done = workflow.filter((item) => getTodoState(state, item) === 'done').length;
  const blocked = workflow.filter((item) => getTodoState(state, item) === 'blocked').length;

  const report = {
    generatedAt: nowIso(),
    manifestPath: path.relative(ROOT, manifestPath),
    options: {
      max,
      retries,
      continueOnError,
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

  writeJson(reportPath, report);
  log(`autopilot report written: ${path.relative(ROOT, reportPath)}`);

  printStatus(manifestPath, workflow, state);
  printNext(workflow, state);

  if (failed) {
    fail('autopilot stopped because at least one task failed');
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/governance-autopilot.cjs sync [--manifest=docs/process/todos-workflow.v9_50-governance-autopilot.json] [--state-file=reports/todos/workflow-state.json]
  node scripts/governance-autopilot.cjs status [--manifest=...] [--state-file=...]
  node scripts/governance-autopilot.cjs next [--manifest=...] [--state-file=...]
  node scripts/governance-autopilot.cjs run [--manifest=...] [--state-file=...] [--report=reports/todos/governance-v950-autopilot.latest.json] [--max=6] [--retries=2] [--continue-on-error]
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

  if (command === 'run') {
    const max = Number.parseInt(parseOption(args, 'max') || `${workflow.length}`, 10);
    const retries = Number.parseInt(parseOption(args, 'retries') || '1', 10);
    const continueOnError = args.includes('--continue-on-error');

    runAutopilot(
      manifestPath,
      workflow,
      statePath,
      sync.state,
      reportPath,
      {
        max: Number.isNaN(max) ? workflow.length : max,
        retries: Number.isNaN(retries) ? 1 : retries,
        continueOnError,
      },
    );
    return;
  }

  printHelp();
  fail(`unknown command: ${command}`, 2);
}

main();
