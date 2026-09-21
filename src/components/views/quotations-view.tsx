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
import { ChevronLeft, ChevronRight, FileText, Plus, Search } from 'lucide-react'

const PAGE_SIZE = 10
const STATUS_ORDER = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED']

export function QuotationsView() {
  const ws = useActiveWorkspace()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(0)
  const today = todayStr()

  const quotations = useLiveQuery(async () => {
    if (!ws) return null
    return getDb().quotations.where('workspace_id').equals(ws.id).filter((q) => !q.deleted_at).toArray()
  }, [ws?.id])

  const counts = useMemo(() => {
    if (!quotations) return null
    const c: Record<string, number> = { ALL: quotations.length }
    for (const s of STATUS_ORDER) c[s] = quotations.filter((q) => q.status === s).length
    return c
  }, [quotations])

  const filtered = useMemo(() => {
    if (!quotations) return []
    const q = query.trim().toLowerCase()
    return quotations
      .map((x) => {
        // lazy expiry: EXPIRED when valid_until passed and not converted/accepted yet
        if (x.status === 'SENT' && x.valid_until && x.valid_until < today) return { ...x, status: 'EXPIRED' as const }
        return x
      })
      .filter((x) => (status === 'ALL' ? true : x.status === status))
      .filter((x) => !q || x.number.toLowerCase().includes(q) || (x.customer_name_snapshot ?? '').toLowerCase().includes(q))
      .sort((a, b) => (b.quotation_date + b.number).localeCompare(a.quotation_date + a.number))
  }, [quotations, query, status, today])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} placeholder="Search number, customer…" className="pl-8" aria-label="Search quotations" />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0) }}>
          <SelectTrigger className="w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{s}{counts ? ` (${counts[s]})` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => navigate('quotations/new')} className="gap-1.5">
          <Plus className="h-4 w-4" /> New quotation
        </Button>
      </div>

      {!quotations ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={query || status !== 'ALL' ? 'No quotations match' : 'No quotations yet'}
          description={query || status !== 'ALL' ? 'Try a different search or filter.' : 'Send professional quotations with GST breakdowns — fully offline capable.'}
          action={{ label: 'Create quotation', onClick: () => navigate('quotations/new') }}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="max-h-[64vh] overflow-auto scrollbar-thin">
            <table className="w-full text-sm" aria-label="Quotations list">
              <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Quotation</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Date</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Valid until</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="w-8 px-2 py-2.5" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((q) => (
                  <tr
                    key={q.id}
                    tabIndex={0}
                    className="group cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
                    onClick={() => navigate(`quotations/${q.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`quotations/${q.id}`) }}
                    aria-label={`Open quotation ${q.number}`}
                  >
                    <td className="px-4 py-3 font-medium">{q.number}</td>
                    <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{q.customer_name_snapshot}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted-foreground md:table-cell">{formatDateDisplay(q.quotation_date)}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted-foreground md:table-cell">{formatDateDisplay(q.valid_until)}</td>
                    <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{formatMoney(q.grand_total_paise)}</td>
                    <td className="px-2 py-3 text-muted-foreground/40 transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-400" aria-hidden="true">
                      <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>{filtered.length} quotations · page {page + 1} of {pages}</span>
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
