# ADR 0011: FHIR + SMART Runtime Minimal Interop Loop

## Context

FHIR/SMART mapping existed in documentation, but runtime interop stayed at
read-only mock resources. For pilot progress, we need a minimal executable
interoperability path that can:

- validate SMART scope at runtime,
- generate a draft FHIR bundle from real triage execution,
- keep scope limited to core resources (Patient/Observation/Provenance).

## Decision

Add a minimal runtime interop endpoint:

- `POST /interop/fhir/triage-bundle`

Behavior:

- requires `x-smart-scope` header,
- enforces SMART read permissions on `Patient`, `Observation`, and
  `Provenance`,
- runs triage through existing orchestrator,
- outputs a draft FHIR Bundle containing:
  - mapped `Patient`,
  - mapped `Observation[]`,
  - mapped `Provenance[]`.

The endpoint is intentionally additive and does not replace existing
`/orchestrate_triage` behavior.

## Alternatives Considered

1. Implement full SMART launch + OAuth introspection first.
  - Rejected for this iteration: too large for pilot baseline window.
2. Export static FHIR templates without running triage.
  - Rejected: no runtime evidence chain, weak pilot value.
3. Add write-back to external FHIR server in same step.
  - Rejected: introduces operational dependency and rollback complexity.

## Consequences

Positive:

- documents-only interop becomes testable runtime capability,
- SMART scope rejection path is executable and verifiable,
- creates a stable base for future write-back and launch flow.

Negative:

- current SMART enforcement uses a lightweight header-based check,
  not full token introspection,
- endpoint currently outputs draft bundle only (no external persistence).

## Rollout

1. Add interop router and endpoint.
2. Wire endpoint in backend app.
3. Add integration tests for allowed/denied SMART scope scenarios.
4. Extend deployment and pilot runbooks with endpoint checks.

## Backout

If issues are found:

- disable `/interop` router registration while preserving core triage APIs,
- keep mappers and tests to re-enable after fixes.
