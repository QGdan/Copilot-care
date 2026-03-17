# RAG Offline Evaluation Report

GeneratedAt: 2026-03-15T12:01:54.125Z
SampleCount: 30
NetworkEnabled: true
AverageLatencyMs: 25424.6877
TotalRuntimeMs: 762741.59

## Core Metrics

| Metric | Value |
|---|---:|
| top3HitRate | 1 |
| mrrAt5 | 0.9667 |
| requiredSourceCoverageRate | 0.8667 |
| multiSourceRate | 1 |
| realtimeShare | 1 |
| summaryStructuredRate | 1 |
| redFlagEvidenceRecall | 1 |

## Disease Slice

| Slice | cases | top3HitRate | mrrAt5 |
|---|---:|---:|---:|
| hypertension+diabetes | 12 | 1 | 1 |
| hypertension | 4 | 1 | 1 |
| diabetes | 10 | 1 | 0.9 |
| heart-disease | 4 | 1 | 1 |

## Hard Cases

| caseId | riskLevel | firstRelevantRank | usedSources | query |
|---|---|---:|---|---|
| eval_12D295042CC22979 | L3 | 1 | WHO,CDC_US,PUBMED | 无明显不适，体检发现血压高 无明显不适，体检发现血压高 无明显不适 体检发现血压高 Hypertension 高血压性心脏病，无心脏衰竭 hypertension guideline blood pressure management high blood pressure diagnosis threshold treatment target 成人 高血压 血压 分层 管理 diabetes hyperglycemia hypoglycemia diagnosis guideline blood glucose management diabetes emergency threshold |
| eval_3FEE1587101E204A | L3 | 1 | WHO,CDC_US,PUBMED | 乏力、头晕，检查发现血压血糖高 乏力、头晕，检查发现血压血糖高 乏力 头晕 检查发现血压血糖高 Hypertension Diabetes 本态性（原发性）高血压 2型糖尿病不伴并发症 hypertension guideline blood pressure management high blood pressure diagnosis threshold treatment target 成人 高血压 血压 分层 管理 diabetes hyperglycemia hypoglycemia diagnosis guideline blood glucose management diab |
| eval_039871C7FE492D8C | L3 | 1 | WHO,CDC_US,PUBMED | 血压升高伴血糖异常1月 血压升高伴血糖异常1月 血压升高伴血糖异常1月 Hypertension Diabetes 高血压性心脏病伴有心脏衰竭 2型糖尿病伴肾并发症 hypertension guideline blood pressure management high blood pressure diagnosis threshold treatment target 成人 高血压 血压 分层 管理 diabetes hyperglycemia hypoglycemia diagnosis guideline blood glucose management diabetes emerg |
| eval_CF124FCE87CD87EE | L3 | 1 | WHO,CDC_US,PUBMED | 体检发现血压、血糖均升高 体检发现血压、血糖均升高 体检发现血压 血糖均升高 Hypertension Diabetes 本态性（原发性）高血压 2型糖尿病伴眼并发症 hypertension guideline blood pressure management high blood pressure diagnosis threshold treatment target 成人 高血压 血压 分层 管理 diabetes hyperglycemia hypoglycemia diagnosis guideline blood glucose management diabetes emer |

## Gate

- PASS

