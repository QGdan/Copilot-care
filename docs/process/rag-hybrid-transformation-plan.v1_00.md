# Hybrid RAG 转型方案 v1.00

## 目标与边界

- 目标：从“规则驱动实时检索”升级为“向量知识库 + 词法检索 + 实时检索兜底”的混合 RAG。
- 保留：现有权威来源白名单、证据完整性门禁、审计日志、可解释证据卡输出。
- 不做：一次性替换全链路，不引入不可回滚的单点依赖。

## 现状诊断

- 优势：
  - 来源治理和门禁完善，医疗场景安全性高。
  - 检索策略可解释，规则驱动改写能力已具备。
- 痛点：
  - 在线检索依赖强，时延高、波动大。
  - 召回主要靠 Web/PubMed，缺少本地向量召回与稳定重排。
  - 必选来源覆盖在在线场景存在波动。

## 目标架构

1. 需求拆解与查询规划层  
规则驱动需求拆解 -> 专业化重述 -> query variants（已具备）。

2. 混合召回层  
向量检索（dense） + 词法检索（BM25） + 在线权威检索（Web/PubMed）。

3. 融合与重排层  
RRF 初排 + cross-encoder/规则重排（来源覆盖、红旗优先、时效加权）。

4. 证据治理层  
必选来源覆盖、重复证据去冗余、证据完整性门禁。

5. 可解释输出层  
统一结构化摘要（证据要点/临床解读/建议动作）与审计追踪。

## 分阶段路线

- Phase 0（基线与治理）
  - 固化 offline/online 基线指标。
  - 产出 ADR 和 workflow 清单。
- Phase 1（知识库基础设施）
  - 采集适配、分块规范、Embedding 端口、向量/词法索引。
- Phase 2（混合检索能力）
  - Hybrid Retriever、RRF+重排、门禁约束、灰度接入。
- Phase 3（审效与发布）
  - 性能优化、运行时治理看板、审效门禁自动化。

## 核心指标（审效口径）

- 质量指标：
  - `top3HitRate`
  - `mrrAt5`
  - `requiredSourceCoverageRate`
  - `redFlagEvidenceRecall`
  - `summaryStructuredRate`
- 效率指标：
  - `averageCaseLatencyMs`（按 case 均值）
- 门禁策略：
  - `node scripts/rag-hybrid-audit.cjs --enforce=true`

## 回滚策略

- 模块级回滚：`providerRegistry`、`service`、`sourcePolicy` 逐层回退。
- 路由级回滚：关闭 Hybrid Feature Flag，回退到现有实时检索主路径。
- 数据级回滚：保留前一版索引快照，支持一键恢复。

## 执行入口

- Workflow 引擎：`node scripts/rag-hybrid-workflow.cjs`
- 审效工具：`node scripts/rag-hybrid-audit.cjs`
- 标准入口：
  - `npm run rag:hybrid:workflow`
  - `npm run rag:hybrid:run -- --max=1 --retries=2`
  - `npm run rag:hybrid:audit`
