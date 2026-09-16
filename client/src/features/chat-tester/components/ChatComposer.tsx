import { Loader2, RotateCcw, Send } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'

export function ChatComposer({
  isRunning,
  onSend,
  onReset,
}: {
  isRunning: boolean
  onSend: (text: string) => void
  onReset: () => void
}) {
  const [value, setValue] = useState('')

  const submit = () => {
    if (!value.trim() || isRunning) return
    onSend(value)
    setValue('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <Button variant="ghost" size="icon" onClick={onReset} title="Clear conversation">
        <RotateCcw className="size-4" />
      </Button>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message your workflow…"
        rows={1}
        className="max-h-40 flex-1 resize-none"
      />
      <Button onClick={submit} disabled={isRunning || !value.trim()}>
        {isRunning ? <Loader2 className="animate-spin" /> : <Send />}
        Send
      </Button>
    </div>
  )
}
