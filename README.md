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

## 一键部署（GitHub -> Render）

仓库已提供 `render.yaml`，可直接使用 Render Blueprint 单服务部署（同一域名同时提供前端页面与后端 API）。

### 1) 推送代码到 GitHub

```bash
git add .
git commit -m "chore: prepare deployment"
git push origin main
```

### 2) 在 Render 创建 Blueprint

1. 登录 Render，选择 `New +` -> `Blueprint`。
2. 连接本仓库并选择分支（通常 `main`）。
3. Render 会自动读取 `render.yaml`：
   - `buildCommand`: `npm ci && npm run build:deploy`
   - `startCommand`: `npm run start:deploy`
   - `healthCheckPath`: `/health`

### 3) 配置生产环境变量

至少确认以下变量：

- `DEEPSEEK_API_KEY` / `GEMINI_API_KEY` / `KIMI_API_KEY` / `DASHSCOPE_API_KEY`（按你使用的 provider 填写）
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`（如果启用对应 provider）
- `COPILOT_CARE_LLM_PROVIDER`（默认 `auto`）
- `COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST`（生产环境必须显式提供可用 consent token）
- `COPILOT_CARE_CORS_ALLOWED_ORIGINS`（如 `https://your-app.onrender.com`）
- `COPILOT_CARE_RUNTIME_STATE_BACKEND`（`memory` 或 `file`）

> `COPILOT_CARE_FRONTEND_DIST=src/frontend/dist` 已在 blueprint 默认配置中提供，用于后端托管前端构建产物。
> 生产环境默认关闭 `/interop` 与 `/mcp`，且不再接受 `consent_local_demo`。

如需在生产环境开启受保护接口：

- `COPILOT_CARE_ENABLE_INTEROP=true`
- `COPILOT_CARE_INTEROP_API_KEY=<bearer token>`
- `COPILOT_CARE_ENABLE_MCP=true`
- `COPILOT_CARE_MCP_API_KEY=<bearer token>`

### 4) 部署后验收

- 健康检查：`GET /health`
- 主站页面：`GET /`
- 分诊接口：`POST /orchestrate_triage`

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

## 后续开发工作流（2026-03 建议）

在保持 v8 任务流可追溯的前提下，新增能力建议按下面节奏推进：

1. 任务同步：`npm run design:status && npm run design:next`
2. 开发前快检：`npm run ci:preflight`
3. 开发中最小验证（按改动范围择一）：
   - 前端：`npm run test --workspace=@copilot-care/frontend`
   - 后端：`npm run test --workspace=@copilot-care/backend`
   - 全仓：`npm run typecheck`
4. 提交前统一验证：`npm run ci:verify`
5. 发版前验证：`npm run health:release`（等价 CI 同款）

失败反馈建议：

- 运行态日志放在 `reports/runtime/*.log`
- 安全审计报告放在 `reports/security/*.json`
- 指标与门禁证据放在 `reports/metrics/*.json`

## 本地运行（前后端）

为避免前端连到旧后端实例，建议使用“同一端口显式绑定”方式启动。

推荐端口：`3101`（若你本机 `3001/8002` 已被其他进程占用，这个端口更稳妥）。

```bash
# terminal A（后端，PowerShell）
$env:APP_PORT='3101'
npm run start --workspace=@copilot-care/backend

# terminal B（前端，PowerShell）
$env:VITE_API_BASE_URL='http://127.0.0.1:3101'
npm run dev --workspace=@copilot-care/frontend -- --host 127.0.0.1 --port 5173 --strictPort
```

```bash
# terminal A（后端，Bash）
export APP_PORT=3101
npm run start --workspace=@copilot-care/backend

# terminal B（前端，Bash）
export VITE_API_BASE_URL=http://127.0.0.1:3101
npm run dev --workspace=@copilot-care/frontend -- --host 127.0.0.1 --port 5173 --strictPort
```

启动后访问：

- 前端：`http://127.0.0.1:5173`
- 后端健康检查：`http://127.0.0.1:3101/health`
- 规则版本：`http://127.0.0.1:3101/governance/rules/version`
- 规则目录：`http://127.0.0.1:3101/governance/rules/catalog`
- 医学权威源白名单：`http://127.0.0.1:3101/governance/medical-sources`

说明：

- 前端代码默认会尝试 `3001/8002`；如果你本机已有旧实例在这些端口，页面可能看不到最新 `ruleGovernance` 与 FHIR 互操作能力；
- 因此请优先设置 `VITE_API_BASE_URL`，确保前后端严格指向同一后端进程。
- 前端建议带 `--strictPort` 启动，避免 5173 被占用时自动跳到 5174 导致联调地址漂移。

### 生产暴露面说明

