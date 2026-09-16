import { Bot, FlagTriangleRight, GitFork, Rocket } from 'lucide-react'
import type { DragEvent } from 'react'
import { useCanvasStore } from '@/entities/workflow/model/canvasStore'
import { createWorkflowNode } from '@/entities/workflow/model/defaults'
import type { WorkflowNodeKind } from '@/entities/workflow/model/types'
import { cn } from '@/shared/lib/utils'

const PALETTE_ITEMS: {
  kind: WorkflowNodeKind
  label: string
  description: string
  icon: typeof Bot
  colorVar: string
  singleton?: boolean
}[] = [
  {
    kind: 'agent',
    label: 'Agent',
    description: 'An LLM step with its own instructions & tools',
    icon: Bot,
    colorVar: '--color-node-agent',
  },
  {
    kind: 'router',
    label: 'Router',
    description: 'Branch to different next steps',
    icon: GitFork,
    colorVar: '--color-node-router',
  },
  {
    kind: 'end',
    label: 'End',
    description: 'Terminates the run with a final answer',
    icon: FlagTriangleRight,
    colorVar: '--color-node-end',
  },
  {
    kind: 'start',
    label: 'Start',
    description: 'Entry point (only one allowed)',
    icon: Rocket,
    colorVar: '--color-node-start',
    singleton: true,
  },
]

export function NodePalette() {
  const nodes = useCanvasStore((state) => state.nodes)
  const addNode = useCanvasStore((state) => state.addNode)
  const hasStart = nodes.some((node) => node.type === 'start')

  const onDragStart = (event: DragEvent<HTMLButtonElement>, kind: WorkflowNodeKind) => {
    event.dataTransfer.setData('application/reactflow', kind)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleClickAdd = (kind: WorkflowNodeKind) => {
    const offset = nodes.length * 24
    addNode(createWorkflowNode(kind, { x: 120 + offset, y: 260 + offset }))
  }

  return (
    <div className="flex w-56 shrink-0 flex-col gap-2 border-r border-border p-3">
      <p className="px-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Add node
      </p>
      {PALETTE_ITEMS.map((item) => {
        const disabled = item.singleton && hasStart
        return (
          <button
            key={item.kind}
            type="button"
            draggable={!disabled}
            disabled={disabled}
            onDragStart={(event) => onDragStart(event, item.kind)}
            onClick={() => !disabled && handleClickAdd(item.kind)}
            className={cn(
              'group flex items-start gap-2.5 rounded-md border border-border bg-card p-2.5 text-left transition-colors',
              disabled ? 'cursor-not-allowed opacity-40' : 'cursor-grab hover:border-ring active:cursor-grabbing',
            )}
          >
            <span
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md"
              style={{ background: `color-mix(in oklch, var(${item.colorVar}) 25%, transparent)` }}
            >
              <item.icon className="size-3.5" style={{ color: `var(${item.colorVar})` }} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="block text-[11px] leading-snug text-muted-foreground">
                {item.description}
              </span>
            </span>
          </button>
        )
      })}
      <p className="mt-2 px-1 text-[11px] leading-snug text-muted-foreground">
        Drag onto the canvas, or click to drop near the last node.
      </p>
    </div>
  )
}
