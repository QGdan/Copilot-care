# CoPilot Care Monorepo

CoPilot Care 是一个基于 TypeScript 的社区医疗分诊辅助原型，采用 Monorepo 管理后端、前端与共享契约，强调架构边界、流程可解释性与安全审校。

## 系统定位与边界

- 定位：基层场景下的多智能体协同分诊辅助系统（Clinical Decision Support）。
- 目标：在“安全优先”前提下，提升分诊一致性、解释性、可追溯性与治理可见性。
- 边界：当前输出为辅助建议，不替代线下医生诊断与处方决策。
- 兜底：遇到红旗风险、证据不足、分歧过大或低置信时，系统优先触发保守策略（ABSTAIN/线下上转）。

## 当前实现能力总览（以代码为准）

### 1) 多智能体协同会诊主链路（已实现）

- 同意与最小信息集校验（Consent + MIS）。
- 规则优先风险评估（Rule-first risk assessment）。
- 复杂度分流（FAST_CONSENSUS / LIGHT_DEBATE / DEEP_DEBATE）。
- 专家协同仲裁（心血管 / 全科 / 代谢 / 安全）。
- 治理复核与安全审校（置信校准、基线守护、输出拦截）。
- 可解释报告与随访建议输出。

### 2) 治理与可观测（已实现）

- 四层治理快照：`BASIC_SAFETY / FLOW_CONTROL / INTELLIGENT_COLLABORATION / OPERATIONS`。
- 错误码与风险触发矩阵联动（`ERR_*` -> action/gate）。
- 流式事件与编排快照：`stage_update / reasoning_step / orchestration_snapshot / final_result`。
- 运行态遥测与最近会话统计（治理看板可读取）。
- 人工复核队列闭环接口：`GET /governance/review-queue`、`POST /governance/review-queue/:id/decision`。
- 结构化阻断原因全链路透传：`blockingReason`（编排层 -> HTTP 响应 -> 流式 `error` 事件 -> 前端结果卡片）。

### 3) 互操作与外部证据（已实现最小闭环）

- FHIR 资源映射与浏览：Patient / Observation / Provenance。
- SMART scope 基础校验路径。
- `POST /interop/fhir/triage-bundle` 生成 triage draft bundle。
- 权威医学白名单检索与证据注入（含 fallback、缓存、熔断、来源分布）。

### 4) 前端临床指挥舱（已实现）

- 会诊工作台：实时流式状态机 + 推理轨迹 + 路由树 + 结果导出。
- 治理看板：运行态队列、阶段脉冲、风险信号。
- 患者看板：纵向体征与历史会诊视图（支持接口失败时 mock 回退）。
- FHIR Explorer：资源浏览与 triage bundle 验证。
- 结构化结果面板支持阻断原因卡片：展示触发阶段、严重度与处置动作，替代纯文本匹配。

## 项目结构（当前真实实现）

```text
src/
|- backend/         # 核心运行时（Express + orchestration + governance）
|- frontend/        # Vue 3 指挥舱客户端
|- shared/          # 前后端共享类型契约
|- domain/          # 预留目录（当前根层未承载运行代码）
|- application/     # 预留目录（当前根层未承载运行代码）
|- infrastructure/  # 预留目录（当前根层未承载运行代码）
`- interfaces/      # 预留目录（当前根层未承载运行代码）
```

说明：当前可执行实现主要位于 `src/backend/src`、`src/frontend/src`、`src/shared`。

## 系统全景架构（代码对应）

```text
frontend (Vue 指挥舱)
  -> interfaces/http (Express Router)
  -> application (UseCase + Services)
  -> domain (规则/治理核心)
  -> infrastructure (适配器: LLM/FHIR/MCP/持久化/检索)
  -> shared (跨层类型契约)
