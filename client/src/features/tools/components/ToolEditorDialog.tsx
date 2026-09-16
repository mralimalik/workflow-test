import { useEffect, useState } from 'react'
import { createEmptyTool } from '@/entities/tool/model/defaults'
import type { Tool, ToolExecutionType } from '@/entities/tool/model/types'
import { useSaveTool } from '@/features/tools/hooks/useTools'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { Textarea } from '@/shared/ui/textarea'
import { ToolParametersEditor } from './ToolParametersEditor'

export function ToolEditorDialog({
  tool,
  open,
  onOpenChange,
}: {
  tool: Tool | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState<Tool>(() => tool ?? createEmptyTool())
  const saveTool = useSaveTool()

  useEffect(() => {
    if (open) setForm(tool ?? createEmptyTool())
  }, [open, tool])

  const setExecutionType = (executionType: ToolExecutionType) => {
    setForm((prev) => ({ ...prev, executionType }))
  }

  const handleSubmit = () => {
    if (!form.name.trim()) return
    saveTool.mutate(form, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{tool ? 'Edit tool' : 'New tool'}</DialogTitle>
          <DialogDescription>
            Tools are functions an agent can call. Server tools describe an action the future
            backend will run; client tools execute right here in the browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tool-name">Function name</Label>
              <Input
                id="tool-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="get_weather"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Execution</Label>
              <Tabs value={form.executionType} onValueChange={(v) => setExecutionType(v as ToolExecutionType)}>
                <TabsList className="w-full">
                  <TabsTrigger value="client">Client-side</TabsTrigger>
                  <TabsTrigger value="server">Server-side</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tool-description">Description (tells the model when to use it)</Label>
            <Textarea
              id="tool-description"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Parameters</Label>
            <ToolParametersEditor
              parameters={form.parameters}
              onChange={(parameters) => setForm((p) => ({ ...p, parameters }))}
            />
          </div>

          {form.executionType === 'client' ? (
            <div className="space-y-1.5">
              <Label htmlFor="tool-handler">Client handler (JavaScript)</Label>
              <Textarea
                id="tool-handler"
                rows={6}
                value={form.clientHandlerCode}
                onChange={(e) => setForm((p) => ({ ...p, clientHandlerCode: e.target.value }))}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Runs in the browser when the agent calls this tool. Receives <code>args</code>,
                may <code>return</code> a value or a Promise — the result is sent back to the
                agent so it can continue.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="tool-server-note">What should the server do?</Label>
              <Textarea
                id="tool-server-note"
                rows={4}
                value={form.serverActionNote}
                onChange={(e) => setForm((p) => ({ ...p, serverActionNote: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                No backend yet — this is a spec for the Express/Mongo endpoint that will execute
                this tool later. The chat tester will show this call without a real result.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saveTool.isPending}>
            Save tool
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
