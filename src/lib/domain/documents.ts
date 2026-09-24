// InvoiceFlow — Document computation engine (CANON §4) — SINGLE SOURCE OF TRUTH
// Used by: client UI (live totals), repositories (persisted snapshots),
// sync server (recomputes and overwrites client totals — never trust client math),
// and the PDF renderer (renders exactly these numbers).

import { roundHalfUp } from './money'
import { isInterState, splitTax, taxOn } from './gst'
import type { TaxMode } from './types'

export interface DocItemInput {
  id: string
  description: string
  hsn_sac?: string | null
  qty_milli: number
  unit?: string | null
  unit_price_paise: number
  discount_bps: number
  gst_rate_bps: number
}

export interface DocChargeInput {
  id: string
  label: string
  amount_paise: number
  taxable: boolean
  gst_rate_bps: number
}

export interface ComputedLine {
  item: DocItemInput
  gross_paise: number
  discount_paise: number
  taxable_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  tax_paise: number
  total_paise: number
}

export interface DocumentTotals {
  lines: ComputedLine[]
  subtotal_gross_paise: number
  discount_total_paise: number
  taxable_total_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  tax_total_paise: number
  charges_total_paise: number
  charges_tax_paise: number
  round_off_paise: number
  grand_total_paise: number
}

export interface ComputeDocumentInput {
  items: DocItemInput[]
  charges?: DocChargeInput[]
  price_includes_tax: boolean
  supplier_state_code: string | null
  place_of_supply_code: string | null
  enable_round_off: boolean
}

/**
 * Compute one line. Exact order (CANON §4):
 *  1. gross   = roundHalfUp(qty_milli * unit_price / 1000)
 *  2. discount= roundHalfUp(gross * discount_bps / 10000)
 *  3. exclusive: taxable = grossAfterDisc; tax = roundHalfUp(taxable * rate/10000)
 *     inclusive: taxable = roundHalfUp(grossAfterDisc * 10000/(10000+rate)); tax = grossAfterDisc - taxable
 *  4. split CGST/SGST or IGST (odd paise → SGST)
 */
export function computeLine(
  item: DocItemInput,
  priceIncludesTax: boolean,
  interState: boolean,
): ComputedLine {
  const gross = roundHalfUp((item.qty_milli * item.unit_price_paise) / 1000)
  const discount = roundHalfUp((gross * item.discount_bps) / 10000)
  const grossAfterDisc = gross - discount
  let taxable: number
  let taxCombined: number
  if (priceIncludesTax) {
    taxable = roundHalfUp((grossAfterDisc * 10000) / (10000 + item.gst_rate_bps))
    taxCombined = grossAfterDisc - taxable
  } else {
    taxable = grossAfterDisc
    taxCombined = roundHalfUp((taxable * item.gst_rate_bps) / 10000)
  }
  const split = splitTax(taxCombined, interState)
  return {
    item,
    gross_paise: gross,
    discount_paise: discount,
    taxable_paise: taxable,
    cgst_paise: split.cgst,
    sgst_paise: split.sgst,
    igst_paise: split.igst,
    tax_paise: taxCombined,
    total_paise: taxable + taxCombined,
  }
}

/** Compute full document totals. Deterministic; identical on client and server. */
export function computeDocumentTotals(input: ComputeDocumentInput): DocumentTotals {
  const interState = isInterState(input.supplier_state_code, input.place_of_supply_code)
  const lines = (input.items ?? []).map((item) => computeLine(item, input.price_includes_tax, interState))

  const totals: DocumentTotals = {
    lines,
    subtotal_gross_paise: 0,
    discount_total_paise: 0,
    taxable_total_paise: 0,
    cgst_paise: 0,
    sgst_paise: 0,
    igst_paise: 0,
    tax_total_paise: 0,
    charges_total_paise: 0,
    charges_tax_paise: 0,
    round_off_paise: 0,
    grand_total_paise: 0,
  }

  for (const l of lines) {
    totals.subtotal_gross_paise += l.gross_paise
    totals.discount_total_paise += l.discount_paise
    totals.taxable_total_paise += l.taxable_paise
    totals.cgst_paise += l.cgst_paise
    totals.sgst_paise += l.sgst_paise
    totals.igst_paise += l.igst_paise
    totals.tax_total_paise += l.tax_paise
  }

  for (const c of input.charges ?? []) {
    totals.charges_total_paise += c.amount_paise
    if (c.taxable && c.amount_paise > 0) {
      const ct = taxOn(c.amount_paise, c.gst_rate_bps)
      totals.charges_tax_paise += ct
      const split = splitTax(ct, interState)
      totals.cgst_paise += split.cgst
      totals.sgst_paise += split.sgst
      totals.igst_paise += split.igst
      totals.tax_total_paise += ct
    }
  }

  // Charge tax joins the CGST/SGST/IGST totals above (single count). charges_tax_paise
  // is a display-only component — it must NOT be added to the grand total again.
  const grandRaw =
    totals.taxable_total_paise + totals.cgst_paise + totals.sgst_paise + totals.igst_paise +
    totals.charges_total_paise

  if (input.enable_round_off) {
    const grand = roundHalfUp(grandRaw / 100) * 100
    totals.round_off_paise = grand - grandRaw
    totals.grand_total_paise = grand
  } else {
    totals.grand_total_paise = grandRaw
  }

  return totals
}

/** Tax mode snapshot for a document. */
export function resolveTaxMode(supplierStateCode: string | null, placeOfSupplyCode: string | null): TaxMode {
  return isInterState(supplierStateCode, placeOfSupplyCode) ? 'INTER' : 'INTRA'
}

export function balancePaise(grandTotalPaise: number, paidTotalPaise: number): number {
  return Math.max(0, grandTotalPaise - paidTotalPaise)
}
