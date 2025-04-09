from pydantic import BaseModel, Field
from typing import Optional
import json 
import argparse


class UserParameters(BaseModel):
    """
    Parameters used to configure the model and not needed for tool calling.
    Examples are API keys, database passwords, etc.
    """
    user_key_1: str
    user_key_2: Optional[str] = None 
    pass 


class ToolParameters(BaseModel):
    """
    Arguments to a tool. These arguments must be passed whenever
    an agent calls a tool. These are different per tool call (i.e. a query).
    """
    param1: str = Field(description="First parameter that should be passed to the tool")
    param2: str = Field(description="Second parameter to be passed to the tool")
    param3: int = Field(description="This is a required integer field")



# Optional: If the output key is detected
# in the tools output stream, only data after the 
# output key will be written to the tool output.
OUTPUT_KEY = "tool_output"



def run_tool(config: UserParameters, params: ToolParameters):
    """
    Main tool code logic. This can run any logic for the tool that you need and can also
    import code from other files in the tool directory.
    
    The agent will capture anything that's written to the tool's stdout, OR anything 
    after the <OUTPUT_KEY> is detected in the output stream.
    """
    
    # NOTE: because we OUTPUT_KEY, these print lines will not be
    # reported out to the tool output.
    print("config: ", config)
    print("params: ", params)
    
    # If we only want to dump data after a specific output
    # key, we can do that as well. This helps ensure structured
    # data is output from the tool.
    structured_tool_output = {
        "user_key1": config.user_key_1,
        "combined_params": params.param1 + params.param2,
        "twice_param3": params.param3 * 2
    }
    return structured_tool_output



if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-params", required=True, help="JSON string for tool configuration")
    parser.add_argument("--tool-params", required=True, help="JSON string for tool arguments")
    args = parser.parse_args()
    
    # Parse JSON into dictionaries
    user_dict = json.loads(args.user_params)
    tool_dict = json.loads(args.tool_params)
    
    # Validate dictionaries against Pydantic models
    config = UserParameters(**user_dict)
    params = ToolParameters(**tool_dict)
    
    # Implement your tool logic
    output = run_tool(config, params)
    print(OUTPUT_KEY, output)