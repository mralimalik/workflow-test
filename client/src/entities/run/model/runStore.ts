import { create } from 'zustand'
import { createId } from '@/shared/lib/id'
import type { RunStatus, RunStep, RunStepStatus } from '@/entities/chat/model/types'

interface RunState {
  status: RunStatus
  activeNodeId: string | null
  steps: RunStep[]

  start: () => void
  finish: (status: Extract<RunStatus, 'success' | 'error'>) => void
  reset: () => void
  setActiveNode: (nodeId: string | null) => void
  setStatus: (status: RunStatus) => void
  pushStep: (step: Omit<RunStep, 'id' | 'timestamp'>) => string
  updateStep: (id: string, patch: { status?: RunStepStatus; detail?: string }) => void
}

export const useRunStore = create<RunState>((set) => ({
  status: 'idle',
  activeNodeId: null,
  steps: [],

  start: () => set({ status: 'running', steps: [], activeNodeId: null }),

  finish: (status) => set({ status, activeNodeId: null }),

  reset: () => set({ status: 'idle', activeNodeId: null, steps: [] }),

  setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),

  setStatus: (status) => set({ status }),

  pushStep: (step) => {
    const id = createId('step')
    set((state) => ({
      steps: [...state.steps, { ...step, id, timestamp: new Date().toISOString() }],
    }))
    return id
  },

  updateStep: (id, patch) =>
    set((state) => ({
      steps: state.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
    })),
}))
