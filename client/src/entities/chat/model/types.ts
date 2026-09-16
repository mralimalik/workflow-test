export type ChatRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** Which agent node produced this message (assistant messages only). */
  nodeId?: string
  nodeLabel?: string
  toolCalls?: ToolCallRequest[]
  /** For role: 'tool' messages — which call this is the result of. */
  toolCallId?: string
  toolName?: string
  createdAt: string
}

export type RunStatus = 'idle' | 'running' | 'waiting-client-tool' | 'success' | 'error'

export type RunStepStatus = 'pending' | 'active' | 'success' | 'error'

export interface RunStep {
  id: string
  nodeId: string
  nodeLabel: string
  status: RunStepStatus
  detail?: string
  timestamp: string
}
