# No top level studio.db imports allowed to support wokrflow model deployment

from typing import List, Dict
import sys
import os
import requests
from opentelemetry.context import attach, detach, Context
from crewai import Task, Crew, LLM as CrewAILLM, Agent
from crewai.tools import BaseTool

from studio.tools.utils import get_tool_instance_proxy
from studio.cross_cutting import utils as cc_utils
from studio import consts

# Import engine code manually. Eventually when this code becomes
# a separate git repo, or a custom runtime image, this path call
# will go away and workflow engine features will be available already.
import sys

sys.path.append("studio/workflow_engine/src/")

from engine.crewai.agents import get_crewai_agent
from engine.crewai.llms import get_crewai_llm_object_direct
import engine.types as input_types


#  Compare two different versions of Cloudera AI Workbench. Workbench
#  gitShas follow semantic versioning, and this verion checker
#  only checks out to the patch version (i.e., '2.0.47' and '2.0.47-b450'
#  will evalute to being equal).
#
#  if verion a is greater than version b, returns 1.
#  if version a is less than b, returns 0.
#  returns 0 if both versions evaluate to the same patch version.
def compare_workbench_versions(a: str, b: str) -> int:
    # Split on the dash and take the first part
    sanitized_a = a.split("-")[0]
    sanitized_b = b.split("-")[0]

    # Extract numeric parts
    a_major, a_minor, a_patch = map(int, sanitized_a.split("."))
    b_major, b_minor, b_patch = map(int, sanitized_b.split("."))

    # Compare major
    if a_major > b_major:
        return 1
    if a_major < b_major:
        return -1

    # Compare minor
    if a_minor > b_minor:
        return 1
    if a_minor < b_minor:
        return -1

    # Compare patch
    if a_patch > b_patch:
        return 1
    if a_patch < b_patch:
        return -1

    # Versions are the same
    return 0


def is_custom_model_root_dir_feature_enabled() -> bool:
    """
    Currently custom model root dirs for Workbench models are hidden behind
    the ML_ENABLE_COMPOSABLE_AMPS entitlement, which can be checked with
    unauthenticated access at our /sense-bootstrap.json endpoint.
    """

    # Grab the bootstrap data
    bootstrap_data: dict = requests.get(f"https://{os.getenv('CDSW_DOMAIN')}/sense-bootstrap.json").json()

    # Return the result of the entitlement we are looking for
    # and default this to false (for older workbenches). "enable_ai_studios"
    # is translated upstream from ML_ENABLE_COMPOSABLE_AMPS, which is the
    # entitlement that blocks the model root dir feature.
    composable_amp_entitlement_enabled = bootstrap_data.get("enable_ai_studios", False)
    workbench_gteq_2_0_47 = compare_workbench_versions(bootstrap_data.get("gitSha", "0.0.0"), "2.0.47") >= 0

    return composable_amp_entitlement_enabled and workbench_gteq_2_0_47


def get_fresh_workflow_directory(workflow_name: str) -> str:
    return f"{consts.WORKFLOWS_LOCATION}/{cc_utils.create_slug_from_name(workflow_name)}_{cc_utils.get_random_compact_string()}"


def create_crewai_objects_for_test(
    collated_input: input_types.CollatedInput,
    tool_user_params: Dict[str, Dict[str, str]],
    tracer=None,
) -> input_types.CrewAIObjects:
    """
    Create our crewai Crew and other related objects for "testing" a workflow from within Agent Studio.

    This method takes collated input and converts this input into CrewAI objects. note that in our workflow
    engine, there is a similar method for creating Crew objects - however when testing, we use tool *proxies*,
    and during workflow execution, we use direct tool module imports in our crews. Once this is centralized,
    this test object creation can be fully replaced with workflow engine code.
    """

    language_models: Dict[str, CrewAILLM] = {}
    for language_model in collated_input.language_models:
        language_models[language_model.model_id] = get_crewai_llm_object_direct(language_model)

    tools: Dict[str, BaseTool] = {}
    for t_ in collated_input.tool_instances:
        tools[t_.id] = get_tool_instance_proxy(t_, tool_user_params.get(t_.id, {}))

    agents: Dict[str, Agent] = {}
    for agent in collated_input.agents:
        crewai_tools = [tools[tool_id] for tool_id in agent.tool_instance_ids]
        model_id = agent.llm_provider_model_id
        if not model_id:
            model_id = collated_input.default_language_model_id
        agents[agent.id] = get_crewai_agent(agent, crewai_tools, language_models[model_id], tracer)

    tasks: Dict[str, Task] = {}
    for task_input in collated_input.tasks:
        agent_for_task: Agent = agents[task_input.assigned_agent_id] if task_input.assigned_agent_id else None
        tasks[task_input.id] = Task(
            description=task_input.description,
            expected_output=task_input.expected_output,
            agent=agent_for_task,
            tools=agent_for_task.tools if agent_for_task else None,
        )

    workflow_input = collated_input.workflow
    crew = Crew(
        name=workflow_input.name,
        process=workflow_input.crew_ai_process,
        agents=[agents[agent_id] for agent_id in workflow_input.agent_ids],
        tasks=[tasks[task_id] for task_id in workflow_input.task_ids],
        manager_agent=agents[workflow_input.manager_agent_id] if workflow_input.manager_agent_id else None,
        manager_llm=language_models[workflow_input.llm_provider_model_id]
        if workflow_input.llm_provider_model_id
        else None,
        verbose=True,
    )

    return input_types.CrewAIObjects(
        language_models=language_models,
        tools=tools,
        agents=agents,
        tasks=tasks,
        crews={workflow_input.id: crew},
    )


def invalidate_workflow(preexisting_db_session, condition) -> None:
    """
    Move dependent workflows to draft mode and mark any dependent deployed workflows as stale.
    """
    from studio.db import model as db_model, DbSession

    session: DbSession = preexisting_db_session

    dependent_workflows = session.query(db_model.Workflow).filter(condition).all()
    for workflow in dependent_workflows:
        workflow.is_draft = True
        deployed_workflows: List[db_model.DeployedWorkflowInstance] = (
            session.query(db_model.DeployedWorkflowInstance).filter_by(workflow_id=workflow.id).all()
        )
        for deployed_workflow in deployed_workflows:
            deployed_workflow.is_stale = True
    return


def run_workflow_with_context(crew: Crew, inputs, parent_context: Context):
    """Run workflow with the parent OpenTelemetry context"""
    # Attach the parent context
    token = attach(parent_context)
    try:
        print(f"Running workflow {crew.name} with context")
        return crew.kickoff(inputs=inputs)
    finally:
        # Detach the context
        detach(token)
