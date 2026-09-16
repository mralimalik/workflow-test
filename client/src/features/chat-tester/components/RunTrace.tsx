import { AlertCircle, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { useRunStore } from '@/entities/run/model/runStore'
import { ScrollArea } from '@/shared/ui/scroll-area'

export function RunTrace() {
  const steps = useRunStore((state) => state.steps)
  const status = useRunStore((state) => state.status)

  if (steps.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Node-by-node trace will appear here once you send a message.
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <ol className="space-y-1.5 p-3">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 text-xs">
            {step.status === 'active' && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />}
            {step.status === 'success' && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />}
            {step.status === 'error' && <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
            {step.status === 'pending' && <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0">
              <span className="font-medium">{step.nodeLabel}</span>
              {step.detail && <span className="block text-muted-foreground">{step.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {status === 'error' && (
        <p className="border-t border-border p-3 text-xs text-destructive">Run failed — see above.</p>
      )}
    </ScrollArea>
  )
}
