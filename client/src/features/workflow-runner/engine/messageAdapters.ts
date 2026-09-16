import type { ChatMessage } from '@/entities/chat/model/types'
import { toolParametersToJsonSchema } from '@/entities/tool/model/types'
import type { Tool } from '@/entities/tool/model/types'
import type { AzureChatMessage, AzureFunctionTool } from '@/shared/lib/azureOpenAI/types'

function domainToAzureMessage(message: ChatMessage): AzureChatMessage {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.toolCallId,
      name: message.toolName,
    }
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    }
  }
  return { role: message.role, content: message.content }
}

/** Builds the Azure request message list for one agent's turn: its system prompt + the shared transcript. */
export function buildAzureMessages(systemPrompt: string, messages: ChatMessage[]): AzureChatMessage[] {
  const converted = messages.filter((m) => m.role !== 'system').map(domainToAzureMessage)
  return [{ role: 'system', content: systemPrompt }, ...converted]
}

export function toolToAzureFunction(tool: Tool): AzureFunctionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toolParametersToJsonSchema(tool.parameters),
    },
  }
}

export function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}
