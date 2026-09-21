/**
 * Shared payment-reminder helpers (India use case).
 * Used by the invoice detail view (single reminder) and the invoices list
 * (bulk reminders) so the wording stays identical everywhere.
 */
import { formatMoneyPlain } from '@/lib/domain/money'
import { formatDateDisplay, todayStr } from '@/lib/date'
import { isInvoiceOverdue, daysOverdue } from '@/lib/invoice-status'

// re-export: the canonical overdue rule lives in invoice-status.ts
export { isInvoiceOverdue } from '@/lib/invoice-status'

export interface ReminderInvoice {
  number: string
  status?: string
  due_date: string | null
  grand_total_paise: number
  paid_total_paise: number
}

export interface ReminderParty {
  contact_person?: string | null
  business_name?: string | null
}

export interface ReminderCompany {
  name?: string | null
  bank_name?: string | null
  bank_account?: string | null
  bank_ifsc?: string | null
}

/** WhatsApp-ready payment reminder text: polite, factual, self-contained. */
export function buildPaymentReminderText(
  inv: ReminderInvoice,
  customer: ReminderParty | null | undefined,
  company: ReminderCompany | null | undefined,
  today = todayStr(),
): string {
  const balance = Math.max(0, inv.grand_total_paise - inv.paid_total_paise)
  const overdue = isInvoiceOverdue(inv, today)
  const days = daysOverdue(inv, today)
  return [
    `Hello ${customer?.contact_person || customer?.business_name || 'there'},`,
    '',
    overdue
      ? `Gentle reminder that invoice ${inv.number}${inv.due_date ? ` (due ${formatDateDisplay(inv.due_date)})` : ''} is ${days} day${days === 1 ? '' : 's'} overdue.`
      : `This is a gentle reminder about invoice ${inv.number}${inv.due_date ? ` (due ${formatDateDisplay(inv.due_date)})` : ''}.`,
    '',
    `Invoice amount: Rs. ${formatMoneyPlain(inv.grand_total_paise)}`,
    inv.paid_total_paise > 0 ? `Already paid: Rs. ${formatMoneyPlain(inv.paid_total_paise)}` : '',
    `Balance due: Rs. ${formatMoneyPlain(balance)}`,
    company
      ? `Pay to: ${company.bank_name ?? ''}${company.bank_account ? ` A/C ${company.bank_account}` : ''}${company.bank_ifsc ? ` (${company.bank_ifsc})` : ''}`.trim()
      : '',
    '',
    'Kindly arrange the payment at your earliest convenience. Please ignore if already paid — thank you!',
    company?.name ? `— ${company.name}` : '',
  ].filter((l) => l !== '').join('\n')
}

/** wa.me target: digits only, 91-prefix when 10 digits (Indian convention). */
export function whatsappTarget(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/[^0-9]/g, '')
  return digits && digits.length === 10 ? `91${digits}` : digits
}

/** Open WhatsApp with a pre-filled message; returns the resolved target (may be '' when no number is saved). */
export function openWhatsAppReminder(phone: string | null | undefined, text: string): string {
  const target = whatsappTarget(phone)
  const url = `https://wa.me/${target}?text=${encodeURIComponent(text)}`
  window.open(url, '_blank', 'noopener,noreferrer')
  return target
}
