import type { NodeProps } from '@xyflow/react'
import { Rocket } from 'lucide-react'
import type { RFNode } from '@/features/workflow-builder/lib/reactflow-adapters'
import { BaseNodeShell } from './BaseNodeShell'

export function StartNode({ id, data, selected }: NodeProps<RFNode>) {
  if (data.kind !== 'start') return null
  return (
    <BaseNodeShell
      id={id}
      icon={Rocket}
      colorVar="--color-node-start"
      title={data.label}
      subtitle="Entry point"
      selected={selected}
      showTarget={false}
    />
  )
}