```

关键入口（当前实现）：

- `src/backend/src/bootstrap/createRuntime.ts`
- `src/backend/src/bootstrap/createBackendApp.ts`
- `src/backend/src/application/usecases/RunTriageSessionUseCase.ts`
- `src/backend/src/infrastructure/orchestration/ComplexityRoutedOrchestrator.ts`

## 端到端主链路时序

固定主链路：

1. 授权校验（consent token）
2. 最小信息集（MIS）与输入归一化
3. 风险评估（rule-first）
4. 复杂度分流（department + score）
5. 多智能体协同（fast/light/deep）
6. 治理复核（置信校准 + 基线守护）
7. 安全输出审校（注入/越界拦截）
8. 解释与随访输出（report + triage result）
9. 审计与遥测回传（workflowTrace + governance runtime）

API 映射：

- 同步：`POST /orchestrate_triage`
- 流式：`POST /orchestrate_triage/stream`
- 典型流式事件：`stage_update -> reasoning_step -> orchestration_snapshot -> final_result`

## 多智能体协同机制

角色分工：

- `cardiology`：心血管风险与急性事件边界。
- `generalPractice`：综合症状与首诊统筹。
- `metabolic`：代谢慢病与纵向风险。
- `safety`：安全边界与保守兜底。

复杂度阈值（当前运行策略）：

- `0-2`：`FAST_CONSENSUS`
- `3-5`：`LIGHT_DEBATE`
- `>=6`：`DEEP_DEBATE`

分歧指数与轮次（当前实现）：

- DI 区间：`<0.2` 共识，`0.2-0.4` 轻辩论，`0.4-0.7` 深辩论，`>=0.7` 上转/保守。
- 轮次上限：`FAST=1`，`LIGHT=2`，`DEEP=3`。
- 红旗短路：命中紧急规则直接进入线下上转路径，不强行输出。

## 治理与安全闭环

四层治理：

- `BASIC_SAFETY`
- `FLOW_CONTROL`
- `INTELLIGENT_COLLABORATION`
- `OPERATIONS`

核心触发 -> 动作（示例）：

| 触发条件 | 错误码 | 动作 |
|---|---|---|
| 最小信息缺失 | `ERR_MISSING_REQUIRED_DATA` | 请求补全并阻断自动结论 |
| 生命体征非法 | `ERR_INVALID_VITAL_SIGN` | 拒绝输入并提示修正 |
| 证据完整性不足 | `ERR_GUIDELINE_EVIDENCE_MISSING` | 阻断输出并进入人工复核 |
| 提示注入/越界 | `ERR_ADVERSARIAL_PROMPT_DETECTED` | 安全阻断并审计 |
| 红旗/高分歧 | `ERR_ESCALATE_TO_OFFLINE` | 线下上转 |

stop-loss 与回滚（默认策略）：

- 连续 critical 失败达到阈值触发冻结扩展。
- 发布阻断事件在窗口内超过阈值触发回滚。
- 触发后执行 gate 链与全量复核后再解冻。

## 互操作与数据接入现状

已实现：

- FHIR 资源映射与浏览（Patient/Observation/Provenance）。
- SMART scope 校验 + SMART introspection 基础链路。
- interop 入口：`POST /interop/fhir/triage-bundle`、`POST /interop/fhir/triage-bundle/submit`、`GET /interop/jobs/:id`。
- triage draft bundle 生成与引用完整性校验。
- FHIR 写回支持 `mock|real` 两种模式（`real` 模式可记录写回审计日志）。
- MCP 接入能力（本地 mock + 可配置远端 enrichment）。

当前限制：

- 真实写回虽可启用 `real` 模式，但站点级认证托管、白名单审批与回执一致性治理仍待完善。
- SMART introspection 已有基础实现，但跨机构信任域、密钥轮换与统一授权治理尚未完全落地。
- MCP 在多数场景仍以 mock 或弱耦合集成为主。

## 现阶段缺口（P0/P1/P2）

### P0（优先补齐）

- 人工复核后端闭环（基础版已实现；仍需补齐真实角色权限、工单联动与责任追踪）。
- 真实授权链路仍需生产化完善（已具备 SMART introspection 基础能力，待完成机构级联调与审计闭环）。
- 临床验证体系不足（真实样本、医生对照、KPI基线）。

### P1（中期补强）

- 病例纵向数据仓与随访任务流不足（回流标准化不足）。
- 多站点一致性与共享状态能力不足（当前 `memory/file` 偏单实例）。
- 互操作异步任务已具备骨架，仍需补齐生产级重试策略、死信治理与跨系统回执一致性。

### P2（长期演进）

- 跨病种多学科协同网络仍待扩展。
- 规模化下的成本、容量、漂移与稳定性治理仍需体系化。

### 会诊真实性提升执行矩阵（自动化闭环）

进度快照（截至 2026-03-11）：

- `npm run gap:status`：`6/6` 已完成（`100%`）。

| 任务 ID | 状态 | 目标能力 | 关键接口/模块 | 自动化验证 |
|---|---|---|---|---|
| `GAP-P0-001` | 已完成 | 生产暴露面鉴权硬化 | `/orchestrate_triage` `/governance/**` `/architecture/**` `/interop/**` `/mcp/**` | `npm run test --workspace=@copilot-care/backend -- src/tests/architecture/access-hardening.test.ts` |
| `GAP-P0-002` | 已完成 | 治理检索防滥用约束 | `/governance/medical-search` 参数上限与约束校验 | `npm run test --workspace=@copilot-care/backend -- src/tests/architecture/http-integration.test.ts` |
| `GAP-P0-003` | 已完成 | 人工复核闭环 | `GET /governance/review-queue` `POST /governance/review-queue/:id/decision` | `npm run test --workspace=@copilot-care/backend -- src/tests/architecture/governance-review-queue.http.test.ts` |
| `GAP-P1-001` | 已完成 | 患者纵向病例时间线 | `GET /patients/:id/cases` | `npm run test --workspace=@copilot-care/backend -- src/tests/architecture/patient-cases.http.test.ts` |
| `GAP-P1-002` | 已完成 | FHIR 异步回写任务骨架 | `POST /interop/fhir/triage-bundle/submit` `GET /interop/jobs/:id` | `npm run test --workspace=@copilot-care/backend -- src/tests/architecture/interop-submit-job.http.test.ts` |
| `GAP-P2-001` | 已完成 | 多站点策略与审计订阅 | `GET /governance/sites` `GET/PUT /governance/sites/:id/policy` `GET/POST/DELETE /governance/sites/:id/audit-subscriptions` | `npm run test --workspace=@copilot-care/backend -- src/tests/architecture/multi-site-policy.http.test.ts` |

当前会诊模块真实性判断：

- 流程真实性：高（主链路、治理门禁、人工复核、异步任务均已具备）。
- 数据真实性：中（已支持 FHIR `real` 写回模式，但多数联调场景仍依赖 mock/草案与站点级配置）。
- 边界处理真实性：高（证据门禁、红旗短路、安全审校与结构化阻断原因已贯通）。
- 运行真实性：高（鉴权、防滥用、多站点策略与审计订阅基础能力已落地）。

执行原则（逐项修补 + 失败回退）：

- 按单项任务推进：`npm run gap:next` -> `npm run gap:accept -- <TASK_ID> --retries=2`。
- 若验证失败，执行器按 `rollbackPaths` 自动回退到稳定状态。
- 每次执行写入 `reports/todos/gap-remediation.latest.json` 作为验收证据。

## 三阶段发展路线图（慢病核心先做深）

### 阶段 1：0-3 个月（临床可信 MVP）

- 目标能力：证据闭环 + 人工复核基础流 + 红旗稳态兜底。
- 关键里程碑：高风险阻断、复核处置、回写结论路径可跑通。
- 验收指标：红旗召回率、证据覆盖率、复核通过时延、关键路径成功率。
- 风险与兜底：模型不稳定时强制规则优先与人工接管。

### 阶段 2：3-9 个月（试点落地）

- 目标能力：真实 EMR/FHIR 接入 + SMART 鉴权 + 站点化治理。
- 关键里程碑：完成 1-2 个基层试点点位，形成审计留痕与运行 SLO。
- 验收指标：接口成功率、跨系统一致性、试点医生采纳率、SLO 达标率。
- 风险与兜底：互操作故障时降级为本地分诊链路并保留审计。

### 阶段 3：9-18 个月（规模化协同）

- 目标能力：多机构协同诊断网络 + 转诊回流 + 长期随访体系。
- 关键里程碑：跨机构策略治理、版本治理、回滚治理一体化。
- 验收指标：多站点可用性、回流闭环完成率、单位案例成本、稳定性指标。
- 风险与兜底：触发 stop-loss 时冻结扩展并自动回退到稳定版本。

## API / 类型演进（现状 + 规划）

说明：以下分为已实现能力与后续规划，避免文档与代码状态不一致。

Phase 1（复核闭环）：

- `GET /governance/review-queue`（已实现）
- `POST /governance/review-queue/:id/decision`（已实现）
- `GET /patients/:id/cases`（已实现）
- 已实现类型：`ReviewCase` / `ReviewDecision` / `CaseTimeline`

Phase 2（互操作异步化）：

- `POST /interop/fhir/triage-bundle/submit`（已实现：异步任务提交骨架）
- `GET /interop/jobs/:id`（已实现：任务状态查询与重试轨迹）
- 已实现类型：`InteropJob` / `InteropJobStatus` / `InteropRetryPolicy`
- 当前状态：默认 `mock` 写回；可通过 `COPILOT_CARE_INTEROP_WRITEBACK_MODE=real` + `COPILOT_CARE_INTEROP_FHIR_BASE_URL` 开启真实 FHIR 写回。
- 当前限制：真实写回仍需站点级认证、白名单与跨机构审计联动（当前仅提供基础审计日志）。

Phase 3（多机构治理）：

- 已实现接口（基础版）：
- `GET /governance/sites`
- `GET /governance/sites/:id/policy`
- `PUT /governance/sites/:id/policy`
- `GET /governance/sites/:id/audit-subscriptions`
- `POST /governance/sites/:id/audit-subscriptions`
- `DELETE /governance/sites/:id/audit-subscriptions/:subscriptionId`
- 已实现类型：`SiteGovernancePolicy` / `RuleVersionBinding` / `AuditSubscription`
- 当前限制：仍为单服务治理平面，尚未覆盖跨机构统一鉴权与跨站点一致性复制。

## 验证与验收

文档一致性要求：

- README 架构章节需与真实入口、接口路径、阈值和错误码一致。
- 禁止把“规划中能力”写成“已实现能力”。

基线命令（文档改造后）：

```bash
npm run check:encoding
npm run test --workspace=@copilot-care/backend -- src/tests/architecture/composition-root.test.ts src/tests/architecture/orchestrate-contract.test.ts
npm run test --workspace=@copilot-care/frontend -- src/views/FhirExplorerView.test.ts src/views/ConsultationView.integration.test.ts
npm run test --workspace=@copilot-care/backend -- src/infrastructure/orchestration/__tests__/ComplexityRoutedOrchestrator.evidenceGate.test.ts src/tests/architecture/http-integration.test.ts
npm run test --workspace=@copilot-care/frontend -- src/components/ConsultationResultPanel.test.ts src/composables/useConsultationViewModel.test.ts src/composables/useConsultationSessionRunner.test.ts src/views/ConsultationView.integration.test.ts
```

人工验收标准：

- 评审可在 5 分钟内看清系统目标、主链路、治理边界、当前缺口、下一阶段里程碑与指标。

## Assumptions

- 语言与受众：中文主写，术语保留必要英文，面向技术与评审双读者。
- 结构策略：保留现有 README 运维内容，不另建替代主文档。
- 业务策略：近期不扩病种广度，优先慢病核心深度与临床安全真实性。

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
- `COPILOT_CARE_REQUIRE_TRIAGE_AUTH`（建议生产保持 `true`）
- `COPILOT_CARE_TRIAGE_API_KEY`（当启用主链路鉴权时作为 Bearer token）
- `COPILOT_CARE_STRICT_DIAGNOSIS_MODE`（建议保持 `true`：命中预设 fallback 专家意见时，系统自动降级为 `ABSTAIN`，阻断伪确定性诊断）

> `COPILOT_CARE_FRONTEND_DIST=src/frontend/dist` 已在 blueprint 默认配置中提供，用于后端托管前端构建产物。
> 生产环境默认关闭 `/interop` 与 `/mcp`，且不再接受 `consent_local_demo`。

如需在生产环境开启受保护接口：

- `COPILOT_CARE_ENABLE_INTEROP=true`
- `COPILOT_CARE_INTEROP_API_KEY=<bearer token>`
- `COPILOT_CARE_ENABLE_MCP=true`
- `COPILOT_CARE_MCP_API_KEY=<bearer token>`

FHIR 写回模式（可选）：

- `COPILOT_CARE_INTEROP_WRITEBACK_MODE=mock|real`（默认 `mock`）
- `COPILOT_CARE_INTEROP_FHIR_BASE_URL=<fhir-base-url>`（`real` 模式必填）
- `COPILOT_CARE_INTEROP_FHIR_BUNDLE_PATH=/Bundle`（默认 `/Bundle`）
- `COPILOT_CARE_INTEROP_FHIR_AUTH_TOKEN=<upstream bearer token>`（可选）
- `COPILOT_CARE_INTEROP_REAL_TIMEOUT_MS=8000`（默认 8000ms）
- `COPILOT_CARE_INTEROP_AUDIT_LOG_FILE=reports/runtime/interop-writeback.runtime.jsonl`（真实写回尝试审计日志）

SMART introspection（生产建议开启）：

- `COPILOT_CARE_SMART_INTROSPECTION_ENABLED=true`
- `COPILOT_CARE_SMART_INTROSPECTION_URL=<introspection endpoint>`
- `COPILOT_CARE_SMART_INTROSPECTION_CLIENT_ID=<client id>`
- `COPILOT_CARE_SMART_INTROSPECTION_CLIENT_SECRET=<client secret>`
- `COPILOT_CARE_SMART_REQUIRED_AUDIENCE=<audience>`
- `COPILOT_CARE_SMART_REQUIRED_ISSUER=<issuer>`
- `COPILOT_CARE_SMART_SCOPE_HEADER_FALLBACK=false`（生产建议关闭，避免 header scope 覆盖 introspection）

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

## 缺口修补自动化工作流（逐项验证 + 失败回退）

新增清单与执行器：

- Manifest：`docs/process/gap-remediation-workflow.v10_00.json`
- 执行器：`scripts/gap-remediation-workflow.cjs`

常用命令：

```bash
npm run gap:sync
npm run gap:status
npm run gap:next
npm run gap:run -- --max=1 --retries=2
npm run gap:accept -- GAP-P0-001 --retries=2
```

回退机制：

- `gap:run` / `gap:accept` 任一验证命令失败时，会对任务配置的 `rollbackPaths` 执行 `git restore --worktree --staged -- ...` 自动回退。
- 每次执行会生成报告：`reports/todos/gap-remediation.latest.json`。

## 慢性病数据集预处理（chronic_disease_dataset）

当前仓库已内置慢病数据集预处理脚本：

- 脚本：`scripts/preprocess-chronic-disease-dataset.cjs`
- 命令：`npm run dataset:preprocess:chronic`
- 默认输入目录：`data/raw/chronic_disease_dataset`
- 默认输出目录：`data/processed/chronic_disease_dataset`

若源数据仍为压缩包，可先解压到默认输入目录（PowerShell）：

```powershell
New-Item -ItemType Directory -Force data\raw | Out-Null
Expand-Archive -Path "C:\Users\郭卓然\Desktop\慢性病数据集\Kimi_Agent_慢性病诊断集.zip" -DestinationPath "data\raw" -Force
```

预处理产物：

- `triage_requests.ndjson`：标准化 `TriageRequest` 样本（可直接用于 `/orchestrate_triage` 回放）
- `triage_requests.train.ndjson` / `dev` / `test`：按患者稳定切分
- `evaluation_cases.ndjson`：含期望诊断与风险提示，用于真实性/复杂性评测
- `quality_report.json`：缺失率、关联完整性、异常值等质量统计
- `README.md`：产物说明与复现实验入口

自定义输入/输出目录：

```bash
node scripts/preprocess-chronic-disease-dataset.cjs --input-dir <input_dir> --output-dir <output_dir>
```

## 混合 RAG 架构与审效工作流（2026-03）

当前 RAG 模块已从“单一在线检索”升级为“规则驱动 + 混合检索 + 证据门禁”架构。

核心能力：

- 需求拆解与专业重述：在规则优先评估后，生成 `decomposedNeeds`、`professionalRestatement`、`activatedSkills`。
- 混合检索：融合在线白名单源、词法检索（BM25）、向量检索（本地语料 + 运行时候选池）。
- 混合重排：使用 RRF/Reranker，并加入“前 3 结果稳态保护”避免重排导致命中率回退。
- 证据门禁：对 `requiredSources` 覆盖、红旗证据召回、结构化摘要进行校验。
- 前后端一致透传：`authoritativeSearch` 诊断信息可在会诊链路和前端推理时间线中展示。

日常工作流：

```bash
npm run rag:hybrid:sync
npm run rag:hybrid:status
npm run rag:hybrid:next
npm run rag:hybrid:run -- --max=1 --retries=2 --no-rollback
```

评测与审计：

```bash
# 离线/在线评测（默认混合检索 + 4s 检索超时）
npm run rag:hybrid:audit:offline
npm run rag:hybrid:audit:online

# 汇总审计并执行门禁
npm run rag:hybrid:audit -- --enforce=true
```

可选参数（`scripts/rag-offline-eval.cjs`）：

- `--hybrid=true|false`：显式开关混合检索评测。
- `--timeout-ms=<number>`：覆盖检索超时（毫秒）。
- `--network=true|false`：在线/离线模式。
- `--limit=<number>`：评测样本数。

审效指标（含架构深度指标）：

- 命中质量：`top3HitRate`、`mrrAt5`
- 证据完整性：`requiredSourceCoverageRate`、`redFlagEvidenceRecall`
- 总结结构化：`summaryStructuredRate`
- 架构深度：`needDecompositionRate`、`professionalRestatementRate`、`skillChainCoverageRate`、`hybridStrategyRate`
- 性能：`averageLatencyMs`、`averageEvaluationTimeMs`（门禁默认要求 `< 120000ms`，即 `< 2 分钟`）

最新审计快照（2026-03-15）：

- `offline`（120 样本）：`top3=0.9917`，`mrr=0.9917`，`hybridStrategyRate=1`
- `online`（60 样本）：`top3=1`，`mrr=0.9556`，`requiredSourceCoverageRate=1`，`redFlagEvidenceRecall=1`，`averageLatencyMs=14137.66`
- `overallPass=true`

证据文件：

- `reports/metrics/rag-hybrid.offline.latest.json`
- `reports/metrics/rag-hybrid.online.latest.json`
- `reports/metrics/rag-hybrid-audit.latest.json`
- `docs/process/rag-hybrid-audit-report.md`

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
- `/orchestrate_triage`、`/governance/**`、`/architecture/**` 在生产环境默认要求鉴权；需配置 `COPILOT_CARE_TRIAGE_API_KEY` 并使用 `Authorization: Bearer <token>`。
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
- `COPILOT_CARE_MED_SEARCH_HYBRID_RETRIEVER_ENABLED`（默认 `true`；启用向量+词法+在线的混合召回与重排）

## 架构与可观测接口

后端提供专家路由快照接口：

```bash
GET /architecture/experts
```

返回包含每个专家的 provider、来源（`env|default|invalid_fallback`）以及 `llmEnabled` 状态，前端可据此展示专家绑定情况。
`routing.strictDiagnosisMode` 与 `routing.fallbackCitationMarker` 用于标识“可信诊断门禁”是否开启及其回退标记口径，避免黑箱输出。

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
- 会诊前端“结构化结果”面板默认展示证据卡片与阻断原因卡片，降低纯规则矩阵带来的认知负担
- 触发阻断/上转时，会返回结构化 `blockingReason`（阶段、严重度、处置动作），前端可直接可视化

`/orchestrate_triage` 与 `/orchestrate_triage/stream` 的响应中新增可选字段
`ruleGovernance`、`blockingReason`，分别用于返回治理快照与阻断原因结构化信息（含阶段/严重度/动作）。
流式 `error` 事件会同步携带 `blockingReason`，确保前后端阻断语义一致。

新增 FHIR 最小互操作端点：

```bash
POST /interop/fhir/triage-bundle
```

说明：

- 默认可通过请求头 `x-smart-scope` 提供 scope，需同时包含 `Patient`、`Observation`、
  `Provenance` 的 `read` scope；
- 当开启 `COPILOT_CARE_SMART_INTROSPECTION_ENABLED=true` 时，系统会优先使用
  introspection scope；推荐通过 `x-smart-token`（或 `x-smart-access-token`）传递
  SMART access token（若未启用 `COPILOT_CARE_INTEROP_API_KEY`，也可复用
  `Authorization: Bearer <smart-token>`）；
- 返回 draft FHIR Bundle（Patient/Observation/Provenance）以及 triage 摘要；
- triage 摘要新增 `interopSummary`（资源计数 + 引用完整性校验），可直接用于验收；
- Provenance 将关联 Patient 与 Bundle 中 Observation，保证最小闭环可追溯；
- `COPILOT_CARE_INTEROP_WRITEBACK_MODE=mock` 时仅本地草案闭环；
- `COPILOT_CARE_INTEROP_WRITEBACK_MODE=real` 时可提交到外部 FHIR 目标并记录写回审计日志。
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
