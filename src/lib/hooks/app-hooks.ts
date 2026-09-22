// InvoiceFlow — React hooks: network status, workspace bootstrap, Dexie live queries

'use client'

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { getActiveWorkspace, listWorkspaces, getSetting } from '@/lib/db/repositories'
import { apiSession } from '@/lib/sync/client'
import { checkStorageAvailable } from '@/lib/db/db'
import { useAppStore } from '@/lib/stores/app-store'

export function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

/** Boot the app: storage check, session, workspace. Runs once. */
export function useBoot(): void {
  const store = useAppStore()
  useEffect(() => {
    let cancelled = false
    async function boot() {
      const storageOk = await checkStorageAvailable()
      if (cancelled) return
      store.setStorageAvailable(storageOk)
      if (!storageOk) {
        store.setBooted(true)
        return
      }
      const ws = await getActiveWorkspace()
      const all = await listWorkspaces()
      const session = await apiSession().catch(() => ({ user: null }))
      if (cancelled) return
      store.setActiveWorkspace(ws)
      store.setWorkspaces(all)
      store.setUser(session.user)
      store.setBooted(true)
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])
}

export function useActiveWorkspace() {
  return useAppStore((s) => s.activeWorkspace)
}

export function useUser() {
  return useAppStore((s) => s.user)
}

/** Live query over the active workspace's company profile. */
export function useCompany() {
  const ws = useActiveWorkspace()
  return useLiveQuery(async () => {
    if (!ws || typeof window === 'undefined') return undefined
    const rows = await getDb().company_profiles.where('workspace_id').equals(ws.id).filter((c) => !c.deleted_at).toArray()
    return rows[0] ?? null
  }, [ws?.id])
}

/** Settings from app_settings (theme etc. mirrored by next-themes; reserved). */
export function useAppSetting(key: string): string | null | undefined {
  return useLiveQuery(async () => {
    if (typeof window === 'undefined') return undefined
    return getSetting(key)
  }, [key])
}
