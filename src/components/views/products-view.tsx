'use client'

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { useActiveWorkspace, useCompany } from '@/lib/hooks/app-hooks'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { saveProduct, softDeleteProduct } from '@/lib/db/repositories'
import { STANDARD_GST_RATES_BPS, gstRateLabel } from '@/lib/domain/gst'
import { productSchema } from '@/lib/domain/schemas'
import { formatMoney, parseAmountToPaise } from '@/lib/domain/money'
import { toast } from 'sonner'
import { Archive, Boxes, FileText, Pencil, Plus, Search, TrendingUp } from 'lucide-react'
import type { Product } from '@/lib/domain/types'

interface FormState {
  id?: string
  name: string
  sku: string
  hsn_sac: string
  description: string
  unit: string
  selling_price: string
  cost_price: string
  gst_rate_bps: number
  price_includes_tax: boolean
  active: boolean
}

const emptyForm: FormState = { name: '', sku: '', hsn_sac: '', description: '', unit: 'NOS', selling_price: '', cost_price: '', gst_rate_bps: 1800, price_includes_tax: false, active: true }

export function ProductsView() {
  const ws = useActiveWorkspace()
  const company = useCompany()
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  const products = useLiveQuery(async () => {
    if (!ws) return null
    return getDb().products.where('workspace_id').equals(ws.id).filter((p) => !p.deleted_at).toArray()
  }, [ws?.id])

  const usage = useLiveQuery(async () => {
    if (!ws) return null
    const items = await getDb().invoice_items.where('workspace_id').equals(ws.id).toArray()
    const map = new Map<string, { count: number; revenue: number }>()
    for (const it of items) {
      // usage keyed by description match (items snapshot descriptions)
      const key = it.description
      const cur = map.get(key) ?? { count: 0, revenue: 0 }
      map.set(key, { count: cur.count + 1, revenue: cur.revenue + it.total_paise })
    }
    return map
  }, [ws?.id])

  const filtered = useMemo(() => {
    if (!products) return []
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q) || (p.hsn_sac ?? '').includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, query])

  const openEdit = (p?: Product) => {
    setForm(p ? {
      id: p.id, name: p.name, sku: p.sku ?? '', hsn_sac: p.hsn_sac ?? '', description: p.description ?? '',
      unit: p.unit, selling_price: (p.selling_price_paise / 100).toFixed(2),
      cost_price: p.cost_price_paise != null ? (p.cost_price_paise / 100).toFixed(2) : '',
      gst_rate_bps: p.gst_rate_bps, price_includes_tax: p.price_includes_tax ?? company?.price_includes_tax ?? false,
      active: p.active,
    } : { ...emptyForm, gst_rate_bps: company?.default_gst_rate_bps ?? 1800 })
  }

  const submit = async () => {
    if (!ws || !form) return
    const price = parseAmountToPaise(form.selling_price)
    const cost = form.cost_price ? parseAmountToPaise(form.cost_price) : null
    if (price === null) {
      toast.error('Enter a valid selling price')
      return
    }
    const parsed = productSchema.safeParse({
      name: form.name, sku: form.sku, hsn_sac: form.hsn_sac, description: form.description, unit: form.unit,
      selling_price_paise: price, cost_price_paise: cost, gst_rate_bps: form.gst_rate_bps,
      price_includes_tax: form.price_includes_tax, active: form.active,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid details')
      return
    }
    // duplicate detection: same name (+sku) already exists
    const duplicate = (products ?? []).find((p) => p.id !== form.id && p.name.trim().toLowerCase() === form.name.trim().toLowerCase() && (p.sku ?? '') === form.sku.trim())
    if (duplicate && !confirm(`"${duplicate.name}" already exists in your catalog. Save anyway?`)) {
      return
    }
    setSaving(true)
    try {
      const saved = await saveProduct(ws.id, { id: form.id, ...parsed.data } as Partial<Product> & { name: string })
      toast.success(form.id ? 'Product updated' : 'Product added', { description: saved.name })
      setForm(null)
    } catch (err) {
      toast.error('Could not save product', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const doArchive = async (p: Product) => {
    if (!ws) return
    try {
      await softDeleteProduct(ws.id, p.id)
      toast.success('Product archived', { description: 'Past documents keep their line-item snapshots.' })
    } catch (err) {
      toast.error('Could not archive', { description: (err as Error).message })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, SKU, HSN/SAC…" className="pl-8" aria-label="Search products" />
        </div>
        <Button onClick={() => openEdit()} className="gap-1.5">
          <Plus className="h-4 w-4" /> New product
        </Button>
      </div>

      {!products ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={query ? 'No products match' : 'No products or services yet'}
          description={query ? 'Try a different search.' : 'Build a catalog with HSN/SAC codes, GST rates and pricing — items auto-fill in documents.'}
          action={{ label: 'Add product', onClick: () => openEdit() }}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const use = usage?.get(p.name)
            return (
              <Card key={p.id} className="product-card py-0">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.sku ?? '—'} · {p.unit}</p>
                    </div>
                    <Badge variant={p.active ? 'outline' : 'secondary'} className="shrink-0 text-[10px]">
                      {p.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  {p.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <p className="text-base font-semibold tabular-nums">{formatMoney(p.selling_price_paise)}</p>
                      <p className="text-xs text-muted-foreground">GST {gstRateLabel(p.gst_rate_bps)}{p.hsn_sac ? ` · HSN ${p.hsn_sac}` : ''}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Archive ${p.name}`}>
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Archive {p.name}?</AlertDialogTitle>
                            <AlertDialogDescription>It will no longer appear in pickers. Historical documents are unaffected.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void doArchive(p)}>Archive</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  {use && use.count > 0 && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <TrendingUp className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                      Used in {use.count} invoice line(s) · {formatMoney(use.revenue)} revenue
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {form && (
        <Dialog open onOpenChange={(v) => !v && setForm(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{form.id ? 'Edit product' : 'New product / service'}</DialogTitle>
              <DialogDescription>Items auto-fill descriptions, HSN/SAC, pricing and GST in documents.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="p-name">Name *</Label>
                <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. LED Panel Light 18W" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-sku">SKU</Label>
                <Input id="p-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="LED-18W" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-hsn">HSN / SAC</Label>
                <Input id="p-hsn" value={form.hsn_sac} onChange={(e) => setForm({ ...form, hsn_sac: e.target.value })} placeholder="9405" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="p-desc">Description</Label>
                <Textarea id="p-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-unit">Unit</Label>
                <Input id="p-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="PCS / HRS / NOS" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-price">Selling price (Rs.) *</Label>
                <Input id="p-price" inputMode="decimal" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-cost">Cost price (Rs.)</Label>
                <Input id="p-cost" inputMode="decimal" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>GST rate</Label>
                <Select value={String(form.gst_rate_bps)} onValueChange={(v) => setForm({ ...form, gst_rate_bps: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STANDARD_GST_RATES_BPS.map((b) => <SelectItem key={b} value={String(b)}>{gstRateLabel(b)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch id="p-incl" checked={form.price_includes_tax} onCheckedChange={(v) => setForm({ ...form, price_includes_tax: v })} />
                <Label htmlFor="p-incl" className="font-normal">Prices include GST (tax-inclusive)</Label>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch id="p-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                <Label htmlFor="p-active" className="font-normal">Active (visible in document pickers)</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={submit} disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save product'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        Duplicate names trigger a warning — India GST best practice keeps one master entry per item.
      </p>
    </div>
  )
}
