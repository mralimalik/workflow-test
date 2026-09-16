import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Tool } from '@/entities/tool/model/types'
import { toolRepository } from '@/shared/api/toolRepository'

export const toolsQueryKey = ['tools'] as const

export function useTools() {
  return useQuery({
    queryKey: toolsQueryKey,
    queryFn: toolRepository.list,
  })
}

export function useSaveTool() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tool: Tool) => {
      const existing = await toolRepository.get(tool.id)
      return existing ? toolRepository.update(tool) : toolRepository.create(tool)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: toolsQueryKey })
      toast.success('Tool saved')
    },
    onError: () => toast.error('Could not save the tool'),
  })
}

export function useDeleteTool() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => toolRepository.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: toolsQueryKey })
      toast.success('Tool deleted')
    },
  })
}
