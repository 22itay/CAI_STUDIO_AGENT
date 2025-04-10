from typing import Optional, Type
from textwrap import dedent
from pydantic import BaseModel, Field
from pydantic import BaseModel as StudioBaseTool
import os
import json
import argparse

class UserParameters(BaseModel):
    pass
    
class ToolParameters(BaseModel):
    directory: Optional[str] = Field(None, description="The directory path for file listing.")

def run_tool(
    config: UserParameters,
    args: ToolParameters,
):
    # Use function argument if provided, else fallback to user parameter
    directory = args.directory

    if not directory:
        return "Error: No directory provided."

    # Remove trailing slash if present
    directory = directory.rstrip("/")

    # List all files in the directory recursively
    files_list = [
        f"{directory}/{os.path.join(root, filename).replace(directory, '').lstrip(os.path.sep)}"
        for root, _, files in os.walk(directory)
        for filename in files
    ]
    
    if not files_list:
        return f"No files found in the specified directory: {directory}"

    # Prepare the file list as a formatted string
    files = "\n- ".join(files_list)
    return f"File paths in {directory}:\n- {files}"


OUTPUT_KEY="tool_output"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-params", required=True, help="JSON string for tool configuration")
    parser.add_argument("--tool-params", required=True, help="JSON string for tool arguments")
    args = parser.parse_args()
    
    # Parse JSON into dictionaries
    config_dict = json.loads(args.user_params)
    params_dict = json.loads(args.tool_params)
    
    # Validate dictionaries against Pydantic models
    config = UserParameters(**config_dict)
    params = ToolParameters(**params_dict)

    output = run_tool(
        config,
        params
    )
    print(OUTPUT_KEY, output)