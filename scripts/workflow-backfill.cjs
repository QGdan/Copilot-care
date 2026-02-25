#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MANIFEST_ARG =
  process.argv[2] || 'docs/process/todos-workflow.v9_10-governance-neural.json';
const STATE_ARG = process.argv[3] || 'reports/todos/workflow-state.json';

function nowIso() {
  return new Date().toISOString();
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const normalized = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function fail(message) {
  console.error(`[workflow-backfill] FAIL: ${message}`);
  process.exit(1);
}

function normalizeManifestTodos(manifest) {
  if (Array.isArray(manifest.todos) && manifest.todos.length > 0) {
    return manifest.todos.map((todo) => ({
      id: todo.id,
      defaultState: todo.defaultState || todo.state || 'backlog',
    }));
  }

  if (Array.isArray(manifest.workflow) && manifest.workflow.length > 0) {
    return manifest.workflow.map((todo) => ({
      id: todo.id,
      defaultState: todo.defaultState || todo.state || 'backlog',
    }));
  }

  return [];
}

function validateManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== 'object') {
    fail(`manifest is invalid: ${manifestPath}`);
  }
  const todos = normalizeManifestTodos(manifest);
  if (todos.length === 0) {
    fail(`manifest must include non-empty todos/workflow array: ${manifestPath}`);
  }
  return todos;
}

function normalizeStateEntry(entry, fallbackState) {
  return {
    state: entry?.state || fallbackState,
    updatedAt: entry?.updatedAt || nowIso(),
    notes: typeof entry?.notes === 'string' ? entry.notes : '',
    evidence: Array.isArray(entry?.evidence) ? entry.evidence : [],
  };
}

function main() {
  const manifestPath = resolvePath(MANIFEST_ARG);
  const statePath = resolvePath(STATE_ARG);

  if (!fs.existsSync(manifestPath)) {
    fail(`manifest not found: ${path.relative(ROOT, manifestPath)}`);
  }

  const manifest = readJson(manifestPath);
  const manifestTodos = validateManifest(manifest, manifestPath);

  const state = fs.existsSync(statePath)
    ? readJson(statePath)
    : {
        version: manifest.version,
        source: manifest.source,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        todos: {},
      };

  if (!state.todos || typeof state.todos !== 'object') {
    state.todos = {};
  }

  let added = 0;
  let normalized = 0;
  const touchedTodoIds = [];

  for (const todo of manifestTodos) {
    const fallbackState = todo.defaultState || 'backlog';
    const currentEntry = state.todos[todo.id];
    if (!currentEntry) {
      state.todos[todo.id] = normalizeStateEntry(null, fallbackState);
      added += 1;
      touchedTodoIds.push(todo.id);
      continue;
    }

    const normalizedEntry = normalizeStateEntry(currentEntry, fallbackState);
    const changed =
      normalizedEntry.state !== currentEntry.state
      || normalizedEntry.updatedAt !== currentEntry.updatedAt
      || normalizedEntry.notes !== currentEntry.notes
      || normalizedEntry.evidence.length !== (currentEntry.evidence || []).length;

    if (changed) {
      state.todos[todo.id] = normalizedEntry;
      normalized += 1;
      touchedTodoIds.push(todo.id);
    }
  }

  state.version = manifest.version;
  state.source = manifest.source;
  state.updatedAt = nowIso();
  state.syncedManifests = Array.isArray(state.syncedManifests)
    ? Array.from(new Set([...state.syncedManifests, path.relative(ROOT, manifestPath)]))
    : [path.relative(ROOT, manifestPath)];
  state.lastBackfillAt = state.updatedAt;

  writeJson(statePath, state);

  console.log(
    `[workflow-backfill] synced manifest=${path.relative(ROOT, manifestPath)} added=${added} normalized=${normalized}`,
  );
  if (touchedTodoIds.length > 0) {
    console.log(`[workflow-backfill] touched todos: ${touchedTodoIds.join(', ')}`);
  }
}

main();
