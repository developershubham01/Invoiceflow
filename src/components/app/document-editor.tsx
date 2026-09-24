'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { QuickCreateCustomer } from '@/components/app/quick-create-customer'
import { addDaysStr } from '@/lib/date'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { getCompany, saveInvoiceDraft, saveQuotationDraft } from '@/lib/db/repositories'
import { computeDocumentTotals, type DocItemInput } from '@/lib/domain/documents'
import { formatMoney, formatMoneyPlain, formatQty, parseAmountToPaise, parseQtyToMilli } from '@/lib/domain/money'
import { INDIAN_STATES, STANDARD_GST_RATES_BPS, gstRateLabel, stateCodeFromGstin } from '@/lib/domain/gst'
import { todayStr } from '@/lib/date'
import type { Customer, DocCharge, Product } from '@/lib/domain/types'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Package, Percent, Plus, Trash2, UserPlus } from 'lucide-react'

export interface DocEditorItem {
  id: string
  product_id: string | null
  description: string
  hsn_sac: string
  qty: string // display string
  unit: string
  unit_price: string // display string (rupees)
  discount_bps: number
  gst_rate_bps: number
}

function emptyItem(gstDefault: number): DocEditorItem {
  return { id: crypto.randomUUID(), product_id: null, description: '', hsn_sac: '', qty: '1', unit: 'NOS', unit_price: '', discount_bps: 0, gst_rate_bps: gstDefault }
}

export function toDocInputs(items: DocEditorItem[]): { inputs: DocItemInput[]; errors: string[] } {
  const inputs: DocItemInput[] = []
  const errors: string[] = []
  for (const [i, item] of items.entries()) {
    if (!item.description.trim()) {
      errors.push(`Item ${i + 1}: description is required`)
      continue
    }
    const qtyMilli = parseQtyToMilli(item.qty)
    const price = parseAmountToPaise(item.unit_price)
    if (qtyMilli === null || qtyMilli <= 0) {
      errors.push(`Item ${i + 1}: invalid quantity`)
      continue
    }
    if (price === null || price < 0) {
      errors.push(`Item ${i + 1}: invalid rate`)
      continue
    }
    inputs.push({
      id: item.id,
      description: item.description.trim(),
      hsn_sac: item.hsn_sac.trim() || null,
      qty_milli: qtyMilli,
      unit: item.unit.trim() || null,
      unit_price_paise: price,
      discount_bps: item.discount_bps,
      gst_rate_bps: item.gst_rate_bps,
    })
  }
  return { inputs, errors }
}

/** Standard payment/validity terms offered as one-tap chips under the second date input. */
const QUICK_TERMS = [15, 30, 45]

