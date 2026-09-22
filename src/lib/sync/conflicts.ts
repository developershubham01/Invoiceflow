// InvoiceFlow — Conflict resolution (CANON §10, docs/18-CONFLICT-RESOLUTION.md)
// User-driven resolution: Keep mine (re-push with server base version) / Keep server's (adopt) / Delete.

import { getDb } from '@/lib/db/db'
import { nowIso } from '@/lib/date'
import { runSync } from './engine'
import type { SyncOperation } from '@/lib/domain/types'
import { useAppStore } from '@/lib/stores/app-store'

export type ConflictChoice = 'mine' | 'theirs' | 'delete'

async function auditConflict(workspaceId: string, op: SyncOperation, choice: ConflictChoice): Promise<void> {
  await getDb().audit_logs.add({
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    entity_type: op.entity,
    entity_id: op.entity_id,
    action: 'SYNC_CONFLICT',
    detail: JSON.stringify({ resolution: choice, op_id: op.id }),
    device_id: op.payload && typeof op.payload === 'object' ? String((op.payload as Record<string, unknown>).origin_device_id ?? 'local') : 'local',
    at: nowIso(),
  })
}

function tableFor(entity: string) {
  const db = getDb()
  switch (entity) {
    case 'invoice': return db.invoices
    case 'quotation': return db.quotations
    case 'customer': return db.customers
    case 'product': return db.products
    case 'payment': return db.payments
    case 'company': return db.company_profiles
    default: return null
  }
}

/** Resolve a conflicting op. Server record is authoritative for versioning. */
export async function resolveConflict(opId: string, choice: ConflictChoice): Promise<void> {
  const db = getDb()
  const op = await db.sync_operations.get(opId)
  if (!op || op.status !== 'conflict') return
  const ws = useAppStore.getState().activeWorkspace
  if (!ws) return

  if (choice === 'theirs' && op.server_record) {
    const server = op.server_record as Record<string, unknown> & { id: string }
    const table = tableFor(op.entity)
    if (table) {
      const local = await table.get(op.entity_id)
      await table.put({ ...(server as object), sync_state: 'synced', workspace_id: ws.id, ...(local ? { created_at: local.created_at } : {}) } as never)
      // documents may carry embedded items
      const items = (server as Record<string, unknown>).items
      if (Array.isArray(items)) {
        if (op.entity === 'invoice') {
          await db.invoice_items.where('invoice_id').equals(server.id).delete()
          await db.invoice_items.bulkPut(items as never[])
        } else if (op.entity === 'quotation') {
          await db.quotation_items.where('quotation_id').equals(server.id).delete()
          await db.quotation_items.bulkPut(items as never[])
        }
      }
    }
  } else if (choice === 'mine' || choice === 'delete') {
    const local = op.payload as Record<string, unknown> | undefined
    if (local) {
      const record = {
        ...local,
        id: op.entity_id,
        workspace_id: ws.id,
        deleted_at: choice === 'delete' ? nowIso() : (local.deleted_at ?? null),
        // keep our content but adopt the server's version as the new base
        version: (op.server_record as { version?: number } | null)?.version ?? op.base_version,
      }
      await db.sync_operations.put({
        ...op,
        status: 'pending',
        base_version: record.version as number,
        payload: record,
        server_record: null,
        attempts: 0,
        next_attempt_at: null,
      })
      const table = tableFor(op.entity)
      if (table) await table.put({ ...(record as object), sync_state: 'pending' } as never)
    }
  }

  await auditConflict(ws.id, op, choice)
  await db.sync_operations.delete(opId)
  const store = useAppStore.getState()
  store.setSyncState({ pending: store.sync.pending })
  void runSync()
}

/** Retry a failed op (user-initiated from Settings → Sync). */
export async function retryFailedOp(opId: string): Promise<void> {
  const db = getDb()
  await db.sync_operations.update(opId, { status: 'pending', attempts: 0, next_attempt_at: null, last_error: null })
  void runSync()
}

/** Discard a failed op entirely (data stays local, marked synced-never). */
export async function discardFailedOp(opId: string): Promise<void> {
  const db = getDb()
  await db.sync_operations.delete(opId)
}
