import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { ChatMessage } from '@/entities/chat/model/types'
import { cn } from '@/shared/lib/utils'

function ToolCallChip({ name, args }: { name: string; args: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="flex w-full items-start gap-1.5 rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-left text-[11px] text-muted-foreground"
    >
      {open ? <ChevronDown className="mt-0.5 size-3 shrink-0" /> : <ChevronRight className="mt-0.5 size-3 shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 font-mono">
          <Wrench className="size-3" />
          {name}(…)
        </span>
        {open && (
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">
            {JSON.stringify(args, null, 2)}
          </pre>
        )}
      </span>
    </button>
  )
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'system') {
    return (
      <div className="mx-auto max-w-md rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-center text-xs text-muted-foreground">
        {message.content}
      </div>
    )
  }

  if (message.role === 'tool') {
    return (
      <div className="ml-6 max-w-[85%] space-y-1">
        <div className="rounded-md border border-border bg-secondary/30 px-2.5 py-1.5 text-[11px]">
          <div className="mb-1 flex items-center gap-1 font-mono text-muted-foreground">
            <Wrench className="size-3" /> {message.toolName} result
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono">{message.content}</pre>
        </div>
      </div>
    )
  }

  const isUser = message.role === 'user'

  return (
    <div className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      {!isUser && message.nodeLabel && (
        <span className="px-0.5 text-[11px] font-medium text-muted-foreground">{message.nodeLabel}</span>
      )}
      {message.content && (
        <div
          className={cn(
            'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
            isUser ? 'bg-primary text-primary-foreground' : 'bg-card border border-border',
          )}
        >
          {message.content}
        </div>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="w-full max-w-[85%] space-y-1">
          {message.toolCalls.map((call) => (
            <ToolCallChip key={call.id} name={call.name} args={call.arguments} />
          ))}
        </div>
      )}
    </div>
  )
}