export function DocumentEditor({
  kind,
  editId,
  onDone,
}: {
  kind: 'invoice' | 'quotation'
  editId?: string
  onDone: (id: string) => void
}) {
  const ws = useLiveQuery(async () => {
    const { getActiveWorkspace } = await import('@/lib/db/repositories')
    return getActiveWorkspace()
  }, [])
  const wsId = ws?.id ?? null

  const company = useLiveQuery(async () => (wsId ? getCompany(wsId) : null), [wsId])
  const customers = useLiveQuery(async () => {
    if (!wsId) return []
    return (await getDb().customers.where('workspace_id').equals(wsId).filter((c) => !c.deleted_at).toArray())
  }, [wsId])
  const products = useLiveQuery(async () => {
    if (!wsId) return []
    const rows = await getDb().products.where('workspace_id').equals(wsId).toArray()
    return rows.filter((p) => !p.deleted_at && p.active)
  }, [wsId])

  const [customerId, setCustomerId] = useState<string>('')
  const [date, setDate] = useState(todayStr())
  const [secondDate, setSecondDate] = useState('') // due date or valid until
  const [placeOfSupply, setPlaceOfSupply] = useState('')
  const [priceIncludesTax, setPriceIncludesTax] = useState(false)
  const [items, setItems] = useState<DocEditorItem[]>([])
  const [charges, setCharges] = useState<Array<DocCharge & { amount: string }>>([])
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [saving, setSaving] = useState(false)
  const [quickCustomer, setQuickCustomer] = useState(false)

  // initialize once company/customers load
  useEffect(() => {
    if (initialized || !company || !wsId) return
    setPriceIncludesTax(company.price_includes_tax)
    setItems([emptyItem(company.default_gst_rate_bps)])
    setNotes(company.default_notes ?? '')
    setTerms(company.default_terms ?? '')
    setInitialized(true)
  }, [company, wsId, initialized])

  // load existing draft for editing
  useEffect(() => {
    if (!editId || !wsId || initialized) return
    void (async () => {
      if (kind === 'invoice') {
        const { getInvoice } = await import('@/lib/db/repositories')
        const got = await getInvoice(editId)
        if (!got) return
        const inv = got.invoice
        setCustomerId(inv.customer_id)
        setDate(inv.invoice_date)
        setSecondDate(inv.due_date ?? '')
        setPlaceOfSupply(inv.place_of_supply_code ?? '')
        setPriceIncludesTax(inv.price_includes_tax)
        setItems(got.items.map((it) => ({
          id: it.id, product_id: null, description: it.description, hsn_sac: it.hsn_sac ?? '',
          qty: formatQty(it.qty_milli), unit: it.unit ?? 'NOS', unit_price: (it.unit_price_paise / 100).toFixed(2),
          discount_bps: it.discount_bps, gst_rate_bps: it.gst_rate_bps,
        })))
        setCharges((inv.charges_json ? JSON.parse(inv.charges_json) : []).map((c: DocCharge) => ({ ...c, amount: (c.amount_paise / 100).toFixed(2) })))
        setNotes(inv.notes ?? '')
        setTerms(inv.terms ?? '')
        setInitialized(true)
      } else {
        const { getQuotation } = await import('@/lib/db/repositories')
        const got = await getQuotation(editId)
        if (!got) return
        const q = got.quotation
        setCustomerId(q.customer_id)
        setDate(q.quotation_date)
        setSecondDate(q.valid_until ?? '')
        setPlaceOfSupply(q.place_of_supply_code ?? '')
        setPriceIncludesTax(q.price_includes_tax)
        setItems(got.items.map((it) => ({
          id: it.id, product_id: null, description: it.description, hsn_sac: it.hsn_sac ?? '',
          qty: formatQty(it.qty_milli), unit: it.unit ?? 'NOS', unit_price: (it.unit_price_paise / 100).toFixed(2),
          discount_bps: it.discount_bps, gst_rate_bps: it.gst_rate_bps,
        })))
        setCharges((q.charges_json ? JSON.parse(q.charges_json) : []).map((c: DocCharge) => ({ ...c, amount: (c.amount_paise / 100).toFixed(2) })))
        setNotes(q.notes ?? '')
        setTerms(q.terms ?? '')
        setInitialized(true)
      }
    })()
  }, [editId, wsId, kind, initialized])

  // default place of supply from customer
  useEffect(() => {
    if (!customerId) return
    const c = customers?.find((x) => x.id === customerId)
    if (c?.state_code) setPlaceOfSupply(c.state_code)
    else if (c?.gstin) {
      const code = stateCodeFromGstin(c.gstin)
      if (code) setPlaceOfSupply(code)
    }
  }, [customerId, customers])

  const parsed = useMemo(() => toDocInputs(items), [items])
  const parsedCharges: DocCharge[] = useMemo(() => charges.map((c) => ({ id: c.id, label: c.label, amount_paise: parseAmountToPaise(c.amount) ?? 0, taxable: c.taxable, gst_rate_bps: c.gst_rate_bps })), [charges])

  const totals = useMemo(() => {
    if (!wsId) return null
    const supplierState = company?.state_code ?? null
    return computeDocumentTotals({
      items: parsed.inputs,
      charges: parsedCharges,
      price_includes_tax: priceIncludesTax,
      supplier_state_code: supplierState,
      place_of_supply_code: placeOfSupply || null,
      enable_round_off: company?.enable_round_off ?? true,
    })
  }, [parsed.inputs, parsedCharges, priceIncludesTax, placeOfSupply, company, wsId])

  const updateItem = (id: string, patch: Partial<DocEditorItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  /** Reorder line items (line order matters on the printed document). */
  const moveItem = (from: number, to: number) => {
    setItems((list) => {
      if (to < 0 || to >= list.length || from === to) return list
      const next = [...list]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const applyProduct = async (itemId: string, productId: string) => {
    const prod = products?.find((p) => p.id === productId) as Product | undefined
    if (!prod) return
    updateItem(itemId, {
      product_id: productId,
      description: prod.description || prod.name,
      hsn_sac: prod.hsn_sac ?? '',
      unit: prod.unit,
      unit_price: (prod.selling_price_paise / 100).toFixed(2),
      gst_rate_bps: prod.gst_rate_bps,
    })
    if (prod.price_includes_tax != null) setPriceIncludesTax(prod.price_includes_tax)
  }

  const validate = (): string[] => {
    const errors: string[] = []
    if (!customerId) errors.push('Select a customer')
    if (!date) errors.push('Document date is required')
    errors.push(...parsed.errors)
    return errors
  }

  const handleSave = async (finalize: boolean) => {
    if (!wsId || !company) return
    const errors = validate()
    if (errors.length) {
      toast.error(errors[0], { description: errors.length > 1 ? `+${errors.length - 1} more issue(s)` : undefined })
      return
    }
    setSaving(true)
    try {
      const common = {
        customer_id: customerId,
        place_of_supply_code: placeOfSupply || null,
        price_includes_tax: priceIncludesTax,
        items: parsed.inputs,
        charges: parsedCharges,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
        id: editId,
      }
      if (kind === 'invoice') {
        const inv = await saveInvoiceDraft(wsId, company.state_code, { price_includes_tax: company.price_includes_tax, enable_round_off: company.enable_round_off }, {
          ...common, invoice_date: date, due_date: secondDate || null,
        })
        if (finalize) {
          const { finalizeInvoice } = await import('@/lib/db/repositories')
          await finalizeInvoice(wsId, company.invoice_prefix, inv.id)
          toast.success('Invoice finalized', { description: `${inv.number} is now immutable and ready to share.` })
        } else {
          toast.success(editId ? 'Draft updated' : 'Draft saved', { description: 'Saved locally — it will sync when online.' })
        }
        onDone(inv.id)
      } else {
        const q = await saveQuotationDraft(wsId, company.state_code, { enable_round_off: company.enable_round_off }, {
          ...common, quotation_date: date, valid_until: secondDate || null,
        })
        if (finalize) {
          const { setQuotationStatus } = await import('@/lib/db/repositories')
          await setQuotationStatus(wsId, q.id, 'SENT')
          toast.success('Quotation marked as sent', { description: q.number })
        } else {
          toast.success(editId ? 'Draft updated' : 'Draft saved', { description: 'Saved locally — it will sync when online.' })
        }
        onDone(q.id)
      }
    } catch (err) {
      toast.error('Could not save document', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const intra = company?.state_code && placeOfSupply ? company.state_code === placeOfSupply : true

  if (!wsId || !initialized) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Loading editor…</div>
  }

  return (
    <div className="space-y-5">
      {/* ---------- header fields ---------- */}
      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="customer">Customer *</Label>
            <div className="flex gap-2">
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger id="customer" className="w-full">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {(customers ?? []).map((c: Customer) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.business_name}{c.state_code ? ` · ${c.state_code}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setQuickCustomer(true)} aria-label="Quick add customer">
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-date">{kind === 'invoice' ? 'Invoice date' : 'Quotation date'} *</Label>
            <Input id="doc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-date2">{kind === 'invoice' ? 'Due date' : 'Valid until'}</Label>
            <Input id="doc-date2" type="date" value={secondDate} onChange={(e) => setSecondDate(e.target.value)} />
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Quick date presets">
              {QUICK_TERMS.map((days) => {
                const active = secondDate === addDaysStr(date, days)
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setSecondDate(addDaysStr(date, days))}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : 'border-border text-muted-foreground hover:border-emerald-500/40 hover:bg-emerald-500/[0.08] hover:text-emerald-700 dark:hover:text-emerald-400'
                    }`}
                    aria-pressed={active}
                    aria-label={`Set ${kind === 'invoice' ? 'due date' : 'valid until'} to ${days} days from the document date`}
                  >
                    +{days}d
                  </button>
                )
              })}
              {secondDate && (
                <button
                  type="button"
                  onClick={() => setSecondDate('')}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400"
                  aria-label="Clear the date"
                >
                  clear
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Place of supply *</Label>
            <Select value={placeOfSupply} onValueChange={setPlaceOfSupply}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <Switch id="tax-incl" checked={priceIncludesTax} onCheckedChange={setPriceIncludesTax} aria-describedby="tax-incl-desc" />
            <div>
              <Label htmlFor="tax-incl">Prices include GST</Label>
              <p id="tax-incl-desc" className="text-xs text-muted-foreground">Rates are treated as tax-inclusive when enabled.</p>
            </div>
          </div>
          <div className="md:col-span-2 flex items-center justify-end text-xs text-muted-foreground">
            {intra ? 'Intra-state: CGST + SGST apply' : 'Inter-state: IGST applies'}
          </div>
        </CardContent>
      </Card>

      {/* ---------- line items ---------- */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Line items</h2>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => company && setItems((l) => [...l, emptyItem(company.default_gst_rate_bps)])}>
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          </div>

          {/* desktop header — 9 columns: reorder / description / HSN / qty / unit / rate / discount / GST / remove */}
          <div className="hidden gap-2 px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid lg:grid-cols-[28px_2fr_1fr_64px_64px_96px_88px_72px_32px]">
            <span /><span>Product / description</span><span>HSN/SAC</span><span>Qty</span><span>Unit</span><span>Rate (Rs.)</span><span>Disc.</span><span>GST</span><span />
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="group grid gap-2 rounded-lg border bg-card p-2 transition-colors focus-within:border-emerald-300 lg:grid-cols-[28px_2fr_1fr_64px_64px_96px_88px_72px_32px] lg:items-center lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:hover:bg-emerald-500/[0.04] dark:lg:hover:bg-emerald-500/[0.06]"
              >
                {/* mobile reorder controls (always visible on touch) */}
                <div className="flex items-center gap-0.5 lg:hidden">
                  <button
                    type="button"
                    className="flex h-8 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                    onClick={() => moveItem(idx, idx - 1)}
                    disabled={idx === 0}
                    aria-label={`Move item ${idx + 1} up`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                    onClick={() => moveItem(idx, idx + 1)}
                    disabled={idx === items.length - 1}
                    aria-label={`Move item ${idx + 1} down`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* desktop reorder stack: hover-revealed arrows around the row number */}
                <div className="hidden flex-col items-center lg:flex">
                  <button
                    type="button"
                    className="flex h-4 w-6 items-center justify-center rounded text-muted-foreground/0 transition-all hover:bg-accent hover:text-foreground disabled:pointer-events-none"
                    onClick={() => moveItem(idx, idx - 1)}
                    disabled={idx === 0}
                    aria-label={`Move item ${idx + 1} up`}
                    tabIndex={-1}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <span className="text-[10px] leading-none tabular-nums text-muted-foreground">{idx + 1}</span>
                  <button
                    type="button"
                    className="flex h-4 w-6 items-center justify-center rounded text-muted-foreground/0 transition-all hover:bg-accent hover:text-foreground disabled:pointer-events-none"
                    onClick={() => moveItem(idx, idx + 1)}
                    disabled={idx === items.length - 1}
                    aria-label={`Move item ${idx + 1} down`}
                    tabIndex={-1}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="space-y-1">
                  <ProductPicker products={products ?? []} onPick={(pid) => void applyProduct(item.id, pid)} />
                  <Input
                    value={item.description}
                    onChange={(e) => updateItem(item.id, { description: e.target.value })}
                    placeholder="Description *"
                    aria-label={`Item ${idx + 1} description`}
                  />
                </div>
                <Input value={item.hsn_sac} onChange={(e) => updateItem(item.id, { hsn_sac: e.target.value })} placeholder="HSN/SAC" aria-label={`Item ${idx + 1} HSN/SAC`} />
                <div className="grid grid-cols-2 gap-2 lg:contents">
                  <Input inputMode="decimal" value={item.qty} onChange={(e) => updateItem(item.id, { qty: e.target.value })} placeholder="Qty" aria-label={`Item ${idx + 1} quantity`} className="tabular-nums" />
                  <Input value={item.unit} onChange={(e) => updateItem(item.id, { unit: e.target.value })} placeholder="Unit" aria-label={`Item ${idx + 1} unit`} />
                </div>
                <Input inputMode="decimal" value={item.unit_price} onChange={(e) => updateItem(item.id, { unit_price: e.target.value })} placeholder="Rate" aria-label={`Item ${idx + 1} rate in rupees`} className="tabular-nums" />
                <Select value={String(item.discount_bps)} onValueChange={(v) => updateItem(item.id, { discount_bps: Number(v) })}>
                  <SelectTrigger aria-label={`Item ${idx + 1} discount`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[0, 250, 500, 1000, 1500, 2000, 2500].map((b) => (
                      <SelectItem key={b} value={String(b)}>{b === 0 ? 'No disc.' : `${b / 100}%`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(item.gst_rate_bps)} onValueChange={(v) => updateItem(item.id, { gst_rate_bps: Number(v) })}>
                  <SelectTrigger aria-label={`Item ${idx + 1} GST rate`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STANDARD_GST_RATES_BPS.map((b) => (
                      <SelectItem key={b} value={String(b)}>{gstRateLabel(b)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground opacity-100 transition-opacity hover:text-destructive lg:opacity-0 lg:group-hover:opacity-100"
                  onClick={() => setItems((l) => (l.length > 1 ? l.filter((x) => x.id !== item.id) : l))}
                  aria-label={`Remove item ${idx + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          {parsed.errors.length > 0 && (
            <p className="mt-2 text-xs text-destructive">{parsed.errors[0]}{parsed.errors.length > 1 ? ` (+${parsed.errors.length - 1} more)` : ''}</p>
          )}

          <Separator className="my-4" />

          {/* charges */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional charges</h3>
              <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => company && setCharges((l) => [...l, { id: crypto.randomUUID(), label: '', amount_paise: 0, taxable: false, gst_rate_bps: company.default_gst_rate_bps, amount: '' }])}>
                <Plus className="h-3.5 w-3.5" /> Add charge
              </Button>
            </div>
            {charges.length === 0 && <p className="text-xs text-muted-foreground">No additional charges (e.g. freight, packing).</p>}
            {charges.map((charge, i) => (
              <div key={charge.id} className="flex flex-wrap items-center gap-2">
                <Input className="w-40" value={charge.label} onChange={(e) => setCharges((l) => l.map((c) => (c.id === charge.id ? { ...c, label: e.target.value } : c)))} placeholder="Label" aria-label={`Charge ${i + 1} label`} />
                <Input className="w-28" inputMode="decimal" value={charge.amount} onChange={(e) => setCharges((l) => l.map((c) => (c.id === charge.id ? { ...c, amount: e.target.value } : c)))} placeholder="Rs." aria-label={`Charge ${i + 1} amount`} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch checked={charge.taxable} onCheckedChange={(v) => setCharges((l) => l.map((c) => (c.id === charge.id ? { ...c, taxable: v } : c)))} aria-label={`Charge ${i + 1} taxable`} /> Taxable
                </label>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setCharges((l) => l.filter((c) => c.id !== charge.id))} aria-label={`Remove charge ${i + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* notes & terms */}
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Visible on the document (e.g. thank-you note)" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="terms">Terms & conditions</Label>
              <Textarea id="terms" rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms, jurisdiction, returns…" />
            </div>
          </CardContent>
        </Card>

        {/* live totals */}
        <Card className="h-fit">
          <CardContent className="space-y-2 p-4 text-sm">
            <h3 className="pb-1 text-sm font-semibold">Summary</h3>
            {totals && (
              <>
                <Row label="Subtotal" value={formatMoney(totals.subtotal_gross_paise)} />
                {totals.discount_total_paise > 0 && <Row label="Discount" value={`− ${formatMoney(totals.discount_total_paise)}`} />}
                <Row label="Taxable value" value={formatMoney(totals.taxable_total_paise)} />
                {totals.taxable_total_paise > 0 && intra ? (
                  <>
                    <Row label="CGST" value={formatMoney(totals.cgst_paise)} />
                    <Row label="SGST/UTGST" value={formatMoney(totals.sgst_paise)} />
                  </>
                ) : totals.taxable_total_paise > 0 ? (
                  <Row label="IGST" value={formatMoney(totals.igst_paise)} />
                ) : null}
                {totals.charges_total_paise > 0 && <Row label="Charges" value={formatMoney(totals.charges_total_paise)} />}
                {totals.charges_tax_paise > 0 && <Row label="Tax on charges" value={formatMoney(totals.charges_tax_paise)} />}
                {totals.round_off_paise !== 0 && <Row label="Round off" value={`${totals.round_off_paise > 0 ? '+' : '−'} ${formatMoneyPlain(Math.abs(totals.round_off_paise))}`} />}
                <Separator className="my-1" />
                <div className="flex items-center justify-between rounded-lg bg-accent px-3 py-2.5">
                  <span className="text-sm font-semibold text-accent-foreground">Grand total</span>
                  <span className="text-base font-bold text-accent-foreground">{formatMoney(totals.grand_total_paise)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
        <Button variant="outline" onClick={() => history.back()}>Cancel</Button>
        <Button variant="secondary" disabled={saving} onClick={() => void handleSave(false)}>
          Save draft
        </Button>
        <Button disabled={saving} onClick={() => void handleSave(true)} className="gap-1.5">
          <Percent className="h-4 w-4" aria-hidden="true" />
          {kind === 'invoice' ? 'Save & finalize' : 'Save & mark sent'}
        </Button>
      </div>

      <QuickCreateCustomer open={quickCustomer} onOpenChange={setQuickCustomer} onCreated={(id) => setCustomerId(id)} />
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

function ProductPicker({ products, onPick }: { products: Product[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-fit gap-1.5 px-2 text-xs text-muted-foreground">
          <Package className="h-3.5 w-3.5" /> Pick from catalog
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search products & services…" />
          <CommandList className="max-h-64 scrollbar-thin">
            <CommandEmpty>No products found. Type a custom description below.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem key={p.id} value={`${p.name} ${p.sku ?? ''}`} onSelect={() => { onPick(p.id); setOpen(false) }}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.sku ? `${p.sku} · ` : ''}{formatMoney(p.selling_price_paise)} · GST {gstRateLabel(p.gst_rate_bps)}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
