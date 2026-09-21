'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiClaimWorkspace, apiLogin, apiRegister } from '@/lib/sync/client'
import { getActiveWorkspace } from '@/lib/db/repositories'
import { getDeviceId } from '@/lib/device'
import { useAppStore } from '@/lib/stores/app-store'
import { navigate } from '@/lib/router'
import { toast } from 'sonner'
import { ArrowLeft, Cloud, Landmark, Loader2, Lock, Mail, ShieldCheck, WifiOff } from 'lucide-react'

export function AuthView() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const store = useAppStore()

  const submit = async () => {
    setBusy(true)
    try {
      let user
      if (mode === 'register') {
        ({ user } = await apiRegister(name.trim(), email.trim(), password))
      } else {
        ({ user } = await apiLogin(email.trim(), password))
      }
      store.setUser(user)

      // Guest→cloud migration (CANON §11): claim the local workspace, then the sync engine pushes everything.
      const ws = await getActiveWorkspace()
      if (ws && !ws.cloud_linked_at) {
        try {
          await apiClaimWorkspace(ws.id, ws.name, getDeviceId())
          const { getDb } = await import('@/lib/db/db')
          await getDb().workspaces.update(ws.id, { cloud_linked_at: new Date().toISOString(), owner_user_id: user.id })
          const { getActiveWorkspace: refresh } = await import('@/lib/db/repositories')
          store.setActiveWorkspace(await refresh())
          toast.success(`Workspace "${ws.name}" linked to your account`, { description: 'Your local data will now sync to the cloud.' })
        } catch (err) {
          toast.warning('Signed in, but workspace link failed', { description: (err as Error).message })
        }
      } else {
        toast.success(`Welcome back, ${user.name ?? user.email}`)
      }
      const { runSync } = await import('@/lib/sync/engine')
      void runSync()
      navigate('dashboard')
    } catch (err) {
      toast.error(mode === 'register' ? 'Could not create account' : 'Sign in failed', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50/60 to-background dark:from-emerald-950/20">
      <div className="mx-auto grid w-full max-w-4xl flex-1 items-center gap-10 px-4 py-10 lg:grid-cols-2">
        {/* pitch panel */}
        <div className="hidden lg:block">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
              <Landmark className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="text-lg font-bold">InvoiceFlow</span>
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight">Your invoices,<br />everywhere — even offline.</h2>
          <ul className="mt-6 space-y-3.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2.5"><WifiOff className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" /> Create invoices & quotations without internet — data is stored locally first.</li>
            <li className="flex items-start gap-2.5"><Cloud className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" /> Sign in to link this device and sync your workspace across devices.</li>
            <li className="flex items-start gap-2.5"><ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" /> GST-aware calculations, professional PDFs, and audit history built in.</li>
          </ul>
        </div>

        {/* form */}
        <Card className="py-0">
          <CardContent className="p-6">
            <Button variant="ghost" size="sm" className="-ml-2 mb-3 gap-1.5 text-muted-foreground" onClick={() => navigate('dashboard')}>
              <ArrowLeft className="h-4 w-4" /> Continue as guest
            </Button>
            <h1 className="text-xl font-bold">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === 'login' ? 'Access your synced workspaces.' : 'Your existing guest workspace will be linked automatically.'}
            </p>

            <div className="mt-5 space-y-3.5">
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="au-name">Name</Label>
                  <Input id="au-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="au-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input id="au-email" type="email" className="pl-8" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.in" autoComplete="email" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="au-pass">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="au-pass" type="password" className="pl-8" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    onKeyDown={(e) => { if (e.key === 'Enter' && email && password) void submit() }}
                  />
                </div>
              </div>
              <Button className="w-full" onClick={() => void submit()} disabled={busy || !email.trim() || !password}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {mode === 'login' ? 'Sign in' : 'Create account'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {mode === 'login' ? (
                  <>New here?{' '}<button className="font-medium text-foreground underline" onClick={() => setMode('register')}>Create an account</button></>
                ) : (
                  <>Already have an account?{' '}<button className="font-medium text-foreground underline" onClick={() => setMode('login')}>Sign in</button></>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      <footer className="border-t bg-card/60 px-4 py-3 text-center text-xs text-muted-foreground">
        InvoiceFlow v0.1.0 · Sessions are protected with httpOnly cookies · Passwords hashed with scrypt
      </footer>
    </div>
  )
}
