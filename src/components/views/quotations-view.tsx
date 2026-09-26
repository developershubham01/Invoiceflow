'use client'

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { useActiveWorkspace, useCompany } from '@/lib/hooks/app-hooks'
import { StatusBadge } from '@/components/app/status-badge'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { navigate } from '@/lib/router'
import { formatMoney } from '@/lib/domain/money'
import { addDaysStr, formatDateDisplay, todayStr } from '@/lib/date'
import { setQuotationStatus, softDeleteQuotationDraft, convertQuotationToInvoice } from '@/lib/db/repositories'
import { toCsv, downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  ArrowRightLeft, ChevronLeft, ChevronRight, ChevronRight as RowChevron, Clock3, Download, FileDown, FileText, Loader2, Plus, Search,
  Send, Trash2, X,
} from 'lucide-react'

const PAGE_SIZE = 10
const STATUS_ORDER = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED']

export function QuotationsView() {
  const ws = useActiveWorkspace()
  const company = useCompany()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
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

  // ---- bulk selection ------------------------------------------------------
  const selectedRows = useMemo(() => filtered.filter((q) => selected.has(q.id)), [filtered, selected])
  const draftSelected = selectedRows.filter((q) => q.status === 'DRAFT')
  const acceptedSelected = selectedRows.filter((q) => q.status === 'ACCEPTED')
  const selectedValue = selectedRows.reduce((s, q) => s + q.grand_total_paise, 0)
  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))
  const pageSomeSelected = pageRows.some((r) => selected.has(r.id)) && !pageAllSelected

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (pageAllSelected) pageRows.forEach((r) => next.delete(r.id))
      else pageRows.forEach((r) => next.add(r.id))
      return next
    })
  }
  const clearSelection = () => setSelected(new Set())

  // ---- bulk operations -----------------------------------------------------
  const runMarkSent = async () => {
    if (!ws || draftSelected.length === 0) return
    setBusy(true)
    let ok = 0
    const failed: Array<{ number: string; reason: string }> = []
    for (const q of draftSelected) {
      try {
        // official QT number is allocated inside the transition (CANON §6)
        await setQuotationStatus(ws.id, q.id, 'SENT', company?.quotation_prefix)
        ok++
      } catch (err) {
        failed.push({ number: q.number, reason: (err as Error).message })
      }
    }
    setBusy(false)
    if (ok > 0) toast.success(`${ok} quotation${ok === 1 ? '' : 's'} marked sent`, { description: 'Official numbers allocated — awaiting customer decision.' })
    for (const f of failed) toast.error(`Could not send ${f.number}`, { description: f.reason })
    clearSelection()
  }

  const runDeleteDrafts = async () => {
    if (!ws || draftSelected.length === 0) return
    setBusy(true)
    let ok = 0
    const failed: Array<{ number: string; reason: string }> = []
    for (const q of draftSelected) {
      try {
        await softDeleteQuotationDraft(ws.id, q.id)
        ok++
      } catch (err) {
        failed.push({ number: q.number, reason: (err as Error).message })
      }
    }
    setBusy(false)
    setConfirmDelete(false)
    if (ok > 0) toast.success(`${ok} draft${ok === 1 ? '' : 's'} deleted`, { description: 'Removed locally and queued for cloud deletion.' })
    for (const f of failed) toast.error(`Could not delete ${f.number}`, { description: f.reason })
    clearSelection()
  }

  /** Bulk-convert every ACCEPTED quotation in the selection into a draft invoice. */
  const runConvertAccepted = async () => {
    if (!ws || acceptedSelected.length === 0) return
    setBusy(true)
    let ok = 0
    const created: string[] = []
    const failed: Array<{ number: string; reason: string }> = []
    for (const q of acceptedSelected) {
      try {
        const { invoice } = await convertQuotationToInvoice(
          ws.id,
          company?.state_code ?? null,
          { enable_round_off: company?.enable_round_off ?? true },
          q.id,
        )
        ok++
        created.push(invoice.number)
      } catch (err) {
        failed.push({ number: q.number, reason: (err as Error).message })
      }
    }
    setBusy(false)
    if (ok > 0) {
      const preview = created.slice(0, 3).join(', ')
      toast.success(`${ok} invoice${ok === 1 ? '' : 's'} drafted from quotations`, {
        description: `${preview}${created.length > 3 ? ` + ${created.length - 3} more` : ''} — review and finalize when ready.`,
      })
    }
    for (const f of failed) toast.error(`Could not convert ${f.number}`, { description: f.reason })
    clearSelection()
  }

  const exportSelectedCsv = () => {
    const csv = toCsv(
      ['Number', 'Customer', 'Date', 'Valid until', 'Status', 'Total (Rs.)'],
      selectedRows.map((q) => [
        q.number,
        q.customer_name_snapshot ?? '',
        q.quotation_date,
        q.valid_until ?? '',
        q.status,
        (q.grand_total_paise / 100).toFixed(2),
      ]),
    )
    downloadCsv(`invoiceflow-quotations-selection-${today}.csv`, csv)
    toast.success(`Exported ${selectedRows.length} quotation${selectedRows.length === 1 ? '' : 's'}`, { description: 'CSV saved to your downloads folder.' })
  }

  /** Batch PDF export: one PDF per selected quotation, rendered locally (offline). */
  const runExportPdfs = async () => {
    if (selectedRows.length === 0) return
    setBusy(true)
    const { renderDocumentPdf, downloadPdf } = await import('@/lib/pdf/render')
    const { buildQuotationModel, pdfFileName } = await import('@/lib/pdf/document-model')
    let ok = 0
    const failed: Array<{ number: string; reason: string }> = []
    for (const q of selectedRows) {
      try {
        const [items, customer] = await Promise.all([
          getDb().quotation_items.where('quotation_id').equals(q.id).toArray(),
          getDb().customers.get(q.customer_id),
        ])
        const model = buildQuotationModel(q, items.sort((a, b) => a.position - b.position), company ?? null, customer)
        downloadPdf(renderDocumentPdf(model), pdfFileName(model))
        ok++
        // stagger so the browser queues each download instead of dropping them
        await new Promise((r) => setTimeout(r, 350))
      } catch (err) {
        failed.push({ number: q.number, reason: (err as Error).message })
      }
    }
    setBusy(false)
    if (ok > 0) toast.success(`${ok} PDF${ok === 1 ? '' : 's'} exported`, { description: ok > 1 ? 'Saved to your downloads folder — allow multiple downloads if your browser asks.' : 'Saved to your downloads folder.' })
    for (const f of failed) toast.error(`Could not export ${f.number}`, { description: f.reason })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} placeholder="Search number, customer…" className="pl-8" aria-label="Search quotations" />
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0) }}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{s}{counts ? ` (${counts[s]})` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => navigate('quotations/new')} className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" /> <span className="inline">New quotation</span>
          </Button>
        </div>
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
        <div className="space-y-3">
          {/* Mobile Card List (screens < md) */}
          <div className="space-y-2 md:hidden">
            {pageRows.map((q) => {
              const isSelected = selected.has(q.id)
              const expiringSoon = q.status === 'SENT' && Boolean(q.valid_until) && q.valid_until! <= addDaysStr(today, 7) && q.valid_until! >= today
              return (
                <div
                  key={q.id}
                  tabIndex={0}
                  onClick={() => navigate(`quotations/${q.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`quotations/${q.id}`) }}
                  className={cn(
                    'relative flex flex-col gap-2 rounded-xl border bg-card p-3.5 transition-colors cursor-pointer active:scale-[0.99]',
                    isSelected
                      ? 'border-emerald-500/50 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.12]'
                      : 'hover:border-primary/40'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRow(q.id)}
                          aria-label={`Select quotation ${q.number}`}
                        />
                      </div>
                      <span className="font-semibold text-sm text-foreground block truncate">{q.number}</span>
                    </div>
                    <StatusBadge status={q.status} />
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
                    <span className="truncate max-w-[180px] font-medium text-foreground/80">{q.customer_name_snapshot}</span>
                    <span className="tabular-nums">{formatDateDisplay(q.quotation_date)}</span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-0.5">
                    <div>
                      {q.valid_until ? (
                        <span className="text-muted-foreground">
                          Valid: {formatDateDisplay(q.valid_until)}
                          {expiringSoon && (
                            <span className="ml-1 inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              <Clock3 className="h-2.5 w-2.5" /> expiring
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    <span className="text-sm font-bold tabular-nums text-foreground">{formatMoney(q.grand_total_paise)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop Table (screens >= md) */}
          <div className="hidden md:block overflow-hidden rounded-xl border bg-card">
            <div className="max-h-[64vh] overflow-auto scrollbar-thin">
              <table className="w-full text-sm" aria-label="Quotations list">
                <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <Checkbox
                        checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
                        onCheckedChange={togglePage}
                        aria-label={pageAllSelected ? 'Deselect all on this page' : 'Select all on this page'}
                        className="align-middle"
                      />
                    </th>
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
                  {pageRows.map((q) => {
                    const isSelected = selected.has(q.id)
                    // warn when a sent quotation is within 7 days of expiry (and not already accepted/converted)
                    const expiringSoon = q.status === 'SENT' && Boolean(q.valid_until) && q.valid_until! <= addDaysStr(today, 7) && q.valid_until! >= today
                    return (
                      <tr
                        key={q.id}
                        tabIndex={0}
                        className={`group cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 ${isSelected ? 'bg-emerald-500/[0.07] hover:bg-emerald-500/10 dark:bg-emerald-500/[0.12] dark:hover:bg-emerald-500/[0.15]' : ''}`}
                        onClick={() => navigate(`quotations/${q.id}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') navigate(`quotations/${q.id}`) }}
                        aria-label={`Open quotation ${q.number}`}
                        aria-selected={isSelected}
                      >
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(q.id)}
                            aria-label={`Select quotation ${q.number}`}
                          />
                        </td>
                        <td className="px-4 py-3 font-medium">{q.number}</td>
                        <td className="max-w-48 truncate px-4 py-3 text-muted-foreground">{q.customer_name_snapshot}</td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted-foreground md:table-cell">{formatDateDisplay(q.quotation_date)}</td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted-foreground md:table-cell">
                          {formatDateDisplay(q.valid_until)}
                          {expiringSoon && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              <Clock3 className="h-2.5 w-2.5" aria-hidden="true" /> expiring
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{formatMoney(q.grand_total_paise)}</td>
                        <td className="px-2 py-3 text-muted-foreground/40 transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-400" aria-hidden="true">
                          <RowChevron className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-2.5 text-xs text-muted-foreground">
              <span>{filtered.length} quotations · page {page + 1} of {pages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedRows.length > 0 && (
        <div
          className="bulk-bar sticky bottom-20 lg:bottom-4 z-20 rounded-xl border border-emerald-500/30 bg-popover/95 p-3 shadow-lg shadow-emerald-950/10 backdrop-blur"
          role="toolbar"
          aria-label={`Bulk actions for ${selectedRows.length} selected quotations`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
              {selectedRows.length} selected
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">Value {formatMoney(selectedValue)}</span>
            {draftSelected.length > 0 && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                · {draftSelected.length} draft{draftSelected.length === 1 ? '' : 's'} ready to send
              </span>
            )}
            {acceptedSelected.length > 0 && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                · {acceptedSelected.length} accepted, ready to convert
              </span>
            )}
            <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-2 pt-1 sm:pt-0">
              <Button
                size="sm"
                className="h-8 gap-1.5"
                disabled={busy || draftSelected.length === 0}
                onClick={() => void runMarkSent()}
                title={draftSelected.length === 0 ? 'Select at least one draft quotation' : `Allocate official ${company?.quotation_prefix ?? 'QT'} numbers`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Mark {draftSelected.length > 0 ? `${draftSelected.length} draft${draftSelected.length === 1 ? '' : 's'}` : 'drafts'} sent
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
                disabled={busy || acceptedSelected.length === 0}
                onClick={() => void runConvertAccepted()}
                title={acceptedSelected.length === 0 ? 'Select at least one ACCEPTED quotation — only accepted quotes can become invoices' : `Draft invoices from ${acceptedSelected.length} accepted quotation${acceptedSelected.length === 1 ? '' : 's'}`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                Convert {acceptedSelected.length > 0 ? `${acceptedSelected.length} accepted` : 'accepted'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                disabled={busy || draftSelected.length === 0}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete drafts
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => void runExportPdfs()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileDown className="h-3.5 w-3.5" aria-hidden="true" />} PDFs
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={exportSelectedCsv}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2" onClick={clearSelection} aria-label="Clear selection">
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* delete drafts confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {draftSelected.length} draft quotation{draftSelected.length === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Draft quotations are removed locally and the deletion is queued to the cloud. Only drafts can be deleted — sent quotations stay for the record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep drafts</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
              onClick={(e) => { e.preventDefault(); void runDeleteDrafts() }}
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
              Delete {draftSelected.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        Sent quotations past their valid-until date expire automatically. Tip: select rows to mark sent, convert accepted quotes to invoices, or export PDFs/CSV in bulk.
      </p>
    </div>
  )
}
