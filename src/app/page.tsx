'use client'

import { AppRoot } from '@/components/app/app-root'

/**
 * InvoiceFlow — single-page application root.
 * The sandbox preview serves `/` only, so all navigation is hash-based
 * (#/dashboard, #/invoices, …) mirroring the production route table (docs/32-ROUTES.md).
 */
export default function Home() {
  return <AppRoot />
}
