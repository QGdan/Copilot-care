# 0009-frontend-command-center-design-system.md

## Context

The frontend entered a competition-focused phase where visual quality and
explainability became first-class requirements, especially for the consultation
mainline:

1. Input console -> routing decision -> multi-agent reasoning -> safety review
   -> report export.
2. Existing styles and component states were partially fragmented across views,
   reducing coherence in demos and increasing regression risk.
3. We needed stronger narrative motion and icon consistency without introducing
   heavy chart/UI frameworks.

This change also adds two new dependencies, which requires ADR tracking.

## Decision

Adopt a `Clinical Mission Control` frontend design baseline with these decisions:

1. Introduce semantic token system v2 (`theme.css` + `motion.css`) and keep
   dual-theme support (`light`/`dark`).
2. Extend route metadata with `accent`, `scene`, `priority` to unify App Shell
   navigation language and scene atmosphere.
3. Standardize visualization semantics through typed states:
   - `VisualizationState`: `idle/running/blocked/done`
   - `ChartDensity`: `compact/comfortable`
   - shared prop naming (`state`, `density`, `sourceKind`) across reasoning
     visual components.
4. Add lightweight dependencies:
   - `@iconify/vue` for unified icon language.
   - `@vueuse/motion` for medium-intensity narrative transitions.
5. Keep ECharts as the only chart engine (no heavy replacement).

## Alternatives

1. Keep existing visual system and do only local component polishing.
   - Pros: lower implementation cost.
   - Cons: cannot produce a coherent command-center narrative for competition.

2. Introduce a heavy enterprise UI framework + chart suite.
   - Pros: rich component library.
   - Cons: larger bundle, migration risk, reduced control over custom medical
     visual language.

3. Freeze current UI and optimize backend only.
   - Pros: no frontend refactor risk.
   - Cons: demo differentiation and explainability visualization remain weak.

## Consequences

- Positive:
  - Unified cross-page visual language and route semantics.
  - Better readability for risk/status transitions in consultation flow.
  - Stronger demo storytelling with reusable motion + state model.
  - Type-level constraints reduce UI state drift.

- Negative:
  - Additional dependency maintenance (`@iconify/vue`, `@vueuse/motion`).
  - Some legacy style aliases must be preserved during migration period.
  - More strict testing needed on visualization components and theme variants.

## Rollout/Backout

- Rollout:
  1. Enable v8 workflow manifest (`docs/process/todos-workflow.v8_00.json`).
  2. Land token/motion/shell/visualization updates incrementally with test gates.
  3. Validate with frontend gates:
     - `test`
     - `typecheck`
     - `build`
     - `perf:check`
     - `check:copy`
  4. Update README with the 3-minute defense script and fallback plan.

- Backout:
  1. Revert theme/router/visualization API changes as one rollback set.
  2. Remove `@iconify/vue` and `@vueuse/motion` from frontend dependencies.
  3. Restore pre-v8 workflow manifest in `reports/todos/config.json`.
