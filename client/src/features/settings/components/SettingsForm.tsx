import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AzureOpenAISettings } from '@/entities/settings/model/types'
import { useAzureSettings, useSaveAzureSettings } from '@/features/settings/hooks/useSettings'
import { AzureOpenAIError, createAzureChatCompletion } from '@/shared/lib/azureOpenAI/client'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

export function SettingsForm() {
  const { data: settings, isLoading } = useAzureSettings()
  const saveSettings = useSaveAzureSettings()
  const [form, setForm] = useState<AzureOpenAISettings | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')

  useEffect(() => {
    if (settings && !form) setForm(settings)
  }, [settings, form])

  if (isLoading || !form) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  const handleTest = async () => {
    setTestState('testing')
    setTestMessage('')
    try {
      await createAzureChatCompletion(form, undefined, {
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 5,
      })
      setTestState('ok')
    } catch (err) {
      setTestState('error')
      setTestMessage(err instanceof AzureOpenAIError ? err.message : 'Unknown error')
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Azure OpenAI</CardTitle>
        <CardDescription>
          Used by the chat tester to actually run your workflow. Stored only in this browser's
          localStorage — it is sent to Azure and nowhere else.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="azure-endpoint">Endpoint</Label>
          <Input
            id="azure-endpoint"
            value={form.endpoint}
            onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
            placeholder="https://my-resource.openai.azure.com"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="azure-key">API key</Label>
          <div className="relative">
            <Input
              id="azure-key"
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="azure-deployment">Default deployment</Label>
            <Input
              id="azure-deployment"
              value={form.deploymentId}
              onChange={(e) => setForm({ ...form, deploymentId: e.target.value })}
              placeholder="gpt-4o"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="azure-version">API version</Label>
            <Input
              id="azure-version"
              value={form.apiVersion}
              onChange={(e) => setForm({ ...form, apiVersion: e.target.value })}
            />
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Agents use this deployment unless they set their own in the node inspector. If the test
          below fails with a network error, enable CORS for this origin on your Azure OpenAI
          resource (Azure Portal → your resource → Resource Management → CORS).
        </p>

        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={() => saveSettings.mutate(form)}
            disabled={saveSettings.isPending}
          >
            {saveSettings.isPending && <Loader2 className="animate-spin" />}
            Save
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testState === 'testing'}>
            {testState === 'testing' && <Loader2 className="animate-spin" />}
            Test connection
          </Button>
          {testState === 'ok' && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 className="size-3.5" /> Connected
            </span>
          )}
          {testState === 'error' && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <XCircle className="size-3.5" /> {testMessage}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
