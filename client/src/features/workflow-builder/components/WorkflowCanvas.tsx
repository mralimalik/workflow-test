import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react'
import { useCallback } from 'react'
import { useCanvasStore } from '@/entities/workflow/model/canvasStore'
import { createWorkflowNode } from '@/entities/workflow/model/defaults'
import type { WorkflowEdge, WorkflowNodeKind } from '@/entities/workflow/model/types'
import { createId } from '@/shared/lib/id'
import { nodeTypes } from './nodes/nodeTypes'
import {
  mergeRFPositions,
  type RFNode,
  rfEdgeToDomain,
  toRFEdges,
  toRFNodes,
} from '@/features/workflow-builder/lib/reactflow-adapters'

function WorkflowCanvasInner() {
  const nodes = useCanvasStore((state) => state.nodes)
  const edges = useCanvasStore((state) => state.edges)
  const setNodes = useCanvasStore((state) => state.setNodes)
  const setEdges = useCanvasStore((state) => state.setEdges)
  const addNode = useCanvasStore((state) => state.addNode)
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode)
  const { screenToFlowPosition } = useReactFlow()

  const rfNodes = toRFNodes(nodes)
  const rfEdges = toRFEdges(edges)

  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      setNodes((prev) => {
        // 'dimensions' and 'select' changes are React Flow's own measurement/selection
        // bookkeeping, not user edits — our domain model doesn't track either, and feeding
        // them back through toRFNodes() (which strips `measured`) would make React Flow think
        // every node keeps losing its measured size, re-emitting 'dimensions' forever.
        const filtered = changes.filter((change) => {
          if (change.type === 'dimensions' || change.type === 'select') return false
          if (change.type === 'remove') {
            const node = prev.find((n) => n.id === change.id)
            return node?.type !== 'start'
          }
          return true
        })
        if (filtered.length === 0) return prev
        const nextRF = applyNodeChanges<RFNode>(filtered, toRFNodes(prev))
        return mergeRFPositions(prev, nextRF)
      })
    },
    [setNodes],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const meaningful = changes.filter((change) => change.type !== 'select')
      if (meaningful.length === 0) return
      setEdges((prev) => applyEdgeChanges(meaningful, toRFEdges(prev)).map(rfEdgeToDomain))
    },
    [setEdges],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      if (connection.source === connection.target) return
      const sourceNode = nodes.find((n) => n.id === connection.source)
      if (!sourceNode) return

      const newEdge: WorkflowEdge = {
        id: createId('edge'),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
      }

      setEdges((prev) => {
        const withoutClashing = prev.filter((edge) => {
          if (edge.source !== connection.source) return true
          if (sourceNode.type === 'router') {
            return edge.sourceHandle !== connection.sourceHandle
          }
          return false
        })
        return [...withoutClashing, newEdge]
      })
    },
    [nodes, setEdges],
  )

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const kind = event.dataTransfer.getData('application/reactflow') as WorkflowNodeKind
      if (!kind) return
      if (kind === 'start' && nodes.some((n) => n.type === 'start')) return

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      addNode(createWorkflowNode(kind, position))
    },
    [nodes, addNode, screenToFlowPosition],
  )

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onNodeClick={(_, node) => setSelectedNode(node.id)}
      onPaneClick={() => setSelectedNode(null)}
      deleteKeyCode={['Backspace', 'Delete']}
      fitView
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        className="!bg-card"
        maskColor="rgba(0,0,0,0.6)"
      />
    </ReactFlow>
  )
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  )
}
