# M3 Metrics Report

GeneratedAt: 2026-03-08T08:16:04.397Z

## Summary

- overallPass: true
- scenarioCount: 6
- scenarioPassRate: 100%

## Metric Ledger (target / actual / deviation / action)

| Metric | Target | Actual | Deviation | Pass | Action |
|---|---:|---:|---:|:---:|---|
| highRiskRecall | 0.9 | 1 | 0.1 | Y | maintain current baseline and continue monitoring |
| explainabilityRate | 0.95 | 1 | 0.05 | Y | maintain current baseline and continue monitoring |
| averageLatencyMs | 120000 | 8340.92 | -111659.08 | Y | maintain current baseline and continue monitoring |
| auditCoverageRate | 1 | 1 | 0 | Y | maintain current baseline and continue monitoring |
| invalidInputInterceptRate | 1 | 1 | 0 | Y | maintain current baseline and continue monitoring |
| scenarioPassRate | 0.9 | 1 | 0.1 | Y | maintain current baseline and continue monitoring |

## Scenario Snapshot

| Scenario | Status | ErrorCode | LatencyMs | Explainable | Audit |
|---|---|---|---:|:---:|:---:|
| T-001 | OUTPUT | - | 10805.16 | Y | Y |
| T-002 | OUTPUT | - | 8675.44 | Y | Y |
| T-003 | ERROR | ERR_MISSING_REQUIRED_DATA | 0.48 | Y | Y |
| T-004 | OUTPUT | - | 9784.16 | Y | Y |
| T-005 | OUTPUT | - | 9385.05 | Y | Y |
| T-006 | ESCALATE_TO_OFFLINE | ERR_ESCALATE_TO_OFFLINE | 11395.22 | Y | Y |

## Acceptance Decision

- PASS: all M3 threshold gates are satisfied.

