export interface AzureToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AzureChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: AzureToolCall[]
  tool_call_id?: string
  name?: string
}

export interface AzureFunctionTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AzureChatCompletionRequest {
  messages: AzureChatMessage[]
  temperature?: number
  max_tokens?: number
  top_p?: number
  tools?: AzureFunctionTool[]
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

export interface AzureChatCompletionResponse {
  choices: {
    index: number
    finish_reason: string
    message: AzureChatMessage
  }[]
}
