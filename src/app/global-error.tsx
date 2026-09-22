'use client'

// Last-resort global error boundary. Next.js requires its own <html>/<body>;
// this only renders when the root layout itself fails, so keep it minimal and
// independent of the app shell/theme provider.

import { useEffect } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[InvoiceFlow] Uncaught global error:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          background: '#faf9f7',
          color: '#1c1c1a',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden="true">
          <AlertTriangle color="#b45309" width={40} height={40} />
        </div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>InvoiceFlow could not start</h2>
        <p style={{ margin: 0, maxWidth: 380, fontSize: 14, opacity: 0.7 }}>
          A critical error prevented the app from rendering. Local data stored in this browser is untouched.
        </p>
        <button
          onClick={reset}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 8,
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid #d4d4d0',
            background: '#fff',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          <RefreshCcw width={14} height={14} /> Try again
        </button>
      </body>
    </html>
  )
}
