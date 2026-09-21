'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { useActiveWorkspace, useCompany } from '@/lib/hooks/app-hooks'
import { useAppStore } from '@/lib/stores/app-store'
import { StatusBadge } from '@/components/app/status-badge'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { navigate } from '@/lib/router'
import { formatMoney } from '@/lib/domain/money'
import { formatDateDisplay, todayStr } from '@/lib/date'
import { finalizeInvoice, softDeleteInvoiceDraft } from '@/lib/db/repositories'
import { buildPaymentReminderText, isInvoiceOverdue, openWhatsAppReminder } from '@/lib/reminder'
import { toCsv, downloadCsv } from '@/lib/csv'
import { toast } from 'sonner'
import {
  AlertTriangle, BadgeCheck, ChevronLeft, ChevronRight, ChevronRight as RowChevron,
  Copy, Download, Loader2, MessageCircle, MessageSquareText, Phone, Plus, Receipt, Search, Trash2, X,
} from 'lucide-react'

const PAGE_SIZE = 10
const STATUS_ORDER = ['DRAFT', 'FINALIZED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']
/** Pseudo-status: issued invoices past their due date with an outstanding balance. */
const isOverdueRow = (i: { status: string; due_date: string | null; paid_total_paise: number; grand_total_paise: number }, today: string) =>
  i.status !== 'DRAFT' && i.status !== 'CANCELLED' && i.status !== 'PAID' && Boolean(i.due_date && i.due_date < today) && i.paid_total_paise < i.grand_total_paise

