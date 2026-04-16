import os
import base64
import mimetypes
import argparse
import json
import re
from pathlib import Path
import cadquery as cq
from langchain_community.chat_models import ChatLiteLLM
from langchain.agents import create_agent
from langchain_core.tools import tool

from shape_metadata import MetadataStore

# Resolve the data directory relative to the repository root.
# The backend source lives at <repo>/backend/src/, so go two levels up.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = Path(os.environ.get("STEP_DATA_DIR", str(_REPO_ROOT / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Metadata store persists a record for each generated shape.
metadata_store = MetadataStore(DATA_DIR)

DEFAULT_AGENT_MODEL = os.environ.get(
    "AGENT_MODEL", "anthropic/claude-sonnet-4-5-20250929"
)
DEFAULT_JUDGE_MODEL = os.environ.get("SELF_CORRECT_VLM_MODEL", DEFAULT_AGENT_MODEL)
DEFAULT_MAX_SELF_CORRECT_ATTEMPTS = int(
    os.environ.get("SELF_CORRECT_MAX_ATTEMPTS", "4")
)
DEFAULT_MATCH_THRESHOLD = float(os.environ.get("SELF_CORRECT_MATCH_THRESHOLD", "0.82"))


@tool
def generate_arbitrary_step(
    cadquery_code: str, filename: str = "agent_part.step"
) -> str:
    """
    Executes CadQuery Python code to generate a 3D CAD model and exports it as a STEP file.

    Args:
        cadquery_code (str): Valid Python code using the 'cq' (cadquery) module to generate geometry.
                             The final generated object MUST be assigned to a variable named 'result_model'.
        filename (str): The name of the output STEP file. Defaults to 'agent_part.step'.

    Returns:
        str: A message indicating success or failure of the file generation, including tracebacks.
    """
    try:
        # Create a local scope and inject the imported cadquery module
        local_scope = {"cq": cq}

        # Execute the agent-generated code safely within this scope
        exec(cadquery_code, {"__builtins__": __builtins__}, local_scope)

        # Verify the agent followed instructions and assigned the output
        if "result_model" not in local_scope:
            return (
                "Execution Failed: Your code ran, but it did not assign the final geometry "
                "to a variable named 'result_model'. Please rewrite and assign it."
            )

        model = local_scope["result_model"]

        # Ensure the filename is just a basename (no path traversal)
        safe_name = Path(filename).name
        # Enforce a .step extension so only STEP files are created
        if not safe_name.lower().endswith((".step", ".stp")):
            safe_name += ".step"
        output_path = (DATA_DIR / safe_name).resolve()

        # Double-check the resolved path stays inside DATA_DIR
        if not output_path.is_relative_to(DATA_DIR.resolve()):
            return "Execution Failed: Invalid output filename."

        # Export the model into the data directory.
        cq.exporters.export(model, str(output_path))

        # Export a lightweight visual preview next to the STEP file so a VLM
        # can compare it against a reference image.
        preview_safe_name = f"{Path(safe_name).stem}.svg"
        preview_path = (DATA_DIR / preview_safe_name).resolve()
        preview_status = ""
        try:
            cq.exporters.export(model, str(preview_path))
            preview_status = f" Preview saved to {preview_safe_name}."
        except Exception as preview_exc:
            preview_status = (
                " Preview generation failed "
                f"({type(preview_exc).__name__}: {preview_exc})."
            )

        return (
            "Successfully generated CAD model from code "
            f"and saved to {safe_name}.{preview_status}"
        )

    except Exception as e:
        # Returning the exact error helps the agent self-correct if it wrote bad syntax
        return f"Code execution failed with error: {type(e).__name__}: {str(e)}"


# 1. Put the tool in a list
tools = [generate_arbitrary_step]


