# ADR 0010: Rule Governance Versioning and Evidence Trace

## Context

The project already executes four-layer governance rules in runtime, but API
responses did not expose a stable governance payload for downstream auditing.
For pilot readiness, we need a deterministic response structure that includes:

- rule catalog version,
- matched rule IDs,
- guideline references,
- layer-level governance decisions,
- evidence trace identifier.

Without this payload, frontend governance views and operational audit pipelines
depend on inferred behavior from free-text notes.

## Decision

Introduce an optional `ruleGovernance` object in triage responses and make it
part of the shared contract.

Implementation details:

- add `RuleGovernanceSnapshot` and related layer decision types to
  `src/shared/types.ts`,
- generate governance snapshots in backend orchestration via
  `RuleGovernanceService`,
- expose rule catalog/version read-only APIs:
  - `GET /governance/rules/catalog`
  - `GET /governance/rules/version`,
- include catalog and gate linkage context in runtime telemetry snapshot.

This keeps existing endpoints and semantics unchanged while providing compatible
additive fields.

## Alternatives Considered

1. Keep governance metadata only in internal logs.
  - Rejected: frontend and API clients cannot reliably consume it.
2. Add governance metadata only to `/governance/runtime`.
  - Rejected: triage result payload still lacks session-scoped governance context.
3. Introduce a new triage v2 endpoint with required governance fields.
  - Rejected for now: unnecessary breaking change before pilot.

## Consequences

Positive:

- governance payload becomes auditable and machine-readable,
- easier contract testing for rule evidence continuity,
- frontend can render layer decisions without parsing notes.

Negative:

- response payload size increases slightly,
- more tests needed when adding new rule IDs or layer statuses.

## Rollout

1. Add shared types and backend payload generation.
2. Add governance catalog/version endpoints.
3. Update integration and contract tests.
4. Update frontend to consume `ruleGovernance` incrementally.

## Backout

Because fields are additive and optional, rollback can be limited to:

- stop emitting `ruleGovernance` from backend,
- retain shared optional type definitions for compatibility.
