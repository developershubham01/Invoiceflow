// InvoiceFlow — PDF renderer (CANON §13, docs/14-PDF-GENERATION.md)
// jsPDF + jspdf-autotable: deterministic vector output, offline, A4.
// Limitation: core fonts lack the ₹ glyph → amounts render as "Rs." (documented).

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { UnifiedDocumentModel } from './document-model'
import { amountInWords, formatMoneyPlain, formatQty } from '@/lib/domain/money'
import { gstRateLabel, stateNameByCode } from '@/lib/domain/gst'
import { formatDateDisplay } from '@/lib/date'

const EMERALD: [number, number, number] = [5, 122, 85] // emerald-600
const SLATE: [number, number, number] = [51, 65, 85]
const LIGHT: [number, number, number] = [241, 245, 243]

export function renderDocumentPdf(model: UnifiedDocumentModel): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const pageW = doc.internal.pageSize.getWidth()
  const marginX = 14
  let y = 16

  // ---------- header band ----------
  doc.setFillColor(...EMERALD)
  doc.rect(0, 0, pageW, 4, 'F')

  // Logo (if any) or company initial block
  let textX = marginX
  if (model.company.logoData) {
    try {
      const fmt = model.company.logoData.includes('image/png') ? 'PNG' : 'JPEG'
      doc.addImage(model.company.logoData, fmt, marginX, y, 14, 14)
      textX = marginX + 18
    } catch {
      /* invalid image data — skip gracefully */
    }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...SLATE)
  doc.text(doc.splitTextToSize(model.company.name, 90)[0], textX, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 110)
  const companyLines = [
    ...model.company.addressLines.slice(0, 2),
    model.company.gstin ? `GSTIN: ${model.company.gstin}` : null,
    model.company.pan ? `PAN: ${model.company.pan}` : null,
    model.company.phone ? `Phone: ${model.company.phone}` : null,
    model.company.email ? `Email: ${model.company.email}` : null,
  ].filter((x): x is string => Boolean(x))
  companyLines.slice(0, 4).forEach((line, i) => doc.text(line, textX, y + 9 + i * 3.6))

  // Document title
  const title = model.kind === 'INVOICE' ? 'TAX INVOICE' : 'QUOTATION'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...EMERALD)
  doc.text(title, pageW - marginX, y + 5, { align: 'right' })
  doc.setFontSize(8.5)
  doc.setTextColor(...SLATE)
  doc.text(`No. ${model.number}`, pageW - marginX, y + 10.5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 110)
  doc.text(`Date: ${formatDateDisplay(model.date)}`, pageW - marginX, y + 14.5, { align: 'right' })
  if (model.dueDate) doc.text(`Due: ${formatDateDisplay(model.dueDate)}`, pageW - marginX, y + 18, { align: 'right' })
  if (model.validUntil) doc.text(`Valid until: ${formatDateDisplay(model.validUntil)}`, pageW - marginX, y + 18, { align: 'right' })

  y += model.company.logoData ? 22 : 24

  // ---------- bill-to / supply ----------
  doc.setDrawColor(226, 232, 230)
  doc.setFillColor(...LIGHT)
  doc.roundedRect(marginX, y, pageW - marginX * 2, 26, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 110)
  doc.text('BILL TO', marginX + 4, y + 5.5)
  doc.setFontSize(10.5)
  doc.setTextColor(...SLATE)
  doc.text(doc.splitTextToSize(model.customer.name, 95)[0], marginX + 4, y + 11)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 110)
  let by = y + 15.5
  for (const line of model.customer.addressLines.slice(0, 2)) {
    doc.text(line, marginX + 4, by)
    by += 3.6
  }
  if (model.customer.gstin) doc.text(`GSTIN: ${model.customer.gstin}`, marginX + 4, by)

  const placeLabel = model.kind === 'INVOICE' ? 'Place of supply' : 'Place of supply'
  doc.text(placeLabel, pageW - marginX - 4, y + 5.5, { align: 'right' })
  doc.setTextColor(...SLATE)
  doc.text(stateNameByCode(model.placeOfSupply) || model.placeOfSupply, pageW - marginX - 4, y + 10, { align: 'right' })
  doc.setTextColor(100, 116, 110)
  doc.text(model.taxMode === 'INTER' ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)', pageW - marginX - 4, y + 14.5, { align: 'right' })
  if (model.status !== 'DRAFT') {
    doc.text(`Status: ${model.status.replace(/_/g, ' ')}`, pageW - marginX - 4, y + 19, { align: 'right' })
  }

  y += 32

  // ---------- items table ----------
  const intra = model.taxMode === 'INTRA'
  const head = [[
    '#', 'Item & description', 'HSN/SAC', 'Qty', 'Rate', 'Disc',
    'Taxable', intra ? 'CGST' : 'IGST', intra ? 'SGST' : '', 'Amount',
  ].filter((h) => h !== '')]
  const body = model.items.map((it) => {
    const rate = formatMoneyPlain(it.unitPricePaise)
    const row: string[] = [
      String(it.position),
      it.description,
      it.hsnSac ?? '—',
      `${formatQty(it.qtyMilli)}${it.unit ? ` ${it.unit}` : ''}`,
      rate,
      it.discountBps > 0 ? `${(it.discountBps / 100).toFixed(1)}%` : '—',
      formatMoneyPlain(it.taxablePaise),
      formatMoneyPlain(intra ? it.cgstPaise : it.igstPaise),
    ]
    if (intra) row.push(formatMoneyPlain(it.sgstPaise))
    row.push(formatMoneyPlain(it.totalPaise))
    return row
  })

  autoTable(doc, {
    head,
    body,
    startY: y,
    margin: { left: marginX, right: marginX },
    styles: { font: 'helvetica', fontSize: 7.6, cellPadding: 1.8, textColor: SLATE, lineColor: [226, 232, 230], lineWidth: 0.1 },
    headStyles: { fillColor: LIGHT, textColor: SLATE, fontStyle: 'bold', fontSize: 7.4 },
    alternateRowStyles: { fillColor: [252, 253, 252] },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 17, halign: 'right' },
      4: { cellWidth: 20, halign: 'right' },
      5: { cellWidth: 13, halign: 'right' },
      6: { cellWidth: 21, halign: 'right' },
      7: { cellWidth: 19, halign: 'right' },
      ...(intra ? { 8: { cellWidth: 19, halign: 'right' } } : {}),
      [intra ? 9 : 8]: { halign: 'right', fontStyle: 'bold' },
    },
    didDrawPage: () => {},
  })

  // @ts-expect-error lastAutoTable is attached by autoTable
  y = (doc.lastAutoTable?.finalY ?? y) + 6

  // ---------- totals ----------
  const t = model.totals
  const rows: Array<[string, string, boolean?]> = []
  if (model.priceIncludesTax) {
    rows.push(['Subtotal (tax inclusive)', formatMoneyPlain(t.subtotalGrossPaise)])
  } else {
    rows.push(['Subtotal', formatMoneyPlain(t.subtotalGrossPaise)])
  }
  if (t.discountTotalPaise > 0) rows.push(['Discount', `- ${formatMoneyPlain(t.discountTotalPaise)}`])
  rows.push(['Taxable value', formatMoneyPlain(t.taxableTotalPaise)])
  if (intra) {
    rows.push(['CGST', formatMoneyPlain(t.cgstPaise)])
    rows.push(['SGST/UTGST', formatMoneyPlain(t.sgstPaise)])
  } else {
    rows.push(['IGST', formatMoneyPlain(t.igstPaise)])
  }
  if (t.chargesTotalPaise > 0) rows.push(['Additional charges', formatMoneyPlain(t.chargesTotalPaise)])
  if (t.chargesTaxPaise > 0) rows.push(['Tax on charges', formatMoneyPlain(t.chargesTaxPaise)])
  if (t.roundOffPaise !== 0) rows.push(['Round off', `${t.roundOffPaise > 0 ? '+' : '-'} ${formatMoneyPlain(Math.abs(t.roundOffPaise))}`])

  const boxW = 78
  const rowH = 5
  const boxH = rows.length * rowH + 14
  const boxY = Math.min(y, doc.internal.pageSize.getHeight() - marginX - boxH)
  const boxX = pageW - marginX - boxW

  // Page break guard before totals
  if (boxY < y) {
    doc.addPage()
    y = marginX + 4
  }

  rows.forEach(([label, value], i) => {
    const ry = y + i * rowH
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.4)
    doc.setTextColor(100, 116, 110)
    doc.text(label, boxX + 2, ry)
    doc.setTextColor(...SLATE)
    doc.text(value, pageW - marginX - 2, ry, { align: 'right' })
  })
  y += rows.length * rowH + 2
  doc.setFillColor(...EMERALD)
  doc.roundedRect(boxX, y, boxW, 10, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text('GRAND TOTAL', boxX + 2, y + 6.6)
  doc.text(`Rs. ${formatMoneyPlain(t.grandTotalPaise)}`, pageW - marginX - 2, y + 6.6, { align: 'right' })
  y += 14

  if (model.kind === 'INVOICE' && typeof t.paidTotalPaise === 'number') {
    const balance = Math.max(0, t.grandTotalPaise - t.paidTotalPaise)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.4)
    doc.setTextColor(100, 116, 110)
    doc.text(`Amount paid: Rs. ${formatMoneyPlain(t.paidTotalPaise)}   ·   Balance due: Rs. ${formatMoneyPlain(balance)}`, marginX, y)
    y += 5
  }

  // ---------- amount in words ----------
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(71, 85, 80)
  const words = doc.splitTextToSize(`Amount in words: ${amountInWords(t.grandTotalPaise)}`, pageW - marginX * 2 - boxW - 6)
  doc.text(words, marginX, y)
  y += words.length * 3.6 + 4

  // ---------- bank / notes ----------
  if (model.kind === 'INVOICE' && model.company.bank) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...SLATE)
    doc.text('Bank details', marginX, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 110)
    const b = model.company.bank
    doc.text(`${b.name}${b.branch ? `, ${b.branch}` : ''}  ·  A/C: ${b.account}  ·  IFSC: ${b.ifsc}`, marginX, y + 3.8)
    y += 10
  }
  if (model.notes) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...SLATE)
    doc.text('Notes', marginX, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 110)
    const lines = doc.splitTextToSize(model.notes, pageW - marginX * 2)
    doc.text(lines, marginX, y + 3.8)
    y += 4 + lines.length * 3.6
  }

  // ---------- terms + signature (may page-break) ----------
  const termsLines = model.terms ? doc.splitTextToSize(model.terms, pageW / 2 - marginX) : []
  const needH = termsLines.length * 3.4 + 26
  if (y + needH > doc.internal.pageSize.getHeight() - marginX) {
    doc.addPage()
    y = marginX + 4
  }
  if (model.terms) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...SLATE)
    doc.text('Terms & conditions', marginX, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.4)
    doc.setTextColor(100, 116, 110)
    doc.text(termsLines, marginX, y + 3.8)
  }

  const sigX = pageW - marginX - 46
  let sigY = y + 4
  if (model.company.signatureData) {
    try {
      const fmt = model.company.signatureData.includes('image/png') ? 'PNG' : 'JPEG'
      doc.addImage(model.company.signatureData, fmt, sigX + 4, sigY, 34, 12)
      sigY += 14
    } catch {
      /* skip invalid signature image */
    }
  } else {
    sigY += 12
  }
  doc.setDrawColor(203, 213, 207)
  doc.line(sigX, sigY, sigX + 44, sigY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...SLATE)
  doc.text('For ' + doc.splitTextToSize(model.company.name, 46)[0], sigX, sigY + 4)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 110)
  doc.text(model.company.authorizedSignatory ?? 'Authorized signatory', sigX, sigY + 8)

  // ---------- page numbers ----------
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.4)
    doc.setTextColor(148, 163, 158)
    doc.text(`Page ${i} of ${pages}`, pageW / 2, doc.internal.pageSize.getHeight() - 6, { align: 'center' })
    doc.text('Generated by InvoiceFlow — local-first invoicing', marginX, doc.internal.pageSize.getHeight() - 6)
  }

  return doc
}

export function pdfToBlobUrl(doc: jsPDF): string {
  return doc.output('bloburl').toString()
}

export function downloadPdf(doc: jsPDF, fileName: string): void {
  doc.save(fileName)
}