def encode_image(image_path: str) -> str:
    """Read an image file and convert it to a Base64 string."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


def build_agent():
    """Build and return the agent graph."""
    # Claude 3 Haiku supports vision out of the box.
    # For complex schematic reading, consider upgrading this to claude-3-5-sonnet-20240620
    # llm = ChatLiteLLM(model="anthropic/claude-3-haiku-20240307", temperature=0.1)
    llm = ChatLiteLLM(model=DEFAULT_AGENT_MODEL, temperature=0.1)

    return create_agent(llm, tools=tools, system_prompt="build stuff please")


def _image_path_to_message_block(image_path: str) -> dict:
    """Convert an image file path to a multimodal `image_url` message block."""
    base64_image = encode_image(image_path)
    mime_type, _ = mimetypes.guess_type(image_path)
    if not mime_type:
        mime_type = "image/jpeg"
    return {
        "type": "image_url",
        "image_url": {
            "url": f"data:{mime_type};base64,{base64_image}",
        },
    }


def _extract_json_object(text: str) -> dict | None:
    """Best-effort extraction of the first JSON object from model output."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def judge_preview_against_reference(
    reference_image_path: str,
    generated_preview_path: str,
    match_threshold: float = DEFAULT_MATCH_THRESHOLD,
) -> dict:
    """Use a VLM to compare generated preview image against reference image."""
    if not os.path.exists(generated_preview_path):
        return {
            "is_match": False,
            "score": 0.0,
            "feedback": "No generated preview image was available for comparison.",
        }

    judge_llm = ChatLiteLLM(model=DEFAULT_JUDGE_MODEL, temperature=0)
    prompt = (
        "You are evaluating whether two images depict the same CAD part. "
        "Image A is the reference. Image B is the generated result. "
        "Focus on overall silhouette, key proportions, holes/cutouts, and major features. "
        "Return ONLY valid JSON with this exact schema: "
        '{"is_match": <bool>, "score": <float 0..1>, "feedback": <string>} '
        "where `feedback` gives concise corrective guidance for CAD regeneration."
    )
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "text", "text": "Image A (reference):"},
                _image_path_to_message_block(reference_image_path),
                {"type": "text", "text": "Image B (generated preview):"},
                _image_path_to_message_block(generated_preview_path),
            ],
        }
    ]

    try:
        raw = judge_llm.invoke(messages)
        raw_text = raw.content if isinstance(raw.content, str) else str(raw.content)
    except Exception as exc:
        return {
            "is_match": False,
            "score": 0.0,
            "feedback": f"Judge model failed: {type(exc).__name__}: {exc}",
        }

    parsed = _extract_json_object(raw_text)
    if parsed is None:
        return {
            "is_match": False,
            "score": 0.0,
            "feedback": f"Judge output could not be parsed as JSON: {raw_text}",
        }

    try:
        score = float(parsed.get("score", 0.0))
    except (TypeError, ValueError):
        score = 0.0
    score = max(0.0, min(1.0, score))
    is_match = bool(parsed.get("is_match", False)) and score >= match_threshold
    feedback = str(parsed.get("feedback", "No feedback provided."))
    return {
        "is_match": is_match,
        "score": score,
        "feedback": feedback,
    }


def run_agent(question: str, image_path: str = None) -> str:
    """Run the agent on a single question (and optional image) and return the response text."""
    if image_path:
        return run_self_correcting_agent(question, image_path)["response"]
    return run_agent_with_tools(question, image_path)["response"]


def run_agent_with_tools(question: str, image_path: str = None) -> dict:
    """Run the agent and return response + tool usage info for evaluation."""
    agent = build_agent()

    # Structure the content as a list to support multimodal inputs
    message_content = [{"type": "text", "text": question}]

    # If an image path is provided, encode it and append it to the message content.
    if image_path:
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Could not find image at {image_path}")

        message_content.append(_image_path_to_message_block(image_path))

    # Pass the correctly structured content list to the agent
    result = agent.invoke({"messages": [{"role": "user", "content": message_content}]})
    messages = result["messages"]

    tools_used = []
    # Collect tool call arguments keyed by tool_call_id so we can match
    # them with the corresponding tool response messages.
    tool_call_args: dict[str, dict] = {}
    generate_call_order: dict[str, int] = {}
    generation_events: list[dict] = []

    for msg in messages:
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                tools_used.append(tc["name"])
                if tc["name"] == "generate_arbitrary_step":
                    tool_call_args[tc["id"]] = tc["args"]
                    generate_call_order[tc["id"]] = len(generate_call_order) + 1

    # Identify generation outcomes by matching tool responses with
    # the tool call arguments collected above.
    successful_generations: list[dict] = []
    for msg in messages:
        tc_id = getattr(msg, "tool_call_id", None)
        if tc_id and tc_id in tool_call_args:
            content = msg.content if isinstance(msg.content, str) else ""
            args = tool_call_args[tc_id]
            code = args.get("cadquery_code", "")
            requested_filename = args.get("filename", "agent_part.step")
            # Reconstruct the safe filename the same way the tool does.
            safe_name = Path(requested_filename).name
            if not safe_name.lower().endswith((".step", ".stp")):
                safe_name += ".step"
            preview_name = f"{Path(safe_name).stem}.svg"
            was_successful = content.startswith("Successfully generated")
            generation_events.append(
                {
                    "tool_call_id": tc_id,
                    "output_index": generate_call_order.get(tc_id, 0),
                    "requested_filename": requested_filename,
                    "cadquery_code": code,
                    "tool_message": content,
                    "success": was_successful,
                    "step_file": safe_name if was_successful else None,
                    "preview_file": preview_name if was_successful else None,
                }
            )
            if was_successful:
                successful_generations.append(
                    {
                        "step_file": safe_name,
                        "preview_file": preview_name,
                        "code": code,
                    }
                )

    response_text = (
        messages[-1].content
        if isinstance(messages[-1].content, str)
        else str(messages[-1].content)
    )

    # Persist a metadata record for every shape that was successfully
    # generated during this agent run.
    for gen in successful_generations:
        metadata_store.add_record(
            step_file=gen["step_file"],
            description=response_text,
            code=gen["code"],
        )

    return {
        "response": response_text,
        "tools_used": tools_used,
        "successful_generations": successful_generations,
        "generation_events": generation_events,
    }


