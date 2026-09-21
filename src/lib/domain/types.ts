// InvoiceFlow — Core entity types (CANON §7)
// All money amounts are integer paise. Quantities are integer milli-units.
// Rates are basis points. Financial dates are 'YYYY-MM-DD' strings.

export type SyncState = 'local' | 'pending' | 'synced' | 'failed' | 'conflict'
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'

export interface SyncMeta {
  id: string
  workspace_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  version: number
  sync_state: SyncState
  origin_device_id: string
}

export interface Workspace extends SyncMeta {
  name: string
  slug: string
  owner_user_id: string | null
  cloud_linked_at: string | null // local-only flag: workspace attached to an account
}

export interface WorkspaceMember extends SyncMeta {
  user_id: string | null
  device_id: string | null
  role: WorkspaceRole
}

export interface CompanyProfile extends SyncMeta {
  name: string
  business_type: string | null
  logo_data: string | null // dataURL ≤ 1MB PNG/JPEG
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_name: string | null
  state_code: string | null
  pincode: string | null
  gstin: string | null
  pan: string | null
  phone: string | null
  email: string | null
  website: string | null
  bank_name: string | null
  bank_account: string | null
  bank_ifsc: string | null
  bank_branch: string | null
  authorized_signatory: string | null
  signature_data: string | null
  invoice_prefix: string
  quotation_prefix: string
  default_gst_rate_bps: number
  price_includes_tax: boolean
  enable_round_off: boolean
  default_terms: string | null
  default_notes: string | null
}

export interface Customer extends SyncMeta {
  code: string | null
  type: 'BUSINESS' | 'INDIVIDUAL'
  business_name: string
  contact_person: string | null
  email: string | null
  phone: string | null
  gstin: string | null
  billing_address: string | null
  shipping_address: string | null
  state_name: string | null
  state_code: string | null
  notes: string | null
}

export interface Product extends SyncMeta {
  name: string
  sku: string | null
  hsn_sac: string | null
  description: string | null
  unit: string
  selling_price_paise: number
  cost_price_paise: number | null
  gst_rate_bps: number
  price_includes_tax: boolean | null // null → use company default
  active: boolean
}

export type DocumentStatus =
  | 'DRAFT'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CONVERTED' // quotation
  | 'FINALIZED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED' // invoice

export type TaxMode = 'INTRA' | 'INTER'

export interface DocCharge {
  id: string
  label: string
  amount_paise: number
  taxable: boolean
  gst_rate_bps: number
}

export interface Quotation extends SyncMeta {
  number: string
  status: Extract<DocumentStatus, 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED'>
  quotation_date: string
  valid_until: string | null
  customer_id: string
  customer_name_snapshot: string | null
  customer_gstin_snapshot: string | null
  place_of_supply_code: string | null
  tax_mode: TaxMode
  price_includes_tax: boolean
  subtotal_gross_paise: number
  discount_total_paise: number
  taxable_total_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  charges_total_paise: number
  charges_tax_paise: number
  round_off_paise: number
  grand_total_paise: number
  charges: DocCharge[] // stored as JSON string in Dexie serialization-friendly form
  notes: string | null
  terms: string | null
  converted_invoice_id: string | null
  finalized_at: string | null
}

export interface DocumentItem {
  id: string
  position: number
  description: string
  hsn_sac: string | null
  qty_milli: number
  unit: string | null
  unit_price_paise: number
  discount_bps: number
  gst_rate_bps: number
  gross_paise: number
  discount_paise: number
  taxable_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  tax_paise: number
  total_paise: number
  price_includes_tax: boolean
}

export interface QuotationItem extends DocumentItem {
  quotation_id: string
}

export interface Invoice extends SyncMeta {
  number: string
  status: Extract<DocumentStatus, 'DRAFT' | 'FINALIZED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED'>
  invoice_date: string
  due_date: string | null
  customer_id: string
  customer_name_snapshot: string | null
  customer_gstin_snapshot: string | null
  place_of_supply_code: string | null
  tax_mode: TaxMode
  price_includes_tax: boolean
  subtotal_gross_paise: number
  discount_total_paise: number
  taxable_total_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  charges_total_paise: number
  charges_tax_paise: number
  round_off_paise: number
  grand_total_paise: number
  paid_total_paise: number
  charges: DocCharge[]
  notes: string | null
  terms: string | null
  source_quotation_id: string | null
  finalized_at: string | null
  cancelled_at: string | null
}

export interface InvoiceItem extends DocumentItem {
  invoice_id: string
}

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'CARD' | 'OTHER'

export interface Payment extends SyncMeta {
  invoice_id: string
  amount_paise: number
  paid_at: string // YYYY-MM-DD
  method: PaymentMethod
  reference: string | null
  notes: string | null
}

export interface TaxRate extends SyncMeta {
  name: string
  rate_bps: number
  active: boolean
  effective_from: string | null
}

export interface DocumentSequence {
  id: string // `${workspace_id}:${doc_type}:${fiscal_year}`
  workspace_id: string
  doc_type: 'INVOICE' | 'QUOTATION'
  fiscal_year: string
  next_seq: number
}

export interface Attachment extends SyncMeta {
  entity_type: string
  entity_id: string
  filename: string
  mime: string
  size_bytes: number
  data: string | null // inline dataURL for small assets (MVP)
}

export interface AuditLog {
  id: string
  workspace_id: string
  entity_type: string
  entity_id: string
  action: 'CREATE' | 'UPDATE' | 'FINALIZE' | 'CONVERT' | 'CANCEL' | 'PAYMENT' | 'DELETE' | 'SYNC_CONFLICT' | 'STATUS'
  detail: string | null
  device_id: string
  at: string
}

export type SyncOpAction = 'upsert' | 'finalize' | 'cancel' | 'delete'
export type SyncOpStatus = 'pending' | 'in_flight' | 'done' | 'failed' | 'conflict'
export type SyncEntity = 'invoice' | 'quotation' | 'customer' | 'product' | 'company' | 'payment' | 'workspace'

export interface SyncOperation {
  id: string // op_id (idempotency key)
  workspace_id: string
  entity: SyncEntity
  entity_id: string
  action: SyncOpAction
  base_version: number
  payload: unknown // full record (items embedded for documents)
  server_record: unknown | null // set when status = conflict
  status: SyncOpStatus
  attempts: number
  last_error: string | null
  next_attempt_at: string | null
  created_at: string
}

export interface SyncMetadata {
  workspace_id: string // primary key
  pull_cursor: number
  last_sync_at: string | null
  last_sync_error: string | null
}

// ---- Session / auth (dev cloud) ----

export interface SessionUser {
  id: string
  email: string
  name: string | null
}
