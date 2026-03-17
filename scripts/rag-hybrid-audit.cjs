#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DEFAULT_OFFLINE = path.join(
  ROOT,
  'reports',
  'metrics',
  'rag-hybrid.offline.latest.json',
);
const DEFAULT_ONLINE = path.join(
  ROOT,
  'reports',
  'metrics',
  'rag-hybrid.online.latest.json',
);
const DEFAULT_OUTPUT = path.join(
  ROOT,
  'reports',
  'metrics',
  'rag-hybrid-audit.latest.json',
);
const DEFAULT_REPORT = path.join(
  ROOT,
  'docs',
  'process',
  'rag-hybrid-audit-report.md',
);

const DEFAULT_THRESHOLDS = {
  offlineTop3HitRateMin: 0.98,
  offlineMrrAt5Min: 0.95,
  offlineSummaryStructuredRateMin: 0.95,
  offlineNeedDecompositionRateMin: 0.95,
  offlineProfessionalRestatementRateMin: 0.95,
  offlineSkillChainCoverageRateMin: 0.95,
  onlineTop3HitRateMin: 0.98,
  onlineMrrAt5Min: 0.9,
  onlineRequiredSourceCoverageRateMin: 0.85,
  onlineRedFlagEvidenceRecallMin: 0.93,
  onlineSummaryStructuredRateMin: 0.95,
  onlineNeedDecompositionRateMin: 0.95,
  onlineProfessionalRestatementRateMin: 0.95,
  onlineSkillChainCoverageRateMin: 0.95,
  onlineHybridStrategyRateMin: 0.9,
  onlineAverageLatencyMsMax: 20000,
};

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

