#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DEFAULT_BASELINE = path.join(
  ROOT,
  'reports',
  'metrics',
  'rag-hybrid.flag-off.online.latest.json',
);
const DEFAULT_CANDIDATE = path.join(
  ROOT,
  'reports',
  'metrics',
  'rag-hybrid.flag-on.online.latest.json',
);
const DEFAULT_OUTPUT = path.join(
  ROOT,
  'reports',
  'metrics',
  'rag-hybrid-flag-compare.latest.json',
);
const DEFAULT_REPORT = path.join(
  ROOT,
  'docs',
  'process',
  'rag-hybrid-flag-compare-report.md',
);

function nowIso() {
  return new Date().toISOString();
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

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`file not found: ${path.relative(ROOT, filePath)}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalized);
}

function safeNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round(value, digits = 4) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function extractMetrics(report) {
  const metrics = report.metrics ?? {};
  return {
    sampleCount: safeNumber(report.sampleCount),
    top3HitRate: safeNumber(metrics.top3HitRate),
    mrrAt5: safeNumber(metrics.mrrAt5),
    requiredSourceCoverageRate: safeNumber(metrics.requiredSourceCoverageRate),
    redFlagEvidenceRecall: safeNumber(metrics.redFlagEvidenceRecall),
    summaryStructuredRate: safeNumber(metrics.summaryStructuredRate),
    averageLatencyMs: safeNumber(metrics.averageLatencyMs),
    realtimeShare: safeNumber(metrics.realtimeShare),
    multiSourceRate: safeNumber(metrics.multiSourceRate),
  };
}

function buildDelta(baseline, candidate) {
  return {
    top3HitRate: round(candidate.top3HitRate - baseline.top3HitRate),
    mrrAt5: round(candidate.mrrAt5 - baseline.mrrAt5),
    requiredSourceCoverageRate: round(
      candidate.requiredSourceCoverageRate - baseline.requiredSourceCoverageRate,
    ),
    redFlagEvidenceRecall: round(
      candidate.redFlagEvidenceRecall - baseline.redFlagEvidenceRecall,
    ),
    summaryStructuredRate: round(
      candidate.summaryStructuredRate - baseline.summaryStructuredRate,
    ),
    averageLatencyMs: round(candidate.averageLatencyMs - baseline.averageLatencyMs, 2),
    realtimeShare: round(candidate.realtimeShare - baseline.realtimeShare),
    multiSourceRate: round(candidate.multiSourceRate - baseline.multiSourceRate),
  };
}

function buildVerdict(delta) {
  const positive = [
    delta.top3HitRate > 0,
    delta.mrrAt5 > 0,
    delta.requiredSourceCoverageRate > 0,
    delta.redFlagEvidenceRecall > 0,
    delta.summaryStructuredRate > 0,
    delta.realtimeShare > 0,
    delta.multiSourceRate > 0,
  ].filter(Boolean).length;
  const negative = [
    delta.top3HitRate < 0,
    delta.mrrAt5 < 0,
    delta.requiredSourceCoverageRate < 0,
    delta.redFlagEvidenceRecall < 0,
    delta.summaryStructuredRate < 0,
    delta.realtimeShare < 0,
    delta.multiSourceRate < 0,
  ].filter(Boolean).length;

  const latencyTrend =
    delta.averageLatencyMs < 0
      ? 'improved'
      : delta.averageLatencyMs > 0
        ? 'degraded'
        : 'flat';
  const score = positive - negative;

  return {
    score,
    latencyTrend,
    recommendation:
      score >= 2 && latencyTrend !== 'degraded'
        ? 'recommend_enable'
        : score <= -2
          ? 'recommend_disable'
          : 'needs_canary',
  };
}

function buildMarkdown(input) {
  const lines = [];
  lines.push('# Hybrid Retriever Flag Comparison');
  lines.push('');
  lines.push(`GeneratedAt: ${input.generatedAt}`);
  lines.push('');
  lines.push('## Inputs');
  lines.push('');
  lines.push(`- baseline: \`${input.sources.baseline}\``);
  lines.push(`- candidate: \`${input.sources.candidate}\``);
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Baseline(flag off) | Candidate(flag on) | Delta(on-off) |');
  lines.push('|---|---:|---:|---:|');
  lines.push(
    `| sampleCount | ${input.baseline.sampleCount} | ${input.candidate.sampleCount} | ${input.candidate.sampleCount - input.baseline.sampleCount} |`,
  );
  lines.push(
    `| top3HitRate | ${input.baseline.top3HitRate} | ${input.candidate.top3HitRate} | ${input.delta.top3HitRate} |`,
  );
  lines.push(
    `| mrrAt5 | ${input.baseline.mrrAt5} | ${input.candidate.mrrAt5} | ${input.delta.mrrAt5} |`,
  );
  lines.push(
    `| requiredSourceCoverageRate | ${input.baseline.requiredSourceCoverageRate} | ${input.candidate.requiredSourceCoverageRate} | ${input.delta.requiredSourceCoverageRate} |`,
  );
  lines.push(
    `| redFlagEvidenceRecall | ${input.baseline.redFlagEvidenceRecall} | ${input.candidate.redFlagEvidenceRecall} | ${input.delta.redFlagEvidenceRecall} |`,
  );
  lines.push(
    `| summaryStructuredRate | ${input.baseline.summaryStructuredRate} | ${input.candidate.summaryStructuredRate} | ${input.delta.summaryStructuredRate} |`,
  );
  lines.push(
    `| realtimeShare | ${input.baseline.realtimeShare} | ${input.candidate.realtimeShare} | ${input.delta.realtimeShare} |`,
  );
  lines.push(
    `| multiSourceRate | ${input.baseline.multiSourceRate} | ${input.candidate.multiSourceRate} | ${input.delta.multiSourceRate} |`,
  );
  lines.push(
    `| averageLatencyMs | ${input.baseline.averageLatencyMs} | ${input.candidate.averageLatencyMs} | ${input.delta.averageLatencyMs} |`,
  );
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(`- score: ${input.verdict.score}`);
  lines.push(`- latencyTrend: ${input.verdict.latencyTrend}`);
  lines.push(`- recommendation: ${input.verdict.recommendation}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const baselinePath = parseOption(args, 'baseline')
    ? path.resolve(parseOption(args, 'baseline'))
    : DEFAULT_BASELINE;
  const candidatePath = parseOption(args, 'candidate')
    ? path.resolve(parseOption(args, 'candidate'))
    : DEFAULT_CANDIDATE;
  const outputPath = parseOption(args, 'output')
    ? path.resolve(parseOption(args, 'output'))
    : DEFAULT_OUTPUT;
  const reportPath = parseOption(args, 'report')
    ? path.resolve(parseOption(args, 'report'))
    : DEFAULT_REPORT;

  const baselineReport = readJson(baselinePath);
  const candidateReport = readJson(candidatePath);
  const baseline = extractMetrics(baselineReport);
  const candidate = extractMetrics(candidateReport);
  const delta = buildDelta(baseline, candidate);
  const verdict = buildVerdict(delta);

  const result = {
    generatedAt: nowIso(),
    sources: {
      baseline: path.relative(ROOT, baselinePath),
      candidate: path.relative(ROOT, candidatePath),
    },
    baseline,
    candidate,
    delta,
    verdict,
  };

  ensureDir(outputPath);
  ensureDir(reportPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reportPath, buildMarkdown(result), 'utf8');

  console.log(
    `[rag-hybrid-flag-compare] score=${result.verdict.score} ` +
      `latencyTrend=${result.verdict.latencyTrend} ` +
      `recommendation=${result.verdict.recommendation}`,
  );
  console.log(
    `[rag-hybrid-flag-compare] output=${path.relative(ROOT, outputPath)}`,
  );
  console.log(
    `[rag-hybrid-flag-compare] report=${path.relative(ROOT, reportPath)}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`[rag-hybrid-flag-compare] FAIL: ${error.message}`);
  process.exitCode = 1;
}

