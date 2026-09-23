'use client'

import { useRef, useState } from 'react'
import { APP_VERSION } from '@/lib/version'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { INDIAN_STATES, stateByCode, stateCodeFromGstin } from '@/lib/domain/gst'
import { companyProfileSchema } from '@/lib/domain/schemas'
import { createWorkspace, getCompany, saveCompany } from '@/lib/db/repositories'
import { navigate } from '@/lib/router'
import { useAppStore } from '@/lib/stores/app-store'
import { toast } from 'sonner'
import { Building2, CheckCircle2, Globe, Landmark, Loader2, Upload } from 'lucide-react'

const BUSINESS_TYPES = [
  'Private Limited Company',
  'Proprietorship',
  'Partnership Firm',
  'Limited Liability Partnership (LLP)',
  'Public Limited Company',
  'Freelancer / Independent Contractor',
  'Non-Profit / NGO',
  'Other',
]

const INDUSTRIES = [
  'IT & Software Services',
  'Retail & E-commerce',
  'Manufacturing & Production',
  'Professional & Agency Services',
  'Construction & Real Estate',
  'Healthcare & Pharmaceuticals',
  'Education & Training',
  'Financial Services & Fintech',
  'Food & Beverage / Hospitality',
  'Media & Entertainment',
  'Other',
]

