import sys

__import__("pysqlite3")
sys.modules["sqlite3"] = sys.modules.pop("pysqlite3")

from studio.consts import AGENT_STUDIO_OPS_APPLICATION_NAME
from studio.cross_cutting.utils import get_appliction_by_name
from cmlapi import Application
from openinference.instrumentation.litellm import LiteLLMInstrumentor
from phoenix.otel import register
import cmlapi
import os
from gql import Client
from gql.transport.requests import RequestsHTTPTransport
from phoenix.otel import register

# Monkey-patch the _wrappers module
import openinference.instrumentation.crewai as crewaiinst
import studio.workflow.ops_wrappers as ops_wrappers

crewaiinst._ToolUseWrapper = ops_wrappers._ToolUseWrapper
crewaiinst._ExecuteCoreWrapper = ops_wrappers._ExecuteCoreWrapper
crewaiinst._KickoffWrapper = ops_wrappers._KickoffWrapper


def get_ops_provider() -> str:
    return os.getenv("AGENT_STUDIO_OPS_PROVIDER", "phoenix")


def get_ops_endpoint() -> str:
    """
    Get the current operational endpoint of the
    Agent observability server. This can be overridden
    by an endpoint specified in an environment variable. If this
    env variable does not exist, extract the endpoint information
    from the running ops application directly. This env var override
    option is to make sure CML models can also reach the ops endpoint.
    """
    if os.getenv("AGENT_STUDIO_OPS_ENDPOINT"):
        return os.getenv("AGENT_STUDIO_OPS_ENDPOINT")

    cml = cmlapi.default_client()
    application: Application = get_appliction_by_name(cml, AGENT_STUDIO_OPS_APPLICATION_NAME)
    return f"https://{application.subdomain}.{os.getenv('CDSW_DOMAIN')}"


def get_ops_iframe_url() -> str:
    """
    Get the iframe URL to be used for the observability platform.
    Based on whether this is a local or a production build, we need
    to handle CORS by matching the domain. For local development (running
    via localhost), we can use a proxy server to forward traffic to the
    non-SSL UI. For production, we must use the prod endpoint.
    """
    if os.getenv("AGENT_STUDIO_DEPLOYMENT_CONFIG") == "dev":
        return "http://127.0.0.1:8123"
    else:
        return get_ops_endpoint()


def get_phoenix_ops_tracer_provider(workflow_name: str):
    """
    Register a tracing provider to route to the phoenix
    observability endpoint. This will ensure the crew and the
    corresponding agents/tasks will report to phoenix.

    https://docs.arize.com/phoenix/tracing/integrations-tracing/crewai
    """

    ops_addr = get_ops_endpoint()

    tracer_provider = register(
        project_name=workflow_name,
        endpoint=f"{ops_addr}/v1/traces",
        headers={"Authorization": f"Bearer {os.getenv('CDSW_APIV2_KEY')}"},
    )
    return tracer_provider


def get_phoenix_ops_graphql_client() -> Client:
    """
    Returns a client to the phoenix graphql server. Users can make generic
    requests about the current projects/workflows and resources stored in phoenix.

    https://docs.arize.com/arize/resources/graphql-api
    """

    ops_addr = get_ops_endpoint()

    # Set up the GraphQL client
    transport = RequestsHTTPTransport(
        url=f"{ops_addr}/graphql",  # Replace with your GraphQL endpoint
        # Add authentication headers if required
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.getenv('CDSW_APIV2_KEY')}"},
    )
    client = Client(transport=transport, fetch_schema_from_transport=False)
    return client


def instrument_workflow(workflow_name: str):
    """
    Instrument agents, crews and tasks within a given model to report
    to the observability platform.
    """
    tracer_provider = get_phoenix_ops_tracer_provider(workflow_name)
    crewaiinst.CrewAIInstrumentor().instrument(tracer_provider=tracer_provider)
    LiteLLMInstrumentor().instrument(tracer_provider=tracer_provider)
    return tracer_provider


def reset_instrumentation():
    # Add logic to un-instrument or reset the instrumentors
    crewaiinst.CrewAIInstrumentor().uninstrument()  # Check if this method exists
    LiteLLMInstrumentor().uninstrument()  # Check if this method exists
