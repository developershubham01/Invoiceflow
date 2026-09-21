'use client'

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { useActiveWorkspace } from '@/lib/hooks/app-hooks'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { navigate } from '@/lib/router'
import { INDIAN_STATES, isValidGstin, stateByCode, stateCodeFromGstin } from '@/lib/domain/gst'
import { customerSchema } from '@/lib/domain/schemas'
import { saveCustomer, softDeleteCustomer } from '@/lib/db/repositories'
import { formatMoney } from '@/lib/domain/money'
import { formatDateDisplay, fyStart, todayStr } from '@/lib/date'
import { toCsv, downloadCsv } from '@/lib/csv'
import { downloadPdf } from '@/lib/pdf/render'
import { renderStatementPdf, type StatementPdfEntry } from '@/lib/pdf/statement'
import { useCompany } from '@/lib/hooks/app-hooks'
import { toast } from 'sonner'
import { ArrowLeft, Building2, Download, FileDown, Mail, MapPin, Pencil, Phone, Plus, Receipt, Search, Trash2, UserRound } from 'lucide-react'
import type { Customer } from '@/lib/domain/types'

interface FormState {
  id?: string
  type: 'BUSINESS' | 'INDIVIDUAL'
  code: string
  business_name: string
  contact_person: string
  email: string
  phone: string
  gstin: string
  billing_address: string
  shipping_address: string
  state_code: string
  notes: string
}

const emptyForm: FormState = { type: 'BUSINESS', code: '', business_name: '', contact_person: '', email: '', phone: '', gstin: '', billing_address: '', shipping_address: '', state_code: '', notes: '' }

