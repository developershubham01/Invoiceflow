// InvoiceFlow — Local database (Dexie.js over IndexedDB) — CANON §7 / docs/16
// The local database is the source of truth for responsive UI operations.
// Versioned migrations: append db.version(n+1) — never mutate v1 in place.

import Dexie, { type Table } from 'dexie'
import type {
  AppSettingsRow,
  AuditLogRow,
  CompanyProfileRow,
  CustomerRow,
  DocumentSequenceRow,
  InvoiceItemRow,
  InvoiceRow,
  PaymentRow,
  ProductRow,
  QuotationItemRow,
  QuotationRow,
  SyncMetadataRow,
  SyncOperationRow,
  TaxRateRow,
  WorkspaceMemberRow,
  WorkspaceRow,
} from './row-types'

export class InvoiceFlowDB extends Dexie {
  workspaces!: Table<WorkspaceRow, string>
  workspace_members!: Table<WorkspaceMemberRow, string>
  company_profiles!: Table<CompanyProfileRow, string>
  customers!: Table<CustomerRow, string>
  products!: Table<ProductRow, string>
  quotations!: Table<QuotationRow, string>
  quotation_items!: Table<QuotationItemRow, string>
  invoices!: Table<InvoiceRow, string>
  invoice_items!: Table<InvoiceItemRow, string>
  payments!: Table<PaymentRow, string>
  tax_rates!: Table<TaxRateRow, string>
  document_sequences!: Table<DocumentSequenceRow, string>
  attachments!: Table<{ id: string; workspace_id: string; entity_type: string; entity_id: string; filename: string; mime: string; size_bytes: number; data: string | null; created_at: string }, string>
  audit_logs!: Table<AuditLogRow, string>
  sync_operations!: Table<SyncOperationRow, string>
  sync_metadata!: Table<SyncMetadataRow, string>
  app_settings!: Table<AppSettingsRow, string>

  constructor() {
    super('invoiceflow')
    // Schema v1 — see docs/16-INDEXEDDB-DATABASE.md for migration policy.
    this.version(1).stores({
      workspaces: 'id, name, updated_at',
      workspace_members: 'id, workspace_id, user_id, role',
      company_profiles: 'id, workspace_id, updated_at',
      customers: 'id, workspace_id, code, gstin, phone, sync_state, updated_at, deleted_at, [workspace_id+deleted_at]',
      products: 'id, workspace_id, sku, hsn_sac, active, sync_state, updated_at, deleted_at, [workspace_id+active], [workspace_id+deleted_at]',
      quotations: 'id, workspace_id, number, status, quotation_date, customer_id, sync_state, updated_at, deleted_at, [workspace_id+status], [workspace_id+deleted_at]',
      quotation_items: 'id, quotation_id, workspace_id, [quotation_id]',
      invoices: 'id, workspace_id, number, status, invoice_date, due_date, customer_id, sync_state, updated_at, deleted_at, [workspace_id+status], [workspace_id+deleted_at]',
      invoice_items: 'id, invoice_id, workspace_id, [invoice_id]',
      payments: 'id, workspace_id, invoice_id, paid_at, sync_state, updated_at, deleted_at, [workspace_id+paid_at], [invoice_id]',
      tax_rates: 'id, workspace_id, active, [workspace_id+active]',
      document_sequences: 'id, [workspace_id+doc_type+fiscal_year]',
      attachments: 'id, workspace_id, entity_type, entity_id, [entity_type+entity_id]',
      audit_logs: 'id, workspace_id, entity_type, entity_id, at, [workspace_id+at], [entity_type+entity_id]',
      sync_operations: 'id, workspace_id, entity_id, status, created_at, next_attempt_at, [workspace_id+status], [status+created_at]',
      sync_metadata: 'workspace_id',
      app_settings: 'key',
    })
  }
}

let _db: InvoiceFlowDB | null = null

/** Lazily create the singleton (client-side only). */
export function getDb(): InvoiceFlowDB {
  if (typeof window === 'undefined') {
    throw new Error('Dexie is browser-only; do not call getDb() on the server')
  }
  if (!_db) _db = new InvoiceFlowDB()
  return _db
}

/** True when IndexedDB is available (used for the storage-availability banner). */
export async function checkStorageAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return false
  try {
    const db = getDb()
    await db.open()
    return true
  } catch {
    return false
  }
}
