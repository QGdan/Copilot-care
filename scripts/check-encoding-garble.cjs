#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGETS = [
  'src/frontend/src',
  'src/backend/src',
  'src/shared',
  'docs',
  'reports/todos',
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

const SUSPECT_TOKENS = [
  '\u951f\u65a4\u62f7', // 锟斤拷
  'Ã',
  'Â',
  '\u935a', // 鍚
  '\u5bf0', // 寰
  '\u7edb', // 绛
  '\u951b', // 锛
  '\u9286', // 銆
  '\u9983', // 馃
  '\u923b', // 鈻
  '\u9234', // 鈴
  '\u8133', // 脳
];

const MOJIBAKE_HINT_CHARS = new Set([
  '\u935a', // 鍚
  '\u5bf0', // 寰
  '\u7edb', // 绛
  '\u951b', // 锛
  '\u9286', // 銆
  '\u9983', // 馃
  '\u923b', // 鈻
  '\u9234', // 鈴
  '\u8133', // 脳
  '\u7039', // 瀹
  '\u5bb8', // 宸
  '\u7f01', // 缁
  '\u95c2', // 闂
  '\u93b4', // 鎴
  '\u93c4', // 鏄
  '\u9365', // 鍥
  '\u59af', // 妯
  '\u93ac', // 鎬
  '\u7459', // 瑙
  '\u7487', // 璇
  '\u6924', // 椤
  '\u95ab', // 閫
  '\u95c4', // 闄
  '\u93ba', // 鎺
  '\u93c1', // 鏁
  '\u9350', // 鍐
]);

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

function findLikelyMojibakeIssues(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const issues = [];

  for (let index = 0; index < lines.length; index += 1) {
    const cjkChars = lines[index].match(/[\u4E00-\u9FFF]/g);
    if (!cjkChars || cjkChars.length < 8) {
      continue;
    }

    let hintCount = 0;
    for (const char of cjkChars) {
      if (MOJIBAKE_HINT_CHARS.has(char)) {
        hintCount += 1;
      }
    }

    const hintRatio = hintCount / cjkChars.length;
    if (hintCount < 5 || hintRatio < 0.45) {
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
      ...findLikelyMojibakeIssues(filePath),
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
    console.log('[encoding-check] no garbled-text issues found');
    return;
  }

  console.error('[encoding-check] garbled-text issues detected:');
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
