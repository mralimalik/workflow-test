import type { ChatMessage, ToolCallRequest } from '@/entities/chat/model/types'
import type { Tool } from '@/entities/tool/model/types'
import type { AzureOpenAISettings } from '@/entities/settings/model/types'
import { findStartNode, nextNode, nextNodeForHandle } from '@/entities/workflow/lib/graph'
import {
  ROUTER_DEFAULT_HANDLE,
  type AgentNodeData,
  type RouterNodeData,
  type Workflow,
  type WorkflowNode,
} from '@/entities/workflow/model/types'
import { createId } from '@/shared/lib/id'
import { AzureOpenAIError, createAzureChatCompletion } from '@/shared/lib/azureOpenAI/client'
import { executeClientTool } from './clientToolRunner'
import { MAX_NODE_HOPS, MAX_TOOL_ITERATIONS } from './constants'
import { buildAzureMessages, safeParseJson, toolToAzureFunction } from './messageAdapters'

export interface RunContext {
  workflow: Workflow
  tools: Tool[]
  settings: AzureOpenAISettings
  /** Full transcript so far, ending with the new user message. Mutated in place as the run produces messages. */
  history: ChatMessage[]
}

export interface RunCallbacks {
  onNodeEnter?: (node: WorkflowNode) => void
  onNodeExit?: (node: WorkflowNode, status: 'success' | 'error', detail?: string) => void
  onMessage?: (message: ChatMessage) => void
  onToolCall?: (call: ToolCallRequest, node: WorkflowNode) => void
}

export interface RunResult {
  status: 'success' | 'error'
  error?: string
}

function emit(ctx: RunContext, callbacks: RunCallbacks, message: ChatMessage) {
  ctx.history.push(message)
  callbacks.onMessage?.(message)
}

async function runAgent(
  node: WorkflowNode,
  ctx: RunContext,
  callbacks: RunCallbacks,
): Promise<void> {
  const data = node.data as AgentNodeData
  const toolDefs = ctx.tools.filter((tool) => data.toolIds.includes(tool.id))
  const azureTools = toolDefs.map(toolToAzureFunction)

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await createAzureChatCompletion(ctx.settings, data.model.deploymentId, {
      messages: buildAzureMessages(data.systemPrompt, ctx.history),
      temperature: data.model.temperature,
      max_tokens: data.model.maxTokens,
      top_p: data.model.topP,
      tools: azureTools.length > 0 ? azureTools : undefined,
      tool_choice: azureTools.length > 0 ? 'auto' : undefined,
    })

    const choice = response.choices[0]
    if (!choice) throw new Error('The model returned no response.')
    const raw = choice.message

    if (raw.tool_calls && raw.tool_calls.length > 0) {
      const toolCalls: ToolCallRequest[] = raw.tool_calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: safeParseJson(call.function.arguments),
      }))

      emit(ctx, callbacks, {
        id: createId('msg'),
        role: 'assistant',
        content: raw.content ?? '',
        nodeId: node.id,
        nodeLabel: data.label,
        toolCalls,
        createdAt: new Date().toISOString(),
      })

      for (const call of toolCalls) {
        callbacks.onToolCall?.(call, node)
        const toolDef = toolDefs.find((tool) => tool.name === call.name)
        let resultContent: string

        if (!toolDef) {
          resultContent = JSON.stringify({ error: `Unknown tool "${call.name}".` })
        } else if (toolDef.executionType === 'client') {
          try {
            const result = await executeClientTool(toolDef, call.arguments)
            resultContent = typeof result === 'string' ? result : JSON.stringify(result ?? null)
          } catch (err) {
            resultContent = JSON.stringify({
              error: err instanceof Error ? err.message : 'Client tool threw an error.',
            })
          }
        } else {
          resultContent = JSON.stringify({
            simulated: true,
            note: 'No backend connected yet — this is a placeholder result so you can test the flow.',
          })
        }

        emit(ctx, callbacks, {
          id: createId('msg'),
          role: 'tool',
          content: resultContent,
          toolCallId: call.id,
          toolName: call.name,
          createdAt: new Date().toISOString(),
        })
      }
      continue
    }

    emit(ctx, callbacks, {
      id: createId('msg'),
      role: 'assistant',
      content: raw.content ?? '',
      nodeId: node.id,
      nodeLabel: data.label,
      createdAt: new Date().toISOString(),
    })
    return
  }

  throw new Error(`Agent "${data.label}" made too many tool calls in a row.`)
}

