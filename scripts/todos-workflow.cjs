#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'reports', 'todos', 'config.json');

function getManifestPath() {
  if (fs.existsSync(CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (config.manifestPath) {
      return path.join(ROOT, config.manifestPath);
    }
  }
  return path.join(ROOT, 'docs', 'process', 'todos-workflow.v5_00.json');
}

const MANIFEST_PATH = getManifestPath();
const STATE_PATH = path.join(ROOT, 'reports', 'todos', 'workflow-state.json');

const VALID_STATES = new Set([
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'done',
]);
const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2']);

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Guard against UTF-8 BOM so manifest/state files stay portable.
  const normalized = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function fail(message, code = 1) {
  console.error(`[todos] FAIL: ${message}`);
  process.exit(code);
}

function info(message) {
  console.log(`[todos] ${message}`);
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail(`manifest not found: ${path.relative(ROOT, MANIFEST_PATH)}`);
  }
  const manifest = readJson(MANIFEST_PATH);
  return manifest;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    fail('manifest must be an object');
  }
  if (!manifest.source || typeof manifest.source !== 'object') {
    fail('manifest.source must be an object');
  }
  if (!manifest.source.planDocument || typeof manifest.source.planDocument !== 'string') {
    fail('manifest.source.planDocument is required');
  }
  if (!Array.isArray(manifest.todos) || manifest.todos.length === 0) {
    fail('manifest.todos must be a non-empty array');
  }
  if (!Array.isArray(manifest.milestones) || manifest.milestones.length === 0) {
    fail('manifest.milestones must be a non-empty array');
  }

  const milestoneIds = new Set();
  for (const milestone of manifest.milestones) {
    if (!milestone.id || typeof milestone.id !== 'string') {
      fail('milestone.id is required');
    }
    if (milestoneIds.has(milestone.id)) {
      fail(`duplicated milestone id: ${milestone.id}`);
    }
    milestoneIds.add(milestone.id);
    if (!Array.isArray(milestone.requiredTodoIds)) {
      fail(`milestone.requiredTodoIds must be array: ${milestone.id}`);
    }
  }

  const todoIds = new Set();
  for (const todo of manifest.todos) {
    if (!todo.id || typeof todo.id !== 'string') {
      fail('todo.id is required');
    }
    if (todoIds.has(todo.id)) {
      fail(`duplicated todo id: ${todo.id}`);
    }
    todoIds.add(todo.id);

    if (!milestoneIds.has(todo.milestone)) {
      fail(`todo ${todo.id} references unknown milestone: ${todo.milestone}`);
    }

    if (!todo.defaultState || !VALID_STATES.has(todo.defaultState)) {
      fail(`todo ${todo.id} has invalid defaultState: ${todo.defaultState}`);
    }

    if (!todo.priority || !VALID_PRIORITIES.has(todo.priority)) {
      fail(`todo ${todo.id} has invalid priority: ${todo.priority}`);
    }

    if (!Array.isArray(todo.dependsOn)) {
      fail(`todo ${todo.id}.dependsOn must be array`);
    }

    if (
      !todo.commands ||
      !Array.isArray(todo.commands.verify) ||
      todo.commands.verify.length === 0
    ) {
      fail(`todo ${todo.id}.commands.verify must be a non-empty array`);
    }
  }

  for (const todo of manifest.todos) {
    for (const depId of todo.dependsOn) {
      if (!todoIds.has(depId)) {
        fail(`todo ${todo.id} depends on unknown todo: ${depId}`);
      }
      if (depId === todo.id) {
        fail(`todo ${todo.id} cannot depend on itself`);
      }
    }
  }

  for (const milestone of manifest.milestones) {
    for (const todoId of milestone.requiredTodoIds) {
      if (!todoIds.has(todoId)) {
        fail(`milestone ${milestone.id} required todo missing: ${todoId}`);
      }
    }
  }

  // detect dependency cycles to avoid deadlocked TODO graph
  const todoMap = new Map(manifest.todos.map((todo) => [todo.id, todo]));
  const visiting = new Set();
  const visited = new Set();

  function dfs(todoId) {
    if (visited.has(todoId)) {
      return;
    }
    if (visiting.has(todoId)) {
      fail(`cycle detected in todo dependencies at: ${todoId}`);
    }
    visiting.add(todoId);
    const todo = todoMap.get(todoId);
    if (!todo) {
      return;
    }
    for (const depId of todo.dependsOn) {
      dfs(depId);
    }
    visiting.delete(todoId);
    visited.add(todoId);
  }

  for (const todo of manifest.todos) {
    dfs(todo.id);
  }

  info('manifest validation passed');
}

