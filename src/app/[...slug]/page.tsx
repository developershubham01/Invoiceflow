'use client'

import { AppRoot } from '@/components/app/app-root'

/**
 * InvoiceFlow — Catch-all route for clean path URLs (/dashboard, /invoices, /settings, /login).
 * Serves AppRoot for all application subpaths without 404 errors.
 */
export default function CatchAllPage() {
  return <AppRoot />
}
