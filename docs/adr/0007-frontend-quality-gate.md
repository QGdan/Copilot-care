# 0007-frontend-quality-gate.md

Status: Superseded by 0008-monorepo-ci-automation-workflow.md.

## Context

Frontend quality checks were previously run manually in local development. This allowed type regressions, broken tests, or build failures to reach pull requests without an automated gate. The frontend is now structurally larger (views, composables, feature modules), so relying on manual checks is no longer reliable.

We need a lightweight CI policy that validates core frontend correctness on every change affecting frontend/shared code.

## Decision

Introduce a dedicated GitHub Actions workflow: `.github/workflows/frontend-quality-gate.yml`.

The workflow runs on `pull_request` and on pushes to `main`/`master` when relevant files change, and enforces these commands:

1. `npm run typecheck --workspace=@copilot-care/frontend`
2. `npm run test --workspace=@copilot-care/frontend`
3. `npm run build --workspace=@copilot-care/frontend`

## Alternatives

1. Keep manual checks only.
   - Pros: No CI runtime cost.
   - Cons: High regression risk and inconsistent enforcement.

2. Run full monorepo release gate for every frontend PR.
   - Pros: Stronger guarantees.
   - Cons: Slower feedback, unnecessary cost for UI-only changes.

## Consequences

- Positive:
  - Prevents common frontend regressions before merge.
  - Standardizes quality expectations for all contributors.
  - Provides fast feedback scoped to affected frontend/shared paths.

- Negative:
  - Adds CI runtime and maintenance overhead.
  - Does not guarantee backend or cross-workspace release readiness by itself.

## Rollout/Backout

- Rollout: enable the new workflow file and require it in repository branch protection rules.
- Backout: remove `.github/workflows/frontend-quality-gate.yml` and CI requirement if it causes unacceptable pipeline overhead.
