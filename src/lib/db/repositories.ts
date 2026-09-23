// InvoiceFlow — Repositories (local-first, CANON §1 pipeline)
// Every mutation: validate (caller) → local Dexie transaction → outbox op → audit log.
// The UI updates from Dexie live queries immediately after commit.

import { getDb } from './db'
import { chargesFromJson, chargesToJson, type CompanyProfileRow, type InvoiceRow, type QuotationRow } from './row-types'
import { getDeviceId } from '@/lib/device'
import { nowIso, todayStr } from '@/lib/date'
import { fiscalYearOf, formatCustomerCode, isProvisionalNumber, provisionalNumber, renderDocNumber, docPatternError, sequenceKey } from '@/lib/domain/numbering'
import { computeDocumentTotals, computeLine, resolveTaxMode, type DocItemInput } from '@/lib/domain/documents'
import type {
  AuditLog, CompanyProfile, Customer, DocCharge, Invoice, InvoiceItem, Payment,
  Product, Quotation, QuotationItem, SyncEntity, SyncMeta, SyncOpAction, Workspace,
} from '@/lib/domain/types'

type DB = ReturnType<typeof getDb>

// ---------- helpers ----------

function metaFields(existing?: SyncMeta): Pick<SyncMeta, 'updated_at' | 'version'> {
  return {
    updated_at: nowIso(),
    version: (existing?.version ?? 0) + 1,
  }
}

function baseMeta(deviceId: string): Pick<SyncMeta, 'created_at' | 'deleted_at' | 'sync_state' | 'origin_device_id'> {
  return { created_at: nowIso(), deleted_at: null, sync_state: 'local', origin_device_id: deviceId }
}

/** Enqueue an outbox operation (idempotency key = op id). */
export async function enqueueOp(
  db: DB,
  workspaceId: string,
  entity: SyncEntity,
  entityId: string,
  action: SyncOpAction,
  baseVersion: number,
  payload: unknown,
): Promise<string> {
  const op = {
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    entity,
    entity_id: entityId,
    action,
    base_version: baseVersion,
    payload,
    server_record: null,
    status: 'pending' as const,
    attempts: 0,
    last_error: null,
    next_attempt_at: null,
    created_at: nowIso(),
  }
  // Replace any pending op for the same entity with a fresher full-record op (compaction).
  const stale = await db.sync_operations
    .where('[workspace_id+status]')
    .equals([workspaceId, 'pending'])
    .filter((o) => o.entity === entity && o.entity_id === entityId && o.action === action)
    .toArray()
  await db.sync_operations.bulkDelete(stale.map((o) => o.id))
  await db.sync_operations.add(op)
  return op.id
}

export async function addAudit(
  db: DB,
  workspaceId: string,
  entityType: string,
  entityId: string,
  action: AuditLog['action'],
  detail?: unknown,
): Promise<void> {
  const log: AuditLog = {
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    detail: detail ? JSON.stringify(detail) : null,
    device_id: getDeviceId(),
    at: nowIso(),
  }
  await db.audit_logs.add(log)
}

// ---------- settings ----------

export async function getSetting(key: string): Promise<string | null> {
  const row = await getDb().app_settings.get(key)
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb().app_settings.put({ key, value })
}

export async function removeSetting(key: string): Promise<void> {
  await getDb().app_settings.delete(key)
}

// ---------- workspaces ----------

export async function createWorkspace(name: string): Promise<Workspace> {
  const db = getDb()
  const deviceId = getDeviceId()
  const ws: Workspace = {
    id: crypto.randomUUID(),
    workspace_id: '', // reserved; entities store their own ws id (kept for CANON consistency)
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workspace',
    owner_user_id: null,
    cloud_linked_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
    version: 1,
    sync_state: 'local',
    origin_device_id: deviceId,
  }
  await db.workspaces.add(ws)
  await setSetting('active_workspace_id', ws.id)
  await db.sync_metadata.put({ workspace_id: ws.id, pull_cursor: 0, last_sync_at: null, last_sync_error: null })
  return ws
}

export async function getActiveWorkspace(): Promise<Workspace | null> {
  const db = getDb()
  const activeId = await getSetting('active_workspace_id')
  if (activeId) {
    const ws = await db.workspaces.get(activeId)
    if (ws && !ws.deleted_at) return ws
  }
  const all = await db.workspaces.filter((w) => !w.deleted_at).sortBy('updated_at')
  if (all.length > 0) {
    await setSetting('active_workspace_id', all[all.length - 1].id)
    return all[all.length - 1]
  }
  return null
}

export async function listWorkspaces(): Promise<Workspace[]> {
  return getDb().workspaces.filter((w) => !w.deleted_at).toArray()
}

export async function switchWorkspace(id: string): Promise<void> {
  await setSetting('active_workspace_id', id)
}

// ---------- company profile ----------

export async function getCompany(workspaceId: string): Promise<CompanyProfile | null> {
  const rows = await getDb().company_profiles.where('workspace_id').equals(workspaceId).filter((c) => !c.deleted_at).toArray()
  return rows[0] ?? null
}

