'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { type LucideIcon } from 'lucide-react'

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
  loading,
  onClick,
}: {
  label: string
  value: string
  sub?: string
  icon: LucideIcon
  tone?: 'default' | 'positive' | 'warning' | 'danger' | 'info'
  loading?: boolean
  onClick?: () => void
}) {
  const toneClasses: Record<string, string> = {
    default: 'bg-muted text-foreground',
    positive: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
    danger: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
    info: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  }
  return (
    <Card
      className={cn(
        'py-4 transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring'
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      aria-label={onClick ? `${label}: ${value}` : undefined}
    >
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-1.5 h-7 w-24" />
          ) : (
            <p className="mt-0.5 truncate text-xl font-semibold tracking-tight">{value}</p>
          )}
          {sub && !loading ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', toneClasses[tone])}>
          <Icon className="h-4.5 w-4.5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  )
}
