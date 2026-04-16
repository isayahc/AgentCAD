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

from step_generating_agent import (
    run_agent_with_tools,
    run_self_correcting_agent,
    DATA_DIR,
    DEFAULT_MAX_SELF_CORRECT_ATTEMPTS,
    DEFAULT_MATCH_THRESHOLD,
)
from shape_metadata import MetadataStore, ShapeRecord
from job_store import JobStore, JobRecord, OutputRecord

# Re-use the same metadata store instance as the agent module.
metadata_store = MetadataStore(DATA_DIR)
job_store = JobStore(DATA_DIR)

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


class SelfCorrectionAttempt(BaseModel):
    attempt: int
    step_file: Optional[str] = None
    preview_file: Optional[str] = None
    score: float
    is_match: bool
    feedback: str


class SelfCorrectingAgentResponse(BaseModel):
    response: str
    tools_used: List[str]
    attempts: List[SelfCorrectionAttempt]
    successful_generations: List[dict]


class StepFileEntry(BaseModel):
    name: str
    size: int


class JobDetailResponse(BaseModel):
    job: JobRecord
    outputs: List[OutputRecord]


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


# ---------------------------------------------------------------------------
# Job dataset endpoints
# ---------------------------------------------------------------------------


@app.get("/jobs", response_model=List[JobRecord])
async def list_jobs(limit: int = 100):
    """List recent jobs (newest first)."""
    return job_store.list_jobs(limit=limit)


@app.get("/jobs/{job_id}", response_model=JobDetailResponse)
async def get_job(job_id: str):
    """Return a single job and all captured generation outputs."""
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return JobDetailResponse(job=job, outputs=job_store.list_outputs(job_id))


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
    mode = "self_correcting" if image is not None else "single_pass"
    job = job_store.create_job(
        query=question,
        mode=mode,
        image_filename=image.filename if image is not None else None,
    )

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

        if image_path is not None:
            agent_result = run_self_correcting_agent(question, image_path)
            attempt_logs = agent_result.get("attempts", [])
            for attempt_log in attempt_logs:
                generation_events = attempt_log.get("generation_events", [])
                attempt_no = int(attempt_log.get("attempt", 1))
                attempt_query = str(attempt_log.get("query", question))
                for event in generation_events:
                    job_store.add_output(
                        job_id=job.id,
                        attempt_no=attempt_no,
                        output_index=int(event.get("output_index", 0)),
                        query=attempt_query,
                        cadquery_code=str(event.get("cadquery_code", "")),
                        requested_filename=event.get("requested_filename"),
                        step_file=event.get("step_file"),
                        preview_file=event.get("preview_file"),
                        tool_message=str(event.get("tool_message", "")),
                        success=bool(event.get("success", False)),
                        score=attempt_log.get("score"),
                        is_match=attempt_log.get("is_match"),
                        feedback=attempt_log.get("feedback"),
                    )
        else:
            agent_result = run_agent_with_tools(question, image_path)
            for event in agent_result.get("generation_events", []):
                job_store.add_output(
                    job_id=job.id,
                    attempt_no=1,
                    output_index=int(event.get("output_index", 0)),
                    query=question,
                    cadquery_code=str(event.get("cadquery_code", "")),
                    requested_filename=event.get("requested_filename"),
                    step_file=event.get("step_file"),
                    preview_file=event.get("preview_file"),
                    tool_message=str(event.get("tool_message", "")),
                    success=bool(event.get("success", False)),
                )

        response_text = str(agent_result.get("response", ""))
        job_store.complete_job(job.id, response_text)
        return AgentResponse(response=response_text)

    except FileNotFoundError as exc:
        job_store.fail_job(job.id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        job_store.fail_job(job.id, str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        # Clean up the temporary image file.
        if image_path is not None:
            try:
                os.unlink(image_path)
            except OSError:
                pass


@app.post("/run-agent-self-correct", response_model=SelfCorrectingAgentResponse)
def run_self_correcting_agent_endpoint(
    question: str = Form(...),
    image: UploadFile = File(...),
    max_attempts: int = Form(DEFAULT_MAX_SELF_CORRECT_ATTEMPTS),
    match_threshold: float = Form(DEFAULT_MATCH_THRESHOLD),
):
    """Run iterative generate->judge self-correction and return per-attempt logs.

    - **question**        – natural-language instruction for the CAD agent.
    - **image**           – required reference image to match.
    - **max_attempts**    – maximum self-correction iterations.
    - **match_threshold** – required judge score in [0, 1] to stop early.
    """
    image_path: Optional[str] = None
    job = job_store.create_job(
        query=question,
        mode="self_correcting",
        image_filename=image.filename,
    )

    try:
        if max_attempts < 1:
            raise HTTPException(status_code=400, detail="max_attempts must be >= 1")
        if not (0.0 <= match_threshold <= 1.0):
            raise HTTPException(
                status_code=400,
                detail="match_threshold must be between 0.0 and 1.0",
            )

        suffix = os.path.splitext(image.filename or "upload.jpg")[1] or ".jpg"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            shutil.copyfileobj(image.file, tmp)
        finally:
            tmp.close()
        image_path = tmp.name

        result = run_self_correcting_agent(
            question=question,
            image_path=image_path,
            max_attempts=max_attempts,
            match_threshold=match_threshold,
        )

        for attempt_log in result.get("attempts", []):
            generation_events = attempt_log.get("generation_events", [])
            attempt_no = int(attempt_log.get("attempt", 1))
            attempt_query = str(attempt_log.get("query", question))
            for event in generation_events:
                job_store.add_output(
                    job_id=job.id,
                    attempt_no=attempt_no,
                    output_index=int(event.get("output_index", 0)),
                    query=attempt_query,
                    cadquery_code=str(event.get("cadquery_code", "")),
                    requested_filename=event.get("requested_filename"),
                    step_file=event.get("step_file"),
                    preview_file=event.get("preview_file"),
                    tool_message=str(event.get("tool_message", "")),
                    success=bool(event.get("success", False)),
                    score=attempt_log.get("score"),
                    is_match=attempt_log.get("is_match"),
                    feedback=attempt_log.get("feedback"),
                )

        job_store.complete_job(job.id, str(result.get("response", "")))
        return SelfCorrectingAgentResponse(**result)

    except FileNotFoundError as exc:
        job_store.fail_job(job.id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        job_store.fail_job(job.id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        job_store.fail_job(job.id, str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if image_path is not None:
            try:
                os.unlink(image_path)
            except OSError:
                pass
