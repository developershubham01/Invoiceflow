// InvoiceFlow — Unified document model (CANON §13)
// One model drives preview AND PDF export; totals come exclusively from the domain engine.

import type { DocCharge, InvoiceItem, QuotationItem, TaxMode } from '@/lib/domain/types'
import type { CompanyProfile } from '@/lib/domain/types'
import { chargesFromJson, type InvoiceRow, type QuotationRow } from '@/lib/db/row-types'

export interface UnifiedDocumentModel {
  kind: 'INVOICE' | 'QUOTATION'
  number: string
  status: string
  date: string
  dueDate: string | null
  validUntil: string | null
  company: {
    name: string
    gstin: string | null
    pan: string | null
    addressLines: string[]
    phone: string | null
    email: string | null
    logoData: string | null
    signatureData: string | null
    authorizedSignatory: string | null
    bank: { name: string; account: string; ifsc: string; branch: string } | null
  }
  customer: {
    name: string
    gstin: string | null
    addressLines: string[]
    stateName: string | null
  }
  placeOfSupply: string
  taxMode: TaxMode
  priceIncludesTax: boolean
  items: Array<{
    position: number
    description: string
    hsnSac: string | null
    qtyMilli: number
    unit: string | null
    unitPricePaise: number
    discountBps: number
    gstRateBps: number
    grossPaise: number
    discountPaise: number
    taxablePaise: number
    cgstPaise: number
    sgstPaise: number
    igstPaise: number
    taxPaise: number
    totalPaise: number
    priceIncludesTax: boolean
  }>
  charges: DocCharge[]
  totals: {
    subtotalGrossPaise: number
    discountTotalPaise: number
    taxableTotalPaise: number
    cgstPaise: number
    sgstPaise: number
    igstPaise: number
    chargesTotalPaise: number
    chargesTaxPaise: number
    roundOffPaise: number
    grandTotalPaise: number
    paidTotalPaise?: number
  }
  notes: string | null
  terms: string | null
}

export function buildInvoiceModel(
  invoice: InvoiceRow,
  items: InvoiceItem[],
  company: CompanyProfile | null,
  customer?: { billing_address: string | null; shipping_address: string | null; state_name: string | null } | null,
): UnifiedDocumentModel {
  return {
    kind: 'INVOICE',
    number: invoice.number,
    status: invoice.status,
    date: invoice.invoice_date,
    dueDate: invoice.due_date,
    validUntil: null,
    company: toCompanyModel(company),
    customer: {
      name: invoice.customer_name_snapshot ?? 'Customer',
      gstin: invoice.customer_gstin_snapshot,
      addressLines: splitLines(customer?.billing_address),
      stateName: customer?.state_name ?? null,
    },
    placeOfSupply: invoice.place_of_supply_code ?? '—',
    taxMode: invoice.tax_mode,
    priceIncludesTax: invoice.price_includes_tax,
    items: items.map((it) => ({
      position: it.position,
      description: it.description,
      hsnSac: it.hsn_sac,
      qtyMilli: it.qty_milli,
      unit: it.unit,
      unitPricePaise: it.unit_price_paise,
      discountBps: it.discount_bps,
      gstRateBps: it.gst_rate_bps,
      grossPaise: it.gross_paise,
      discountPaise: it.discount_paise,
      taxablePaise: it.taxable_paise,
      cgstPaise: it.cgst_paise,
      sgstPaise: it.sgst_paise,
      igstPaise: it.igst_paise,
      taxPaise: it.tax_paise,
      totalPaise: it.total_paise,
      priceIncludesTax: it.price_includes_tax,
    })),
    charges: chargesFromJson(invoice.charges_json),
    totals: {
      subtotalGrossPaise: invoice.subtotal_gross_paise,
      discountTotalPaise: invoice.discount_total_paise,
      taxableTotalPaise: invoice.taxable_total_paise,
      cgstPaise: invoice.cgst_paise,
      sgstPaise: invoice.sgst_paise,
      igstPaise: invoice.igst_paise,
      chargesTotalPaise: invoice.charges_total_paise,
      chargesTaxPaise: invoice.charges_tax_paise,
      roundOffPaise: invoice.round_off_paise,
      grandTotalPaise: invoice.grand_total_paise,
      paidTotalPaise: invoice.paid_total_paise,
    },
    notes: invoice.notes,
    terms: invoice.terms,
  }
}

