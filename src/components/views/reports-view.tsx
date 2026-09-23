'use client'

// InvoiceFlow — Reports view (docs/21-REPORTS.md).
// Five local-only reports (Sales, GST Summary, Outstanding, Customers, Products)
// computed entirely client-side from Dexie/IndexedDB via useLiveQuery — no server calls.
// Money is integer paise (CANON §4); dates are 'YYYY-MM-DD' strings (CANON §3).

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import { BarChart3, Download } from 'lucide-react'

import { EmptyState } from '@/components/app/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getDb } from '@/lib/db/db'
import type { CustomerRow, InvoiceItemRow, InvoiceRow, PaymentRow } from '@/lib/db/row-types'
import { formatMoney, formatMoneyCompact, formatQty } from '@/lib/domain/money'
import { addDaysStr, formatDateDisplay, fyEnd, fyStart, monthKey, monthLabel, todayStr } from '@/lib/date'
import { downloadCsv, toCsv } from '@/lib/csv'
import { useActiveWorkspace, useCompany } from '@/lib/hooks/app-hooks'
import { navigate } from '@/lib/router'
import { useAppStore } from '@/lib/stores/app-store'

// ---------- domain constants (docs/21 populations) ----------

/** Invoices that contribute to revenue/GST figures (DRAFT and CANCELLED never do). */
const REVENUE_STATUSES: ReadonlySet<string> = new Set(['FINALIZED', 'PARTIALLY_PAID', 'PAID'])
/** Invoices that can still carry a receivable balance. */
const OPEN_STATUSES: ReadonlySet<string> = new Set(['FINALIZED', 'PARTIALLY_PAID'])

type AgingBucket = '0-30' | '31-60' | '61-90' | '90+'

const BUCKETS: ReadonlyArray<{ id: AgingBucket; label: string }> = [
  { id: '0-30', label: '0–30 days' },
  { id: '31-60', label: '31–60 days' },
  { id: '61-90', label: '61–90 days' },
  { id: '90+', label: '90+ days' },
]

const BUCKET_BADGE_CLASS: Record<AgingBucket, string> = {
  '0-30':
    'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  '31-60':
    'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  '61-90':
    'border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300',
  '90+':
    'border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
}

function bucketOf(daysPast: number): AgingBucket {
  if (daysPast <= 30) return '0-30'
  if (daysPast <= 60) return '31-60'
  if (daysPast <= 90) return '61-90'
  return '90+'
}

// ---------- pure helpers ----------

function warnDev(message: string): void {
  if (process.env.NODE_ENV !== 'production') console.warn(`[reports] ${message}`)
}

/** Whole days `anchor` is past `today` (0 when not yet due or unparseable). */
function daysPastDue(today: string, anchor: string): number {
  const [ty, tm, td] = today.split('-').map(Number)
  const [ay, am, ad] = anchor.split('-').map(Number)
  if (!ty || !tm || !td || !ay || !am || !ad) return 0
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(ay, am - 1, ad)
  return Math.max(0, Math.floor(diff / 86_400_000))
}

