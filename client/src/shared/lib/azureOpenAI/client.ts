import type { AzureOpenAISettings } from '@/entities/settings/model/types'
import type { AzureChatCompletionRequest, AzureChatCompletionResponse } from './types'

export class AzureOpenAIError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AzureOpenAIError'
    this.status = status
  }
}

/**
 * Calls the Azure OpenAI Chat Completions REST API directly from the browser.
 * This is deliberately client-only for now (no backend yet) — the API key
 * lives in localStorage and is sent straight to your own Azure resource.
 * If your Azure resource blocks browser origins you'll see a network error;
 * enabling CORS on the resource (or later, proxying through the real
 * backend) fixes that.
 */
export async function createAzureChatCompletion(
  settings: AzureOpenAISettings,
  deploymentOverride: string | undefined,
  request: AzureChatCompletionRequest,
): Promise<AzureChatCompletionResponse> {
  const deployment = deploymentOverride?.trim() || settings.deploymentId
  if (!settings.endpoint || !settings.apiKey || !deployment) {
    throw new AzureOpenAIError(
      'Azure OpenAI is not configured. Add your endpoint, API key and deployment in Settings.',
    )
  }

  const base = settings.endpoint.replace(/\/+$/, '')
  const url = `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(settings.apiVersion)}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': settings.apiKey,
      },
      body: JSON.stringify(request),
    })
  } catch {
    throw new AzureOpenAIError(
      'Network error calling Azure OpenAI. Check the endpoint, and that CORS is enabled for this origin on your Azure OpenAI resource.',
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new AzureOpenAIError(
      `Azure OpenAI request failed (${response.status}): ${text.slice(0, 300)}`,
      response.status,
    )
  }

  return (await response.json()) as AzureChatCompletionResponse
}
