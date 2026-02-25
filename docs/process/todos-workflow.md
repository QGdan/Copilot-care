# Plan-Constrained TODO Workflow (v5.12)

## Purpose

This workflow converts `docs/process/next-iteration-backlog.md` into an executable backlog with milestone gates.
It is designed for autonomous, standards-driven development with explicit evidence and reviewer blocking.

## Source of Truth

- Plan document: `docs/process/next-iteration-backlog.md`
- Workflow manifest: `docs/process/todos-workflow.v5_00.json`
- Runtime state: `reports/todos/workflow-state.json`
- Engine: `scripts/todos-workflow.cjs`

## Command Entry

```bash
npm run todos:doctor
npm run todos:init
npm run todos:status
npm run todos:list -- --state ready
npm run todos:next
npm run todos:start -- T27 --note "start expert routing strategy"
npm run todos:review -- T27 --note "ready for reviewer"
npm run todos:block -- T27 --note "missing evidence"
npm run todos:done -- T27 --note "completed" --evidence docs/adr/0004-expert-routing.md
npm run todos:verify -- T27 --scope verify
npm run todos:milestone -- M6 --run
```

## Mandatory Execution Loop (per TODO)

1. `plan`
- Confirm goal, scope, non-goal, acceptance, ADR trigger.
- Use TODO metadata from manifest, do not redefine constraints.

2. `build`
- Implement smallest viable change.
- Run `npm run todos:verify -- <TODO_ID>`.
- Attach evidence paths when marking done.

3. `reviewer`
- Findings-first review only.
- Output explicit `PASS` or `BLOCK`.
- If gate/ADR evidence is missing, reviewer must `BLOCK`.

4. local gate
- Minimum: `npm run devwf:iterate`
- Architecture-affecting task: `npm run devwf:arch`

## Milestone Gate Policy

- `M6`: Core Expert & Safety
- `M7`: Interoperability & Scale
- `M8`: Experience & Governance
- `M9`: Pilot Readiness
- `M10`: Engineering Reliability
- `M11`: Architecture & Quality Guardrails
- `M12`: Release Workflow Readiness
- `M13`: Competition Explainability Experience
- `M14`: Frontend Architecture Hardening
- `M15`: Competition Demo Reliability & Delivery

Milestone check:

```bash
npm run todos:milestone -- M6 --run
```

The command first checks TODO completion, then runs milestone gate commands from manifest.

## Plan Constraints Mapped into Workflow

- Chapter 4.5 thresholds: latency/safety/explainability/audit must be measurable.
- Chapter 5.2/5.3: core modules and contract template are frozen before optimization.
- Chapter 6.4/6.14: typed errors and runtime semantics are hard constraints.
- Chapter 7.2/7.14: A-F scenarios and review-gate flow are release conditions.
- Chapter 8.3: milestone progression is blocked without evidence.
- Chapter 9.4/9.8: risk-trigger and stop-loss actions are mandatory governance tasks.
- Chapter 10.6: each stage tracks target/actual/deviation/corrective action.

## Evidence Rule

Each completed TODO should provide at least one auditable artifact path, such as:

- source file changes,
- test report path,
- gate output record,
- ADR/document link.

## Recommended Daily Routine

```bash
npm run todos:status
npm run todos:next
npm run todos:start -- <TODO_ID> --note "work started"
# implement + verify
npm run todos:verify -- <TODO_ID>
npm run todos:review -- <TODO_ID> --note "await reviewer"
npm run todos:done -- <TODO_ID> --note "accepted" --evidence <path>
```

Release readiness checkpoint:

```bash
npm run gate:release
```

## v8 Frontend Command-Center Sprint

Use this when running the two-week frontend modernization plan
(`docs/process/todos-workflow.v8_00.json`).

Switch and inspect:

```bash
npm run design:use
npm run design:status
npm run design:next
```

Milestone execution:

```bash
# Week 1: H01-H06
npm run design:week1

# Week 2: H07-H12
npm run design:week2
```

Daily fixed loop for v8:

1. `npm run design:status`
2. pick next todo: `npm run design:next`
3. implement + verify:
   - `npm run test --workspace=@copilot-care/frontend`
   - `npm run typecheck --workspace=@copilot-care/frontend`
   - `npm run build --workspace=@copilot-care/frontend`
   - `npm run perf:check --workspace=@copilot-care/frontend`
   - `npm run check:copy --workspace=@copilot-care/frontend`
4. record evidence in `reports/todos/workflow-state.json`.

## Reviewer Blocking Conditions

Reviewer must block when any of these is true:

- required test command failed,
- milestone gate command failed,
- ADR trigger is true but ADR is missing,
- acceptance criteria are not evidenced.
