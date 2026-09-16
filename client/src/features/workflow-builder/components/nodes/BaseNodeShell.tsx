import { Handle, Position } from '@xyflow/react'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRunStore } from '@/entities/run/model/runStore'
import { cn } from '@/shared/lib/utils'

interface BaseNodeShellProps {
  id: string
  icon: LucideIcon
  colorVar: string
  title: string
  subtitle?: string
  selected?: boolean
  showTarget?: boolean
  showSource?: boolean
  children?: ReactNode
}

export function BaseNodeShell({
  id,
  icon: Icon,
  colorVar,
  title,
  subtitle,
  selected,
  showTarget = true,
  showSource = true,
  children,
}: BaseNodeShellProps) {
  const activeNodeId = useRunStore((state) => state.activeNodeId)
  const step = useRunStore((state) => state.steps.filter((s) => s.nodeId === id).at(-1))
  const isActive = activeNodeId === id

  return (
    <div
      className={cn(
        'min-w-[200px] rounded-lg border bg-card shadow-sm transition-shadow',
        selected ? 'border-primary ring-2 ring-ring' : 'border-border',
        isActive && 'ring-2 ring-offset-2 ring-offset-background',
      )}
      style={isActive ? { boxShadow: `0 0 0 2px var(${colorVar})` } : undefined}
    >
      {showTarget && (
        <Handle
          type="target"
          position={Position.Left}
          className="!size-2.5 !border-2 !border-background"
          style={{ background: `var(${colorVar})` }}
        />
      )}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-md"
          style={{ background: `color-mix(in oklch, var(${colorVar}) 25%, transparent)` }}
        >
          <Icon className="size-3.5" style={{ color: `var(${colorVar})` }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>}
        </div>
        {isActive && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        {!isActive && step?.status === 'success' && (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
        )}
        {!isActive && step?.status === 'error' && (
          <AlertCircle className="size-3.5 shrink-0 text-destructive" />
        )}
      </div>
      {children && <div className="px-3 py-2">{children}</div>}
      {showSource && (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-2.5 !border-2 !border-background"
          style={{ background: `var(${colorVar})` }}
        />
      )}
    </div>
  )
}
