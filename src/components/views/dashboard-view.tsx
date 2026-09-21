'use client'

import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getDb } from '@/lib/db/db'
import { useActiveWorkspace, useCompany, useNetworkOnline, useUser } from '@/lib/hooks/app-hooks'
import { StatCard } from '@/components/app/stat-card'
import { StatusBadge } from '@/components/app/status-badge'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { navigate } from '@/lib/router'
import { formatMoney, formatMoneyCompact } from '@/lib/domain/money'
import { formatDateDisplay, monthKey, monthLabel, todayStr } from '@/lib/date'
import { runSync } from '@/lib/sync/engine'
import { chargesFromJson } from '@/lib/db/row-types'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'
import {
  ArrowRight, Banknote, CheckCircle2, CircleDollarSign, Clock3, FileText,
  HandCoins, Plus, Receipt, TriangleAlert, UserRound,
} from 'lucide-react'

export function DashboardView() {
  const ws = useActiveWorkspace()
  const company = useCompany()
  const user = useUser()
  const online = useNetworkOnline()
  const today = todayStr()

  const data = useLiveQuery(async () => {
    if (!ws) return null
    const [invoices, quotations, payments, customers, audit] = await Promise.all([
      getDb().invoices.where('workspace_id').equals(ws.id).filter((i) => !i.deleted_at).toArray(),
      getDb().quotations.where('workspace_id').equals(ws.id).filter((q) => !q.deleted_at).toArray(),
      getDb().payments.where('workspace_id').equals(ws.id).filter((p) => !p.deleted_at).toArray(),
      getDb().customers.where('workspace_id').equals(ws.id).filter((c) => !c.deleted_at).count(),
      getDb().audit_logs.where('workspace_id').equals(ws.id).toArray(),
    ])
    return { invoices, quotations, payments, customers, audit: audit.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8) }
  }, [ws?.id])

  const kpis = useMemo(() => {
    if (!data) return null
    const live = data.invoices.filter((i) => i.status !== 'CANCELLED')
    const drafts = live.filter((i) => i.status === 'DRAFT')
    const paid = live.filter((i) => i.status === 'PAID')
    const unpaid = live.filter((i) => i.status === 'FINALIZED' || i.status === 'PARTIALLY_PAID')
    const overdue = unpaid.filter((i) => i.due_date && i.due_date < today)
    const invoiced = live.filter((i) => i.status !== 'DRAFT').reduce((s, i) => s + i.grand_total_paise, 0)
    const collected = data.payments.reduce((s, p) => s + p.amount_paise, 0)
    const outstanding = unpaid.reduce((s, i) => s + (i.grand_total_paise - i.paid_total_paise), 0)
    const acceptedQuotations = data.quotations.filter((q) => q.status === 'ACCEPTED' || q.status === 'CONVERTED').length
    return {
      total: live.length, drafts: drafts.length, paid: paid.length, unpaid: unpaid.length,
      overdue: overdue.length, invoiced, collected, outstanding,
      quotations: data.quotations.length, acceptedQuotations,
    }
  }, [data, today])

  const chart = useMemo(() => {
    if (!data) return []
    const months: string[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const map = new Map(months.map((m) => [m, { month: m, invoiced: 0, collected: 0 }]))
    for (const inv of data.invoices) {
      if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') continue
      const k = monthKey(inv.invoice_date)
      const row = map.get(k)
      if (row) row.invoiced += inv.grand_total_paise
    }
    for (const p of data.payments) {
      const row = map.get(monthKey(p.paid_at))
      if (row) row.collected += p.amount_paise
    }
    return months.map((m) => {
      const row = map.get(m)!
      return { month: monthLabel(m), invoiced: row.invoiced / 100, collected: row.collected / 100 }
    })
  }, [data])

  const recent = useMemo(() => {
    if (!data) return []
    const rows: Array<{ id: string; kind: string; number: string; party: string; amount: number; date: string; status: string; overdue?: boolean; path: string }> = []
    for (const i of data.invoices.slice(0, 40)) {
      rows.push({ id: i.id, kind: 'Invoice', number: i.number, party: i.customer_name_snapshot ?? '', amount: i.grand_total_paise, date: i.invoice_date, status: i.status, overdue: i.status !== 'DRAFT' && i.status !== 'CANCELLED' && Boolean(i.due_date && i.due_date < today && i.paid_total_paise < i.grand_total_paise), path: `invoices/${i.id}` })
    }
    for (const q of data.quotations.slice(0, 40)) {
      rows.push({ id: q.id, kind: 'Quotation', number: q.number, party: q.customer_name_snapshot ?? '', amount: q.grand_total_paise, date: q.quotation_date, status: q.status, path: `quotations/${q.id}` })
    }
    return rows.sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number)).slice(0, 7)
  }, [data, today])

  if (!ws) return null

  if (data && !company) {
    return (
      <EmptyState
        icon={FileText}
        title="Set up your company first"
        description="Add your business details, GSTIN and branding to start issuing invoices and quotations."
        action={{ label: 'Set up company', onClick: () => navigate('company') }}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* quick actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => navigate('invoices/new')} className="gap-1.5">
          <Plus className="h-4 w-4" /> New invoice
        </Button>
        <Button variant="outline" onClick={() => navigate('quotations/new')} className="gap-1.5">
          <FileText className="h-4 w-4" /> New quotation
        </Button>
        <Button variant="outline" onClick={() => navigate('customers')} className="gap-1.5">
          <UserRound className="h-4 w-4" /> Add customer
        </Button>
        {!user && (
          <Button variant="ghost" className="ml-auto gap-1.5 text-muted-foreground" onClick={() => navigate('login')}>
            Connect cloud to sync <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Invoices" value={kpis ? String(kpis.total) : ''} icon={Receipt} loading={!kpis} onClick={() => navigate('invoices')} />
        <StatCard label="Drafts" value={kpis ? String(kpis.drafts) : ''} icon={FileText} tone="info" loading={!kpis} onClick={() => navigate('invoices')} />
        <StatCard label="Paid" value={kpis ? String(kpis.paid) : ''} icon={CheckCircle2} tone="positive" loading={!kpis} onClick={() => navigate('invoices')} />
        <StatCard label="Unpaid" value={kpis ? String(kpis.unpaid) : ''} icon={Clock3} tone="warning" loading={!kpis} onClick={() => navigate('invoices')} />
        <StatCard label="Overdue" value={kpis ? String(kpis.overdue) : ''} icon={TriangleAlert} tone="danger" loading={!kpis} onClick={() => navigate('invoices')} />
        <StatCard label="Quotations" value={kpis ? String(kpis.quotations) : ''} sub={kpis ? `${kpis.acceptedQuotations} accepted` : ''} icon={FileText} loading={!kpis} onClick={() => navigate('quotations')} />
        <StatCard label="Total invoiced" value={kpis ? formatMoneyCompact(kpis.invoiced) : ''} icon={CircleDollarSign} loading={!kpis} />
        <StatCard label="Outstanding" value={kpis ? formatMoneyCompact(kpis.outstanding) : ''} icon={Banknote} tone={kpis && kpis.outstanding > 0 ? 'warning' : 'default'} loading={!kpis} onClick={() => navigate('reports')} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        {/* revenue chart */}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Revenue — last 6 months</CardTitle>
            <p className="text-xs text-muted-foreground">Invoiced vs collected (₹)</p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="invGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#059669" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="colGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d97706" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#d97706" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} width={54} tickFormatter={(v: number) => formatMoneyCompact(Math.round(v * 100)).replace('₹', '')} />
                  <ChartTooltip
                    formatter={(value: number, name: string) => [formatMoney(Math.round((value as number) * 100)), name]}
                    contentStyle={{ borderRadius: 10, border: '1px solid rgba(128,128,128,.2)', background: 'var(--popover)', color: 'var(--popover-foreground)', fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke="#059669" strokeWidth={2} fill="url(#invGrad)" />
                  <Area type="monotone" dataKey="collected" name="Collected" stroke="#d97706" strokeWidth={2} fill="url(#colGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* sync + workspace cards */}
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Workspace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Workspace</span>
                <span className="font-medium">{ws.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Company</span>
                <span className="font-medium">{company?.name ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Customers</span>
                <span className="font-medium">{data ? data.customers : <Skeleton className="h-4 w-6" />}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cloud</span>
                <span className="font-medium">
                  {user ? (ws.cloud_linked_at ? 'Connected' : 'Not linked') : 'Guest mode'}
                </span>
              </div>
              {!user && (
                <Button size="sm" variant="outline" className="mt-1 w-full" onClick={() => navigate('login')}>
                  Create account & sync
                </Button>
              )}
              {user && ws.cloud_linked_at && (
                <Button size="sm" variant="outline" className="mt-1 w-full gap-1.5" onClick={() => void runSync()} disabled={!online}>
                  <HandCoins className="h-3.5 w-3.5" aria-hidden="true" /> Sync now
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data?.audit.length ? (
                data.audit.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs">
                    <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="text-muted-foreground">{a.action.toLowerCase()} · {a.entity_type}</span>
                    <span className="ml-auto text-muted-foreground/70">{formatDateDisplay(a.at.slice(0, 10))}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No activity yet — create your first invoice.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* recent transactions */}
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm">Recent transactions</CardTitle>
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate('invoices')}>
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {!recent.length ? (
            <EmptyState icon={Receipt} title="No transactions yet" description="Invoices and quotations will appear here." className="border-0 bg-transparent py-8" />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Party</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Date</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      className="cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
                      onClick={() => navigate(r.path)}
                      onKeyDown={(e) => { if (e.key === 'Enter') navigate(r.path) }}
                      aria-label={`Open ${r.number}`}
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-medium">{r.number}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{r.kind}</span>
                      </td>
                      <td className="max-w-40 truncate px-3 py-2.5 text-muted-foreground">{r.party}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 text-muted-foreground sm:table-cell">{formatDateDisplay(r.date)}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={r.status} overdue={r.overdue} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{formatMoney(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// keep theme import referenced (chart colors adapt via CSS vars in tokens)
