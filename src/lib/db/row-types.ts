// InvoiceFlow — Dexie row types: domain entities with charges serialized as JSON strings
import type { DocCharge, CompanyProfile, Customer, Invoice, InvoiceItem, Payment, Product, Quotation, QuotationItem, TaxRate, Workspace, WorkspaceMember, DocumentSequence, AuditLog, SyncOperation, SyncMetadata } from '@/lib/domain/types'

type WithChargesJson<T> = Omit<T, 'charges'> & { charges_json: string }

export type WorkspaceRow = Workspace
export type WorkspaceMemberRow = WorkspaceMember
export type CompanyProfileRow = CompanyProfile
export type CustomerRow = Customer
export type ProductRow = Product
export type QuotationRow = WithChargesJson<Quotation>
export type QuotationItemRow = QuotationItem
export type InvoiceRow = WithChargesJson<Invoice>
export type InvoiceItemRow = InvoiceItem
export type PaymentRow = Payment
export type TaxRateRow = TaxRate
export type DocumentSequenceRow = DocumentSequence
export type AuditLogRow = AuditLog
export type SyncOperationRow = SyncOperation
export type SyncMetadataRow = SyncMetadata
export type AppSettingsRow = { key: string; value: string }

export function chargesToJson(charges: DocCharge[] | undefined | null): string {
  return JSON.stringify(charges ?? [])
}

export function chargesFromJson(json: string | undefined | null): DocCharge[] {
  try {
    const parsed = JSON.parse(json || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
