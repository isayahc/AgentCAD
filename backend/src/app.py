"""FastAPI backend exposing the CAD-generation agent as an HTTP endpoint."""

import os
import tempfile
import shutil
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from step_generating_agent import run_agent, DATA_DIR
from shape_metadata import MetadataStore, ShapeRecord

# Re-use the same metadata store instance as the agent module.
metadata_store = MetadataStore(DATA_DIR)

app = FastAPI(title="AgentCAD API")

# Allow the Next.js frontend (and any localhost origin during development) to
# call the API without being blocked by the browser's same-origin policy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AgentResponse(BaseModel):
    response: str


class StepFileEntry(BaseModel):
    name: str
    size: int


def _get_available_step_files() -> dict[str, Path]:
    """Return a mapping of filename → resolved path for STEP files in DATA_DIR."""
    result: dict[str, Path] = {}
    for p in DATA_DIR.iterdir():
        if p.is_file() and p.suffix.lower() in (".step", ".stp"):
            result[p.name] = p.resolve()
    return result


@app.get("/step-files", response_model=List[StepFileEntry])
async def list_step_files():
    """Return a list of STEP files stored in the data directory."""
    entries: List[StepFileEntry] = []
    for name, path in sorted(_get_available_step_files().items()):
        entries.append(StepFileEntry(name=name, size=path.stat().st_size))
    return entries


@app.get("/step-files/{filename}")
async def get_step_file(filename: str):
    """Download / serve a STEP file from the data directory.

    Only files that actually exist in the data directory and have a
    ``.step`` / ``.stp`` extension are served.  The filename is looked up
    against the known set of files (allowlist), so path-traversal is not
    possible.
    """
    available = _get_available_step_files()

    # Normalise to a bare filename for the lookup (strip any leading path)
    requested = Path(filename).name

    if requested not in available:
        raise HTTPException(status_code=404, detail=f"File not found: {requested}")

    # Use the path that was discovered via directory listing – this is fully
    # controlled by the server and never constructed from user input.
    resolved = available[requested]
    return FileResponse(
        path=str(resolved),
        filename=requested,
        media_type="application/octet-stream",
    )


# ---------------------------------------------------------------------------
# Shape metadata endpoints
# ---------------------------------------------------------------------------


@app.get("/shape-records", response_model=List[ShapeRecord])
async def list_shape_records():
    """Return metadata for all generated shapes (oldest first)."""
    return metadata_store.list_records()


@app.get("/shape-records/{record_id}", response_model=ShapeRecord)
async def get_shape_record(record_id: str):
    """Return metadata for a single shape by its unique *record_id*."""
    record = metadata_store.get_record(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Record not found: {record_id}")
    return record


@app.post("/run-agent", response_model=AgentResponse)
def run_agent_endpoint(
    question: str = Form(...),
    image: Optional[UploadFile] = File(None),
):
    """Run the CAD-generation agent on *question* and an optional uploaded image.

    - **question** – natural-language instruction for the agent.
    - **image**   – optional image file (png, jpg, …) to accompany the question.
    """
    image_path: Optional[str] = None

    try:
        # If an image was uploaded, persist it to a temp file so the agent can
        # read it by path.
        if image is not None:
            suffix = os.path.splitext(image.filename or "upload.jpg")[1] or ".jpg"
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            try:
                shutil.copyfileobj(image.file, tmp)
            finally:
                tmp.close()
            image_path = tmp.name

        result = run_agent(question, image_path)
        return AgentResponse(response=result)

    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        # Clean up the temporary image file.
        if image_path is not None:
            try:
                os.unlink(image_path)
            except OSError:
                pass
