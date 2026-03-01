# CoPilot Care Monorepo

CoPilot Care 是一个基于 TypeScript 的社区医疗分诊辅助原型，采用 Monorepo 管理后端、前端与共享契约，强调架构边界、流程可解释性与安全审校。

## 项目结构

```text
src/
|- backend/         # Express + orchestration runtime
|- frontend/        # Vue 3 client
|- shared/          # Shared contracts/types
|- domain/          # Domain contracts (incremental migration target)
|- application/     # Use case contracts (incremental migration target)
|- infrastructure/  # Adapters (incremental migration target)
`- interfaces/      # Interface layer (incremental migration target)
```

## 快速开始

```bash
npm install
# bash: cp .env.example .env
# powershell: Copy-Item .env.example .env
# 填入你自己的 API Key
npm run devwf:arch
```

前端默认请求后端 `http://localhost:3001`，可通过 `VITE_API_BASE_URL` 覆盖。

## 常用命令

```bash
# 全仓
npm test
npm run build
npm run typecheck

# 自动体检（原“门禁”）
npm run health:quick
npm run health:core
npm run health:release

# 兼容旧命名（仍可用）
npm run gate:all
npm run gate:metrics
npm run security:secrets
npm run security:gate

# 自动化 CI（本地同款）
npm run ci:preflight
npm run ci:verify
npm run ci:nightly
```

### 门禁是什么意思？

在这个项目里，“门禁”=“能不能进入下一阶段（提测/发版）的自动体检”。

- `typecheck`：类型是否正确
- `test`：核心功能是否回归
- `build`：构建是否成功
- `check:copy`：中文文案编码是否异常
- `perf:check`：前端包体是否超预算
- `security:*`：依赖和密钥是否有安全风险

## 自动化开发工作流（CI）

- PR/Push 主干门禁：`.github/workflows/monorepo-dev-workflow.yml`
  - 执行链路：`ci:preflight -> gate:safety -> gate:workflow -> typecheck -> test -> build -> check:copy -> perf:check`
- 夜间回归：`.github/workflows/nightly-regression.yml`
  - 执行链路：`ci:nightly`（在 `ci:verify` 基础上执行 `security:baseline + security:gate`）
  - `security:gate` 默认策略：仅审计生产依赖（`--omit-dev`），并要求 `high=0` 且 `critical=0`。
- 所有工作流都会上传 `reports/**` 作为构建证据产物。

## 自动化工作流（TODO + 里程碑）

基础状态命令：

```bash
npm run todos:doctor
npm run todos:init
npm run todos:status
npm run todos:next
```

工作流清单切换：

```bash
# 竞赛工作流 v6
npm run competition:use

# 增强工作流 v7
npm run enhance:use

# 医疗指挥舱高端化冲刺 v8（当前使用）
npm run design:use
```

医疗指挥舱冲刺（v8）阶段命令：

```bash
npm run design:status
npm run design:next
npm run design:week1
npm run design:week2
npm run design:gate
```

相关文件：

- `docs/process/todos-workflow.v5_00.json`
- `docs/process/todos-workflow.v6_00.json`
- `docs/process/todos-workflow.v7_00.json`
- `docs/process/todos-workflow.v8_00.json`
- `reports/todos/workflow-state.json`

## 本地运行（前后端）

推荐固定后端 `3001` 端口启动，前端默认就能直连，无需额外改动。

```bash
# terminal A（后端）
# PowerShell: $env:APP_PORT='3001'
# Bash: export APP_PORT=3001
npm run start --workspace=@copilot-care/backend

# terminal B（前端）
npm run dev --workspace=@copilot-care/frontend -- --host 127.0.0.1 --port 5173
```

启动后访问：

- 前端：`http://127.0.0.1:5173`
- 后端健康检查：`http://127.0.0.1:3001/health`

如果你在 `.env` 中把后端端口改成了 `8002`（或其他端口），请同步设置：

```bash
# .env
VITE_API_BASE_URL=http://127.0.0.1:8002
```

### 启动排障（Windows）

1. 后端端口被占用（`EADDRINUSE`）：

