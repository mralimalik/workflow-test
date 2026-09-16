import type { Edge, Node } from '@xyflow/react'
import type {
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeData,
  WorkflowNodeKind,
} from '@/entities/workflow/model/types'

export type RFNode = Node<WorkflowNodeData, WorkflowNodeKind>
export type RFEdge = Edge

export function toRFNodes(nodes: WorkflowNode[]): RFNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: node.data,
  }))
}

export function toRFEdges(edges: WorkflowEdge[]): RFEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    label: edge.label,
    type: 'smoothstep',
    animated: false,
  }))
}

/** Merges position/selection changes coming out of React Flow back into domain nodes, keeping `data` untouched. */
export function mergeRFPositions(domainNodes: WorkflowNode[], rfNodes: RFNode[]): WorkflowNode[] {
  const byId = new Map(rfNodes.map((node) => [node.id, node]))
  return domainNodes
    .filter((node) => byId.has(node.id))
    .map((node) => {
      const rf = byId.get(node.id)
      if (!rf) return node
      return { ...node, position: rf.position }
    })
}

export function rfEdgeToDomain(edge: RFEdge): WorkflowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    label: typeof edge.label === 'string' ? edge.label : undefined,
  }
}