async function runRouter(node: WorkflowNode, ctx: RunContext): Promise<string> {
  const data = node.data as RouterNodeData
  if (data.rules.length === 0) return ROUTER_DEFAULT_HANDLE

  if (data.mode === 'first-match') {
    const lastUser = [...ctx.history].reverse().find((m) => m.role === 'user')
    const text = (lastUser?.content ?? '').toLowerCase()
    for (const rule of data.rules) {
      const keywords = rule.description
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
      if (keywords.some((keyword) => text.includes(keyword))) return rule.id
    }
    return ROUTER_DEFAULT_HANDLE
  }

  const branchLabels = data.rules.map((rule) => rule.label)
  const systemPrompt = [
    'You are a silent routing function inside a multi-agent workflow.',
    data.instructions,
    '',
    'Branches:',
    ...data.rules.map((rule) => `- ${rule.label}: ${rule.description}`),
    '- default: none of the above fit',
  ].join('\n')

  const response = await createAzureChatCompletion(ctx.settings, undefined, {
    messages: buildAzureMessages(systemPrompt, ctx.history),
    temperature: 0,
    max_tokens: 40,
    tools: [
      {
        type: 'function',
        function: {
          name: 'select_branch',
          description: 'Choose which branch the workflow should take next.',
          parameters: {
            type: 'object',
            properties: { branch: { type: 'string', enum: [...branchLabels, 'default'] } },
            required: ['branch'],
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'select_branch' } },
  })

  const call = response.choices[0]?.message.tool_calls?.[0]
  if (!call) return ROUTER_DEFAULT_HANDLE

  const args = safeParseJson(call.function.arguments)
  const chosenLabel = typeof args.branch === 'string' ? args.branch : 'default'
  const rule = data.rules.find((r) => r.label === chosenLabel)
  return rule?.id ?? ROUTER_DEFAULT_HANDLE
}

export async function runWorkflow(ctx: RunContext, callbacks: RunCallbacks): Promise<RunResult> {
  const start = findStartNode(ctx.workflow)
  if (!start) return { status: 'error', error: 'The workflow has no Start node.' }

  let current: WorkflowNode | undefined = nextNode(ctx.workflow, start.id)
  if (!current) return { status: 'error', error: 'Start is not connected to anything.' }

  let hops = 0
  while (current) {
    if (++hops > MAX_NODE_HOPS) {
      return { status: 'error', error: 'The run took too many steps — check the graph for a loop.' }
    }

    if (current.type === 'end') {
      callbacks.onNodeEnter?.(current)
      callbacks.onNodeExit?.(current, 'success')
      return { status: 'success' }
    }

    const processingNode = current
    callbacks.onNodeEnter?.(processingNode)
    try {
      if (processingNode.type === 'agent') {
        await runAgent(processingNode, ctx, callbacks)
        callbacks.onNodeExit?.(processingNode, 'success')
        current = nextNode(ctx.workflow, processingNode.id)
      } else if (processingNode.type === 'router') {
        const handle = await runRouter(processingNode, ctx)
        const ruleLabel =
          (processingNode.data as RouterNodeData).rules.find((r) => r.id === handle)?.label ??
          'default'
        callbacks.onNodeExit?.(processingNode, 'success', `chose "${ruleLabel}"`)
        current = nextNodeForHandle(ctx.workflow, processingNode.id, handle)
      } else {
        current = nextNode(ctx.workflow, processingNode.id)
      }
    } catch (err) {
      const message =
        err instanceof AzureOpenAIError || err instanceof Error ? err.message : 'Unknown error.'
      callbacks.onNodeExit?.(processingNode, 'error', message)
      return { status: 'error', error: message }
    }
  }

  return { status: 'error', error: 'The path ended without reaching an End node.' }
}
