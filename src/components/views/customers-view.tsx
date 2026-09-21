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
import { formatDateDisplay } from '@/lib/date'
import { toast } from 'sonner'
import { ArrowLeft, Building2, Mail, MapPin, Pencil, Phone, Plus, Receipt, Search, Trash2, UserRound } from 'lucide-react'
import type { Customer } from '@/lib/domain/types'

interface FormState {
  id?: string
  type: 'BUSINESS' | 'INDIVIDUAL'
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

const emptyForm: FormState = { type: 'BUSINESS', business_name: '', contact_person: '', email: '', phone: '', gstin: '', billing_address: '', shipping_address: '', state_code: '', notes: '' }

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
      id: c.id, type: c.type, business_name: c.business_name, contact_person: c.contact_person ?? '',
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
              className="cursor-pointer py-0 transition-all hover:border-primary/40 hover:shadow-sm"
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
