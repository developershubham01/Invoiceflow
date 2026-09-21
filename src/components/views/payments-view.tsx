'use client'

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { useActiveWorkspace } from '@/lib/hooks/app-hooks'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { navigate } from '@/lib/router'
import { formatMoney } from '@/lib/domain/money'
import { formatDateDisplay } from '@/lib/date'
import { ChevronLeft, ChevronRight, Search, Wallet } from 'lucide-react'

const PAGE_SIZE = 12

export function PaymentsView() {
  const ws = useActiveWorkspace()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  const data = useLiveQuery(async () => {
    if (!ws) return null
    const payments = await getDb().payments.where('workspace_id').equals(ws.id).filter((p) => !p.deleted_at).toArray()
    const invoices = await getDb().invoices.where('workspace_id').equals(ws.id).toArray()
    const invMap = new Map(invoices.map((i) => [i.id, i]))
    return { payments: payments.sort((a, b) => b.paid_at.localeCompare(a.paid_at)), invMap }
  }, [ws?.id])

  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.payments.filter((p) => {
      if (!q) return true
      const inv = data.invMap.get(p.invoice_id)
      return (
        (inv?.number ?? '').toLowerCase().includes(q) ||
        (inv?.customer_name_snapshot ?? '').toLowerCase().includes(q) ||
        String(p.amount_paise / 100).includes(q) ||
        (p.reference ?? '').toLowerCase().includes(q)
      )
    })
  }, [data, query])

  const total = useMemo(() => data?.payments.reduce((s, p) => s + p.amount_paise, 0) ?? 0, [data])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} placeholder="Search invoice, customer, reference…" className="pl-8" aria-label="Search payments" />
        </div>
        <div className="rounded-lg border bg-card px-3.5 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total collected</p>
          <p className="text-sm font-semibold tabular-nums">{formatMoney(total)}</p>
        </div>
      </div>

      {!data ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={query ? 'No payments match' : 'No payments recorded yet'}
          description={query ? 'Try a different search.' : 'Open a finalized invoice and record a payment — partial payments supported.'}
          action={{ label: 'Go to invoices', onClick: () => navigate('invoices') }}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="max-h-[64vh] overflow-y-auto scrollbar-thin">
            <table className="w-full text-sm" aria-label="Payments list">
              <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Method</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Reference</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const inv = data.invMap.get(p.invoice_id)
                  return (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      className="cursor-pointer border-t transition-colors hover:bg-muted/40"
                      onClick={() => inv && navigate(`invoices/${inv.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && inv) navigate(`invoices/${inv.id}`) }}
                      aria-label={`Payment for invoice ${inv?.number ?? ''}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateDisplay(p.paid_at)}</td>
                      <td className="px-4 py-3 font-medium">{inv?.number ?? '—'}</td>
                      <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{inv?.customer_name_snapshot ?? '—'}</td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{p.method.replace(/_/g, ' ')}</td>
                      <td className="hidden max-w-32 truncate px-4 py-3 text-muted-foreground md:table-cell">{p.reference ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(p.amount_paise)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>{filtered.length} payments · page {page + 1} of {pages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
