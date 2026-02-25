# 0008-monorepo-ci-automation-workflow.md

## Context

Current repository automation has a frontend-only quality gate, while cross-workspace regressions (backend/shared/script-level drift) still rely on manual local execution. We now maintain multiple gates (`security`, `workflow`, `typecheck`, `test`, `build`, `perf`) that should run consistently for pull requests and mainline updates.

The existing workflow gate script was also pinned to outdated TODO milestone/version assumptions, causing false failures and reducing CI trust.

## Decision

Introduce a monorepo automation workflow with two layers:

1. `Monorepo Dev Workflow` (`.github/workflows/monorepo-dev-workflow.yml`)
   - Trigger: PR/push on main branches + manual dispatch.
   - Command chain: `npm run ci:verify`.
2. `Nightly Regression` (`.github/workflows/nightly-regression.yml`)
   - Trigger: scheduled run + manual dispatch.
   - Command chain: `npm run ci:nightly`.

Add standardized root scripts:

1. `ci:preflight`
2. `ci:verify`
3. `ci:nightly`

Align `scripts/gate-checks.cjs` with current TODO workflow reality:

1. Accept milestones `M6-M15`.
2. Accept TODO manifest versions `v5.11+`.

Add security threshold enforcement:

1. `security:gate` enforces `high=0` and `critical=0` on production dependencies (`--omit-dev`).
2. `ci:nightly` appends `security:gate` after baseline generation.

## Alternatives

1. Keep frontend-only CI and require manual monorepo gates.
   - Pros: lower CI runtime.
   - Cons: backend/shared regressions can merge unnoticed.

2. Run `gate:release` for every PR.
   - Pros: strongest default guarantee.
   - Cons: slower feedback and higher CI cost for routine iteration.

3. Keep CI unchanged and rely on pre-merge checklist discipline.
   - Pros: no infrastructure change.
   - Cons: inconsistent enforcement and higher human error rate.

## Consequences

- Positive:
  - PRs get consistent monorepo validation.
  - Nightly run continuously checks regression + security baseline generation.
  - Local and CI command chain is unified via `ci:*` scripts.
  - Workflow gate checks no longer fail due stale milestone/version expectations.
  - Nightly pipeline escalates dependency risk by failing on high/critical vulnerabilities.

- Negative:
  - CI runtime cost increases compared with frontend-only gate.
  - Current dependency tree may fail nightly until vulnerable packages are remediated.

## Rollout/Backout

- Rollout:
  1. Merge workflow files and `ci:*` scripts.
  2. Add required checks in branch protection:
     - `Monorepo Dev Workflow / verify`
     - existing frontend gate (optional keep/remove by team policy)
  3. Monitor CI duration and failure hotspots for 1 week.

- Backout:
  1. Remove the two new workflow files.
  2. Remove `ci:*` scripts from root `package.json`.
  3. Revert gate-checks milestone/version expectations to prior policy.
