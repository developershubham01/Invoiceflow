// InvoiceFlow — Sync engine (CANON §9): push outbox ops → pull change-log deltas.
// Guarantees: idempotent ops (op_id), CAS conflicts, exponential backoff,
// auth-expiry pause, no silent data loss. Runs only when: online + authenticated + workspace cloud-linked.

import { getDb } from '@/lib/db/db'
import { chargesFromJson, type InvoiceRow, type QuotationRow } from '@/lib/db/row-types'
import { getDeviceId } from '@/lib/device'
import { nowIso } from '@/lib/date'
import { apiPull, apiPush, type PushOp, type PushResult } from './client'
import type { SyncOperation } from '@/lib/domain/types'
import { useAppStore } from '@/lib/stores/app-store'

const BATCH_SIZE = 25
const MAX_ATTEMPTS = 8
const PRUNE_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000

let running = false

function backoffMs(attempts: number): number {
  return Math.min(10 * 60 * 1000, Math.pow(2, attempts) * 2000)
}

function isCloudSyncReady(): boolean {
  const store = useAppStore.getState()
  return Boolean(store.user && store.activeWorkspace?.cloud_linked_at && navigator.onLine)
}

async function setSyncStatus(status: 'idle' | 'syncing' | 'offline' | 'error' | 'needs_auth', error?: string) {
  const store = useAppStore.getState()
  const meta = await getDb().sync_metadata.get(store.activeWorkspace?.id ?? '')
  store.setSyncState({
    status,
    lastError: error ?? null,
    lastSyncAt: meta?.last_sync_at ?? null,
    pending: await countPending(),
  })
}

export async function countPending(): Promise<number> {
  const ws = useAppStore.getState().activeWorkspace
  if (!ws) return 0
  const rows = await getDb().sync_operations.where('[workspace_id+status]').equals([ws.id, 'pending']).count()
  const conflicts = await getDb().sync_operations.where('[workspace_id+status]').equals([ws.id, 'conflict']).count()
  return rows + conflicts
}

/** Apply a pulled change inside the caller's transaction context. */
async function applyPulledChange(change: { entity: string; op: string; record: Record<string, unknown> }): Promise<void> {
  const db = getDb()
  const rec = change.record as Record<string, unknown> & { id: string; version: number; workspace_id: string }
  if (!rec?.id || rec.deleted_at === undefined) return

  // Skip when we have a pending local op for the same entity — conflict resolves at push time.
  const ws = useAppStore.getState().activeWorkspace
  if (!ws) return
  const pending = await db.sync_operations
    .where('[workspace_id+status]')
    .equals([ws.id, 'pending'])
    .filter((o) => o.entity_id === rec.id)
    .first()
  if (pending) return

  const local =
    change.entity === 'invoice' ? await db.invoices.get(rec.id) :
    change.entity === 'quotation' ? await db.quotations.get(rec.id) :
    change.entity === 'customer' ? await db.customers.get(rec.id) :
    change.entity === 'product' ? await db.products.get(rec.id) :
    change.entity === 'payment' ? await db.payments.get(rec.id) :
    change.entity === 'company' ? await db.company_profiles.get(rec.id) :
    null

  if (local && local.version >= rec.version) return // already have this or newer

  const withSync = normalizeRecord(rec)
  switch (change.entity) {
    case 'invoice': {
      await db.invoices.put(withSync.row as InvoiceRow)
      if (Array.isArray(withSync.items)) {
        await db.invoice_items.where('invoice_id').equals(rec.id).delete()
        await db.invoice_items.bulkPut(withSync.items as never[])
      }
      break
    }
    case 'quotation': {
      await db.quotations.put(withSync.row as QuotationRow)
      if (Array.isArray(withSync.items)) {
        await db.quotation_items.where('quotation_id').equals(rec.id).delete()
        await db.quotation_items.bulkPut(withSync.items as never[])
      }
      break
    }
    case 'customer':
      await db.customers.put(withSync.row as never)
      break
    case 'product':
      await db.products.put(withSync.row as never)
      break
    case 'payment':
      await db.payments.put(withSync.row as never)
      break
    case 'company':
      await db.company_profiles.put(withSync.row as never)
      break
    default:
      break
  }
}

