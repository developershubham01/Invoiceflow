// InvoiceFlow — Global client state (Zustand)
// Server-state data lives in Dexie (live queries); this store holds session/UI/sync status.

import { create } from 'zustand'
import type { SessionUser, Workspace } from '@/lib/domain/types'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'needs_auth'

export type ViewParams = Record<string, string>

interface AppState {
  booted: boolean
  storageAvailable: boolean
  user: SessionUser | null
  needsReauth: boolean
  activeWorkspace: Workspace | null
  workspaces: Workspace[]
  sync: {
    status: SyncStatus
    lastSyncAt: string | null
    lastError: string | null
    pending: number
  }
  /** One-shot cross-view hints (e.g. open invoices pre-filtered to OVERDUE). Consumed by the target view. */
  viewParams: ViewParams
  sidebarCollapsed: boolean

  setBooted: (booted: boolean) => void
  setStorageAvailable: (ok: boolean) => void
  setUser: (user: SessionUser | null) => void
  setNeedsReauth: (v: boolean) => void
  setActiveWorkspace: (ws: Workspace | null) => void
  setWorkspaces: (list: Workspace[]) => void
  setSyncState: (partial: Partial<AppState['sync']>) => void
  setViewParams: (params: ViewParams) => void
  consumeViewParam: (key: string) => string | undefined
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebarCollapsed: () => void
}

const SIDEBAR_STORAGE_KEY = 'invoiceflow_sidebar_collapsed'

function getInitialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  booted: false,
  storageAvailable: true,
  user: null,
  needsReauth: false,
  activeWorkspace: null,
  workspaces: [],
  sync: { status: 'idle', lastSyncAt: null, lastError: null, pending: 0 },
  viewParams: {},
  sidebarCollapsed: getInitialSidebarCollapsed(),

  setBooted: (booted) => set({ booted }),
  setStorageAvailable: (storageAvailable) => set({ storageAvailable }),
  setUser: (user) => set({ user, needsReauth: false }),
  setNeedsReauth: (needsReauth) => set({ needsReauth }),
  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setSyncState: (partial) => set((s) => ({ sync: { ...s.sync, ...partial } })),
  setViewParams: (viewParams) => set({ viewParams }),
  consumeViewParam: (key) => {
    const value = get().viewParams[key]
    if (value !== undefined) {
      const rest = { ...get().viewParams }
      delete rest[key]
      set({ viewParams: rest })
    }
    return value
  },
  setSidebarCollapsed: (collapsed) => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed))
    } catch {}
    set({ sidebarCollapsed: collapsed })
  },
  toggleSidebarCollapsed: () => {
    const next = !get().sidebarCollapsed
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
    } catch {}
    set({ sidebarCollapsed: next })
  },
}))