function createStateFromManifest(manifest) {
  const todos = {};
  for (const todo of manifest.todos) {
    todos[todo.id] = {
      state: todo.defaultState,
      updatedAt: nowIso(),
      notes: '',
      evidence: [],
    };
  }

  return {
    version: manifest.version,
    source: manifest.source,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    todos,
  };
}

function loadState(manifest) {
  if (!fs.existsSync(STATE_PATH)) {
    return createStateFromManifest(manifest);
  }

  const state = readJson(STATE_PATH);
  if (!state.todos || typeof state.todos !== 'object') {
    return createStateFromManifest(manifest);
  }

  // sync with manifest (add new todos, keep existing status)
  let changed = false;
  for (const todo of manifest.todos) {
    if (!state.todos[todo.id]) {
      state.todos[todo.id] = {
        state: todo.defaultState,
        updatedAt: nowIso(),
        notes: '',
        evidence: [],
      };
      changed = true;
    }
  }

  for (const todoId of Object.keys(state.todos)) {
    if (!manifest.todos.some((todo) => todo.id === todoId)) {
      delete state.todos[todoId];
      changed = true;
    }
  }

  if (state.version !== manifest.version) {
    changed = true;
  }
  state.version = manifest.version;

  const sourceText = JSON.stringify(state.source ?? {});
  const manifestSourceText = JSON.stringify(manifest.source ?? {});
  if (sourceText !== manifestSourceText) {
    changed = true;
  }
  state.source = manifest.source;
  if (changed) {
    state.updatedAt = nowIso();
  }
  state.__syncChanged = changed;

  return state;
}

function saveState(state) {
  if (Object.prototype.hasOwnProperty.call(state, '__syncChanged')) {
    delete state.__syncChanged;
  }
  state.updatedAt = nowIso();
  writeJson(STATE_PATH, state);
}

function getTodoMap(manifest) {
  const map = new Map();
  for (const todo of manifest.todos) {
    map.set(todo.id, todo);
  }
  return map;
}

function getTodoState(state, todo) {
  const entry = state.todos[todo.id];
  if (!entry) {
    return todo.defaultState;
  }
  return entry.state;
}

function isTodoDone(manifest, state, todoId) {
  const todo = manifest.todos.find((item) => item.id === todoId);
  if (!todo) {
    return false;
  }
  return getTodoState(state, todo) === 'done';
}

function isTodoReady(manifest, state, todo) {
  const current = getTodoState(state, todo);
  if (!['backlog', 'ready'].includes(current)) {
    return false;
  }
  return todo.dependsOn.every((depId) => isTodoDone(manifest, state, depId));
}

function listReadyTodos(manifest, state) {
  return manifest.todos.filter((todo) => isTodoReady(manifest, state, todo));
}

function commandInit(manifest) {
  const state = createStateFromManifest(manifest);
  saveState(state);
  info(`initialized state: ${path.relative(ROOT, STATE_PATH)}`);
}

function commandDoctor(manifest) {
  validateManifest(manifest);
  info(`manifest file: ${path.relative(ROOT, MANIFEST_PATH)}`);
}

