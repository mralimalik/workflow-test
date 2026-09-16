import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { Tool } from '@/entities/tool/model/types'
import { ToolEditorDialog } from '@/features/tools/components/ToolEditorDialog'
import { ToolList } from '@/features/tools/components/ToolList'
import { useTools } from '@/features/tools/hooks/useTools'
import { Button } from '@/shared/ui/button'

export function ToolsPage() {
  const { data: tools, isLoading } = useTools()
  const [editingTool, setEditingTool] = useState<Tool | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Tools</h1>
            <p className="text-sm text-muted-foreground">
              Reusable functions your agents can call — server-side for backend actions, or
              client-side for things this browser needs to run itself.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditingTool(null)
              setDialogOpen(true)
            }}
          >
            <Plus />
            New tool
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ToolList
            tools={tools ?? []}
            onEdit={(tool) => {
              setEditingTool(tool)
              setDialogOpen(true)
            }}
          />
        )}
      </div>

      <ToolEditorDialog tool={editingTool} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
