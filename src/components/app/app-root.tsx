'use client'

import { useEffect, useMemo } from 'react'
import { AppShell } from '@/components/app/app-shell'
import { LandingView } from '@/components/views/landing-view'
import { DashboardView } from '@/components/views/dashboard-view'
import { InvoicesView } from '@/components/views/invoices-view'
import { InvoiceDetailView } from '@/components/views/invoice-detail-view'
import { QuotationsView } from '@/components/views/quotations-view'
import { QuotationDetailView } from '@/components/views/quotation-detail-view'
import { CustomersView } from '@/components/views/customers-view'
import { ProductsView } from '@/components/views/products-view'
import { CompanyView } from '@/components/views/company-view'
import { PaymentsView } from '@/components/views/payments-view'
import { OnboardingView } from '@/components/views/onboarding-view'
import { AuthView } from '@/components/views/auth-view'
import { DocumentEditor } from '@/components/app/document-editor'
import { EmptyState } from '@/components/app/empty-state'
import { ReportsView } from '@/components/views/reports-view'
import { SettingsView } from '@/components/views/settings-view'
import { useBoot, useActiveWorkspace, useCompany } from '@/lib/hooks/app-hooks'
import { useAppStore } from '@/lib/stores/app-store'
import { useHashRoute, navigate } from '@/lib/router'
import { startSyncEngine, runSync } from '@/lib/sync/engine'
import { Button } from '@/components/ui/button'
import { AlertTriangle, FileText, RefreshCw } from 'lucide-react'

function ErrorFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The local database could not be opened. Your browser may be blocking IndexedDB (private mode or restrictive embed).
      </p>
      <Button className="mt-2 gap-1.5" onClick={() => window.location.reload()}>
        <RefreshCw className="h-4 w-4" /> Reload app
      </Button>
    </div>
  )
}

function Loader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
        <RefreshCw className="h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
      <p className="text-sm text-muted-foreground">Starting InvoiceFlow…</p>
    </div>
  )
}

function titleFor(segments: string[]): string {
  const head = segments[0] ?? 'dashboard'
  switch (head) {
    case 'dashboard': return 'Dashboard'
    case 'invoices': return segments[1] === 'new' || segments[1] === 'edit' ? 'New invoice' : segments[1] ? 'Invoice' : 'Invoices'
    case 'quotations': return segments[1] === 'new' || segments[1] === 'edit' ? 'New quotation' : segments[1] ? 'Quotation' : 'Quotations'
    case 'customers': return segments[1] ? 'Customer' : 'Customers'
    case 'products': return 'Products & Services'
    case 'company': return 'My Company'
    case 'payments': return 'Payments'
    case 'reports': return 'Reports'
    case 'settings': return 'Settings'
    case 'login': return 'Sign in'
    case 'signup': return 'Create Account'
    default: return 'InvoiceFlow'
  }
}

export function AppRoot() {
  const { booted, storageAvailable, activeWorkspace, user } = useAppStore()
  const route = useHashRoute()
  useBoot()

  // Sync engine triggers: interval + online + focus
  useEffect(() => {
    const stop = startSyncEngine()
    void runSync()
    return stop
  }, [])

  const currentSegment = route.segments[0] || 'landing'

  const isPublicRoute = currentSegment === 'landing' || currentSegment === 'login' || currentSegment === 'signup'
  const isCompanyProfileRoute = currentSegment === 'company-profile' || currentSegment === 'onboarding'

  // Route protection redirect side effects
  useEffect(() => {
    if (!booted || !storageAvailable) return

    if (!isPublicRoute) {
      if (!user) {
        // Protected route accessed without session -> redirect to login
        navigate('login')
      } else if (!activeWorkspace && !isCompanyProfileRoute) {
        // Authenticated user without company profile trying to access dashboard -> redirect to setup
        navigate('company-profile')
      }
    }
  }, [booted, storageAvailable, user, activeWorkspace, isPublicRoute, isCompanyProfileRoute, currentSegment])

  const content = useMemo(() => {
    if (!booted) return <Loader />
    if (!storageAvailable) return <ErrorFallback />

    if (currentSegment === 'landing') return <LandingView />
    if (currentSegment === 'login') return <AuthView initialMode="login" />
    if (currentSegment === 'signup') return <AuthView initialMode="register" />

    // Company profile setup route
    if (isCompanyProfileRoute) {
      if (!user) return <AuthView initialMode="login" />
      return <OnboardingView />
    }

    // Protected app routes
    if (!user) return <AuthView initialMode="login" />
    if (!activeWorkspace) return <OnboardingView />

    const [, second, third] = route.segments
    switch (currentSegment) {
      case 'invoices':
        if (second === 'new') return <DocumentEditorWrapper kind="invoice" />
        if (second === 'edit' && third) return <DocumentEditorWrapper kind="invoice" editId={third} />
        if (second) return <InvoiceDetailView id={second} />
        return <InvoicesView />
      case 'quotations':
        if (second === 'new') return <DocumentEditorWrapper kind="quotation" />
        if (second === 'edit' && third) return <DocumentEditorWrapper kind="quotation" editId={third} />
        if (second) return <QuotationDetailView id={second} />
        return <QuotationsView />
      case 'customers':
        return <CustomersView detailId={second} />
      case 'products':
        return <ProductsView />
      case 'company':
        return <CompanyView />
      case 'payments':
        return <PaymentsView />
      case 'reports':
        return <ReportsWrapper />
      case 'settings':
        return <SettingsWrapper initialTab={second} />
      case 'dashboard':
      default:
        return <DashboardView />
    }
  }, [booted, storageAvailable, currentSegment, isCompanyProfileRoute, user, activeWorkspace, route])

  if (!booted || !storageAvailable || isPublicRoute || isCompanyProfileRoute || !user || !activeWorkspace) {
    return <>{content}</>
  }

  return <AppShell title={titleFor(route.segments)}>{content}</AppShell>
}

function DocumentEditorWrapper({ kind, editId }: { kind: 'invoice' | 'quotation'; editId?: string }) {
  const ws = useActiveWorkspace()
  const company = useCompany()
  if (!ws || !company) {
    return (
      <EmptyState
        icon={FileText}
        title="Set up your company first"
        description="Company details appear on every invoice and quotation."
        action={{ label: 'Set up company', onClick: () => navigate('company') }}
      />
    )
  }
  return (
    <DocumentEditor
      kind={kind}
      editId={editId}
      onDone={(id) => navigate(kind === 'invoice' ? `invoices/${id}` : `quotations/${id}`)}
    />
  )
}

function ReportsWrapper() {
  return <ReportsView />
}

function SettingsWrapper({ initialTab }: { initialTab?: string }) {
  return (
    <SettingsView
      initialTab={initialTab === 'sync' || initialTab === 'security' || initialTab === 'data' ? initialTab : 'preferences'}
    />
  )
}
