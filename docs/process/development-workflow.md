# Architecture-First Development Workflow (Iteration 1)

## Current Update (2026-03)

This project is now operated in a mixed mode:

- Legacy architecture baseline and gate contracts from Iteration 1 stay enforced.
- Active delivery uses the v8 TODO manifest plus governance follow-up scripts.

Recommended execution loop per change:

1. Sync task context.
- `npm run design:status`
- `npm run design:next`

2. Run preflight before coding.
- `npm run ci:preflight`

3. Implement the minimum viable change.
- Keep architecture boundaries (`domain -> application -> infrastructure/interfaces`) intact.
- Add tests for new public behavior.

4. Run scoped verification.
- Frontend change: `npm run test --workspace=@copilot-care/frontend`
- Backend change: `npm run test --workspace=@copilot-care/backend`
- Shared contract change: `npm run test --workspace=@copilot-care/shared`

5. Run unified verification before merge.
- `npm run ci:verify`

6. Record evidence.
- Update `reports/todos/workflow-state.json` evidence paths.
- Ensure reports are available under `reports/runtime`, `reports/metrics`, `reports/security` if relevant.

Local runtime stability rules:

- Backend fixed port: `APP_PORT=3101`
- Frontend fixed port: `npm run dev --workspace=@copilot-care/frontend -- --host 127.0.0.1 --port 5173 --strictPort`
- If `5173` is occupied, free the port first instead of auto-fallback to `5174`.

Failure feedback policy:

- Any gate/test failure should be attached with command, exit code, and log path.
- Security audit failures must include `reports/security/npm-audit.latest.json` (if generated).
- Runtime integration failures must include `reports/runtime/*.log`.

The remaining sections in this file document the original Iteration 1 baseline and remain valid as historical constraints.

## Iteration 1 Scope Freeze

- Goal: close architecture loop and stabilize gates before detail optimization.
- Include:
  - backend end-to-end orchestration path,
  - frontend minimal integration and result display,
  - quality gates automation,
  - handover-ready docs.
- Exclude:
  - advanced algorithm tuning,
  - UI fine polishing,
  - deep performance optimization,
  - A-F scenario detail expansion.

## Main Workflow Tracks

1. Architecture baseline: boundaries, dependency direction, config/gates fixed.
2. Core backend path: input to triage decision is runnable.
3. Frontend minimum loop: submit input, call backend, render status/result.
4. Hard quality gates: tests/rules/ADR/reviewer block behavior.
5. Milestone acceptance: one-command verification for iteration baseline.

## Blueprint Gate (Mandatory Before Coding)

Before starting any implementation task, the assignee must read and align with:

- `docs/process/ch3-6-architecture-blueprint.md`

No task may skip this gate. Any deviation from chapter 3/4/5/6 contracts must be
recorded by ADR before merge.

## Iteration 1 Task Breakdown (T1-T14)

1. `T1` Freeze contract list.
- Deliverable: `docs/architecture.md` with module boundaries, I/O, error codes.

2. `T2` Unify agent runtime rules.
- Deliverable: `opencode.json` plan/build/reviewer + permission matrix confirmed.

3. `T3` Complete Superpower constraints.
- Deliverable: plugin + `superpower.md` aligned.

4. `T4` Confirm backend composition root.
- Deliverable: backend wiring explicit, no hidden global state.

5. `T5` Run core arbitration path.
- Deliverable: `DebateEngine` stable output path.

6. `T6` Standardize error handling.
- Deliverable: typed errors/error codes at boundary, no raw string throws.

7. `T7` Strengthen architecture smoke tests.
- Deliverable: `src/backend/src/tests/architecture/*` covers entry + orchestration path.

8. `T8` Build frontend minimum closed loop.
- Deliverable: submit input -> API call -> result/status rendering.

9. `T9` Align shared contracts.
- Deliverable: `src/shared` request/response types used by frontend + backend.

10. `T10` Calibrate gate scripts.
- Deliverable: `gate-checks.cjs` validates safety/workflow/scenarios essentials.

