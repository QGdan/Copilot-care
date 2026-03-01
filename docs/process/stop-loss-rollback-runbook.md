# Stop-Loss and Rollback Runbook (M4)

## Purpose

Define explicit stop-loss trigger rules and the rollback + re-test sequence when
pilot governance indicators degrade.

## Trigger Source

Implementation source:

- `src/backend/src/infrastructure/governance/stopLossGuard.ts`
- `src/backend/src/infrastructure/governance/KnowledgeVersionGovernor.ts`
- tests:
  - `src/backend/src/tests/architecture/stop-loss-guard.test.ts`
  - `src/backend/src/tests/scenarios/enhanced-governance-replay.test.ts`

## Stop-Loss Policy

Default trigger policy:

- consecutive critical failures >= `2`
- release-block failures in `30` minutes >= `3`
- governance catalog mismatch (`ruleGovernance.catalogVersion` drift) >= `1`

If any policy condition is met:

- freeze expansion work (`freezeExpansion=true`)
- require rollback to stable version when current != stable
- require full re-test before unfreeze

## Rollback and Re-Test Path

1. Detect trigger (`evaluateStopLoss`) and create decision record.
2. Execute rollback target selection (`evaluateKnowledgeRelease`).
3. Restore stable rules/config snapshot.
4. Run mandatory gates:
   - `npm run gate:safety`
   - `npm run gate:workflow`
   - `npm run gate:scenarios`
   - `npm run gate:metrics`
   - validate `GET /governance/rules/version` and
     `POST /interop/fhir/triage-bundle` smoke checks
5. Run full workflow:
   - `npm run devwf:full`
6. Record rollback and re-test evidence in reviewer findings.

## Reviewer Blocking Rule

If stop-loss is triggered and rollback evidence is missing, reviewer decision
must be `BLOCK` with `failedGateIds` including at least:

- `gate:safety`
- `gate:metrics`
- `devwf:full`
