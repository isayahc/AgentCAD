# Add artifact retention and cleanup policy

## Summary
Define and implement retention for generated STEP/SVG artifacts.

## Why
Dataset growth will eventually consume storage without controls.

## Scope
- Add configurable retention policy (age, total size, keep-last-N).
- Add cleanup command/task with dry-run mode.
- Ensure DB records remain consistent after cleanup (or mark purged artifacts).

## Acceptance Criteria
- Retention policy is configurable via env vars.
- Cleanup can run safely and predictably.
- Documentation includes recommended defaults.