/** Every 'YYYY-MM' key between from and to (inclusive), capped to keep renders sane. */
function monthKeysBetween(from: string, to: string, cap = 240): string[] {
  if (from === '' || to === '' || from > to) return []
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  if (!fy || !fm || !ty || !tm) return []
  const keys: string[] = []
  let y = fy
  let m = fm
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`)
    if (keys.length >= cap) break
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return keys
}

/** CSV money: decimal rupees, fixed 2, no separators (docs/21 CSV spec). */
function rupeesForCsv(paise: number): string {
  return ((paise || 0) / 100).toFixed(2)
}

/** CSV quantity: decimal units, up to 3 decimals (docs/21 CSV spec). */
function qtyForCsv(milli: number): string {
  return String(Number(((milli || 0) / 1000).toFixed(3)))
}

function csvFileName(report: string, from: string, to: string): string {
  return `invoiceflow-${report}-${from || 'all'}_to_${to || 'all'}.csv`
}

// ---------- aggregation row types ----------

interface ReportData {
  invoices: InvoiceRow[]
  items: InvoiceItemRow[]
  payments: PaymentRow[]
  customers: CustomerRow[]
}

const EMPTY_DATA: ReportData = { invoices: [], items: [], payments: [], customers: [] }

interface SalesMonthRow {
  key: string
  label: string
  invoiced: number
  collected: number
}

interface GstMonthRow {
  key: string
  documents: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  totalTax: number
}

interface OutstandingRow {
  id: string
  number: string
  customer: string
  invoiceDate: string
  dueDate: string
  ageDays: number
  bucket: AgingBucket
  grand: number
  paid: number
  balance: number
}

interface CustomerRevenueRow {
  name: string
  code: string
  invoiced: number
  collected: number
  count: number
  outstanding: number
}

interface ProductRevenueRow {
  name: string
  hsn: string
  qtyMilli: number
  taxable: number
  tax: number
  revenue: number
}

// ---------- loading / empty building blocks ----------

function ReportsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 px-4">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-44" />
          <Skeleton className="ml-auto hidden h-4 w-48 sm:block" />
        </CardContent>
      </Card>
      <Skeleton className="h-9 w-full max-w-md" />
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    </div>
  )
}

function ReportEmpty({
  title,
  description,
  onWiden,
}: {
  title: string
  description: string
  onWiden?: () => void
}) {
  return (
    <EmptyState
      icon={BarChart3}
      title={title}
      description={description}
      action={onWiden ? { label: 'Widen the date range', onClick: onWiden } : undefined}
    />
  )
}

// ---------- the view ----------

export function ReportsView() {
  const ws = useActiveWorkspace()
  const company = useCompany()
  const booted = useAppStore((s) => s.booted)

  // Date range defaults to the current fiscal year (docs/21 BR-3), computed lazily
  // so the same value is produced during prerender and hydration.
  const [from, setFrom] = useState(() => fyStart(todayStr()))
  const [to, setTo] = useState(() => fyEnd(todayStr()))

  const hasRange = from !== '' && to !== ''
  const swapped = hasRange && from > to
  const lo = hasRange ? (from <= to ? from : to) : ''
  const hi = hasRange ? (from <= to ? to : from) : ''
  const today = useMemo(() => todayStr(), [])

  const wsId = ws?.id ?? null
  const data = useLiveQuery<ReportData>(async () => {
    if (!wsId || typeof window === 'undefined') return EMPTY_DATA
    const db = getDb()
    const [invoices, items, payments, customers] = await Promise.all([
      db.invoices.where('workspace_id').equals(wsId).toArray(),
      db.invoice_items.where('workspace_id').equals(wsId).toArray(),
      db.payments.where('workspace_id').equals(wsId).toArray(),
      db.customers.where('workspace_id').equals(wsId).toArray(),
    ])
    return { invoices, items, payments, customers }
  }, [wsId, from, to])

  const widenRange = () => {
    const base = lo || todayStr()
    setFrom(addDaysStr(fyStart(base), -366))
    setTo(addDaysStr(fyEnd(hi || base), 366))
  }

  // ----- populations (docs/21) -----

  const baseInvoices = useMemo(() => {
    if (!data || lo === '' || hi === '') return []
    return data.invoices.filter(
      (inv) =>
        !inv.deleted_at &&
        REVENUE_STATUSES.has(inv.status) &&
        inv.invoice_date >= lo &&
        inv.invoice_date <= hi,
    )
  }, [data, lo, hi])

  const openInvoices = useMemo(
    () =>
      baseInvoices.filter(
        (inv) => OPEN_STATUSES.has(inv.status) && inv.grand_total_paise - inv.paid_total_paise > 0,
      ),
    [baseInvoices],
  )

  // ----- 1. Sales: monthly invoiced vs collected -----

  const salesRows = useMemo<SalesMonthRow[]>(() => {
    const keys = monthKeysBetween(lo, hi)
    if (keys.length === 0) return []
    const byKey = new Map<string, SalesMonthRow>()
    for (const k of keys) byKey.set(k, { key: k, label: monthLabel(k), invoiced: 0, collected: 0 })
    for (const inv of baseInvoices) {
      const row = byKey.get(monthKey(inv.invoice_date))
      if (row) row.invoiced += inv.grand_total_paise
    }
    if (data) {
      for (const p of data.payments) {
        if (p.deleted_at) continue
        if (p.paid_at < lo || p.paid_at > hi) continue
        const row = byKey.get(monthKey(p.paid_at))
        if (row) row.collected += p.amount_paise
      }
    }
    const rows: SalesMonthRow[] = []
    for (const k of keys) {
      const row = byKey.get(k)
      if (row) rows.push(row)
    }
    return rows
  }, [data, baseInvoices, lo, hi])

  // ----- 2. GST Summary: monthly tax matrix from snapshot columns -----

  const gstRows = useMemo<GstMonthRow[]>(() => {
    if (baseInvoices.length === 0) return []
    const map = new Map<string, GstMonthRow>()
    for (const inv of baseInvoices) {
      const k = monthKey(inv.invoice_date)
      const row = map.get(k) ?? {
        key: k,
        documents: 0,
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totalTax: 0,
      }
      row.documents += 1
      row.taxable += inv.taxable_total_paise
      row.cgst += inv.cgst_paise
      row.sgst += inv.sgst_paise
      row.igst += inv.igst_paise
      row.totalTax += inv.cgst_paise + inv.sgst_paise + inv.igst_paise
      map.set(k, row)
    }
    return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }, [baseInvoices])

  // ----- 3. Outstanding: receivables with aging buckets -----

  const outstandingRows = useMemo<OutstandingRow[]>(() => {
    const rows: OutstandingRow[] = openInvoices.map((inv) => {
      const anchor = inv.due_date || inv.invoice_date
      const age = daysPastDue(today, anchor)
      return {
        id: inv.id,
        number: inv.number,
        customer: inv.customer_name_snapshot?.trim() || 'Unknown',
        invoiceDate: inv.invoice_date,
        dueDate: anchor,
        ageDays: age,
        bucket: bucketOf(age),
        grand: inv.grand_total_paise,
        paid: inv.paid_total_paise,
        balance: inv.grand_total_paise - inv.paid_total_paise,
      }
    })
    rows.sort((a, b) =>
      a.dueDate === b.dueDate ? (a.number < b.number ? -1 : 1) : a.dueDate < b.dueDate ? -1 : 1,
    )
    return rows
  }, [openInvoices, today])

  // ----- 4. Customers: invoiced / collected / outstanding per customer -----

  const customerRows = useMemo<CustomerRevenueRow[]>(() => {
    if (!data) return []
    const map = new Map<string, CustomerRevenueRow>()
    const codeById = new Map<string, string>()
    for (const c of data.customers) {
      if (!c.deleted_at && c.code) codeById.set(c.id, c.code)
    }
    const invoiceById = new Map<string, InvoiceRow>()
    for (const inv of data.invoices) invoiceById.set(inv.id, inv)

    for (const inv of baseInvoices) {
      const name = inv.customer_name_snapshot?.trim() || 'Unknown'
      const row = map.get(name) ?? {
        name,
        code: codeById.get(inv.customer_id) ?? '',
        invoiced: 0,
        collected: 0,
        count: 0,
        outstanding: 0,
      }
      row.invoiced += inv.grand_total_paise
      row.count += 1
      map.set(name, row)
    }
    for (const inv of openInvoices) {
      const name = inv.customer_name_snapshot?.trim() || 'Unknown'
      const row = map.get(name)
      if (row) row.outstanding += inv.grand_total_paise - inv.paid_total_paise
    }
    for (const p of data.payments) {
      if (p.deleted_at) continue
      if (p.paid_at < lo || p.paid_at > hi) continue
      const parent = invoiceById.get(p.invoice_id)
      if (!parent) {
        warnDev(`payment ${p.id} references a missing invoice; skipped in Customers report`)
        continue
      }
      if (!REVENUE_STATUSES.has(parent.status)) continue
      const name = parent.customer_name_snapshot?.trim() || 'Unknown'
      const row = map.get(name)
      if (row) {
        row.collected += p.amount_paise
      } else {
        map.set(name, {
          name,
          code: codeById.get(parent.customer_id) ?? '',
          invoiced: 0,
          collected: p.amount_paise,
          count: 0,
          outstanding: 0,
        })
      }
    }
    return [...map.values()].sort((a, b) => b.invoiced - a.invoiced)
  }, [data, baseInvoices, openInvoices, lo, hi])

  // ----- 5. Products: quantity + revenue per line description -----

  const productRows = useMemo<ProductRevenueRow[]>(() => {
    if (!data || baseInvoices.length === 0) return []
    const invoiceAllById = new Map<string, InvoiceRow>()
    for (const inv of data.invoices) invoiceAllById.set(inv.id, inv)
    const baseIds = new Set(baseInvoices.map((inv) => inv.id))
    const map = new Map<string, ProductRevenueRow>()
    for (const item of data.items) {
      if (!baseIds.has(item.invoice_id)) {
        if (!invoiceAllById.has(item.invoice_id)) {
          warnDev(`line item ${item.id} references a missing invoice; skipped in Products report`)
        }
        continue
      }
      const name = item.description?.trim() || 'Untitled line'
      const row = map.get(name) ?? {
        name,
        hsn: item.hsn_sac ?? '',
        qtyMilli: 0,
        taxable: 0,
        tax: 0,
        revenue: 0,
      }
      row.qtyMilli += item.qty_milli
      row.taxable += item.taxable_paise
      row.tax += item.tax_paise
      row.revenue += item.total_paise
      if (!row.hsn && item.hsn_sac) row.hsn = item.hsn_sac
      map.set(name, row)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }, [data, baseInvoices])

  // ----- totals (plain reduces; datasets are small) -----

  const salesInvoicedTotal = salesRows.reduce((acc, r) => acc + r.invoiced, 0)
  const salesCollectedTotal = salesRows.reduce((acc, r) => acc + r.collected, 0)

  const gstTotals = gstRows.reduce(
    (acc, r) => ({
      documents: acc.documents + r.documents,
      taxable: acc.taxable + r.taxable,
      cgst: acc.cgst + r.cgst,
      sgst: acc.sgst + r.sgst,
      igst: acc.igst + r.igst,
      totalTax: acc.totalTax + r.totalTax,
    }),
    { documents: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 },
  )

  const bucketTotals: Record<AgingBucket, { count: number; balance: number }> = {
    '0-30': { count: 0, balance: 0 },
    '31-60': { count: 0, balance: 0 },
    '61-90': { count: 0, balance: 0 },
    '90+': { count: 0, balance: 0 },
  }
  let outstandingGrand = 0
  let outstandingPaid = 0
  let outstandingBalance = 0
  for (const r of outstandingRows) {
    bucketTotals[r.bucket].count += 1
    bucketTotals[r.bucket].balance += r.balance
    outstandingGrand += r.grand
    outstandingPaid += r.paid
    outstandingBalance += r.balance
  }

  const customerTotals = customerRows.reduce(
    (acc, r) => ({
      invoiced: acc.invoiced + r.invoiced,
      collected: acc.collected + r.collected,
      count: acc.count + r.count,
      outstanding: acc.outstanding + r.outstanding,
    }),
    { invoiced: 0, collected: 0, count: 0, outstanding: 0 },
  )

  const productTotals = productRows.reduce(
    (acc, r) => ({
      qtyMilli: acc.qtyMilli + r.qtyMilli,
      taxable: acc.taxable + r.taxable,
      tax: acc.tax + r.tax,
      revenue: acc.revenue + r.revenue,
    }),
    { qtyMilli: 0, taxable: 0, tax: 0, revenue: 0 },
  )

  // ----- CSV exports (docs/21 CSV spec; WYSIWYG with the tables) -----

  const exportSalesCsv = () => {
    const csv = toCsv(
      ['Month', 'Invoiced', 'Collected'],
      [
        ...salesRows.map((r) => [r.key, rupeesForCsv(r.invoiced), rupeesForCsv(r.collected)]),
        ['TOTAL', rupeesForCsv(salesInvoicedTotal), rupeesForCsv(salesCollectedTotal)],
      ],
    )
    downloadCsv(csvFileName('sales', lo, hi), csv)
    toast.success('Sales report exported')
  }

  const exportGstCsv = () => {
    const csv = toCsv(
      ['Month', 'Documents', 'Taxable Value', 'CGST', 'SGST/UTGST', 'IGST', 'Total GST'],
      [
        ...gstRows.map((r) => [
          r.key,
          String(r.documents),
          rupeesForCsv(r.taxable),
          rupeesForCsv(r.cgst),
          rupeesForCsv(r.sgst),
          rupeesForCsv(r.igst),
          rupeesForCsv(r.totalTax),
        ]),
        [
          'TOTAL',
          String(gstTotals.documents),
          rupeesForCsv(gstTotals.taxable),
          rupeesForCsv(gstTotals.cgst),
          rupeesForCsv(gstTotals.sgst),
          rupeesForCsv(gstTotals.igst),
          rupeesForCsv(gstTotals.totalTax),
        ],
      ],
    )
    downloadCsv(csvFileName('gst-summary', lo, hi), csv)
    toast.success('GST Summary exported')
  }

  const exportOutstandingCsv = () => {
    const csv = toCsv(
      [
        'Invoice Number',
        'Customer',
        'Invoice Date',
        'Due Date',
        'Age (Days)',
        'Bucket',
        'Grand Total',
        'Paid',
        'Balance',
      ],
      [
        ...outstandingRows.map((r) => [
          r.number,
          r.customer,
          r.invoiceDate,
          r.dueDate,
          String(r.ageDays),
          r.bucket,
          rupeesForCsv(r.grand),
          rupeesForCsv(r.paid),
          rupeesForCsv(r.balance),
        ]),
        [
          'TOTAL',
          '',
          '',
          '',
          '',
          '',
          rupeesForCsv(outstandingGrand),
          rupeesForCsv(outstandingPaid),
          rupeesForCsv(outstandingBalance),
        ],
      ],
    )
    downloadCsv(csvFileName('outstanding', lo, hi), csv)
    toast.success('Outstanding report exported')
  }

  const exportCustomersCsv = () => {
    const csv = toCsv(
      ['Customer', 'Code', 'Invoiced', 'Collected (Revenue)', 'Invoices', 'Outstanding'],
      [
        ...customerRows.map((r) => [
          r.name,
          r.code,
          rupeesForCsv(r.invoiced),
          rupeesForCsv(r.collected),
          String(r.count),
          rupeesForCsv(r.outstanding),
        ]),
        [
          'TOTAL',
          '',
          rupeesForCsv(customerTotals.invoiced),
          rupeesForCsv(customerTotals.collected),
          String(customerTotals.count),
          rupeesForCsv(customerTotals.outstanding),
        ],
      ],
    )
    downloadCsv(csvFileName('customers', lo, hi), csv)
    toast.success('Customers report exported')
  }

  const exportProductsCsv = () => {
    const csv = toCsv(
      ['Product', 'SKU / HSN-SAC', 'Quantity', 'Taxable', 'Tax', 'Revenue'],
      [
        ...productRows.map((r) => [
          r.name,
          r.hsn,
          qtyForCsv(r.qtyMilli),
          rupeesForCsv(r.taxable),
          rupeesForCsv(r.tax),
          rupeesForCsv(r.revenue),
        ]),
        [
          'TOTAL',
          '',
          qtyForCsv(productTotals.qtyMilli),
          rupeesForCsv(productTotals.taxable),
          rupeesForCsv(productTotals.tax),
          rupeesForCsv(productTotals.revenue),
        ],
      ],
    )
    downloadCsv(csvFileName('products', lo, hi), csv)
    toast.success('Products report exported')
  }

  // ----- gating: boot / workspace / company (docs/21 error-handling) -----

  if (!booted || (ws && company === undefined)) return <ReportsSkeleton />

  if (!ws || company === null) {
    return (
      <EmptyState
        icon={BarChart3}
        title={ws ? 'No company profile yet' : 'No workspace selected'}
        description={
          ws
            ? 'Reports are computed from your local company data. Set up your details under My Company and this page will light up.'
            : "Reports are computed from the active workspace's local data. Create or switch to a workspace to see your numbers."
        }
        action={{ label: ws ? 'Set up My Company' : 'Go to Dashboard', onClick: () => navigate(ws ? 'company' : 'dashboard') }}
      />
    )
  }

  const rangeMissing = lo === '' || hi === ''

  const exportButton = (onClick: () => void, label: string) => (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={onClick} disabled={!data}>
      <Download className="h-3.5 w-3.5" aria-hidden="true" />
      Export CSV
      <span className="sr-only">{label}</span>
    </Button>
  )

  return (
    <div className="space-y-4">
      {/* Period controls */}
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Period</CardTitle>
          <CardDescription>
            {company ? `Computed locally for ${company.name} — nothing leaves this device.` : 'Computed locally — nothing leaves this device.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => e.preventDefault()}>
            <div className="grid w-full gap-1.5 sm:w-44">
              <Label htmlFor="reports-from">From</Label>
              <Input
                id="reports-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="Report period start date"
              />
            </div>
            <div className="grid w-full gap-1.5 sm:w-44">
              <Label htmlFor="reports-to">To</Label>
              <Input
                id="reports-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="Report period end date"
              />
            </div>
            <div className="text-xs text-muted-foreground sm:ml-auto sm:text-right">
              {swapped ? (
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  From is after To — showing the swapped range.
                </p>
              ) : hasRange ? (
                <p>
                  <span className="font-medium text-foreground">
                    {formatDateDisplay(lo)} – {formatDateDisplay(hi)}
                  </span>
                </p>
              ) : (
                <p>Pick both dates to compute the reports.</p>
              )}
              <p className="mt-0.5 text-[11px]">Defaults to the current fiscal year (Apr–Mar).</p>
            </div>
          </form>
        </CardContent>
      </Card>

      <Tabs defaultValue="sales">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto scrollbar-thin sm:w-auto">
          <TabsTrigger value="sales" className="shrink-0 px-3">
            Sales
          </TabsTrigger>
          <TabsTrigger value="gst" className="shrink-0 px-3">
            GST Summary
          </TabsTrigger>
          <TabsTrigger value="outstanding" className="shrink-0 px-3">
            Outstanding
          </TabsTrigger>
          <TabsTrigger value="customers" className="shrink-0 px-3">
            Customers
          </TabsTrigger>
          <TabsTrigger value="products" className="shrink-0 px-3">
            Products
          </TabsTrigger>
        </TabsList>

        {/* ---------- Sales ---------- */}
        <TabsContent value="sales" className="mt-4">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Monthly sales</CardTitle>
              <CardDescription>Invoiced value vs payments collected, by month.</CardDescription>
              <CardAction>{exportButton(exportSalesCsv, 'for the Sales report')}</CardAction>
            </CardHeader>
            <CardContent className="space-y-4 px-4">
              {!data ? (
                <div className="space-y-3">
                  <Skeleton className="h-72 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : rangeMissing || salesRows.length === 0 ? (
                rangeMissing ? (
                  <ReportEmpty
                    title="Pick a date range"
                    description="Choose both a from and a to date — this report computes instantly from your local data."
                  />
                ) : (
                  <ReportEmpty
                    title="No sales in this period"
                    description="No finalized invoices or payments fall inside the selected range. Finalize an invoice, record a payment, or widen the range."
                    onWiden={widenRange}
                  />
                )
              ) : (
                <>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={salesRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="fillInvoiced" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.32} />
                            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="fillCollected" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.32} />
                            <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          minTickGap={16}
                          tick={{ fontSize: 12 }}
                          stroke="var(--muted-foreground)"
                        />
                        <YAxis
                          tickFormatter={(value: number) => formatMoneyCompact(value)}
                          tickLine={false}
                          axisLine={false}
                          width={68}
                          tick={{ fontSize: 12 }}
                          stroke="var(--muted-foreground)"
                        />
                        <Tooltip
                          cursor={{ stroke: 'var(--border)' }}
                          formatter={(value) => formatMoney(Number(value))}
                          contentStyle={{
                            borderRadius: 10,
                            border: '1px solid var(--border)',
                            backgroundColor: 'var(--popover)',
                            color: 'var(--popover-foreground)',
                            fontSize: 12,
                          }}
                          labelStyle={{ fontWeight: 600 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Area
                          type="monotone"
                          dataKey="invoiced"
                          name="Invoiced"
                          stroke="var(--chart-1)"
                          strokeWidth={2}
                          fill="url(#fillInvoiced)"
                        />
                        <Area
                          type="monotone"
                          dataKey="collected"
                          name="Collected"
                          stroke="var(--chart-2)"
                          strokeWidth={2}
                          fill="url(#fillCollected)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="max-h-96 overflow-auto rounded-lg border scrollbar-thin">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Month</TableHead>
                          <TableHead className="text-right">Invoiced</TableHead>
                          <TableHead className="text-right">Collected</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {salesRows.map((r) => (
                          <TableRow key={r.key}>
                            <TableCell className="font-medium" title={r.key}>
                              {r.label}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(r.invoiced)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(r.collected)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className="sticky bottom-0 z-10 bg-card">
                        <TableRow>
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(salesInvoicedTotal)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(salesCollectedTotal)}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- GST Summary ---------- */}
        <TabsContent value="gst" className="mt-4">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">GST summary</CardTitle>
              <CardDescription>
                Monthly liability from finalized invoices — snapshot columns recorded at finalize time.
              </CardDescription>
              <CardAction>{exportButton(exportGstCsv, 'for the GST Summary report')}</CardAction>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              {!data ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : rangeMissing || gstRows.length === 0 ? (
                rangeMissing ? (
                  <ReportEmpty
                    title="Pick a date range"
                    description="Choose both a from and a to date — this report computes instantly from your local data."
                  />
                ) : (
                  <ReportEmpty
                    title="No GST to report"
                    description="No finalized, partially paid or paid invoices fall inside the selected range. Draft and cancelled invoices never appear here."
                    onWiden={widenRange}
                  />
                )
              ) : (
                <>
                  <div className="max-h-96 overflow-auto rounded-lg border scrollbar-thin">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Month</TableHead>
                          <TableHead className="text-right">Docs</TableHead>
                          <TableHead className="text-right">Taxable value</TableHead>
                          <TableHead className="text-right">CGST</TableHead>
                          <TableHead className="text-right">SGST/UTGST</TableHead>
                          <TableHead className="text-right">IGST</TableHead>
                          <TableHead className="text-right">Total GST</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gstRows.map((r) => (
                          <TableRow key={r.key}>
                            <TableCell className="font-medium tabular-nums" title={monthLabel(r.key)}>
                              {r.key}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{r.documents}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(r.taxable)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(r.cgst)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(r.sgst)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(r.igst)}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatMoney(r.totalTax)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className="sticky bottom-0 z-10 bg-card">
                        <TableRow>
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right tabular-nums">{gstTotals.documents}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(gstTotals.taxable)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(gstTotals.cgst)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(gstTotals.sgst)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(gstTotals.igst)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(gstTotals.totalTax)}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Computed locally from InvoiceFlow records; not a statutory GST return.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Outstanding ---------- */}
        <TabsContent value="outstanding" className="mt-4">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Outstanding receivables</CardTitle>
              <CardDescription>
                Finalized and partially paid invoices with a positive balance, oldest due date first.
              </CardDescription>
              <CardAction>{exportButton(exportOutstandingCsv, 'for the Outstanding report')}</CardAction>
            </CardHeader>
            <CardContent className="space-y-4 px-4">
              {!data ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : rangeMissing || outstandingRows.length === 0 ? (
                rangeMissing ? (
                  <ReportEmpty
                    title="Pick a date range"
                    description="Choose both a from and a to date — this report computes instantly from your local data."
                  />
                ) : (
                  <ReportEmpty
                    title="Nothing outstanding — nice!"
                    description="Every invoice in this period is fully paid, or none fall inside the selected range."
                    onWiden={widenRange}
                  />
                )
              ) : (
                <>
                  {/* Aging summary strip */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {BUCKETS.map((b) => (
                      <div key={b.id} className="rounded-lg border p-3">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {b.label}
                        </p>
                        <p className="mt-1 text-sm font-semibold tabular-nums">
                          {formatMoney(bucketTotals[b.id].balance)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {bucketTotals[b.id].count} invoice{bucketTotals[b.id].count === 1 ? '' : 's'}
                        </p>
                      </div>
                    ))}
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Total balance
                      </p>
                      <p className="mt-1 text-sm font-semibold tabular-nums">{formatMoney(outstandingBalance)}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        of {formatMoney(outstandingGrand)} invoiced
                      </p>
                    </div>
                  </div>
                  <div className="max-h-96 overflow-auto rounded-lg border scrollbar-thin">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Due date</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                          <TableHead className="text-right">Aging</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {outstandingRows.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.number}</TableCell>
                            <TableCell className="max-w-40 truncate">{r.customer}</TableCell>
                            <TableCell className="tabular-nums">{formatDateDisplay(r.dueDate)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(r.balance)}</TableCell>
                            <TableCell className="text-right">
                              <Badge
                                variant="outline"
                                className={BUCKET_BADGE_CLASS[r.bucket]}
                                title={
                                  r.ageDays === 0
                                    ? 'Not yet due'
                                    : `${r.ageDays} day${r.ageDays === 1 ? '' : 's'} past due`
                                }
                              >
                                {r.bucket}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter className="sticky bottom-0 z-10 bg-card">
                        <TableRow>
                          <TableCell>Total</TableCell>
                          <TableCell>{outstandingRows.length} invoices</TableCell>
                          <TableCell />
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(outstandingBalance)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Customers ---------- */}
        <TabsContent value="customers" className="mt-4">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Customers by revenue</CardTitle>
              <CardDescription>Invoiced value, collections and open balance per customer.</CardDescription>
              <CardAction>{exportButton(exportCustomersCsv, 'for the Customers report')}</CardAction>
            </CardHeader>
            <CardContent className="px-4">
              {!data ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : rangeMissing || customerRows.length === 0 ? (
                rangeMissing ? (
                  <ReportEmpty
                    title="Pick a date range"
                    description="Choose both a from and a to date — this report computes instantly from your local data."
                  />
                ) : (
                  <ReportEmpty
                    title="No customer activity in this period"
                    description="No invoices or payments fall inside the selected range. Widen the range or start invoicing."
                    onWiden={widenRange}
                  />
                )
              ) : (
                <div className="max-h-96 overflow-auto rounded-lg border scrollbar-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Invoiced</TableHead>
                        <TableHead className="text-right">Collected</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerRows.map((r) => {
                        const maxInvoiced = customerRows[0]?.invoiced ?? 0
                        const pct = maxInvoiced > 0 ? Math.max(3, Math.round((r.invoiced / maxInvoiced) * 100)) : 0
                        return (
                          <TableRow key={r.name}>
                            <TableCell className="max-w-52 truncate font-medium">{r.name}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted md:block" aria-hidden="true">
                                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="tabular-nums">{formatMoney(r.invoiced)}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(r.collected)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(r.outstanding)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                    <TableFooter className="sticky bottom-0 z-10 bg-card">
                      <TableRow>
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right tabular-nums">{customerTotals.count}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(customerTotals.invoiced)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(customerTotals.collected)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(customerTotals.outstanding)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Products ---------- */}
        <TabsContent value="products" className="mt-4">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Products by quantity &amp; revenue</CardTitle>
              <CardDescription>Line items across invoiced documents in the period.</CardDescription>
              <CardAction>{exportButton(exportProductsCsv, 'for the Products report')}</CardAction>
            </CardHeader>
            <CardContent className="px-4">
              {!data ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : rangeMissing || productRows.length === 0 ? (
                rangeMissing ? (
                  <ReportEmpty
                    title="Pick a date range"
                    description="Choose both a from and a to date — this report computes instantly from your local data."
                  />
                ) : (
                  <ReportEmpty
                    title="No product lines in this period"
                    description="No line items were invoiced inside the selected range. Widen the range or add items to your invoices."
                    onWiden={widenRange}
                  />
                )
              ) : (
                <div className="max-h-96 overflow-auto rounded-lg border scrollbar-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>HSN/SAC</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productRows.map((r) => (
                        <TableRow key={r.name}>
                          <TableCell className="max-w-52 truncate font-medium">{r.name}</TableCell>
                          <TableCell className="text-muted-foreground">{r.hsn || '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatQty(r.qtyMilli)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(r.taxable)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(r.tax)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatMoney(r.revenue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter className="sticky bottom-0 z-10 bg-card">
                      <TableRow>
                        <TableCell>Total</TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums">
                          {formatQty(productTotals.qtyMilli)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(productTotals.taxable)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(productTotals.tax)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(productTotals.revenue)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default ReportsView
