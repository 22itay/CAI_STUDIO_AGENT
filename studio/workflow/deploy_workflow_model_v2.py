import os
import sys
import subprocess

# Extract workflow parameters from the environment
WORKFLOW_CONFIG = os.getenv("AGENT_STUDIO_WORKFLOW_CONFIG")
WORKFLOW_NAME = os.getenv("AGENT_STUDIO_WORKFLOW_NAME")
CDSW_DOMAIN = os.getenv("CDSW_DOMAIN")

# Install the cmlapi. This is a required dependency for cross-cutting util modules
# and ops modules that are used in a workflow.
subprocess.call(["pip", "install", f"https://{CDSW_DOMAIN}/api/v2/python.tar.gz"])

# Manual patch required for CrewAI compatability
__import__("pysqlite3")
sys.modules["sqlite3"] = sys.modules.pop("pysqlite3")

# Rest of the imports

import asyncio
from opentelemetry.context import get_current
from studio import consts
from studio.ops import instrument_workflow
import studio.cross_cutting.input_types as input_types
import studio.workflow.utils as wf_utils
import cml.models_v1 as cml_models
from datetime import datetime
from typing import Dict, Optional, Union
from pydantic import ValidationError
import json
import base64


# Instrument our workflow given a specific workflow name and
# set up the instrumentation.
tracer_provider = instrument_workflow(f"{WORKFLOW_NAME}")
tracer = tracer_provider.get_tracer("opentelemetry.agentstudio.workflow.model")


def _install_python_requirements(collated_input: input_types.CollatedInput):
    requirement_files = set()
    for tool_instance in collated_input.tool_instances:
        requirement_files.add(
            os.path.join(tool_instance.source_folder_path, tool_instance.python_requirements_file_name)
        )
    for requirement_file in requirement_files:
        subprocess.call(["pip", "install", "-r", requirement_file])


collated_input_dict = json.load(open(WORKFLOW_CONFIG, "r"))
collated_input = input_types.CollatedInput.model_validate(collated_input_dict)
_install_python_requirements(collated_input)


def base64_decode(encoded_str: str):
    decoded_bytes = base64.b64decode(encoded_str)
    return json.loads(decoded_bytes.decode("utf-8"))


@cml_models.cml_model
def api_wrapper(args: Union[dict, str]) -> str:
    dict_args = args
    if not isinstance(args, dict):
        dict_args = json.loads(args)
    serve_workflow_parameters = input_types.ServeWorkflowParameters.model_validate(dict_args)
    if serve_workflow_parameters.action_type == input_types.DeployedWorkflowActions.KICKOFF.value:
        inputs = (
            base64_decode(serve_workflow_parameters.kickoff_inputs) if serve_workflow_parameters.kickoff_inputs else {}
        )
        collated_input_copy = collated_input.model_copy(deep=True)

        tool_user_params: Dict[str, Dict[str, str]] = {}
        for tool_instance in collated_input_copy.tool_instances:
            t_id = tool_instance.id
            prefix = f"TOOL_{t_id.replace('-', '_')}_USER_PARAMS_"
            user_param_kv = {}
            for key, value in os.environ.items():
                if key.startswith(prefix):
                    param_name = key[len(prefix) :]
                    user_param_kv[param_name] = value
            tool_user_params[t_id] = user_param_kv

        # Retrieve the language model config from the environment variables and validate it, and put it back in the collated input.
        for lm in collated_input_copy.language_models:
            env_var_key_name = f"MODEL_{lm.model_id.replace('-', '_')}_CONFIG"
            lm_config: Optional[input_types.Input__LanguageModelConfig] = None
            try:
                lm_config_str = os.getenv(env_var_key_name)
                if lm_config_str:
                    lm_config = input_types.Input__LanguageModelConfig.model_validate(json.loads(lm_config_str))
            except (ValidationError, json.JSONDecodeError) as e:
                raise ValueError(f"Error validating language model config for {lm.model_name}: {e}")
            lm.config = lm_config

        current_time = datetime.now()
        formatted_time = current_time.strftime("%b %d, %H:%M:%S.%f")[:-3]
        span_name = f"Workflow Run: {formatted_time}"
        with tracer.start_as_current_span(span_name) as parent_span:
            decimal_trace_id = parent_span.get_span_context().trace_id
            trace_id = hex(decimal_trace_id)[2:]

            # End the parent span early
            parent_span.add_event("Parent span ending early for visibility")
            parent_span.end()

            # Capture the current OpenTelemetry context
            parent_context = get_current()

            # Start the workflow in the background using the parent context
            asyncio.create_task(
                wf_utils.run_workflow_task(collated_input_copy, tool_user_params, inputs, parent_context)
            )

        return {"trace_id": str(trace_id)}
    elif serve_workflow_parameters.action_type == input_types.DeployedWorkflowActions.GET_CONFIGURATION.value:
        return {"configuration": collated_input.model_dump()}
    elif serve_workflow_parameters.action_type == input_types.DeployedWorkflowActions.GET_ASSET_DATA.value:
        unavailable_assets = list()
        asset_data: Dict[str, str] = dict()
        for asset_uri in serve_workflow_parameters.get_asset_data_inputs:
            # Ensure that the asset requested belongs to one of the tool instances
            tool_instance = next(
                (tool for tool in collated_input.tool_instances if tool.tool_image_uri == asset_uri), None
            )
            if not tool_instance:
                unavailable_assets.append(asset_uri)
                continue
            # Ensure that the asset exists
            asset_path = os.path.join(consts.DYNAMIC_ASSETS_LOCATION, asset_uri)
            if not os.path.exists(asset_path):
                unavailable_assets.append(asset_uri)
                continue
            with open(asset_path, "rb") as asset_file:
                asset_data[asset_uri] = base64.b64encode(asset_file.read()).decode()
                # Decode at the destination with: base64.b64decode(asset_data[asset_uri])
        return {"asset_data": asset_data, "unavailable_assets": unavailable_assets}
    else:
        raise ValueError("Invalid action type.")
