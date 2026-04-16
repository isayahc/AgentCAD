# Unify metadata persistence (SQLite as source of truth)

## Summary
We currently store generation metadata in both `data/shapes_metadata.json` and SQLite (`jobs`/`outputs`). This creates drift risk and duplicate logic.

## Why
A single persistence model is needed for reliable dataset exports and production behavior.

## Scope
- Make SQLite the authoritative store for generation metadata.
- Keep `shape-records` API compatibility by reading from SQLite (or deprecate with migration path).
- Stop writing new records to `shapes_metadata.json`.

## Acceptance Criteria
- New generations are persisted only to SQLite metadata tables.
- Existing `shape-records` behavior is preserved or replaced with documented API change.
- README documents persistence model clearly.
