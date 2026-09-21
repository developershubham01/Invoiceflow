// InvoiceFlow — canonical invoice status helpers.
// Single source of truth for the overdue rule so badges, KPIs, filters,
// reminders and banners can never drift apart (CANON §7 payment terms).

import { todayStr } from '@/lib/date'

export interface OverdueEligible {
  status?: string
  due_date: string | null
  paid_total_paise: number
  grand_total_paise: number
}

/**
 * Canonical overdue rule: an invoice is overdue when it has been issued
 * (not DRAFT / CANCELLED / PAID), its due date has passed, and a balance
 * remains outstanding. A row without a status field falls back to the
 * date + balance rule only.
 */
export function isInvoiceOverdue(inv: OverdueEligible, today = todayStr()): boolean {
  if (inv.status === 'DRAFT' || inv.status === 'CANCELLED' || inv.status === 'PAID') return false
  return Boolean(inv.due_date && inv.due_date < today) && inv.paid_total_paise < inv.grand_total_paise
}

/** Whole days past due (0 when not overdue). Uses local date strings, never UTC. */
export function daysOverdue(inv: OverdueEligible, today = todayStr()): number {
  if (!inv.due_date || !isInvoiceOverdue(inv, today)) return 0
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(inv.due_date)) / 86_400_000))
}
