import { Bot, Trash2 } from 'lucide-react'
import { useCanvasStore } from '@/entities/workflow/model/canvasStore'
import type { AgentNodeData, WorkflowNode } from '@/entities/workflow/model/types'
import { useTools } from '@/features/tools/hooks/useTools'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { ScrollArea } from '@/shared/ui/scroll-area'
import { Separator } from '@/shared/ui/separator'
import { Textarea } from '@/shared/ui/textarea'

export function AgentInspectorPanel({ node }: { node: WorkflowNode & { data: AgentNodeData } }) {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData)
  const removeNode = useCanvasStore((state) => state.removeNode)
  const { data: tools } = useTools()

  const patch = (partial: Partial<AgentNodeData>) => updateNodeData<AgentNodeData>(node.id, partial)

  const toggleTool = (toolId: string) => {
    const has = node.data.toolIds.includes(toolId)
    patch({
      toolIds: has
        ? node.data.toolIds.filter((id) => id !== toolId)
        : [...node.data.toolIds, toolId],
    })
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot className="size-4 text-[var(--color-node-agent)]" />
          Agent
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-label">Name</Label>
          <Input
            id="agent-label"
            value={node.data.label}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-prompt">Instructions (system prompt)</Label>
          <Textarea
            id="agent-prompt"
            rows={7}
            value={node.data.systemPrompt}
            onChange={(e) => patch({ systemPrompt: e.target.value })}
            placeholder="You are a helpful assistant that..."
          />
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Model</p>
          <div className="space-y-1.5">
            <Label htmlFor="agent-deployment">Azure deployment</Label>
            <Input
              id="agent-deployment"
              value={node.data.model.deploymentId}
              onChange={(e) => patch({ model: { ...node.data.model, deploymentId: e.target.value } })}
              placeholder="use default from Settings"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-temp">Temp</Label>
              <Input
                id="agent-temp"
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={node.data.model.temperature}
                onChange={(e) =>
                  patch({ model: { ...node.data.model, temperature: Number(e.target.value) } })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-topp">Top P</Label>
              <Input
                id="agent-topp"
                type="number"
                step={0.1}
                min={0}
                max={1}
                value={node.data.model.topP}
                onChange={(e) => patch({ model: { ...node.data.model, topP: Number(e.target.value) } })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-maxtokens">Max tok</Label>
              <Input
                id="agent-maxtokens"
                type="number"
                step={64}
                min={16}
                value={node.data.model.maxTokens}
                onChange={(e) =>
                  patch({ model: { ...node.data.model, maxTokens: Number(e.target.value) } })
                }
              />
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tools</p>
          {(tools ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">
              No tools yet — create one on the Tools page.
            </p>
          )}
          <div className="space-y-1.5">
            {(tools ?? []).map((tool) => {
              const checked = node.data.toolIds.includes(tool.id)
              return (
                <label
                  key={tool.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-xs hover:border-ring"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checked}
                    onChange={() => toggleTool(tool.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{tool.name}</span>
                      <Badge variant={tool.executionType === 'server' ? 'secondary' : 'outline'}>
                        {tool.executionType}
                      </Badge>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-muted-foreground">
                      {tool.description}
                    </span>
                  </span>
                </label>
              )
            })}
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
