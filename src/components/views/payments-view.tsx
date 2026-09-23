'use client'

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { useActiveWorkspace } from '@/lib/hooks/app-hooks'
import { EmptyState } from '@/components/app/empty-state'
import { MethodBadge } from '@/components/app/method-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { navigate } from '@/lib/router'
import { formatMoney } from '@/lib/domain/money'
import { addDaysStr, formatDateDisplay, todayStr } from '@/lib/date'
import type { PaymentMethod } from '@/lib/domain/types'
import { ChevronLeft, ChevronRight, ChevronRight as RowChevron, Search, Wallet, X } from 'lucide-react'

const PAGE_SIZE = 12
const METHODS: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'OTHER']
/** Segment colours — same family as MethodBadge chips. */
const METHOD_BAR: Record<PaymentMethod, string> = {
  CASH: 'bg-emerald-500',
  BANK_TRANSFER: 'bg-teal-500',
  UPI: 'bg-amber-500',
  CHEQUE: 'bg-orange-500',
  CARD: 'bg-fuchsia-500',
  OTHER: 'bg-zinc-400 dark:bg-zinc-500',
}
const PERIODS = [
  { value: 'ALL', label: 'All time' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'LAST_30D', label: 'Last 30 days' },
  { value: 'THIS_FY', label: 'This fiscal year' },
] as const
type Period = (typeof PERIODS)[number]['value']

/** Fiscal-year start (Apr–Mar, India) for a YYYY-MM-DD string — local string math, no UTC. */
const fyStart = (today: string): string => {
  const y = Number(today.slice(0, 4))
  return today.slice(5, 7) >= '04' ? `${y}-04-01` : `${y - 1}-04-01`
}

