import { SettingsForm } from '@/features/settings/components/SettingsForm'

export function SettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Connect the LLM backing your agents.
          </p>
        </div>
        <SettingsForm />
      </div>
    </div>
  )
}
