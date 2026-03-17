const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const ROOT = process.cwd();
const DEFAULT_REQUESTS_PATH = path.join(
  ROOT,
  'data',
  'processed',
  'chronic_disease_dataset',
  'triage_requests.test.ndjson',
);
const DEFAULT_EVAL_CASES_PATH = path.join(
  ROOT,
  'data',
  'processed',
  'chronic_disease_dataset',
  'evaluation_cases.ndjson',
);
const DEFAULT_OUTPUT_JSON = path.join(
  ROOT,
  'reports',
  'metrics',
  'rag-eval.latest.json',
);
const DEFAULT_OUTPUT_MD = path.join(
  ROOT,
  'docs',
  'process',
  'rag-eval-report.md',
);

const DEFAULT_THRESHOLDS = {
  top3HitRateMin: 0.7,
  mrrAt5Min: 0.45,
  requiredSourceCoverageRateMin: 0.8,
  summaryStructuredRateMin: 0.9,
  needDecompositionRateMin: 0.95,
  professionalRestatementRateMin: 0.95,
  skillChainCoverageRateMin: 0.95,
  hybridStrategyRateMin: 0.9,
  averageLatencyMsMax: 120000,
  averageEvaluationTimeMsMax: 120000,
};

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseArgs(argv) {
  const args = {
    requests: DEFAULT_REQUESTS_PATH,
    evalCases: DEFAULT_EVAL_CASES_PATH,
    output: DEFAULT_OUTPUT_JSON,
    report: DEFAULT_OUTPUT_MD,
    limit: 120,
    network: false,
    enforce: false,
    hybrid: true,
    timeoutMs: 8000,
  };

  for (const raw of argv) {
    if (!raw.startsWith('--')) {
      continue;
    }
    const [key, valueRaw = ''] = raw.slice(2).split('=');
    const value = valueRaw.trim();
    if (key === 'requests' && value) {
      args.requests = path.resolve(value);
      continue;
    }
    if (key === 'eval-cases' && value) {
      args.evalCases = path.resolve(value);
      continue;
    }
    if (key === 'output' && value) {
      args.output = path.resolve(value);
      continue;
    }
    if (key === 'report' && value) {
      args.report = path.resolve(value);
      continue;
    }
    if (key === 'limit' && /^\d+$/.test(value)) {
      args.limit = Math.max(1, Number(value));
      continue;
    }
    if (key === 'network') {
      args.network = ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
      continue;
    }
    if (key === 'enforce') {
      args.enforce = ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
      continue;
    }
    if (key === 'hybrid') {
      args.hybrid = ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
      continue;
    }
    if (key === 'timeout-ms' && /^\d+$/.test(value)) {
      args.timeoutMs = Math.max(1000, Number(value));
      continue;
    }
  }

  return args;
}

function normalizeText(value) {
  return (value || '').toString().trim().toLowerCase();
}

