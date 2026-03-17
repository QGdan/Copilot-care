# ADR 0012: Hybrid RAG Architecture Transition

## Context

Current medical RAG path is optimized for authority governance and safety:

- rule-driven query planning,
- whitelisted realtime retrieval (PubMed + authoritative web),
- evidence completeness gate and audit trace.

This design is safe and explainable, but realtime dependency causes:

- high online latency variance,
- unstable required-source coverage under provider/network fluctuation,
- weaker offline deterministic recall than vectorized local corpus retrieval.

We need a migration path that improves retrieval robustness while preserving
medical governance constraints.

## Decision

Adopt a hybrid RAG architecture:

1. Keep existing rule-driven planning and evidence governance layer.
2. Add local knowledge retrieval channels:
  - dense vector retrieval over curated authoritative corpus,
  - lexical retrieval (BM25) for exact term/threshold matching.
3. Fuse candidates from vector + lexical + realtime providers through
   weighted RRF and policy-aware reranking.
4. Keep existing required-source coverage enforcement and high-risk gate.
5. Roll out behind feature flags with staged workflow checkpoints.

## Alternatives Considered

1. Full switch to vector-only retrieval.
  - Rejected: insufficient authority coverage control, weak realtime freshness.
2. Keep realtime-only architecture and tune query expansion.
  - Rejected: latency/coverage instability remains structurally unsolved.
3. Replace orchestration with external RAG framework end-to-end.
  - Rejected for current phase: high migration risk and rollback complexity.

## Consequences

Positive:

- better recall stability in offline/poor-network conditions,
- lower dependence on external provider jitter,
- preserves current medical governance and explainability guardrails.

Negative:

- increases system complexity (index lifecycle, embedding pipelines),
- requires new operational controls (index versioning, corpus freshness),
- introduces more integration tests and workflow gates.

## Rollout

1. Freeze baseline metrics and workflow gates.
2. Build ingestion/chunking/indexing modules.
3. Introduce hybrid retriever and reranker with feature flag.
4. Run offline + online audit loops and compare against baseline.
5. Promote gradually by environment and traffic scope.

## Backout

If quality or performance regresses:

- disable hybrid feature flag and revert to current realtime-first path,
- restore previous index snapshot and provider configuration,
- keep audit reports for postmortem and targeted remediation.
