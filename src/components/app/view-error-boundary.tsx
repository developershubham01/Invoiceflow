'use client'

// InvoiceFlow — view-level error boundary.
// Guarantees the app shell (header, sidebar, footer) stays mounted when a view
// throws during render: only the crashed view is replaced by an in-place
// recovery card. Without this, React unmounts the entire root and the user
// sees the whole UI — header included — disappear.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Home, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { navigate } from '@/lib/router'

interface ViewErrorBoundaryProps {
  children: ReactNode
  /** Changing this value (e.g. the route segment) resets the boundary so the next view renders normally. */
  resetKey?: string
}

interface ViewErrorBoundaryState {
  error: Error | null
}

export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept at error level on purpose: view crashes must be visible in the console,
    // but they must never take the shell down with them.
    console.error('[InvoiceFlow] A view crashed and was contained by the shell:', error, info.componentStack)
  }

  componentDidUpdate(prevProps: ViewErrorBoundaryProps): void {
    // Route changed while showing the fallback → try the new view automatically.
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  private readonly retry = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 rounded-xl border border-destructive/30 bg-card px-6 py-14 text-center"
        role="alert"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10">
          <AlertTriangle className="h-5.5 w-5.5 text-destructive" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">This view hit a problem</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your data is safe — it lives locally and nothing was lost. Retry the view, or head back to the dashboard.
          </p>
          <p className="mx-auto max-w-sm truncate font-mono text-xs text-muted-foreground/70" title={error.message}>
            {error.message}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={this.retry}>
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('dashboard')}>
            <Home className="h-3.5 w-3.5" aria-hidden="true" /> Go to dashboard
          </Button>
        </div>
      </div>
    )
  }
}
