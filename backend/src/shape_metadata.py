"""SQLite-backed metadata store for generated CAD shapes."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel


class ShapeRecord(BaseModel):
    """A single metadata entry for a generated STEP file."""

    id: str
    step_file: str
    description: str
    code: str
    created_at: str


class MetadataStore:
    """Thread-safe, SQLite-backed store for :class:`ShapeRecord` entries."""

    def __init__(self, data_dir: Path, db_filename: str = "agentcad.db") -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = (self.data_dir / db_filename).resolve()
        self.legacy_metadata_file = self.data_dir / "shapes_metadata.json"
        self._lock = threading.Lock()
        self._init_db()
        self._migrate_legacy_json_if_needed()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS shape_records (
                    id TEXT PRIMARY KEY,
                    step_file TEXT NOT NULL,
                    description TEXT NOT NULL,
                    code TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_shape_records_step_file
                ON shape_records(step_file)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_shape_records_created_at
                ON shape_records(created_at)
                """
            )

    def _row_to_record(self, row: sqlite3.Row) -> ShapeRecord:
        return ShapeRecord(
            id=row["id"],
            step_file=row["step_file"],
            description=row["description"],
            code=row["code"],
            created_at=row["created_at"],
        )

    def _migrate_legacy_json_if_needed(self) -> None:
        if not self.legacy_metadata_file.exists():
            return
        with self._lock:
            with self._connect() as conn:
                existing_count = conn.execute(
                    "SELECT COUNT(*) FROM shape_records"
                ).fetchone()[0]
                if existing_count > 0:
                    return

                try:
                    with open(self.legacy_metadata_file, "r") as fh:
                        raw = json.load(fh)
                except (OSError, ValueError, json.JSONDecodeError):
                    return

                if not isinstance(raw, list):
                    return

                for item in raw:
                    if not isinstance(item, dict):
                        continue
                    record_id = str(item.get("id") or uuid.uuid4())
                    step_file = str(item.get("step_file") or "").strip()
                    description = str(item.get("description") or "")
                    code = str(item.get("code") or "")
                    created_at = str(
                        item.get("created_at") or datetime.now(timezone.utc).isoformat()
                    )
                    if not step_file:
                        continue
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO shape_records (id, step_file, description, code, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (record_id, step_file, description, code, created_at),
                    )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_record(
        self,
        step_file: str,
        description: str,
        code: str,
    ) -> ShapeRecord:
        """Create and persist a new shape record."""
        record = ShapeRecord(
            id=str(uuid.uuid4()),
            step_file=step_file,
            description=description,
            code=code,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO shape_records (id, step_file, description, code, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        record.id,
                        record.step_file,
                        record.description,
                        record.code,
                        record.created_at,
                    ),
                )
        return record

    def list_records(self) -> list[ShapeRecord]:
        """Return all shape records, oldest first."""
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT id, step_file, description, code, created_at
                    FROM shape_records
                    ORDER BY created_at ASC
                    """
                ).fetchall()
        return [self._row_to_record(r) for r in rows]

    def get_record(self, record_id: str) -> Optional[ShapeRecord]:
        """Return a single record by *record_id*, or ``None``."""
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    """
                    SELECT id, step_file, description, code, created_at
                    FROM shape_records
                    WHERE id = ?
                    """,
                    (record_id,),
                ).fetchone()
        return self._row_to_record(row) if row else None
