'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const TONES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  SENT: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900',
  REJECTED: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400 border-red-200 dark:border-red-900',
  EXPIRED: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400 border-orange-200 dark:border-orange-900',
  CONVERTED: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400 border-teal-200 dark:border-teal-900',
  FINALIZED: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400 border-teal-200 dark:border-teal-900',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900',
  PAID: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900',
  CANCELLED: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400 border-red-200 dark:border-red-900',
  OVERDUE: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400 border-red-200 dark:border-red-900',
}

export function StatusBadge({ status, className, overdue }: { status: string; className?: string; overdue?: boolean }) {
  const key = overdue ? 'OVERDUE' : status
  return (
    <Badge variant="outline" className={cn('font-medium', TONES[key] ?? TONES.DRAFT, className)}>
      {key.replace(/_/g, ' ')}
    </Badge>
  )
}