/** Shape a server canonical record into a Dexie row: sync_state synced, charges as JSON, items split out. */
function normalizeRecord(rec: Record<string, unknown>): { row: Record<string, unknown>; items: unknown } {
  const row: Record<string, unknown> = { ...rec }
  row.sync_state = 'synced'
  const items = row.items
  delete row.items
  if ('charges' in row || 'charges_json' in row) {
    const charges = row.charges ?? (typeof row.charges_json === 'string' ? safeParse(row.charges_json) : row.charges_json) ?? []
    row.charges_json = JSON.stringify(charges)
    delete row.charges
  }
  return { row, items }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}

async function pushPhase(): Promise<void> {
  const db = getDb()
  const ws = useAppStore.getState().activeWorkspace!
  const deviceId = getDeviceId()

  for (;;) {
    const batch = (await db.sync_operations
      .where('[workspace_id+status]')
      .equals([ws.id, 'pending'])
      .sortBy('created_at')).slice(0, BATCH_SIZE)
    if (batch.length === 0) break

    await markOps(batch, 'in_flight')
    let response: Awaited<ReturnType<typeof apiPush>>
    try {
      response = await apiPush(ws.id, deviceId, batch.map(toOp))
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 401) {
        await markOps(batch, 'pending')
        useAppStore.getState().setNeedsReauth(true)
        await setSyncStatus('needs_auth', 'Session expired — sign in again to continue syncing')
        return
      }
      await markOps(batch, 'pending')
      for (const op of batch) await bumpAttempts(op, (err as Error).message)
      throw err
    }

    for (const result of response.results as PushResult[]) {
      const op = batch.find((o) => o.id === result.op_id)
      if (!op) continue
      if (result.status === 'applied' || result.status === 'duplicate' || result.status === 'number_reassigned') {
        if (result.record) await adoptServerRecord(result.record as Record<string, unknown>, result.status === 'number_reassigned')
        await db.sync_operations.update(op.id, { status: 'done', last_error: null })
      } else if (result.status === 'conflict') {
        await db.sync_operations.update(op.id, {
          status: 'conflict',
          server_record: result.record ?? null,
          last_error: result.error ?? 'Version conflict',
        })
        await setEntitySyncState(op.entity, op.entity_id, 'conflict')
      } else {
        await db.sync_operations.update(op.id, { status: 'failed', last_error: result.error ?? 'Rejected' })
        await setEntitySyncState(op.entity, op.entity_id, 'failed')
      }
    }
  }
  await pruneDoneOps(ws.id)
}

function toOp(o: SyncOperation): PushOp {
  return { op_id: o.id, entity: o.entity, entity_id: o.entity_id, action: o.action, base_version: o.base_version, payload: o.payload }
}

async function markOps(ops: SyncOperation[], status: 'in_flight' | 'pending'): Promise<void> {
  const db = getDb()
  await Promise.all(ops.map((o) => db.sync_operations.update(o.id, { status })))
}

async function bumpAttempts(op: SyncOperation, error: string): Promise<void> {
  const db = getDb()
  const attempts = op.attempts + 1
  const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
  await db.sync_operations.update(op.id, {
    attempts,
    status,
    last_error: error,
    next_attempt_at: status === 'pending' ? new Date(Date.now() + backoffMs(attempts)).toISOString() : null,
  })
  if (status === 'failed') await setEntitySyncState(op.entity, op.entity_id, 'failed')
}

async function setEntitySyncState(entity: string, entityId: string, state: 'conflict' | 'failed'): Promise<void> {
  const db = getDb()
  const table =
    entity === 'invoice' ? db.invoices : entity === 'quotation' ? db.quotations :
    entity === 'customer' ? db.customers : entity === 'product' ? db.products :
    entity === 'payment' ? db.payments : entity === 'company' ? db.company_profiles : null
  if (!table) return
  const rec = await table.get(entityId)
  if (rec) await table.update(entityId, { sync_state: state } as never)
}

