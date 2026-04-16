# Add tests for job store and dataset API endpoints

## Summary
Add test coverage around SQLite persistence and API contracts.

## Why
Current behavior is evolving quickly and needs regression protection.

## Scope
- Unit tests for `JobStore` (create, complete, fail, add_output, list/get).
- API tests for `/jobs` and `/jobs/{job_id}`.
- Tests for single-pass and self-correcting flows persisting expected records.

## Acceptance Criteria
- Tests pass in local dev environment.
- Core persistence paths are covered.
- Failures produce actionable test output.
