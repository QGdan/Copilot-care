#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGETS = [
  'src/frontend/src',
  'src/backend/src',
  'src/shared',
  'docs',
  'README.md',
];

const FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.cjs',
  '.mjs',
  '.vue',
  '.css',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.html',
]);

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.opencode',
]);

const SUSPECT_TOKENS = ['�', '鍚', '寰', '绛', '锛', '銆', '馃', '鈻', '鈴', '脳'];

function isFileTarget(filePath) {
  return FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walk(currentPath, files) {
  const stat = fs.statSync(currentPath);
  if (stat.isFile()) {
    if (isFileTarget(currentPath)) {
      files.push(currentPath);
    }
    return;
  }

  if (!stat.isDirectory()) {
    return;
  }

  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) {
      continue;
    }
    walk(path.join(currentPath, entry.name), files);
  }
}

function findReplacementCharIssues(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.includes('\uFFFD')) {
    return [];
  }

  const issues = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('\uFFFD')) {
      continue;
    }
    const snippet = lines[index].trim().slice(0, 120);
    issues.push({
      line: index + 1,
      snippet,
    });
  }

  return issues;
}

function findSuspectTokenIssues(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const issues = [];

  for (let index = 0; index < lines.length; index += 1) {
    const hit = SUSPECT_TOKENS.find((token) => lines[index].includes(token));
    if (!hit) {
      continue;
    }
    issues.push({
      line: index + 1,
      snippet: lines[index].trim().slice(0, 120),
    });
  }

  return issues;
}

function main() {
  const files = [];

  for (const target of TARGETS) {
    const targetPath = path.resolve(ROOT, target);
    if (!fs.existsSync(targetPath)) {
      continue;
    }
    walk(targetPath, files);
  }

  const violations = [];
  for (const filePath of files) {
    const issues = [
      ...findReplacementCharIssues(filePath),
      ...findSuspectTokenIssues(filePath),
    ];
    if (issues.length === 0) {
      continue;
    }

    violations.push({
      filePath,
      issues,
    });
  }

  if (violations.length === 0) {
    console.log('[encoding-check] no replacement-character issues found');
    return;
  }

  console.error('[encoding-check] replacement-character issues detected:');
  for (const violation of violations) {
    const relativePath = path.relative(ROOT, violation.filePath);
    console.error(`- ${relativePath}`);
    for (const issue of violation.issues) {
      console.error(`  line ${issue.line}: ${issue.snippet}`);
    }
  }

  process.exitCode = 1;
}

main();
