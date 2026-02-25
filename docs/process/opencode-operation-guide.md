# OpenCode Operation Guide

## 1. Preconditions

- OpenCode version: `1.2.6` or newer.
- Node/npm available in project environment.
- Work from repository root.
- Run `npm install` once before gate execution.
- Backend runtime auto-loads root `.env` (skipped in test mode).

## 2. Core Entry

- Runtime config: `opencode.json`
- Rule set: `.opencode/rules/*.md`
- Plugin source: `.opencode/plugins/superpower/index.js`
  (do not add it to `opencode.json` `plugin` list)

## 3. Daily Flow

1. Planning

```bash
opencode run --agent plan "Define scope, risks, and acceptance criteria for <task>."
```

2. Implementation

```bash
opencode run --agent build "Implement according to accepted plan and run validations."
```

3. Review

```bash
opencode run --agent reviewer "Review findings by severity and block/pass decision."
```

Reviewer output should follow:

- `docs/process/reviewer-findings-template.md`

## 4. Gate Commands

```bash
npm run guard:imports
npm run typecheck
npm run gate:safety
npm run gate:workflow
npm run gate:scenarios
npm run gate:metrics
npm run gate:release
npm run security:baseline
npm run security:secrets
npm run security:gate
```

Use `npm run gate:all` to run them in sequence.
Use `npm run gate:release` for release readiness
(`typecheck -> test -> workspace build -> gate:all`).
Run `npm run security:baseline` before milestone closeout or release review.
Run `npm run security:secrets` before push/release to catch accidental key leakage.
Run `npm run security:gate` to enforce vulnerability thresholds on production dependencies (`--omit-dev`; default strict: high/critical must be zero).
`gate:workflow` now also checks four-expert runtime wiring and provider env-key mapping.
`gate:metrics` generates and enforces M3 threshold report.
`gate:scenarios` now also generates the M5 batch replay report (`>=120` samples).
`gate:metrics` also generates target-vs-actual metric ledger records.
Metrics failure output prints a `breached indicators` list for direct reviewer blocking.

CI-equivalent local commands:

```bash
npm run ci:preflight
npm run ci:verify
npm run ci:nightly
```

## 5. Architecture-First Workflow

```bash
npm run devwf:arch
npm run devwf:iterate
npm run devwf:full
```

Use `devwf:arch` first to lock architecture baseline before detail iterations.

## 5.1 Plan-Constrained TODO Workflow (v5.12)

```bash
npm run todos:doctor
npm run todos:init
npm run todos:status
npm run todos:next
```

Task lifecycle:

```bash
npm run todos:start -- <TODO_ID> --note "start"
npm run todos:verify -- <TODO_ID> --scope verify
npm run todos:review -- <TODO_ID> --note "review-ready"
npm run todos:done -- <TODO_ID> --note "accepted" --evidence <path1,path2>
```

Frontend hardening checks (M14):

```bash
npm run check:copy --workspace=@copilot-care/frontend
npm run build --workspace=@copilot-care/frontend
npm run perf:check --workspace=@copilot-care/frontend
npm run perf:baseline --workspace=@copilot-care/frontend
```

`perf:check` validates current build-size budgets from the Vite manifest graph.
`perf:baseline` refreshes `reports/metrics/frontend-build-budget.baseline.json`.

Milestone lifecycle:

```bash
npm run todos:milestone -- <M6|M7|M8|M9|M10|M11|M12|M13|M14|M15> --run
```

Manifest source:

- `docs/process/todos-workflow.v5_00.json`
- `docs/process/todos-workflow.md`

M5 replication command:

```bash
npm run scenarios:replicate -- --set-id site-alpha --repeat 20
```

## 5.2 国创赛冲刺工作流 (v6.00)

> 适用于竞赛前4周冲刺，基于演示优先方案

### 快速开始

```bash
# 切换到国创赛冲刺工作流
npm run competition:use

# 查看当前进度
npm run competition:status

# 查看下一个任务
npm run competition:next
```

### 里程碑命令

```bash
# Week 1: 稳定基线与演示脚本
npm run competition:week1

# Week 2: 可解释性增强与材料初稿
npm run competition:week2

# Week 3: 全流程演练与材料定稿
npm run competition:week3

# Week 4: 压力测试与最终打磨
npm run competition:week4
```

### 竞赛门禁

```bash
# 竞赛专用快速门禁（安全+工作流+测试+构建+性能）
npm run competition:gate

# 启动演示环境（后端+前端）
npm run competition:demo
```

### 每日开发流程

```bash
# 晨间：检查状态
npm run competition:status

# 开始任务
npm run todos:start -- C01 --note "开始修复门禁告警"

# 完成任务
npm run todos:done -- C01 --note "已完成" --evidence <path>

# 提交前门禁
npm run competition:gate
```

### 工作流清单

