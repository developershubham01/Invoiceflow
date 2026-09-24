'use client'

import { useState } from 'react'
import { APP_VERSION } from '@/lib/version'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { navigate } from '@/lib/router'
import { useAppStore } from '@/lib/stores/app-store'
import { Cloud, Landmark, Loader2, ShieldCheck, WifiOff } from 'lucide-react'

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </svg>
  )
}

interface AuthViewProps {
  initialMode?: 'login' | 'register'
}

export function AuthView({ initialMode = 'login' }: AuthViewProps) {
  const store = useAppStore()
  const [googleBusy, setGoogleBusy] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const rawSearch = window.location.search || (window.location.hash.includes('?') ? window.location.hash.substring(window.location.hash.indexOf('?')) : '')
    if (!rawSearch) return null
    const params = new URLSearchParams(rawSearch)
    const err = params.get('error')
    if (err === 'google_oauth_failed') {
      return 'Google Sign-In failed. Please check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel settings or sign in with email.'
    } else if (err) {
      return `Authentication note: ${err}`
    }
    return null
  })

  const handleGoogleClick = () => {
    setGoogleBusy(true)
    if (typeof window !== 'undefined') {
      window.location.assign('/api/auth/google/login')
    }
  }

  const checkCompanyProfileAndRedirect = async (userId: string) => {
    const { getCompanyByUserId, getActiveWorkspace, getCompany, createWorkspace } = await import('@/lib/db/repositories')
    
    let activeWs = await getActiveWorkspace()
    if (!activeWs) {
      activeWs = await createWorkspace('My Business Workspace')
      useAppStore.getState().setActiveWorkspace(activeWs)
    }

    // Check by user_id first in local DB
    let company = await getCompanyByUserId(userId)
    if (!company && activeWs) {
      company = await getCompany(activeWs.id)
    }

    if (company && company.name) {
      navigate('dashboard')
    } else {
      navigate('company-profile')
    }
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both email and password.')
      return
    }
    if (authMode === 'register' && !name.trim()) {
      setErrorMsg('Please enter your full name.')
      return
    }

    setEmailBusy(true)
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const payload = authMode === 'register' ? { name, email, password } : { email, password }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        throw new Error(data?.error || 'Authentication failed. Please try again.')
      }
      
      // Update global user state
      store.setUser(data.user)

      // Redirect based on company profile existence
      await checkCompanyProfileAndRedirect(data.user.id)
    } catch (err) {
      setErrorMsg((err as Error).message)
    } finally {
      setEmailBusy(false)
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
            <li className="flex items-start gap-2.5"><Cloud className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" /> Sign in with Email or Google to link your device and backup your workspace.</li>
            <li className="flex items-start gap-2.5"><ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" /> GST-aware calculations, professional PDFs, and audit history built in.</li>
          </ul>
        </div>

        {/* form card */}
        <Card className="py-0 shadow-lg border-emerald-500/10">
          <CardContent className="p-6">
            <h1 className="text-2xl font-bold tracking-tight">
              {authMode === 'login' ? 'Sign In to InvoiceFlow' : 'Create your Account'}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {authMode === 'login'
                ? 'Enter your email and password or sign in with Google to continue.'
                : 'Register a new account to setup your company profile and workspace.'}
            </p>



            {/* Google OAuth Option */}
            <div className="mt-4 space-y-3">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-3 border-slate-300 dark:border-slate-800 bg-background hover:bg-slate-50 dark:hover:bg-slate-900 font-semibold py-5 text-sm shadow-sm transition-all"
                onClick={handleGoogleClick}
                disabled={googleBusy || emailBusy}
              >
                {googleBusy ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <GoogleIcon className="h-5 w-5 shrink-0" />
                )}
                <span>Continue with Google</span>
              </Button>

              <div className="relative my-4 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-muted" /></div>
                <span className="relative bg-card px-2 text-[11px] uppercase tracking-wider text-muted-foreground">Or with email</span>
              </div>

              {/* Mode Selector */}
              <div className="flex rounded-lg bg-muted p-1 text-xs">
                <button
                  type="button"
                  className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${authMode === 'login' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => { setAuthMode('login'); setErrorMsg(null); }}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${authMode === 'register' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => { setAuthMode('register'); setErrorMsg(null); }}
                >
                  Sign Up
                </button>
              </div>

              {/* Email + Password Form */}
              <form onSubmit={handleEmailAuth} className="space-y-3.5 pt-1">
                {errorMsg && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive font-medium">
                    {errorMsg}
                  </div>
                )}

                {authMode === 'register' && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium" htmlFor="auth-name">Full Name *</label>
                    <input
                      id="auth-name"
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                      required
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-medium" htmlFor="auth-email">Email Address *</label>
                  <input
                    id="auth-email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium" htmlFor="auth-password">Password *</label>
                  <input
                    id="auth-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    required
                  />
                </div>

                <Button type="submit" className="w-full font-semibold bg-primary text-primary-foreground hover:bg-primary/90" disabled={emailBusy || googleBusy}>
                  {emailBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : authMode === 'login' ? (
                    'Sign In'
                  ) : (
                    'Create Account & Setup Company'
                  )}
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>

      <footer className="border-t bg-card/60 px-4 py-3 text-center text-xs text-muted-foreground">
        InvoiceFlow v{APP_VERSION} · Protected by Email & Google Authentication
      </footer>
    </div>
  )
}
