#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const SECURITY_DIR = path.join(ROOT, 'reports', 'security');

function parseArgs(argv) {
  const args = {
    mode: 'latest',
    enforce: false,
    omitDev: false,
    maxInfo: Number.POSITIVE_INFINITY,
    maxLow: Number.POSITIVE_INFINITY,
    maxModerate: Number.POSITIVE_INFINITY,
    maxHigh: Number.POSITIVE_INFINITY,
    maxCritical: Number.POSITIVE_INFINITY,
  };

  const remaining = [...argv];
  if (remaining.length > 0 && !remaining[0].startsWith('--')) {
    args.mode = remaining.shift();
  }

  for (let index = 0; index < remaining.length; index += 1) {
    const token = remaining[index];
    if (token === '--enforce') {
      args.enforce = true;
      continue;
    }
    if (token === '--omit-dev') {
      args.omitDev = true;
      continue;
    }
    if (token.startsWith('--max-')) {
      const valueToken = remaining[index + 1];
      if (!valueToken || valueToken.startsWith('--')) {
        fail(`missing value for ${token}`);
      }
      const parsed = Number(valueToken);
      if (!Number.isFinite(parsed) || parsed < 0) {
        fail(`invalid threshold for ${token}: ${valueToken}`);
      }
      switch (token) {
        case '--max-info':
          args.maxInfo = parsed;
          break;
        case '--max-low':
          args.maxLow = parsed;
          break;
        case '--max-moderate':
          args.maxModerate = parsed;
          break;
        case '--max-high':
          args.maxHigh = parsed;
          break;
        case '--max-critical':
          args.maxCritical = parsed;
          break;
        default:
          fail(`unsupported argument: ${token}`);
      }
      index += 1;
      continue;
    }
    fail(`unsupported argument: ${token}`);
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function fail(message) {
  console.error(`[security-audit] FAIL: ${message}`);
  process.exit(1);
}

function extractJsonText(rawText) {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return rawText.slice(start, end + 1);
}

function runNpmAudit(omitDev) {
  const command = omitDev ? 'npm audit --json --omit=dev' : 'npm audit --json';
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const jsonText = extractJsonText(output);

  if (!jsonText) {
    fail('npm audit returned no parseable JSON payload.');
  }

  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch (error) {
    fail(`invalid npm audit JSON payload: ${error.message}`);
  }

  return {
    payload,
    exitCode: typeof result.status === 'number' ? result.status : 0,
  };
}

function getVulnerabilitySummary(payload) {
  const fallback = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };

  const metadata = payload && payload.metadata;
  const vulnerabilities = metadata && metadata.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    return fallback;
  }

  return {
    info: Number(vulnerabilities.info || 0),
    low: Number(vulnerabilities.low || 0),
    moderate: Number(vulnerabilities.moderate || 0),
    high: Number(vulnerabilities.high || 0),
    critical: Number(vulnerabilities.critical || 0),
    total: Number(vulnerabilities.total || 0),
  };
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function enforceThresholds(summary, limits) {
  const breaches = [];
  const comparisons = [
    { level: 'info', count: summary.info, max: limits.maxInfo },
    { level: 'low', count: summary.low, max: limits.maxLow },
    { level: 'moderate', count: summary.moderate, max: limits.maxModerate },
    { level: 'high', count: summary.high, max: limits.maxHigh },
    { level: 'critical', count: summary.critical, max: limits.maxCritical },
  ];

  for (const item of comparisons) {
    if (item.count > item.max) {
      breaches.push(`${item.level}=${item.count} > ${item.max}`);
    }
  }

  if (breaches.length > 0) {
    fail(`threshold breached: ${breaches.join(', ')}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (!['latest', 'baseline'].includes(mode)) {
    fail(`unsupported mode: ${mode}`);
  }

  ensureDir(SECURITY_DIR);
  const { payload, exitCode } = runNpmAudit(args.omitDev);
  const summary = getVulnerabilitySummary(payload);

  const wrappedPayload = {
    generatedAt: nowIso(),
    mode,
    scope: args.omitDev ? 'production' : 'all',
    npmAuditExitCode: exitCode,
    summary,
    audit: payload,
  };

  const latestPath = path.join(SECURITY_DIR, 'npm-audit.latest.json');
  writeJson(latestPath, wrappedPayload);

  if (mode === 'baseline') {
    const baselinePath = path.join(
      SECURITY_DIR,
      `npm-audit.baseline.${todayDate()}.json`,
    );
    writeJson(baselinePath, wrappedPayload);
    console.log(
      `[security-audit] baseline saved: ${path.relative(ROOT, baselinePath)}`,
    );
  }

  console.log(`[security-audit] latest saved: ${path.relative(ROOT, latestPath)}`);
  console.log(
    `[security-audit] summary: total=${summary.total}, high=${summary.high}, critical=${summary.critical}`,
  );

  if (args.enforce) {
    enforceThresholds(summary, args);
    console.log('[security-audit] threshold enforcement passed.');
  }
}

main();
