'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/lib/stores/app-store'
import { useNetworkOnline } from '@/lib/hooks/app-hooks'
import { runSync } from '@/lib/sync/engine'
import { cn } from '@/lib/utils'
import { CloudOff, Cloud, AlertTriangle, Loader2, UserX } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'

export function SyncPill({ compact }: { compact?: boolean }) {
  const { status, lastSyncAt, pending } = useAppStore((s) => s.sync)
  const user = useAppStore((s) => s.user)
  const ws = useAppStore((s) => s.activeWorkspace)
  const online = useNetworkOnline()
  const cloudLinked = Boolean(ws?.cloud_linked_at)

  if (!cloudLinked || !user) {
    return (
      <Badge variant="outline" className="gap-1.5 bg-card font-normal text-muted-foreground">
        <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
        {/* short label on phones keeps the header inside the viewport */}
        <span className="sm:hidden">Guest</span>
        <span className="hidden sm:inline">{compact ? 'Guest' : 'Guest workspace — local only'}</span>
      </Badge>
    )
  }

  const cfg = (() => {
    if (!online || status === 'offline') {
      return { icon: CloudOff, text: 'Offline', cls: 'text-amber-600 dark:text-amber-400', spin: false }
    }
    if (status === 'needs_auth') {
      return { icon: UserX, text: 'Re-auth needed', cls: 'text-red-600 dark:text-red-400', spin: false }
    }
    if (status === 'error') {
      return { icon: AlertTriangle, text: 'Sync error', cls: 'text-red-600 dark:text-red-400', spin: false }
    }
    if (status === 'syncing') {
      return { icon: Loader2, text: 'Syncing…', cls: 'text-emerald-600 dark:text-emerald-400', spin: true }
    }
    if (pending > 0) {
      return { icon: Cloud, text: `Pending ${pending}`, cls: 'text-amber-600 dark:text-amber-400', spin: false }
    }
    return { icon: Cloud, text: 'Synced', cls: 'text-emerald-600 dark:text-emerald-400', spin: false }
  })()
  const Icon = cfg.icon

  const tooltip = (
    <div className="space-y-0.5 text-xs">
      <p className="font-medium">{cfg.text}</p>
      {lastSyncAt ? <p className="text-muted-foreground">Last sync: {formatDistanceToNowStrict(new Date(lastSyncAt), { addSuffix: true })}</p> : <p className="text-muted-foreground">Not synced yet</p>}
      {pending > 0 && <p className="text-muted-foreground">{pending} operation(s) queued</p>}
    </div>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn('h-7 gap-1.5 bg-card px-2.5 font-normal', cfg.cls)}
            onClick={() => void runSync()}
            aria-label={`Sync status: ${cfg.text}. Click to sync now.`}
          >
            <Icon className={cn('h-3.5 w-3.5', cfg.spin && 'animate-spin')} aria-hidden="true" />
            <span>{cfg.text}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
