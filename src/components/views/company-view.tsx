'use client'

import { useEffect, useRef, useState } from 'react'
import { useCompany, useActiveWorkspace } from '@/lib/hooks/app-hooks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { saveCompany, peekNextNumber } from '@/lib/db/repositories'
import { getDb } from '@/lib/db/db'
import { companyProfileSchema } from '@/lib/domain/schemas'
import { INDIAN_STATES, STANDARD_GST_RATES_BPS, gstRateLabel, stateByCode, stateCodeFromGstin } from '@/lib/domain/gst'
import { todayStr } from '@/lib/date'
import { toast } from 'sonner'
import { useLiveQuery } from 'dexie-react-hooks'
import { Building2, Save, Upload } from 'lucide-react'

interface FormState {
  name: string
  business_type: string
  address_line1: string
  address_line2: string
  city: string
  pincode: string
  state_code: string
  gstin: string
  pan: string
  phone: string
  email: string
  website: string
  bank_name: string
  bank_account: string
  bank_ifsc: string
  bank_branch: string
  authorized_signatory: string
  invoice_prefix: string
  quotation_prefix: string
  default_gst_rate_bps: number
  price_includes_tax: boolean
  enable_round_off: boolean
  default_notes: string
  default_terms: string
  logo_data: string | null
  signature_data: string | null
}

