import React, { useEffect, useState } from 'react';
import {
  Modal,
  Button,
  List,
  Layout,
  Typography,
  Form,
  Input,
  Divider,
  Space,
  Tooltip,
  Image,
  Avatar,
  Alert,
  Popconfirm,
  FormInstance,
  Select,
  Result,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  QuestionCircleOutlined,
  UserOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  UndoOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import {
  useListGlobalAgentTemplatesQuery,
  useAddAgentMutation,
  useUpdateAgentMutation,
  useListAgentsQuery,
} from '../../agents/agentApi';
import { useAppDispatch, useAppSelector } from '../../lib/hooks/hooks';
import {
  updatedEditorAgentViewOpen,
  selectEditorAgentViewIsOpen,
  selectEditorAgentViewStep,
  selectEditorAgentViewAgent,
  selectEditorWorkflowId,
  selectEditorAgentViewCreateAgentTools,
  selectEditorAgentViewCreateAgentState,
  updatedEditorAgentViewCreateAgentToolTemplates,
  selectEditorAgentViewCreateAgentToolTemplates,
  updatedEditorAgentViewCreateAgentState,
  updatedEditorWorkflowId,
  selectEditorWorkflow,
  updatedEditorWorkflowAgentIds,
  updatedEditorAgentViewAgent,
} from '../../workflows/editorSlice';
import { AgentTemplateMetadata, Model, ToolInstance } from '@/studio/proto/agent_studio';
import { useListGlobalToolTemplatesQuery } from '@/app/tools/toolTemplatesApi';
import { useImageAssetsData } from '@/app/lib/hooks/useAssetData';
import WorkflowAddToolModal from './WorkflowAddToolModal';
import { useSelector } from 'react-redux';
import { useAddWorkflowMutation, useUpdateWorkflowMutation } from '../../workflows/workflowsApi';
import { createAddRequestFromEditor, createUpdateRequestFromEditor } from '../../lib/workflow';
import { useGlobalNotification } from '../Notifications';
import { AgentMetadata } from '@/studio/proto/agent_studio';
import {
  useListToolInstancesQuery,
  useRemoveToolInstanceMutation,
} from '@/app/tools/toolInstancesApi';
import { CrewAIAgentMetadata } from '@/studio/proto/agent_studio';
import { useGetDefaultModelQuery, useGetModelMutation, useListModelsQuery } from '../../models/modelsApi';
import { useTestModelMutation } from '../../models/modelsApi';

const { Text } = Typography;
const { TextArea } = Input;

interface GenerateAgentPropertiesModalProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  onCancel: () => void;
  form: FormInstance<{
    name: string;
    role: string;
    backstory: string;
    goal: string;
    llm_provider_model_id: string;
  }>;
  llmModel: Model;
  toolInstances: Record<string, ToolInstance>;
}

