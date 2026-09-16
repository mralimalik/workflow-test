import { Handle, type NodeProps, Position } from '@xyflow/react'
import { GitFork } from 'lucide-react'
import { ROUTER_DEFAULT_HANDLE } from '@/entities/workflow/model/types'
import type { RFNode } from '@/features/workflow-builder/lib/reactflow-adapters'
import { BaseNodeShell } from './BaseNodeShell'

export function RouterNode({ id, data, selected }: NodeProps<RFNode>) {
  if (data.kind !== 'router') return null

  const handles = [
    ...data.rules.map((rule) => ({ id: rule.id, label: rule.label })),
    { id: ROUTER_DEFAULT_HANDLE, label: 'Default' },
  ]

  return (
    <BaseNodeShell
      id={id}
      icon={GitFork}
      colorVar="--color-node-router"
      title={data.label}
      subtitle={data.mode === 'llm' ? 'LLM decides the branch' : 'First matching rule'}
      selected={selected}
      showSource={false}
    >
      <div className="space-y-1">
        {handles.map((handle) => (
          <div
            key={handle.id}
            className="flex items-center justify-end gap-1.5 rounded border border-border/60 bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground"
          >
            <span className="truncate">{handle.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={handle.id}
              className="!static !size-2.5 !translate-y-0 !border-2 !border-background"
              style={{ background: 'var(--color-node-router)' }}
            />
          </div>
        ))}
      </div>
    </BaseNodeShell>
  )
}
