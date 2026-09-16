import { createId } from '@/shared/lib/id'
import type {
  AgentNodeData,
  EndNodeData,
  RouterNodeData,
  StartNodeData,
  Workflow,
  WorkflowNode,
  WorkflowNodeKind,
} from './types'

export function createDefaultAgentModelConfig() {
  return {
    deploymentId: '',
    temperature: 0.7,
    maxTokens: 1024,
    topP: 1,
  }
}

function createNodeData(kind: WorkflowNodeKind): WorkflowNode['data'] {
  switch (kind) {
    case 'start':
      return { kind: 'start', label: 'Start' } satisfies StartNodeData
    case 'agent':
      return {
        kind: 'agent',
        label: 'New agent',
        systemPrompt: 'You are a helpful assistant.',
        toolIds: [],
        model: createDefaultAgentModelConfig(),
      } satisfies AgentNodeData
    case 'router':
      return {
        kind: 'router',
        label: 'Router',
        mode: 'llm',
        instructions: 'Choose the branch that best matches the conversation so far.',
        rules: [],
      } satisfies RouterNodeData
    case 'end':
      return { kind: 'end', label: 'End' } satisfies EndNodeData
  }
}

export function createWorkflowNode(
  kind: WorkflowNodeKind,
  position: { x: number; y: number },
): WorkflowNode {
  return {
    id: createId(kind),
    type: kind,
    position,
    data: createNodeData(kind),
  }
}

export function createEmptyWorkflow(): Workflow {
  const now = new Date().toISOString()
  const start = createWorkflowNode('start', { x: 80, y: 180 })
  const agent = createWorkflowNode('agent', { x: 380, y: 180 })
  const end = createWorkflowNode('end', { x: 720, y: 180 })
  ;(agent.data as AgentNodeData).label = 'Assistant'

  return {
    id: createId('workflow'),
    name: 'My workflow',
    description: 'A single-agent workflow to get you started.',
    nodes: [start, agent, end],
    edges: [
      { id: createId('edge'), source: start.id, target: agent.id },
      { id: createId('edge'), source: agent.id, target: end.id },
    ],
    createdAt: now,
    updatedAt: now,
  }
}