const GenerateAgentPropertiesModal: React.FC<GenerateAgentPropertiesModalProps> = ({
  open,
  setOpen,
  onCancel,
  form,
  llmModel,
  toolInstances,
}) => {
  const [userDescription, setUserDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [hideInfoBox, setHideInfoBox] = useState(false);
  const [parsedSuggestions, setParsedSuggestions] = useState<{
    role?: string;
    goal?: string;
    backstory?: string;
    error?: string;
  }>({});
  const selectedAgent = useAppSelector(selectEditorAgentViewAgent);
  const createAgentState = useSelector(selectEditorAgentViewCreateAgentState);

  const [testModel] = useTestModelMutation();

  const relevantToolInstances = Object.values(toolInstances).filter((toolInstance) => {
    if (selectedAgent) {
      return selectedAgent?.tools_id?.includes(toolInstance.id);
    } else {
      return createAgentState?.tools?.includes(toolInstance.id);
    }
  });

  useEffect(() => {
    if (!open) {
      setUserDescription('');
      setParsedSuggestions({});
      setIsGenerating(false);
      setHideInfoBox(false);
    } // reset on close
  }, [open]);

  const generatePrompt = (description: string, tools: ToolInstance[]) => {
    const toolsDescription = tools
      .map((tool) => ` - ${tool.name}: ${tool.tool_description.replace(/\n/g, ' ')}`)
      .join('\n');

    return `Given a user's description of an AI agent and the tools available to it, generate appropriate role, goal, and backstory for the agent. Tools are used by agents to perform computation or connect to external systems, which might be difficult to do using just a traditional LLM.

User's Description: ${description.replace(/\n/g, ' ')}

Available Tools:
${toolsDescription}


Please generate the agent properties in the following XML format:
<agent>
  <role>Defines the agent's function and expertise. It should be very concise, akin to a job title.</role>
  <goal>The individual objective that guides the agent's decision-making.</goal>
  <backstory>A brief background that explains the agent's expertise. Provides context and personality to the agent, enriching interactions.</backstory>
</agent>

Keep the responses concise but meaningful. The role should be professional, the goal should be task driven(like objectives the agent can complete), and the backstory should provide context for the agent's expertise.
If the user's description is not clear, just do not generate the requested XML. Instead give a short error message.`;
  };

  const parseXMLResponse = (
    xmlString: string,
  ): { role?: string; goal?: string; backstory?: string; error?: string } => {
    try {
      // Extract content between XML tags using regex
      const roleMatch = xmlString.match(/<role>(.*?)<\/role>/);
      const goalMatch = xmlString.match(/<goal>(.*?)<\/goal>/);
      const backstoryMatch = xmlString.match(/<backstory>(.*?)<\/backstory>/);
      const role = roleMatch?.[1]?.trim();
      const goal = goalMatch?.[1]?.trim();
      const backstory = backstoryMatch?.[1]?.trim();

      if (role || goal || backstory) {
        return {
          role,
          goal,
          backstory,
        };
      }

      return { error: `No properties found in the response: ${xmlString}` };
    } catch (error: unknown) {
      console.error('Error parsing XML response:', error);
      if (error instanceof Error) {
        return { error: error.message };
      }
      return { error: 'Unknown error occurred while parsing XML' };
    }
  };

  const handleGenerate = async () => {
    if (!userDescription.trim()) return;

    setIsGenerating(true);
    setHideInfoBox(true);
    try {
      const response = await testModel({
        model_id: llmModel.model_id,
        completion_role: 'assistant',
        completion_content: generatePrompt(userDescription, relevantToolInstances),
        temperature: 0.1,
        max_tokens: 1000,
        timeout: 10,
      }).unwrap();

      setParsedSuggestions(parseXMLResponse(response));
    } catch (error) {
      console.error('Error generating suggestions:', error);
      setParsedSuggestions({ error: 'Error generating suggestions' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplySuggestions = () => {
    if (parsedSuggestions.role || parsedSuggestions.goal || parsedSuggestions.backstory) {
      const currentFormValues = form.getFieldsValue();
      form.setFieldsValue({
        name: currentFormValues.name || parsedSuggestions.role,
        role: parsedSuggestions.role,
        goal: parsedSuggestions.goal,
        backstory: parsedSuggestions.backstory,
      });
      setOpen(false);
    }
  };

  const infoMessage =
    'This feature uses the default LLM model to suggest agent properties. ' +
    'Please provide a succint descipription of your agent and the task it will be performing. ' +
    'It would look at the tools available with the agent along with your description to generate ' +
    'a set of properties that can be used to create an agent.';

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      width="50%"
      title={
        <Typography.Title level={5}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '4px', verticalAlign: 'middle' }}
          >
            <img
              src="/ai-assistant.svg"
              alt="AI Assistant"
              style={{
                filter: 'invert(70%) sepia(80%) saturate(1000%) hue-rotate(360deg)',
                width: '20px',
                height: '20px',
              }}
            />
            Generate Agent Properties using AI
          </div>
        </Typography.Title>
      }
      footer={[
        <Button key="cancel" type="default" onClick={onCancel}>
          Close
        </Button>,
        <Button
          key="apply"
          type="primary"
          disabled={
            (!parsedSuggestions.role && !parsedSuggestions.goal && !parsedSuggestions.backstory) ||
            isGenerating
          }
          onClick={handleApplySuggestions}
        >
          Apply Suggestions
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {!hideInfoBox && (
          <Alert
            style={{
              alignItems: 'flex-start',
              justifyContent: 'flex-start',
              padding: 12,
            }}
            message={
              <Layout
                style={{ flexDirection: 'column', gap: 4, padding: 0, background: 'transparent' }}
              >
                <Layout
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    background: 'transparent',
                  }}
                >
                  <InfoCircleOutlined style={{ fontSize: 16, color: '#1890ff' }} />
                  <Text style={{ fontSize: 13, fontWeight: 400, background: 'transparent' }}>
                    {infoMessage}
                  </Text>
                </Layout>
              </Layout>
            }
            type="info"
            showIcon={false}
            closable={false}
          />
        )}

        <div style={{ width: '100%', display: 'flex', gap: '6px', alignItems: 'stretch' }}>
          <div style={{ flex: 1 }}>
            <Input.TextArea
              placeholder="Describe the agent you want to create..."
              value={userDescription}
              onChange={(e) => setUserDescription(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 5 }}
              style={{ width: '100%', height: '100%' }}
              onKeyDown={(e) => {
                // trigger on generate on ctrl/cmd + enter
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  handleGenerate();
                }
              }}
            />
          </div>
          <Button
            type="primary"
            style={{
              width: 'clamp(36px, 5%, 50px)',
              backgroundColor: '#52c41a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              height: 'auto',
              position: 'relative',
            }}
            icon={
              isGenerating ? (
                <LoadingOutlined style={{ color: '#fff', fontSize: '150%' }} />
              ) : (
                <PlayCircleOutlined style={{ color: '#fff', fontSize: '150%' }} />
              )
            }
            onClick={handleGenerate}
            loading={isGenerating}
            disabled={!userDescription.trim()}
          />
        </div>

        <Space direction="vertical" style={{ width: '100%' }}>
          {parsedSuggestions.role && (
            <Alert
              message={
                <Layout
                  style={{
                    flexDirection: 'column',
                    gap: 12,
                    padding: 0,
                    background: 'transparent',
                  }}
                >
                  <Layout
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      background: 'transparent',
                      paddingLeft: '12px',
                      paddingTop: '12px',
                    }}
                  >
                    <CheckCircleOutlined style={{ fontSize: 20, color: '#52c41a' }} />
                    <Text style={{ fontSize: 16, fontWeight: 500, background: 'transparent' }}>
                      Generated Properties
                    </Text>
                  </Layout>
                  <Space
                    direction="vertical"
                    style={{ width: '100%', padding: '12px', gap: '6px' }}
                  >
                    <div>
                      <Text style={{ fontWeight: 'bold' }}>Role: </Text>
                      <Text style={{ fontWeight: 'normal' }}>{parsedSuggestions.role}</Text>
                    </div>
                    <div>
                      <Text style={{ fontWeight: 'bold' }}>Goal: </Text>
                      <Text style={{ fontWeight: 'normal' }}>{parsedSuggestions.goal}</Text>
                    </div>
                    <div>
                      <Text style={{ fontWeight: 'bold' }}>Backstory: </Text>
                      <Text style={{ fontWeight: 'normal' }}>{parsedSuggestions.backstory}</Text>
                    </div>
                  </Space>
                </Layout>
              }
              type="success"
              showIcon={false}
            />
          )}
          {parsedSuggestions.error && (
            <Alert
              message={
                <Layout
                  style={{ flexDirection: 'column', gap: 4, padding: 0, background: 'transparent' }}
                >
                  <Layout
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      background: 'transparent',
                      padding: '12px',
                    }}
                  >
                    <ExclamationCircleOutlined style={{ fontSize: 18, color: '#faad14' }} />
                    <Text style={{ fontSize: 13, fontWeight: 200, background: 'transparent' }}>
                      {parsedSuggestions.error}
                    </Text>
                  </Layout>
                </Layout>
              }
              type="error"
              showIcon={false}
            />
          )}
        </Space>
      </Space>
    </Modal>
  );
};