function parseBoolean(value, fallback = false) {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
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

function averageCaseLatency(report) {
  if (!Array.isArray(report.cases) || report.cases.length === 0) {
    return safeNumber(report.metrics?.averageLatencyMs, 0);
  }
  const total = report.cases.reduce((acc, item) => {
    return acc + safeNumber(item.latencyMs, 0);
  }, 0);
  return Number((total / report.cases.length).toFixed(2));
}

function buildMarkdownReport(input) {
  const lines = [];
  lines.push('# Hybrid RAG Audit Report');
  lines.push('');
  lines.push(`GeneratedAt: ${input.generatedAt}`);
  lines.push('');
  lines.push('## Snapshot');
  lines.push('');
  lines.push('| Mode | top3HitRate | mrrAt5 | requiredSourceCoverage | redFlagRecall | summaryStructured | avgCaseLatencyMs |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  lines.push(
    `| offline | ${input.offline.top3HitRate} | ${input.offline.mrrAt5} | ${input.offline.requiredSourceCoverageRate} | ${input.offline.redFlagEvidenceRecall} | ${input.offline.summaryStructuredRate} | ${input.offline.averageLatencyMs} |`,
  );
  lines.push(
    `| online | ${input.online.top3HitRate} | ${input.online.mrrAt5} | ${input.online.requiredSourceCoverageRate} | ${input.online.redFlagEvidenceRecall} | ${input.online.summaryStructuredRate} | ${input.online.averageLatencyMs} |`,
  );
  lines.push('');
  lines.push('## Architecture Metrics');
  lines.push('');
  lines.push('| Mode | needDecompositionRate | professionalRestatementRate | skillChainCoverageRate | hybridStrategyRate |');
  lines.push('|---|---:|---:|---:|---:|');
  lines.push(
    `| offline | ${input.offline.needDecompositionRate} | ${input.offline.professionalRestatementRate} | ${input.offline.skillChainCoverageRate} | ${input.offline.hybridStrategyRate} |`,
  );
  lines.push(
    `| online | ${input.online.needDecompositionRate} | ${input.online.professionalRestatementRate} | ${input.online.skillChainCoverageRate} | ${input.online.hybridStrategyRate} |`,
  );
  lines.push('');
  lines.push('## Gate');
  lines.push('');
  lines.push(input.overallPass ? '- PASS' : '- BLOCK');
  if (input.breaches.length > 0) {
    for (const breach of input.breaches) {
      lines.push(`- ${breach}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function evaluateGate(snapshot, thresholds) {
  const breaches = [];
  if (snapshot.offline.top3HitRate < thresholds.offlineTop3HitRateMin) {
    breaches.push(
      `offline top3HitRate ${snapshot.offline.top3HitRate} < ${thresholds.offlineTop3HitRateMin}`,
    );
  }
  if (snapshot.offline.mrrAt5 < thresholds.offlineMrrAt5Min) {
    breaches.push(
      `offline mrrAt5 ${snapshot.offline.mrrAt5} < ${thresholds.offlineMrrAt5Min}`,
    );
  }
  if (
    snapshot.offline.summaryStructuredRate <
    thresholds.offlineSummaryStructuredRateMin
  ) {
    breaches.push(
      `offline summaryStructuredRate ${snapshot.offline.summaryStructuredRate} < ${thresholds.offlineSummaryStructuredRateMin}`,
    );
  }
  if (
    snapshot.offline.needDecompositionRate <
    thresholds.offlineNeedDecompositionRateMin
  ) {
    breaches.push(
      `offline needDecompositionRate ${snapshot.offline.needDecompositionRate} < ${thresholds.offlineNeedDecompositionRateMin}`,
    );
  }
  if (
    snapshot.offline.professionalRestatementRate <
    thresholds.offlineProfessionalRestatementRateMin
  ) {
    breaches.push(
      `offline professionalRestatementRate ${snapshot.offline.professionalRestatementRate} < ${thresholds.offlineProfessionalRestatementRateMin}`,
    );
  }
  if (
    snapshot.offline.skillChainCoverageRate <
    thresholds.offlineSkillChainCoverageRateMin
  ) {
    breaches.push(
      `offline skillChainCoverageRate ${snapshot.offline.skillChainCoverageRate} < ${thresholds.offlineSkillChainCoverageRateMin}`,
    );
  }

  if (snapshot.online.top3HitRate < thresholds.onlineTop3HitRateMin) {
    breaches.push(
      `online top3HitRate ${snapshot.online.top3HitRate} < ${thresholds.onlineTop3HitRateMin}`,
    );
  }
  if (snapshot.online.mrrAt5 < thresholds.onlineMrrAt5Min) {
    breaches.push(
      `online mrrAt5 ${snapshot.online.mrrAt5} < ${thresholds.onlineMrrAt5Min}`,
    );
  }
  if (
    snapshot.online.requiredSourceCoverageRate <
    thresholds.onlineRequiredSourceCoverageRateMin
  ) {
    breaches.push(
      `online requiredSourceCoverageRate ${snapshot.online.requiredSourceCoverageRate} < ${thresholds.onlineRequiredSourceCoverageRateMin}`,
    );
  }
  if (
    snapshot.online.redFlagEvidenceRecall <
    thresholds.onlineRedFlagEvidenceRecallMin
  ) {
    breaches.push(
      `online redFlagEvidenceRecall ${snapshot.online.redFlagEvidenceRecall} < ${thresholds.onlineRedFlagEvidenceRecallMin}`,
    );
  }
  if (
    snapshot.online.summaryStructuredRate <
    thresholds.onlineSummaryStructuredRateMin
  ) {
    breaches.push(
      `online summaryStructuredRate ${snapshot.online.summaryStructuredRate} < ${thresholds.onlineSummaryStructuredRateMin}`,
    );
  }
  if (
    snapshot.online.needDecompositionRate <
    thresholds.onlineNeedDecompositionRateMin
  ) {
    breaches.push(
      `online needDecompositionRate ${snapshot.online.needDecompositionRate} < ${thresholds.onlineNeedDecompositionRateMin}`,
    );
  }
  if (
    snapshot.online.professionalRestatementRate <
    thresholds.onlineProfessionalRestatementRateMin
  ) {
    breaches.push(
      `online professionalRestatementRate ${snapshot.online.professionalRestatementRate} < ${thresholds.onlineProfessionalRestatementRateMin}`,
    );
  }
  if (
    snapshot.online.skillChainCoverageRate <
    thresholds.onlineSkillChainCoverageRateMin
  ) {
    breaches.push(
      `online skillChainCoverageRate ${snapshot.online.skillChainCoverageRate} < ${thresholds.onlineSkillChainCoverageRateMin}`,
    );
  }
  if (
    snapshot.online.hybridStrategyRate <
    thresholds.onlineHybridStrategyRateMin
  ) {
    breaches.push(
      `online hybridStrategyRate ${snapshot.online.hybridStrategyRate} < ${thresholds.onlineHybridStrategyRateMin}`,
    );
  }
  if (
    snapshot.online.averageLatencyMs >
    thresholds.onlineAverageLatencyMsMax
  ) {
    breaches.push(
      `online averageLatencyMs ${snapshot.online.averageLatencyMs} > ${thresholds.onlineAverageLatencyMsMax}`,
    );
  }

  return {
    overallPass: breaches.length === 0,
    breaches,
  };
}

function main() {
  const args = process.argv.slice(2);
  const offlinePath = parseOption(args, 'offline')
    ? path.resolve(parseOption(args, 'offline'))
    : DEFAULT_OFFLINE;
  const onlinePath = parseOption(args, 'online')
    ? path.resolve(parseOption(args, 'online'))
    : DEFAULT_ONLINE;
  const outputPath = parseOption(args, 'output')
    ? path.resolve(parseOption(args, 'output'))
    : DEFAULT_OUTPUT;
  const reportPath = parseOption(args, 'report')
    ? path.resolve(parseOption(args, 'report'))
    : DEFAULT_REPORT;
  const enforce = parseBoolean(parseOption(args, 'enforce'), false);

  const offlineReport = readJson(offlinePath);
  const onlineReport = readJson(onlinePath);
  const thresholds = { ...DEFAULT_THRESHOLDS };

  const snapshot = {
    generatedAt: nowIso(),
    offline: {
      top3HitRate: safeNumber(offlineReport.metrics?.top3HitRate),
      mrrAt5: safeNumber(offlineReport.metrics?.mrrAt5),
      requiredSourceCoverageRate: safeNumber(
        offlineReport.metrics?.requiredSourceCoverageRate,
      ),
      redFlagEvidenceRecall: safeNumber(
        offlineReport.metrics?.redFlagEvidenceRecall,
      ),
      summaryStructuredRate: safeNumber(
        offlineReport.metrics?.summaryStructuredRate,
      ),
      needDecompositionRate: safeNumber(
        offlineReport.metrics?.needDecompositionRate,
      ),
      professionalRestatementRate: safeNumber(
        offlineReport.metrics?.professionalRestatementRate,
      ),
      skillChainCoverageRate: safeNumber(
        offlineReport.metrics?.skillChainCoverageRate,
      ),
      hybridStrategyRate: safeNumber(
        offlineReport.metrics?.hybridStrategyRate,
      ),
      averageLatencyMs: averageCaseLatency(offlineReport),
      sampleCount: safeNumber(offlineReport.sampleCount),
    },
    online: {
      top3HitRate: safeNumber(onlineReport.metrics?.top3HitRate),
      mrrAt5: safeNumber(onlineReport.metrics?.mrrAt5),
      requiredSourceCoverageRate: safeNumber(
        onlineReport.metrics?.requiredSourceCoverageRate,
      ),
      redFlagEvidenceRecall: safeNumber(
        onlineReport.metrics?.redFlagEvidenceRecall,
      ),
      summaryStructuredRate: safeNumber(
        onlineReport.metrics?.summaryStructuredRate,
      ),
      needDecompositionRate: safeNumber(
        onlineReport.metrics?.needDecompositionRate,
      ),
      professionalRestatementRate: safeNumber(
        onlineReport.metrics?.professionalRestatementRate,
      ),
      skillChainCoverageRate: safeNumber(
        onlineReport.metrics?.skillChainCoverageRate,
      ),
      hybridStrategyRate: safeNumber(
        onlineReport.metrics?.hybridStrategyRate,
      ),
      averageLatencyMs: averageCaseLatency(onlineReport),
      sampleCount: safeNumber(onlineReport.sampleCount),
    },
    sources: {
      offline: path.relative(ROOT, offlinePath),
      online: path.relative(ROOT, onlinePath),
    },
    thresholds,
  };

  const gate = evaluateGate(snapshot, thresholds);
  const result = {
    ...snapshot,
    overallPass: gate.overallPass,
    breaches: gate.breaches,
  };

  ensureDir(outputPath);
  ensureDir(reportPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reportPath, buildMarkdownReport(result), 'utf8');

  console.log(
    `[rag-hybrid-audit] offline(top3=${result.offline.top3HitRate}, mrr=${result.offline.mrrAt5}) ` +
      `online(top3=${result.online.top3HitRate}, mrr=${result.online.mrrAt5}, latency=${result.online.averageLatencyMs}ms)`,
  );
  console.log(`[rag-hybrid-audit] overallPass=${result.overallPass}`);
  console.log(`[rag-hybrid-audit] output=${path.relative(ROOT, outputPath)}`);
  console.log(`[rag-hybrid-audit] report=${path.relative(ROOT, reportPath)}`);

  if (enforce && !result.overallPass) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(`[rag-hybrid-audit] FAIL: ${error.message}`);
  process.exitCode = 1;
}
