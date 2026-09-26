'use client'

// InvoiceFlow — Settings view (CANON §15): Preferences | Sync | Data | Security.
// Renders inside AppShell — content only. Local-first: every action here works offline
// against Dexie; cloud actions (sync, account) degrade gracefully per CANON §9/§11.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { APP_VERSION } from '@/lib/version'
import type { Table as DexieTable } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTheme } from 'next-themes'
import { formatDistanceToNowStrict } from 'date-fns'
import { toast } from 'sonner'
import {
  Activity,
  AlertTriangle,
  Banknote,
  Building2,
  CheckCircle2,
  Cloud,
  CloudOff,
  Copy,
  Database,
  Download,
  FileText,
  HardDrive,
  Languages,
  Loader2,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Package,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  XCircle,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppStore } from '@/lib/stores/app-store'
import { useActiveWorkspace, useAppSetting, useUser } from '@/lib/hooks/app-hooks'
import { getDb } from '@/lib/db/db'
import { setSetting } from '@/lib/db/repositories'
import { getDeviceId } from '@/lib/device'
import { nowIso, toYMD } from '@/lib/date'
import { navigate } from '@/lib/router'
import { runSync } from '@/lib/sync/engine'
import {
  discardFailedOp,
  resolveConflict,
  retryFailedOp,
  type ConflictChoice,
} from '@/lib/sync/conflicts'
import { apiDeleteAccount, apiLogout } from '@/lib/sync/client'
import type { SyncOpStatus, SyncOperation } from '@/lib/domain/types'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/lib/i18n'

const BACKUP_FORMAT_VERSION = 1
const OUTBOX_RENDER_LIMIT = 100

type SettingsTab = 'preferences' | 'sync' | 'data' | 'security'

export interface SettingsViewProps {
  initialTab?: SettingsTab
}

// ---------- small shared helpers ----------

function relative(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Never'
  return formatDistanceToNowStrict(d, { addSuffix: true })
}

function readVersion(obj: unknown): number | null {
  if (!obj || typeof obj !== 'object') return null
  const v = (obj as Record<string, unknown>).version
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const ENTITY_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  quotation: 'Quotation',
  customer: 'Customer',
  product: 'Product',
  company: 'Company',
  payment: 'Payment',
  workspace: 'Workspace',
}

function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity
}

// Status colors: pending=amber · in_flight=teal · done=emerald · failed=red · conflict=orange (no blue/indigo, docs/31)
const OP_STATUS_META: Record<SyncOpStatus, { label: string; badge: string }> = {
  pending: {
    label: 'Pending',
    badge: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  in_flight: {
    label: 'In flight',
    badge: 'border-transparent bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  },
  done: {
    label: 'Synced',
    badge: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  },
  failed: {
    label: 'Failed',
    badge: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  },
  conflict: {
    label: 'Conflict',
    badge: 'border-transparent bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  },
}

function StatusBadge({ status }: { status: SyncOpStatus }) {
  const meta = OP_STATUS_META[status]
  return <Badge className={cn('border-transparent', meta.badge)}>{meta.label}</Badge>
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold">{children}</h3>
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{children}</dd>
    </div>
  )
}

// ---------- Preferences tab ----------

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', description: 'Bright interface for daylight work', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Low-glare interface for late-night billing', icon: Moon },
  { value: 'system', label: 'System', description: 'Follow your device appearance setting', icon: Monitor },
] as const

// Hydration-safe "we're on the client" flag + device id (no effect, no cascading render).
const noopSubscribe = () => () => {}