function commandStatus(manifest, state) {
  const counts = {
    backlog: 0,
    ready: 0,
    in_progress: 0,
    blocked: 0,
    review: 0,
    done: 0,
  };

  for (const todo of manifest.todos) {
    const current = getTodoState(state, todo);
    counts[current] = (counts[current] || 0) + 1;
  }

  console.log('== TODO Status ==');
  console.log(`manifest: ${path.relative(ROOT, MANIFEST_PATH)}`);
  console.log(`state: ${path.relative(ROOT, STATE_PATH)}`);
  console.log(`version: ${manifest.version}`);
  console.log(`updatedAt: ${state.updatedAt || '-'}`);
  console.log(
    `counts: backlog=${counts.backlog}, ready=${counts.ready}, in_progress=${counts.in_progress}, blocked=${counts.blocked}, review=${counts.review}, done=${counts.done}`,
  );

  console.log('\n== Milestone Progress ==');
  for (const milestone of manifest.milestones) {
    const total = milestone.requiredTodoIds.length;
    const done = milestone.requiredTodoIds.filter((id) =>
      isTodoDone(manifest, state, id),
    ).length;
    const ratio = total > 0 ? `${done}/${total}` : '0/0';
    console.log(`${milestone.id} ${milestone.title}: ${ratio}`);
  }

  const readyTodos = listReadyTodos(manifest, state);
  console.log('\n== Next Ready Todos ==');
  if (readyTodos.length === 0) {
    console.log('none');
    return;
  }

  for (const todo of readyTodos.slice(0, 10)) {
    console.log(
      `${todo.id} [${todo.priority}] (${todo.milestone}) ${todo.title}`,
    );
  }
}

function commandList(manifest, state, args) {
  const filters = {
    state: null,
    milestone: null,
    priority: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--state' && next) {
      filters.state = next;
      i += 1;
    } else if (arg === '--milestone' && next) {
      filters.milestone = next;
      i += 1;
    } else if (arg === '--priority' && next) {
      filters.priority = next;
      i += 1;
    }
  }

  const rows = manifest.todos.filter((todo) => {
    const current = getTodoState(state, todo);
    if (filters.state && current !== filters.state) {
      return false;
    }
    if (filters.milestone && todo.milestone !== filters.milestone) {
      return false;
    }
    if (filters.priority && todo.priority !== filters.priority) {
      return false;
    }
    return true;
  });

  if (rows.length === 0) {
    console.log('no todos matched');
    return;
  }

  for (const todo of rows) {
    console.log(
      `${todo.id} [${getTodoState(state, todo)}] [${todo.priority}] (${todo.milestone}) ${todo.title}`,
    );
  }
}

function commandNext(manifest, state) {
  const ready = listReadyTodos(manifest, state);
  if (ready.length === 0) {
    console.log('no ready todos');
    return;
  }

  for (const todo of ready) {
    const deps = todo.dependsOn.length > 0 ? todo.dependsOn.join(',') : '-';
    console.log(
      `${todo.id} [${todo.priority}] (${todo.milestone}) ${todo.title} | deps=${deps}`,
    );
  }
}

