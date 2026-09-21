// InvoiceFlow — Money & quantity helpers (CANON §4)
// All monetary values are integer paise. Quantities are integer milli-units.
// NO floating point arithmetic on money: parse to integers immediately, format at the edge.

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const inrFormatterNoSymbol = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Format paise → "₹1,23,456.78" */
export function formatMoney(paise: number): string {
  return inrFormatter.format((paise || 0) / 100)
}

/** Format paise → "1,23,456.78" (no symbol; used in PDFs where ₹ glyph is unavailable) */
export function formatMoneyPlain(paise: number): string {
  return inrFormatterNoSymbol.format((paise || 0) / 100)
}

/** Format paise → "Rs. 1,23,456.78" (PDF-safe rendering) */
export function formatMoneyRs(paise: number): string {
  return `Rs. ${formatMoneyPlain(paise)}`
}

/** Compact display for cards: "₹1.23L", "₹45.6K" */
export function formatMoneyCompact(paise: number): string {
  const n = (paise || 0) / 100
  const abs = Math.abs(n)
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (abs >= 100000) return `₹${(n / 100000).toFixed(2)}L`
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n.toFixed(2)}`
}

/**
 * Parse a user-entered rupee amount ("1,234.50", "1234", "₹99") → integer paise.
 * Returns null for invalid input.
 */
export function parseAmountToPaise(input: string): number | null {
  if (!input) return null
  const cleaned = input.replace(/[₹,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  const fracPaise = frac.length === 0 ? 0 : frac.length === 1 ? Number(frac) * 10 : Number(frac.slice(0, 2))
  return Number(whole) * 100 + fracPaise
}

/** Parse quantity ("2.5", "2", "1,000") → integer milli-units (max 3 decimals). */
export function parseQtyToMilli(input: string): number | null {
  if (!input) return null
  const cleaned = input.replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  const fracMilli = frac.padEnd(3, '0').slice(0, 3)
  return Number(whole) * 1000 + Number(fracMilli)
}

/** Format milli-units for display: 2500 → "2.5", 1000 → "1", 1250 → "1.25" */
export function formatQty(milli: number): string {
  const v = (milli || 0) / 1000
  return String(Number(v.toFixed(3)))
}

/** Round half-up for non-negative values (CANON §4). */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5)
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return TENS[t] + (o ? ` ${ONES[o]}` : '')
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  let out = ''
  if (h) out += `${ONES[h]} Hundred`
  if (rest) out += `${h ? ' ' : ''}${twoDigits(rest)}`
  return out
}

/** Indian numbering system: crore / lakh / thousand (up to 99 crore). */
export function numberToWordsIndian(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'Zero'
  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const rest = n % 1000
  const parts: string[] = []
  if (crore) parts.push(`${numberToWordsIndian(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (rest) parts.push(threeDigits(rest))
  return parts.join(' ')
}

/** Paise → "Rupees One Lakh Twenty Three Thousand and Fifty Paise Only" */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100)
  const paisePart = Math.abs(paise) % 100
  let out = `Rupees ${numberToWordsIndian(rupees)}`
  if (paisePart > 0) out += ` and ${twoDigits(paisePart)} Paise`
  return `${out} Only`
}
