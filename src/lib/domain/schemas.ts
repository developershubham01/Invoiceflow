// InvoiceFlow — Shared Zod validation schemas (CANON §33 / docs/33-VALIDATION.md)
// Used by: forms (RHF zodResolver), repositories, sync client, and the sync server.
// Money: integer paise ≥ 0. Quantity: integer milli-units > 0. Rates: basis points.

import { z } from 'zod'
import { GSTIN_REGEX, STANDARD_GST_RATES_BPS } from './gst'
import { DOC_DATE_FORMATS } from '../date'
import { docPatternError } from './numbering'

export const GST_RATE_BPS_VALUES = STANDARD_GST_RATES_BPS as unknown as number[]

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (expected YYYY-MM-DD)')
const optionalDateStr = dateStr.nullish().or(z.literal(''))
const nonEmpty = (label: string, max = 200) => z.string().trim().min(1, `${label} is required`).max(max)
const optionalText = (max = 500) => z.string().trim().max(max).nullish().or(z.literal(''))
const email = z.string().trim().email('Invalid email').max(200).nullish().or(z.literal(''))
const phone = z.string().trim().regex(/^[0-9+\-\s()]{6,15}$/, 'Invalid phone number').nullish().or(z.literal(''))
const pincode = z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits').nullish().or(z.literal(''))
const gstin = z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN format').nullish().or(z.literal(''))
const paise = z.number().int('Amount precision error').min(0, 'Amount must be ≥ 0')
const paisePositive = z.number().int().gt(0, 'Amount must be > 0')
const qtyMilli = z.number().int().gt(0, 'Quantity must be > 0')
const bps = z.number().int().min(0, 'Min 0%').max(10000, 'Max 100%')
const gstBps = z.number().int().refine((v) => GST_RATE_BPS_VALUES.includes(v), 'Invalid GST rate')

// ---------- Company ----------
export const companyProfileSchema = z.object({
  name: nonEmpty('Company name', 200),
  business_type: optionalText(100),
  logo_data: z.string().max(1_400_000).nullish().or(z.literal('')),
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  city: optionalText(100),
  state_name: optionalText(100),
  state_code: z.string().trim().max(2).nullish().or(z.literal('')),
  pincode,
  gstin,
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN').nullish().or(z.literal('')),
  phone,
  email,
  website: optionalText(200),
  bank_name: optionalText(200),
  bank_account: optionalText(50),
  bank_ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC').nullish().or(z.literal('')),
  bank_branch: optionalText(200),
  upi_vpa: z.string().trim().toLowerCase().max(100).regex(/^[a-z0-9.\-_]{2,256}@[a-z][a-z0-9\-]{1,63}$/, 'Invalid UPI ID — expected format name@bank').nullish().or(z.literal('')),
  authorized_signatory: optionalText(200),
  signature_data: z.string().max(1_400_000).nullish().or(z.literal('')),
  invoice_prefix: z.string().trim().min(1).max(10).default('INV'),
  quotation_prefix: z.string().trim().min(1).max(10).default('QT'),
  invoice_number_pattern: z.string().trim().max(60)
    .refine((v) => docPatternError(v) === null, 'Invalid number format — must include a {SEQ} token')
    .nullish().or(z.literal('')),
  quotation_number_pattern: z.string().trim().max(60)
    .refine((v) => docPatternError(v) === null, 'Invalid number format — must include a {SEQ} token')
    .nullish().or(z.literal('')),
  doc_date_format: z.enum(DOC_DATE_FORMATS).nullish().or(z.literal('')),
  default_gst_rate_bps: gstBps.default(1800),
  price_includes_tax: z.boolean().default(false),
  enable_round_off: z.boolean().default(true),
  default_terms: optionalText(2000),
  default_notes: optionalText(2000),
})
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>

// ---------- Customer ----------
export const customerSchema = z.object({
  type: z.enum(['BUSINESS', 'INDIVIDUAL']).default('BUSINESS'),
  business_name: nonEmpty('Name', 200),
  contact_person: optionalText(200),
  email,
  phone,
  gstin,
  billing_address: optionalText(1000),
  shipping_address: optionalText(1000),
  state_code: z.string().trim().max(2).nullish().or(z.literal('')),
  notes: optionalText(2000),
})
export type CustomerInput = z.infer<typeof customerSchema>

// ---------- Product ----------
export const productSchema = z.object({
  name: nonEmpty('Product / service name', 200),
  sku: optionalText(50),
  hsn_sac: z.string().trim().max(10).nullish().or(z.literal('')),
  description: optionalText(1000),
  unit: z.string().trim().min(1, 'Unit is required').max(20).default('NOS'),
  selling_price_paise: paise,
  cost_price_paise: paise.nullish(),
  gst_rate_bps: gstBps,
  price_includes_tax: z.boolean().nullish(),
  active: z.boolean().default(true),
})
export type ProductInput = z.infer<typeof productSchema>

// ---------- Line items & documents ----------
export const docItemSchema = z.object({
  id: z.string().min(1),
  description: nonEmpty('Description', 500),
  hsn_sac: z.string().trim().max(10).nullish().or(z.literal('')),
  qty_milli: qtyMilli,
  unit: optionalText(20),
  unit_price_paise: paise,
  discount_bps: bps.default(0),
  gst_rate_bps: gstBps,
})
export type DocItemInputSchema = z.infer<typeof docItemSchema>

export const docChargeSchema = z.object({
  id: z.string().min(1),
  label: nonEmpty('Charge label', 100),
  amount_paise: paise,
  taxable: z.boolean().default(false),
  gst_rate_bps: gstBps.default(1800),
})

export const invoiceDraftSchema = z.object({
  customer_id: z.string().min(1, 'Customer is required'),
  invoice_date: dateStr,
  due_date: optionalDateStr,
  place_of_supply_code: z.string().trim().max(2).nullish().or(z.literal('')),
  price_includes_tax: z.boolean(),
  items: z.array(docItemSchema).min(1, 'Add at least one line item').max(200),
  charges: z.array(docChargeSchema).max(20).default([]),
  notes: optionalText(2000),
  terms: optionalText(2000),
})
export type InvoiceDraftInput = z.infer<typeof invoiceDraftSchema>

export const quotationDraftSchema = z.object({
  customer_id: z.string().min(1, 'Customer is required'),
  quotation_date: dateStr,
  valid_until: optionalDateStr,
  place_of_supply_code: z.string().trim().max(2).nullish().or(z.literal('')),
  price_includes_tax: z.boolean(),
  items: z.array(docItemSchema).min(1, 'Add at least one line item').max(200),
  charges: z.array(docChargeSchema).max(20).default([]),
  notes: optionalText(2000),
  terms: optionalText(2000),
})
export type QuotationDraftInput = z.infer<typeof quotationDraftSchema>

// ---------- Payment ----------
export const paymentSchema = z.object({
  invoice_id: z.string().min(1),
  amount_paise: paisePositive,
  paid_at: dateStr,
  method: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'OTHER']).default('BANK_TRANSFER'),
  reference: optionalText(100),
  notes: optionalText(500),
})
export type PaymentInput = z.infer<typeof paymentSchema>

// ---------- Auth ----------
export const registerSchema = z.object({
  name: nonEmpty('Name', 100),
  email: z.string().trim().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
})
export type LoginInput = z.infer<typeof loginSchema>

/** Normalize an optional string field: '' → null. */
export function orNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null
  const t = v.trim()
  return t.length ? t : null
}
