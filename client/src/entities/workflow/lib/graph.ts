import type { RouterNodeData, Workflow, WorkflowNode } from '@/entities/workflow/model/types'

type GraphLike = Pick<Workflow, 'nodes' | 'edges'>

export function findNode(workflow: GraphLike, nodeId: string): WorkflowNode | undefined {
  return workflow.nodes.find((node) => node.id === nodeId)
}

export function findStartNode(workflow: GraphLike): WorkflowNode | undefined {
  return workflow.nodes.find((node) => node.type === 'start')
}

/** All edges leaving a node. For router nodes this is one per rule plus the default branch. */
export function outgoingEdges(workflow: GraphLike, nodeId: string) {
  return workflow.edges.filter((edge) => edge.source === nodeId)
}

/** Resolves the single next node for start/agent nodes (they only ever have one outgoing edge). */
export function nextNode(workflow: GraphLike, nodeId: string): WorkflowNode | undefined {
  const edge = outgoingEdges(workflow, nodeId)[0]
  if (!edge) return undefined
  return findNode(workflow, edge.target)
}

/** Resolves the next node for a router node given the chosen handle (rule id or 'default'). */
export function nextNodeForHandle(
  workflow: GraphLike,
  nodeId: string,
  handle: string,
): WorkflowNode | undefined {
  const edge = outgoingEdges(workflow, nodeId).find((e) => (e.sourceHandle ?? 'default') === handle)
  if (!edge) return undefined
  return findNode(workflow, edge.target)
}

export function isRouterData(data: WorkflowNode['data']): data is RouterNodeData {
  return data.kind === 'router'
}

/** Nodes reachable from the start node by walking every outgoing edge (all router branches included). */
export function reachableNodeIds(workflow: GraphLike): Set<string> {
  const start = findStartNode(workflow)
  const visited = new Set<string>()
  if (!start) return visited

  const queue = [start.id]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const edge of outgoingEdges(workflow, current)) {
      if (!visited.has(edge.target)) queue.push(edge.target)
    }
  }
  return visited
}
