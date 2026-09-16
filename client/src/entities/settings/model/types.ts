export interface AzureOpenAISettings {
  /** e.g. https://my-resource.openai.azure.com */
  endpoint: string
  apiKey: string
  /** Default deployment name, used when an agent node doesn't override it. */
  deploymentId: string
  apiVersion: string
}

export function createEmptyAzureSettings(): AzureOpenAISettings {
  return {
    endpoint: '',
    apiKey: '',
    deploymentId: '',
    apiVersion: '2024-08-01-preview',
  }
}

export function isAzureSettingsConfigured(settings: AzureOpenAISettings): boolean {
  return Boolean(settings.endpoint && settings.apiKey && settings.deploymentId)
}
