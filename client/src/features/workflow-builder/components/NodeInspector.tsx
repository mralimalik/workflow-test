import { FlagTriangleRight, MousePointerClick, Rocket, Trash2 } from 'lucide-react'
import { useCanvasStore } from '@/entities/workflow/model/canvasStore'
import type {
  AgentNodeData,
  EndNodeData,
  RouterNodeData,
  StartNodeData,
} from '@/entities/workflow/model/types'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Separator } from '@/shared/ui/separator'
import { AgentInspectorPanel } from './panels/AgentInspectorPanel'
import { RouterInspectorPanel } from './panels/RouterInspectorPanel'

function SimpleInspectorPanel({
  icon: Icon,
  colorVar,
  title,
  nodeId,
  label,
  canDelete,
}: {
  icon: typeof Rocket
  colorVar: string
  title: string
  nodeId: string
  label: string
  canDelete: boolean
}) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const removeNode = useCanvasStore((state) => state.removeNode)

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4" style={{ color: `var(${colorVar})` }} />
        {title}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="node-label">Name</Label>
        <Input
          id="node-label"
          value={label}
          onChange={(e) => updateNodeData(nodeId, { label: e.target.value })}
        />
      </div>
      {canDelete && (
        <>
          <Separator />
          <Button variant="destructive" size="sm" onClick={() => removeNode(nodeId)} className="w-full">
            <Trash2 />
            Delete node
          </Button>
        </>
      )}
    </div>
  )
}

export function NodeInspector() {
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId)
  const nodes = useCanvasStore((state) => state.nodes)
  const node = nodes.find((n) => n.id === selectedNodeId)

  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <MousePointerClick className="size-6" />
        Select a node to configure it.
      </div>
    )
  }

  switch (node.data.kind) {
    case 'agent':
      return <AgentInspectorPanel node={{ ...node, data: node.data as AgentNodeData }} />
    case 'router':
      return <RouterInspectorPanel node={{ ...node, data: node.data as RouterNodeData }} />
    case 'start':
      return (
        <SimpleInspectorPanel
          icon={Rocket}
          colorVar="--color-node-start"
          title="Start"
          nodeId={node.id}
          label={(node.data as StartNodeData).label}
          canDelete={false}
        />
      )
    case 'end':
      return (
        <SimpleInspectorPanel
          icon={FlagTriangleRight}
          colorVar="--color-node-end"
          title="End"
          nodeId={node.id}
          label={(node.data as EndNodeData).label}
          canDelete
        />
      )
  }
}
