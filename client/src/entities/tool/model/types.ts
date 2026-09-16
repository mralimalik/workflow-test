export type ToolExecutionType = 'server' | 'client'

export type JsonSchemaPropertyType = 'string' | 'number' | 'boolean' | 'array' | 'object'

export interface ToolParameter {
  name: string
  type: JsonSchemaPropertyType
  description: string
  required: boolean
  enumValues?: string[]
}

export interface Tool {
  id: string
  name: string
  description: string
  executionType: ToolExecutionType
  parameters: ToolParameter[]
  /**
   * Client tools only: JS function body executed in the browser.
   * Receives `args` (parsed tool arguments) and may return a value or a Promise.
   * Example: `return { result: args.a + args.b }`
   */
  clientHandlerCode: string
  /** Server tools only: describes what the (future) backend would do — informational in the client-only phase. */
  serverActionNote: string
  createdAt: string
  updatedAt: string
}

/** Converts a Tool's parameter list into the JSON schema shape OpenAI/Azure function-calling expects. */
export function toolParametersToJsonSchema(parameters: ToolParameter[]) {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const param of parameters) {
    const prop: Record<string, unknown> = {
      type: param.type,
      description: param.description,
    }
    if (param.enumValues && param.enumValues.length > 0) {
      prop.enum = param.enumValues
    }
    properties[param.name] = prop
    if (param.required) required.push(param.name)
  }

  return {
    type: 'object' as const,
    properties,
    required,
  }
}
