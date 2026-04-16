# Add structured logging and request IDs for job tracing

## Summary
Improve backend observability with structured logs tied to `job_id`.

## Why
Troubleshooting multi-attempt generation runs is currently difficult.

## Scope
- Add request/job correlation IDs in logs.
- Log job lifecycle events: created, attempt persisted, completed, failed.
- Standardize error log structure.

## Acceptance Criteria
- Logs include `job_id` and route context.
- Failures are easy to trace from API request to persisted records.
- No sensitive data leakage in logs.
