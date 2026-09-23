// InvoiceFlow — Global keyboard shortcuts (desktop power-user affordance).
// Single-key actions are ignored while typing, inside dialogs, or with modifiers held.

import { useEffect } from 'react'
import { navigate } from '@/lib/router'
import { useAppStore } from '@/lib/stores/app-store'

export const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'Ctrl+B', label: 'Toggle sidebar' },
  { keys: 'N', label: 'New invoice' },
  { keys: '⇧N', label: 'New quotation' },
  { keys: 'D', label: 'Dashboard' },
  { keys: 'I', label: 'Invoices' },
  { keys: 'Q', label: 'Quotations' },
  { keys: 'C', label: 'Customers' },
  { keys: 'P', label: 'Payments' },
  { keys: 'R', label: 'Reports' },
  { keys: 'S', label: 'Settings' },
]

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Allow Ctrl+B or Cmd+B for sidebar toggle even when typing/in inputs
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        const { toggleSidebarCollapsed } = useAppStore.getState()
        toggleSidebarCollapsed()
        return
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      // Never hijack keys while a modal is open (command palette, dialogs…)
      if (typeof document !== 'undefined' && document.querySelector('[role="dialog"]')) return

      switch (e.key) {
        case 'n': e.preventDefault(); navigate('invoices/new'); break
        case 'N': e.preventDefault(); navigate('quotations/new'); break
        case 'd': navigate('dashboard'); break
        case 'i': navigate('invoices'); break
        case 'q': navigate('quotations'); break
        case 'c': navigate('customers'); break
        case 'p': navigate('payments'); break
        case 'r': navigate('reports'); break
        case 's': navigate('settings'); break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])
}
