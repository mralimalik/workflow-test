import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCanvasStore } from '@/entities/workflow/model/canvasStore'
import { validateWorkflow } from '@/entities/workflow/lib/validateWorkflow'
import { useResetWorkflow } from '@/features/workflow-builder/hooks/useWorkflowSync'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui/tooltip'

export function WorkflowToolbar({ isSaving }: { isSaving: boolean }) {
  const name = useCanvasStore((state) => state.name)
  const setMeta = useCanvasStore((state) => state.setMeta)
  const nodes = useCanvasStore((state) => state.nodes)
  const edges = useCanvasStore((state) => state.edges)
  const [editingName, setEditingName] = useState(false)
  const resetWorkflow = useResetWorkflow()

  const issues = useMemo(() => validateWorkflow({ nodes, edges }), [nodes, edges])
  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
      <div className="flex items-center gap-3">
        {editingName ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setMeta({ name: e.target.value })}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
            className="h-7 w-56 text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="rounded px-1.5 py-0.5 text-sm font-medium hover:bg-accent"
          >
            {name || 'Untitled workflow'}
          </button>
        )}

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {isSaving ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <CheckCircle2 className="size-3" /> Saved
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {issues.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex cursor-default items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                <AlertTriangle className="size-3.5 text-amber-500" />
                {errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : `${warningCount} warning${warningCount > 1 ? 's' : ''}`}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <ul className="space-y-1">
                {issues.slice(0, 6).map((issue, i) => (
                  <li key={i}>
                    {issue.severity === 'error' ? '⛔' : '⚠️'} {issue.message}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
        {issues.length === 0 && nodes.length > 0 && (
          <div className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-emerald-500">
            <CheckCircle2 className="size-3.5" />
            Ready
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (confirm('Reset the workflow to a blank single-agent template?')) {
              resetWorkflow.mutate()
            }
          }}
        >
          <RotateCcw />
          Reset
        </Button>
      </div>
    </div>
  )
}
