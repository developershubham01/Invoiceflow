'use client'

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { useActiveWorkspace, useCompany } from '@/lib/hooks/app-hooks'
import { StatusBadge } from '@/components/app/status-badge'
import { PdfPreviewDialog } from '@/components/app/pdf-preview-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { chargesFromJson } from '@/lib/db/row-types'
import { cancelInvoice, finalizeInvoice, recordPayment, softDeleteInvoiceDraft } from '@/lib/db/repositories'
import { buildInvoiceModel } from '@/lib/pdf/document-model'
import { formatMoney, formatMoneyPlain } from '@/lib/domain/money'
import { formatDateDisplay, todayStr } from '@/lib/date'
import { toast } from 'sonner'
import { navigate } from '@/lib/router'
import {
  ArrowLeft, BadgeCheck, Ban, Copy, FileDown, History, MessageCircle, Pencil, Printer, Trash2, Wallet, XCircle,
} from 'lucide-react'
import type { PaymentMethod } from '@/lib/domain/types'

export function InvoiceDetailView({ id }: { id: string }) {
  const ws = useActiveWorkspace()
  const company = useCompany()
  const [pdfOpen, setPdfOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const data = useLiveQuery(async () => {
    if (!ws) return null
    const invoice = await getDb().invoices.get(id)
    if (!invoice || invoice.workspace_id !== ws.id) return null
    const [items, payments, customer, audit] = await Promise.all([
      getDb().invoice_items.where('invoice_id').equals(id).toArray(),
      getDb().payments.where('invoice_id').equals(id).filter((p) => !p.deleted_at).toArray(),
      getDb().customers.get(invoice.customer_id),
      getDb().audit_logs.where('[entity_type+entity_id]').equals(['invoice', id]).toArray(),
    ])
    return {
      invoice, items: items.sort((a, b) => a.position - b.position),
      payments: payments.sort((a, b) => b.paid_at.localeCompare(a.paid_at)),
      customer, audit: audit.sort((a, b) => b.at.localeCompare(a.at)),
    }
  }, [ws?.id, id])

  const model = useMemo(() => {
    if (!data) return null
    return buildInvoiceModel(data.invoice, data.items, company ?? null, data.customer)
  }, [data, company])

  if (!ws) return null
  if (!data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('invoices')}>
          <ArrowLeft className="h-4 w-4" /> Back to invoices
        </Button>
        <Card><CardContent className="py-14 text-center text-sm text-muted-foreground">Invoice not found (it may belong to another workspace).</CardContent></Card>
      </div>
    )
  }

  const inv = data.invoice
  const balance = Math.max(0, inv.grand_total_paise - inv.paid_total_paise)
  const overdue = inv.status !== 'DRAFT' && inv.status !== 'CANCELLED' && Boolean(inv.due_date && inv.due_date < todayStr()) && balance > 0
  const charges = chargesFromJson(inv.charges_json)
  const isDraft = inv.status === 'DRAFT'

  const doFinalize = async () => {
    if (!company) return
    setBusy(true)
    try {
      const finalized = await finalizeInvoice(ws.id, company.invoice_prefix, id)
      toast.success('Invoice finalized', { description: `${finalized.number} — the document is now immutable.` })
    } catch (err) {
      toast.error('Could not finalize', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const doCancel = async () => {
    setBusy(true)
    try {
      await cancelInvoice(ws.id, id)
      toast.success('Invoice cancelled', { description: `${inv.number} is now cancelled.` })
    } catch (err) {
      toast.error('Could not cancel', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    try {
      await softDeleteInvoiceDraft(ws.id, id)
      toast.success('Draft deleted')
      navigate('invoices')
    } catch (err) {
      toast.error('Could not delete', { description: (err as Error).message })
    }
  }

  const doDuplicate = async () => {
    try {
      const draft = {
        customer_id: inv.customer_id,
        invoice_date: todayStr(),
        due_date: null,
        place_of_supply_code: inv.place_of_supply_code,
        price_includes_tax: inv.price_includes_tax,
        items: data.items.map((it) => ({
          id: crypto.randomUUID(), description: it.description, hsn_sac: it.hsn_sac, qty_milli: it.qty_milli,
          unit: it.unit, unit_price_paise: it.unit_price_paise, discount_bps: it.discount_bps, gst_rate_bps: it.gst_rate_bps,
        })),
        charges: charges,
        notes: inv.notes, terms: inv.terms,
      }
      const { saveInvoiceDraft } = await import('@/lib/db/repositories')
      const copy = await saveInvoiceDraft(ws.id, company?.state_code ?? null, { price_includes_tax: inv.price_includes_tax, enable_round_off: company?.enable_round_off ?? true }, draft)
      toast.success('Duplicated as new draft', { description: copy.number })
      navigate(`invoices/${copy.id}`)
    } catch (err) {
      toast.error('Could not duplicate', { description: (err as Error).message })
    }
  }

  /** WhatsApp-ready payment reminder text (India use case): polite, factual, copy-to-clipboard. */
  const doCopyReminder = async () => {
    const cust = data.customer
    const days = inv.due_date ? Math.max(0, Math.round((Date.parse(todayStr()) - Date.parse(inv.due_date)) / 86_400_000)) : 0
    const lines = [
      `Hello ${cust?.contact_person || cust?.business_name || 'there'},`,
      '',
      overdue
        ? `Gentle reminder that invoice ${inv.number}${inv.due_date ? ` (due ${formatDateDisplay(inv.due_date)})` : ''} is ${days} day${days === 1 ? '' : 's'} overdue.`
        : `This is a gentle reminder about invoice ${inv.number}${inv.due_date ? ` (due ${formatDateDisplay(inv.due_date)})` : ''}.`,
      '',
      `Invoice amount: Rs. ${formatMoneyPlain(inv.grand_total_paise)}`,
      inv.paid_total_paise > 0 ? `Already paid: Rs. ${formatMoneyPlain(inv.paid_total_paise)}` : '',
      `Balance due: Rs. ${formatMoneyPlain(balance)}`,
      company ? `Pay to: ${company.bank_name ?? ''}${company.bank_account ? ` A/C ${company.bank_account}` : ''}${company.bank_ifsc ? ` (${company.bank_ifsc})` : ''}`.trim() : '',
      '',
      'Kindly arrange the payment at your earliest convenience. Please ignore if already paid — thank you!',
      company?.name ? `— ${company.name}` : '',
    ].filter((l) => l !== '')
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success('Reminder copied', { description: 'Paste it into WhatsApp, SMS or email.' })
    } catch {
      toast.error('Could not access the clipboard in this browser')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('invoices')}>
          <ArrowLeft className="h-4 w-4" /> Invoices
        </Button>
        <span className="text-muted-foreground">/</span>
        <h2 className="text-sm font-semibold">{inv.number}</h2>
        <StatusBadge status={inv.status} overdue={overdue} className="ml-1" />
        {inv.sync_state === 'pending' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">Pending sync</span>}
        {inv.sync_state === 'synced' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">Synced</span>}
        {inv.sync_state === 'conflict' && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-400">Conflict — resolve in Settings</span>}

        <div className="ml-auto flex flex-wrap gap-2">
          {isDraft && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`invoices/edit/${inv.id}`)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" className="gap-1.5" disabled={busy}>
                    <BadgeCheck className="h-3.5 w-3.5" /> Finalize
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Finalize this invoice?</AlertDialogTitle>
                    <AlertDialogDescription>
                      An official number will be allocated ({company?.invoice_prefix ?? 'INV'}/FY/0001) and the document becomes
                      immutable. Corrections require duplicating it as a new draft.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void doFinalize()}>Finalize invoice</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => void doDelete()}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </>
          )}
          {!isDraft && inv.status !== 'CANCELLED' && (
            <Button size="sm" className="gap-1.5" onClick={() => setPayOpen(true)} disabled={balance === 0}>
              <Wallet className="h-3.5 w-3.5" /> Record payment
            </Button>
          )}
          {!isDraft && balance > 0 && inv.status !== 'CANCELLED' && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void doCopyReminder()}>
              <MessageCircle className="h-3.5 w-3.5" /> Reminder
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPdfOpen(true)}>
            <Printer className="h-3.5 w-3.5" /> PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void doDuplicate()}>
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </Button>
          {(inv.status === 'FINALIZED' || inv.status === 'PARTIALLY_PAID') && inv.paid_total_paise === 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
                  <XCircle className="h-3.5 w-3.5" /> Cancel invoice
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel {inv.number}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The number stays allocated for audit purposes. Cancelled invoices cannot be edited or paid.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep invoice</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void doCancel()}>Cancel invoice</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.8fr_1fr]">
        <div className="space-y-5">
          {/* document summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{inv.customer_name_snapshot}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    GSTIN: {inv.customer_gstin_snapshot ?? '—'} · Place of supply: {inv.place_of_supply_code ?? '—'}
                    {' · '}{inv.tax_mode === 'INTER' ? 'Inter-state (IGST)' : 'Intra-state (CGST+SGST)'}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>Issued {formatDateDisplay(inv.invoice_date)}</p>
                  {inv.due_date && <p>Due {formatDateDisplay(inv.due_date)}</p>}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm" aria-label="Invoice line items">
                  <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="hidden px-3 py-2 font-medium sm:table-cell">HSN</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Rate</th>
                      <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Taxable</th>
                      <th className="hidden px-3 py-2 text-right font-medium md:table-cell">GST</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.id} className="border-t">
                        <td className="max-w-64 px-3 py-2.5">
                          <p className="truncate font-medium">{it.description}</p>
                          {it.discount_bps > 0 && <p className="text-xs text-muted-foreground">Discount {(it.discount_bps / 100).toFixed(1)}%</p>}
                        </td>
                        <td className="hidden px-3 py-2.5 text-muted-foreground sm:table-cell">{it.hsn_sac ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{(it.qty_milli / 1000).toString()} {it.unit}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatMoney(it.unit_price_paise)}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell">{formatMoney(it.taxable_paise)}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell">
                          {formatMoney(it.tax_paise)} <span className="text-xs text-muted-foreground">({it.gst_rate_bps / 100}%)</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{formatMoney(it.total_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* totals */}
              <div className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
                <Row label="Subtotal" value={formatMoney(inv.subtotal_gross_paise)} />
                {inv.discount_total_paise > 0 && <Row label="Discount" value={`− ${formatMoney(inv.discount_total_paise)}`} />}
                <Row label="Taxable value" value={formatMoney(inv.taxable_total_paise)} />
                {inv.tax_mode === 'INTRA' ? (
                  <>
                    <Row label="CGST" value={formatMoney(inv.cgst_paise)} />
                    <Row label="SGST/UTGST" value={formatMoney(inv.sgst_paise)} />
                  </>
                ) : (
                  <Row label="IGST" value={formatMoney(inv.igst_paise)} />
                )}
                {charges.map((c) => <Row key={c.id} label={c.label} value={formatMoney(c.amount_paise)} />)}
                {inv.charges_tax_paise > 0 && <Row label="Tax on charges" value={formatMoney(inv.charges_tax_paise)} />}
                {inv.round_off_paise !== 0 && <Row label="Round off" value={`${inv.round_off_paise > 0 ? '+' : '−'} ${formatMoneyPlain(Math.abs(inv.round_off_paise))}`} />}
                <Separator className="my-2" />
                <div className="flex items-center justify-between rounded-lg bg-accent px-3 py-2">
                  <span className="font-semibold text-accent-foreground">Grand total</span>
                  <span className="text-base font-bold text-accent-foreground">{formatMoney(inv.grand_total_paise)}</span>
                </div>
                {inv.status !== 'DRAFT' && inv.status !== 'CANCELLED' && (
                  <>
                    <Row label="Amount paid" value={formatMoney(inv.paid_total_paise)} />
                    <Row label="Balance due" value={formatMoney(balance)} strong />
                  </>
                )}
              </div>

              {(inv.notes || inv.terms) && (
                <div className="mt-5 space-y-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                  {inv.notes && <p><span className="font-semibold text-foreground">Notes: </span>{inv.notes}</p>}
                  {inv.terms && <p className="whitespace-pre-line"><span className="font-semibold text-foreground">Terms: </span>{inv.terms}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          {/* payments */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><Wallet className="h-4 w-4 text-muted-foreground" /> Payment history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.payments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No payments recorded yet.</p>
              ) : (
                data.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{formatMoney(p.amount_paise)}</p>
                      <p className="text-xs text-muted-foreground">{formatDateDisplay(p.paid_at)} · {p.method.replace(/_/g, ' ')}{p.reference ? ` · ${p.reference}` : ''}</p>
                    </div>
                    {p.sync_state === 'pending' ? <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">pending sync</span> : <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">synced</span>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* audit */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><History className="h-4 w-4 text-muted-foreground" /> Audit history</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2.5">
                {data.audit.map((a) => (
                  <li key={a.id} className="flex gap-2.5 text-xs">
                    <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <div>
                      <p className="font-medium">{a.action.replace(/_/g, ' ')}</p>
                      <p className="text-muted-foreground">{new Date(a.at).toLocaleString()}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 gap-1.5" onClick={() => { setPdfOpen(true) }}>
              <FileDown className="h-4 w-4" /> Export PDF
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-1.5"
              onClick={() => {
                if ('share' in navigator && model) {
                  void (async () => {
                    try {
                      const { renderDocumentPdf, downloadPdf } = await import('@/lib/pdf/render')
                        const { pdfFileName } = await import('@/lib/pdf/document-model')
                      const doc = renderDocumentPdf(model)
                      downloadPdf(doc, pdfFileName(model))
                      toast.success('PDF saved — attach it in any app to share')
                    } catch {
                      setPdfOpen(true)
                    }
                  })()
                } else {
                  setPdfOpen(true)
                }
              }}
            >
              <Ban className="hidden" aria-hidden="true" /> Share
            </Button>
          </div>
        </div>
      </div>

      <PdfPreviewDialog open={pdfOpen} onOpenChange={setPdfOpen} model={model} />
      <RecordPaymentDialog open={payOpen} onOpenChange={setPayOpen} invoiceId={id} balancePaise={balance} />
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold tabular-nums' : 'font-medium tabular-nums'}>{value}</span>
    </div>
  )
}

function RecordPaymentDialog({
  open, onOpenChange, invoiceId, balancePaise,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  invoiceId: string
  balancePaise: number
}) {
  const ws = useActiveWorkspace()
  const [amount, setAmount] = useState((balancePaise / 100).toFixed(2))
  const [date, setDate] = useState(todayStr())
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!ws) return
    const paise = Math.round(Number(amount) * 100)
    if (!Number.isFinite(paise) || paise <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (paise > balancePaise) {
      toast.error('Payment exceeds the invoice balance')
      return
    }
    setSaving(true)
    try {
      await recordPayment(ws.id, {
        id: crypto.randomUUID(),
        invoice_id: invoiceId,
        amount_paise: paise,
        paid_at: date,
        method,
        reference: reference.trim() || null,
        notes: null,
      }, balancePaise)
      toast.success('Payment recorded', { description: 'Invoice status updated locally — will sync when online.' })
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not record payment', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Balance due: {formatMoney(balancePaise)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount (Rs.) *</Label>
              <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Date *</Label>
              <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'OTHER'] as PaymentMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Reference</Label>
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? 'Saving…' : 'Record payment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
