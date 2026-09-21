'use client'

// InvoiceFlow — UPI scan-to-pay (CANON §2: everything generated locally, offline).
// Builds a standards-compliant `upi://pay` deep link from the company's VPA and
// renders it as a QR code with the `qrcode` package (pure client-side canvas —
// no network, no third-party image service). Any UPI app (GPay, PhonePe, Paytm,
// BHIM) can scan it to pre-fill a payment to the merchant.

export interface UpiUriInput {
  /** merchant Virtual Payment Address, e.g. "acmetraders@hdfcbank" */
  vpa: string
  /** merchant/display name shown in the payer's app */
  payeeName: string
  /** amount to pre-fill, in paise (0/omitted → payer enters the amount) */
  amountPaise?: number
  /** short note/reference, e.g. "Invoice INV/2026-27/0007" */
  note?: string
}

/**
 * Builds a `upi://pay?...` URI. Amount is sent in rupees with 2 decimals
 * (the UPI `am` parameter) only when a positive amount is given.
 */
export function buildUpiUri({ vpa, payeeName, amountPaise, note }: UpiUriInput): string {
  const params = new URLSearchParams()
  params.set('pa', vpa)
  if (payeeName) params.set('pn', payeeName)
  if (amountPaise != null && amountPaise > 0) params.set('am', (amountPaise / 100).toFixed(2))
  params.set('cu', 'INR')
  if (note) params.set('tn', note.slice(0, 50))
  return `upi://pay?${params.toString()}`
}

/** Loose VPA sanity check — the strict format lives in companyProfileSchema. */
export function looksLikeVpa(vpa: string | null | undefined): vpa is string {
  return typeof vpa === 'string' && /^[a-z0-9.\-_]{2,256}@[a-z][a-z0-9-]{1,63}$/i.test(vpa.trim())
}

/**
 * Renders a QR code for the given text to a PNG data URL (offline).
 * Returns null when generation fails so callers can degrade gracefully.
 */
export async function upiQrDataUrl(text: string): Promise<string | null> {
  try {
    const { default: QRCode } = await import('qrcode')
    return await QRCode.toDataURL(text, { margin: 1, width: 260, errorCorrectionLevel: 'M', color: { dark: '#052e22', light: '#ffffff' } })
  } catch {
    return null
  }
}
