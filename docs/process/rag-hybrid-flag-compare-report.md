# Hybrid Retriever Flag Comparison

GeneratedAt: 2026-03-15T12:19:58.400Z

## Inputs

- baseline: `reports\metrics\rag-hybrid.flag-off.online.latest.json`
- candidate: `reports\metrics\rag-hybrid.flag-on.online.latest.json`

## Metrics

| Metric | Baseline(flag off) | Candidate(flag on) | Delta(on-off) |
|---|---:|---:|---:|
| sampleCount | 30 | 30 | 0 |
| top3HitRate | 1 | 1 | 0 |
| mrrAt5 | 0.9667 | 0.9667 | 0 |
| requiredSourceCoverageRate | 0.8667 | 0.8667 | 0 |
| redFlagEvidenceRecall | 1 | 1 | 0 |
| summaryStructuredRate | 1 | 1 | 0 |
| realtimeShare | 1 | 1 | 0 |
| multiSourceRate | 1 | 1 | 0 |
| averageLatencyMs | 25424.6877 | 26026.769 | 602.08 |

## Verdict

- score: 0
- latencyTrend: degraded
- recommendation: needs_canary