export function OnboardingView() {
  const [mode, setMode] = useState<'create' | 'completed'>('create')
  const [busy, setBusy] = useState(false)
  const store = useAppStore()
  const user = store.user

  // Form State - Company Profile Setup
  const [name, setName] = useState('')
  const [logoData, setLogoData] = useState<string | null>(null)
  const [businessType, setBusinessType] = useState('')
  const [industry, setIndustry] = useState('')
  const [website, setWebsite] = useState('')
  const [email, setEmail] = useState(user?.email || '')
  const [phone, setPhone] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [pincode, setPincode] = useState('')
  const [gstin, setGstin] = useState('')
  const [pan, setPan] = useState('')
  const [description, setDescription] = useState('')

  // Bank & Other details
  const [bankName, setBankName] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [bankIfsc, setBankIfsc] = useState('')
  const [upiVpa, setUpiVpa] = useState('')

  const logoInputRef = useRef<HTMLInputElement>(null)

  const readLogoImage = (file: File) => {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      toast.error('Only PNG or JPEG images are allowed')
      return
    }
    if (file.size > 1024 * 1024) {
      toast.error('Logo image must be under 1 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setLogoData(String(reader.result))
    reader.readAsDataURL(file)
  }

  const finish = async (wsId: string) => {
    const company = await getCompany(wsId)
    store.setActiveWorkspace({ ...(store.activeWorkspace ?? { id: wsId, name: name || 'My workspace' } as never), id: wsId })
    const { getActiveWorkspace, listWorkspaces } = await import('@/lib/db/repositories')
    store.setWorkspaces(await listWorkspaces())
    store.setActiveWorkspace(await getActiveWorkspace())
    void company

    setMode('completed')
    setTimeout(() => {
      navigate('dashboard')
    }, 1600)
  }

  const createCompany = async () => {
    if (!user) {
      toast.error('Authentication required', { description: 'Please log in or sign up before creating a company profile.' })
      navigate('login')
      return
    }

    const parsed = companyProfileSchema.safeParse({
      name,
      business_type: businessType,
      industry,
      description,
      logo_data: logoData || '',
      address_line1: addressLine1,
      address_line2: addressLine2,
      city,
      state_code: stateCode,
      state_name: stateByCode(stateCode)?.name ?? '',
      pincode,
      gstin,
      pan,
      phone,
      email,
      website,
      bank_name: bankName,
      bank_account: bankAccount,
      bank_ifsc: bankIfsc,
      upi_vpa: upiVpa,
      invoice_prefix: 'INV',
      quotation_prefix: 'QT',
      default_gst_rate_bps: 1800,
      price_includes_tax: false,
      enable_round_off: true,
    })

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please check the company details entered.')
      return
    }

    setBusy(true)
    try {
      const ws = await createWorkspace(name.trim() || 'My workspace')
      await saveCompany(ws.id, {
        ...parsed.data,
        user_id: user.id,
        state_code: stateCode || stateCodeFromGstin(gstin) || null,
        state_name: stateByCode(stateCode)?.name ?? null,
      } as never)

      toast.success('Company profile created successfully!')
      await finish(ws.id)
    } catch (err) {
      toast.error('Could not create company profile', { description: (err as Error).message })
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50/60 to-background dark:from-emerald-950/20">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-8">
        {mode !== 'completed' && (
          <div className="mb-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <Landmark className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight">Setup Your Company Profile</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {user ? `Logged in as ${user.email}. Complete setup to unlock your dashboard.` : 'Authentication required to setup company.'}
            </p>
          </div>
        )}

        {mode === 'completed' ? (
          <Card className="border-emerald-500/30 bg-emerald-500/5 py-8 text-center shadow-lg">
            <CardContent className="space-y-4 p-6">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 shadow">
                <CheckCircle2 className="h-10 w-10 animate-bounce" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">Profile Completed!</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Your company profile is linked to your account. Redirecting you straight to your Dashboard...
              </p>
              <div className="flex justify-center pt-2">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-lg">
            <CardContent className="space-y-6 p-6">
              <div className="border-b pb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">Company Profile Setup</h2>
                  <p className="text-xs text-muted-foreground">Provide details to generate branded invoices and compliant GST reports.</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate('login')} className="text-xs text-muted-foreground">
                  Switch Account
                </Button>
              </div>

              {/* 1. Basic Identity */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">1. Company Identity & Branding</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ob-name">Company Name *</Label>
                    <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Innovations Pvt Ltd" autoFocus required />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Company Logo</Label>
                    <div className="flex items-center gap-4">
                      {logoData ? (
                        <img src={logoData} alt="Company logo preview" className="h-14 w-14 rounded-lg border object-contain p-1" />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                          <Building2 className="h-6 w-6" aria-hidden="true" />
                        </div>
                      )}
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) readLogoImage(f)
                        }}
                      />
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => logoInputRef.current?.click()}>
                        <Upload className="h-3.5 w-3.5" /> {logoData ? 'Change Logo' : 'Upload Company Logo'}
                      </Button>
                      {logoData && (
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground text-xs" onClick={() => setLogoData(null)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Company Type</Label>
                    <Select value={businessType} onValueChange={setBusinessType}>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        {BUSINESS_TYPES.map((bt) => <SelectItem key={bt} value={bt}>{bt}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Industry</Label>
                    <Select value={industry} onValueChange={setIndustry}>
                      <SelectTrigger><SelectValue placeholder="Select industry" /></SelectTrigger>
                      <SelectContent>
                        {INDUSTRIES.map((ind) => <SelectItem key={ind} value={ind}>{ind}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ob-desc">Company Description / Tagline</Label>
                    <Textarea
                      id="ob-desc"
                      rows={2}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Brief overview of your business, services or products..."
                    />
                  </div>
                </div>
              </div>

              {/* 2. Contact & Address */}
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">2. Contact & Location</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-email">Email Address</Label>
                    <Input id="ob-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@company.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-phone">Phone Number</Label>
                    <Input id="ob-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ob-website">Website</Label>
                    <div className="relative">
                      <Input id="ob-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.company.com" className="pl-8" />
                      <Globe className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ob-addr1">Address Line 1</Label>
                    <Input id="ob-addr1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Street, Building, Suite" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ob-addr2">Address Line 2</Label>
                    <Input id="ob-addr2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Area, Landmark" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-city">City</Label>
                    <Input id="ob-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mumbai" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>State</Label>
                    <Select value={stateCode} onValueChange={setStateCode}>
                      <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                      <SelectContent>
                        {INDIAN_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-pincode">PIN Code</Label>
                    <Input id="ob-pincode" value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="400001" />
                  </div>
                </div>
              </div>

              {/* 3. GST & Tax */}
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">3. GST & Tax Details</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-gstin">GSTIN</Label>
                    <Input id="ob-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="27AAACA1234A1Z5" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-pan">PAN</Label>
                    <Input id="ob-pan" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="AAACA1234A" />
                  </div>
                </div>
              </div>

              {/* 4. Other Business Details */}
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">4. Other Business Details (Banking & UPI)</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-bank">Bank Name</Label>
                    <Input id="ob-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="HDFC Bank" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-acct">Account Number</Label>
                    <Input id="ob-acct" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="5010023456789" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-ifsc">IFSC Code</Label>
                    <Input id="ob-ifsc" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} placeholder="HDFC0000123" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-upi">UPI VPA</Label>
                    <Input id="ob-upi" value={upiVpa} onChange={(e) => setUpiVpa(e.target.value.toLowerCase())} placeholder="company@upi" />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between border-t pt-4">
                <Button variant="ghost" onClick={() => navigate('landing')}>Back to Home</Button>
                <Button onClick={() => void createCompany()} disabled={busy || !name.trim()} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? 'Saving Profile…' : 'Complete Setup & Go to Dashboard'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <footer className="border-t bg-card/60 px-4 py-3 text-center text-xs text-muted-foreground">
        InvoiceFlow v{APP_VERSION} · Local-first · IndexedDB storage · Cloud sync optional
      </footer>
    </div>
  )
}