- `consent_local_demo` 仅限非生产环境；生产环境必须使用 `COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST`。
- `/interop/**` 默认只在非生产环境开放；生产环境需显式开启并提供 `Authorization: Bearer <COPILOT_CARE_INTEROP_API_KEY>`。
- `/mcp/**` 默认只在非生产环境开放；生产环境需显式开启并提供 `Authorization: Bearer <COPILOT_CARE_MCP_API_KEY>`。
- CORS 在生产环境默认不放行跨域来源；如前后端分域部署，需设置 `COPILOT_CARE_CORS_ALLOWED_ORIGINS`。

### 运行态持久化

- `COPILOT_CARE_RUNTIME_STATE_BACKEND=memory`：默认模式，幂等缓存和治理遥测只保留在当前进程内。
- `COPILOT_CARE_RUNTIME_STATE_BACKEND=file`：将幂等状态和治理遥测落盘到 `COPILOT_CARE_RUNTIME_STATE_DIR`，适合单实例重启恢复。
- `COPILOT_CARE_RUNTIME_STATE_DIR` 默认是 `reports/runtime/state`，该目录已被 `.gitignore` 忽略。
- `file` 后端只能解决“同一磁盘上的单实例重启恢复”，不能替代 Redis/数据库，也不适合多实例共享状态。

### 新功能联调快速验收

```bash
# 1) 规则治理端点
curl http://127.0.0.1:3101/governance/rules/version
curl http://127.0.0.1:3101/governance/rules/catalog

# 2) 分诊接口（检查响应中是否包含 ruleGovernance）
curl -X POST http://127.0.0.1:3101/orchestrate_triage ^
  -H "content-type: application/json" ^
  -d "{\"requestId\":\"readme-smoke-001\",\"consentToken\":\"consent_local_demo\",\"symptomText\":\"fatigue\",\"profile\":{\"patientId\":\"readme-smoke-001\",\"age\":52,\"sex\":\"male\",\"symptoms\":[\"fatigue\"],\"chronicDiseases\":[\"Hypertension\"],\"medicationHistory\":[\"none\"],\"vitals\":{\"systolicBP\":150,\"diastolicBP\":95}}}"

# 3) FHIR 最小闭环（SMART scope 通过路径）
curl -X POST http://127.0.0.1:3101/interop/fhir/triage-bundle ^
  -H "content-type: application/json" ^
  -H "x-smart-scope: user/Patient.read user/Observation.read user/Provenance.read" ^
  -d "{\"requestId\":\"readme-interop-001\",\"consentToken\":\"consent_local_demo\",\"symptomText\":\"dizziness\",\"profile\":{\"patientId\":\"readme-interop-001\",\"age\":55,\"sex\":\"female\",\"symptoms\":[\"dizziness\"],\"chronicDiseases\":[\"Hypertension\"],\"medicationHistory\":[\"amlodipine\"],\"vitals\":{\"systolicBP\":146,\"diastolicBP\":92}},\"signals\":[{\"timestamp\":\"2026-03-01T10:00:00Z\",\"source\":\"manual\",\"systolicBP\":146,\"diastolicBP\":92}]}"

# 4) 权威医学联网检索（严格白名单域名）
curl -X POST http://127.0.0.1:3101/governance/medical-search ^
  -H "content-type: application/json" ^
  -d "{\"query\":\"hypertension guideline\",\"limit\":6}"

# 5) 可控多源检索（按来源过滤 + 必选来源覆盖）
curl -X POST http://127.0.0.1:3101/governance/medical-search ^
  -H "content-type: application/json" ^
  -d "{\"query\":\"hypertension guideline\",\"limit\":6,\"sourceFilter\":[\"NICE\",\"WHO\",\"CDC_US\"],\"requiredSources\":[\"WHO\",\"CDC_US\"]}"
```

### 启动排障（Windows）

1. 后端端口被占用（`EADDRINUSE`）：

```bash
netstat -ano | findstr :3101
taskkill /PID <PID> /F
```

2. 前端页面打不开：

```bash
netstat -ano | findstr :5173
taskkill /PID <PID> /F
npm run dev --workspace=@copilot-care/frontend -- --host 127.0.0.1 --port 5173 --strictPort
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
# none | auto | deepseek | gemini | kimi | dashscope | deepseek_gemini | openai | anthropic
COPILOT_CARE_LLM_PROVIDER=auto
# 可选：auto 模式下 provider 回退顺序
# COPILOT_CARE_LLM_AUTO_CHAIN=dashscope,kimi,deepseek,gemini,openai,anthropic
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
# DASHSCOPE_API_KEY=...
# OPENAI_API_KEY=...
# ANTHROPIC_API_KEY=...

# 可选：同一专科并行多模型（provider 或 provider:model）
# COPILOT_CARE_CARDIO_PANEL_PROVIDERS=deepseek,gemini,dashscope:qwen-plus,dashscope:qwen-max
# COPILOT_CARE_GP_PANEL_PROVIDERS=gemini,dashscope:qwen-plus
# COPILOT_CARE_METABOLIC_PANEL_PROVIDERS=gemini,dashscope:qwen-plus
```

