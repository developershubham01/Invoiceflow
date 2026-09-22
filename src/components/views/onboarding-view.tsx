'use client'

import { useState } from 'react'
import { APP_VERSION } from '@/lib/version'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { INDIAN_STATES, stateByCode, stateCodeFromGstin } from '@/lib/domain/gst'
import { companyProfileSchema } from '@/lib/domain/schemas'
import { createWorkspace, getCompany, saveCompany } from '@/lib/db/repositories'
import { seedDemoData as seedDemoWorkspace } from '@/lib/db/seed'
import { navigate } from '@/lib/router'
import { useAppStore } from '@/lib/stores/app-store'
import { toast } from 'sonner'
import { Landmark, Loader2, Sparkles, Wallet } from 'lucide-react'

export function OnboardingView() {
  const [mode, setMode] = useState<'menu' | 'create'>('menu')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState('')
  const store = useAppStore()

  const finish = async (wsId: string) => {
    const company = await getCompany(wsId)
    store.setActiveWorkspace({ ...(store.activeWorkspace ?? { id: wsId, name: 'My workspace' } as never), id: wsId })
    const { getActiveWorkspace, listWorkspaces } = await import('@/lib/db/repositories')
    store.setWorkspaces(await listWorkspaces())
    store.setActiveWorkspace(await getActiveWorkspace())
    void company
    navigate('dashboard')
  }

  const createCompany = async () => {
    const parsed = companyProfileSchema.safeParse({
      name, gstin, state_code: stateCode, state_name: stateByCode(stateCode)?.name ?? '',
      invoice_prefix: 'INV', quotation_prefix: 'QT', default_gst_rate_bps: 1800,
      price_includes_tax: false, enable_round_off: true,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please fill the required fields')
      return
    }
    setBusy(true)
    try {
      const ws = await createWorkspace(name.trim() || 'My workspace')
      await saveCompany(ws.id, {
        ...parsed.data,
        state_code: stateCode || stateCodeFromGstin(gstin) || null,
        state_name: stateByCode(stateCode)?.name ?? null,
      } as never)
      toast.success('Workspace created', { description: 'Welcome to InvoiceFlow!' })
      await finish(ws.id)
    } catch (err) {
      toast.error('Could not create workspace', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const loadDemo = async () => {
    setBusy(true)
    try {
      const ws = await createWorkspace('Acme Traders (sample)')
      await seedDemoWorkspace(ws.id)
      toast.success('Sample data loaded', { description: 'Explore invoices, quotations, reports and PDFs — clear it anytime in Settings.' })
      await finish(ws.id)
    } catch (err) {
      toast.error('Could not load sample data', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50/60 to-background dark:from-emerald-950/20">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Landmark className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Welcome to InvoiceFlow</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Offline-first invoices & quotations for Indian businesses. Your data lives on this device first — the cloud is optional.
          </p>
        </div>

        {mode === 'menu' ? (
          <div className="space-y-3">
            <Card className="cursor-pointer py-0 transition-all hover:border-primary/40 hover:shadow-md" onClick={() => setMode('create')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setMode('create') }}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Wallet className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Create my company</p>
                  <p className="text-xs text-muted-foreground">Set up a fresh workspace with your business details.</p>
                </div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer py-0 transition-all hover:border-primary/40 hover:shadow-md" onClick={() => void loadDemo()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') void loadDemo() }}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Explore with sample data</p>
                  <p className="text-xs text-muted-foreground">A demo workspace with customers, products, invoices & reports.</p>
                </div>
                {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
              </CardContent>
            </Card>
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => navigate('login')}>
              Sign in or create an account instead
            </Button>
          </div>
        ) : (
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="ob-name">Company name *</Label>
                <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Traders Pvt Ltd" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ob-gstin">GSTIN</Label>
                  <Input id="ob-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="27AAACA1234A1Z5" />
                </div>
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Select value={stateCode} onValueChange={setStateCode}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {INDIAN_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">You can complete address, bank and branding details later in My Company.</p>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setMode('menu')}>Back</Button>
                <Button onClick={() => void createCompany()} disabled={busy || !name.trim()}>
                  {busy ? 'Creating…' : 'Create workspace'}
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
