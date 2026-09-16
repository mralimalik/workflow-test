import { Loader2 } from 'lucide-react'
import { ChatWindow } from '@/features/chat-tester/components/ChatWindow'
import { RunTrace } from '@/features/chat-tester/components/RunTrace'
import { WorkflowPreview } from '@/features/chat-tester/components/WorkflowPreview'
import { useWorkflowSync } from '@/features/workflow-builder/hooks/useWorkflowSync'

export function ChatPage() {
  const { isLoading } = useWorkflowSync()

  if (isLoading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <div className="flex w-96 shrink-0 flex-col border-r border-border">
        <div className="h-1/2 min-h-40 border-b border-border">
          <WorkflowPreview />
        </div>
        <div className="min-h-0 flex-1">
          <RunTrace />
        </div>
      </div>
      <ChatWindow />
    </div>
  )
}
