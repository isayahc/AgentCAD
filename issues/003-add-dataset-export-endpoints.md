# Add dataset export endpoints (JSONL)

## Summary
Add API endpoints to export training-ready records.

## Why
Current data is queryable but not optimized for easy dataset extraction pipelines.

## Scope
- Add `GET /dataset/export.jsonl` (streaming preferred).
- Add optional filters: date range, success-only, min score.
- Include query, cadquery code, step path, preview path, status metadata.

## Acceptance Criteria
- Endpoint returns valid JSONL records.
- Supports filtering for common dataset workflows.
- Documented in README with sample curl usage.
