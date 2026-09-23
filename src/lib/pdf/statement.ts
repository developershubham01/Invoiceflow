// InvoiceFlow — Customer statement PDF (docs/14 conventions: A4, offline jsPDF,
// core fonts → "Rs." instead of ₹). Deterministic layout for ledger-style output.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatMoneyPlain } from '@/lib/domain/money'
import { formatDateDisplay } from '@/lib/date'

const EMERALD: [number, number, number] = [5, 122, 85]
const SLATE: [number, number, number] = [51, 65, 85]
const MUTED: [number, number, number] = [100, 116, 139]
const LIGHT_EMERALD: [number, number, number] = [236, 253, 245]

export interface StatementPdfEntry {
  date: string
  kind: 'Invoice' | 'Payment'
  number: string
  detail: string
  debitPaise: number
  creditPaise: number
  balancePaise: number
}

export interface StatementPdfInput {
  company: { name: string; gstin: string | null; addressLine1: string | null; city: string | null; stateName: string | null; phone: string | null; email: string | null; dateFormat?: string | null }
  customer: { name: string; code: string | null; gstin: string | null }
  period: { from: string; to: string }
  entries: StatementPdfEntry[]
  totals: { invoicedPaise: number; collectedPaise: number; outstandingPaise: number }
}

export function renderStatementPdf(input: StatementPdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const pageW = doc.internal.pageSize.getWidth()
  const marginX = 14
  let y = 16

  doc.setFillColor(...EMERALD)
  doc.rect(0, 0, pageW, 4, 'F')

  // Header: company block + title
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...SLATE)
  doc.text(doc.splitTextToSize(input.company.name, 100)[0], marginX, y + 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  const companyLines = [
    input.company.addressLine1 ?? '',
    [input.company.city, input.company.stateName].filter(Boolean).join(', '),
    input.company.gstin ? `GSTIN: ${input.company.gstin}` : '',
  ].filter(Boolean) as string[]
  companyLines.forEach((line, i) => doc.text(line, marginX, y + 9 + i * 4))

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...SLATE)
  doc.text('STATEMENT OF ACCOUNT', pageW - marginX, y + 5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text(`${formatDateDisplay(input.period.from, input.company.dateFormat)} to ${formatDateDisplay(input.period.to, input.company.dateFormat)}`, pageW - marginX, y + 10, { align: 'right' })

  // Customer block
  y += 9 + companyLines.length * 4 + 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...SLATE)
  doc.text('Billed to', marginX, y)
  doc.setFont('helvetica', 'normal')
  const custLines = [
    input.customer.name,
    input.customer.code ? `Code: ${input.customer.code}` : '',
    input.customer.gstin ? `GSTIN: ${input.customer.gstin}` : '',
  ].filter(Boolean) as string[]
  custLines.forEach((line, i) => doc.text(line, marginX, y + 5 + i * 4.5))

  y += 5 + custLines.length * 4.5 + 4

  // Summary tiles (three-column strip)
  const tileW = (pageW - marginX * 2 - 4) / 3
  const tiles: Array<[string, string]> = [
    ['Invoiced', `Rs. ${formatMoneyPlain(input.totals.invoicedPaise)}`],
    ['Collected', `Rs. ${formatMoneyPlain(input.totals.collectedPaise)}`],
    ['Outstanding', `Rs. ${formatMoneyPlain(input.totals.outstandingPaise)}`],
  ]
  doc.setFillColor(...LIGHT_EMERALD)
  doc.roundedRect(marginX, y, tileW, 13, 1.5, 1.5, 'F')
  doc.roundedRect(marginX + tileW + 2, y, tileW, 13, 1.5, 1.5, 'F')
  doc.roundedRect(marginX + (tileW + 2) * 2, y, tileW, 13, 1.5, 1.5, 'F')
  tiles.forEach(([label, value], i) => {
    const x = marginX + (tileW + 2) * i + 3
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(label.toUpperCase(), x, y + 5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...SLATE)
    doc.text(value, x, y + 10.5)
  })
  y += 20

  // Ledger table
  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    head: [['Date', 'Document', 'Detail', 'Debit', 'Credit', 'Balance']],
    body: input.entries.map((e) => [
      formatDateDisplay(e.date, input.company.dateFormat),
      e.number,
      e.detail || (e.kind === 'Invoice' ? 'Tax invoice' : 'Payment'),
      e.debitPaise ? `Rs. ${formatMoneyPlain(e.debitPaise)}` : '—',
      e.creditPaise ? `Rs. ${formatMoneyPlain(e.creditPaise)}` : '—',
      `Rs. ${formatMoneyPlain(e.balancePaise)}`,
    ]),
    foot: [[
      '', '', 'TOTAL',
      `Rs. ${formatMoneyPlain(input.totals.invoicedPaise)}`,
      `Rs. ${formatMoneyPlain(input.totals.collectedPaise)}`,
      `Rs. ${formatMoneyPlain(input.totals.outstandingPaise)}`,
    ]],
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.2, textColor: SLATE },
    headStyles: { fillColor: EMERALD, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    footStyles: { fillColor: LIGHT_EMERALD, textColor: SLATE, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: {
      0: { cellWidth: 24 },
      2: { cellWidth: 46 },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  })

  // Footer note
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text(
    'Generated locally on this device (offline-capable). Amounts in Indian Rupees.',
    marginX,
    Math.min(finalY + 8, doc.internal.pageSize.getHeight() - 10),
  )

  return doc
}