export async function getCompanyByUserId(userId: string): Promise<CompanyProfile | null> {
  const rows = await getDb().company_profiles.filter((c) => c.user_id === userId && !c.deleted_at).toArray()
  return rows[0] ?? null
}

/**
 * Strip a blank (`undefined`/null/empty) `id` from a form payload before spreading it into a
 * new record. Callers commonly pass `id: form.id`, which is `undefined` for creates; if spread
 * verbatim it OVERWRITES the generated UUID (explicit undefined still overwrites in object
 * spread), and the IndexedDB put then fails with DataError. Keeping this guard in the
 * repository layer protects every current and future caller.
 */
function withoutBlankId<T extends { id?: string | null }>(input: T): Omit<T, 'id'> {
  if (input.id) return input
  const { id: _blank, ...rest } = input
  return rest
}

export async function saveCompany(workspaceId: string, input: Partial<CompanyProfile> & { name: string }): Promise<CompanyProfile> {
  const db = getDb()
  const deviceId = getDeviceId()
  const existing = await getCompany(workspaceId)
  const record: CompanyProfile = existing
    ? { ...existing, ...withoutBlankId(input), ...metaFields(existing) }
    : {
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        user_id: input.user_id ?? null,
        business_type: null,
        industry: null,
        description: null,
        logo_data: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state_name: null,
        state_code: null,
        pincode: null,
        gstin: null,
        pan: null,
        phone: null,
        email: null,
        website: null,
        bank_name: null,
        bank_account: null,
        bank_ifsc: null,
        bank_branch: null,
        upi_vpa: null,
        authorized_signatory: null,
        signature_data: null,
        invoice_prefix: 'INV',
        quotation_prefix: 'QT',
        default_gst_rate_bps: 1800,
        price_includes_tax: false,
        enable_round_off: true,
        default_terms: null,
        default_notes: null,
        invoice_number_pattern: null,
        quotation_number_pattern: null,
        doc_date_format: null,
        invoice_template: null,
        quotation_template: null,
        ...withoutBlankId(input),
        ...baseMeta(deviceId),
        ...metaFields(),
      }
  await db.transaction('rw', db.company_profiles, db.sync_operations, db.audit_logs, async () => {
    await db.company_profiles.put(record)
    if (record.workspace_id) {
      await enqueueOp(db, workspaceId, 'company', record.id, 'upsert', existing?.version ?? 0, record)
      await addAudit(db, workspaceId, 'company', record.id, existing ? 'UPDATE' : 'CREATE')
    }
  })
  return record
}

// ---------- customers ----------

export async function listCustomers(workspaceId: string, includeDeleted = false): Promise<Customer[]> {
  const rows = await getDb().customers.where('workspace_id').equals(workspaceId).toArray()
  return rows.filter((c) => includeDeleted || !c.deleted_at).sort((a, b) => a.business_name.localeCompare(b.business_name))
}

export async function getCustomer(id: string): Promise<Customer | null> {
  return (await getDb().customers.get(id)) ?? null
}

// ---------- customers ----------

export async function nextCustomerCode(workspaceId: string): Promise<string> {
  const rows = await getDb().customers.where('workspace_id').equals(workspaceId).toArray()
  return customerCodeFromRows(rows)
}