可选 base URL：

- `OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）
- `ANTHROPIC_BASE_URL`（默认 `https://api.anthropic.com/v1`）
- `GEMINI_BASE_URL`（默认 `https://generativelanguage.googleapis.com/v1beta`）
- `DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com/v1`）
- `KIMI_BASE_URL`（默认 `https://api.moonshot.cn/v1`）
- `DASHSCOPE_BASE_URL`（默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`）

可选权威医学联网检索开关：

- `COPILOT_CARE_MED_SEARCH_ENABLED`（默认 `true`）
- `COPILOT_CARE_MED_SEARCH_TIMEOUT_MS`（默认 `8000`）
- `COPILOT_CARE_MED_SEARCH_MAX_RESULTS`（默认 `8`）
- `COPILOT_CARE_MED_SEARCH_DDG_ENABLED`（默认 `true`，用于白名单域名检索补充）
- `COPILOT_CARE_MED_SEARCH_ALLOW_PARTIAL_SEED_FILL`（默认 `false`；若设为 `true`，当实时命中不足时可用目录种子补齐）
- `COPILOT_CARE_MED_SEARCH_CACHE_TTL_MS`（默认 `180000`；检索结果缓存 TTL，单位毫秒，设为 `0` 可禁用缓存）
- `COPILOT_CARE_MED_SEARCH_CACHE_MAX_ENTRIES`（默认 `128`；检索结果缓存最大条目数）
- `COPILOT_CARE_MED_SEARCH_PROVIDER_FAILURE_THRESHOLD`（默认 `3`；单个 provider 连续失败达到阈值后进入熔断）
- `COPILOT_CARE_MED_SEARCH_PROVIDER_CIRCUIT_OPEN_MS`（默认 `60000`；provider 熔断保持时长，单位毫秒）
- `COPILOT_CARE_MED_SEARCH_RUNTIME_LOG_FILE`（默认 `reports/runtime/medical-search.runtime.jsonl`；设置后会落盘每次检索诊断日志）
- `COPILOT_CARE_MED_SEARCH_RECENT_LOG_LIMIT`（默认 `40`；内存中保留最近检索日志条数）
- `COPILOT_CARE_MED_SEARCH_IN_TRIAGE`（默认跟随 `COPILOT_CARE_MED_SEARCH_ENABLED`；显式设为 `false` 可关闭分诊注入）

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

新增权威医学检索接口（严格域名白名单）：

```bash
GET /governance/medical-sources
GET /governance/medical-search/runtime
GET /governance/medical-search/logs
POST /governance/medical-search
```

`POST /governance/medical-search` 采用多源去偏策略：优先覆盖 `NICE/WHO/CDC/NHC/China CDC` 等公共卫生与指南来源，再补充 `PUBMED` 文献证据，避免单一来源主导结果集。
返回中新增 `sourceBreakdown`（来源分布统计）与 `strategyVersion`（策略版本），便于联调与审计。
`GET /governance/medical-search/runtime` 与 `GET /governance/medical-search/logs` 会返回最近检索日志（含 `fallbackReasons` 与 `missingRequiredSources`），用于定位“为何触发兜底/为何缺少必选来源”。
支持可选请求参数：

- `sourceFilter: string[]`：限制检索来源（仅允许白名单来源 ID）
- `requiredSources: string[]`：要求结果尽量覆盖的来源（必须是 `sourceFilter` 子集）

会诊主链路中的证据注入已升级为“规则驱动策略”：

- 先执行规则风险评估，再生成检索策略（来源约束、必选来源、证据数量要求）
- 高风险场景（`L2/L3`）启用证据完整性门禁，证据不足将阻断自动输出并返回 `ERR_GUIDELINE_EVIDENCE_MISSING`
- 可解释报告新增结构化 `evidenceCards`，默认展示可读证据摘要，链接退居次要层级
- 会诊前端“结构化结果”面板新增“规则-证据对齐”视图，展示每条命中规则的证据覆盖状态

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
- triage 摘要新增 `interopSummary`（资源计数 + 引用完整性校验），可直接用于验收；
- Provenance 将关联 Patient 与 Bundle 中 Observation，保证最小闭环可追溯；
- 当前为“最小闭环”，不执行外部 FHIR 服务器写回。
- 前端 `/fhir` 页面支持一键生成 triage bundle 草案并展示闭环验收结果。

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
