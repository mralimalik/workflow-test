import { GitFork, Plus, Trash2, X } from 'lucide-react'
import { useCanvasStore } from '@/entities/workflow/model/canvasStore'
import type { RouterNodeData, WorkflowNode } from '@/entities/workflow/model/types'
import { createId } from '@/shared/lib/id'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Separator } from '@/shared/ui/separator'
import { Textarea } from '@/shared/ui/textarea'

export function RouterInspectorPanel({
  node,
}: {
  node: WorkflowNode & { data: RouterNodeData }
}) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const removeNode = useCanvasStore((state) => state.removeNode)

  const patch = (partial: Partial<RouterNodeData>) => updateNodeData<RouterNodeData>(node.id, partial)

  const addRule = () => {
    patch({
      rules: [
        ...node.data.rules,
        { id: createId('rule'), label: `Branch ${node.data.rules.length + 1}`, description: '' },
      ],
    })
  }

  const updateRule = (ruleId: string, partial: { label?: string; description?: string }) => {
    patch({
      rules: node.data.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...partial } : rule)),
    })
  }

  const removeRule = (ruleId: string) => {
    patch({ rules: node.data.rules.filter((rule) => rule.id !== ruleId) })
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GitFork className="size-4 text-[var(--color-node-router)]" />
          Router
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="router-label">Name</Label>
          <Input
            id="router-label"
            value={node.data.label}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Routing mode</Label>
          <Select value={node.data.mode} onValueChange={(mode) => patch({ mode: mode as RouterNodeData['mode'] })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="llm">LLM decides</SelectItem>
              <SelectItem value="first-match">First keyword match</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {node.data.mode === 'llm' ? (
          <div className="space-y-1.5">
            <Label htmlFor="router-instructions">Routing instructions</Label>
            <Textarea
              id="router-instructions"
              rows={3}
              value={node.data.instructions}
              onChange={(e) => patch({ instructions: e.target.value })}
              placeholder="Explain how to choose between the branches below."
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Each rule below matches keywords against the latest user message; the first rule that
            matches wins, otherwise the Default branch runs.
          </p>
        )}

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Branches
            </p>
            <Button variant="outline" size="sm" onClick={addRule}>
              <Plus />
              Rule
            </Button>
          </div>

          {node.data.rules.map((rule) => (
            <div key={rule.id} className="space-y-2 rounded-md border border-border p-2.5">
              <div className="flex items-center gap-2">
                <Input
                  value={rule.label}
                  onChange={(e) => updateRule(rule.id, { label: e.target.value })}
                  className="h-7 text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => removeRule(rule.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              <Textarea
                rows={2}
                value={rule.description}
                onChange={(e) => updateRule(rule.id, { description: e.target.value })}
                placeholder={
                  node.data.mode === 'llm'
                    ? 'When should this branch be picked?'
                    : 'comma, separated, keywords'
                }
                className="text-xs"
              />
            </div>
          ))}

          <div className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
            Default branch — always available as a fallback. Connect it on the canvas.
          </div>
        </div>

        <Separator />

        <Button variant="destructive" size="sm" onClick={() => removeNode(node.id)} className="w-full">
          <Trash2 />
          Delete node
        </Button>
      </div>
    </ScrollArea>
  )
}
