# Persist all generation attempts including failures

## Summary
Ensure every tool call attempt is persisted with enough detail for analysis.

## Why
Failure attempts are high-value training data and debugging signals.

## Scope
- Persist every tool call event in `outputs` with:
  - query
  - cadquery code
  - tool message
  - success/failure
  - error/feedback/judge fields when available
- Validate ordering (`attempt_no`, `output_index`).

## Acceptance Criteria
- Failed tool executions appear in `outputs`.
- Self-correcting runs persist attempt-level score/feedback.
- No silent drops in attempt logs.
