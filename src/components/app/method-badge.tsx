// InvoiceFlow — Payment method chip: icon + label with a consistent emerald/amber/teal palette.

import { Banknote, CreditCard, Landmark, CircleDollarSign, Smartphone, ScrollText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PaymentMethod } from '@/lib/domain/types'

const METHOD_STYLE: Record<PaymentMethod, { Icon: LucideIcon; cls: string }> = {
  CASH: { Icon: Banknote, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' },
  BANK_TRANSFER: { Icon: Landmark, cls: 'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400' },
  UPI: { Icon: Smartphone, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400' },
  CHEQUE: { Icon: ScrollText, cls: 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400' },
  CARD: { Icon: CreditCard, cls: 'bg-accent text-accent-foreground' },
  OTHER: { Icon: CircleDollarSign, cls: 'bg-muted text-muted-foreground' },
}

export function MethodBadge({ method, className }: { method: PaymentMethod; className?: string }) {
  const { Icon, cls } = METHOD_STYLE[method] ?? METHOD_STYLE.OTHER
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', cls, className)}
      title={method.replace(/_/g, ' ')}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {method.replace(/_/g, ' ')}
    </span>
  )
}