function customerCodeFromRows(rows: Customer[]): string {
  const maxSeq = rows.reduce((max, c) => {
    const n = Number((c.code ?? '').replace('CUS-', ''))
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return formatCustomerCode(maxSeq + 1)
}

export async function saveCustomer(workspaceId: string, input: Partial<Customer> & { business_name: string }): Promise<Customer> {
  const db = getDb()
  const deviceId = getDeviceId()
  const existing = input.id ? await db.customers.get(input.id) : undefined
  const explicitCode = input.code?.trim() || undefined
  let record: Customer
  if (existing) {
    record = { ...existing, ...withoutBlankId(input), code: explicitCode ?? existing.code, ...metaFields(existing) }
  } else {
    record = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      type: 'BUSINESS',
      contact_person: null,
      email: null,
      phone: null,
      gstin: null,
      billing_address: null,
      shipping_address: null,
      state_name: null,
      state_code: null,
      notes: null,
      ...withoutBlankId(input),
      code: explicitCode ?? '',
      ...baseMeta(deviceId),
      ...metaFields(),
    }
  }
  record.sync_state = 'pending'
  await db.transaction('rw', db.customers, db.sync_operations, db.audit_logs, async () => {
    // Auto-number allocation must happen inside the SAME readwrite transaction as the put:
    // IndexedDB serializes overlapping rw transactions, so concurrent creates (Promise.all
    // seeding, rapid UI saves) can never observe the same max sequence twice.
    if (!existing && !explicitCode) {
      const rows = await db.customers.where('workspace_id').equals(workspaceId).toArray()
      record.code = customerCodeFromRows(rows)
    }
    await db.customers.put(record)
    await enqueueOp(db, workspaceId, 'customer', record.id, 'upsert', existing?.version ?? 0, record)
    await addAudit(db, workspaceId, 'customer', record.id, existing ? 'UPDATE' : 'CREATE')
  })
  return record
}

export async function softDeleteCustomer(workspaceId: string, id: string): Promise<void> {
  const db = getDb()
  const existing = await db.customers.get(id)
  if (!existing) return
  const record: Customer = { ...existing, deleted_at: nowIso(), ...metaFields(existing) }
  record.sync_state = 'pending'
  await db.transaction('rw', db.customers, db.sync_operations, db.audit_logs, async () => {
    await db.customers.put(record)
    await enqueueOp(db, workspaceId, 'customer', id, 'delete', existing.version, record)
    await addAudit(db, workspaceId, 'customer', id, 'DELETE')
  })
}

// ---------- products ----------

export async function listProducts(workspaceId: string, includeDeleted = false): Promise<Product[]> {
  const rows = await getDb().products.where('workspace_id').equals(workspaceId).toArray()
  return rows.filter((p) => includeDeleted || !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getProduct(id: string): Promise<Product | null> {
  return (await getDb().products.get(id)) ?? null
}

export async function saveProduct(workspaceId: string, input: Partial<Product> & { name: string }): Promise<Product> {
  const db = getDb()
  const deviceId = getDeviceId()
  const existing = input.id ? await db.products.get(input.id) : undefined
  const record: Product = existing
    ? { ...existing, ...withoutBlankId(input), ...metaFields(existing) }
    : {
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        sku: null,
        hsn_sac: null,
        description: null,
        unit: 'NOS',
        selling_price_paise: 0,
        cost_price_paise: null,
        gst_rate_bps: 1800,
        price_includes_tax: null,
        active: true,
        ...withoutBlankId(input),
        ...baseMeta(deviceId),
        ...metaFields(),
      }
  record.sync_state = 'pending'
  await db.transaction('rw', db.products, db.sync_operations, db.audit_logs, async () => {
    await db.products.put(record)
    await enqueueOp(db, workspaceId, 'product', record.id, 'upsert', existing?.version ?? 0, record)
    await addAudit(db, workspaceId, 'product', record.id, existing ? 'UPDATE' : 'CREATE')
  })
  return record
}

export async function softDeleteProduct(workspaceId: string, id: string): Promise<void> {
  const db = getDb()
  const existing = await db.products.get(id)
  if (!existing) return
  const record: Product = { ...existing, deleted_at: nowIso(), ...metaFields(existing) }
  record.sync_state = 'pending'
  await db.transaction('rw', db.products, db.sync_operations, db.audit_logs, async () => {
    await db.products.put(record)
    await enqueueOp(db, workspaceId, 'product', id, 'delete', existing.version, record)
    await addAudit(db, workspaceId, 'product', id, 'DELETE')
  })
}

// ---------- sequences ----------

/** Resolve the stored number pattern for a document type from the workspace's company profile (null → default layout). */
async function docPatternFor(db: DB, workspaceId: string, docType: 'INVOICE' | 'QUOTATION'): Promise<string | null> {
  const company = await db.company_profiles.where('workspace_id').equals(workspaceId).filter((c) => !c.deleted_at).first()
  const raw = docType === 'INVOICE' ? company?.invoice_number_pattern : company?.quotation_number_pattern
  const p = (raw ?? '').trim()
  return p && docPatternError(p) === null ? p : null
}

export async function allocateLocalNumber(
  db: DB,
  workspaceId: string,
  docType: 'INVOICE' | 'QUOTATION',
  prefix: string,
  onDate: string,
): Promise<string> {
  const fy = fiscalYearOf(onDate)
  const key = sequenceKey(workspaceId, docType, fy)
  const existing = await db.document_sequences.get(key)
  const nextSeq = (existing?.next_seq ?? 1)
  // The company's custom pattern (if configured) shapes the visible number; the
  // per-fiscal-year sequence itself is unchanged, so switching layouts is safe mid-year.
  const pattern = await docPatternFor(db, workspaceId, docType)
  const number = renderDocNumber(pattern, { prefix, fiscalYear: fy, seq: nextSeq, onDate })
  await db.document_sequences.put({
    id: key,
    workspace_id: workspaceId,
    doc_type: docType,
    fiscal_year: fy,
    next_seq: nextSeq + 1,
  })
  return number
}

/** Read-only preview of the next document number (no sequence mutation — used by My Company).
 *  `patternOverride` lets the form preview a typed pattern before it is saved. */
export async function peekNextNumber(
  db: DB,
  workspaceId: string,
  docType: 'INVOICE' | 'QUOTATION',
  prefix: string,
  onDate: string,
  patternOverride?: string | null,
): Promise<string> {
  const fy = fiscalYearOf(onDate)
  const existing = await db.document_sequences.get(sequenceKey(workspaceId, docType, fy))
  const pattern = patternOverride !== undefined ? patternOverride : await docPatternFor(db, workspaceId, docType)
  return renderDocNumber(pattern, { prefix, fiscalYear: fy, seq: existing?.next_seq ?? 1, onDate })
}

// ---------- invoices ----------

export interface InvoicePayloadInput {
  customer_id: string
  invoice_date: string
  due_date: string | null
  place_of_supply_code: string | null
  price_includes_tax: boolean
  items: DocItemInput[]
  charges: DocCharge[]
  notes: string | null
  terms: string | null
}

function buildItemRows(
  kind: 'invoice' | 'quotation',
  docId: string,
  workspaceId: string,
  items: DocItemInput[],
  priceIncludesTax: boolean,
  supplierStateCode: string | null,
  placeOfSupplyCode: string | null,
): { invoice_items?: InvoiceItem[]; quotation_items?: QuotationItem[] } {
  const totals = computeDocumentTotals({ items, charges: [], price_includes_tax: priceIncludesTax, supplier_state_code: supplierStateCode, place_of_supply_code: placeOfSupplyCode, enable_round_off: false })
  return {
    [kind === 'invoice' ? 'invoice_items' : 'quotation_items']: totals.lines.map((line, idx) => ({
      id: line.item.id,
      [kind === 'invoice' ? 'invoice_id' : 'quotation_id']: docId,
      workspace_id: workspaceId,
      position: idx + 1,
      description: line.item.description,
      hsn_sac: line.item.hsn_sac ?? null,
      qty_milli: line.item.qty_milli,
      unit: line.item.unit ?? null,
      unit_price_paise: line.item.unit_price_paise,
      discount_bps: line.item.discount_bps,
      gst_rate_bps: line.item.gst_rate_bps,
      gross_paise: line.gross_paise,
      discount_paise: line.discount_paise,
      taxable_paise: line.taxable_paise,
      cgst_paise: line.cgst_paise,
      sgst_paise: line.sgst_paise,
      igst_paise: line.igst_paise,
      tax_paise: line.tax_paise,
      total_paise: line.total_paise,
      price_includes_tax: priceIncludesTax,
    })),
  } as { invoice_items?: InvoiceItem[]; quotation_items?: QuotationItem[] }
}

function docHeaderFromInput(
  workspaceId: string,
  supplierStateCode: string | null,
  input: InvoicePayloadInput,
  compute: ReturnType<typeof computeDocumentTotals>,
) {
  return {
    place_of_supply_code: input.place_of_supply_code,
    tax_mode: resolveTaxMode(supplierStateCode, input.place_of_supply_code),
    price_includes_tax: input.price_includes_tax,
    subtotal_gross_paise: compute.subtotal_gross_paise,
    discount_total_paise: compute.discount_total_paise,
    taxable_total_paise: compute.taxable_total_paise,
    cgst_paise: compute.cgst_paise,
    sgst_paise: compute.sgst_paise,
    igst_paise: compute.igst_paise,
    charges_total_paise: compute.charges_total_paise,
    charges_tax_paise: compute.charges_tax_paise,
    round_off_paise: compute.round_off_paise,
    grand_total_paise: compute.grand_total_paise,
    notes: input.notes,
    terms: input.terms,
    workspace_id: workspaceId,
  }
}

export async function saveInvoiceDraft(
  workspaceId: string,
  supplierStateCode: string | null,
  companyDefaults: { price_includes_tax: boolean; enable_round_off: boolean },
  input: InvoicePayloadInput & { id?: string },
): Promise<InvoiceRow> {
  const db = getDb()
  const deviceId = getDeviceId()
  const existing = input.id ? await db.invoices.get(input.id) : undefined
  if (existing && existing.status !== 'DRAFT') {
    throw new Error('Only draft invoices can be edited')
  }
  const compute = computeDocumentTotals({
    items: input.items,
    charges: input.charges,
    price_includes_tax: input.price_includes_tax,
    supplier_state_code: supplierStateCode,
    place_of_supply_code: input.place_of_supply_code,
    enable_round_off: companyDefaults.enable_round_off,
  })
  const header = docHeaderFromInput(workspaceId, supplierStateCode, input, compute)
  const id = existing?.id ?? crypto.randomUUID()
  const record: InvoiceRow = {
    id,
    number: existing?.number ?? provisionalNumber(),
    status: existing?.status ?? 'DRAFT',
    invoice_date: input.invoice_date,
    due_date: input.due_date ?? null,
    customer_id: input.customer_id,
    customer_name_snapshot: existing?.customer_name_snapshot ?? null,
    customer_gstin_snapshot: existing?.customer_gstin_snapshot ?? null,
    source_quotation_id: existing?.source_quotation_id ?? null,
    finalized_at: null,
    cancelled_at: null,
    paid_total_paise: existing?.paid_total_paise ?? 0,
    charges_json: chargesToJson(input.charges),
    ...header,
    created_at: existing?.created_at ?? nowIso(),
    deleted_at: null,
    sync_state: 'pending',
    origin_device_id: deviceId,
    version: (existing?.version ?? 0) + 1,
    updated_at: nowIso(),
  }
  const finalRecord = record as InvoiceRow
  const itemRows = buildItemRows('invoice', id, workspaceId, input.items, input.price_includes_tax, supplierStateCode, input.place_of_supply_code).invoice_items!

  await db.transaction('rw', db.invoices, db.invoice_items, db.customers, db.sync_operations, db.audit_logs, async () => {
    const customer = await db.customers.get(input.customer_id)
    if (customer) {
      finalRecord.customer_name_snapshot = customer.business_name
      finalRecord.customer_gstin_snapshot = customer.gstin
    }
    await db.invoices.put(finalRecord)
    await db.invoice_items.where('invoice_id').equals(id).delete()
    await db.invoice_items.bulkPut(itemRows)
    await enqueueOp(db, workspaceId, 'invoice', id, 'upsert', existing?.version ?? 0, { ...finalRecord, items: itemRows })
    await addAudit(db, workspaceId, 'invoice', id, existing ? 'UPDATE' : 'CREATE', { number: finalRecord.number })
  })
  return finalRecord
}

/** Finalize a draft invoice: allocates the official number (offline rule, CANON §6) and locks the document. */
export async function finalizeInvoice(workspaceId: string, invoicePrefix: string, id: string): Promise<Invoice> {
  const db = getDb()
  let finalized: InvoiceRow | null = null
  await db.transaction('rw', [db.invoices, db.invoice_items, db.company_profiles, db.document_sequences, db.sync_operations, db.audit_logs], async () => {
    const inv = await db.invoices.get(id)
    if (!inv) throw new Error('Invoice not found')
    if (inv.status !== 'DRAFT') throw new Error('Only draft invoices can be finalized')
    const items = await db.invoice_items.where('invoice_id').equals(id).toArray()
    if (items.length === 0) throw new Error('Add at least one line item before finalizing')
    const number = isProvisionalNumber(inv.number)
      ? await allocateLocalNumber(db, workspaceId, 'INVOICE', invoicePrefix, inv.invoice_date)
      : inv.number
    const record: InvoiceRow = {
      ...inv,
      number,
      status: 'FINALIZED',
      finalized_at: nowIso(),
      ...metaFields(inv),
    }
    record.sync_state = 'pending'
    await db.invoices.put(record)
    await enqueueOp(db, workspaceId, 'invoice', id, 'finalize', inv.version, { ...record, items })
    await addAudit(db, workspaceId, 'invoice', id, 'FINALIZE', { number })
    finalized = record
  })
  if (!finalized) throw new Error('Finalize failed')
  return finalized
}

export async function cancelInvoice(workspaceId: string, id: string): Promise<InvoiceRow> {
  const db = getDb()
  let cancelled: InvoiceRow | null = null
  await db.transaction('rw', db.invoices, db.payments, db.sync_operations, db.audit_logs, async () => {
    const inv = await db.invoices.get(id)
    if (!inv) throw new Error('Invoice not found')
    if (inv.status !== 'FINALIZED' && inv.status !== 'PARTIALLY_PAID') {
      throw new Error('Only finalized invoices can be cancelled')
    }
    if (inv.paid_total_paise > 0) {
      throw new Error('Invoices with recorded payments cannot be cancelled')
    }
    const record: InvoiceRow = { ...inv, status: 'CANCELLED', cancelled_at: nowIso(), ...metaFields(inv) }
    record.sync_state = 'pending'
    await db.invoices.put(record)
    await enqueueOp(db, workspaceId, 'invoice', id, 'cancel', inv.version, record)
    await addAudit(db, workspaceId, 'invoice', id, 'CANCEL', { number: inv.number })
    cancelled = record
  })
  if (!cancelled) throw new Error('Cancel failed')
  return cancelled
}

export async function softDeleteInvoiceDraft(workspaceId: string, id: string): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.invoices, db.sync_operations, db.audit_logs, async () => {
    const inv = await db.invoices.get(id)
    if (!inv) throw new Error('Invoice not found')
    if (inv.status !== 'DRAFT') throw new Error('Only draft invoices can be deleted')
    const record: InvoiceRow = { ...inv, deleted_at: nowIso(), ...metaFields(inv) }
    record.sync_state = 'pending'
    await db.invoices.put(record)
    await enqueueOp(db, workspaceId, 'invoice', id, 'delete', inv.version, record)
    await addAudit(db, workspaceId, 'invoice', id, 'DELETE', { number: inv.number })
  })
}

export async function getInvoice(id: string): Promise<{ invoice: InvoiceRow; items: InvoiceItem[] } | null> {
  const db = getDb()
  const invoice = await db.invoices.get(id)
  if (!invoice) return null
  const items = (await db.invoice_items.where('invoice_id').equals(id).toArray()).sort((a, b) => a.position - b.position)
  return { invoice, items }
}

export async function listInvoices(workspaceId: string, includeDeleted = false): Promise<InvoiceRow[]> {
  const rows = await getDb().invoices.where('workspace_id').equals(workspaceId).toArray()
  return rows
    .filter((i) => includeDeleted || !i.deleted_at)
    .sort((a, b) => (b.invoice_date + b.number).localeCompare(a.invoice_date + a.number))
}

export async function listInvoiceItems(workspaceId: string): Promise<InvoiceItem[]> {
  return getDb().invoice_items.where('workspace_id').equals(workspaceId).toArray()
}

/** Recompute paid_total + status after a payment mutation (trusted local rule; server mirrors it). */
export async function recalcInvoiceAfterPayment(db: DB, invoiceId: string): Promise<void> {
  const inv = await db.invoices.get(invoiceId)
  if (!inv) return
  const payments = await db.payments.where('invoice_id').equals(invoiceId).toArray()
  const paid = payments.filter((p) => !p.deleted_at).reduce((s, p) => s + p.amount_paise, 0)
  let status = inv.status
  if (inv.status === 'FINALIZED' || inv.status === 'PARTIALLY_PAID' || inv.status === 'PAID') {
    status = paid === 0 ? 'FINALIZED' : paid >= inv.grand_total_paise ? 'PAID' : 'PARTIALLY_PAID'
  }
  // Local projection only: the server applies the same trusted recalculation when the
  // payment op lands, then publishes the invoice change in the pull feed (CANON §9).
  // No version bump / outbox op here — that would desync finalize ordering.
  await db.invoices.update(invoiceId, { paid_total_paise: paid, status } as never)
}

// ---------- payments ----------

export type PaymentOpInput = Pick<Payment, 'invoice_id' | 'amount_paise' | 'paid_at' | 'method'> & {
  id?: string
  reference?: string | null
  notes?: string | null
}

export async function recordPayment(workspaceId: string, input: PaymentOpInput, invoiceBalancePaise: number): Promise<Payment> {
  const db = getDb()
  if (input.amount_paise <= 0) throw new Error('Payment amount must be greater than zero')
  if (input.amount_paise > invoiceBalancePaise) {
    throw new Error('Payment exceeds the invoice balance')
  }
  const deviceId = getDeviceId()
  let saved: Payment | null = null
  await db.transaction('rw', db.payments, db.invoices, db.invoice_items, db.sync_operations, db.audit_logs, async () => {
    const record: Payment = {
      id: input.id ?? crypto.randomUUID(),
      workspace_id: workspaceId,
      invoice_id: input.invoice_id,
      amount_paise: input.amount_paise,
      paid_at: input.paid_at,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      ...baseMeta(deviceId),
      created_at: nowIso(),
      updated_at: nowIso(),
      version: 1,
    }
    record.sync_state = 'pending'
    await db.payments.put(record)
    await recalcInvoiceAfterPayment(db, input.invoice_id)
    await enqueueOp(db, workspaceId, 'payment', record.id, 'upsert', 0, record)
    await addAudit(db, workspaceId, 'payment', record.id, 'PAYMENT', { invoice_id: input.invoice_id, amount_paise: input.amount_paise })
    saved = record
  })
  if (!saved) throw new Error('Payment failed')
  return saved
}

export async function listPayments(workspaceId: string): Promise<Payment[]> {
  const rows = await getDb().payments.where('workspace_id').equals(workspaceId).toArray()
  return rows.filter((p) => !p.deleted_at).sort((a, b) => b.paid_at.localeCompare(a.paid_at))
}

// ---------- quotations ----------

export interface QuotationPayloadInput {
  customer_id: string
  quotation_date: string
  valid_until: string | null
  place_of_supply_code: string | null
  price_includes_tax: boolean
  items: DocItemInput[]
  charges: DocCharge[]
  notes: string | null
  terms: string | null
}

export async function saveQuotationDraft(
  workspaceId: string,
  supplierStateCode: string | null,
  companyDefaults: { enable_round_off: boolean },
  input: QuotationPayloadInput & { id?: string },
): Promise<QuotationRow> {
  const db = getDb()
  const deviceId = getDeviceId()
  const existing = input.id ? await db.quotations.get(input.id) : undefined
  if (existing && existing.status !== 'DRAFT') {
    throw new Error('Only draft quotations can be edited')
  }
  const compute = computeDocumentTotals({
    items: input.items,
    charges: input.charges,
    price_includes_tax: input.price_includes_tax,
    supplier_state_code: supplierStateCode,
    place_of_supply_code: input.place_of_supply_code,
    enable_round_off: companyDefaults.enable_round_off,
  })
  const header = docHeaderFromInput(workspaceId, supplierStateCode, { ...input, invoice_date: input.quotation_date, due_date: null }, compute)
  const id = existing?.id ?? crypto.randomUUID()
  const record: QuotationRow = {
    id,
    number: existing?.number ?? provisionalNumber(),
    status: existing?.status ?? 'DRAFT',
    quotation_date: input.quotation_date,
    valid_until: input.valid_until ?? null,
    customer_id: input.customer_id,
    customer_name_snapshot: existing?.customer_name_snapshot ?? null,
    customer_gstin_snapshot: existing?.customer_gstin_snapshot ?? null,
    converted_invoice_id: null,
    finalized_at: null,
    charges_json: chargesToJson(input.charges),
    ...header,
    created_at: existing?.created_at ?? nowIso(),
    deleted_at: null,
    sync_state: 'pending',
    origin_device_id: deviceId,
    version: (existing?.version ?? 0) + 1,
    updated_at: nowIso(),
  }
  const itemRows = buildItemRows('quotation', id, workspaceId, input.items, input.price_includes_tax, supplierStateCode, input.place_of_supply_code).quotation_items!
  await db.transaction('rw', db.quotations, db.quotation_items, db.customers, db.sync_operations, db.audit_logs, async () => {
    const customer = await db.customers.get(input.customer_id)
    if (customer) {
      record.customer_name_snapshot = customer.business_name
      record.customer_gstin_snapshot = customer.gstin
    }
    await db.quotations.put(record)
    await db.quotation_items.where('quotation_id').equals(id).delete()
    await db.quotation_items.bulkPut(itemRows)
    await enqueueOp(db, workspaceId, 'quotation', id, 'upsert', existing?.version ?? 0, { ...record, items: itemRows })
    await addAudit(db, workspaceId, 'quotation', id, existing ? 'UPDATE' : 'CREATE', { number: record.number })
  })
  return record
}

export async function setQuotationStatus(
  workspaceId: string,
  id: string,
  status: Quotation['status'],
  quotationPrefix?: string,
): Promise<QuotationRow> {
  const db = getDb()
  let updated: QuotationRow | null = null
  await db.transaction('rw', [db.quotations, db.quotation_items, db.company_profiles, db.document_sequences, db.sync_operations, db.audit_logs], async () => {
    const q = await db.quotations.get(id)
    if (!q) throw new Error('Quotation not found')
    const allowed: Record<Quotation['status'], Quotation['status'][]> = {
      DRAFT: ['SENT'],
      SENT: ['ACCEPTED', 'REJECTED'],
      ACCEPTED: [],
      REJECTED: [],
      EXPIRED: [],
      CONVERTED: [],
    }
    if (!allowed[q.status]?.includes(status)) {
      throw new Error(`Cannot change quotation from ${q.status} to ${status}`)
    }
    // Official number is allocated when the quotation leaves the draft state (CANON §6).
    let number = q.number
    if (status === 'SENT' && isProvisionalNumber(q.number)) {
      let prefix = quotationPrefix
      if (!prefix) {
        const company = await db.company_profiles.where('workspace_id').equals(workspaceId).filter((c) => !c.deleted_at).first()
        prefix = company?.quotation_prefix ?? 'QT'
      }
      number = await allocateLocalNumber(db, workspaceId, 'QUOTATION', prefix, q.quotation_date)
    }
    const record: QuotationRow = { ...q, number, status, ...metaFields(q) }
    record.sync_state = 'pending'
    await db.quotations.put(record)
    // Status transitions must be flagged: the server's dedicated transition branch validates
    // the lifecycle step and preserves items — an unflagged upsert would be treated as a
    // content edit and recompute would force the status back to DRAFT (then pull reverts us).
    // The payload carries the possibly-newly-allocated official number (CANON §6 fast-forward).
    await enqueueOp(db, workspaceId, 'quotation', id, 'upsert', q.version, { ...record, status_change: true })
    await addAudit(db, workspaceId, 'quotation', id, 'STATUS', { from: q.status, to: status })
    updated = record
  })
  if (!updated) throw new Error('Status change failed')
  return updated
}

export async function getQuotation(id: string): Promise<{ quotation: QuotationRow; items: QuotationItem[] } | null> {
  const db = getDb()
  const quotation = await db.quotations.get(id)
  if (!quotation) return null
  const items = (await db.quotation_items.where('quotation_id').equals(id).toArray()).sort((a, b) => a.position - b.position)
  return { quotation, items }
}

export async function listQuotations(workspaceId: string, includeDeleted = false): Promise<QuotationRow[]> {
  const rows = await getDb().quotations.where('workspace_id').equals(workspaceId).toArray()
  return rows
    .filter((q) => includeDeleted || !q.deleted_at)
    .sort((a, b) => (b.quotation_date + b.number).localeCompare(a.quotation_date + a.number))
}

export async function listQuotationItems(workspaceId: string): Promise<QuotationItem[]> {
  return getDb().quotation_items.where('workspace_id').equals(workspaceId).toArray()
}

/** Convert an ACCEPTED quotation into a draft invoice (CANON §12 conversion flow). */
export async function convertQuotationToInvoice(
  workspaceId: string,
  supplierStateCode: string | null,
  companyDefaults: { enable_round_off: boolean },
  quotationId: string,
): Promise<{ invoice: InvoiceRow; quotation: QuotationRow }> {
  const db = getDb()
  let result: { invoice: InvoiceRow; quotation: QuotationRow } | null = null
  await db.transaction(
    'rw',
    [db.quotations, db.quotation_items, db.invoices, db.invoice_items, db.customers, db.sync_operations, db.audit_logs],
    async () => {
      const q = await db.quotations.get(quotationId)
      if (!q) throw new Error('Quotation not found')
      if (q.status !== 'ACCEPTED') throw new Error('Only ACCEPTED quotations can be converted to invoices')
      const items = await db.quotation_items.where('quotation_id').equals(quotationId).toArray()
      if (items.length === 0) throw new Error('Quotation has no line items')

      const charges = chargesFromJson(q.charges_json)
      const invoiceId = crypto.randomUUID()
      const itemInputs: DocItemInput[] = items.map((it) => ({
        id: it.id,
        description: it.description,
        hsn_sac: it.hsn_sac,
        qty_milli: it.qty_milli,
        unit: it.unit,
        unit_price_paise: it.unit_price_paise,
        discount_bps: it.discount_bps,
        gst_rate_bps: it.gst_rate_bps,
      }))
      const compute = computeDocumentTotals({
        items: itemInputs,
        charges,
        price_includes_tax: q.price_includes_tax,
        supplier_state_code: supplierStateCode,
        place_of_supply_code: q.place_of_supply_code,
        enable_round_off: companyDefaults.enable_round_off,
      })
      const header = docHeaderFromInput(workspaceId, supplierStateCode, {
        customer_id: q.customer_id,
        invoice_date: todayStr(),
        due_date: null,
        place_of_supply_code: q.place_of_supply_code,
        price_includes_tax: q.price_includes_tax,
        items: itemInputs,
        charges,
        notes: q.notes,
        terms: q.terms,
      }, compute)
      const invoice: InvoiceRow = {
        id: invoiceId,
        number: provisionalNumber(),
        status: 'DRAFT',
        invoice_date: todayStr(),
        due_date: null,
        customer_id: q.customer_id,
        customer_name_snapshot: q.customer_name_snapshot,
        customer_gstin_snapshot: q.customer_gstin_snapshot,
        source_quotation_id: quotationId,
        finalized_at: null,
        cancelled_at: null,
        paid_total_paise: 0,
        charges_json: chargesToJson(charges),
        ...header,
        created_at: nowIso(),
        deleted_at: null,
        sync_state: 'pending',
        origin_device_id: getDeviceId(),
        version: 1,
        updated_at: nowIso(),
      }
      const invoiceItemRows: InvoiceItem[] = items.map((it, idx) => ({
        id: crypto.randomUUID(),
        invoice_id: invoiceId,
        workspace_id: workspaceId,
        position: idx + 1,
        description: it.description,
        hsn_sac: it.hsn_sac,
        qty_milli: it.qty_milli,
        unit: it.unit,
        unit_price_paise: it.unit_price_paise,
        discount_bps: it.discount_bps,
        gst_rate_bps: it.gst_rate_bps,
        gross_paise: it.gross_paise,
        discount_paise: it.discount_paise,
        taxable_paise: it.taxable_paise,
        cgst_paise: it.cgst_paise,
        sgst_paise: it.sgst_paise,
        igst_paise: it.igst_paise,
        tax_paise: it.tax_paise,
        total_paise: it.total_paise,
        price_includes_tax: it.price_includes_tax,
      }))
      const qRow: QuotationRow = {
        ...q,
        status: 'CONVERTED',
        converted_invoice_id: invoiceId,
        ...metaFields(q),
      }
      qRow.sync_state = 'pending'
      await db.invoices.put(invoice)
      await db.invoice_items.bulkPut(invoiceItemRows)
      await db.quotations.put(qRow)
      await enqueueOp(db, workspaceId, 'invoice', invoiceId, 'upsert', 1, { ...invoice, items: invoiceItemRows })
      await enqueueOp(db, workspaceId, 'quotation', quotationId, 'upsert', q.version, { ...qRow, items })
      await addAudit(db, workspaceId, 'quotation', quotationId, 'CONVERT', { invoice_id: invoiceId })
      await addAudit(db, workspaceId, 'invoice', invoiceId, 'CREATE', { source_quotation_id: quotationId })
      result = { invoice, quotation: qRow }
    },
  )
  if (!result) throw new Error('Conversion failed')
  return result
}

export async function softDeleteQuotationDraft(workspaceId: string, id: string): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.quotations, db.quotation_items, db.sync_operations, db.audit_logs, async () => {
    const q = await db.quotations.get(id)
    if (!q) throw new Error('Quotation not found')
    if (q.status !== 'DRAFT') throw new Error('Only draft quotations can be deleted')
    const record: QuotationRow = { ...q, deleted_at: nowIso(), ...metaFields(q) }
    record.sync_state = 'pending'
    await db.quotations.put(record)
    await enqueueOp(db, workspaceId, 'quotation', id, 'delete', q.version, record)
    await addAudit(db, workspaceId, 'quotation', id, 'DELETE', { number: q.number })
  })
}

// ---------- audit ----------

export async function listAuditForEntity(workspaceId: string, entityType: string, entityId: string): Promise<AuditLog[]> {
  const rows = await getDb().audit_logs.where('[entity_type+entity_id]').equals([entityType, entityId]).toArray()
  return rows.filter((a) => a.workspace_id === workspaceId).sort((a, b) => b.at.localeCompare(a.at))
}

export async function listRecentAudit(workspaceId: string, limit = 20): Promise<AuditLog[]> {
  const rows = await getDb().audit_logs.where('workspace_id').equals(workspaceId).toArray()
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

// Re-export for convenience
export { computeLine }
