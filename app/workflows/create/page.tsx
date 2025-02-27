'use client';

// app/contact/page.tsx
import React, { Suspense, useEffect, useState } from 'react';
import { Layout, Spin } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import WorkflowEditorAgentView from '@/app/components/WorkflowEditorAgentView';
import { Typography } from 'antd/lib';
import { useAppSelector, useAppDispatch } from '@/app/lib/hooks/hooks';
import {
  updatedEditorWorkflowFromExisting,
  selectEditorCurrentStep,
  selectEditorWorkflowId,
  selectEditorWorkflowName,
  updatedWorkflowConfiguration,
} from '../editorSlice';
import WorkflowApp from '@/app/components/workflow/WorkflowApp';
import WorkflowStepView from '@/app/components/WorkflowStepView';
import WorkflowNavigation from '@/app/components/WorkflowNavigation';
import { Workflow } from '@/studio/proto/agent_studio';
import {
  useGetWorkflowByIdQuery,
  useGetWorkflowMutation,
  useUpdateWorkflowMutation,
} from '../workflowsApi';
import WorkflowEditorTaskView from '@/app/components/WorkflowEditorTaskView';
import WorkflowOverview from '@/app/components/WorkflowOverview';
import CommonBreadCrumb from '@/app/components/CommonBreadCrumb';
import WorkflowEditorConfigureView from '@/app/components/WorkflowEditorConfigureView';
import NoDefaultModelModal from '@/app/components/NoDefaultModelModal';
import { useListToolInstancesQuery } from '@/app/tools/toolInstancesApi';
import { useListTasksQuery } from '@/app/tasks/tasksApi';
import { useListAgentsQuery } from '@/app/agents/agentApi';
import { clearedWorkflowApp } from '../workflowAppSlice';
import { readWorkflowConfigurationFromLocalStorage } from '@/app/lib/localStorage';

const { Title } = Typography;

const CreateWorkflowContent: React.FC = () => {
  // If we are editing an existing workflow, let's check. This is the
  // ONLY TIME that we should use our search param. After this, the workflowId
  // will be stored in Redux and that Redux workflowId should be used.
  //
  // TODO: add consistency to how we route in pages. Most of Agent Studio routes
  // with slug paths, not search params. We should consider migrating to path routing here as well.
  const searchParams = useSearchParams();
  const workflowId = useAppSelector(selectEditorWorkflowId);
  const workflowName = useAppSelector(selectEditorWorkflowName);
  const currentStep = useAppSelector(selectEditorCurrentStep);
  const dispatch = useAppDispatch();
  const [getWorkflow] = useGetWorkflowMutation();
  const router = useRouter();
  const { data: workflow, refetch: refetchWorkflow } = useGetWorkflowByIdQuery(workflowId);
  const { data: toolInstances } = useListToolInstancesQuery({});
  const { data: tasks } = useListTasksQuery({});
  const { data: agents } = useListAgentsQuery({});

  // Clear the existing workflow app upon first load. Note: the "Workflow App"
  // in the context of the workflow editor is just the Test page (for now, until
  // we get customizable frontend apps to be an option)
  useEffect(() => {
    dispatch(clearedWorkflowApp());
  }, []);

  // We are routed here via search params. If that's the case, populate the
  // initial workflow editor with all of the information that we need.
  useEffect(() => {
    // Initially populate the redux editor state with this workflow. Also
    // preset all workflow configurations, which are stored in local storage.
    const populateWorkflow = async (workflowId: string) => {
      // Update aspects about our workflow to redux.
      const workflow: Workflow = await getWorkflow({ workflow_id: workflowId }).unwrap();
      dispatch(updatedEditorWorkflowFromExisting(workflow));

      // Load workflow configuration from local storage.
      const workflowConfiguration = readWorkflowConfigurationFromLocalStorage(workflowId);

      // Initialize redux state with this configuration.
      dispatch(updatedWorkflowConfiguration(workflowConfiguration));
    };

    const searchWorkflowId = searchParams.get('workflowId');
    if (searchWorkflowId && Boolean(searchWorkflowId?.trim())) {
      populateWorkflow(searchWorkflowId);
    }
  }, [searchParams.get('workflowId')]);

  if (!workflowId) {
    // TODO: gracefully handle not selecting a workflow
    return (
      <div
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}
      >
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout
      style={{
        flex: 1,
        padding: '16px 24px 22px',
        flexDirection: 'column',
      }}
    >
      <CommonBreadCrumb
        items={[
          { title: 'Agentic Workflows', href: '/workflows' },
          { title: workflowId ? 'Edit Workflow' : 'Create Workflow' },
        ]}
      />
      <NoDefaultModelModal />
      <Title level={5} style={{ paddingTop: 4, fontSize: '18px', fontWeight: 600 }}>
        {workflowId ? 'Workflow: ' + workflowName : 'Create Workflow'}
      </Title>
      <Layout
        style={{
          flex: 1,
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <WorkflowStepView />
        {currentStep === 'Agents' ? (
          <WorkflowEditorAgentView />
        ) : currentStep === 'Tasks' ? (
          <WorkflowEditorTaskView />
        ) : currentStep === 'Configure' ? (
          <WorkflowEditorConfigureView />
        ) : currentStep === 'Test' ? (
          <WorkflowApp
            workflow={workflow}
            refetchWorkflow={refetchWorkflow}
            toolInstances={toolInstances}
            agents={agents}
            tasks={tasks}
          />
        ) : (
          <WorkflowOverview workflowId={workflowId!} />
        )}
        <WorkflowNavigation />
      </Layout>
    </Layout>
  );
};

const CreateWorkflowPage: React.FC = () => {
  return (
    <Suspense
      fallback={
        <Layout style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Spin size="large" />
        </Layout>
      }
    >
      {/* Suspense now wraps the component that uses useSearchParams */}
      <CreateWorkflowContent />
    </Suspense>
  );
};

export default CreateWorkflowPage;