export function InvoicesView() {
  const ws = useActiveWorkspace()
  const company = useCompany()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const today = todayStr()

  // one-shot: arrive pre-filtered when another view (dashboard banner, KPI card) asks for overdue.
  // Read synchronously during lazy init, then clear the hint from the store post-mount.
  const [status, setStatus] = useState<string>(() => {
    const preset = useAppStore.getState().viewParams.status
    return preset && preset.length > 0 ? preset : 'ALL'
  })
  // Clear the one-shot hint after the view has settled. The app remounts views on
  // navigation (AppShell view-enter re-key), so an immediate clear would be read by
  // the second mount as "no preset" — a deferred clear lets every mount see it.
  useEffect(() => {
    const t = setTimeout(() => {
      const { viewParams } = useAppStore.getState()
      if (viewParams.status !== undefined) {
        const { status: _drop, ...rest } = viewParams
        useAppStore.getState().setViewParams(rest)
      }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const invoices = useLiveQuery(async () => {
    if (!ws) return null
    const [rows, customers] = await Promise.all([
      getDb().invoices.where('workspace_id').equals(ws.id).filter((i) => !i.deleted_at).toArray(),
      getDb().customers.where('workspace_id').equals(ws.id).toArray(),
    ])
    const byId = new Map(customers.map((c) => [c.id, { phone: c.phone, contact_person: c.contact_person, business_name: c.business_name }]))
    return { rows, byId }
  }, [ws?.id])

  const filtered = useMemo(() => {
    const rows = invoices?.rows ?? []
    const q = query.trim().toLowerCase()
    return rows
      .filter((i) => (status === 'ALL' ? true : status === 'OVERDUE' ? isOverdueRow(i, today) : i.status === status))
      .filter((i) =>
        !q ||
        i.number.toLowerCase().includes(q) ||
        (i.customer_name_snapshot ?? '').toLowerCase().includes(q) ||
        formatMoney(i.grand_total_paise).includes(q))
      .sort((a, b) => (b.invoice_date + b.number).localeCompare(a.invoice_date + a.number))
  }, [invoices, query, status, today])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const counts = useMemo(() => {
    const rows = invoices?.rows ?? []
    if (!invoices) return null
    const c: Record<string, number> = { ALL: rows.length, OVERDUE: rows.filter((i) => isOverdueRow(i, today)).length }
    for (const s of STATUS_ORDER) c[s] = rows.filter((i) => i.status === s).length
    return c
  }, [invoices, today])

  // ---- bulk selection ------------------------------------------------------
  const selectedRows = useMemo(() => filtered.filter((i) => selected.has(i.id)), [filtered, selected])
  const draftSelected = selectedRows.filter((i) => i.status === 'DRAFT')
  const selectedValue = selectedRows.reduce((s, i) => s + i.grand_total_paise, 0)
  /** Reminder-eligible: issued with an outstanding balance (overdue or upcoming-due). */
  const remindable = useMemo(
    () => selectedRows.filter((i) => (i.status === 'FINALIZED' || i.status === 'PARTIALLY_PAID') && i.grand_total_paise > i.paid_total_paise),
    [selectedRows],
  )
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
  const runFinalizeDrafts = async () => {
    if (!ws || !company || draftSelected.length === 0) return
    setBusy(true)
    let ok = 0
    const failed: Array<{ number: string; reason: string }> = []
    for (const inv of draftSelected) {
      try {
        await finalizeInvoice(ws.id, company.invoice_prefix, inv.id)
        ok++
      } catch (err) {
        failed.push({ number: inv.number, reason: (err as Error).message })
      }
    }
    setBusy(false)
    if (ok > 0) toast.success(`${ok} draft${ok === 1 ? '' : 's'} finalized`, { description: 'Official numbers allocated — documents are now locked.' })
    for (const f of failed) toast.error(`Could not finalize ${f.number}`, { description: f.reason })
    clearSelection()
  }

  const runDeleteDrafts = async () => {
    if (!ws || draftSelected.length === 0) return
    setBusy(true)
    let ok = 0
    const failed: Array<{ number: string; reason: string }> = []
    for (const inv of draftSelected) {
      try {
        await softDeleteInvoiceDraft(ws.id, inv.id)
        ok++
      } catch (err) {
        failed.push({ number: inv.number, reason: (err as Error).message })
      }
    }
    setBusy(false)
    setConfirmDelete(false)
    if (ok > 0) toast.success(`${ok} draft${ok === 1 ? '' : 's'} deleted`, { description: 'Removed locally and queued for cloud deletion.' })
    for (const f of failed) toast.error(`Could not delete ${f.number}`, { description: f.reason })
    clearSelection()
  }

  const exportSelectedCsv = () => {
    const csv = toCsv(
      ['Number', 'Customer', 'Invoice date', 'Due date', 'Status', 'Total (Rs.)', 'Paid (Rs.)', 'Balance (Rs.)'],
      selectedRows.map((i) => [
        i.number,
        i.customer_name_snapshot ?? '',
        i.invoice_date,
        i.due_date ?? '',
        i.status,
        (i.grand_total_paise / 100).toFixed(2),
        (i.paid_total_paise / 100).toFixed(2),
        (Math.max(0, i.grand_total_paise - i.paid_total_paise) / 100).toFixed(2),
      ]),
    )
    downloadCsv(`invoiceflow-invoices-selection-${today}.csv`, csv)
    toast.success(`Exported ${selectedRows.length} invoice${selectedRows.length === 1 ? '' : 's'}`, { description: 'CSV saved to your downloads folder.' })
  }

  // ---- bulk reminders ------------------------------------------------------
  const reminderFor = (inv: (typeof remindable)[number]) => {
    const cust = invoices?.byId.get(inv.customer_id)
    return buildPaymentReminderText(
      inv,
      { contact_person: cust?.contact_person ?? null, business_name: cust?.business_name ?? inv.customer_name_snapshot ?? null },
      company,
    )
  }

  /** Reminder plus the customer's own phone (for the wa.me target). */
  const reminderWithPhone = (inv: (typeof remindable)[number]) => ({
    text: reminderFor(inv),
    phone: invoices?.byId.get(inv.customer_id)?.phone ?? null,
  })

  const copyBulkReminders = async () => {
    const joined = remindable.map((i) => reminderWithPhone(i).text).join('\n\n\u2014\u2014\u2014\n\n')
    try {
      await navigator.clipboard.writeText(joined)
      toast.success(`${remindable.length} reminder${remindable.length === 1 ? '' : 's'} copied`, { description: 'One block per invoice, separated by a divider — paste anywhere.' })
    } catch {
      toast.error('Could not access the clipboard in this browser')
    }
  }

  const openBulkWhatsApp = () => {
    // most overdue first, then largest balance — open one tab, not many
    const target = [...remindable].sort((a, b) => {
      const ao = a.due_date ?? '9999-12-31'
      const bo = b.due_date ?? '9999-12-31'
      return ao.localeCompare(bo) || (b.grand_total_paise - b.paid_total_paise) - (a.grand_total_paise - a.paid_total_paise)
    })[0]
    const { text, phone } = reminderWithPhone(target)
    const resolved = openWhatsAppReminder(phone, text)
    toast.success(`Opening WhatsApp for ${target.number}`, { description: resolved ? 'Reminder pre-filled — just press send.' : 'No number saved on this customer — choose the contact in WhatsApp.' })
  }

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
            <SelectItem value="OVERDUE">Overdue{counts ? ` (${counts.OVERDUE})` : ''}</SelectItem>
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
          <div className="max-h-[64vh] overflow-auto scrollbar-thin">
            <table className="w-full text-sm" aria-label="Invoices list">
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
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Dates</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                  <th className="w-8 px-2 py-2.5" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((inv) => {
                  const overdue = inv.status !== 'DRAFT' && inv.status !== 'CANCELLED' && Boolean(inv.due_date && inv.due_date < today && inv.paid_total_paise < inv.grand_total_paise)
                  const provisional = inv.number.startsWith('DRAFT-')
                  const isSelected = selected.has(inv.id)
                  return (
                    <tr
                      key={inv.id}
                      tabIndex={0}
                      className={`group cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 ${isSelected ? 'bg-emerald-500/[0.07] hover:bg-emerald-500/10 dark:bg-emerald-500/[0.12] dark:hover:bg-emerald-500/[0.15]' : ''}`}
                      onClick={() => navigate(`invoices/${inv.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`invoices/${inv.id}`) }}
                      aria-label={`Open invoice ${inv.number}`}
                      aria-selected={isSelected}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRow(inv.id)}
                          aria-label={`Select invoice ${inv.number}`}
                        />
                      </td>
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

      {selectedRows.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          Invoices past their due date with a balance are marked overdue. Tip: select rows to finalize or delete drafts in bulk.
        </p>
      )}

      {/* bulk action bar */}
      {selectedRows.length > 0 && (
        <div
          className="bulk-bar sticky bottom-3 z-20 rounded-xl border border-emerald-500/30 bg-popover/95 p-3 shadow-lg shadow-emerald-950/10 backdrop-blur"
          role="toolbar"
          aria-label={`Bulk actions for ${selectedRows.length} selected invoices`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
              {selectedRows.length} selected
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">Value {formatMoney(selectedValue)}</span>
            {draftSelected.length > 0 && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                · {draftSelected.length} draft{draftSelected.length === 1 ? '' : 's'} ready to finalize
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {remindable.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300">
                      <MessageCircle className="h-3.5 w-3.5" /> Remind ({remindable.length})
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="text-xs">Payment reminders</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void copyBulkReminders()} className="gap-2">
                      <Copy className="h-4 w-4" />
                      <span>Copy {remindable.length} reminder{remindable.length === 1 ? '' : 's'}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={openBulkWhatsApp} className="gap-2">
                      <MessageSquareText className="h-4 w-4 text-emerald-600" />
                      <span>Open in WhatsApp (most overdue)</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled className="gap-2 text-xs text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />
                      {remindable.filter((i) => isInvoiceOverdue(i)).length} overdue · {remindable.length - remindable.filter((i) => isInvoiceOverdue(i)).length} due later
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                size="sm"
                className="h-8 gap-1.5"
                disabled={busy || draftSelected.length === 0 || !company}
                onClick={() => void runFinalizeDrafts()}
                title={draftSelected.length === 0 ? 'Select at least one draft invoice' : company ? `Allocate official ${company.invoice_prefix ?? 'INV'} numbers` : 'Set up your company first'}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
                Finalize {draftSelected.length > 0 ? `${draftSelected.length} draft${draftSelected.length === 1 ? '' : 's'}` : 'drafts'}
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
            <AlertDialogTitle>Delete {draftSelected.length} draft invoice{draftSelected.length === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Drafts are removed locally and the deletion is queued to the cloud. Only draft invoices can be deleted — finalized documents must be cancelled instead.
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
    </div>
  )
}
