# RAG Offline Evaluation Report

GeneratedAt: 2026-03-17T04:24:38.986Z
SampleCount: 80
NetworkEnabled: false
AverageLatencyMs: 6.8033
TotalRuntimeMs: 545.03

## Core Metrics

| Metric | Value |
|---|---:|
| top3HitRate | 0.9875 |
| mrrAt5 | 0.9875 |
| requiredSourceCoverageRate | 1 |
| multiSourceRate | 1 |
| realtimeShare | 0 |
| summaryStructuredRate | 1 |
| redFlagEvidenceRecall | 1 |
| needDecompositionRate | 1 |
| professionalRestatementRate | 1 |
| skillChainCoverageRate | 1 |
| hybridStrategyRate | 1 |

## Disease Slice

| Slice | cases | top3HitRate | mrrAt5 |
|---|---:|---:|---:|
| hypertension+diabetes | 28 | 1 | 1 |
| hypertension | 25 | 1 | 1 |
| diabetes | 15 | 0.9333 | 0.9333 |
| heart-disease | 9 | 1 | 1 |
| mixed-other | 3 | 1 | 1 |

## Hard Cases

| caseId | riskLevel | firstRelevantRank | usedSources | query |
|---|---|---:|---|---|
| eval_19D6E96909E6B296 | L3 | - | NICE,WHO,CDC_US,NHC_CN | 多饮、多尿、体重下降2月 多饮、多尿、体重下降2月 多饮 多尿 体重下降2月 Diabetes 2型糖尿病伴眼并发症 diabetes hyperglycemia hypoglycemia diagnosis guideline blood glucose management diabetes emergency thresholds 糖尿病 高血糖 低血糖 诊断 阈值 |

## Gate

- PASS

