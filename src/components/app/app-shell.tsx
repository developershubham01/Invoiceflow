'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ThemeToggle } from '@/components/app/theme-toggle'
import { SyncPill } from '@/components/app/sync-pill'
import { SearchDialog } from '@/components/app/search-dialog'
import { useAppStore } from '@/lib/stores/app-store'
import { useUser, useCompany } from '@/lib/hooks/app-hooks'
import { useGlobalShortcuts } from '@/lib/hooks/use-shortcuts'
import { ViewErrorBoundary } from '@/components/app/view-error-boundary'
import { hrefFor, navigate, useHashRoute } from '@/lib/router'
import { apiLogout } from '@/lib/sync/client'
import { APP_VERSION } from '@/lib/version'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  BarChart3, Building2, ChevronDown, ChevronLeft, ChevronRight, CircleUser, FileText,
  Landmark, LayoutDashboard, LogOut, Menu, Package, PanelLeft, Receipt, Settings, Trash2, UserRound,
  Users, Wallet, X,
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

function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const route = useHashRoute()
  const section = route.segments[0] ?? 'dashboard'

  if (collapsed) {
    return (
      <nav aria-label="Main navigation" className="flex-1 space-y-3 overflow-y-auto px-2 py-4 scrollbar-thin">
        {NAV.map((group, groupIdx) => (
          <div key={group.heading} className="space-y-1">
            {groupIdx > 0 && <div className="mx-2 my-2 border-t border-sidebar-border/60" />}
            <ul className="space-y-1.5">
              {group.items.map((item) => {
                const active = section === item.path
                return (
                  <li key={item.path}>
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <a
                          href={hrefFor(item.path)}
                          onClick={(e) => {
                            e.preventDefault()
                            navigate(item.path)
                            onNavigate?.()
                          }}
                          aria-current={active ? 'page' : undefined}
                          aria-label={item.label}
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-lg transition-colors mx-auto',
                            active
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-emerald-500/20'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                          )}
                        >
                          <item.icon className={cn('h-4.5 w-4.5 shrink-0', active && 'text-emerald-400')} aria-hidden="true" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={12} className="font-medium text-xs z-50">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    )
  }

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
                    href={hrefFor(item.path)}
                    onClick={(e) => {
                      e.preventDefault()
                      navigate(item.path)
                      onNavigate?.()
                    }}
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

function Brand({ collapsed }: { collapsed?: boolean }) {
  const company = useCompany()
  const logo = company?.logo_data
  const brandName = company?.name || 'InvoiceFlow'

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <div className="flex justify-center pt-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm cursor-pointer hover:opacity-90 overflow-hidden">
              {logo ? (
                <img src={logo} alt={brandName} className="h-full w-full object-contain p-0.5 bg-white rounded-lg" />
              ) : (
                <Landmark className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>
          <p className="font-semibold text-xs">{brandName}</p>
          <p className="text-[10px] opacity-80">Local-first v{APP_VERSION}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex items-center gap-2.5 px-4 pt-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm overflow-hidden shrink-0">
        {logo ? (
          <img src={logo} alt={brandName} className="h-full w-full object-contain p-0.5 bg-white rounded-lg" />
        ) : (
          <Landmark className="h-4.5 w-4.5" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight text-white truncate">{brandName}</p>
        <p className="text-[10px] leading-tight text-slate-400">Local-first invoicing</p>
      </div>
    </div>
  )
}

function WorkspaceSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { activeWorkspace, workspaces, setActiveWorkspace, setWorkspaces } = useAppStore()
  const company = useCompany()
  if (!activeWorkspace) return null

  const logo = company?.logo_data
  const orgName = company?.name || activeWorkspace.name
  const isMulti = workspaces.length > 1

  const handleKeepOnlyActive = async () => {
    const { removeOtherWorkspaces } = await import('@/lib/db/repositories')
    const remaining = await removeOtherWorkspaces(activeWorkspace.id)
    setWorkspaces(remaining)
    toast.success('Active organization kept. Other organization data removed.')
  }

  const handleDeleteWorkspace = async (wId: string, wName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const { deleteWorkspace } = await import('@/lib/db/repositories')
    const remaining = await deleteWorkspace(wId)
    setWorkspaces(remaining)
    toast.success(`Removed "${wName}" organization data`)
  }

  const renderLogo = (sizeClass: string, textClass: string) => {
    if (logo) {
      return (
        <div className={cn(sizeClass, 'shrink-0 overflow-hidden rounded border border-white/10 bg-white flex items-center justify-center')}>
          <img src={logo} alt={orgName} className="h-full w-full object-contain" />
        </div>
      )
    }
    return (
      <div className={cn(sizeClass, 'shrink-0 items-center justify-center rounded bg-emerald-600 font-bold text-white flex', textClass)}>
        {orgName.slice(0, 1).toUpperCase()}
      </div>
    )
  }

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TooltipTrigger asChild>
              <button
                className="mx-auto mt-4 flex h-9 w-9 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/50 transition-colors hover:bg-sidebar-accent overflow-hidden"
                aria-label="Switch workspace"
              >
                {renderLogo('h-6 w-6', 'text-[10px]')}
              </button>
            </TooltipTrigger>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" sideOffset={12} className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Organization</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {workspaces.map((w) => {
              const isActive = w.id === activeWorkspace.id
              return (
                <DropdownMenuItem
                  key={w.id}
                  className="flex items-center justify-between gap-2"
                  onClick={() => {
                    void (async () => {
                      const { switchWorkspace } = await import('@/lib/db/repositories')
                      await switchWorkspace(w.id)
                      setActiveWorkspace(w)
                      navigate('dashboard')
                    })()
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isActive && logo ? (
                      <img src={logo} alt={w.name} className="h-4 w-4 object-contain rounded shrink-0" />
                    ) : (
                      <Building2 className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate text-xs">{w.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isActive ? (
                      <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded">Active</span>
                    ) : (
                      <button
                        title="Delete organization"
                        onClick={(e) => handleDeleteWorkspace(w.id, w.name, e)}
                        className="text-muted-foreground hover:text-red-500 p-1 rounded transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </DropdownMenuItem>
              )
            })}
            {isMulti && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleKeepOnlyActive}
                  className="text-xs text-red-500 focus:text-red-600 cursor-pointer"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  <span>Remove other organization data</span>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('company-profile')} className="text-xs">
              <Settings className="mr-2 h-3.5 w-3.5" />
              <span>Company Profile & Logo</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipContent side="right" sideOffset={12}>
          <p className="font-semibold text-xs">{orgName}</p>
          <p className="text-[10px] opacity-80">{activeWorkspace.cloud_linked_at ? 'Cloud synced' : 'Local organization'}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="mx-3 mt-4 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent">
          {renderLogo('h-6 w-6', 'text-[10px]')}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-200">{orgName}</p>
            <p className="text-[10px] text-slate-500">{activeWorkspace.cloud_linked_at ? 'Cloud synced' : 'Single Organization'}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Organization</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => {
          const isActive = w.id === activeWorkspace.id
          return (
            <DropdownMenuItem
              key={w.id}
              className="flex items-center justify-between gap-2"
              onClick={() => {
                void (async () => {
                  const { switchWorkspace } = await import('@/lib/db/repositories')
                  await switchWorkspace(w.id)
                  setActiveWorkspace(w)
                  navigate('dashboard')
                })()
              }}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {isActive && logo ? (
                  <img src={logo} alt={w.name} className="h-4 w-4 object-contain rounded shrink-0" />
                ) : (
                  <Building2 className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate text-xs">{w.name}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {isActive ? (
                  <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded">Active</span>
                ) : (
                  <button
                    title="Delete organization"
                    onClick={(e) => handleDeleteWorkspace(w.id, w.name, e)}
                    className="text-muted-foreground hover:text-red-500 p-1 rounded transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </DropdownMenuItem>
          )
        })}
        {isMulti && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleKeepOnlyActive}
              className="text-xs text-red-500 focus:text-red-600 cursor-pointer"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              <span>Remove other organization data</span>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('company-profile')} className="text-xs">
          <Settings className="mr-2 h-3.5 w-3.5" />
          <span>Company Profile & Logo</span>
        </DropdownMenuItem>
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
            {user.avatarUrl ? (
              <AvatarImage src={user.avatarUrl} alt={user.name ?? 'User profile'} />
            ) : null}
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
        <SheetDescription className="sr-only">Open the main navigation menu</SheetDescription>
        <Brand />
        <WorkspaceSwitcher />
        <SidebarNav onNavigate={() => setOpen(false)} />
        <div className="px-4 pb-4 text-[10px] text-slate-500">InvoiceFlow v{APP_VERSION}</div>
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

/** Tiny keycap chip used in shortcut hints. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-white/15 bg-white/10 px-1 font-mono text-[9px] font-medium text-slate-200">
      {children}
    </kbd>
  )
}

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const online = useAppStore((s) => s.sync.status)
  void online
  const isOffline = useAppStore((s) => s.sync.status === 'offline') || (typeof navigator !== 'undefined' && !navigator.onLine)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useAppStore((s) => s.toggleSidebarCollapsed)

  useGlobalShortcuts()
  const { segments } = useHashRoute()
  // Re-keying on the first route segment replays the enter animation per view.
  const viewKey = segments[0] ?? 'dashboard'

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out lg:flex',
            sidebarCollapsed ? 'w-[68px]' : 'w-60'
          )}
        >
          <Brand collapsed={sidebarCollapsed} />
          <WorkspaceSwitcher collapsed={sidebarCollapsed} />
          <SidebarNav collapsed={sidebarCollapsed} />

          {/* Desktop sidebar bottom footer & collapse toggle */}
          <div className="border-t border-sidebar-border p-3 text-[10px] text-slate-500">
            {sidebarCollapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleSidebarCollapsed}
                    className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-sidebar-accent hover:text-white transition-colors"
                    aria-label="Expand sidebar (Ctrl+B)"
                  >
                    <ChevronRight className="h-4.5 w-4.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={12}>
                  Expand sidebar (Ctrl+B)
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={toggleSidebarCollapsed}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-sidebar-accent hover:text-white transition-colors"
                  title="Collapse sidebar (Ctrl+B)"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <ChevronLeft className="h-4 w-4" />
                    <span>Collapse sidebar</span>
                  </span>
                  <Kbd>Ctrl+B</Kbd>
                </button>
                <div>
                  <p className="mb-0.5 hidden xl:block text-[10px] opacity-70" title="Keyboard shortcuts — full list in search palette (Ctrl K)">
                    <Kbd>N</Kbd> invoice · <Kbd>⇧N</Kbd> quote · <Kbd>D</Kbd> dash
                  </p>
                  InvoiceFlow v{APP_VERSION}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main column */}
        <div
          className={cn(
            'flex min-h-screen w-full flex-col transition-all duration-300 ease-in-out',
            sidebarCollapsed ? 'lg:pl-[68px]' : 'lg:pl-60'
          )}
        >
          <OfflineBanner show={isOffline} />
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6" role="banner">
            <MobileSidebar />
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:flex h-8 w-8 text-slate-400 hover:text-foreground"
              onClick={toggleSidebarCollapsed}
              title={sidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
            >
              <PanelLeft className="h-4.5 w-4.5" />
            </Button>
            <h1 className="truncate text-sm font-semibold md:text-base">{title}</h1>
            {/* gap-1.5 below sm keeps the cluster inside 320px viewports (3px overflow at gap-2) */}
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <SearchDialog />
              <SyncPill />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>

          <main className="flex-1 px-4 py-6 md:px-6 lg:px-8" role="main">
            {/* The boundary keeps the header/sidebar/footer mounted even if a view throws —
                only the crashed view is replaced. Re-keying on the first route segment
                both resets the boundary and replays the enter animation per view. */}
            <ViewErrorBoundary resetKey={viewKey}>
              <div key={viewKey} className="view-enter mx-auto w-full max-w-6xl">{children}</div>
            </ViewErrorBoundary>
          </main>

          {/* Sticky footer: mt-auto pushes to bottom, min-h-screen root guarantees no gap */}
          <footer className="mt-auto border-t bg-card/60 px-4 py-2.5 md:px-6" role="contentinfo">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">InvoiceFlow</span> v{APP_VERSION} — Local-first · Offline-ready · GST-aware
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
    </TooltipProvider>
  )
}
