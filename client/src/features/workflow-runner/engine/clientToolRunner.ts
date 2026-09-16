import type { Tool } from '@/entities/tool/model/types'

/**
 * Executes a client tool's handler code in the browser.
 * The handler body runs inside an async function scoped to a single `args`
 * parameter, so it can `return` a value directly or `await` something async.
 */
export async function executeClientTool(tool: Tool, args: Record<string, unknown>): Promise<unknown> {
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'args',
    `return (async () => { ${tool.clientHandlerCode} })();`,
  ) as (args: Record<string, unknown>) => Promise<unknown>
  return factory(args)
}
