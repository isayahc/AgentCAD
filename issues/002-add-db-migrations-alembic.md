# Add DB migrations for SQLite schema management

## Summary
Introduce migration tooling for `jobs` and `outputs` schema evolution.

## Why
Manual schema creation is fragile and hard to evolve safely.

## Scope
- Add Alembic config and initial migration.
- Add migration commands to README.
- Ensure startup doesn't rely solely on runtime `CREATE TABLE IF NOT EXISTS`.

## Acceptance Criteria
- Initial migration creates `jobs`, `outputs`, and indexes.
- Future schema updates can be applied with migration scripts.
- Local dev works without Docker.
