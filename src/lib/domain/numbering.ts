// InvoiceFlow — Document numbering (CANON §6)
// Default format: {prefix}/{FY}/{seq4}  e.g. INV/2025-26/0042
// The number layout is user-configurable per document type (invoice / quotation)
// via a pattern stored on the company profile — see renderDocNumber below.
// Fiscal year: April 1 – March 31. Drafts carry provisional DRAFT-xxxxxxxx numbers.

/** Fiscal year label for a YYYY-MM-DD date string, e.g. '2025-03-31' → '2024-25'. */
export function fiscalYearOf(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  const startYear = m >= 4 ? y : y - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

export interface DocNumberParts {
  prefix: string
  fiscalYear: string
  seq: number
  /** 'YYYY-MM-DD' of the document — needed for the {Y} and {M} tokens. Optional for legacy calls. */
  onDate?: string
}

/** The classic layout, also the fallback when no pattern is configured. */
export const DEFAULT_DOC_PATTERN = '{PREFIX}/{FY}/{SEQ:4}'

/**
 * Render a document number from a user-configurable pattern.
 *
 * Supported tokens:
 *  - {PREFIX}  → invoice/quotation prefix (e.g. INV)
 *  - {FY}      → fiscal-year label, e.g. 2026-27 (April–March)
 *  - {Y}       → calendar year of the document date (e.g. 2026)
 *  - {M}       → month number of the document date, zero-padded (e.g. 04)
 *  - {SEQ}     → sequence number, zero-padded to 4 (same as {SEQ:4})
 *  - {SEQ:N}   → sequence number, zero-padded to N digits (1–6)
 *
 * Unknown {…} groups render literally so typos are visible instead of silently dropped.
 * Literal text may contain letters, digits, spaces and - _ / . characters.
 */
export function renderDocNumber(pattern: string | null | undefined, parts: DocNumberParts): string {
  const p = (pattern ?? '').trim() || DEFAULT_DOC_PATTERN
  const [y, m] = (parts.onDate ?? '').split('-').map(Number)
  const seq = String(Math.max(0, parts.seq))
  return p.replace(/\{(PREFIX|FY|Y|M|SEQ(?::[1-6])?)\}/g, (_match, token: string) => {
    switch (token) {
      case 'PREFIX': return parts.prefix
      case 'FY': return parts.fiscalYear
      case 'Y': return Number.isFinite(y) ? String(y) : parts.fiscalYear.slice(0, 4)
      case 'M': return Number.isFinite(m) ? String(m).padStart(2, '0') : ''
      case 'SEQ': return seq.padStart(4, '0')
      default: {
        const digits = Number(token.slice(token.indexOf(':') + 1)) || 4
        return seq.padStart(Math.min(6, Math.max(1, digits)), '0')
      }
    }
  })
}

/**
 * Validate a user-entered document-number pattern. Returns an error message or null when valid.
 * Rules: length ≤ 60, at least one {SEQ}/{SEQ:N} token, only known tokens and safe literal chars.
 */
export function docPatternError(pattern: string): string | null {
  const p = pattern.trim()
  if (!p) return null // empty → fall back to the default layout, treated as valid
  if (p.length > 60) return 'Pattern is too long (max 60 characters)'
  if (!/\{SEQ(?::[1-6])?\}/.test(p)) return 'Pattern must include a {SEQ} token for the running number'
  // All tokens must be known
  const tokens = p.match(/\{[^{}]*\}/g) ?? []
  for (const t of tokens) {
    if (!/^\{(PREFIX|FY|Y|M|SEQ(?::[1-6])?)\}$/.test(t)) return `Unknown token ${t} — allowed: {PREFIX} {FY} {Y} {M} {SEQ}`
  }
  // Literal characters between tokens must be safe (avoid newline/control chars)
  const literals = p.replace(/\{[^{}]*\}/g, '')
  if (!/^[\w\-/ .]*$/.test(literals)) return 'Pattern text may only use letters, numbers, spaces and - _ / .'
  return null
}

/** Back-compat helper (server allocator, seeders): the default {PREFIX}/{FY}/{SEQ:4} layout. */
export function formatDocNumber(prefix: string, fiscalYear: string, seq: number): string {
  return renderDocNumber(DEFAULT_DOC_PATTERN, { prefix, fiscalYear, seq })
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
