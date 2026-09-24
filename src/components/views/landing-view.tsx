'use client'

import { APP_VERSION } from '@/lib/version'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { navigate } from '@/lib/router'
import { useAppStore } from '@/lib/stores/app-store'
import {
  ArrowRight,
  Cloud,
  FileText,
  Landmark,
  Lock,
  Receipt,
  ShieldCheck,
  Users,
  WifiOff,
  Zap,
} from 'lucide-react'

export function LandingView() {
  const store = useAppStore()
  const user = store.user

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-emerald-500 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border/40 px-4 lg:px-8 py-3.5">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => navigate('landing')}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-md shadow-emerald-600/20">
              <Landmark className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text">
                InvoiceFlow
              </span>
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 tracking-wide uppercase">
                Offline-First GST Invoicing
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
            <a href="#security" className="hover:text-foreground transition-colors">Security & Offline</a>
          </nav>

          <div className="flex items-center gap-3">
            {user ? (
              <Button
                onClick={() => navigate('dashboard')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md shadow-emerald-600/20 gap-2"
              >
                Go to Dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <>

                <Button
                  variant="ghost"
                  onClick={() => navigate('login')}
                  className="font-medium hover:text-emerald-600"
                >
                  Sign In
                </Button>

                <Button
                  onClick={() => navigate('signup')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md shadow-emerald-600/20 gap-1.5"
                >
                  Get Started <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-32 bg-gradient-to-b from-emerald-500/5 via-transparent to-background">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(16,185,129,0.15),rgba(255,255,255,0))]" />
        
        <div className="mx-auto max-w-7xl px-4 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 backdrop-blur-md">
              <Zap className="h-3.5 w-3.5 fill-current" />
              <span>Next-Gen Offline-First Architecture · GST Ready</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.15]">
              Invoicing & Billing,<br />
              <span className="bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-600 bg-clip-text text-transparent">
                Always Fast & Offline
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
              Create GST compliant invoices, manage clients, track inventory, and send quotes instantly. Works 100% offline in your browser with automatic cloud backup when online.
            </p>

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                size="lg"
                onClick={() => navigate(user ? 'dashboard' : 'signup')}
                className="w-full sm:w-auto px-8 py-6 text-base font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25 rounded-xl gap-2"
              >
                {user ? 'Open Your Dashboard' : 'Start Free Account'} <ArrowRight className="h-5 w-5" />
              </Button>

              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate('login')}
                className="w-full sm:w-auto px-8 py-6 text-base font-semibold border-slate-300 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-xl gap-2"
              >
                Sign In <ArrowRight className="h-5 w-5" />
              </Button>
            </div>

            <div className="pt-6 flex items-center justify-center gap-6 text-xs text-muted-foreground font-medium">
              <div className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-600" /> No credit card required</div>
              <div className="flex items-center gap-1.5"><WifiOff className="h-4 w-4 text-emerald-600" /> 100% Offline Capable</div>
              <div className="flex items-center gap-1.5"><Cloud className="h-4 w-4 text-emerald-600" /> Instant Supabase Sync</div>
            </div>
          </div>

          {/* Hero Graphics Mockup */}
          <div className="mt-16 relative mx-auto max-w-5xl rounded-2xl border border-border/80 bg-card p-3 lg:p-4 shadow-2xl backdrop-blur-xl">
            <div className="rounded-xl overflow-hidden border border-border/50 bg-slate-950 p-4 lg:p-6 text-white space-y-6">
              {/* Fake App Bar */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-red-500/80" />
                  <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                  <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                  <span className="ml-2 text-xs font-mono text-slate-400">InvoiceFlow · Your Company Name</span>
                </div>
                <div className="inline-flex items-center gap-2 rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Offline-Ready & Synced
                </div>
              </div>

              {/* Fake Dashboard Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl bg-slate-900/90 p-4 border border-slate-800 space-y-2">
                  <p className="text-xs text-slate-400 font-medium">Total Billed</p>
                  <p className="text-2xl font-bold text-emerald-400">Real-time data</p>
                  <p className="text-[11px] text-slate-500">From your invoices · GST Compliant</p>
                </div>

                <div className="rounded-xl bg-slate-900/90 p-4 border border-slate-800 space-y-2">
                  <p className="text-xs text-slate-400 font-medium">Collected Amount</p>
                  <p className="text-2xl font-bold text-cyan-400">Live tracking</p>
                  <p className="text-[11px] text-slate-500">Collection rate calculated automatically</p>
                </div>

                <div className="rounded-xl bg-slate-900/90 p-4 border border-slate-800 space-y-2">
                  <p className="text-xs text-slate-400 font-medium">Pending Quotations</p>
                  <p className="text-2xl font-bold text-amber-400">Auto-tracked</p>
                  <p className="text-[11px] text-slate-500">Convert to invoices in one click</p>
                </div>
              </div>

              {/* Sample Invoice Table */}
              <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden text-xs">
                <div className="bg-slate-900 px-4 py-3 font-semibold text-slate-300 flex justify-between border-b border-slate-800">
                  <span>Recent Transactions</span>
                  <span>GST Rate: 18%</span>
                </div>
                <div className="divide-y divide-slate-800/60">
                  <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-800/30">
                    <div>
                      <p className="font-semibold text-slate-200">INV-2026-0012 · Client Company</p>
                      <p className="text-[11px] text-slate-400">23 Sep 2026 · Software License & Support</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-emerald-400">₹ X,XX,XXX.XX</p>
                      <span className="inline-block rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">PAID</span>
                    </div>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-800/30">
                    <div>
                      <p className="font-semibold text-slate-200">QT-2026-0008 · Partner Corp</p>
                      <p className="text-[11px] text-slate-400">22 Sep 2026 · Custom ERP Module Development</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-amber-400">₹ 75,900.00</p>
                      <span className="inline-block rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">SENT</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Section */}
      <section id="features" className="py-20 bg-muted/40 border-y border-border/50">
        <div className="mx-auto max-w-7xl px-4 lg:px-8 space-y-16">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything your business needs</h2>
            <p className="text-muted-foreground">Built specifically for Indian businesses, freelancers, and growing teams.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="border-border/60 shadow-sm hover:border-emerald-500/40 transition-all">
              <CardContent className="p-6 space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                  <WifiOff className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold">100% Offline-First</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Never lose work to spotty internet. All data is saved instantly to IndexedDB in your browser and synced seamlessly when online.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm hover:border-emerald-500/40 transition-all">
              <CardContent className="p-6 space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600">
                  <Receipt className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold">GST Compliant Billing</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Automatic CGST, SGST, IGST calculations based on Place of Supply. Supports HSN/SAC codes and custom tax profiles.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm hover:border-emerald-500/40 transition-all">
              <CardContent className="p-6 space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600">
                  <FileText className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold">Quotations to Invoices</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Generate beautiful estimates and proposals. Convert approved quotations into final invoices with a single click.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm hover:border-emerald-500/40 transition-all">
              <CardContent className="p-6 space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
                  <Cloud className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold">Cloud Sync & Backup</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Powered by Supabase PostgreSQL. Securely backup your multi-device workspace and access your data anytime.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm hover:border-emerald-500/40 transition-all">
              <CardContent className="p-6 space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600">
                  <Users className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold">Customer Management</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Store customer GSTINs, addresses, contact details, and payment histories. Auto-fill details during billing.
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm hover:border-emerald-500/40 transition-all">
              <CardContent className="p-6 space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600">
                  <Lock className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold">Bank & UPI Integration</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Add Bank IFSC, account details, and custom UPI QR VPAs to your PDF invoices for instant customer payouts.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8 space-y-16">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Get started in 3 simple steps</h2>
            <p className="text-muted-foreground">From signup to your first GST invoice in less than 2 minutes.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white font-extrabold text-xl shadow-lg shadow-emerald-600/20">
                1
              </div>
              <h3 className="text-xl font-bold">Sign Up & Setup Profile</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Create your account via Email or Google. Add your business logo, GSTIN, address, and bank credentials.
              </p>
            </div>

            <div className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 text-white font-extrabold text-xl shadow-lg shadow-teal-600/20">
                2
              </div>
              <h3 className="text-xl font-bold">Create Invoices or Quotes</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Add line items, apply GST rates, auto-calculate totals, and customize numbering formats effortlessly.
              </p>
            </div>

            <div className="flex flex-col items-center text-center space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-600 text-white font-extrabold text-xl shadow-lg shadow-cyan-600/20">
                3
              </div>
              <h3 className="text-xl font-bold">Print & Track Payments</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Export high-resolution PDF invoices, record payments, track overdues, and monitor real-time revenue analytics.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t bg-card/60 px-4 lg:px-8 py-8">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-emerald-600" />
            <span className="font-semibold text-foreground">InvoiceFlow v{APP_VERSION}</span>
            <span>· Offline-First Invoices & Quotations</span>
          </div>

          <div className="flex items-center gap-6">
            <button onClick={() => navigate('login')} className="hover:text-foreground">Sign In</button>
            <button onClick={() => navigate('signup')} className="hover:text-foreground">Sign Up</button>
          </div>
        </div>
      </footer>
    </div>
  )
}