| 周期 | 重点 | 关键命令 |
|------|------|----------|
| Week 1 | 稳定基线、演示脚本 | `npm run competition:week1` |
| Week 2 | 可解释性增强 | `npm run competition:week2` |
| Week 3 | 全流程演练 | `npm run competition:week3` |
| Week 4 | 最终打磨 | `npm run competition:week4` |

Manifest source: `docs/process/todos-workflow.v6_00.json`

## 5.3 医疗指挥舱前端冲刺工作流 (v8.00)

> 适用于会诊主战场高端化与答辩演示收敛（2 周首版）

### 快速开始

```bash
# 切换到 v8 工作流
npm run design:use

# 查看状态与下一任务
npm run design:status
npm run design:next
```

### 里程碑命令

```bash
# Week 1: H01-H06（设计系统 + 会诊主战场）
npm run design:week1

# Week 2: H07-H12（全站统一 + 答辩就绪）
npm run design:week2
```

### 冲刺门禁

```bash
# 前端高端化门禁（test + typecheck + build + perf + copy）
npm run design:gate
```

Manifest source: `docs/process/todos-workflow.v8_00.json`

## 6. Test Command

```bash
npm test
```

`gate:scenarios` runs workspace tests and fails on non-zero exit code.
Current baseline includes:
- backend architecture tests,
- frontend build smoke test,
- shared contract type-check test.

## 7. Model Overrides

Optional environment variables:

- `OPENCODE_MODEL_PLAN`
- `OPENCODE_MODEL_BUILD`
- `OPENCODE_MODEL_REVIEW`

These override agent model defaults through the Superpower plugin.

Optional backend external LLM variables:

- `COPILOT_CARE_LLM_PROVIDER` = `none|auto|deepseek|gemini|kimi|deepseek_gemini|openai|anthropic`
- `COPILOT_CARE_LLM_TIMEOUT_MS` (default: `12000`)
- `COPILOT_CARE_LLM_MAX_RETRIES` (default: `1`)
- `COPILOT_CARE_LLM_RETRY_DELAY_MS` (default: `300`)
- role-based provider split:
  - `COPILOT_CARE_CARDIO_PROVIDER` (recommended default: `deepseek`)
  - `COPILOT_CARE_GP_PROVIDER` (recommended default: `gemini`)
  - `COPILOT_CARE_METABOLIC_PROVIDER` (recommended default: `gemini`)
  - `COPILOT_CARE_SAFETY_PROVIDER` (recommended default: `kimi`)
- optional per-provider model vars:
  - `DEEPSEEK_LLM_MODEL`
  - `GEMINI_LLM_MODEL`
  - `KIMI_LLM_MODEL`
  - `OPENAI_LLM_MODEL`
  - `ANTHROPIC_LLM_MODEL`
- provider keys:
  - `DEEPSEEK_API_KEY`
  - `KIMI_API_KEY`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`
- optional provider base URLs:
  - `DEEPSEEK_BASE_URL`
  - `KIMI_BASE_URL`
  - `OPENAI_BASE_URL`
  - `ANTHROPIC_BASE_URL`
  - `GEMINI_BASE_URL`
- consent gate allowlist:
  - `COPILOT_CARE_CONSENT_TOKEN_ALLOWLIST` (comma-separated tokens)
  - built-in local token: `consent_local_demo`

If LLM provider config/key is missing, backend agents fall back to local heuristic logic.
If role provider value is invalid, backend falls back to role default provider.

Runtime check endpoint:

- `GET /architecture/experts` to verify role-provider wiring and LLM enabled states.

Optional frontend timeout variable:

- `VITE_API_TIMEOUT_MS` (default `120000`)

Optional M3 metrics threshold rehearsal variable:

- `COPILOT_CARE_M3_THRESHOLDS` (JSON string to override threshold values for dry-run/negative test)
- example:
  - PowerShell:
    ```powershell
    $env:COPILOT_CARE_M3_THRESHOLDS='{"highRiskRecallMin":1.1}'
    npm run gate:metrics
    Remove-Item Env:COPILOT_CARE_M3_THRESHOLDS
    ```

## 8. Failure Handling

- If `todos:doctor` fails, fix manifest/schema/wiring before development work.
- If `gate:safety` fails, fix configuration/rule/plugin issues first.
- If `gate:workflow` fails, fix missing docs/instruction targets.
- If `gate:scenarios` fails, resolve tests before review pass.
- If `security:secrets` fails, rotate/revoke exposed keys and replace literals with env vars.
- If ADR-triggering changes are made, add an ADR under `docs/adr/`.
- If `devwf:arch` fails, do not start feature-detail implementation.
- If repeated critical failures are detected, follow
  `docs/process/stop-loss-rollback-runbook.md`.
- For pilot release governance, use:
  - `docs/process/governance-release-package.md`
  - `docs/process/reviewer-findings-template.md`
- For iteration closeout, update:
  - `docs/process/iteration-01-task-status.md`
  - `docs/process/iteration-01-milestone-record.md`
  - `docs/process/iteration-01-closeout.md`
  - `docs/process/m5-closeout-report.md`
  - `docs/process/next-iteration-backlog.md`
