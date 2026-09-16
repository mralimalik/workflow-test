import { MessageSquare } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useChatRunner } from '@/features/chat-tester/hooks/useChatRunner'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { ChatComposer } from './ChatComposer'
import { MessageBubble } from './MessageBubble'

export function ChatWindow() {
  const { messages, isRunning, send, reset } = useChatRunner()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
          {messages.length === 0 && (
            <div className="mt-16 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
              <MessageSquare className="size-6" />
              Send a message to run your workflow from the Start node.
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <ChatComposer isRunning={isRunning} onSend={send} onReset={reset} />
    </div>
  )
}
