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


@app.get("/step-files", response_model=List[StepFileEntry])
async def list_step_files():
    """Return a list of STEP files stored in the data directory."""
    entries: List[StepFileEntry] = []
    for p in sorted(DATA_DIR.iterdir()):
        if p.is_file() and p.suffix.lower() in (".step", ".stp"):
            entries.append(StepFileEntry(name=p.name, size=p.stat().st_size))
    return entries


@app.get("/step-files/{filename}")
async def get_step_file(filename: str):
    """Download / serve a STEP file from the data directory."""
    # Prevent path traversal
    safe = Path(filename).name
    file_path = DATA_DIR / safe
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {safe}")
    return FileResponse(
        path=str(file_path),
        filename=safe,
        media_type="application/octet-stream",
    )


@app.post("/run-agent", response_model=AgentResponse)
async def run_agent_endpoint(
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
