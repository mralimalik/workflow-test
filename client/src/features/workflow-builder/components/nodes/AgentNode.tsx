import type { NodeProps } from '@xyflow/react'
import { Bot, Wrench } from 'lucide-react'
import { useTools } from '@/features/tools/hooks/useTools'
import type { RFNode } from '@/features/workflow-builder/lib/reactflow-adapters'
import { BaseNodeShell } from './BaseNodeShell'

export function AgentNode({ id, data, selected }: NodeProps<RFNode>) {
  const { data: tools } = useTools()
  if (data.kind !== 'agent') return null

  const toolNames = (tools ?? [])
    .filter((tool) => data.toolIds.includes(tool.id))
    .map((tool) => tool.name)

  return (
    <BaseNodeShell
      id={id}
      icon={Bot}
      colorVar="--color-node-agent"
      title={data.label}
      subtitle={data.model.deploymentId || 'default deployment'}
      selected={selected}
    >
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {data.systemPrompt || 'No instructions yet.'}
      </p>
      {toolNames.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <Wrench className="size-3" />
          {toolNames.slice(0, 3).join(', ')}
          {toolNames.length > 3 ? ` +${toolNames.length - 3}` : ''}
        </div>
      )}
    </BaseNodeShell>
  )
}
