# M3 Metrics Report

GeneratedAt: 2026-02-24T10:27:56.407Z

## Summary

- overallPass: true
- scenarioCount: 6
- scenarioPassRate: 100%

## Metric Ledger (target / actual / deviation / action)

| Metric | Target | Actual | Deviation | Pass | Action |
|---|---:|---:|---:|:---:|---|
| highRiskRecall | 0.9 | 1 | 0.1 | Y | maintain current baseline and continue monitoring |
| explainabilityRate | 0.95 | 1 | 0.05 | Y | maintain current baseline and continue monitoring |
| averageLatencyMs | 120000 | 1.05 | -119998.95 | Y | maintain current baseline and continue monitoring |
| auditCoverageRate | 1 | 1 | 0 | Y | maintain current baseline and continue monitoring |
| invalidInputInterceptRate | 1 | 1 | 0 | Y | maintain current baseline and continue monitoring |
| scenarioPassRate | 0.9 | 1 | 0.1 | Y | maintain current baseline and continue monitoring |

## Scenario Snapshot

| Scenario | Status | ErrorCode | LatencyMs | Explainable | Audit |
|---|---|---|---:|:---:|:---:|
| T-001 | OUTPUT | - | 4.18 | Y | Y |
| T-002 | OUTPUT | - | 0.73 | Y | Y |
| T-003 | ERROR | ERR_MISSING_REQUIRED_DATA | 0.14 | Y | Y |
| T-004 | OUTPUT | - | 0.76 | Y | Y |
| T-005 | OUTPUT | - | 0.32 | Y | Y |
| T-006 | ESCALATE_TO_OFFLINE | ERR_ESCALATE_TO_OFFLINE | 0.2 | Y | Y |

## Acceptance Decision

- PASS: all M3 threshold gates are satisfied.

