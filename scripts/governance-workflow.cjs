#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const DEFAULT_MANIFEST = path.join(
  ROOT,
  'docs',
  'process',
  'todos-workflow.v9_30-governance-deep-opt.json',
);
const DEFAULT_STATE = path.join(ROOT, 'reports', 'todos', 'workflow-state.json');
const DEFAULT_REPORT = path.join(
  ROOT,
  'reports',
  'todos',
  'governance-v930-acceptance.latest.json',
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
  console.log(`[governance-workflow] ${message}`);
}

function fail(message, code = 1) {
  console.error(`[governance-workflow] FAIL: ${message}`);
  process.exit(code);
}

function parseOption(args, name) {
  const token = `--${name}=`;
  const hit = args.find((arg) => arg.startsWith(token));
  if (!hit) {
    return null;
  }
  return hit.slice(token.length);
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
    return {
      id: item.id,
      title: item.title || item.id,
      state,
      dependsOn,
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
        version: 'v9.30',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        todos: {},
      };

  if (!state.todos || typeof state.todos !== 'object') {
    state.todos = {};
  }

  let changed = false;
  let added = 0;
  let normalized = 0;

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

    const nextState = VALID_STATES.has(current.state) ? current.state : item.state;
    const nextEvidence = Array.isArray(current.evidence) ? current.evidence : [];
    const nextNotes = typeof current.notes === 'string' ? current.notes : '';
    if (
      nextState !== current.state
      || nextNotes !== current.notes
      || nextEvidence.length !== (current.evidence || []).length
    ) {
      state.todos[item.id] = {
        state: nextState,
        updatedAt: current.updatedAt || nowIso(),
        notes: nextNotes,
        evidence: nextEvidence,
      };
      normalized += 1;
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

  return { state, added, normalized, changed };
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

  console.log('== Governance Workflow ==');
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
  const started = Date.now();
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
  });
  const durationMs = Date.now() - started;
  if (result.error) {
    return {
      command,
      status: 1,
      durationMs,
      success: false,
      error: result.error.message,
    };
  }
  return {
    command,
    status: result.status || 0,
    durationMs,
    success: result.status === 0,
    error: null,
  };
}

function runAcceptance(manifestPath, workflow, state, reportPath) {
  const commands = [
    'npm run typecheck --workspace=@copilot-care/frontend',
    'npm run test --workspace=@copilot-care/frontend -- src/components/GovernanceDashboard.test.ts src/views/GovernanceView.test.ts src/components/WorkflowStateMachine.test.ts src/components/WorkflowLayerMatrix.test.ts',
    'npm run build --workspace=@copilot-care/frontend',
    'npm run check:copy --workspace=@copilot-care/frontend',
  ];

  const results = [];
  for (const command of commands) {
    const maxAttempts = command.includes('npm run test --workspace=@copilot-care/frontend')
      ? 2
      : 1;

    let result = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      result = runShell(command);
      if (result.success) {
        if (attempt > 1) {
          log(`retry succeeded command="${command}" attempt=${attempt}`);
        }
        break;
      }

      if (attempt < maxAttempts) {
        log(`retry command="${command}" attempt=${attempt + 1}/${maxAttempts}`);
      }
    }

    results.push({
      ...result,
      attempts: maxAttempts,
    });

    if (!result || !result.success) {
      break;
    }
  }

  const allPassed = results.length === commands.length && results.every((item) => item.success);
  const total = workflow.length;
  const done = workflow.filter((item) => getTodoState(state, item) === 'done').length;

  const report = {
    generatedAt: nowIso(),
    manifestPath: path.relative(ROOT, manifestPath),
    progress: {
      done,
      total,
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
    },
    acceptance: {
      passed: allPassed,
      checks: results,
    },
  };

  writeJson(reportPath, report);
  log(`acceptance report written: ${path.relative(ROOT, reportPath)}`);

  if (!allPassed) {
    fail('acceptance checks failed');
  }
}

function updateWorkflowItemState(workflow, state, itemId, nextState, note, evidence) {
  const item = workflow.find((entry) => entry.id === itemId);
  if (!item) {
    fail(`workflow item not found: ${itemId}`);
  }
  if (!VALID_STATES.has(nextState)) {
    fail(`invalid state: ${nextState}`);
  }

  if (!state.todos[itemId]) {
    state.todos[itemId] = {
      state: item.state,
      updatedAt: nowIso(),
      notes: '',
      evidence: [],
    };
  }

  const current = state.todos[itemId];
  const mergedEvidence = Array.from(
    new Set([
      ...(Array.isArray(current.evidence) ? current.evidence : []),
      ...evidence,
    ]),
  );

  state.todos[itemId] = {
    state: nextState,
    updatedAt: nowIso(),
    notes: note ?? current.notes ?? '',
    evidence: mergedEvidence,
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/governance-workflow.cjs sync [--manifest=docs/process/todos-workflow.v9_30-governance-deep-opt.json] [--state-file=reports/todos/workflow-state.json]
  node scripts/governance-workflow.cjs status [--manifest=...] [--state-file=...]
  node scripts/governance-workflow.cjs next [--manifest=...] [--state-file=...]
  node scripts/governance-workflow.cjs set <itemId> --state=ready [--note=...] [--evidence=path1,path2]
  node scripts/governance-workflow.cjs accept [--manifest=...] [--state-file=...] [--report=reports/todos/governance-v930-acceptance.latest.json]
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
  const { state, added, normalized, changed } = loadAndSyncState(
    manifestPath,
    workflow,
    statePath,
  );

  if (command === 'sync') {
    log(
      `synced manifest=${path.relative(ROOT, manifestPath)} changed=${changed} added=${added} normalized=${normalized}`,
    );
    return;
  }

  if (command === 'status') {
    printStatus(manifestPath, workflow, state);
    return;
  }

  if (command === 'next') {
    printStatus(manifestPath, workflow, state);
    printNext(workflow, state);
    return;
  }

  if (command === 'set') {
    const itemId = process.argv[3];
    if (!itemId) {
      fail('set requires itemId');
    }
    const nextState = parseOption(args, 'state');
    if (!nextState) {
      fail('set requires --state=<state>');
    }
    const note = parseOption(args, 'note');
    const evidenceRaw = parseOption(args, 'evidence') || '';
    const evidence = evidenceRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    updateWorkflowItemState(workflow, state, itemId, nextState, note, evidence);
    writeJson(statePath, state);
    log(`updated ${itemId} -> ${nextState}`);
    return;
  }

  if (command === 'accept') {
    printStatus(manifestPath, workflow, state);
    runAcceptance(manifestPath, workflow, state, reportPath);
    return;
  }

  printHelp();
  fail(`unknown command: ${command}`, 2);
}

main();
