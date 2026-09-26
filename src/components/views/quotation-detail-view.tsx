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
import { chargesFromJson } from '@/lib/db/row-types'
import { convertQuotationToInvoice, setQuotationStatus, softDeleteQuotationDraft } from '@/lib/db/repositories'
import { buildQuotationModel } from '@/lib/pdf/document-model'
import { formatMoney, formatMoneyPlain } from '@/lib/domain/money'
import { formatDateDisplay, todayStr } from '@/lib/date'
import { toast } from 'sonner'
import { navigate } from '@/lib/router'
import {
  ArrowLeft, ArrowRightLeft, Copy, FileDown, History, Pencil, Printer, SendHorizonal, Trash2, XCircle,
} from 'lucide-react'

export function QuotationDetailView({ id }: { id: string }) {
  const ws = useActiveWorkspace()
  const company = useCompany()
  const [pdfOpen, setPdfOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const data = useLiveQuery(async () => {
    if (!ws) return null
    const quotation = await getDb().quotations.get(id)
    if (!quotation || quotation.workspace_id !== ws.id) return null
    const [items, customer, audit] = await Promise.all([
      getDb().quotation_items.where('quotation_id').equals(id).toArray(),
      getDb().customers.get(quotation.customer_id),
      getDb().audit_logs.where('[entity_type+entity_id]').equals(['quotation', id]).toArray(),
    ])
    return { quotation, items: items.sort((a, b) => a.position - b.position), customer, audit: audit.sort((a, b) => b.at.localeCompare(a.at)) }
  }, [ws?.id, id])

  const display = useMemo(() => {
    if (!data) return null
    const q = data.quotation
    if (q.status === 'SENT' && q.valid_until && q.valid_until < todayStr()) return { ...q, status: 'EXPIRED' as const }
    return q
  }, [data])

  const model = useMemo(() => {
    if (!data) return null
    return buildQuotationModel(data.quotation, data.items, company ?? null, data.customer)
  }, [data, company])

  if (!ws) return null
  if (!data || !display) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('quotations')}>
          <ArrowLeft className="h-4 w-4" /> Back to quotations
        </Button>
        <Card><CardContent className="py-14 text-center text-sm text-muted-foreground">Quotation not found.</CardContent></Card>
      </div>
    )
  }

  const q = display
  const charges = chargesFromJson(q.charges_json)
  const isDraft = q.status === 'DRAFT'

  const transition = async (status: 'SENT' | 'ACCEPTED' | 'REJECTED') => {
    setBusy(true)
    try {
      await setQuotationStatus(ws.id, id, status)
      toast.success(`Quotation marked as ${status.toLowerCase()}`)
    } catch (err) {
      toast.error('Status change failed', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const doConvert = async () => {
    setBusy(true)
    try {
      const { invoice } = await convertQuotationToInvoice(ws.id, company?.state_code ?? null, { enable_round_off: company?.enable_round_off ?? true }, id)
      toast.success('Converted to invoice draft', { description: `${invoice.number} — review and finalize it.` })
      navigate(`invoices/${invoice.id}`)
    } catch (err) {
      toast.error('Conversion failed', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const doDuplicate = async () => {
    try {
      const { saveQuotationDraft } = await import('@/lib/db/repositories')
      const copy = await saveQuotationDraft(ws.id, company?.state_code ?? null, { enable_round_off: company?.enable_round_off ?? true }, {
        customer_id: q.customer_id,
        quotation_date: todayStr(),
        valid_until: null,
        place_of_supply_code: q.place_of_supply_code,
        price_includes_tax: q.price_includes_tax,
        items: data.items.map((it) => ({
          id: crypto.randomUUID(), description: it.description, hsn_sac: it.hsn_sac, qty_milli: it.qty_milli,
          unit: it.unit, unit_price_paise: it.unit_price_paise, discount_bps: it.discount_bps, gst_rate_bps: it.gst_rate_bps,
        })),
        charges,
        notes: q.notes, terms: q.terms,
      })
      toast.success('Duplicated as new draft', { description: copy.number })
      navigate(`quotations/${copy.id}`)
    } catch (err) {
      toast.error('Could not duplicate', { description: (err as Error).message })
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('quotations')}>
            <ArrowLeft className="h-4 w-4" /> Quotations
          </Button>
          <span className="text-muted-foreground">/</span>
          <h2 className="text-sm font-semibold">{q.number}</h2>
          <StatusBadge status={q.status} className="ml-1" />
          {q.sync_state === 'pending' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">Pending sync</span>}
          {q.sync_state === 'synced' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">Synced</span>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {isDraft && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`quotations/edit/${q.id}`)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => void transition('SENT')}>
                <SendHorizonal className="h-3.5 w-3.5" /> Mark sent
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => void (async () => {
                try {
                  await softDeleteQuotationDraft(ws.id, id)
                  toast.success('Draft deleted')
                  navigate('quotations')
                } catch (err) {
                  toast.error('Could not delete', { description: (err as Error).message })
                }
              })()}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </>
          )}
          {q.status === 'SENT' && (
            <>
              <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => void transition('ACCEPTED')}>
                Accept
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => void transition('REJECTED')}>
                <XCircle className="h-3.5 w-3.5" /> Reject
              </Button>
            </>
          )}
          {q.status === 'ACCEPTED' && (
            <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => void doConvert()}>
              <ArrowRightLeft className="h-3.5 w-3.5" /> Convert to invoice
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPdfOpen(true)}>
            <Printer className="h-3.5 w-3.5" /> PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void doDuplicate()}>
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </Button>
        </div>
      </div>

      {q.converted_invoice_id && (
        <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-300">
          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
          This quotation was converted to invoice{' '}
          <button className="font-semibold underline" onClick={() => navigate(`invoices/${q.converted_invoice_id}`)}>
            {q.converted_invoice_id ? 'view invoice' : ''}
          </button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.8fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{q.customer_name_snapshot}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  GSTIN: {q.customer_gstin_snapshot ?? '—'} · Place of supply: {q.place_of_supply_code ?? '—'}
                  {' · '}{q.tax_mode === 'INTER' ? 'Inter-state (IGST)' : 'Intra-state (CGST+SGST)'}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>Dated {formatDateDisplay(q.quotation_date, company?.doc_date_format)}</p>
                {q.valid_until && <p>Valid until {formatDateDisplay(q.valid_until, company?.doc_date_format)}</p>}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border scrollbar-thin">
              <table className="w-full min-w-[560px] text-sm" aria-label="Quotation line items">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">HSN</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Rate</th>
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
                      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell">
                        {formatMoney(it.tax_paise)} <span className="text-xs text-muted-foreground">({it.gst_rate_bps / 100}%)</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{formatMoney(it.total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatMoney(q.subtotal_gross_paise)} />
              {q.discount_total_paise > 0 && <Row label="Discount" value={`− ${formatMoney(q.discount_total_paise)}`} />}
              <Row label="Taxable value" value={formatMoney(q.taxable_total_paise)} />
              {q.tax_mode === 'INTRA' ? (
                <>
                  <Row label="CGST" value={formatMoney(q.cgst_paise)} />
                  <Row label="SGST/UTGST" value={formatMoney(q.sgst_paise)} />
                </>
              ) : (
                <Row label="IGST" value={formatMoney(q.igst_paise)} />
              )}
              {charges.map((c) => <Row key={c.id} label={c.label} value={formatMoney(c.amount_paise)} />)}
              {q.charges_tax_paise > 0 && <Row label="Tax on charges" value={formatMoney(q.charges_tax_paise)} />}
              {q.round_off_paise !== 0 && <Row label="Round off" value={`${q.round_off_paise > 0 ? '+' : '−'} ${formatMoneyPlain(Math.abs(q.round_off_paise))}`} />}
              <Separator className="my-2" />
              <div className="flex items-center justify-between rounded-lg bg-accent px-3 py-2">
                <span className="font-semibold text-accent-foreground">Quoted total</span>
                <span className="text-base font-bold text-accent-foreground">{formatMoney(q.grand_total_paise)}</span>
              </div>
            </div>

            {(q.notes || q.terms) && (
              <div className="mt-5 space-y-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                {q.notes && <p><span className="font-semibold text-foreground">Notes: </span>{q.notes}</p>}
                {q.terms && <p className="whitespace-pre-line"><span className="font-semibold text-foreground">Terms: </span>{q.terms}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="mt-3 w-full gap-1.5 text-muted-foreground">
                  <FileDown className="h-3.5 w-3.5" /> Export PDF copy
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Open PDF preview?</AlertDialogTitle>
                  <AlertDialogDescription>The PDF is generated locally on this device.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Close</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setPdfOpen(true)}>Open preview</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>

      <PdfPreviewDialog open={pdfOpen} onOpenChange={setPdfOpen} model={model} />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}