```bash
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

2. 前端页面打不开：

```bash
netstat -ano | findstr :5173
taskkill /PID <PID> /F
npm run dev --workspace=@copilot-care/frontend -- --host 127.0.0.1 --port 5173
```

3. 依赖或缓存异常（如 Vite/esbuild 进程错误）：

```bash
# 仓库根目录
npm install
npm run build --workspace=@copilot-care/frontend
```

## 可选外部 LLM Provider

后端支持按角色选择外部模型（未配置时自动回退到内置启发式 Agent）：

```bash
# 全局 provider
# none | auto | deepseek | gemini | kimi | deepseek_gemini | openai | anthropic
COPILOT_CARE_LLM_PROVIDER=auto
COPILOT_CARE_LLM_TIMEOUT_MS=20000
COPILOT_CARE_LLM_MAX_RETRIES=1
COPILOT_CARE_LLM_RETRY_DELAY_MS=300

# 角色 provider（推荐）
COPILOT_CARE_CARDIO_PROVIDER=deepseek
COPILOT_CARE_GP_PROVIDER=gemini
COPILOT_CARE_METABOLIC_PROVIDER=gemini
COPILOT_CARE_SAFETY_PROVIDER=kimi

# provider keys
DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
KIMI_API_KEY=...
# OPENAI_API_KEY=...
# ANTHROPIC_API_KEY=...
```

可选 base URL：

- `OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）
- `ANTHROPIC_BASE_URL`（默认 `https://api.anthropic.com/v1`）
- `GEMINI_BASE_URL`（默认 `https://generativelanguage.googleapis.com/v1beta`）
- `DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com/v1`）
- `KIMI_BASE_URL`（默认 `https://api.moonshot.cn/v1`）

## 架构与可观测接口

后端提供专家路由快照接口：

```bash
GET /architecture/experts
```

返回包含每个专家的 provider、来源（`env|default|invalid_fallback`）以及 `llmEnabled` 状态，前端可据此展示专家绑定情况。

新增治理规则只读接口：

```bash
GET /governance/rules/catalog
GET /governance/rules/version
```

`/orchestrate_triage` 与 `/orchestrate_triage/stream` 的响应中新增可选字段
`ruleGovernance`，用于返回规则版本、命中规则ID、分层决策与证据链追踪ID。

新增 FHIR 最小互操作端点：

```bash
POST /interop/fhir/triage-bundle
```

说明：

- 该端点要求请求头 `x-smart-scope`，需同时包含 `Patient`、`Observation`、
  `Provenance` 的 `read` scope；
- 返回 draft FHIR Bundle（Patient/Observation/Provenance）以及 triage 摘要；
- 当前为“最小闭环”，不执行外部 FHIR 服务器写回。

## 比赛演示建议

演示前建议执行：

```bash
npm run check:copy --workspace=@copilot-care/frontend
npm run test --workspace=@copilot-care/frontend
npm run typecheck --workspace=@copilot-care/frontend
npm run build --workspace=@copilot-care/frontend
npm run perf:check --workspace=@copilot-care/frontend
npm run security:secrets
```

重点回归点：

- 问诊提交流程和输入校验是否稳定；
- 报告导出 PDF/TXT 回退是否正常；
- 中文文本是否出现乱码；
- 红旗场景是否明确进入线下上转路径。

## 3 分钟答辩脚本（医疗指挥舱）

建议固定按以下顺序演示，确保“输入 -> 推理 -> 治理 -> 导出”闭环完整：

1. `00:00-00:45` 会诊工作台：录入患者主诉和生命体征，提交会诊。
2. `00:45-01:35` 推理可视化：展示复杂度路由树、动态流程图、思维图谱状态切换。
3. `01:35-02:15` 治理看板：说明风险信号、复核阶段、阻断策略。
4. `02:15-02:45` 患者看板/FHIR：展示历史趋势与结构化资源可追溯性。
5. `02:45-03:00` 报告导出：演示 PDF 导出成功路径与 TXT 回退提示。

异常预案（现场故障时按优先级切换）：

1. 导出失败：立即切换 TXT 回退并展示“内容完整、编码正常”。
2. 图表渲染异常：切换到治理看板与任务面板，继续讲述状态语义。
3. 外部模型超时：说明本地规则回退路径，展示稳定输出与安全边界。

## 文档索引

- `AGENTS.md`
- `CONTRIBUTING.md`
- `docs/process/development-workflow.md`
- `docs/process/opencode-operation-guide.md`
- `docs/process/todos-workflow.md`
- `docs/process/gate-explained.zh-CN.md`