interface SelectAgentComponentProps {
  workflowId: string;
  parentModalOpen: boolean;
  form: FormInstance<{
    name: string;
    role: string;
    backstory: string;
    goal: string;
    llm_provider_model_id: string;
  }>;
  selectedAgentTemplate: AgentTemplateMetadata | null;
  setSelectedAgentTemplate: React.Dispatch<React.SetStateAction<AgentTemplateMetadata | null>>;
  agents?: AgentMetadata[];
  workflowAgentIds?: string[];
  toolInstances: Record<string, any>;
  imageData: Record<string, string>;
  updateAgent: any;
  createAgentState: any;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const SelectAgentComponent: React.FC<SelectAgentComponentProps> = ({
  workflowId,
  parentModalOpen,
  form,
  selectedAgentTemplate,
  setSelectedAgentTemplate,
  agents,
  workflowAgentIds,
  toolInstances,
  imageData,
  updateAgent,
  createAgentState,
  isLoading,
  setIsLoading,
}) => {
  const { data: defaultModel } = useGetDefaultModelQuery();
  const { data: toolTemplates = [] } = useListGlobalToolTemplatesQuery({});
  const { imageData: toolIconsData } = useImageAssetsData(
    toolTemplates.map((tool) => tool.tool_image_uri),
  );
  const dispatch = useAppDispatch();
  const [isAddToolModalVisible, setAddToolModalVisible] = useState(false);
  const [isGenerateAgentPropertiesModalVisible, setIsGenerateAgentPropertiesModalVisible] =
    useState(false);
  const notificationApi = useGlobalNotification();
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [deleteToolInstance] = useRemoveToolInstanceMutation();
  const combinedToolTemplates = [
    ...new Set(useSelector(selectEditorAgentViewCreateAgentToolTemplates) || []),
  ];
  const selectedAssignedAgent = useAppSelector(selectEditorAgentViewAgent);
  const { data: models = [] } = useListModelsQuery({});

  const toolTemplateCache = toolTemplates.reduce((acc: Record<string, any>, template: any) => {
    acc[template.id] = {
      name: template.name,
      imageURI: template.tool_image_uri,
    };
    return acc;
  }, {});

  useEffect(() => {
    if (selectedAgentTemplate) {
      form.setFieldsValue({
        name: selectedAgentTemplate.name,
        role: selectedAgentTemplate.role,
        backstory: selectedAgentTemplate.backstory,
        goal: selectedAgentTemplate.goal,
      });
    } else {
      form.resetFields();
    }
  }, [selectedAgentTemplate, form]);

  useEffect(() => {
    if (selectedAgentTemplate?.tool_template_ids) {
      dispatch(
        updatedEditorAgentViewCreateAgentToolTemplates(selectedAgentTemplate.tool_template_ids),
      );
    } else {
      dispatch(updatedEditorAgentViewCreateAgentToolTemplates([]));
    }
  }, [selectedAgentTemplate, dispatch]);

  // Add this useEffect to force form updates when selectedAssignedAgent changes
  useEffect(() => {
    if (selectedAssignedAgent) {
      handleSelectAssignedAgent(selectedAssignedAgent);
    } else {
      changeToCreateAgentMode();
    }
  }, [selectedAssignedAgent, form, parentModalOpen]); // Run on mount and when these deps change

  // Add this effect to update selectedAssignedAgent when agents change
  useEffect(() => {
    if (selectedAssignedAgent) {
      const updatedAgent = (agents || []).find((a) => a.id === selectedAssignedAgent.id);
      if (updatedAgent) {
        dispatch(updatedEditorAgentViewAgent(updatedAgent));
      }
    }
  }, [agents, selectedAssignedAgent]);

  // Add this effect to handle default model selection
  useEffect(() => {
    if (isCreateMode && defaultModel?.model_id) {
      form.setFieldValue('llm_provider_model_id', defaultModel.model_id);
    }
  }, [isCreateMode, defaultModel, form]);

  const changeToCreateAgentMode = () => {
    setIsCreateMode(true);
    setSelectedAgentTemplate(null);
    dispatch(updatedEditorAgentViewAgent(undefined));
    dispatch(
      updatedEditorAgentViewCreateAgentState({
        name: '',
        role: '',
        backstory: '',
        goal: '',
        tools: [],
      }),
    );
    form.resetFields();
    
    // Immediately set the default model if available
    if (defaultModel?.model_id) {
      form.setFieldValue('llm_provider_model_id', defaultModel.model_id);
    }
  };

  const handleDeleteTool = async (toolId: string, toolName: string) => {
    if (selectedAgentTemplate) return;

    try {
      setIsLoading(true);
      
      notificationApi.info({
        message: 'Initiating Tool Removal',
        description: `Starting to remove ${toolName} from the agent...`,
        placement: 'topRight',
      });

      await deleteToolInstance({ tool_instance_id: toolId }).unwrap();

      notificationApi.success({
        message: 'Tool Deletion In Progress',
        description: `${toolName} will be removed in a few seconds after cleanup of remaining artifacts.`,
        placement: 'topRight',
        duration: 5,
      });

      if (selectedAssignedAgent) {
        const updatedToolIds = (selectedAssignedAgent.tools_id || []).filter((id) => id !== toolId);

        await updateAgent({
          agent_id: selectedAssignedAgent.id,
          name: form.getFieldValue('name'),
          crew_ai_agent_metadata: {
            role: form.getFieldValue('role'),
            backstory: form.getFieldValue('backstory'),
            goal: form.getFieldValue('goal'),
            allow_delegation: false,
            verbose: false,
            cache: false,
            temperature: 0.1,
            max_iter: 0,
          },
          tools_id: updatedToolIds,
          tool_template_ids: [],
          llm_provider_model_id: '',
        }).unwrap();

        dispatch(
          updatedEditorAgentViewAgent({
            ...selectedAssignedAgent,
            tools_id: updatedToolIds,
          }),
        );

        notificationApi.success({
          message: 'Agent Updated',
          description: `Agent configuration has been updated successfully.`,
          placement: 'topRight',
        });
      } else {
        const updatedTools = (createAgentState?.tools || []).filter((id: string) => id !== toolId);
        dispatch(
          updatedEditorAgentViewCreateAgentState({
            ...createAgentState,
            tools: updatedTools,
          }),
        );
      }
    } catch (error: unknown) {
      const errorMessage = (error as { data?: { error?: string } })?.data?.error || 'Failed to remove tool. Please try again.';
      notificationApi.error({
        message: 'Error Removing Tool',
        description: errorMessage,
        placement: 'topRight',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectAssignedAgent = (agent: AgentMetadata) => {
    // Aggressively reset everything first
    setIsCreateMode(false);
    setSelectedAgentTemplate(null);
    form.resetFields();

    // Force immediate form update
    setTimeout(() => {
      form.setFieldsValue({
        name: agent.name,
        role: (agent.crew_ai_agent_metadata as CrewAIAgentMetadata)?.role || '',
        backstory: agent.crew_ai_agent_metadata?.backstory || '',
        goal: agent.crew_ai_agent_metadata?.goal || '',
        llm_provider_model_id: agent.llm_provider_model_id || defaultModel?.model_id,
      });
    }, 0);

    // Update selected agent state
    dispatch(updatedEditorAgentViewAgent(agent));

    dispatch(
      updatedEditorAgentViewCreateAgentState({
        name: agent.name,
        role: (agent.crew_ai_agent_metadata as CrewAIAgentMetadata)?.role || '',
        backstory: agent.crew_ai_agent_metadata?.backstory || '',
        goal: agent.crew_ai_agent_metadata?.goal || '',
        tools: agent.tools_id || [],
        agentId: agent.id,
      }),
    );
  };

  const renderToolList = () => {
    if (selectedAgentTemplate) {
      // Show tool templates for agent template without delete button
      const items = combinedToolTemplates
        .map((id) => ({
          ...toolTemplateCache[id],
          id,
        }))
        .filter(Boolean);

      return (
        <List
          grid={{ gutter: 16, column: 2 }}
          dataSource={items}
          renderItem={({ name, imageURI, id }) => (
            <List.Item>
              <div
                style={{
                  borderRadius: '4px',
                  border: 'solid 1px #f0f0f0',
                  backgroundColor: '#fff',
                  width: '100%',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: '#f1f1f1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: '8px',
                      }}
                    >
                      {imageURI && (
                        <Image
                          src={toolIconsData[imageURI] || imageURI}
                          alt={name}
                          width={16}
                          height={16}
                          preview={false}
                          style={{
                            borderRadius: '2px',
                            objectFit: 'cover',
                          }}
                        />
                      )}
                    </div>
                    <Text
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '40%',
                        display: 'inline-block'
                      }}
                      title={name}
                    >
                      {name}
                    </Text>
                  </div>
                </div>
              </div>
            </List.Item>
          )}
        />
      );
    } else {
      // Show tool instances for both assigned agent and new agent
      const toolIds = selectedAssignedAgent
        ? selectedAssignedAgent.tools_id || []
        : createAgentState?.tools || [];

      const items = toolIds
        .map((id: string) => ({
          ...toolInstances[id],
          id,
        }))
        .filter(Boolean);

      return (
        <List
          grid={{ gutter: 16, column: 2 }}
          dataSource={items}
          renderItem={(tool: { id: string; tool_image_uri?: string; name: string; is_valid?: boolean; tool_metadata?: Record<string, string> }) => (
            <List.Item>
              <div
                style={{
                  borderRadius: '4px',
                  border: 'solid 1px #f0f0f0',
                  backgroundColor: '#fff',
                  width: '100%',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    justifyContent: 'space-between',
                    marginBottom: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                    <div
                      style={{
                        width: '24px',
                        height: '24px',
                        minWidth: '24px',
                        borderRadius: '50%',
                        background: '#f1f1f1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: '8px',
                      }}
                    >
                      {tool.tool_image_uri && (
                        <Image
                          src={imageData[tool.tool_image_uri] || '/fallback-image.png'}
                          alt={tool.name}
                          width={16}
                          height={16}
                          preview={false}
                          style={{
                            borderRadius: '2px',
                            objectFit: 'cover',
                          }}
                        />
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                      <Text
                        style={{
                          fontSize: '14px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '90%',
                          display: 'inline-block'
                        }}
                        title={tool.name}
                      >
                        {tool.name}
                      </Text>
                      <Tooltip 
                        title={
                          tool.is_valid 
                            ? 'Tool is valid' 
                            : tool.tool_metadata 
                              ? JSON.parse(typeof tool.tool_metadata === 'string' ? tool.tool_metadata : JSON.stringify(tool.tool_metadata)).status || 'Tool status unknown'
                              : 'Tool status unknown'
                        }
                      >
                        {tool.is_valid ? (
                          <CheckCircleOutlined style={{ color: '#52c41a', fontSize: '15px', fontWeight: 1000, marginLeft: '12px' }} />
                        ) : (
                          <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: '15px', fontWeight: 1000, marginLeft: '12px' }} />
                        )}
                      </Tooltip>
                    </div>
                  </div>
                  <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <Popconfirm
                      title="Delete Tool"
                      description="Are you sure you want to delete this tool?"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        handleDeleteTool(tool.id, tool.name);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <Button
                        type="link"
                        icon={<DeleteOutlined style={{ color: '#ff4d4f' }} />}
                        onClick={(e) => e.stopPropagation()}
                        disabled={isFormDisabled}
                      />
                    </Popconfirm>
                  </div>
                </div>
              </div>
            </List.Item>
          )}
        />
      );
    }
  };

  const renderAssignedAgents = () => (
    <List
      grid={{ gutter: 16, column: 2 }}
      dataSource={agents?.filter((agent) => workflowAgentIds?.includes(agent.id))}
      renderItem={(agent) => (
        <List.Item>
          <div
            style={{
              borderRadius: '4px',
              border: 'solid 1px #f0f0f0',
              backgroundColor: selectedAssignedAgent?.id === agent.id ? '#edf7ff' : '#fff',
              width: '100%',
              height: '160px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
            }}
            onClick={() => handleSelectAssignedAgent(agent)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.03)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '16px',
              }}
            >
              <Avatar
                style={{
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                  backgroundColor: imageData[agent.agent_image_uri] ? '#b8d6ff' : '#78b2ff',
                  minWidth: '24px',
                  minHeight: '24px',
                  width: '24px',
                  height: '24px',
                  flex: '0 0 24px',
                  padding: imageData[agent.agent_image_uri] ? 4 : 0,
                }}
                size={24}
                icon={
                  imageData[agent.agent_image_uri] ? (
                    <Image src={imageData[agent.agent_image_uri]} alt={agent.name} />
                  ) : (
                    <UserOutlined />
                  )
                }
              />
              <Text
                style={{
                  fontSize: '14px',
                  fontWeight: 400,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={agent.name}
              >
                {agent.name}
              </Text>
            </div>
            <Text
              style={{
                fontSize: '11px',
                opacity: 0.45,
                fontWeight: 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginBottom: '4px',
              }}
            >
              Goal:{' '}
              <span style={{ color: 'black', fontWeight: 400 }}>
                {agent.crew_ai_agent_metadata?.goal || 'N/A'}
              </span>
            </Text>
            <Text
              style={{
                fontSize: '11px',
                opacity: 0.45,
                fontWeight: 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Backstory:{' '}
              <span style={{ color: 'black', fontWeight: 400 }}>
                {agent.crew_ai_agent_metadata?.backstory || 'N/A'}
              </span>
            </Text>
            {(agent.tools_id || []).length > 0 && (
              <Space
                style={{
                  marginTop: '12px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                {(agent.tools_id || []).map((toolId) => {
                  const toolInstance = toolInstances[toolId];
                  const imageUri = toolInstance?.tool_image_uri;
                  const imageSrc =
                    imageUri && imageData[imageUri] ? imageData[imageUri] : '/fallback-image.png';
                  return (
                    <Tooltip title={toolInstance?.name || toolId} key={toolId} placement="top">
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          minWidth: '24px',
                          minHeight: '24px',
                          flex: '0 0 24px',
                          borderRadius: '50%',
                          background: '#f1f1f1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Image
                          src={imageSrc}
                          alt={toolInstance?.name || toolId}
                          width={16}
                          height={16}
                          preview={false}
                          style={{
                            borderRadius: '2px',
                            objectFit: 'cover',
                          }}
                        />
                      </div>
                    </Tooltip>
                  );
                })}
              </Space>
            )}
          </div>
        </List.Item>
      )}
    />
  );

  const isFormDisabled = selectedAgentTemplate !== null;

  const renderToolSection = () => {
    if (selectedAgentTemplate) {
      return (
        <>
          <Alert
            style={{
              alignItems: 'flex-start',
              justifyContent: 'flex-start',
              padding: 12,
              marginBottom: 12,
            }}
            message={
              <Layout
                style={{ flexDirection: 'column', gap: 4, padding: 0, background: 'transparent' }}
              >
                <Layout
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    background: 'transparent',
                  }}
                >
                  <QuestionCircleOutlined />
                  <Text style={{ fontSize: 13, fontWeight: 600, background: 'transparent' }}>
                    Template Mode
                  </Text>
                </Layout>
                <Text style={{ fontSize: 13, fontWeight: 400, background: 'transparent' }}>
                  This is an Agent Template. To customize agent & tools and settings, first create
                  an agent from this template using the button below, then you can modify it.
                </Text>
              </Layout>
            }
            type="info"
            showIcon={false}
            closable={false}
          />
          {renderToolList()}
        </>
      );
    } else if (selectedAssignedAgent) {
      return (
        <>
          <Typography.Title level={5} style={{ marginBottom: '14px' }}>
            Add Optional Tools
          </Typography.Title>
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setAddToolModalVisible(true)}
            style={{ width: '100%', marginBottom: '16px' }}
            disabled={isFormDisabled}
          >
            Create or Edit Tools
          </Button>
          {renderToolList()}
        </>
      );
    } else {
      return (
        <>
          <Typography.Title level={5} style={{ marginBottom: '14px' }}>
            Add Optional Tools
          </Typography.Title>
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setAddToolModalVisible(true)}
            style={{ width: '100%', marginBottom: '16px' }}
          >
            Create or Edit Tools
          </Button>
          {renderToolList()}
        </>
      );
    }
  };

  return (
    <>
      <Divider style={{ margin: 0, backgroundColor: '#f0f0f0' }} />
      <Layout
        style={{ display: 'flex', flexDirection: 'row', height: '100%', backgroundColor: '#fff' }}
      >
        <Layout style={{ flex: 1, overflowY: 'auto', padding: '16px', backgroundColor: '#fff' }}>
          <div
            style={{
              marginBottom: 16,
              cursor: 'pointer',
              boxShadow: isCreateMode ? '0 4px 8px rgba(0, 0, 0, 0.2)' : 'none',
              width: '100%',
              border: 'solid 1px #f0f0f0',
              borderRadius: '4px',
              padding: '16px',
              backgroundColor: isCreateMode ? '#edf7ff' : '#fff',
            }}
            onClick={changeToCreateAgentMode}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space size={16}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    backgroundColor: '#edf7ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <PlusOutlined style={{ fontSize: '16px', color: '#1890ff' }} />
                </div>
                <div>
                  <div
                    style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    Create New Agent
                  </div>
                  <Text
                    style={{
                      fontSize: '11px',
                      opacity: 0.45,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    Create a new custom agent from scratch
                  </Text>
                </div>
              </Space>
            </div>
          </div>
          <Layout style={{ display: 'flex', flexDirection: 'row', backgroundColor: '#fff' }}>
            <Layout style={{ flex: 1, backgroundColor: '#fff', paddingRight: '16px' }}>
              <Typography.Title level={5} style={{ marginBottom: '16px' }}>
                Edit Agents in Workflow
              </Typography.Title>
            </Layout>
          </Layout>
          <Layout
            style={{
              display: 'flex',
              flexDirection: 'row',
              height: '100%',
              backgroundColor: '#fff',
            }}
          >
            <Layout
              style={{ flex: 1, overflowY: 'auto', backgroundColor: '#fff', paddingRight: '16px' }}
            >
              {renderAssignedAgents()}
            </Layout>
          </Layout>
        </Layout>
        <Divider type="vertical" style={{ height: 'auto', backgroundColor: '#f0f0f0' }} />
        <Layout style={{ flex: 1, backgroundColor: '#fff', padding: '16px', overflowY: 'auto' }}>
          <Typography.Title level={5} style={{ marginBottom: '16px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                verticalAlign: 'middle',
                justifyContent: 'space-between',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: '4px',
                  alignItems: 'center',
                  verticalAlign: 'middle',
                }}
              >
                Agent Details
                {defaultModel && (
                  <Tooltip title="Generate agent properties using AI">
                    <Button
                      type="text"
                      icon={
                        <img
                          src="/ai-assistant.svg"
                          alt="AI Assistant"
                          style={{
                            filter: 'invert(70%) sepia(80%) saturate(1000%) hue-rotate(360deg)',
                            width: '20px',
                            height: '20px',
                          }}
                        />
                      }
                      style={{ padding: '2px' }}
                      onClick={() => setIsGenerateAgentPropertiesModalVisible(true)}
                    />
                  </Tooltip>
                )}
              </div>
              <div>
                {!isCreateMode && (
                  <Button
                    type="text"
                    onClick={() => {
                      if (selectedAssignedAgent) {
                        handleSelectAssignedAgent(selectedAssignedAgent);
                      }
                    }}
                    size="small"
                  >
                    Reset Fields <UndoOutlined />
                  </Button>
                )}
              </div>
            </div>
          </Typography.Title>
          <Form form={form} layout="vertical">
            <Form.Item
              label={
                <Space>
                  Name
                  <Tooltip title="The name of the agent">
                    <QuestionCircleOutlined style={{ color: '#666' }} />
                  </Tooltip>
                </Space>
              }
              name="name"
              rules={[{ required: true, message: 'Name is required' }]}
            >
              <Input disabled={isFormDisabled} />
            </Form.Item>
            <Form.Item
              label={
                <Space>
                  Role
                  <Tooltip title="The role this agent plays in the workflow">
                    <QuestionCircleOutlined style={{ color: '#666' }} />
                  </Tooltip>
                </Space>
              }
              name="role"
              rules={[{ required: true, message: 'Role is required' }]}
            >
              <Input disabled={isFormDisabled} />
            </Form.Item>
            <Form.Item
              label={
                <Space>
                  Backstory
                  <Tooltip title="Background information about this agent">
                    <QuestionCircleOutlined style={{ color: '#666' }} />
                  </Tooltip>
                </Space>
              }
              name="backstory"
              rules={[{ required: true, message: 'Backstory is required' }]}
            >
              <TextArea disabled={isFormDisabled} autoSize={{ minRows: 3, maxRows: 4 }} />
            </Form.Item>
            <Form.Item
              label={
                <Space>
                  Goal
                  <Tooltip title="The primary objective of this agent">
                    <QuestionCircleOutlined style={{ color: '#666' }} />
                  </Tooltip>
                </Space>
              }
              name="goal"
              rules={[{ required: true, message: 'Goal is required' }]}
            >
              <TextArea disabled={isFormDisabled} autoSize={{ minRows: 3, maxRows: 4 }} />
            </Form.Item>
            <Form.Item
              label={
                <Space>
                  LLM Model
                  <Tooltip title="The language model this agent will use">
                    <QuestionCircleOutlined style={{ color: '#666' }} />
                  </Tooltip>
                </Space>
              }
              name="llm_provider_model_id"
              rules={[{ required: true, message: 'Language model is required' }]}
            >
              <Select>
                {models.map(model => (
                  <Select.Option key={model.model_id} value={model.model_id}>
                    {model.model_name} {model.model_id === defaultModel?.model_id && '(Default)'}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            {renderToolSection()}
          </Form>
        </Layout>
      </Layout>
      <Divider style={{ margin: 0, backgroundColor: '#f0f0f0' }} />
      <WorkflowAddToolModal
        workflowId={workflowId}
        open={isAddToolModalVisible}
        onCancel={() => setAddToolModalVisible(false)}
      />
      {defaultModel && (
        <GenerateAgentPropertiesModal
          open={isGenerateAgentPropertiesModalVisible}
          setOpen={setIsGenerateAgentPropertiesModalVisible}
          onCancel={() => setIsGenerateAgentPropertiesModalVisible(false)}
          form={form}
          llmModel={defaultModel}
          toolInstances={toolInstances}
        />
      )}
    </>
  );
};

interface SelectOrAddAgentModalProps {
  workflowId: string;
}

const SelectOrAddAgentModal: React.FC<SelectOrAddAgentModalProps> = ({workflowId}) => {
  const isModalOpen = useAppSelector(selectEditorAgentViewIsOpen);
  const modalLayout = useAppSelector(selectEditorAgentViewStep);
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<{
    name: string;
    role: string;
    backstory: string;
    goal: string;
    llm_provider_model_id: string;
  }>();
  const [addAgent] = useAddAgentMutation();
  const [selectedAgentTemplate, setSelectedAgentTemplate] = useState<AgentTemplateMetadata | null>(
    null,
  );
  const toolTemplateIds = useSelector(selectEditorAgentViewCreateAgentToolTemplates) || [];
  const existingToolIds = useSelector(selectEditorAgentViewCreateAgentTools) || [];
  const [updateWorkflow] = useUpdateWorkflowMutation();
  const [addWorkflow] = useAddWorkflowMutation();
  const workflowState = useAppSelector(selectEditorWorkflow);
  const notificationApi = useGlobalNotification();
  const [toolDetails, setToolDetails] = useState<{
    name: string;
    description: string;
    pythonCode: string;
    pythonRequirements: string;
  }>({
    name: '',
    description: '',
    pythonCode: '',
    pythonRequirements: '',
  });
  const { data: agents = [] } = useListAgentsQuery({workflow_id: workflowId});
  const workflowAgentIds = useAppSelector(
    (state) => state.editor.workflow?.workflowMetadata?.agentIds || [],
  );
  const { data: toolInstancesList = [] } = useListToolInstancesQuery({workflow_id: workflowId});
  const toolInstances = toolInstancesList.reduce(
    (acc: Record<string, ToolInstance>, instance: ToolInstance) => {
      acc[instance.id] = instance;
      return acc;
    },
    {},
  );
  const { imageData } = useImageAssetsData([
    ...Object.values(toolInstances).map((t: any) => t.tool_image_uri),
    ...agents
      .filter((agent: any) => workflowAgentIds.includes(agent.id))
      .map((a: any) => a.agent_image_uri),
  ]);
  const selectedAssignedAgent = useAppSelector(selectEditorAgentViewAgent);
  const [updateAgent] = useUpdateAgentMutation();
  const createAgentState = useSelector(selectEditorAgentViewCreateAgentState);
  const { data: defaultModel } = useGetDefaultModelQuery();
  const [isLoading, setIsLoading] = useState(false);

  // Add useEffect to set default model when form is initialized or when defaultModel changes
  useEffect(() => {
    if (defaultModel && !selectedAssignedAgent) {
      form.setFieldValue('llm_provider_model_id', defaultModel.model_id);
    }
  }, [defaultModel, form, selectedAssignedAgent]);

  // When editing an existing agent, set its model
  useEffect(() => {
    if (selectedAssignedAgent) {
      form.setFieldValue('llm_provider_model_id', selectedAssignedAgent.llm_provider_model_id);
    }
  }, [selectedAssignedAgent, form]);

  // Add this effect to reset everything when modal closes
  useEffect(() => {
    if (!isModalOpen) {
      // Reset all state when modal closes
      setSelectedAgentTemplate(null);
      dispatch(updatedEditorAgentViewAgent(undefined));
      form.resetFields();
      dispatch(
        updatedEditorAgentViewCreateAgentState({
          name: '',
          role: '',
          backstory: '',
          goal: '',
          tools: [],
        }),
      );
      setToolDetails({
        name: '',
        description: '',
        pythonCode: '',
        pythonRequirements: '',
      });
    } else {
      setSelectedAgentTemplate(null);
    }
  }, [isModalOpen]); // Depend on modal open state

  const handleAddAgent = async () => {
    try {
      const values = await form.validateFields();

      if (selectedAssignedAgent) {
        // Show update initiation notification
        notificationApi.info({
          message: 'Updating Agent',
          description: 'Initiating agent update...',
          placement: 'topRight',
        });

        // Update existing agent
        await updateAgent({
          agent_id: selectedAssignedAgent.id,
          name: values.name,
          crew_ai_agent_metadata: {
            role: values.role,
            backstory: values.backstory,
            goal: values.goal,
            allow_delegation: false,
            verbose: false,
            cache: false,
            temperature: 0.1,
            max_iter: 0,
          },
          tools_id: selectedAssignedAgent.tools_id || [],
          tool_template_ids: [],
          llm_provider_model_id: values.llm_provider_model_id,
          tmp_agent_image_path: '',
        }).unwrap();

        notificationApi.success({
          message: 'Agent Updated',
          description: 'The agent has been successfully updated.',
          placement: 'topRight',
        });
      } else {
        // Show creation initiation notification
        notificationApi.info({
          message: 'Creating Agent',
          description: 'Initiating agent creation...',
          placement: 'topRight',
        });

        // Create new agent
        const newAgent = await addAgent({
          name: values.name,
          template_id: selectedAgentTemplate?.id || '',
          workflow_id: workflowId || '',
          crew_ai_agent_metadata: {
            role: values.role,
            backstory: values.backstory,
            goal: values.goal,
            allow_delegation: false,
            verbose: false,
            cache: false,
            temperature: 0.1,
            max_iter: 0,
          },
          tools_id: createAgentState?.tools || [],
          llm_provider_model_id: values.llm_provider_model_id,
          tool_template_ids: toolTemplateIds,
          tmp_agent_image_path: '',
        }).unwrap();

        // Show workflow update notification
        notificationApi.info({
          message: 'Updating Workflow',
          description: 'Adding agent to workflow...',
          placement: 'topRight',
        });

        const updatedAgentIds = [...(workflowState.workflowMetadata.agentIds || []), newAgent];
        dispatch(updatedEditorWorkflowAgentIds(updatedAgentIds));

        const updatedWorkflowState = {
          ...workflowState,
          workflowMetadata: {
            ...workflowState.workflowMetadata,
            agentIds: updatedAgentIds,
          },
        };

        if (workflowState.workflowId) {
          await updateWorkflow(createUpdateRequestFromEditor(updatedWorkflowState)).unwrap();
        } else {
          const workflowId = await addWorkflow(
            createAddRequestFromEditor(updatedWorkflowState),
          ).unwrap();
          dispatch(updatedEditorWorkflowId(workflowId));
        }

        notificationApi.success({
          message: 'Agent Added',
          description: 'The agent has been successfully added to the workflow.',
          placement: 'topRight',
        });

        // Reset form and state
        form.resetFields();
        setSelectedAgentTemplate(null);
        dispatch(updatedEditorAgentViewAgent(undefined));
        dispatch(
          updatedEditorAgentViewCreateAgentState({
            name: '',
            role: '',
            backstory: '',
            goal: '',
            tools: [],
          }),
        );
      }
    } catch (error: any) {
      console.error('Error details:', error);
      const errorMessage = error.data?.error || 'There was an error. Please try again.';
      notificationApi.error({
        message: selectedAssignedAgent ? 'Error Updating Agent' : 'Error Adding Agent',
        description: errorMessage,
        placement: 'topRight',
      });
    }
  };

  const title: any =
    modalLayout === 'Select'
      ? 'Create or Edit Agent'
      : modalLayout === 'Details'
        ? 'Agent Details'
        : modalLayout === 'Create'
          ? 'Create Agent'
          : '';

  const getButtonText = () => {
    if (selectedAgentTemplate) {
      return 'Create Agent from Template';
    } else if (selectedAssignedAgent) {
      return 'Save Agent';
    } else {
      return 'Create Agent';
    }
  };

  return (
    <Modal
      open={isModalOpen}
      onCancel={() => dispatch(updatedEditorAgentViewOpen(false))}
      centered
      title={title}
      width="98%"
      style={{ height: '95vh' }}
      footer={[
        <Button key="cancel" onClick={() => dispatch(updatedEditorAgentViewOpen(false))}>
          Close
        </Button>,
        <Button 
          key="add" 
          type="primary" 
          onClick={handleAddAgent}
          disabled={!defaultModel} // Disable button if no default model
        >
          {getButtonText()}
        </Button>,
      ]}
    >
      <div style={{ position: 'relative' }}>
        {isLoading && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.6)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: 'not-allowed'
          }}>
            <Spin size="large" />
          </div>
        )}
        <div style={{ overflowY: 'auto', height: 'calc(95vh - 108px)' }}>
          <SelectAgentComponent
            workflowId={workflowId}
            parentModalOpen={isModalOpen || false}
            form={form}
            selectedAgentTemplate={selectedAgentTemplate}
            setSelectedAgentTemplate={setSelectedAgentTemplate}
            agents={agents}
            workflowAgentIds={workflowAgentIds}
            toolInstances={toolInstances}
            imageData={imageData}
            updateAgent={updateAgent}
            createAgentState={createAgentState}
            isLoading={isLoading}
            setIsLoading={setIsLoading}
          />
        </div>
      </div>
    </Modal>
  );
};

export default SelectOrAddAgentModal;