function updateTodoState(manifest, state, todoId, nextState, note, evidenceList) {
  const todo = manifest.todos.find((item) => item.id === todoId);
  if (!todo) {
    fail(`todo not found: ${todoId}`);
  }

  if (!VALID_STATES.has(nextState)) {
    fail(`invalid state: ${nextState}`);
  }

  const current = getTodoState(state, todo);
  if (!state.todos[todoId]) {
    state.todos[todoId] = {
      state: current,
      updatedAt: nowIso(),
      notes: '',
      evidence: [],
    };
  }

  if (current === 'done' && nextState !== 'done') {
    fail(`cannot change completed todo ${todoId} back to ${nextState}`);
  }

  if (nextState === 'in_progress') {
    const blockedBy = todo.dependsOn.filter(
      (depId) => !isTodoDone(manifest, state, depId),
    );
    if (blockedBy.length > 0) {
      fail(`cannot start ${todoId}, blocked by dependencies: ${blockedBy.join(', ')}`);
    }
  }

  if (nextState === 'ready') {
    const blockedBy = todo.dependsOn.filter(
      (depId) => !isTodoDone(manifest, state, depId),
    );
    if (blockedBy.length > 0) {
      fail(`cannot mark ${todoId} ready, blocked by dependencies: ${blockedBy.join(', ')}`);
    }
  }

  if (nextState === 'review' && current !== 'in_progress') {
    fail(`cannot move ${todoId} to review from ${current}, expected in_progress`);
  }

  if (nextState === 'blocked' && !note) {
    fail(`blocked todo ${todoId} requires a note`);
  }

  if (nextState === 'done') {
    if (current !== 'review') {
      fail(`cannot mark ${todoId} done from ${current}, expected review`);
    }

    const blockedBy = todo.dependsOn.filter(
      (depId) => !isTodoDone(manifest, state, depId),
    );
    if (blockedBy.length > 0) {
      fail(`cannot complete ${todoId}, blocked by dependencies: ${blockedBy.join(', ')}`);
    }

    const existingEvidence = Array.isArray(state.todos[todoId].evidence)
      ? state.todos[todoId].evidence
      : [];
    const nextEvidence = Array.isArray(evidenceList) ? evidenceList : [];
    if (existingEvidence.length + nextEvidence.length === 0) {
      fail(`cannot mark ${todoId} done without evidence`);
    }
  }

  state.todos[todoId].state = nextState;
  state.todos[todoId].updatedAt = nowIso();
  state.todos[todoId].notes = note || '';

  if (Array.isArray(evidenceList) && evidenceList.length > 0) {
    const existing = Array.isArray(state.todos[todoId].evidence)
      ? state.todos[todoId].evidence
      : [];
    state.todos[todoId].evidence = Array.from(
      new Set([...existing, ...evidenceList]),
    );
  }

  saveState(state);
  info(`${todoId} -> ${nextState}`);
}

function parseOption(args, name) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1]) {
      return args[i + 1];
    }
  }
  return null;
}

function parseEvidenceArg(args) {
  const raw = parseOption(args, '--evidence');
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function runShell(command) {
  info(`run: ${command}`);
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
  });
  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    fail(`command failed (${result.status}): ${command}`);
  }
}

function commandVerifyTodo(manifest, todoId, scope) {
  const todo = manifest.todos.find((item) => item.id === todoId);
  if (!todo) {
    fail(`todo not found: ${todoId}`);
  }

  const commandSet = todo.commands || {};
  const commands = commandSet[scope] || commandSet.verify || [];
  if (!Array.isArray(commands) || commands.length === 0) {
    info(`todo ${todoId} has no ${scope} commands, skipped`);
    return;
  }

  for (const command of commands) {
    runShell(command);
  }
}

