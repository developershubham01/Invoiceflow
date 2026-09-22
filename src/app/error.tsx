'use client'

// App Router route-level error boundary. Covers crashes outside the app shell
// (onboarding, sign-in) and any error that escapes the view-level boundary.
// Keeps recovery one click away instead of blanking the page.

import { useEffect } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[InvoiceFlow] Uncaught route error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10">
        <AlertTriangle className="h-5.5 w-5.5 text-destructive" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Something went wrong</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          An unexpected error occurred. Local data is unaffected — retry, or reload the app.
        </p>
        {error.digest ? <p className="font-mono text-xs text-muted-foreground/70">Ref: {error.digest}</p> : null}
      </div>
      <Button size="sm" className="gap-1.5" onClick={reset}>
        <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
      </Button>
    </div>
  )
}
