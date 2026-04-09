import os
import sys
import base64
import mimetypes
import argparse
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


@tool
def generate_arbitrary_step(cadquery_code: str, filename: str = "agent_part.step") -> str:
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

        # Export the model into the data directory
        cq.exporters.export(model, str(output_path))
        
        return f"Successfully generated CAD model from code and saved to {safe_name}."
        
    except Exception as e:
        # Returning the exact error helps the agent self-correct if it wrote bad syntax
        return f"Code execution failed with error: {type(e).__name__}: {str(e)}"

# 1. Put the tool in a list
tools = [generate_arbitrary_step]


def encode_image(image_path: str) -> str:
    """Read an image file and convert it to a Base64 string."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')


def build_agent():
    """Build and return the agent graph."""
    # Claude 3 Haiku supports vision out of the box. 
    # For complex schematic reading, consider upgrading this to claude-3-5-sonnet-20240620
    # llm = ChatLiteLLM(model="anthropic/claude-3-haiku-20240307", temperature=0.1)
    llm = ChatLiteLLM(model="anthropic/claude-sonnet-4-5-20250929", temperature=0.1)

    return create_agent(llm, tools=tools, system_prompt="build stuff please")


def run_agent(question: str, image_path: str = None) -> str:
    """Run the agent on a single question (and optional image) and return the response text."""
    return run_agent_with_tools(question, image_path)["response"]


def run_agent_with_tools(question: str, image_path: str = None) -> dict:
    """Run the agent and return response + tool usage info for evaluation."""
    agent = build_agent()
    
    # Structure the content as a list to support multimodal inputs
    message_content = [{"type": "text", "text": question}]
    
    # If an image path is provided, encode it and append it to the message content
    if image_path:
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Could not find image at {image_path}")
            
        base64_image = encode_image(image_path)
        mime_type, _ = mimetypes.guess_type(image_path)
        
        # Fallback to jpeg if the mime type can't be guessed
        if not mime_type:
            mime_type = "image/jpeg"
            
        message_content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime_type};base64,{base64_image}"
            }
        })

    # Pass the correctly structured content list to the agent
    result = agent.invoke({"messages": [{"role": "user", "content": message_content}]})
    messages = result["messages"]

    tools_used = []
    # Collect tool call arguments keyed by tool_call_id so we can match
    # them with the corresponding tool response messages.
    tool_call_args: dict[str, dict] = {}

    for msg in messages:
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                tools_used.append(tc["name"])
                if tc["name"] == "generate_arbitrary_step":
                    tool_call_args[tc["id"]] = tc["args"]

    # Identify successful STEP generations by matching tool responses
    # with the tool call arguments collected above.
    successful_generations: list[dict] = []
    for msg in messages:
        tc_id = getattr(msg, "tool_call_id", None)
        if tc_id and tc_id in tool_call_args:
            content = msg.content if isinstance(msg.content, str) else ""
            if content.startswith("Successfully generated"):
                args = tool_call_args[tc_id]
                code = args.get("cadquery_code", "")
                filename = args.get("filename", "agent_part.step")
                # Reconstruct the safe filename the same way the tool does.
                safe_name = Path(filename).name
                if not safe_name.lower().endswith((".step", ".stp")):
                    safe_name += ".step"
                successful_generations.append({
                    "step_file": safe_name,
                    "code": code,
                })

    response_text = messages[-1].content

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
    }

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the CAD generation agent.")
    parser.add_argument("question", nargs="+", help="The instruction for the agent")
    parser.add_argument("-i", "--image", type=str, help="Path to an optional image file to analyze", default=None)
    
    args = parser.parse_args()
    question_text = " ".join(args.question)
    
    print(run_agent(question_text, args.image))