function commandMilestone(manifest, state, milestoneId, runChecks) {
  const milestone = manifest.milestones.find((item) => item.id === milestoneId);
  if (!milestone) {
    fail(`milestone not found: ${milestoneId}`);
  }

  const missing = milestone.requiredTodoIds.filter(
    (todoId) => !isTodoDone(manifest, state, todoId),
  );

  if (missing.length > 0) {
    console.log(`[todos] milestone ${milestoneId} blocked by todos:`);
    for (const todoId of missing) {
      const todo = manifest.todos.find((item) => item.id === todoId);
      const stateValue = todo ? getTodoState(state, todo) : 'unknown';
      console.log(`- ${todoId} [${stateValue}]`);
    }
    return;
  }

  console.log(`[todos] milestone ${milestoneId} todos are complete`);

  if (runChecks) {
    const checks = milestone.gateChecks || [];
    if (checks.length === 0) {
      console.log('[todos] no gate checks configured');
      return;
    }
    for (const command of checks) {
      runShell(command);
    }
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/todos-workflow.cjs doctor
  node scripts/todos-workflow.cjs init
  node scripts/todos-workflow.cjs status
  node scripts/todos-workflow.cjs list [--state <state>] [--milestone <id>] [--priority <P0|P1|P2>]
  node scripts/todos-workflow.cjs next
  node scripts/todos-workflow.cjs start <todoId> [--note <text>]
  node scripts/todos-workflow.cjs review <todoId> [--note <text>]
  node scripts/todos-workflow.cjs block <todoId> --note <reason>
  node scripts/todos-workflow.cjs done <todoId> [--note <text>] --evidence <path1,path2>
  node scripts/todos-workflow.cjs verify <todoId> [--scope verify|full]
  node scripts/todos-workflow.cjs milestone <M6|M7|M8|M9|M10|M11|M12|M13|M14|M15> [--run]
`);
}

function main() {
  const manifestPathArg = process.argv.find(arg => arg.startsWith('--manifest='));
  let actualManifestPath = MANIFEST_PATH;
  
  if (manifestPathArg) {
    actualManifestPath = path.join(ROOT, manifestPathArg.replace('--manifest=', ''));
  }

  function loadManifest() {
    if (!fs.existsSync(actualManifestPath)) {
      fail(`manifest not found: ${path.relative(ROOT, actualManifestPath)}`);
    }
    const manifest = readJson(actualManifestPath);
    return manifest;
  }

  const manifest = loadManifest();
  const command = process.argv[2] || 'status';

  if (command === 'doctor') {
    commandDoctor(manifest);
    return;
  }

  if (command === 'use') {
    const newManifestPath = process.argv[3];
    if (!newManifestPath) {
      fail('use requires manifest path');
    }
    const fullPath = path.join(ROOT, newManifestPath);
    if (!fs.existsSync(fullPath)) {
      fail(`manifest not found: ${newManifestPath}`);
    }
    const config = { manifestPath: newManifestPath };
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    info(`Switched to manifest: ${newManifestPath}`);
    return;
  }

  validateManifest(manifest);

  if (command === 'init') {
    commandInit(manifest);
    return;
  }

  const state = loadState(manifest);
  if (!fs.existsSync(STATE_PATH) || state.__syncChanged) {
    saveState(state);
  }

  if (command === 'status') {
    commandStatus(manifest, state);
    return;
  }

  if (command === 'list') {
    commandList(manifest, state, process.argv.slice(3));
    return;
  }

  if (command === 'next') {
    commandNext(manifest, state);
    return;
  }

  if (command === 'start') {
    const todoId = process.argv[3];
    if (!todoId) {
      fail('start requires todoId');
    }
    const note = parseOption(process.argv.slice(4), '--note');
    updateTodoState(manifest, state, todoId, 'in_progress', note, []);
    return;
  }

  if (command === 'review') {
    const todoId = process.argv[3];
    if (!todoId) {
      fail('review requires todoId');
    }
    const note = parseOption(process.argv.slice(4), '--note');
    updateTodoState(manifest, state, todoId, 'review', note, []);
    return;
  }

  if (command === 'block') {
    const todoId = process.argv[3];
    if (!todoId) {
      fail('block requires todoId');
    }
    const note = parseOption(process.argv.slice(4), '--note');
    if (!note) {
      fail('block requires --note reason');
    }
    updateTodoState(manifest, state, todoId, 'blocked', note, []);
    return;
  }

  if (command === 'done') {
    const todoId = process.argv[3];
    if (!todoId) {
      fail('done requires todoId');
    }
    const note = parseOption(process.argv.slice(4), '--note');
    const evidence = parseEvidenceArg(process.argv.slice(4));
    updateTodoState(manifest, state, todoId, 'done', note, evidence);
    return;
  }

  if (command === 'verify') {
    const todoId = process.argv[3];
    if (!todoId) {
      fail('verify requires todoId');
    }
    const scope = parseOption(process.argv.slice(4), '--scope') || 'verify';
    commandVerifyTodo(manifest, todoId, scope);
    return;
  }

  if (command === 'milestone') {
    const milestoneId = process.argv[3];
    if (!milestoneId) {
      fail('milestone requires milestoneId');
    }
    const runChecks = process.argv.includes('--run');
    commandMilestone(manifest, state, milestoneId, runChecks);
    return;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  printHelp();
  fail(`unknown command: ${command}`, 2);
}

main();