export function CompanyView() {
  const ws = useActiveWorkspace()
  const company = useCompany()
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)
  const sigInput = useRef<HTMLInputElement>(null)

  /** Live read-only preview of the next allocated numbers (respects the typed prefixes). */
  const numberPreview = useLiveQuery(async () => {
    if (!ws || !form) return null
    const [invoice, quotation] = await Promise.all([
      peekNextNumber(getDb(), ws.id, 'INVOICE', form.invoice_prefix || 'INV', todayStr()),
      peekNextNumber(getDb(), ws.id, 'QUOTATION', form.quotation_prefix || 'QT', todayStr()),
    ])
    return { invoice, quotation }
  }, [ws?.id, form?.invoice_prefix, form?.quotation_prefix])

  useEffect(() => {
    if (!company || form) return
    setForm({
      name: company.name, business_type: company.business_type ?? '',
      address_line1: company.address_line1 ?? '', address_line2: company.address_line2 ?? '',
      city: company.city ?? '', pincode: company.pincode ?? '', state_code: company.state_code ?? '',
      gstin: company.gstin ?? '', pan: company.pan ?? '', phone: company.phone ?? '', email: company.email ?? '',
      website: company.website ?? '', bank_name: company.bank_name ?? '', bank_account: company.bank_account ?? '',
      bank_ifsc: company.bank_ifsc ?? '', bank_branch: company.bank_branch ?? '',
      authorized_signatory: company.authorized_signatory ?? '',
      invoice_prefix: company.invoice_prefix, quotation_prefix: company.quotation_prefix,
      default_gst_rate_bps: company.default_gst_rate_bps, price_includes_tax: company.price_includes_tax,
      enable_round_off: company.enable_round_off,
      default_notes: company.default_notes ?? '', default_terms: company.default_terms ?? '',
      logo_data: company.logo_data, signature_data: company.signature_data,
    })
  }, [company, form])

  const readImage = (file: File, cb: (dataUrl: string) => void) => {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      toast.error('Only PNG or JPEG images are allowed')
      return
    }
    if (file.size > 1024 * 1024) {
      toast.error('Image must be under 1 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => cb(String(reader.result))
    reader.readAsDataURL(file)
  }

  const submit = async () => {
    if (!ws || !form) return
    const parsed = companyProfileSchema.safeParse({
      ...form,
      state_name: stateByCode(form.state_code)?.name ?? '',
      logo_data: form.logo_data ?? '',
      signature_data: form.signature_data ?? '',
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please check the highlighted fields')
      return
    }
    setSaving(true)
    try {
      await saveCompany(ws.id, {
        id: company?.id,
        ...parsed.data,
        state_code: form.state_code || stateCodeFromGstin(form.gstin) || null,
        state_name: stateByCode(form.state_code)?.name ?? null,
      } as never)
      toast.success('Company profile saved', { description: 'Used across invoices, quotations and PDFs.' })
    } catch (err) {
      toast.error('Could not save company', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  if (!form) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      </div>
    )
  }

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch })

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Business identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="co-name">Company name *</Label>
              <Input id="co-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-type">Business type</Label>
              <Input id="co-type" value={form.business_type} onChange={(e) => set({ business_type: e.target.value })} placeholder="Pvt Ltd / LLP / Proprietor" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-gstin">GSTIN</Label>
              <Input id="co-gstin" value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} placeholder="27AAACA1234A1Z5" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-pan">PAN</Label>
              <Input id="co-pan" value={form.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} placeholder="AAACA1234A" />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <Select value={form.state_code} onValueChange={(v) => set({ state_code: v })}>
                <SelectTrigger><SelectValue placeholder="Select state (supplier state)" /></SelectTrigger>
                <SelectContent>
                  {INDIAN_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="co-addr1">Address line 1</Label>
              <Input id="co-addr1" value={form.address_line1} onChange={(e) => set({ address_line1: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="co-addr2">Address line 2</Label>
              <Input id="co-addr2" value={form.address_line2} onChange={(e) => set({ address_line2: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-city">City</Label>
              <Input id="co-city" value={form.city} onChange={(e) => set({ city: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-pin">PIN code</Label>
              <Input id="co-pin" value={form.pincode} onChange={(e) => set({ pincode: e.target.value })} placeholder="400051" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Contact & branding</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="co-phone">Phone</Label>
              <Input id="co-phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-email">Email</Label>
              <Input id="co-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="co-web">Website</Label>
              <Input id="co-web" value={form.website} onChange={(e) => set({ website: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Company logo (PNG/JPEG, ≤ 1 MB)</Label>
              <div className="flex items-center gap-3">
                {form.logo_data ? (
                   
                  <img src={form.logo_data} alt="Company logo preview" className="h-14 w-14 rounded-lg border object-contain p-1" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                    <Building2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                )}
                <input ref={logoInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) readImage(f, (d) => set({ logo_data: d }))
                }} />
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => logoInput.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> {form.logo_data ? 'Replace' : 'Upload logo'}
                </Button>
                {form.logo_data && (
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => set({ logo_data: null })}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Signature image (used on PDFs)</Label>
              <div className="flex items-center gap-3">
                {form.signature_data ? (
                   
                  <img src={form.signature_data} alt="Signature preview" className="h-10 w-32 rounded-lg border object-contain p-1" />
                ) : (
                  <div className="flex h-10 w-32 items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground">no signature</div>
                )}
                <input ref={sigInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) readImage(f, (d) => set({ signature_data: d }))
                }} />
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => sigInput.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> {form.signature_data ? 'Replace' : 'Upload'}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="co-sign">Authorized signatory name</Label>
              <Input id="co-sign" value={form.authorized_signatory} onChange={(e) => set({ authorized_signatory: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Invoicing defaults</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="co-invprefix">Invoice prefix</Label>
              <Input id="co-invprefix" value={form.invoice_prefix} onChange={(e) => set({ invoice_prefix: e.target.value.toUpperCase() })} placeholder="INV" />
              <p className="text-[11px] text-muted-foreground" aria-live="polite">
                Next: <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{numberPreview ? numberPreview.invoice : '…'}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-qtprefix">Quotation prefix</Label>
              <Input id="co-qtprefix" value={form.quotation_prefix} onChange={(e) => set({ quotation_prefix: e.target.value.toUpperCase() })} placeholder="QT" />
              <p className="text-[11px] text-muted-foreground" aria-live="polite">
                Next: <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{numberPreview ? numberPreview.quotation : '…'}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Default GST rate</Label>
              <Select value={String(form.default_gst_rate_bps)} onValueChange={(v) => set({ default_gst_rate_bps: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STANDARD_GST_RATES_BPS.map((b) => <SelectItem key={b} value={String(b)}>{gstRateLabel(b)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch id="co-incl" checked={form.price_includes_tax} onCheckedChange={(v) => set({ price_includes_tax: v })} />
              <Label htmlFor="co-incl" className="font-normal">Prices include GST by default</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="co-round" checked={form.enable_round_off} onCheckedChange={(v) => set({ enable_round_off: v })} />
              <Label htmlFor="co-round" className="font-normal">Round off grand total</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Bank & document defaults</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="co-bank">Bank name</Label>
              <Input id="co-bank" value={form.bank_name} onChange={(e) => set({ bank_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-acct">Account number</Label>
              <Input id="co-acct" value={form.bank_account} onChange={(e) => set({ bank_account: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-ifsc">IFSC</Label>
              <Input id="co-ifsc" value={form.bank_ifsc} onChange={(e) => set({ bank_ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0000123" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="co-branch">Branch</Label>
              <Input id="co-branch" value={form.bank_branch} onChange={(e) => set({ bank_branch: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="co-notes">Default notes</Label>
              <Textarea id="co-notes" rows={2} value={form.default_notes} onChange={(e) => set({ default_notes: e.target.value })} placeholder="Thank you for your business!" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="co-terms">Default terms & conditions</Label>
              <Textarea id="co-terms" rows={3} value={form.default_terms} onChange={(e) => set({ default_terms: e.target.value })} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end pb-2">
        <Button onClick={() => void submit()} disabled={saving || !form.name.trim()} className="gap-1.5">
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save company profile'}
        </Button>
      </div>
    </div>
  )
}

