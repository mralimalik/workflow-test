import { create } from 'zustand'
import { createId } from '@/shared/lib/id'
import type { Workflow, WorkflowEdge, WorkflowNode, WorkflowNodeData } from './types'

interface CanvasState {
  workflowId: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  selectedNodeId: string | null
  dirty: boolean
  createdAt: string

  loadWorkflow: (workflow: Workflow) => void
  setMeta: (meta: Partial<Pick<CanvasState, 'name' | 'description'>>) => void
  setNodes: (updater: WorkflowNode[] | ((nodes: WorkflowNode[]) => WorkflowNode[])) => void
  setEdges: (updater: WorkflowEdge[] | ((edges: WorkflowEdge[]) => WorkflowEdge[])) => void
  addNode: (node: WorkflowNode) => void
  updateNodeData: <T extends WorkflowNodeData>(nodeId: string, patch: Partial<T>) => void
  removeNode: (nodeId: string) => void
  removeEdge: (edgeId: string) => void
  setSelectedNode: (nodeId: string | null) => void
  getSnapshot: () => Workflow
  markSaved: () => void
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  workflowId: createId('workflow'),
  name: 'My workflow',
  description: '',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  dirty: false,
  createdAt: new Date().toISOString(),

  loadWorkflow: (workflow) =>
    set({
      workflowId: workflow.id,
      name: workflow.name,
      description: workflow.description,
      nodes: workflow.nodes,
      edges: workflow.edges,
      createdAt: workflow.createdAt,
      selectedNodeId: null,
      dirty: false,
    }),

  setMeta: (meta) => set((state) => ({ ...state, ...meta, dirty: true })),

  setNodes: (updater) =>
    set((state) => {
      const nextNodes = typeof updater === 'function' ? updater(state.nodes) : updater
      if (nextNodes === state.nodes) return state
      return { nodes: nextNodes, dirty: true }
    }),

  setEdges: (updater) =>
    set((state) => {
      const nextEdges = typeof updater === 'function' ? updater(state.edges) : updater
      if (nextEdges === state.edges) return state
      return { edges: nextEdges, dirty: true }
    }),

  addNode: (node) => set((state) => ({ nodes: [...state.nodes, node], dirty: true })),

  updateNodeData: (nodeId, patch) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
      dirty: true,
    })),

  removeNode: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      dirty: true,
    })),

  removeEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
      dirty: true,
    })),

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  getSnapshot: () => {
    const state = get()
    return {
      id: state.workflowId,
      name: state.name,
      description: state.description,
      nodes: state.nodes,
      edges: state.edges,
      createdAt: state.createdAt,
      updatedAt: new Date().toISOString(),
    }
  },

  markSaved: () => set({ dirty: false }),
}))
