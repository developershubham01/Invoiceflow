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

  setBooted: (booted: boolean) => void
  setStorageAvailable: (ok: boolean) => void
  setUser: (user: SessionUser | null) => void
  setNeedsReauth: (v: boolean) => void
  setActiveWorkspace: (ws: Workspace | null) => void
  setWorkspaces: (list: Workspace[]) => void
  setSyncState: (partial: Partial<AppState['sync']>) => void
}

export const useAppStore = create<AppState>((set) => ({
  booted: false,
  storageAvailable: true,
  user: null,
  needsReauth: false,
  activeWorkspace: null,
  workspaces: [],
  sync: { status: 'idle', lastSyncAt: null, lastError: null, pending: 0 },

  setBooted: (booted) => set({ booted }),
  setStorageAvailable: (storageAvailable) => set({ storageAvailable }),
  setUser: (user) => set({ user, needsReauth: false }),
  setNeedsReauth: (needsReauth) => set({ needsReauth }),
  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setSyncState: (partial) => set((s) => ({ sync: { ...s.sync, ...partial } })),
}))