function PreferencesTab() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const deviceIdShort = useSyncExternalStore(noopSubscribe, () => getDeviceId().slice(0, 8), () => '')
  const storageAvailable = useAppStore((s) => s.storageAvailable)

  async function handleCopyDeviceId() {
    try {
      await navigator.clipboard.writeText(getDeviceId())
      toast.success('Device ID copied to clipboard')
    } catch {
      toast.error('Could not copy — clipboard is unavailable')
    }
  }

  const { lang, setLang, languages, t } = useLanguage()

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            {t('settings.language', 'Language')} / भाषा निवडा
          </CardTitle>
          <CardDescription className="text-xs">
            {t('settings.language_desc', 'Choose your preferred language for the interface and billing workflows.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={lang}
            onValueChange={(val) => {
              setLang(val)
              const selected = languages.find((l) => l.code === val)
              toast.success(`Language set to ${selected?.nativeName} (${selected?.name})`)
            }}
            className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
            aria-label="Language selection"
          >
            {languages.map((l) => (
              <Label
                key={l.code}
                htmlFor={`lang-${l.code}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-accent/50"
              >
                <RadioGroupItem id={`lang-${l.code}`} value={l.code} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="text-sm font-semibold leading-tight">
                    {l.nativeName}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {l.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">
                    {l.region}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sun className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            Appearance
          </CardTitle>
          <CardDescription className="text-xs">
            Choose how InvoiceFlow looks on this device. The preference is saved instantly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={mounted ? (theme ?? 'system') : 'system'}
            onValueChange={(v) => setTheme(v)}
            className="grid gap-3 sm:grid-cols-3"
            aria-label="Theme preference"
          >
            {THEME_OPTIONS.map((opt) => (
              <Label
                key={opt.value}
                htmlFor={`theme-${opt.value}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-accent/50"
              >
                <RadioGroupItem id={`theme-${opt.value}`} value={opt.value} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <opt.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {opt.label}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">{opt.description}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            App &amp; device
          </CardTitle>
          <CardDescription className="text-xs">
            Installation details used for sync bookkeeping and support.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-2.5">
            <InfoRow label="Version">InvoiceFlow v{APP_VERSION}</InfoRow>
            <InfoRow label="Device ID">
              {deviceIdShort ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-xs">{deviceIdShort}…</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => void handleCopyDeviceId()}
                    aria-label="Copy full device ID"
                  >
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </span>
              ) : (
                <Skeleton className="h-4 w-20" />
              )}
            </InfoRow>
            <InfoRow label="Storage mode">
              {storageAvailable ? 'IndexedDB (persistent)' : 'Unavailable'}
            </InfoRow>
          </dl>

          {!storageAvailable && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Local storage unavailable</AlertTitle>
              <AlertDescription className="text-xs">
                Your browser blocked IndexedDB (private mode or storage policy). Data will not persist
                across reloads — export a backup or switch browsers before continuing.
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Company profile</p>
              <p className="text-xs text-muted-foreground">
                Business details, GSTIN and numbering used across invoices and quotations.
              </p>
            </div>
            <Button variant="link" className="h-auto p-0 text-emerald-700 dark:text-emerald-400" onClick={() => navigate('company')}>
              Go to My Company
              <Building2 className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Sync tab ----------

function SyncNowButton() {
  const [busy, setBusy] = useState(false)
  const syncStatus = useAppStore((s) => s.sync.status)
  const spinning = busy || syncStatus === 'syncing'

  async function handleSyncNow() {
    setBusy(true)
    try {
      await runSync()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void handleSyncNow()} disabled={spinning} className="gap-1.5">
      <Loader2 className={cn('h-3.5 w-3.5', spinning && 'animate-spin')} aria-hidden="true" />
      Sync now
    </Button>
  )
}

function ReauthAlert() {
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <UserRound className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Sign-in required</AlertTitle>
      <AlertDescription className="text-xs">
        Your cloud session expired. Sign in again to resume syncing — queued operations are safe and no
        local data is lost.{' '}
        <Button
          variant="link"
          className="h-auto p-0 text-amber-900 underline underline-offset-2 dark:text-amber-200"
          onClick={() => navigate('login')}
        >
          Sign in
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function ConflictItem({ op }: { op: SyncOperation }) {
  const [busy, setBusy] = useState(false)

  const localVersion = readVersion(op.payload) ?? op.base_version
  const serverVersion = readVersion(op.server_record)
  const diffHint =
    serverVersion === null
      ? `Local v${localVersion} · Server version unknown`
      : `Local v${localVersion} · Server v${serverVersion}`

  async function handleResolve(choice: ConflictChoice) {
    setBusy(true)
    try {
      await resolveConflict(op.id, choice)
      toast.success(
        choice === 'mine'
          ? 'Conflict resolved — your version will be re-pushed'
          : choice === 'theirs'
            ? "Conflict resolved — server's version adopted"
            : 'Conflict resolved — record marked as deleted',
      )
    } catch (err) {
      toast.error(`Could not resolve conflict: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-orange-200 bg-orange-50/50 p-3 dark:border-orange-900 dark:bg-orange-950/30 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {entityLabel(op.entity)}{' '}
          <span className="font-mono text-xs font-normal text-muted-foreground">{op.entity_id.slice(0, 8)}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{diffHint}</p>
        <p className="mt-0.5 text-xs text-orange-700 dark:text-orange-300">
          {op.last_error ?? 'A newer server version exists for this record.'}
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" className="shrink-0" disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            Resolve
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve sync conflict</AlertDialogTitle>
            <AlertDialogDescription>
              {entityLabel(op.entity)} <span className="font-mono">{op.entity_id.slice(0, 8)}</span> — {diffHint}.
              Your local change conflicts with the server&apos;s newer version. Choose which one to keep; this
              cannot be undone. &quot;Delete&quot; marks the record as deleted on every synced device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-wrap gap-2 sm:justify-between">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <div className="flex flex-wrap gap-2">
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => void handleResolve('delete')}
              >
                Delete
              </AlertDialogAction>
              <AlertDialogAction
                className="border bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground"
                onClick={() => void handleResolve('theirs')}
              >
                Keep server&apos;s
              </AlertDialogAction>
              <AlertDialogAction onClick={() => void handleResolve('mine')}>Keep mine</AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FailedOpItem({ op }: { op: SyncOperation }) {
  const [busy, setBusy] = useState(false)

  async function handleRetry() {
    setBusy(true)
    try {
      await retryFailedOp(op.id)
      toast.success('Operation re-queued for sync')
    } catch (err) {
      toast.error(`Could not retry: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscard() {
    setBusy(true)
    try {
      await discardFailedOp(op.id)
      toast.success('Operation discarded — the local record is unchanged')
    } catch (err) {
      toast.error(`Could not discard: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {entityLabel(op.entity)}{' '}
          <span className="font-mono text-xs font-normal text-muted-foreground">{op.entity_id.slice(0, 8)}</span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {op.attempts} {op.attempts === 1 ? 'attempt' : 'attempts'}
          </span>
        </p>
        <p className="mt-0.5 break-words text-xs text-red-600 dark:text-red-400">{op.last_error ?? 'Rejected by server'}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void handleRetry()} disabled={busy} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400"
              disabled={busy}
              aria-label={`Discard failed ${entityLabel(op.entity).toLowerCase()} operation ${op.id.slice(0, 8)}`}
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Discard
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard this operation?</AlertDialogTitle>
              <AlertDialogDescription>
                The queued change for {entityLabel(op.entity).toLowerCase()}{' '}
                <span className="font-mono">{op.entity_id.slice(0, 8)}</span> will be dropped and never sent to
                the cloud. The local record stays on this device.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void handleDiscard()}>
                Discard operation
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

function SyncTab() {
  const user = useUser()
  const ws = useActiveWorkspace()
  const needsReauth = useAppStore((s) => s.needsReauth)
  const { lastSyncAt, pending, lastError } = useAppStore((s) => s.sync)

  const ops = useLiveQuery(async () => {
    if (!ws?.id) return []
    const rows = await getDb().sync_operations.where('workspace_id').equals(ws.id).toArray()
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [ws?.id])

  const conflicts = useMemo(() => (ops ?? []).filter((o) => o.status === 'conflict'), [ops])
  const failed = useMemo(() => (ops ?? []).filter((o) => o.status === 'failed'), [ops])
  const cloudLinked = Boolean(user && ws?.cloud_linked_at)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">Sync status</CardTitle>
            <CardDescription className="text-xs">
              Push-then-pull runs automatically when online; queued work never expires (CANON §9).
            </CardDescription>
          </div>
          <SyncNowButton />
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2.5 sm:grid-cols-3">
            <InfoRow label="Cloud link">
              {cloudLinked ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                  Linked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
                  Guest — local only
                </span>
              )}
            </InfoRow>
            <InfoRow label="Last sync">{relative(lastSyncAt)}</InfoRow>
            <InfoRow label="Pending operations">{pending}</InfoRow>
          </dl>

          {!cloudLinked && (
            <p className="text-xs text-muted-foreground">
              Sign in and link this workspace to enable cloud sync. Until then everything stays safely on this
              device.
            </p>
          )}
          {lastError && (
            <p className="break-words text-xs text-red-600 dark:text-red-400" role="status">
              Last sync error: {lastError}
            </p>
          )}
          {needsReauth && <ReauthAlert />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outbox</CardTitle>
          <CardDescription className="text-xs">
            Every local mutation queues here before reaching the cloud. Done operations are pruned after 7 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ops === undefined ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : ops.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <p className="text-sm font-medium">All operations synced</p>
              <p className="text-xs text-muted-foreground">
                Queued changes appear here while they wait for the cloud.
              </p>
            </div>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto rounded-md border scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-24">Op</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ops.slice(0, OUTBOX_RENDER_LIMIT).map((op) => (
                    <TableRow key={op.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{op.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-sm">{entityLabel(op.entity)}</TableCell>
                      <TableCell className="text-sm capitalize">{op.action}</TableCell>
                      <TableCell>
                        <StatusBadge status={op.status} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{op.attempts}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                        {relative(op.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {ops.length > OUTBOX_RENDER_LIMIT && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                        + {ops.length - OUTBOX_RENDER_LIMIT} older operations hidden
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {(conflicts.length > 0 || failed.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {conflicts.length > 0 && (
            <Card className="border-orange-200 dark:border-orange-900">
              <CardHeader>
                <CardTitle className="text-base">Conflicts</CardTitle>
                <CardDescription className="text-xs">
                  The server has a newer version of these records. Choose what to keep — conflicts are never
                  resolved automatically.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {conflicts.map((op) => (
                  <ConflictItem key={op.id} op={op} />
                ))}
              </CardContent>
            </Card>
          )}
          {failed.length > 0 && (
            <Card className="border-red-200 dark:border-red-900">
              <CardHeader>
                <CardTitle className="text-base">Failed operations</CardTitle>
                <CardDescription className="text-xs">
                  Rejected after the retry schedule (8 attempts). Retry or discard — nothing is dropped
                  silently.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {failed.map((op) => (
                  <FailedOpItem key={op.id} op={op} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Data tab ----------

interface ParsedBackup {
  version: number
  exportedAt: string | null
  tables: Record<string, unknown[]>
}

type BackupRow = Record<string, unknown>

function fileWins(local: BackupRow | undefined, file: BackupRow): boolean {
  // Merge policy (docs/39 §4.2): keep the newer version per record; never auto-delete.
  if (!local) return true // absent locally → insert as-is
  const lv = readVersion(local)
  const fv = readVersion(file)
  if (lv === null || fv === null) return true // no version metadata → insert/refresh
  if (fv > lv) return true
  if (fv < lv) return false
  const lu = typeof local.updated_at === 'string' ? local.updated_at : ''
  const fu = typeof file.updated_at === 'string' ? file.updated_at : ''
  return fu > lu // equal versions → newer updated_at wins; tie keeps local
}

async function mergeBackupIntoDb(backup: ParsedBackup): Promise<{ inserted: number; updated: number; skippedNewer: number }> {
  const db = getDb()
  const known = new Map<string, DexieTable<BackupRow, string>>()
  for (const t of db.tables) known.set(t.name, t as unknown as DexieTable<BackupRow, string>)

  let inserted = 0
  let updated = 0
  let skippedNewer = 0

  for (const [name, rows] of Object.entries(backup.tables)) {
    const table = known.get(name)
    if (!table) continue // unknown tables are skipped (forward compatibility)
    const kp = table.schema.primKey.keyPath ?? 'id'
    const keyPath = typeof kp === 'string' ? kp : kp[0]
    const isSequences = name === 'document_sequences'

    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const row = raw as BackupRow
      const key = row[keyPath]
      if (key === undefined || key === null || key === '') continue
      if (name === 'app_settings' && row.key === 'device_id') continue // current device identity always wins

      const local: BackupRow | undefined = await table.get(String(key))
      if (isSequences && local) {
        // Sequences never decrement (CANON §6): next_seq becomes max(local, file).
        const next = Math.max(Number(local.next_seq) || 0, Number(row.next_seq) || 0)
        await table.put({ ...row, next_seq: next })
        updated += 1
        continue
      }
      if (local && !fileWins(local, row)) {
        skippedNewer += 1
        continue
      }
      await table.put(row)
      if (local) updated += 1
      else inserted += 1
    }
  }

  return { inserted, updated, skippedNewer }
}

// ---------- Local data health card ----------

const HEALTH_TABLES: Array<{ name: string; label: string; icon: typeof Receipt }> = [
  { name: 'invoices', label: 'Invoices', icon: Receipt },
  { name: 'quotations', label: 'Quotations', icon: FileText },
  { name: 'customers', label: 'Customers', icon: UserRound },
  { name: 'products', label: 'Products', icon: Package },
  { name: 'payments', label: 'Payments', icon: Banknote },
  { name: 'sync_operations', label: 'Sync ops', icon: Cloud },
]

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/**
 * Live snapshot of what this device is holding: storage estimate, per-table record
 * counts, outbox health and the last backup. Counts recompute live via Dexie
 * observers; the storage estimate refreshes on demand (browsers cap its frequency).
 */
function LocalHealthCard({ lastBackupAt }: { lastBackupAt: string | null | undefined }) {
  const [nonce, setNonce] = useState(0)
  const [storage, setStorage] = useState<{ usage: number | null; quota: number | null } | null>(null)

  useEffect(() => {
    let alive = true
    // deferred so the read happens off the render/effect body
    const t = setTimeout(() => {
      navigator.storage
        ?.estimate?.()
        .then((est) => {
          if (alive) setStorage({ usage: est.usage ?? null, quota: est.quota ?? null })
        })
        .catch(() => {})
    }, 0)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [nonce])

  const counts = useLiveQuery(async () => {
    const db = getDb()
    const out: Record<string, number> = {}
    for (const t of HEALTH_TABLES) out[t.name] = await db.table(t.name).count()
    return out
  }, [])

  const ops = useLiveQuery(() => getDb().sync_operations.toArray(), [])
  const pendingOps = (ops ?? []).filter((o) => o.status === 'pending' || o.status === 'in_flight').length
  const failedOps = (ops ?? []).filter((o) => o.status === 'failed' || o.status === 'conflict').length

  const usagePct =
    storage?.usage != null && storage.quota ? Math.min(100, Math.round((storage.usage / storage.quota) * 100)) : null

  return (
    <Card className="lg:col-span-2 overflow-hidden py-0">
      <div className="h-0.5 w-full bg-gradient-to-r from-emerald-500/0 via-emerald-500/60 to-emerald-500/0" aria-hidden="true" />
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">Local data health</CardTitle>
              <p className="text-xs text-muted-foreground">
                What this device is holding and how healthy the offline store is — live counts, no server round-trip.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setNonce((n) => n + 1)}
            title="Re-read the browser's storage estimate"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {/* storage */}
          <div className="space-y-2 rounded-lg border p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Storage used</p>
            <p className="text-lg font-semibold tabular-nums">
              {storage?.usage != null ? fmtBytes(storage.usage) : '—'}
              {storage?.quota != null && <span className="ml-1 text-xs font-normal text-muted-foreground">of {fmtBytes(storage.quota)} quota</span>}
            </p>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={usagePct != null ? `${usagePct}% of browser storage quota used` : 'Storage usage unknown'}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-500"
                style={{ width: `${usagePct ?? 0}%` }}
              />
            </div>
          </div>

          {/* outbox health */}
          <div className="space-y-2 rounded-lg border p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Outbox</p>
            <div className="flex items-end gap-5">
              <div>
                <p className={`text-lg font-semibold tabular-nums ${pendingOps > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{pendingOps}</p>
                <p className="text-[11px] text-muted-foreground">pending</p>
              </div>
              <div>
                <p className={`text-lg font-semibold tabular-nums ${failedOps > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{failedOps}</p>
                <p className="text-[11px] text-muted-foreground">failed</p>
              </div>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {failedOps > 0 ? 'Something needs attention — review in the Sync tab.' : pendingOps > 0 ? 'Queued changes will sync automatically.' : 'Everything is synced.'}
            </p>
          </div>

          {/* backup */}
          <div className="space-y-2 rounded-lg border p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Last backup</p>
            <p className={`text-lg font-semibold ${lastBackupAt ? '' : 'text-amber-600 dark:text-amber-400'}`}>{lastBackupAt ? relative(lastBackupAt) : 'Never'}</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {lastBackupAt ? 'Export again below any time — it only takes a second.' : 'Export a backup below to keep an off-device copy of your books.'}
            </p>
          </div>
        </div>

        {/* record counts */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {HEALTH_TABLES.map((t) => (
            <div key={t.name} className="rounded-lg bg-muted/40 p-2.5 text-center transition-colors hover:bg-accent/40">
              <t.icon className="mx-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <p className="mt-1 text-sm font-semibold tabular-nums" aria-label={`${t.label}: ${counts?.[t.name] ?? '…'}`}>
                {counts?.[t.name] ?? '…'}
              </p>
              <p className="text-[10px] text-muted-foreground">{t.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function DataTab() {
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [pendingImport, setPendingImport] = useState<ParsedBackup | null>(null)
  const [clearOpen2, setClearOpen2] = useState(false)
  const [clearing, setClearing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastBackupAt = useAppSetting('last_backup_at')

  async function handleExport() {
    setExporting(true)
    try {
      const db = getDb()
      const tables: Record<string, unknown[]> = {}
      for (const t of db.tables) {
        tables[t.name] = (await t.toArray()) as unknown[]
      }
      const payload = {
        meta: {
          app: 'invoiceflow',
          version: BACKUP_FORMAT_VERSION,
          exported_at: nowIso(),
          device_id: getDeviceId(),
        },
        tables,
      }
      const json = JSON.stringify(payload, null, 2)
      const stamp = toYMD(new Date()).replace(/-/g, '')
      const filename = `invoiceflow-backup-${stamp}.json`
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      await setSetting('last_backup_at', nowIso())
      toast.success(`Backup downloaded — ${filename}`)
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  async function onFileChosen(file: File) {
    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The file is not a valid JSON backup')
      }
      const obj = parsed as Record<string, unknown>
      const meta = (obj.meta ?? {}) as Record<string, unknown>
      if (meta.app !== 'invoiceflow') {
        throw new Error('This file is not an InvoiceFlow backup (meta.app mismatch)')
      }
      const version = typeof meta.version === 'number' ? meta.version : BACKUP_FORMAT_VERSION
      if (version > BACKUP_FORMAT_VERSION) {
        throw new Error('This backup was created by a newer InvoiceFlow version — update the app first')
      }
      const rawTables = (obj.tables ?? {}) as Record<string, unknown>
      const tables: Record<string, unknown[]> = {}
      for (const [name, rows] of Object.entries(rawTables)) {
        if (Array.isArray(rows)) tables[name] = rows
      }
      if (Object.keys(tables).length === 0) throw new Error('The backup contains no tables')
      setPendingImport({ version, exportedAt: typeof meta.exported_at === 'string' ? meta.exported_at : null, tables })
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`)
    }
  }

  async function handleImport() {
    if (!pendingImport) return
    setImporting(true)
    try {
      const summary = await mergeBackupIntoDb(pendingImport)
      const totalRows = Object.values(pendingImport.tables).reduce((n, rows) => n + rows.length, 0)
      setPendingImport(null)
      toast.success(
        `Import complete — ${summary.inserted} inserted · ${summary.updated} updated · ${summary.skippedNewer} kept newer of ${totalRows} rows`,
      )
      toast('Reload the app to refresh every view', {
        duration: 12000,
        action: { label: 'Reload', onClick: () => window.location.reload() },
      })
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  async function handleClearLocal() {
    setClearing(true)
    try {
      await getDb().delete()
      window.location.reload()
    } catch (err) {
      toast.error(`Could not clear local data: ${(err as Error).message}`)
      setClearing(false)
      setClearOpen2(false)
    }
  }

  const pendingRowCount = pendingImport
    ? Object.values(pendingImport.tables).reduce((n, rows) => n + rows.length, 0)
    : 0
  const pendingTableCount = pendingImport ? Object.keys(pendingImport.tables).length : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <LocalHealthCard lastBackupAt={lastBackupAt} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Export backup
            </CardTitle>
            <CardDescription className="text-xs">
              Download every local table as one portable JSON file. Works fully offline — store the file
              somewhere safe; it contains all your financial data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Last export: {lastBackupAt ? relative(lastBackupAt) : 'never on this device'}
            </p>
            <Button onClick={() => void handleExport()} disabled={exporting} className="gap-1.5">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              Export JSON backup
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Import backup
            </CardTitle>
            <CardDescription className="text-xs">
              Restore an <span className="font-mono">invoiceflow-backup-*.json</span> file. Merging keeps the
              newer version per record and never deletes local data; unknown tables are skipped.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onFileChosen(file)
                e.target.value = ''
              }}
              aria-label="Choose an InvoiceFlow backup file to import"
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing} className="gap-1.5">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              Choose backup file…
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-red-300/70 dark:border-red-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-red-700 dark:text-red-400">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Danger zone
          </CardTitle>
          <CardDescription className="text-xs">
            Irreversible local actions. Cloud data (if your workspace is linked) is not affected.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Clear local data deletes every workspace, document, customer and payment stored in IndexedDB on
            this device, then reloads the app. Export a backup first if in doubt.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="shrink-0 gap-1.5">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Clear local data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all local data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the entire local database on this device. If your workspace is
                  cloud-linked you can re-pull from the cloud after signing in; guest data cannot be
                  recovered.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => setClearOpen2(true)}>
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Import confirmation — merge policy notice per docs/39 §4.2 */}
      <AlertDialog open={pendingImport !== null} onOpenChange={(open) => !open && setPendingImport(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Rows are merged into your local database: the newer version per record wins and nothing is
              deleted. Document number sequences are advanced to the highest value to prevent reuse.
              {pendingImport?.exportedAt && ` Exported ${relative(pendingImport.exportedAt)}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-xs text-muted-foreground tabular-nums">
            {pendingTableCount} tables · {pendingRowCount} rows · format version {pendingImport?.version}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={importing}
              onClick={(e) => {
                e.preventDefault() // keep the dialog open until the merge finishes
                void handleImport()
              }}
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Second confirmation step for clearing local data */}
      <AlertDialog open={clearOpen2} onOpenChange={setClearOpen2}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This is the final confirmation. Everything in the local database will be erased immediately and
              the app will reload. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={clearing}
              onClick={(e) => {
                e.preventDefault()
                void handleClearLocal()
              }}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Erase everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- Security tab ----------

function DeleteAccountDialog({ busy, onDelete }: { busy: boolean; onDelete: () => void }) {
  const [step2Open, setStep2Open] = useState(false)
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="gap-1.5" disabled={busy}>
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Delete account
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your account and its cloud data will be permanently deleted. Data already stored on this device
              stays until you clear it from the Data tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => setStep2Open(true)}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={step2Open} onOpenChange={setStep2Open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Final confirmation</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Your account will be erased from the cloud immediately. You will be
              signed out afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                onDelete()
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Delete account forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SecurityTab() {
  const user = useUser()
  const setUser = useAppStore((s) => s.setUser)
  const [signingOut, setSigningOut] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await apiLogout()
      setUser(null)
      toast.success('Signed out — your local data stays on this device')
    } catch (err) {
      toast.error(`Sign out failed: ${(err as Error).message}`)
    } finally {
      setSigningOut(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      await apiDeleteAccount()
      setUser(null)
      toast.success('Account deleted — local data remains on this device')
    } catch (err) {
      toast.error(`Account deletion failed: ${(err as Error).message}`)
      setDeleting(false)
    }
  }

  const privacyPoints = [
    {
      icon: Database,
      title: 'Stored locally first',
      body: 'All business data lives in your browser’s IndexedDB and every feature works fully offline.',
    },
    {
      icon: Cloud,
      title: 'Cloud sync only when signed in',
      body: 'Nothing leaves this device until you sign in and link your workspace; guest data never touches a server.',
    },
    {
      icon: Download,
      title: 'Export anytime',
      body: 'Create a full JSON backup from the Data tab — backups are user-initiated downloads and no server stores them.',
    },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            Account
          </CardTitle>
          <CardDescription className="text-xs">Session and cloud identity for this device.</CardDescription>
        </CardHeader>
        {user ? (
          <CardContent className="space-y-4">
            <dl className="space-y-2.5">
              <InfoRow label="Name">{user.name ?? '—'}</InfoRow>
              <InfoRow label="Email">{user.email}</InfoRow>
              <InfoRow label="User ID">
                <span className="font-mono text-xs">{user.id.slice(0, 8)}</span>
              </InfoRow>
            </dl>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void handleSignOut()} disabled={signingOut} className="gap-1.5">
                {signingOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
                Sign out
              </Button>
              <DeleteAccountDialog busy={deleting} onDelete={() => void handleDeleteAccount()} />
            </div>
          </CardContent>
        ) : (
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <p className="text-xs text-amber-900 dark:text-amber-200">
                You&apos;re using a guest workspace. Data stays on this device — sign in to back it up to the
                cloud and sync across devices.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => navigate('login')} className="gap-1.5">
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in
              </Button>
              <Button variant="outline" onClick={() => navigate('login')} className="gap-1.5">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Create account
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            Privacy
          </CardTitle>
          <CardDescription className="text-xs">How InvoiceFlow handles your data, in plain words.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {privacyPoints.map((point) => (
              <li key={point.title} className="flex items-start gap-3">
                <point.icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{point.title}</p>
                  <p className="text-xs text-muted-foreground">{point.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter className="border-t text-xs text-muted-foreground">
          <p>
            Local-first by design (CANON §1) — the cloud is an optional mirror, never the primary store.
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}

// ---------- Root view ----------

export function SettingsView({ initialTab = 'preferences' }: SettingsViewProps) {
  return (
    <section aria-label="Settings" className="flex flex-col gap-4">
      <div>
        <SectionHeading>Settings</SectionHeading>
        <p className="text-xs text-muted-foreground">
          Preferences, sync health, backups and account — all in one place.
        </p>
      </div>

      <Tabs defaultValue={initialTab} className="gap-4">
        <TabsList className="grid w-full grid-cols-2 gap-1 sm:inline-flex sm:w-fit">
          <TabsTrigger value="preferences" className="gap-1.5 px-3">
            <Sun className="h-3.5 w-3.5" aria-hidden="true" />
            Preferences
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-1.5 px-3">
            <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
            Sync
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-1.5 px-3">
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            Data
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5 px-3">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preferences" className="mt-2">
          <PreferencesTab />
        </TabsContent>
        <TabsContent value="sync" className="mt-2">
          <SyncTab />
        </TabsContent>
        <TabsContent value="data" className="mt-2">
          <DataTab />
        </TabsContent>
        <TabsContent value="security" className="mt-2">
          <SecurityTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}
