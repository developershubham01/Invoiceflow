'use client'

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { useActiveWorkspace } from '@/lib/hooks/app-hooks'
import { StatusBadge } from '@/components/app/status-badge'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { navigate } from '@/lib/router'
import { formatMoney } from '@/lib/domain/money'
import { formatDateDisplay, todayStr } from '@/lib/date'
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Receipt, Search } from 'lucide-react'

const PAGE_SIZE = 10
const STATUS_ORDER = ['DRAFT', 'FINALIZED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']

export function InvoicesView() {
  const ws = useActiveWorkspace()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('ALL')
  const [page, setPage] = useState(0)
  const today = todayStr()

  const invoices = useLiveQuery(async () => {
    if (!ws) return null
    return getDb().invoices.where('workspace_id').equals(ws.id).filter((i) => !i.deleted_at).toArray()
  }, [ws?.id])

  const filtered = useMemo(() => {
    if (!invoices) return []
    const q = query.trim().toLowerCase()
    return invoices
      .filter((i) => (status === 'ALL' ? true : i.status === status))
      .filter((i) =>
        !q ||
        i.number.toLowerCase().includes(q) ||
        (i.customer_name_snapshot ?? '').toLowerCase().includes(q) ||
        formatMoney(i.grand_total_paise).includes(q))
      .sort((a, b) => (b.invoice_date + b.number).localeCompare(a.invoice_date + a.number))
  }, [invoices, query, status])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const counts = useMemo(() => {
    if (!invoices) return null
    const c: Record<string, number> = { ALL: invoices.length }
    for (const s of STATUS_ORDER) c[s] = invoices.filter((i) => i.status === s).length
    return c
  }, [invoices])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0) }}
            placeholder="Search number, customer, amount…"
            className="pl-8"
            aria-label="Search invoices"
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0) }}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}{counts ? ` (${counts[s]})` : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => navigate('invoices/new')} className="gap-1.5">
          <Plus className="h-4 w-4" /> New invoice
        </Button>
      </div>

      {!invoices ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={query || status !== 'ALL' ? 'No invoices match' : 'No invoices yet'}
          description={query || status !== 'ALL' ? 'Try a different search or filter.' : 'Create your first invoice — it works fully offline and syncs later.'}
          action={{ label: 'Create invoice', onClick: () => navigate('invoices/new') }}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="max-h-[64vh] overflow-y-auto scrollbar-thin">
            <table className="w-full text-sm" aria-label="Invoices list">
              <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Dates</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((inv) => {
                  const overdue = inv.status !== 'DRAFT' && inv.status !== 'CANCELLED' && Boolean(inv.due_date && inv.due_date < today && inv.paid_total_paise < inv.grand_total_paise)
                  const provisional = inv.number.startsWith('DRAFT-')
                  return (
                    <tr
                      key={inv.id}
                      tabIndex={0}
                      className="cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
                      onClick={() => navigate(`invoices/${inv.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`invoices/${inv.id}`) }}
                      aria-label={`Open invoice ${inv.number}`}
                    >
                      <td className="px-4 py-3 font-medium">
                        {inv.number}
                        {provisional && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">provisional</span>}
                      </td>
                      <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{inv.customer_name_snapshot}</td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted-foreground md:table-cell">
                        {formatDateDisplay(inv.invoice_date)}
                        {inv.due_date ? <span className="mx-1">→</span> : null}
                        {inv.due_date ? formatDateDisplay(inv.due_date) : ''}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={inv.status} overdue={overdue} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{formatMoney(inv.grand_total_paise)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {inv.status === 'DRAFT' || inv.status === 'CANCELLED' ? '—' : formatMoney(Math.max(0, inv.grand_total_paise - inv.paid_total_paise))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>{filtered.length} invoices · page {page + 1} of {pages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
        Invoices past their due date with a balance are marked overdue.
      </p>
    </div>
  )
}
