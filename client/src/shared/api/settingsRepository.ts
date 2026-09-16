import { createEmptyAzureSettings } from '@/entities/settings/model/types'
import type { AzureOpenAISettings } from '@/entities/settings/model/types'
import { networkDelay, readJson, writeJson } from './storage'

const STORAGE_KEY = 'settings.azure-openai'

/** Stands in for `/api/settings`. The API key never leaves the browser except to Azure itself. */
export const settingsRepository = {
  async get(): Promise<AzureOpenAISettings> {
    await networkDelay(40)
    return readJson<AzureOpenAISettings>(STORAGE_KEY, createEmptyAzureSettings())
  },

  async update(settings: AzureOpenAISettings): Promise<AzureOpenAISettings> {
    await networkDelay(40)
    writeJson(STORAGE_KEY, settings)
    return settings
  },
}
