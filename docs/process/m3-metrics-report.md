# M3 Metrics Report

GeneratedAt: 2026-03-02T12:59:47.701Z

## Summary

- overallPass: true
- scenarioCount: 6
- scenarioPassRate: 100%

## Metric Ledger (target / actual / deviation / action)

| Metric | Target | Actual | Deviation | Pass | Action |
|---|---:|---:|---:|:---:|---|
| highRiskRecall | 0.9 | 1 | 0.1 | Y | maintain current baseline and continue monitoring |
| explainabilityRate | 0.95 | 1 | 0.05 | Y | maintain current baseline and continue monitoring |
| averageLatencyMs | 120000 | 0.76 | -119999.24 | Y | maintain current baseline and continue monitoring |
| auditCoverageRate | 1 | 1 | 0 | Y | maintain current baseline and continue monitoring |
| invalidInputInterceptRate | 1 | 1 | 0 | Y | maintain current baseline and continue monitoring |
| scenarioPassRate | 0.9 | 1 | 0.1 | Y | maintain current baseline and continue monitoring |

## Scenario Snapshot

| Scenario | Status | ErrorCode | LatencyMs | Explainable | Audit |
|---|---|---|---:|:---:|:---:|
| T-001 | OUTPUT | - | 3.37 | Y | Y |
| T-002 | OUTPUT | - | 0.38 | Y | Y |
| T-003 | ERROR | ERR_MISSING_REQUIRED_DATA | 0.15 | Y | Y |
| T-004 | OUTPUT | - | 0.39 | Y | Y |
| T-005 | OUTPUT | - | 0.16 | Y | Y |
| T-006 | ESCALATE_TO_OFFLINE | ERR_ESCALATE_TO_OFFLINE | 0.12 | Y | Y |

## Acceptance Decision

- PASS: all M3 threshold gates are satisfied.

