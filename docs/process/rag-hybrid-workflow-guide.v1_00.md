# Hybrid RAG Workflow 使用说明 v1.00

## 目标

- 把混合 RAG 转型过程标准化为可执行 workflow。
- 每一步必须有自动化校验命令与证据产物。
- 支持失败即阻断、可回滚、可审计。

## 核心命令

- `npm run rag:hybrid:sync`
- `npm run rag:hybrid:status`
- `npm run rag:hybrid:next`
- `npm run rag:hybrid:run -- --max=1 --retries=2`
- `npm run rag:hybrid:accept -- <TASK_ID>`

## 审效命令

- `npm run rag:hybrid:audit:offline`
- `npm run rag:hybrid:audit:online`
- `npm run rag:hybrid:audit -- --enforce=true`

## 推荐日常循环

1. `npm run rag:hybrid:sync`
2. `npm run rag:hybrid:status`
3. `npm run rag:hybrid:next`
4. `npm run rag:hybrid:run -- --max=1 --retries=2`
5. `npm run rag:hybrid:status`

## 输出位置

- 工作流状态：
  - `reports/todos/rag-hybrid-state.json`
- 工作流执行报告：
  - `reports/todos/rag-hybrid.latest.json`
- 审效报告：
  - `reports/metrics/rag-hybrid-audit.latest.json`
  - `docs/process/rag-hybrid-audit-report.md`

## 注意事项

- `RAG-HY-P0-002` 和 `rag:hybrid:audit:online` 依赖联网，耗时可能较长。
- 如需严格门禁，请用：
  - `npm run rag:hybrid:audit -- --enforce=true`
