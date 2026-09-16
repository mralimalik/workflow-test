import type { Workflow, WorkflowValidationIssue } from '@/entities/workflow/model/types'
import { outgoingEdges, reachableNodeIds } from './graph'

export function validateWorkflow(
  workflow: Pick<Workflow, 'nodes' | 'edges'>,
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []

  const startNodes = workflow.nodes.filter((node) => node.type === 'start')
  if (startNodes.length === 0) {
    issues.push({ severity: 'error', message: 'The workflow needs a Start node.' })
  } else if (startNodes.length > 1) {
    issues.push({ severity: 'error', message: 'Only one Start node is allowed.' })
  }

  const endNodes = workflow.nodes.filter((node) => node.type === 'end')
  if (endNodes.length === 0) {
    issues.push({ severity: 'error', message: 'The workflow needs at least one End node.' })
  }

  const reachable = reachableNodeIds(workflow)

  for (const node of workflow.nodes) {
    if (node.type === 'start') continue
    if (!reachable.has(node.id)) {
      issues.push({
        severity: 'warning',
        message: `"${node.data.label}" isn't connected to Start, so it will never run.`,
        nodeId: node.id,
      })
    }
  }

  const reachesEnd = (() => {
    const endIds = new Set(endNodes.map((n) => n.id))
    for (const id of endIds) {
      if (reachable.has(id)) return true
    }
    return false
  })()
  if (startNodes.length > 0 && endNodes.length > 0 && !reachesEnd) {
    issues.push({
      severity: 'error',
      message: 'No path connects Start to an End node.',
    })
  }

  for (const node of workflow.nodes) {
    if (node.type === 'agent') {
      const out = outgoingEdges(workflow, node.id)
      if (out.length === 0) {
        issues.push({
          severity: 'error',
          message: `Agent "${node.data.label}" has no outgoing connection.`,
          nodeId: node.id,
        })
      } else if (out.length > 1) {
        issues.push({
          severity: 'error',
          message: `Agent "${node.data.label}" has more than one outgoing connection.`,
          nodeId: node.id,
        })
      }
      if (node.data.kind === 'agent' && !node.data.systemPrompt.trim()) {
        issues.push({
          severity: 'warning',
          message: `Agent "${node.data.label}" has no instructions.`,
          nodeId: node.id,
        })
      }
    }

    if (node.type === 'router' && node.data.kind === 'router') {
      const out = outgoingEdges(workflow, node.id)
      const hasDefault = out.some((edge) => (edge.sourceHandle ?? 'default') === 'default')
      if (!hasDefault) {
        issues.push({
          severity: 'error',
          message: `Router "${node.data.label}" needs a default branch connected.`,
          nodeId: node.id,
        })
      }
      for (const rule of node.data.rules) {
        const connected = out.some((edge) => edge.sourceHandle === rule.id)
        if (!connected) {
          issues.push({
            severity: 'warning',
            message: `Router "${node.data.label}" rule "${rule.label}" isn't connected to a branch.`,
            nodeId: node.id,
          })
        }
      }
    }

    if (node.type === 'start') {
      const out = outgoingEdges(workflow, node.id)
      if (out.length === 0) {
        issues.push({ severity: 'error', message: 'Start node is not connected to anything.' })
      }
    }
  }

  return issues
}
