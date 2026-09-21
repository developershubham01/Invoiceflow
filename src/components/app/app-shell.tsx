'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ThemeToggle } from '@/components/app/theme-toggle'
import { SyncPill } from '@/components/app/sync-pill'
import { SearchDialog } from '@/components/app/search-dialog'
import { useAppStore } from '@/lib/stores/app-store'
import { useUser } from '@/lib/hooks/app-hooks'
import { navigate, useHashRoute } from '@/lib/router'
import { apiLogout } from '@/lib/sync/client'
import { cn } from '@/lib/utils'
import {
  BarChart3, Building2, ChevronDown, CircleUser, FileText, Landmark, LayoutDashboard,
  LogOut, Menu, Receipt, Settings, UserRound, Users, Package, Wallet, X,
} from 'lucide-react'

const NAV = [
  {
    heading: 'Overview',
    items: [
      { path: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { path: 'reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    heading: 'Sales',
    items: [
      { path: 'invoices', label: 'Invoices', icon: Receipt },
      { path: 'quotations', label: 'Quotations', icon: FileText },
      { path: 'payments', label: 'Payments', icon: Wallet },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { path: 'customers', label: 'Customers', icon: Users },
      { path: 'products', label: 'Products & Services', icon: Package },
      { path: 'company', label: 'My Company', icon: Building2 },
    ],
  },
  {
    heading: 'System',
    items: [{ path: 'settings', label: 'Settings', icon: Settings }],
  },
]

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const route = useHashRoute()
  const section = route.segments[0] ?? 'dashboard'
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-4 scrollbar-thin">
      {NAV.map((group) => (
        <div key={group.heading}>
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">
            {group.heading}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = section === item.path
              return (
                <li key={item.path}>
                  <a
                    href={`#/${item.path}`}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                    )}
                  >
                    <item.icon className={cn('h-4 w-4 shrink-0', active && 'text-emerald-400')} aria-hidden="true" />
                    {item.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 pt-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Landmark className="h-4.5 w-4.5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight text-white">InvoiceFlow</p>
        <p className="text-[10px] leading-tight text-slate-400">Local-first invoicing</p>
      </div>
    </div>
  )
}

function WorkspaceSwitcher() {
  const { activeWorkspace, workspaces, setActiveWorkspace } = useAppStore()
  if (!activeWorkspace) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="mx-3 mt-4 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-emerald-600 text-[10px] font-bold text-white">
            {activeWorkspace.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-200">{activeWorkspace.name}</p>
            <p className="text-[10px] text-slate-500">{activeWorkspace.cloud_linked_at ? 'Cloud synced' : 'Local workspace'}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onClick={() => {
              void (async () => {
                const { switchWorkspace } = await import('@/lib/db/repositories')
                await switchWorkspace(w.id)
                setActiveWorkspace(w)
                navigate('dashboard')
              })()
            }}
          >
            <Building2 className="mr-2 h-4 w-4" />
            <span className="truncate">{w.name}</span>
            {w.id === activeWorkspace.id && <span className="ml-auto text-xs text-emerald-600">Active</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const user = useUser()
  const setUser = useAppStore((s) => s.setUser)
  if (!user) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('login')}>
        <CircleUser className="h-4 w-4" aria-hidden="true" /> Sign in
      </Button>
    )
  }
  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
          <Avatar className="h-8 w-8 border">
            <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-medium">{user.name ?? 'Account'}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('settings/security')}>
          <UserRound className="mr-2 h-4 w-4" /> Account & security
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void (async () => {
              await apiLogout()
              setUser(null)
            })()
          }}
        >
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MobileSidebar() {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8 lg:hidden" aria-label="Open navigation menu">
          <Menu className="h-4.5 w-4.5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button]:text-slate-400">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <Brand />
        <WorkspaceSwitcher />
        <SidebarNav onNavigate={() => setOpen(false)} />
        <div className="px-4 pb-4 text-[10px] text-slate-500">InvoiceFlow v0.1.0</div>
      </SheetContent>
    </Sheet>
  )
}

function OfflineBanner({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300" role="status">
      <X className="hidden" aria-hidden="true" />
      You are offline — everything keeps working locally. Changes will sync when you reconnect.
    </div>
  )
}

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const online = useAppStore((s) => s.sync.status)
  void online
  const isOffline = useAppStore((s) => s.sync.status === 'offline') || (typeof navigator !== 'undefined' && !navigator.onLine)
  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand />
        <WorkspaceSwitcher />
        <SidebarNav />
        <div className="border-t border-sidebar-border px-4 py-3 text-[10px] text-slate-500">
          InvoiceFlow v0.1.0 · Offline-first
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen w-full flex-col lg:pl-60">
        <OfflineBanner show={isOffline} />
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6" role="banner">
          <MobileSidebar />
          <h1 className="truncate text-sm font-semibold md:text-base">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            <SearchDialog />
            <SyncPill />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8" role="main">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>

        {/* Sticky footer: mt-auto pushes to bottom, min-h-screen root guarantees no gap */}
        <footer className="mt-auto border-t bg-card/60 px-4 py-2.5 md:px-6" role="contentinfo">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">InvoiceFlow</span> v0.1.0 — Local-first · Offline-ready · GST-aware
            </p>
            <div className="flex items-center gap-3">
              <SyncPill compact />
              <span aria-hidden="true">·</span>
              <span>IndexedDB store</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