function loadNdjson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid ndjson at ${filePath}:${index + 1} -> ${error.message}`);
      }
    });
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, item) => acc + item, 0);
  return Number((sum / values.length).toFixed(4));
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function pickCases(requests, evalCases, limit) {
  const evalByRequestId = new Map(
    evalCases
      .filter((item) => typeof item.requestId === 'string')
      .map((item) => [item.requestId.trim(), item]),
  );

  const aligned = [];
  for (const request of requests) {
    const requestId = typeof request.requestId === 'string'
      ? request.requestId.trim()
      : '';
    if (!requestId) {
      continue;
    }
    const evalCase = evalByRequestId.get(requestId);
    if (!evalCase) {
      continue;
    }
    aligned.push({ request, evalCase });
    if (aligned.length >= limit) {
      break;
    }
  }
  return aligned;
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# RAG Offline Evaluation Report');
  lines.push('');
  lines.push(`GeneratedAt: ${report.generatedAt}`);
  lines.push(`SampleCount: ${report.sampleCount}`);
  lines.push(`NetworkEnabled: ${report.config.networkEnabled}`);
  lines.push(`AverageLatencyMs: ${report.metrics.averageLatencyMs}`);
  lines.push(`AverageEvaluationTimeMs: ${report.metrics.averageEvaluationTimeMs}`);
  lines.push(`TotalRuntimeMs: ${report.metrics.totalRuntimeMs}`);
  lines.push('');
  lines.push('## Core Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---:|');
  lines.push(`| top3HitRate | ${report.metrics.top3HitRate} |`);
  lines.push(`| mrrAt5 | ${report.metrics.mrrAt5} |`);
  lines.push(`| requiredSourceCoverageRate | ${report.metrics.requiredSourceCoverageRate} |`);
  lines.push(`| multiSourceRate | ${report.metrics.multiSourceRate} |`);
  lines.push(`| realtimeShare | ${report.metrics.realtimeShare} |`);
  lines.push(`| summaryStructuredRate | ${report.metrics.summaryStructuredRate} |`);
  lines.push(`| redFlagEvidenceRecall | ${report.metrics.redFlagEvidenceRecall} |`);
  lines.push(`| needDecompositionRate | ${report.metrics.needDecompositionRate} |`);
  lines.push(`| professionalRestatementRate | ${report.metrics.professionalRestatementRate} |`);
  lines.push(`| skillChainCoverageRate | ${report.metrics.skillChainCoverageRate} |`);
  lines.push(`| hybridStrategyRate | ${report.metrics.hybridStrategyRate} |`);
  lines.push(`| averageLatencyMs | ${report.metrics.averageLatencyMs} |`);
  lines.push(`| averageEvaluationTimeMs | ${report.metrics.averageEvaluationTimeMs} |`);
  lines.push('');
  lines.push('## Disease Slice');
  lines.push('');
  lines.push('| Slice | cases | top3HitRate | mrrAt5 |');
  lines.push('|---|---:|---:|---:|');
  for (const item of report.diseaseSlices) {
    lines.push(
      `| ${item.label} | ${item.caseCount} | ${item.top3HitRate} | ${item.mrrAt5} |`,
    );
  }
  lines.push('');
  lines.push('## Hard Cases');
  lines.push('');
  lines.push('| caseId | riskLevel | firstRelevantRank | usedSources | query |');
  lines.push('|---|---|---:|---|---|');
  for (const item of report.hardCases) {
    lines.push(
      `| ${item.caseId} | ${item.riskLevel} | ${item.firstRelevantRank || '-'} | ${item.usedSources.join(',') || '-'} | ${item.query.replace(/\|/g, '/')} |`,
    );
  }
  lines.push('');
  lines.push('## Gate');
  lines.push('');
  lines.push(report.overallPass ? '- PASS' : '- BLOCK');
  if (!report.overallPass && report.breached.length > 0) {
    for (const item of report.breached) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function resolveThresholds() {
  const raw = process.env.COPILOT_CARE_RAG_EVAL_THRESHOLDS;
  if (!raw) {
    return { ...DEFAULT_THRESHOLDS };
  }
  const parsed = JSON.parse(raw);
  const merged = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(merged)) {
    const value = parsed[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      merged[key] = value;
    }
  }
  return merged;
}

function evaluateGate(metrics, thresholds) {
  const breached = [];
  if (metrics.top3HitRate < thresholds.top3HitRateMin) {
    breached.push(
      `top3HitRate ${metrics.top3HitRate} < ${thresholds.top3HitRateMin}`,
    );
  }
  if (metrics.mrrAt5 < thresholds.mrrAt5Min) {
    breached.push(`mrrAt5 ${metrics.mrrAt5} < ${thresholds.mrrAt5Min}`);
  }
  if (metrics.requiredSourceCoverageRate < thresholds.requiredSourceCoverageRateMin) {
    breached.push(
      `requiredSourceCoverageRate ${metrics.requiredSourceCoverageRate} < ${thresholds.requiredSourceCoverageRateMin}`,
    );
  }
  if (metrics.summaryStructuredRate < thresholds.summaryStructuredRateMin) {
    breached.push(
      `summaryStructuredRate ${metrics.summaryStructuredRate} < ${thresholds.summaryStructuredRateMin}`,
    );
  }
  if (metrics.needDecompositionRate < thresholds.needDecompositionRateMin) {
    breached.push(
      `needDecompositionRate ${metrics.needDecompositionRate} < ${thresholds.needDecompositionRateMin}`,
    );
  }
  if (
    metrics.professionalRestatementRate <
    thresholds.professionalRestatementRateMin
  ) {
    breached.push(
      `professionalRestatementRate ${metrics.professionalRestatementRate} < ${thresholds.professionalRestatementRateMin}`,
    );
  }
  if (metrics.skillChainCoverageRate < thresholds.skillChainCoverageRateMin) {
    breached.push(
      `skillChainCoverageRate ${metrics.skillChainCoverageRate} < ${thresholds.skillChainCoverageRateMin}`,
    );
  }
  if (metrics.hybridStrategyRate < thresholds.hybridStrategyRateMin) {
    breached.push(
      `hybridStrategyRate ${metrics.hybridStrategyRate} < ${thresholds.hybridStrategyRateMin}`,
    );
  }
  if (
    typeof thresholds.averageLatencyMsMax === 'number'
    && Number.isFinite(thresholds.averageLatencyMsMax)
    && metrics.averageLatencyMs > thresholds.averageLatencyMsMax
  ) {
    breached.push(
      `averageLatencyMs ${metrics.averageLatencyMs} > ${thresholds.averageLatencyMsMax}`,
    );
  }
  if (
    typeof thresholds.averageEvaluationTimeMsMax === 'number'
    && Number.isFinite(thresholds.averageEvaluationTimeMsMax)
    && metrics.averageEvaluationTimeMs > thresholds.averageEvaluationTimeMsMax
  ) {
    breached.push(
      `averageEvaluationTimeMs ${metrics.averageEvaluationTimeMs} > ${thresholds.averageEvaluationTimeMsMax}`,
    );
  }
  return {
    overallPass: breached.length === 0,
    breached,
  };
}

function loadBackendRuntimeModules() {
  const searchModulePath = path.join(
    ROOT,
    'src',
    'backend',
    'dist',
    'infrastructure',
    'knowledge',
    'medical-search',
    'service.js',
  );
  if (!fs.existsSync(searchModulePath)) {
    throw new Error(
      'backend dist missing, run `npm run build --workspace=@copilot-care/backend` first.',
    );
  }
  const searchModule = require(searchModulePath);
  const planModule = require(path.join(
    ROOT,
    'src',
    'backend',
    'dist',
    'application',
    'services',
    'RuleDrivenEvidenceSearchPlanService.js',
  ));
  const riskModule = require(path.join(
    ROOT,
    'src',
    'backend',
    'dist',
    'application',
    'services',
    'RuleFirstRiskAssessmentService.js',
  ));
  const evalModule = require(path.join(
    ROOT,
    'src',
    'backend',
    'dist',
    'infrastructure',
    'knowledge',
    'medical-search',
    'evaluation.js',
  ));

  return {
    AuthoritativeMedicalWebSearchService:
      searchModule.AuthoritativeMedicalWebSearchService,
    RuleDrivenEvidenceSearchPlanService:
      planModule.RuleDrivenEvidenceSearchPlanService,
    RuleFirstRiskAssessmentService:
      riskModule.RuleFirstRiskAssessmentService,
    evaluateSingleRetrievalCase: evalModule.evaluateSingleRetrievalCase,
    aggregateRetrievalEvaluations: evalModule.aggregateRetrievalEvaluations,
  };
}

function resolveDiseaseSliceLabel(expected) {
  if (expected.hasHypertension && expected.hasDiabetes) {
    return 'hypertension+diabetes';
  }
  if (expected.hasHypertension) {
    return 'hypertension';
  }
  if (expected.hasDiabetes) {
    return 'diabetes';
  }
  if (expected.hasHeartDisease) {
    return 'heart-disease';
  }
  return 'mixed-other';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const thresholds = resolveThresholds();
  if (!args.hybrid) {
    thresholds.hybridStrategyRateMin = 0;
  }
  const alignedCases = pickCases(
    loadNdjson(args.requests),
    loadNdjson(args.evalCases),
    args.limit,
  );

  if (alignedCases.length === 0) {
    throw new Error('no aligned request/evaluation cases found');
  }

  const {
    AuthoritativeMedicalWebSearchService,
    RuleDrivenEvidenceSearchPlanService,
    RuleFirstRiskAssessmentService,
    evaluateSingleRetrievalCase,
    aggregateRetrievalEvaluations,
  } = loadBackendRuntimeModules();

  const searchService = new AuthoritativeMedicalWebSearchService({
    enabled: true,
    networkEnabled: args.network,
    timeoutMs: args.timeoutMs,
    maxResults: 8,
    pubMedRetMax: 6,
    duckDuckGoEnabled: true,
    allowPartialSeedFill: true,
    hybridRetrievalEnabled: args.hybrid,
  });
  const planService = new RuleDrivenEvidenceSearchPlanService();
  const riskService = new RuleFirstRiskAssessmentService();

  const rows = [];
  const caseEvaluations = [];
  const t0 = performance.now();

  for (const item of alignedCases) {
    const started = performance.now();
    const request = item.request;
    const evalCase = item.evalCase;
    const risk = riskService.evaluate(request.profile, request.signals || []);
    const plan = planService.build({ request, risk });
    const result = await searchService.search({
      query: plan.query,
      queryVariants: plan.queryVariants,
      limit: plan.limit,
      sourceFilter: plan.sourceFilter,
      requiredSources: plan.requiredSources,
    });

    const expected = {
      hasHypertension: Boolean(evalCase.expected?.diseaseFlags?.hasHypertension),
      hasDiabetes: Boolean(evalCase.expected?.diseaseFlags?.hasDiabetes),
      hasHeartDisease: Boolean(evalCase.expected?.diseaseFlags?.hasHeartDisease),
      redFlagSuggested: Boolean(evalCase.expected?.riskHints?.redFlagSuggested),
    };
    const judged = evaluateSingleRetrievalCase({
      results: result.results,
      expected,
    });
    const requiredCovered = plan.requiredSources.every((sourceId) =>
      result.usedSources.includes(sourceId),
    );
    const realtimeShare =
      result.results.length > 0
        ? Number((result.realtimeCount / result.results.length).toFixed(4))
        : 0;
    const latencyMs = Number((performance.now() - started).toFixed(2));

    rows.push({
      caseId: evalCase.caseId,
      requestId: request.requestId,
      riskLevel: risk.riskLevel,
      firstRelevantRank: judged.firstRelevantRank,
      hitAt3: judged.hitAt3,
      mrrAt5: judged.mrrAt5,
      redFlagExpected: expected.redFlagSuggested,
      redFlagHit: judged.redFlagHit,
      summaryStructuredRate: judged.summaryStructuredRate,
      requiredSources: plan.requiredSources,
      requiredSourceCovered: requiredCovered,
      usedSources: result.usedSources,
      sourceBreakdown: result.sourceBreakdown,
      resultCount: result.results.length,
      realtimeShare,
      query: plan.query,
      queryVariants: plan.queryVariants,
      decomposedNeeds: plan.decomposedNeeds,
      professionalRestatement: plan.professionalRestatement,
      activatedSkills: plan.activatedSkills,
      strategyVersion: result.strategyVersion,
      latencyMs,
      diseaseSlice: resolveDiseaseSliceLabel(expected),
    });

    caseEvaluations.push({
      ...judged,
      redFlagExpected: expected.redFlagSuggested,
    });
  }

  const totalRuntimeMs = Number((performance.now() - t0).toFixed(2));
  const aggregated = aggregateRetrievalEvaluations(caseEvaluations);
  const metrics = {
    top3HitRate: aggregated.top3HitRate,
    mrrAt5: aggregated.mrrAt5,
    redFlagEvidenceRecall: aggregated.redFlagRecall,
    summaryStructuredRate: aggregated.summaryStructuredRate,
    requiredSourceCoverageRate: average(
      rows.map((item) => (item.requiredSourceCovered ? 1 : 0)),
    ),
    multiSourceRate: average(
      rows.map((item) => (item.usedSources.length >= 2 ? 1 : 0)),
    ),
    realtimeShare: average(rows.map((item) => item.realtimeShare)),
    needDecompositionRate: average(
      rows.map((item) =>
        Array.isArray(item.decomposedNeeds) && item.decomposedNeeds.length > 0
          ? 1
          : 0,
      ),
    ),
    professionalRestatementRate: average(
      rows.map((item) =>
        typeof item.professionalRestatement === 'string'
        && item.professionalRestatement.trim().length > 0
          ? 1
          : 0,
      ),
    ),
    skillChainCoverageRate: average(
      rows.map((item) =>
        Array.isArray(item.activatedSkills) && item.activatedSkills.length > 0
          ? 1
          : 0,
      ),
    ),
    hybridStrategyRate: average(
      rows.map((item) =>
        typeof item.strategyVersion === 'string'
        && item.strategyVersion.includes('+hybrid')
          ? 1
          : 0,
      ),
    ),
    averageLatencyMs: average(rows.map((item) => item.latencyMs)),
    averageEvaluationTimeMs: Number((totalRuntimeMs / Math.max(1, rows.length)).toFixed(4)),
    totalRuntimeMs,
  };

  const grouped = new Map();
  for (const item of rows) {
    const bucket = grouped.get(item.diseaseSlice) || [];
    bucket.push(item);
    grouped.set(item.diseaseSlice, bucket);
  }
  const diseaseSlices = [...grouped.entries()].map(([label, sliceRows]) => ({
    label,
    caseCount: sliceRows.length,
    top3HitRate: average(sliceRows.map((item) => (item.hitAt3 ? 1 : 0))),
    mrrAt5: average(sliceRows.map((item) => item.mrrAt5)),
  }));

  const hardCases = [...rows]
    .filter((item) => !item.hitAt3 || !item.requiredSourceCovered)
    .sort((left, right) => {
      const leftRank = left.firstRelevantRank || 999;
      const rightRank = right.firstRelevantRank || 999;
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return right.latencyMs - left.latencyMs;
    })
    .slice(0, 15)
    .map((item) => ({
      caseId: item.caseId,
      riskLevel: item.riskLevel,
      firstRelevantRank: item.firstRelevantRank,
      usedSources: item.usedSources,
      query: item.query,
    }));

  const gate = evaluateGate(metrics, thresholds);
  const report = {
    generatedAt: new Date().toISOString(),
    sampleCount: rows.length,
    config: {
      networkEnabled: args.network,
      limit: args.limit,
      hybridEnabled: args.hybrid,
      timeoutMs: args.timeoutMs,
    },
    metrics,
    thresholds,
    overallPass: gate.overallPass,
    breached: gate.breached,
    diseaseSlices,
    hardCases,
    cases: rows,
  };

  ensureDir(args.output);
  ensureDir(args.report);
  fs.writeFileSync(args.output, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(args.report, buildMarkdownReport(report), 'utf8');

  console.log(`[rag-eval] sample=${rows.length} top3Hit=${metrics.top3HitRate} mrrAt5=${metrics.mrrAt5}`);
  console.log(
    `[rag-eval] perf avgLatencyMs=${metrics.averageLatencyMs} avgEvaluationTimeMs=${metrics.averageEvaluationTimeMs}`,
  );
  console.log(`[rag-eval] report=${args.output}`);
  console.log(`[rag-eval] markdown=${args.report}`);

  if (args.enforce && !gate.overallPass) {
    console.error('[rag-eval] enforce failed');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[rag-eval] failed:', error.message);
  process.exitCode = 1;
});