export function CustomersView({ detailId }: { detailId?: string }) {
  const ws = useActiveWorkspace()
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  const customers = useLiveQuery(async () => {
    if (!ws) return null
    return getDb().customers.where('workspace_id').equals(ws.id).filter((c) => !c.deleted_at).toArray()
  }, [ws?.id])

  const outstanding = useLiveQuery(async () => {
    if (!ws) return null
    const invoices = await getDb().invoices.where('workspace_id').equals(ws.id).filter((i) => !i.deleted_at).toArray()
    const map = new Map<string, number>()
    for (const inv of invoices) {
      if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') continue
      const bal = Math.max(0, inv.grand_total_paise - inv.paid_total_paise)
      map.set(inv.customer_id, (map.get(inv.customer_id) ?? 0) + bal)
    }
    return map
  }, [ws?.id])

  const selected = useMemo(() => customers?.find((c) => c.id === detailId) ?? null, [customers, detailId])

  const filtered = useMemo(() => {
    if (!customers) return []
    const q = query.trim().toLowerCase()
    return customers
      .filter((c) => !q || c.business_name.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || (c.gstin ?? '').toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.business_name.localeCompare(b.business_name))
  }, [customers, query])

  const openEdit = (c?: Customer) => {
    setForm(c ? {
      id: c.id, type: c.type, code: c.code ?? '', business_name: c.business_name, contact_person: c.contact_person ?? '',
      email: c.email ?? '', phone: c.phone ?? '', gstin: c.gstin ?? '',
      billing_address: c.billing_address ?? '', shipping_address: c.shipping_address ?? '',
      state_code: c.state_code ?? '', notes: c.notes ?? '',
    } : { ...emptyForm })
  }

  const submit = async () => {
    if (!ws || !form) return
    const parsed = customerSchema.safeParse(form)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid details')
      return
    }
    if (form.gstin && !isValidGstin(form.gstin)) {
      toast.error('Invalid GSTIN format (15 characters, e.g. 27AAACA1234A1Z5)')
      return
    }
    setSaving(true)
    try {
      const state = stateByCode(form.state_code)
      const saved = await saveCustomer(ws.id, {
        id: form.id,
        ...parsed.data,
        business_name: parsed.data.business_name,
        code: form.code.trim() || undefined,
        state_code: form.state_code || stateCodeFromGstin(form.gstin) || null,
        state_name: state?.name ?? null,
      } as Partial<Customer> & { business_name: string })
      toast.success(form.id ? 'Customer updated' : 'Customer added', { description: `${saved.code ?? ''} ${saved.business_name}` })
      setForm(null)
    } catch (err) {
      toast.error('Could not save customer', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async (c: Customer) => {
    if (!ws) return
    try {
      await softDeleteCustomer(ws.id, c.id)
      toast.success('Customer archived', { description: 'Past invoices keep their snapshot of this customer.' })
      navigate('customers')
    } catch (err) {
      toast.error('Could not archive customer', { description: (err as Error).message })
    }
  }

  // ---------- detail ----------
  if (selected) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('customers')}>
            <ArrowLeft className="h-4 w-4" /> Customers
          </Button>
          <span className="text-muted-foreground">/</span>
          <h2 className="text-sm font-semibold">{selected.business_name}</h2>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(selected)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => navigate('invoices/new')}>
              <Plus className="h-3.5 w-3.5" /> New invoice
            </Button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
          <Card>
            <CardContent className="space-y-3 p-5 text-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  {selected.type === 'BUSINESS' ? <Building2 className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
                </div>
                <div>
                  <p className="font-semibold">{selected.business_name}</p>
                  <p className="text-xs text-muted-foreground">{selected.code} · {selected.type}</p>
                </div>
              </div>
              <InfoRow icon={Phone} value={selected.phone} />
              <InfoRow icon={Mail} value={selected.email} />
              <InfoRow icon={Receipt} value={selected.gstin ? `GSTIN ${selected.gstin}` : null} />
              <InfoRow icon={MapPin} value={[selected.billing_address, stateByCode(selected.state_code)?.name].filter(Boolean).join(' · ') || null} />
              {selected.contact_person && <p className="text-xs text-muted-foreground">Contact: {selected.contact_person}</p>}
              {selected.notes && <p className="rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">{selected.notes}</p>}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="mt-2 w-full gap-1.5 text-destructive hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" /> Archive customer
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive {selected.business_name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The customer is hidden from new documents but historical invoices keep their snapshot. This is a soft delete.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void doDelete(selected)}>Archive</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          <CustomerHistory customerId={selected.id} />
        </div>

        <CustomerStatement customerId={selected.id} customerName={selected.business_name} customerCode={selected.code} customerGstin={selected.gstin} />

        {form && <CustomerFormDialog form={form} setForm={setForm} saving={saving} onSubmit={submit} />}
      </div>
    )
  }

  // ---------- list ----------
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, GSTIN, code…" className="pl-8" aria-label="Search customers" />
        </div>
        <Button onClick={() => openEdit()} className="gap-1.5">
          <Plus className="h-4 w-4" /> New customer
        </Button>
      </div>

      {!customers ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={query ? 'No customers match' : 'No customers yet'}
          description={query ? 'Try a different search.' : 'Add customers to start issuing invoices and quotations.'}
          action={{ label: 'Add customer', onClick: () => openEdit() }}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer py-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              onClick={() => navigate(`customers/${c.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`customers/${c.id}`) }}
              aria-label={`Open customer ${c.business_name}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      {c.type === 'BUSINESS' ? <Building2 className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{c.business_name}</p>
                      <p className="text-xs text-muted-foreground">{c.code}</p>
                    </div>
                  </div>
                  {c.gstin && <Badge variant="outline" className="shrink-0 text-[10px]">GST</Badge>}
                </div>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {c.phone && <p className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {c.phone}</p>}
                  {c.state_code && <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /> {stateByCode(c.state_code)?.name ?? c.state_code}</p>}
                </div>
                {outstanding && (outstanding.get(c.id) ?? 0) > 0 && (
                  <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-400">
                    Outstanding: {formatMoney(outstanding.get(c.id)!)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {form && <CustomerFormDialog form={form} setForm={setForm} saving={saving} onSubmit={submit} />}
    </div>
  )
}

function InfoRow({ icon: Icon, value }: { icon: typeof Phone; value: string | null | undefined }) {
  if (!value) return null
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="break-words">{value}</span>
    </p>
  )
}

function CustomerHistory({ customerId }: { customerId: string }) {
  const rows = useLiveQuery(async () => {
    const [invoices, quotations, payments] = await Promise.all([
      getDb().invoices.where('customer_id').equals(customerId).filter((i) => !i.deleted_at).toArray(),
      getDb().quotations.where('customer_id').equals(customerId).filter((q) => !q.deleted_at).toArray(),
      getDb().payments.where('invoice_id').anyOf((await getDb().invoices.where('customer_id').equals(customerId).toArray()).map((i) => i.id)).toArray(),
    ])
    const tx: Array<{ id: string; kind: string; number: string; date: string; amount: number; status: string; path: string }> = [
      ...invoices.map((i) => ({ id: i.id, kind: 'Invoice', number: i.number, date: i.invoice_date, amount: i.grand_total_paise, status: i.status, path: `invoices/${i.id}` })),
      ...quotations.map((q) => ({ id: q.id, kind: 'Quotation', number: q.number, date: q.quotation_date, amount: q.grand_total_paise, status: q.status, path: `quotations/${q.id}` })),
    ]
    void payments
    return tx.sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number))
  }, [customerId])

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 text-sm font-semibold">Transaction history</div>
        {!rows ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">No documents for this customer yet.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
            <table className="w-full text-sm">
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    className="cursor-pointer border-t transition-colors hover:bg-muted/40"
                    onClick={() => navigate(r.path)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(r.path) }}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{r.number}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{r.kind}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateDisplay(r.date)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{r.status.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums">{formatMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

type StatementEntry = {
  key: string
  date: string
  kind: 'Invoice' | 'Payment'
  number: string
  detail: string
  debit: number
  credit: number
  balance: number
  path: string
}

/** Account statement: chronological debits (invoices) and credits (payments) with a running balance. */
function CustomerStatement({ customerId, customerName, customerCode, customerGstin }: { customerId: string; customerName: string; customerCode: string | null; customerGstin: string | null }) {
  const [from, setFrom] = useState(fyStart(todayStr()))
  const [to, setTo] = useState(todayStr())
  const company = useCompany()

  const entries = useLiveQuery(async (): Promise<StatementEntry[] | null> => {
    const invoices = await getDb().invoices.where('customer_id').equals(customerId).filter((i) => !i.deleted_at).toArray()
    const payable = invoices.filter((i) => i.status !== 'DRAFT' && i.status !== 'CANCELLED')
    const payments = await getDb().payments.where('invoice_id').anyOf(payable.map((i) => i.id)).filter((p) => !p.deleted_at).toArray()
    const numberById = new Map(payable.map((i) => [i.id, i.number]))

    const rows: Omit<StatementEntry, 'balance'>[] = [
      ...payable
        .filter((i) => i.invoice_date >= from && i.invoice_date <= to)
        .map((i) => ({
          key: `inv-${i.id}`,
          date: i.invoice_date,
          kind: 'Invoice' as const,
          number: i.number,
          detail: i.status === 'PAID' ? 'Tax invoice (paid)' : 'Tax invoice',
          debit: i.grand_total_paise,
          credit: 0,
          path: `invoices/${i.id}`,
        })),
      ...payments
        .filter((p) => p.paid_at >= from && p.paid_at <= to)
        .map((p) => ({
          key: `pay-${p.id}`,
          date: p.paid_at,
          kind: 'Payment' as const,
          number: numberById.get(p.invoice_id) ?? '—',
          detail: [p.method.toLowerCase(), p.reference].filter(Boolean).join(' · '),
          debit: 0,
          credit: p.amount_paise,
          path: `invoices/${p.invoice_id}`,
        })),
    ]
    rows.sort((a, b) => (a.date + a.kind).localeCompare(b.date + b.kind))
    let running = 0
    return rows.map((r) => {
      running += r.debit - r.credit
      return { ...r, balance: running }
    })
  }, [customerId, from, to])

  const totals = useMemo(() => {
    const list = entries ?? []
    const invoiced = list.reduce((s, e) => s + e.debit, 0)
    const collected = list.reduce((s, e) => s + e.credit, 0)
    return { invoiced, collected, outstanding: invoiced - collected }
  }, [entries])

  const exportCsv = () => {
    const list = entries ?? []
    const csv = toCsv(
      ['Date', 'Type', 'Document', 'Detail', 'Debit (Rs.)', 'Credit (Rs.)', 'Balance (Rs.)'],
      [
        ...list.map((e) => [
          e.date,
          e.kind,
          e.number,
          e.detail,
          (e.debit / 100).toFixed(2),
          (e.credit / 100).toFixed(2),
          (e.balance / 100).toFixed(2),
        ]),
        ['', 'TOTAL', '', '', (totals.invoiced / 100).toFixed(2), (totals.collected / 100).toFixed(2), (totals.outstanding / 100).toFixed(2)],
      ],
    )
    downloadCsv(`invoiceflow-statement-${customerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${from}_to_${to}.csv`, csv)
    toast.success('Statement exported', { description: 'CSV saved to your downloads folder.' })
  }

  const downloadStatementPdf = () => {
    const list = entries ?? []
    if (!company) {
      toast.error('Set up your company first', { description: 'Company details appear on the statement header.' })
      return
    }
    const pdfEntries: StatementPdfEntry[] = list.map((e) => ({
      date: e.date, kind: e.kind, number: e.number, detail: e.detail,
      debitPaise: e.debit, creditPaise: e.credit, balancePaise: e.balance,
    }))
    const doc = renderStatementPdf({
      company: {
        name: company.name, gstin: company.gstin, addressLine1: company.address_line1,
        city: company.city, stateName: company.state_name, phone: company.phone, email: company.email,
      },
      customer: { name: customerName, code: customerCode, gstin: customerGstin },
      period: { from, to },
      entries: pdfEntries,
      totals: { invoicedPaise: totals.invoiced, collectedPaise: totals.collected, outstandingPaise: totals.outstanding },
    })
    downloadPdf(doc, `invoiceflow-statement-${customerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${from}_to_${to}.pdf`)
    toast.success('Statement PDF saved', { description: 'Works offline — rendered on this device.' })
  }

  const swapped = from > to

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Account statement</h3>
          <Badge variant="outline" className="text-[10px]">Debits & credits</Badge>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Statement from date"
              className="h-8 w-36 text-xs"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Statement to date"
              className="h-8 w-36 text-xs"
            />
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={downloadStatementPdf} disabled={!entries || entries.length === 0 || !company}>
              <FileDown className="h-3.5 w-3.5" /> PDF
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={exportCsv} disabled={!entries || entries.length === 0}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
        </div>

        {swapped && (
          <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            The from date is after the to date — no entries will match.
          </p>
        )}

        <div className="grid grid-cols-3 divide-x border-b text-sm">
          <div className="px-4 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Invoiced</p>
            <p className="font-semibold tabular-nums">{formatMoney(totals.invoiced)}</p>
          </div>
          <div className="px-4 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Collected</p>
            <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(totals.collected)}</p>
          </div>
          <div className="px-4 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Outstanding</p>
            <p className={`font-semibold tabular-nums ${totals.outstanding > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              {formatMoney(totals.outstanding)}
            </p>
          </div>
        </div>

        {!entries ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">No invoices or payments in this period.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">Date</th>
                  <th className="px-4 py-2 font-semibold">Document</th>
                  <th className="px-4 py-2 text-right font-semibold">Debit</th>
                  <th className="px-4 py-2 text-right font-semibold">Credit</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.key}
                    tabIndex={0}
                    className="cursor-pointer border-t transition-colors hover:bg-muted/40"
                    onClick={() => navigate(e.path)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') navigate(e.path) }}
                    aria-label={`${e.kind} ${e.number} on ${formatDateDisplay(e.date)}`}
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">{formatDateDisplay(e.date)}</td>
                    <td className="px-4 py-2">
                      <span className="font-medium">{e.number}</span>
                      <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        e.kind === 'Invoice'
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                      }`}>
                        {e.kind}
                      </span>
                      {e.detail && <span className="ml-2 text-xs text-muted-foreground">{e.detail}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{e.debit ? formatMoney(e.debit) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{e.credit ? formatMoney(e.credit) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums">{formatMoney(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CustomerFormDialog({
  form, setForm, saving, onSubmit,
}: {
  form: FormState
  setForm: (f: FormState | null) => void
  saving: boolean
  onSubmit: () => void
}) {
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch })
  return (
    <Dialog open onOpenChange={(v) => !v && setForm(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Edit customer' : 'New customer'}</DialogTitle>
          <DialogDescription>Saved locally first — syncs automatically when online.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => set({ type: v as 'BUSINESS' | 'INDIVIDUAL' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BUSINESS">Business</SelectItem>
                <SelectItem value="INDIVIDUAL">Individual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name *</Label>
            <Input id="c-name" value={form.business_name} onChange={(e) => set({ business_name: e.target.value })} placeholder="Business or person" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-code">Customer code</Label>
            <Input id="c-code" value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="Auto (CUS-0001)" />
            <p className="text-[11px] text-muted-foreground">Leave blank to auto-number. Your own ledger code is allowed.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-contact">Contact person</Label>
            <Input id="c-contact" value={form.contact_person} onChange={(e) => set({ contact_person: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-phone">Phone</Label>
            <Input id="c-phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="98XXX XXXXX" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-email">Email</Label>
            <Input id="c-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-gstin">GSTIN</Label>
            <Input id="c-gstin" value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} placeholder="27AAACA1234A1Z5" />
          </div>
          <div className="space-y-1.5">
            <Label>State</Label>
            <Select value={form.state_code} onValueChange={(v) => set({ state_code: v })}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="c-billing">Billing address</Label>
            <Textarea id="c-billing" rows={2} value={form.billing_address} onChange={(e) => set({ billing_address: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="c-shipping">Shipping address (if different)</Label>
            <Textarea id="c-shipping" rows={2} value={form.shipping_address} onChange={(e) => set({ shipping_address: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="c-notes">Notes</Label>
            <Textarea id="c-notes" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={saving || !form.business_name.trim()}>{saving ? 'Saving…' : 'Save customer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
