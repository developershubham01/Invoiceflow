// InvoiceFlow — GST engine (CANON §5)
// Intra-state → CGST + SGST (UTGST recorded in the SGST slot). Inter-state → IGST.
// All arithmetic in integer paise / basis points with half-up rounding (CANON §4).

import { roundHalfUp } from './money'

export interface IndianState {
  code: string
  name: string
  ut: boolean
}

/** Official GST state codes (01–38). `ut` = union territory (UTGST applies instead of SGST label). */
export const INDIAN_STATES: IndianState[] = [
  { code: '01', name: 'Jammu & Kashmir', ut: true },
  { code: '02', name: 'Himachal Pradesh', ut: false },
  { code: '03', name: 'Punjab', ut: false },
  { code: '04', name: 'Chandigarh', ut: true },
  { code: '05', name: 'Uttarakhand', ut: false },
  { code: '06', name: 'Haryana', ut: false },
  { code: '07', name: 'Delhi', ut: true },
  { code: '08', name: 'Rajasthan', ut: false },
  { code: '09', name: 'Uttar Pradesh', ut: false },
  { code: '10', name: 'Bihar', ut: false },
  { code: '11', name: 'Sikkim', ut: false },
  { code: '12', name: 'Arunachal Pradesh', ut: false },
  { code: '13', name: 'Nagaland', ut: false },
  { code: '14', name: 'Manipur', ut: false },
  { code: '15', name: 'Mizoram', ut: false },
  { code: '16', name: 'Tripura', ut: false },
  { code: '17', name: 'Meghalaya', ut: false },
  { code: '18', name: 'Assam', ut: false },
  { code: '19', name: 'West Bengal', ut: false },
  { code: '20', name: 'Jharkhand', ut: false },
  { code: '21', name: 'Odisha', ut: false },
  { code: '22', name: 'Chhattisgarh', ut: false },
  { code: '23', name: 'Madhya Pradesh', ut: false },
  { code: '24', name: 'Gujarat', ut: false },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu', ut: true },
  { code: '27', name: 'Maharashtra', ut: false },
  { code: '29', name: 'Karnataka', ut: false },
  { code: '30', name: 'Goa', ut: false },
  { code: '31', name: 'Lakshadweep', ut: true },
  { code: '32', name: 'Kerala', ut: false },
  { code: '33', name: 'Tamil Nadu', ut: false },
  { code: '34', name: 'Puducherry', ut: true },
  { code: '35', name: 'Andaman & Nicobar Islands', ut: true },
  { code: '36', name: 'Telangana', ut: false },
  { code: '37', name: 'Andhra Pradesh', ut: false },
  { code: '38', name: 'Ladakh', ut: true },
]

export function stateByCode(code: string | null | undefined): IndianState | undefined {
  if (!code) return undefined
  return INDIAN_STATES.find((s) => s.code === code)
}

export function stateNameByCode(code: string | null | undefined): string {
  return stateByCode(code)?.name ?? ''
}

export function isUnionTerritory(code: string | null | undefined): boolean {
  return stateByCode(code)?.ut ?? false
}

/** GSTIN format validation (15 chars; first 2 digits = state code). CANON §5. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return false
  return GSTIN_REGEX.test(gstin.toUpperCase())
}

/** Extract the state code from a GSTIN, or null. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null
  const code = gstin.slice(0, 2)
  return stateByCode(code) ? code : null
}

export function isInterState(supplierStateCode: string | null | undefined, placeOfSupplyCode: string | null | undefined): boolean {
  if (!supplierStateCode || !placeOfSupplyCode) return false
  return supplierStateCode !== placeOfSupplyCode
}

export interface TaxSplit {
  cgst: number
  sgst: number
  igst: number
}

/**
 * Split a combined tax amount into CGST/SGST or IGST (CANON §4 step 4).
 * Odd paise always goes to SGST (or UTGST recorded in the SGST slot) so sums are exact.
 */
export function splitTax(taxCombinedPaise: number, interState: boolean): TaxSplit {
  if (interState) return { cgst: 0, sgst: 0, igst: taxCombinedPaise }
  const cgst = roundHalfUp(taxCombinedPaise / 2)
  return { cgst, sgst: taxCombinedPaise - cgst, igst: 0 }
}

/** Combined tax on a taxable amount at a rate in bps. */
export function taxOn(taxablePaise: number, rateBps: number): number {
  return roundHalfUp((taxablePaise * rateBps) / 10000)
}

/** Common GST rate options in bps (configurable via tax_rates; this is the standard set). */
export const STANDARD_GST_RATES_BPS = [0, 250, 500, 750, 1200, 1800, 2800] as const

export function gstRateLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`
}
