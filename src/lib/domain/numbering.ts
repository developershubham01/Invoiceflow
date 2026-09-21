// InvoiceFlow — Document numbering (CANON §6)
// Format: {prefix}/{FY}/{seq4}  e.g. INV/2025-26/0042
// Fiscal year: April 1 – March 31. Drafts carry provisional DRAFT-xxxxxxxx numbers.

/** Fiscal year label for a YYYY-MM-DD date string, e.g. '2025-03-31' → '2024-25'. */
export function fiscalYearOf(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  const startYear = m >= 4 ? y : y - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

export function formatDocNumber(prefix: string, fiscalYear: string, seq: number): string {
  return `${prefix}/${fiscalYear}/${String(seq).padStart(4, '0')}`
}

/** Sequence key used by document_sequences tables. */
export function sequenceKey(workspaceId: string, docType: 'INVOICE' | 'QUOTATION', fiscalYear: string): string {
  return `${workspaceId}:${docType}:${fiscalYear}`
}

const DRAFT_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Provisional draft number: DRAFT-XXXXXXXX (displayed clearly as provisional). */
export function provisionalNumber(): string {
  let s = ''
  for (let i = 0; i < 8; i++) {
    s += DRAFT_ALPHABET[Math.floor(Math.random() * DRAFT_ALPHABET.length)]
  }
  return `DRAFT-${s}`
}

export function isProvisionalNumber(number: string): boolean {
  return number.startsWith('DRAFT-')
}

/** Customer code: CUS-0001 */
export function formatCustomerCode(seq: number): string {
  return `CUS-${String(seq).padStart(4, '0')}`
}
