import { Bot, MessageSquare, Settings, Workflow } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: 'Builder', icon: Workflow, end: true },
  { to: '/chat', label: 'Chat tester', icon: MessageSquare },
  { to: '/tools', label: 'Tools', icon: Bot },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-6 border-b border-border px-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Workflow className="size-3.5" />
          </span>
          Agent Studio
        </div>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )
              }
            >
              <item.icon className="size-3.5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