export function buildQuotationModel(
  quotation: QuotationRow,
  items: QuotationItem[],
  company: CompanyProfile | null,
  customer?: { billing_address: string | null; shipping_address: string | null; state_name: string | null } | null,
): UnifiedDocumentModel {
  return {
    kind: 'QUOTATION',
    number: quotation.number,
    status: quotation.status,
    date: quotation.quotation_date,
    dueDate: null,
    validUntil: quotation.valid_until,
    company: toCompanyModel(company),
    customer: {
      name: quotation.customer_name_snapshot ?? 'Customer',
      gstin: quotation.customer_gstin_snapshot,
      addressLines: splitLines(customer?.billing_address),
      stateName: customer?.state_name ?? null,
    },
    placeOfSupply: quotation.place_of_supply_code ?? '—',
    taxMode: quotation.tax_mode,
    priceIncludesTax: quotation.price_includes_tax,
    items: items.map((it) => ({
      position: it.position,
      description: it.description,
      hsnSac: it.hsn_sac,
      qtyMilli: it.qty_milli,
      unit: it.unit,
      unitPricePaise: it.unit_price_paise,
      discountBps: it.discount_bps,
      gstRateBps: it.gst_rate_bps,
      grossPaise: it.gross_paise,
      discountPaise: it.discount_paise,
      taxablePaise: it.taxable_paise,
      cgstPaise: it.cgst_paise,
      sgstPaise: it.sgst_paise,
      igstPaise: it.igst_paise,
      taxPaise: it.tax_paise,
      totalPaise: it.total_paise,
      priceIncludesTax: it.price_includes_tax,
    })),
    charges: chargesFromJson(quotation.charges_json),
    totals: {
      subtotalGrossPaise: quotation.subtotal_gross_paise,
      discountTotalPaise: quotation.discount_total_paise,
      taxableTotalPaise: quotation.taxable_total_paise,
      cgstPaise: quotation.cgst_paise,
      sgstPaise: quotation.sgst_paise,
      igstPaise: quotation.igst_paise,
      chargesTotalPaise: quotation.charges_total_paise,
      chargesTaxPaise: quotation.charges_tax_paise,
      roundOffPaise: quotation.round_off_paise,
      grandTotalPaise: quotation.grand_total_paise,
    },
    notes: quotation.notes,
    terms: quotation.terms,
  }
}

function toCompanyModel(company: CompanyProfile | null): UnifiedDocumentModel['company'] {
  return {
    name: company?.name ?? 'My Company',
    gstin: company?.gstin ?? null,
    pan: company?.pan ?? null,
    addressLines: [
      company?.address_line1,
      company?.address_line2,
      [company?.city, company?.state_name, company?.pincode].filter(Boolean).join(', '),
    ].filter((x): x is string => Boolean(x)),
    phone: company?.phone ?? null,
    email: company?.email ?? null,
    logoData: company?.logo_data ?? null,
    signatureData: company?.signature_data ?? null,
    authorizedSignatory: company?.authorized_signatory ?? null,
    bank: company?.bank_name
      ? { name: company.bank_name, account: company.bank_account ?? '', ifsc: company.bank_ifsc ?? '', branch: company.bank_branch ?? '' }
      : null,
  }
}

function splitLines(addr: string | null | undefined): string[] {
  if (!addr) return []
  return addr.split('\n').map((l) => l.trim()).filter(Boolean)
}

/** INV/2025-26/0042 → INV-2025-26-0042 */
export function pdfFileName(model: UnifiedDocumentModel): string {
  return `${model.number.replace(/\//g, '-')}.pdf`
}
