# Add frontend jobs view for dataset records

## Summary
Expose persisted SQLite job/output data in the UI.

## Why
Users need quick visibility into prompt/code/output history for curation.

## Scope
- Add panel/table for `GET /jobs`.
- Add details view for `GET /jobs/{job_id}`.
- Display query, status, attempt count, code snippet, and step links.

## Acceptance Criteria
- Users can browse recent runs and inspect output details.
- UI links to existing step file download endpoint.
- Works on desktop and mobile layouts.