/** Adopt the authoritative server record (e.g. allocated invoice number, recomputed totals). */
async function adoptServerRecord(serverRec: Record<string, unknown>, reassignedNumber: boolean): Promise<void> {
  const db = getDb()
  const rec = serverRec as Record<string, unknown> & { id: string; version: number }
  if (!rec.id) return
  const entity = detectEntity(serverRec)
  const { row: withSync, items } = normalizeRecord(rec)
  if (entity === 'invoice') {
    await db.invoices.put(withSync as InvoiceRow)
    if (Array.isArray(items)) {
      await db.invoice_items.where('invoice_id').equals(rec.id).delete()
      await db.invoice_items.bulkPut(items as never[])
    }
    if (reassignedNumber) {
      await db.audit_logs.add({
        id: crypto.randomUUID(),
        workspace_id: String(rec.workspace_id),
        entity_type: 'invoice',
        entity_id: String(rec.id),
        action: 'SYNC_CONFLICT',
        detail: JSON.stringify({ notice: 'number_reassigned', number: rec.number }),
        device_id: getDeviceId(),
        at: nowIso(),
      })
    }
  } else if (entity === 'quotation') {
    await db.quotations.put(withSync as QuotationRow)
    if (Array.isArray(items)) {
      await db.quotation_items.where('quotation_id').equals(rec.id).delete()
      await db.quotation_items.bulkPut(items as never[])
    }
  } else if (entity === 'customer') await db.customers.put(withSync as never)
  else if (entity === 'product') await db.products.put(withSync as never)
  else if (entity === 'payment') await db.payments.put(withSync as never)
  else if (entity === 'company') await db.company_profiles.put(withSync as never)
}

function detectEntity(rec: Record<string, unknown>): string {
  if ('invoice_date' in rec) return 'invoice'
  if ('quotation_date' in rec) return 'quotation'
  if ('amount_paise' in rec && 'invoice_id' in rec) return 'payment'
  if ('selling_price_paise' in rec) return 'product'
  if ('business_name' in rec) return 'customer'
  if ('invoice_prefix' in rec) return 'company'
  return 'unknown'
}

async function pullPhase(): Promise<void> {
  const db = getDb()
  const ws = useAppStore.getState().activeWorkspace!
  const meta = await db.sync_metadata.get(ws.id)
  const cursor = meta?.pull_cursor ?? 0
  const res = await apiPull(ws.id, cursor)
  await db.transaction('rw', [db.invoices, db.invoice_items, db.quotations, db.quotation_items, db.customers, db.products, db.payments, db.company_profiles, db.sync_metadata, db.sync_operations], async () => {
    for (const change of res.changes) {
      await applyPulledChange(change)
    }
    await db.sync_metadata.put({
      workspace_id: ws.id,
      pull_cursor: res.next_cursor,
      last_sync_at: nowIso(),
      last_sync_error: null,
    })
  })
}

async function pruneDoneOps(workspaceId: string): Promise<void> {
  const db = getDb()
  const cutoff = new Date(Date.now() - PRUNE_OLDER_THAN_MS).toISOString()
  const done = await db.sync_operations.where('[workspace_id+status]').equals([workspaceId, 'done']).toArray()
  const stale = done.filter((o) => o.created_at < cutoff)
  if (stale.length) await db.sync_operations.bulkDelete(stale.map((o) => o.id))
}

/** Run a full sync cycle (push → pull). Safe to call concurrently; re-entrant calls are ignored. */
export async function runSync(): Promise<void> {
  if (running) return
  if (!isCloudSyncReady()) {
    if (!navigator.onLine) await setSyncStatus('offline')
    return
  }
  running = true
  try {
    await setSyncStatus('syncing')
    await pushPhase()
    await pullPhase()
    await setSyncStatus('idle')
    useAppStore.getState().setNeedsReauth(false)
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401) {
      useAppStore.getState().setNeedsReauth(true)
      await setSyncStatus('needs_auth', 'Session expired — sign in again to continue syncing')
    } else {
      await setSyncStatus('error', (err as Error).message)
    }
  } finally {
    running = false
    const store = useAppStore.getState()
    store.setSyncState({ pending: await countPending() })
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Install engine triggers: interval, online event, focus. Returns a cleanup fn. */
export function startSyncEngine(): () => void {
  if (timer) clearInterval(timer)
  timer = setInterval(() => void runSync(), 30_000)
  const onOnline = () => void runSync()
  const onFocus = () => void runSync()
  window.addEventListener('online', onOnline)
  window.addEventListener('focus', onFocus)
  return () => {
    if (timer) clearInterval(timer)
    timer = null
    window.removeEventListener('online', onOnline)
    window.removeEventListener('focus', onFocus)
  }
}

export { chargesFromJson }
