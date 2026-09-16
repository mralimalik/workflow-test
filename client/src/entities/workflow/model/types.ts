export type WorkflowNodeKind = 'start' | 'agent' | 'router' | 'end'

export interface Position {
  x: number
  y: number
}

export interface AgentModelConfig {
  /** Azure deployment name. Empty string = use the default deployment from Settings. */
  deploymentId: string
  temperature: number
  maxTokens: number
  topP: number
}

// Node data types extend Record<string, unknown> so they satisfy @xyflow/react's
// generic Node<T> constraint without a lossy cast at every usage site.

export interface StartNodeData extends Record<string, unknown> {
  kind: 'start'
  label: string
}

export interface AgentNodeData extends Record<string, unknown> {
  kind: 'agent'
  label: string
  systemPrompt: string
  toolIds: string[]
  model: AgentModelConfig
}

export interface RouterRule {
  id: string
  label: string
  /** Instruction fragment telling the routing model when to pick this branch. */
  description: string
}

export type RouterMode = 'llm' | 'first-match'

export interface RouterNodeData extends Record<string, unknown> {
  kind: 'router'
  label: string
  mode: RouterMode
  instructions: string
  rules: RouterRule[]
}

export interface EndNodeData extends Record<string, unknown> {
  kind: 'end'
  label: string
}

export type WorkflowNodeData = StartNodeData | AgentNodeData | RouterNodeData | EndNodeData

export interface WorkflowNode {
  id: string
  type: WorkflowNodeKind
  position: Position
  data: WorkflowNodeData
}

export const ROUTER_DEFAULT_HANDLE = 'default'

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  /** For router nodes: a RouterRule id, or ROUTER_DEFAULT_HANDLE for the fallback branch. */
  sourceHandle?: string | null
  label?: string
}

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: string
  updatedAt: string
}

export interface WorkflowValidationIssue {
  severity: 'error' | 'warning'
  message: string
  nodeId?: string
}
