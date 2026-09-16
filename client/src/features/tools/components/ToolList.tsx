import { Code2, Pencil, Server, Trash2 } from 'lucide-react'
import type { Tool } from '@/entities/tool/model/types'
import { useDeleteTool } from '@/features/tools/hooks/useTools'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader } from '@/shared/ui/card'

export function ToolList({ tools, onEdit }: { tools: Tool[]; onEdit: (tool: Tool) => void }) {
  const deleteTool = useDeleteTool()

  if (tools.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No tools yet. Create one to let your agents call APIs, update UI state, or run other
        actions.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tools.map((tool) => (
        <Card key={tool.id}>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-mono text-sm font-medium">
                {tool.name}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
            </div>
            <Badge variant={tool.executionType === 'server' ? 'secondary' : 'outline'} className="shrink-0">
              {tool.executionType === 'server' ? <Server className="size-3" /> : <Code2 className="size-3" />}
              {tool.executionType}
            </Badge>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {tool.parameters.length} param{tool.parameters.length === 1 ? '' : 's'}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(tool)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  if (confirm(`Delete tool "${tool.name}"?`)) deleteTool.mutate(tool.id)
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