11. `T11` Solidify development flow.
- Deliverable: `dev-workflow.cjs` and this document stay consistent.

12. `T12` Complete command mapping.
- Deliverable: `opencode-command-mapping.md` contains no pseudo commands.

13. `T13` Land contribution process.
- Deliverable: `CONTRIBUTING.md` includes gate failure and role handoff rules.

14. `T14` Record milestone acceptance.
- Deliverable: run `npm run devwf:full` and write result into docs.

## Fixed Execution Loop (per task)

1. `plan`: write task card (goal/scope/non-goal/acceptance/ADR trigger).
2. `build`: implement minimum change and add tests.
3. `reviewer`: findings-first pass/block decision.
4. local gate:
- minimum: `npm run devwf:iterate`
- key tasks: `npm run devwf:arch`
5. milestone: `npm run devwf:full`

## Definition of Done (Iteration 1)

1. `npm run devwf:arch` passes.
2. `npm run devwf:full` passes.
3. architecture/process/contribution docs can onboard new contributors.
4. reviewer can block when tests/ADR conditions are unmet.

## Command Reference

```bash
npm run typecheck
npm run gate:safety
npm run gate:workflow
npm run gate:scenarios
npm run gate:metrics
npm run gate:release
npm run devwf:arch
npm run devwf:iterate
npm run devwf:full
npm run todos:workflow
```

## Plan-Constrained TODO Workflow (v5.10)

Use `docs/process/todos-workflow.v5_00.json` as the executable backlog sourced from
`docs/process/next-iteration-backlog.md`.

```bash
npm run todos:doctor
npm run todos:init
npm run todos:status
npm run todos:next
```

Per task loop:

1. `plan`: lock goal/scope/non-goal/acceptance/ADR trigger from TODO metadata.
2. `build`: implement minimum change + run `npm run todos:verify -- <TODO_ID>`.
3. `reviewer`: findings-first pass/block decision.
4. close task with evidence:

```bash
npm run todos:done -- <TODO_ID> --note "accepted" --evidence <path>
```

Milestone gate:

```bash
npm run todos:milestone -- M6 --run
```

## Current Validation Baseline

- `devwf:arch` validates:
  - safety/workflow gates,
  - shared contract type check,
  - backend build + backend architecture tests,
  - frontend build smoke (via frontend workspace test).
- `devwf:full` validates:
  - full gate chain,
  - backend + frontend production builds,
  - all workspace tests.

## Iteration 1 Closeout Package

Before closing Iteration 1, the following artifacts must exist:

- task status:
  - `docs/process/iteration-01-task-status.md`
- milestone acceptance:
  - `docs/process/iteration-01-milestone-record.md`
- closeout decision:
  - `docs/process/iteration-01-closeout.md`
- reviewer report format:
  - `docs/process/reviewer-findings-template.md`

## Autonomous Orchestration Loop (Current Runtime)

The live consultation stream now follows this fixed loop:

1. `Chief Coordinator (总Agent)` assigns tasks and emits orchestration snapshot.
2. `Intake + MCP` stage enriches context from cloud patient data (when configured).
3. `Risk + Routing` stage decides single-specialty vs multi-disciplinary path.
4. `Execution` stage runs specialist collaboration and consensus convergence.
5. `Synthesis` stage generates explainable output with reviewer constraints.
6. `Complete` stage emits final coordinator summary and typed result payload.

## Runtime Knobs (for independent development)

- `COPILOT_CARE_LLM_TIMEOUT_MS`
  - default: `300000` (5 minutes)
- `COPILOT_CARE_COORDINATOR_PROVIDER`
  - provider chain for total-agent snapshot generation (default `deepseek,gemini,kimi`)
- `COPILOT_CARE_COORDINATOR_TIMEOUT_MS`
  - timeout for coordinator snapshot model calls
- `COPILOT_CARE_MCP_BASE_URL`
  - MCP endpoint root (`/patient/context` is invoked when enabled)
- `COPILOT_CARE_MCP_API_KEY`
  - optional MCP auth token