export function PaymentsView() {
  const ws = useActiveWorkspace()
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState<'ALL' | PaymentMethod>('ALL')
  const [period, setPeriod] = useState<Period>('ALL')
  const [page, setPage] = useState(0)
  const today = todayStr()

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
    const from =
      period === 'THIS_MONTH' ? `${today.slice(0, 7)}-01`
      : period === 'LAST_30D' ? addDaysStr(today, -30)
      : period === 'THIS_FY' ? fyStart(today)
      : null
    return data.payments.filter((p) => {
      if (method !== 'ALL' && p.method !== method) return false
      if (from) {
        const day = p.paid_at.slice(0, 10)
        if (day < from || day > today) return false
      }
      if (!q) return true
      const inv = data.invMap.get(p.invoice_id)
      return (
        (inv?.number ?? '').toLowerCase().includes(q) ||
        (inv?.customer_name_snapshot ?? '').toLowerCase().includes(q) ||
        String(p.amount_paise / 100).includes(q) ||
        (p.reference ?? '').toLowerCase().includes(q)
      )
    })
  }, [data, query, method, period, today])

  const methodCounts = useMemo(() => {
    const base = data?.payments ?? []
    const c: Record<string, number> = { ALL: base.length }
    for (const m of METHODS) c[m] = base.filter((p) => p.method === m).length
    return c
  }, [data])

  const grandTotal = useMemo(() => data?.payments.reduce((s, p) => s + p.amount_paise, 0) ?? 0, [data])
  const filteredTotal = useMemo(() => filtered.reduce((s, p) => s + p.amount_paise, 0), [filtered])
  const isFiltered = method !== 'ALL' || period !== 'ALL' || query.trim() !== ''

  /** Method mix over the currently filtered rows — powers the stacked bar. */
  const mix = useMemo(() => {
    if (filteredTotal <= 0) return []
    return METHODS
      .map((m) => {
        const sum = filtered.filter((p) => p.method === m).reduce((s, p) => s + p.amount_paise, 0)
        return { method: m, sum, pct: (sum / filteredTotal) * 100 }
      })
      .filter((r) => r.sum > 0)
      .sort((a, b) => b.sum - a.sum)
  }, [filtered, filteredTotal])

  const clearFilters = () => { setQuery(''); setMethod('ALL'); setPeriod('ALL'); setPage(0) }

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} placeholder="Search invoice, customer, reference…" className="pl-8" aria-label="Search payments" />
        </div>
        <Select value={method} onValueChange={(v) => { setMethod(v as 'ALL' | PaymentMethod); setPage(0) }}>
          <SelectTrigger
            className={`w-40 data-[state=open]:ring-1 ${method !== 'ALL' ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400' : ''}`}
            aria-label="Filter by payment method"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All methods{methodCounts ? ` (${methodCounts.ALL})` : ''}</SelectItem>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}{methodCounts ? ` (${methodCounts[m]})` : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(v) => { setPeriod(v as Period); setPage(0) }}>
          <SelectTrigger
            className={`w-40 data-[state=open]:ring-1 ${period !== 'ALL' ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400' : ''}`}
            aria-label="Filter by period"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className={`rounded-lg border px-3.5 py-2 transition-colors ${isFiltered ? 'border-emerald-500/40 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.1]' : 'bg-card'}`}>
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {isFiltered ? 'Filtered collected' : 'Total collected'}
            {isFiltered && (
              <button onClick={clearFilters} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400" aria-label="Clear all payment filters">
                <X className="h-2.5 w-2.5" /> clear
              </button>
            )}
          </p>
          <p className="text-sm font-semibold tabular-nums">
            {formatMoney(isFiltered ? filteredTotal : grandTotal)}
            {isFiltered && <span className="ml-1.5 text-xs font-normal text-muted-foreground">of {formatMoney(grandTotal)}</span>}
          </p>
        </div>
      </div>

      {/* method mix — compact stacked bar with legend (filtered rows only) */}
      {data && filtered.length > 0 && (
        <div className="rounded-xl border bg-card p-3" aria-label="Payment method mix">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Method mix · {filtered.length} payment{filtered.length === 1 ? '' : 's'}</p>
            <p className="text-[11px] text-muted-foreground">{isFiltered ? 'for current filters' : 'all recorded payments'}</p>
          </div>
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {mix.map((r) => (
              <div key={r.method} className={`${METHOD_BAR[r.method]} mix-seg h-full`} style={{ width: `${r.pct}%` }} title={`${r.method.replace(/_/g, ' ')} · ${formatMoney(r.sum)}`} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {mix.map((r) => (
              <li key={r.method} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`inline-block h-2 w-2 rounded-full ${METHOD_BAR[r.method]}`} aria-hidden="true" />
                <span className="font-medium text-foreground">{r.method.replace(/_/g, ' ')}</span>
                <span className="tabular-nums">{formatMoney(r.sum)}</span>
                <span className="tabular-nums opacity-70">· {Math.round(r.pct)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!data ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={isFiltered ? 'No payments match' : 'No payments recorded yet'}
          description={isFiltered ? 'Try a different search, method or period.' : 'Open a finalized invoice and record a payment — partial payments supported.'}
          action={isFiltered ? { label: 'Clear filters', onClick: clearFilters } : { label: 'Go to invoices', onClick: () => navigate('invoices') }}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="max-h-[64vh] overflow-auto scrollbar-thin">
            <table className="w-full text-sm" aria-label="Payments list">
              <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Method</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Reference</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="w-8 px-2 py-2.5" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const inv = data.invMap.get(p.invoice_id)
                  return (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      className="group cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
                      onClick={() => inv && navigate(`invoices/${inv.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && inv) navigate(`invoices/${inv.id}`) }}
                      aria-label={`Payment for invoice ${inv?.number ?? ''}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateDisplay(p.paid_at)}</td>
                      <td className="px-4 py-3 font-medium">{inv?.number ?? '—'}</td>
                      <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{inv?.customer_name_snapshot ?? '—'}</td>
                      <td className="hidden px-4 py-3 md:table-cell"><MethodBadge method={p.method} /></td>
                      <td className="hidden max-w-32 truncate px-4 py-3 text-muted-foreground md:table-cell">{p.reference ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(p.amount_paise)}</td>
                      <td className="px-2 py-3 text-muted-foreground/40 transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-400" aria-hidden="true">
                        <RowChevron className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                      </td>
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
