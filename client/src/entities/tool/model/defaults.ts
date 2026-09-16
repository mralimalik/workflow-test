import { createId } from '@/shared/lib/id'
import type { Tool } from './types'

export function createEmptyTool(executionType: Tool['executionType'] = 'client'): Tool {
  const now = new Date().toISOString()
  return {
    id: createId('tool'),
    name: 'new_tool',
    description: 'Describe what this tool does and when the agent should call it.',
    executionType,
    parameters: [],
    clientHandlerCode:
      executionType === 'client'
        ? '// `args` holds the parsed arguments the model called this tool with.\n// Return the value (or a Promise) that should be sent back to the agent.\nreturn { ok: true }'
        : '',
    serverActionNote:
      executionType === 'server'
        ? 'Describe the server-side action this tool will perform once the backend exists.'
        : '',
    createdAt: now,
    updatedAt: now,
  }
}
