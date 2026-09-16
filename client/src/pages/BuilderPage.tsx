import { Loader2 } from 'lucide-react'
import { NodeInspector } from '@/features/workflow-builder/components/NodeInspector'
import { NodePalette } from '@/features/workflow-builder/components/NodePalette'
import { WorkflowCanvas } from '@/features/workflow-builder/components/WorkflowCanvas'
import { WorkflowToolbar } from '@/features/workflow-builder/components/WorkflowToolbar'
import { useWorkflowSync } from '@/features/workflow-builder/hooks/useWorkflowSync'

export function BuilderPage() {
  const { isLoading, isSaving } = useWorkflowSync()

  if (isLoading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <WorkflowToolbar isSaving={isSaving} />
      <div className="flex min-h-0 flex-1">
        <NodePalette />
        <div className="min-w-0 flex-1">
          <WorkflowCanvas />
        </div>
        <div className="w-80 shrink-0 border-l border-border">
          <NodeInspector />
        </div>
      </div>
    </div>
  )
}
