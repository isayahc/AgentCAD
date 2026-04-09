"""Persistent metadata store for generated CAD shapes.

Every time the agent successfully generates a STEP file, a record is saved
that captures:
  1. The STEP filename (relative to DATA_DIR).
  2. A human-readable description (the agent's chat response).
  3. The CadQuery Python code that produced the shape.

Records are stored in a single JSON file (``shapes_metadata.json``) inside
DATA_DIR.
"""

import json
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
    """Thread-safe, JSON-backed store for :class:`ShapeRecord` entries."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.metadata_file = data_dir / "shapes_metadata.json"
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load(self) -> list[dict]:
        if not self.metadata_file.exists():
            return []
        try:
            with open(self.metadata_file, "r") as fh:
                return json.load(fh)
        except (json.JSONDecodeError, ValueError):
            return []

    def _save(self, records: list[dict]) -> None:
        with open(self.metadata_file, "w") as fh:
            json.dump(records, fh, indent=2)

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
            records = self._load()
            records.append(record.model_dump())
            self._save(records)
        return record

    def list_records(self) -> list[ShapeRecord]:
        """Return all shape records, oldest first."""
        with self._lock:
            return [ShapeRecord(**r) for r in self._load()]

    def get_record(self, record_id: str) -> Optional[ShapeRecord]:
        """Return a single record by *record_id*, or ``None``."""
        with self._lock:
            for r in self._load():
                if r["id"] == record_id:
                    return ShapeRecord(**r)
        return None
