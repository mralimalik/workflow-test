import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { useCanvasStore } from '@/entities/workflow/model/canvasStore'
import { nodeTypes } from '@/features/workflow-builder/components/nodes/nodeTypes'
import { toRFEdges, toRFNodes } from '@/features/workflow-builder/lib/reactflow-adapters'

function WorkflowPreviewInner() {
  const nodes = useCanvasStore((state) => state.nodes)
  const edges = useCanvasStore((state) => state.edges)

  return (
    <ReactFlow
      nodes={toRFNodes(nodes)}
      edges={toRFEdges(edges)}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnScroll
      fitView
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export function WorkflowPreview() {
  return (
    <ReactFlowProvider>
      <WorkflowPreviewInner />
    </ReactFlowProvider>
  )
}
