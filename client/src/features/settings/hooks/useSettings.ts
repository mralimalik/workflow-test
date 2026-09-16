import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AzureOpenAISettings } from '@/entities/settings/model/types'
import { settingsRepository } from '@/shared/api/settingsRepository'

export const settingsQueryKey = ['settings', 'azure-openai'] as const

export function useAzureSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: settingsRepository.get,
  })
}

export function useSaveAzureSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (settings: AzureOpenAISettings) => settingsRepository.update(settings),
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsQueryKey, settings)
      toast.success('Settings saved')
    },
  })
}
