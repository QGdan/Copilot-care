# RAG Offline Evaluation Report

GeneratedAt: 2026-03-15T14:14:04.217Z
SampleCount: 120
NetworkEnabled: false
AverageLatencyMs: 3.8218
TotalRuntimeMs: 459.35

## Core Metrics

| Metric | Value |
|---|---:|
| top3HitRate | 0.9917 |
| mrrAt5 | 0.9917 |
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
| hypertension+diabetes | 37 | 1 | 1 |
| hypertension | 41 | 1 | 1 |
| diabetes | 17 | 0.9412 | 0.9412 |
| heart-disease | 20 | 1 | 1 |
| mixed-other | 5 | 1 | 1 |

## Hard Cases

| caseId | riskLevel | firstRelevantRank | usedSources | query |
|---|---|---:|---|---|
| eval_19D6E96909E6B296 | L3 | - | NICE,WHO,CDC_US,NHC_CN | 多饮、多尿、体重下降2月 多饮、多尿、体重下降2月 多饮 多尿 体重下降2月 Diabetes 2型糖尿病伴眼并发症 diabetes hyperglycemia hypoglycemia diagnosis guideline blood glucose management diabetes emergency thresholds 糖尿病 高血糖 低血糖 诊断 阈值 |

## Gate

- PASS

