import type { NodeProps } from '@xyflow/react'
import { FlagTriangleRight } from 'lucide-react'
import type { RFNode } from '@/features/workflow-builder/lib/reactflow-adapters'
import { BaseNodeShell } from './BaseNodeShell'

export function EndNode({ id, data, selected }: NodeProps<RFNode>) {
  if (data.kind !== 'end') return null
  return (
    <BaseNodeShell
      id={id}
      icon={FlagTriangleRight}
      colorVar="--color-node-end"
      title={data.label}
      subtitle="Returns the final answer"
      selected={selected}
      showSource={false}
    />
  )
}
