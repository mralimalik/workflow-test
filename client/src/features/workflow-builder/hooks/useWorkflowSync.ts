import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useCanvasStore } from '@/entities/workflow/model/canvasStore'
import { workflowRepository } from '@/shared/api/workflowRepository'

export const workflowQueryKey = ['workflow', 'current'] as const

/**
 * Loads the persisted workflow into the canvas store once, then autosaves
 * (debounced) whenever the store gets marked dirty by an edit.
 */
export function useWorkflowSync() {
  const loadWorkflow = useCanvasStore((state) => state.loadWorkflow)
  const markSaved = useCanvasStore((state) => state.markSaved)
  const dirty = useCanvasStore((state) => state.dirty)
  const nodes = useCanvasStore((state) => state.nodes)
  const edges = useCanvasStore((state) => state.edges)
  const name = useCanvasStore((state) => state.name)
  const description = useCanvasStore((state) => state.description)
  const getSnapshot = useCanvasStore((state) => state.getSnapshot)
  const queryClient = useQueryClient()
  const hydrated = useRef(false)

  const query = useQuery({
    queryKey: workflowQueryKey,
    queryFn: workflowRepository.getCurrent,
  })

  const saveMutation = useMutation({
    mutationFn: workflowRepository.saveCurrent,
    onSuccess: (saved) => {
      queryClient.setQueryData(workflowQueryKey, saved)
      markSaved()
    },
    onError: () => {
      toast.error('Could not save the workflow')
    },
  })

  useEffect(() => {
    if (query.data && !hydrated.current) {
      loadWorkflow(query.data)
      hydrated.current = true
    }
  }, [query.data, loadWorkflow])

  const saveMutationRef = useRef(saveMutation)
  useEffect(() => {
    saveMutationRef.current = saveMutation
  })

  useEffect(() => {
    if (!hydrated.current || !dirty) return
    const timeout = setTimeout(() => {
      saveMutationRef.current.mutate(getSnapshot())
    }, 600)
    return () => clearTimeout(timeout)
  }, [dirty, nodes, edges, name, description, getSnapshot])

  return {
    isLoading: query.isLoading,
    isSaving: saveMutation.isPending,
    dirty,
    saveNow: () => saveMutationRef.current.mutate(getSnapshot()),
  }
}

export function useResetWorkflow() {
  const loadWorkflow = useCanvasStore((state) => state.loadWorkflow)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: workflowRepository.reset,
    onSuccess: (fresh) => {
      queryClient.setQueryData(workflowQueryKey, fresh)
      loadWorkflow(fresh)
      toast.success('Workflow reset')
    },
  })
}