def run_self_correcting_agent(
    question: str,
    image_path: str,
    max_attempts: int = DEFAULT_MAX_SELF_CORRECT_ATTEMPTS,
    match_threshold: float = DEFAULT_MATCH_THRESHOLD,
) -> dict:
    """Iteratively generate, render, and judge until reference match or limit."""
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Could not find image at {image_path}")

    capped_attempts = max(1, max_attempts)
    prior_feedback = ""
    attempt_logs: list[dict] = []
    final_agent_result: dict | None = None

    for attempt in range(1, capped_attempts + 1):
        attempt_filename = f"agent_part_attempt_{attempt}.step"
        iteration_prompt = (
            f"{question}\n\n"
            f"This is self-correction attempt {attempt}/{capped_attempts}. "
            "You must call generate_arbitrary_step with filename "
            f"'{attempt_filename}'."
        )
        if prior_feedback:
            iteration_prompt += (
                "\nUse this visual mismatch feedback to revise geometry precisely: "
                f"{prior_feedback}"
            )

        agent_result = run_agent_with_tools(iteration_prompt, image_path)
        final_agent_result = agent_result

        gens = agent_result.get("successful_generations", [])
        if not gens:
            prior_feedback = (
                "No STEP file was generated. You must produce a valid CadQuery model "
                "and assign it to result_model."
            )
            attempt_logs.append(
                {
                    "attempt": attempt,
                    "score": 0.0,
                    "is_match": False,
                    "feedback": prior_feedback,
                    "query": iteration_prompt,
                    "generation_events": agent_result.get("generation_events", []),
                }
            )
            continue

        latest = gens[-1]
        preview_path = str((DATA_DIR / latest["preview_file"]).resolve())
        judge = judge_preview_against_reference(
            reference_image_path=image_path,
            generated_preview_path=preview_path,
            match_threshold=match_threshold,
        )
        attempt_logs.append(
            {
                "attempt": attempt,
                "step_file": latest["step_file"],
                "preview_file": latest["preview_file"],
                "score": judge["score"],
                "is_match": judge["is_match"],
                "feedback": judge["feedback"],
                "query": iteration_prompt,
                "generation_events": agent_result.get("generation_events", []),
            }
        )

        if judge["is_match"]:
            return {
                "response": (
                    f"Matched reference on attempt {attempt}/{capped_attempts} "
                    f"(score={judge['score']:.2f}). "
                    f"Final STEP: {latest['step_file']}."
                ),
                "tools_used": agent_result.get("tools_used", []),
                "attempts": attempt_logs,
                "successful_generations": agent_result.get(
                    "successful_generations", []
                ),
            }

        prior_feedback = judge["feedback"]

    # Fall back to best effort result from last attempt.
    final_text = (
        f"Could not reach visual match after {capped_attempts} attempts. "
        "Returned best effort from final iteration."
    )
    if final_agent_result:
        final_text += f" Agent response: {final_agent_result.get('response', '')}"
    return {
        "response": final_text,
        "tools_used": final_agent_result.get("tools_used", [])
        if final_agent_result
        else [],
        "attempts": attempt_logs,
        "successful_generations": final_agent_result.get("successful_generations", [])
        if final_agent_result
        else [],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the CAD generation agent.")
    parser.add_argument("question", nargs="+", help="The instruction for the agent")
    parser.add_argument(
        "-i",
        "--image",
        type=str,
        help="Path to an optional image file to analyze",
        default=None,
    )

    args = parser.parse_args()
    question_text = " ".join(args.question)

    print(run_agent(question_text, args.image))
