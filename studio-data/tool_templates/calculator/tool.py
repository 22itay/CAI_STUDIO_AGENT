from pydantic import BaseModel, Field
from typing import Literal
import json 
import argparse

from calc import run_calc


class UserParameters(BaseModel):
    pass 


class ToolParameters(BaseModel):
    a: float = Field(description="first number")
    b: float = Field(description="second number")
    op: Literal["+", "-", "*", "/"] = Field(description="operator")


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

    output = {"result": run_calc(params.a, params.b, params.op)}
    print(OUTPUT_KEY, output)



