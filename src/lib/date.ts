// InvoiceFlow — Date helpers (CANON §3: financial dates are 'YYYY-MM-DD' strings, never JS Dates)

export function todayStr(): string {
  const d = new Date()
  return toYMD(d)
}

export function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return toYMD(dt)
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** Document date display formats offered in My Company → Document formats. */
export const DOC_DATE_FORMATS = ['DD MMM YYYY', 'DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY'] as const
export type DocDateFormat = (typeof DOC_DATE_FORMATS)[number]

/** Display format for a 'YYYY-MM-DD' string. Default (and PDF classic): `12 Apr 2025`. */
export function formatDateDisplay(dateStr: string | null | undefined, format?: string | null): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  switch (format) {
    case 'DD/MM/YYYY': return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
    case 'DD-MM-YYYY': return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`
    case 'MM/DD/YYYY': return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`
    default: {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      return `${d} ${months[m - 1]} ${y}`
    }
  }
}

/** Financial year start (April 1) for a YYYY-MM-DD string. */
export function fyStart(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  const startYear = m >= 4 ? y : y - 1
  return `${startYear}-04-01`
}

export function fyEnd(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  const endYear = m >= 4 ? y + 1 : y
  return `${endYear}-03-31`
}

/** 'YYYY-MM' key for grouping. */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[m - 1]} ${String(y).slice(2)}`
}
