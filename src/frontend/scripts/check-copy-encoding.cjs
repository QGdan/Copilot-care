const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'src');

const INCLUDE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue']);
const EXCLUDE_PATTERNS = [
  /\.test\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
  /\.d\.ts$/,
];

const SUSPECT_TOKENS = ['�', '鍚', '寰', '绛', '锛', '銆', '馃', '鈻', '鈴', '脳'];

function shouldScanFile(filePath) {
  const ext = path.extname(filePath);
  if (!INCLUDE_EXTENSIONS.has(ext)) {
    return false;
  }
  return !EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function listFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...listFiles(fullPath));
      continue;
    }
    if (entry.isFile() && shouldScanFile(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

function collectMatches(content) {
  const lines = content.split(/\r?\n/);
  const matches = [];

  lines.forEach((line, index) => {
    const hit = SUSPECT_TOKENS.find((token) => line.includes(token));
    if (!hit) {
      return;
    }

    matches.push({
      line: index + 1,
      token: hit,
      preview: line.trim().slice(0, 120),
    });
  });

  return matches;
}

function main() {
  const files = listFiles(SOURCE_DIR);
  const findings = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = collectMatches(content);
    if (matches.length === 0) {
      continue;
    }
    findings.push({
      file: path.relative(ROOT, file),
      matches,
    });
  }

  if (findings.length === 0) {
    console.log('[copy-guard] no malformed copy tokens detected.');
    return;
  }

  console.error('[copy-guard] detected suspicious copy tokens:');
  for (const finding of findings) {
    for (const match of finding.matches) {
      console.error(
        `- ${finding.file}:${match.line} token=\"${match.token}\" ${match.preview}`,
      );
    }
  }
  process.exit(1);
}

main();