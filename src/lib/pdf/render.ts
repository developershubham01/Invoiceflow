// InvoiceFlow — PDF renderer (CANON §13, docs/14-PDF-GENERATION.md)
// jsPDF + jspdf-autotable: deterministic vector output, offline, A4.
// Templates: the visual identity (header layout + color theme) comes from the
// company profile per document kind (lib/domain/doc-templates.ts).
// Limitation: core fonts lack the ₹ glyph → amounts render as "Rs." (documented).

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { UnifiedDocumentModel } from './document-model'
import { amountInWords, formatMoneyPlain, formatQty } from '@/lib/domain/money'
import { stateNameByCode } from '@/lib/domain/gst'
import { formatDateDisplay } from '@/lib/date'
import { getDocTemplate, type DocTemplate, type DocTheme } from '@/lib/domain/doc-templates'

interface Ctx {
  doc: jsPDF
  model: UnifiedDocumentModel
  tpl: DocTemplate
  th: DocTheme
  pageW: number
  pageH: number
  ml: number // left content margin (widened for the sidebar layout)
  mr: number
}

const WHITE: [number, number, number] = [255, 255, 255]
const DARK: [number, number, number] = [51, 65, 85]

export function resolveTemplate(model: UnifiedDocumentModel): DocTemplate {
  const id = model.kind === 'INVOICE' ? model.company.invoiceTemplate : model.company.quotationTemplate
  return getDocTemplate(id)
}

export function renderDocumentPdf(model: UnifiedDocumentModel): jsPDF {
  const tpl = resolveTemplate(model)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const ctx: Ctx = {
    doc,
    model,
    tpl,
    th: tpl.theme,
    pageW,
    pageH,
    ml: tpl.layout === 'sidebar' ? 22 : 14,
    mr: 14,
  }

  let y = drawHeader(ctx)

  y = drawBillTo(ctx, y)
  y = drawItems(ctx, y)
  y = drawTotals(ctx, y)
  y = drawWordsBankNotes(ctx, y)
  drawTermsSignature(ctx, y)
  drawDecorations(ctx)

  return doc
}

// ---------------------------------------------------------------- shared data

function companyLines(ctx: Ctx): string[] {
  const c = ctx.model.company
  return [
    ...c.addressLines.slice(0, 2),
    c.gstin ? `GSTIN: ${c.gstin}` : null,
    c.pan ? `PAN: ${c.pan}` : null,
    c.phone ? `Phone: ${c.phone}` : null,
    c.email ? `Email: ${c.email}` : null,
  ].filter((x): x is string => Boolean(x))
}

function dateLines(ctx: Ctx): string[] {
  const m = ctx.model
  const fmt = (d: string) => formatDateDisplay(d, m.company.dateFormat)
  const out = [`Date: ${fmt(m.date)}`]
  if (m.dueDate) out.push(`Due: ${fmt(m.dueDate)}`)
  if (m.validUntil) out.push(`Valid until: ${fmt(m.validUntil)}`)
  return out
}

function docTitle(ctx: Ctx): string {
  return ctx.model.kind === 'INVOICE' ? 'TAX INVOICE' : 'QUOTATION'
}

function drawLogo(ctx: Ctx, x: number, y: number, size = 14): boolean {
  if (!ctx.model.company.logoData) return false
  try {
    const fmt = ctx.model.company.logoData.includes('image/png') ? 'PNG' : 'JPEG'
    ctx.doc.addImage(ctx.model.company.logoData, fmt, x, y, size, size)
    return true
  } catch {
    return false // invalid image data — skip gracefully
  }
}

function initials(ctx: Ctx): string {
  return ctx.model.company.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'IF'
}

// ------------------------------------------------------------------- headers

function drawHeader(ctx: Ctx): number {
  switch (ctx.tpl.layout) {
    case 'band': return drawBandHeader(ctx)
    case 'block': return drawBlockHeader(ctx)
    case 'sidebar': return drawSidebarHeader(ctx)
    case 'centered': return drawCenteredHeader(ctx)
    case 'corner': return drawCornerHeader(ctx)
    case 'split': return drawSplitHeader(ctx)
    case 'minimal': return drawMinimalHeader(ctx)
    case 'stack': return drawStackHeader(ctx)
  }
}

/** Classic: slim top accent strip, company left, title right. */
function drawBandHeader(ctx: Ctx): number {
  const { doc, th, ml, pageW } = ctx
  const base = ctx.tpl.serif ? 'times' : 'helvetica'
  const y = 16
  doc.setFillColor(...th.accent)
  doc.rect(0, 0, pageW, 4, 'F')

  const hasLogo = drawLogo(ctx, ml, y)
  const textX = ml + (hasLogo ? 18 : 0)
  doc.setFont(base, 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...th.accentDark)
  doc.text(doc.splitTextToSize(ctx.model.company.name, 90)[0], textX, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...th.muted)
  companyLines(ctx).slice(0, 4).forEach((line, i) => doc.text(line, textX, y + 9 + i * 3.6))

  doc.setFont(base, 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...th.accent)
  doc.text(docTitle(ctx), pageW - ctx.mr, y + 5, { align: 'right' })
  doc.setFontSize(8.5)
  doc.setTextColor(...DARK)
  doc.text(`No. ${ctx.model.number}`, pageW - ctx.mr, y + 10.5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...th.muted)
  dateLines(ctx).forEach((line, i) => doc.text(line, pageW - ctx.mr, y + 14.5 + i * 3.5, { align: 'right' }))

  return y + (hasLogo ? 22 : 24)
}

/** Full-width dark header block, white type, accent title. */
function drawBlockHeader(ctx: Ctx): number {
  const { doc, th, ml, pageW } = ctx
  const base = ctx.tpl.serif ? 'times' : 'helvetica'
  const blockH = 30
  doc.setFillColor(...th.accentDark)
  doc.rect(0, 0, pageW, blockH, 'F')

  const hasLogo = drawLogo(ctx, ml, 8)
  const textX = ml + (hasLogo ? 18 : 0)
  doc.setFont(base, 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...WHITE)
  doc.text(doc.splitTextToSize(ctx.model.company.name, 88)[0], textX, 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(203, 213, 225)
  companyLines(ctx).slice(0, 3).forEach((line, i) => doc.text(line, textX, 17.5 + i * 3.6))

  doc.setFont(base, 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...th.accent)
  doc.text(docTitle(ctx), pageW - ctx.mr, 13, { align: 'right' })
  doc.setFontSize(8.5)
  doc.setTextColor(...WHITE)
  doc.text(`No. ${ctx.model.number}`, pageW - ctx.mr, 18, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(203, 213, 225)
  dateLines(ctx).slice(0, 2).forEach((line, i) => doc.text(line, pageW - ctx.mr, 22.4 + i * 3.5, { align: 'right' }))

  return blockH + 8
}

/** Vertical accent strip down the left edge (redrawn on every page). */
function drawSidebarHeader(ctx: Ctx): number {
  const { doc, th, ml, pageW } = ctx
  const base = ctx.tpl.serif ? 'times' : 'helvetica'
  const y = 16
  const hasLogo = drawLogo(ctx, ml, y, 13)
  const textX = ml + (hasLogo ? 17 : 0)
  doc.setFont(base, 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...th.accentDark)
  doc.text(doc.splitTextToSize(ctx.model.company.name, 85)[0], textX, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...th.muted)
  companyLines(ctx).slice(0, 4).forEach((line, i) => doc.text(line, textX, y + 9 + i * 3.6))

  doc.setFont(base, 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...th.accent)
  doc.text(docTitle(ctx), pageW - ctx.mr, y + 5, { align: 'right' })
  doc.setFontSize(8.5)
  doc.setTextColor(...DARK)
  doc.text(`No. ${ctx.model.number}`, pageW - ctx.mr, y + 10.5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...th.muted)
  dateLines(ctx).forEach((line, i) => doc.text(line, pageW - ctx.mr, y + 14.5 + i * 3.5, { align: 'right' }))

  const ruleY = y + 26
  doc.setDrawColor(...th.line)
  doc.setLineWidth(0.3)
  doc.line(ml, ruleY, pageW - ctx.mr, ruleY)
  doc.setLineWidth(0.2)
  return ruleY + 6
}

/** Centered letterhead: name, contact line, centered title between rules. */
function drawCenteredHeader(ctx: Ctx): number {
  const { doc, th, ml, pageW } = ctx
  const base = ctx.tpl.serif ? 'times' : 'helvetica'
  const cx = pageW / 2
  const cw = pageW - ml - ctx.mr
  let y = 16

  doc.setFont(base, 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...th.accentDark)
  doc.text(doc.splitTextToSize(ctx.model.company.name, cw)[0], cx, y + 5, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(...th.muted)
  const contact = companyLines(ctx).join('  ·  ')
  const contactLines = doc.splitTextToSize(contact, cw)
  doc.text(contactLines, cx, y + 9.5, { align: 'center' })
  y += 9.5 + contactLines.length * 3.4 + 3

  doc.setFont(base, 'bold')
  doc.setFontSize(13.5)
  doc.setTextColor(...th.accent)
  doc.text(docTitle(ctx), cx, y + 3, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...DARK)
  doc.text(`No. ${ctx.model.number}`, cx, y + 7.5, { align: 'center' })
  doc.setTextColor(...th.muted)
  doc.setFontSize(8)
  const dateLine = dateLines(ctx).join('   ·   ')
  doc.text(dateLine, cx, y + 11.2, { align: 'center' })
  y += 14.5

  doc.setDrawColor(...th.accent)
  doc.setLineWidth(0.7)
  doc.line(ml, y, pageW - ctx.mr, y)
  doc.setDrawColor(...th.line)
  doc.setLineWidth(0.3)
  doc.line(ml, y + 1.4, pageW - ctx.mr, y + 1.4)
  doc.setLineWidth(0.2)
  return y + 7
}

/** Corner brand block with initials/logo and an accent rule. */
function drawCornerHeader(ctx: Ctx): number {
  const { doc, th, ml, pageW } = ctx
  const base = ctx.tpl.serif ? 'times' : 'helvetica'
  const y = 15

  doc.setFillColor(...th.accent)
  doc.roundedRect(ml, y, 16, 16, 2.4, 2.4, 'F')
  if (!drawLogo(ctx, ml + 2.2, y + 2.2, 11.6)) {
    doc.setFont(base, 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...WHITE)
    doc.text(initials(ctx), ml + 8, y + 10.2, { align: 'center' })
  }
  const textX = ml + 20
  doc.setFont(base, 'bold')
  doc.setFontSize(14.5)
  doc.setTextColor(...th.accentDark)
  doc.text(doc.splitTextToSize(ctx.model.company.name, 78)[0], textX, y + 5.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(...th.muted)
  companyLines(ctx).slice(0, 3).forEach((line, i) => doc.text(line, textX, y + 10 + i * 3.6))

  doc.setFont(base, 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...th.accent)
  doc.text(docTitle(ctx), pageW - ctx.mr, y + 5, { align: 'right' })
  doc.setFontSize(8.5)
  doc.setTextColor(...DARK)
  doc.text(`No. ${ctx.model.number}`, pageW - ctx.mr, y + 10.5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...th.muted)
  dateLines(ctx).forEach((line, i) => doc.text(line, pageW - ctx.mr, y + 14.5 + i * 3.5, { align: 'right' }))

  doc.setDrawColor(...th.accent)
  doc.setLineWidth(0.8)
  doc.line(ml, y + 20.5, pageW - ctx.mr, y + 20.5)
  doc.setLineWidth(0.2)
  return y + 26.5
}

/** Two-tone letterhead: brand block flush left, contact details right. */
function drawSplitHeader(ctx: Ctx): number {
  const { doc, th, ml, pageW } = ctx
  const base = ctx.tpl.serif ? 'times' : 'helvetica'
  const blockW = 64
  const blockH = 30

  doc.setFillColor(...th.accent)
  doc.rect(0, 0, blockW, blockH, 'F')
  const hasLogo = drawLogo(ctx, ml, 6, 11)
  if (hasLogo) {
    doc.setFont(base, 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...WHITE)
    const nameLines = doc.splitTextToSize(ctx.model.company.name, blockW - ml - 8)
    doc.text(nameLines[0] ?? '', ml + 14, 12)
    if (nameLines[1]) {
      doc.setFontSize(8.5)
      doc.text(nameLines[1], ml + 14, 16)
    }
  } else {
    doc.setFont(base, 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...WHITE)
    const nameLines = doc.splitTextToSize(ctx.model.company.name, blockW - ml - 6)
    doc.text(nameLines.slice(0, 2), ml, 10, { baseline: 'top' })
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.4)
  doc.setTextColor(255, 228, 235)
  const biz = ctx.model.company.gstin ? `GSTIN: ${ctx.model.company.gstin}` : ''
  if (biz) doc.text(biz, ml, blockH - 4)

  const rightX = blockW + 8
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(...th.muted)
  companyLines(ctx)
    .filter((l) => !l.startsWith('GSTIN'))
    .slice(0, 4)
    .forEach((line, i) => doc.text(line, rightX, 9 + i * 3.6))

  let y = blockH + 7
  doc.setFont(base, 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...th.accentDark)
  doc.text(docTitle(ctx), ml, y)
  doc.setFontSize(8.5)
  doc.setTextColor(...DARK)
  doc.text(`No. ${ctx.model.number}`, pageW - ctx.mr, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...th.muted)
  dateLines(ctx).forEach((line, i) => doc.text(line, pageW - ctx.mr, y + 4.5 + i * 3.5, { align: 'right' }))
  y += 4.5 + dateLines(ctx).length * 3.5 + 2

  doc.setDrawColor(...th.line)
  doc.setLineWidth(0.3)
  doc.line(ml, y, pageW - ctx.mr, y)
  doc.setLineWidth(0.2)
  return y + 6
}

/** Minimal ink-saver: heavy top rule, no fills, generous whitespace. */
function drawMinimalHeader(ctx: Ctx): number {
  const { doc, th, ml, pageW } = ctx
  const base = ctx.tpl.serif ? 'times' : 'helvetica'
  const y = 18

  doc.setDrawColor(...th.accent)
  doc.setLineWidth(1.1)
  doc.line(ml, 12, pageW - ctx.mr, 12)
  doc.setLineWidth(0.2)

  const hasLogo = drawLogo(ctx, ml, y, 13)
  const textX = ml + (hasLogo ? 17 : 0)
  doc.setFont(base, 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...th.accentDark)
  doc.text(doc.splitTextToSize(ctx.model.company.name, 90)[0], textX, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(...th.muted)
  companyLines(ctx).slice(0, 3).forEach((line, i) => doc.text(line, textX, y + 9 + i * 3.5))

  doc.setFont(base, 'bold')
  doc.setFontSize(12.5)
  doc.setTextColor(...th.accentDark)
  doc.text(docTitle(ctx), pageW - ctx.mr, y + 5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...DARK)
  doc.text(`No. ${ctx.model.number}`, pageW - ctx.mr, y + 9.5, { align: 'right' })
  doc.setTextColor(...th.muted)
  doc.setFontSize(8)
  dateLines(ctx).forEach((line, i) => doc.text(line, pageW - ctx.mr, y + 13 + i * 3.4, { align: 'right' }))

  const ruleY = y + 20
  doc.setDrawColor(...th.line)
  doc.setLineWidth(0.3)
  doc.line(ml, ruleY, pageW - ctx.mr, ruleY)
  doc.setLineWidth(0.2)
  return ruleY + 7
}

/** Full-width accent banner under a slim info row. */
function drawStackHeader(ctx: Ctx): number {
  const { doc, th, ml, pageW } = ctx
  const base = ctx.tpl.serif ? 'times' : 'helvetica'
  const y = 14
  const cw = pageW - ml - ctx.mr

  const hasLogo = drawLogo(ctx, ml, y, 12)
  const textX = ml + (hasLogo ? 16 : 0)
  doc.setFont(base, 'bold')
  doc.setFontSize(13.5)
  doc.setTextColor(...th.accentDark)
  doc.text(doc.splitTextToSize(ctx.model.company.name, 95)[0], textX, y + 4.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.6)
  doc.setTextColor(...th.muted)
  companyLines(ctx).slice(0, 2).forEach((line, i) => doc.text(line, textX, y + 8 + i * 3.4))

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...th.muted)
  dateLines(ctx).forEach((line, i) => doc.text(line, pageW - ctx.mr, y + 4.5 + i * 3.4, { align: 'right' }))

  const bannerY = y + 16
  doc.setFillColor(...th.accent)
  doc.rect(ml, bannerY, cw, 9, 'F')
  doc.setFont(base, 'bold')
  doc.setFontSize(12.5)
  doc.setTextColor(...WHITE)
  doc.text(docTitle(ctx), ml + 3, bannerY + 6)
  doc.setFontSize(8.5)
  doc.text(`No. ${ctx.model.number}`, pageW - ctx.mr - 3, bannerY + 6, { align: 'right' })
  doc.setFillColor(...th.accentDark)
  doc.rect(ml, bannerY + 9, cw, 0.9, 'F')

  return bannerY + 15.5
}

// ---------------------------------------------------------------- body blocks

function drawBillTo(ctx: Ctx, y: number): number {
  const { doc, th, ml, pageW, model } = ctx
  doc.setDrawColor(...th.line)
  doc.setFillColor(...th.headFill)
  doc.roundedRect(ml, y, pageW - ml - ctx.mr, 26, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...th.muted)
  doc.text('BILL TO', ml + 4, y + 5.5)
  doc.setFontSize(10.5)
  doc.setTextColor(...th.accentDark)
  doc.text(doc.splitTextToSize(model.customer.name, 95)[0], ml + 4, y + 11)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...th.muted)
  let by = y + 15.5
  for (const line of model.customer.addressLines.slice(0, 2)) {
    doc.text(line, ml + 4, by)
    by += 3.6
  }
  if (model.customer.gstin) doc.text(`GSTIN: ${model.customer.gstin}`, ml + 4, by)

  doc.text('Place of supply', pageW - ctx.mr - 4, y + 5.5, { align: 'right' })
  doc.setTextColor(...DARK)
  doc.text(stateNameByCode(model.placeOfSupply) || model.placeOfSupply, pageW - ctx.mr - 4, y + 10, { align: 'right' })
  doc.setTextColor(...th.muted)
  doc.text(model.taxMode === 'INTER' ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)', pageW - ctx.mr - 4, y + 14.5, { align: 'right' })
  if (model.status !== 'DRAFT') {
    doc.text(`Status: ${model.status.replace(/_/g, ' ')}`, pageW - ctx.mr - 4, y + 19, { align: 'right' })
  }
  return y + 32
}

function drawItems(ctx: Ctx, y: number): number {
  const { doc, th, ml, mr, pageW, model, tpl } = ctx
  const intra = model.taxMode === 'INTRA'
  const head = [[
    '#', 'Item & description', 'HSN/SAC', 'Qty', 'Rate', 'Disc',
    'Taxable', intra ? 'CGST' : 'IGST', intra ? 'SGST' : '', 'Amount',
  ].filter((h) => h !== '')]
  const body = model.items.map((it) => {
    const row: string[] = [
      String(it.position),
      it.description,
      it.hsnSac ?? '—',
      `${formatQty(it.qtyMilli)}${it.unit ? ` ${it.unit}` : ''}`,
      formatMoneyPlain(it.unitPricePaise),
      it.discountBps > 0 ? `${(it.discountBps / 100).toFixed(1)}%` : '—',
      formatMoneyPlain(it.taxablePaise),
      formatMoneyPlain(intra ? it.cgstPaise : it.igstPaise),
    ]
    if (intra) row.push(formatMoneyPlain(it.sgstPaise))
    row.push(formatMoneyPlain(it.totalPaise))
    return row
  })

  const headStyles: Record<string, unknown> = { fontStyle: 'bold', fontSize: 7.4 }
  let headBottom = 0
  if (tpl.tableHead === 'accent') {
    headStyles.fillColor = th.accentDark
    headStyles.textColor = WHITE
  } else if (tpl.tableHead === 'rule') {
    headStyles.fillColor = WHITE
    headStyles.textColor = th.accentDark
  } else {
    headStyles.fillColor = th.headFill
    headStyles.textColor = th.accentDark
  }

  autoTable(doc, {
    head,
    body,
    startY: y,
    margin: { left: ml, right: mr, top: 16, bottom: 14 },
    styles: { font: 'helvetica', fontSize: 7.6, cellPadding: 1.8, textColor: DARK, lineColor: th.line, lineWidth: 0.1 },
    headStyles: headStyles as never,
    alternateRowStyles: { fillColor: th.zebra },
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
    didDrawCell: (data) => {
      if (data.section === 'head') headBottom = Math.max(headBottom, data.cell.y + data.cell.height)
    },
  })

  if (tpl.tableHead === 'rule' && headBottom > 0) {
    doc.setDrawColor(...th.accent)
    doc.setLineWidth(0.7)
    doc.line(ml, headBottom, pageW - mr, headBottom)
    doc.setLineWidth(0.2)
  }

  // @ts-expect-error lastAutoTable is attached by autoTable
  return (doc.lastAutoTable?.finalY ?? y) + 6
}

function drawTotals(ctx: Ctx, y: number): number {
  const { doc, th, ml, mr, pageW, pageH, model } = ctx
  const t = model.totals
  const intra = model.taxMode === 'INTRA'
  const rows: Array<[string, string]> = []
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
  let boxY = Math.min(y, pageH - ml - boxH)
  const boxX = pageW - mr - boxW

  if (boxY < y) {
    doc.addPage()
    y = ml + 4
    boxY = y
  }

  rows.forEach(([label, value], i) => {
    const ry = boxY + i * rowH
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.4)
    doc.setTextColor(...th.muted)
    doc.text(label, boxX + 2, ry)
    doc.setTextColor(...DARK)
    doc.text(value, pageW - mr - 2, ry, { align: 'right' })
  })
  let ny = boxY + rows.length * rowH + 2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  if (ctx.tpl.totals === 'outline') {
    doc.setDrawColor(...th.accent)
    doc.setFillColor(...WHITE)
    doc.setLineWidth(0.55)
    doc.roundedRect(boxX, ny, boxW, 10, 1.5, 1.5, 'FD')
    doc.setLineWidth(0.2)
    doc.setTextColor(...th.accent)
    doc.text('GRAND TOTAL', boxX + 2, ny + 6.6)
    doc.setTextColor(...th.accentDark)
    doc.text(`Rs. ${formatMoneyPlain(t.grandTotalPaise)}`, pageW - mr - 2, ny + 6.6, { align: 'right' })
  } else if (ctx.tpl.totals === 'dark') {
    doc.setFillColor(...th.accentDark)
    doc.roundedRect(boxX, ny, boxW, 10, 1.5, 1.5, 'F')
    doc.setFillColor(...th.accent)
    doc.rect(boxX, ny + 9.2, boxW, 0.8, 'F')
    doc.setTextColor(...th.totalText)
    doc.text('GRAND TOTAL', boxX + 2, ny + 6.6)
    doc.text(`Rs. ${formatMoneyPlain(t.grandTotalPaise)}`, pageW - mr - 2, ny + 6.6, { align: 'right' })
  } else {
    doc.setFillColor(...th.totalFill)
    doc.roundedRect(boxX, ny, boxW, 10, 1.5, 1.5, 'F')
    doc.setTextColor(...th.totalText)
    doc.text('GRAND TOTAL', boxX + 2, ny + 6.6)
    doc.text(`Rs. ${formatMoneyPlain(t.grandTotalPaise)}`, pageW - mr - 2, ny + 6.6, { align: 'right' })
  }
  ny += 14

  if (model.kind === 'INVOICE' && typeof t.paidTotalPaise === 'number') {
    const balance = Math.max(0, t.grandTotalPaise - t.paidTotalPaise)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.4)
    doc.setTextColor(...th.muted)
    doc.text(`Amount paid: Rs. ${formatMoneyPlain(t.paidTotalPaise)}   ·   Balance due: Rs. ${formatMoneyPlain(balance)}`, ml, ny)
    ny += 5
  }
  return ny
}

function drawWordsBankNotes(ctx: Ctx, y: number): number {
  const { doc, th, ml, mr, pageW, pageH, model } = ctx
  let ny = y

  // amount in words (left of the totals column)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...th.muted)
  const words = doc.splitTextToSize(`Amount in words: ${amountInWords(model.totals.grandTotalPaise)}`, pageW - ml - mr - 84)
  doc.text(words, ml, ny)
  ny += words.length * 3.6 + 4

  // bank + UPI QR
  const upiQr = model.kind === 'INVOICE' ? model.upiQr : null
  const qrSize = upiQr ? 27 : 0
  const textWidth = pageW - ml - mr - (qrSize > 0 ? qrSize - 6 : 0)

  if (model.kind === 'INVOICE' && model.company.bank) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...th.accentDark)
    doc.text('Bank details', ml, ny)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...th.muted)
    const b = model.company.bank
    const bankLine = doc.splitTextToSize(`${b.name}${b.branch ? `, ${b.branch}` : ''}  ·  A/C: ${b.account}  ·  IFSC: ${b.ifsc}`, textWidth)
    doc.text(bankLine, ml, ny + 3.8)
    ny += 4 + bankLine.length * 3.6
  }
  if (upiQr) {
    if (ny + qrSize + 12 > pageH - ml) {
      doc.addPage()
      ny = ml + 4
    }
    const qrX = pageW - mr - qrSize
    doc.addImage(upiQr.dataUrl, 'PNG', qrX, ny, qrSize, qrSize)
    doc.setDrawColor(...th.line)
    doc.roundedRect(qrX - 1.2, ny - 1.2, qrSize + 2.4, qrSize + 2.4, 1.4, 1.4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.2)
    doc.setTextColor(...th.accentDark)
    doc.text('Scan to pay via UPI', qrX + qrSize / 2, ny + qrSize + 4.6, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.6)
    doc.setTextColor(...th.muted)
    doc.text(upiQr.vpa, qrX + qrSize / 2, ny + qrSize + 8.2, { align: 'center' })
    ny += qrSize + 11
  }
  if (model.notes) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...th.accentDark)
    doc.text('Notes', ml, ny)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...th.muted)
    const lines = doc.splitTextToSize(model.notes, pageW - ml - mr)
    doc.text(lines, ml, ny + 3.8)
    ny += 4 + lines.length * 3.6
  }
  return ny
}

function drawTermsSignature(ctx: Ctx, y: number): void {
  const { doc, th, ml, mr, pageW, pageH, model } = ctx
  const termsLines = model.terms ? doc.splitTextToSize(model.terms, pageW / 2 - ml) : []
  const needH = termsLines.length * 3.4 + 26
  let ny = y
  if (ny + needH > pageH - ml) {
    doc.addPage()
    ny = ml + 4
  }
  if (model.terms) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...th.accentDark)
    doc.text('Terms & conditions', ml, ny)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.4)
    doc.setTextColor(...th.muted)
    doc.text(termsLines, ml, ny + 3.8)
  }

  const sigX = pageW - mr - 46
  let sigY = ny + 4
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
  doc.setDrawColor(...th.line)
  doc.setLineWidth(0.3)
  doc.line(sigX, sigY, sigX + 44, sigY)
  doc.setLineWidth(0.2)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...th.accentDark)
  doc.text('For ' + doc.splitTextToSize(model.company.name, 46)[0], sigX, sigY + 4)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...th.muted)
  doc.text(model.company.authorizedSignatory ?? 'Authorized signatory', sigX, sigY + 8)
}

/** Page-level chrome: page numbers, brand footer, sidebar strip on every page. */
function drawDecorations(ctx: Ctx): void {
  const { doc, th, ml, pageW, pageH, tpl } = ctx
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    if (tpl.layout === 'sidebar') {
      doc.setFillColor(...th.accent)
      doc.rect(0, 0, 5, pageH, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.4)
    doc.setTextColor(...th.muted)
    doc.text(`Page ${i} of ${pages}`, pageW / 2, pageH - 6, { align: 'center' })
    doc.text('Generated by InvoiceFlow — local-first invoicing', ml, pageH - 6)
  }
}

export function pdfToBlobUrl(doc: jsPDF): string {
  return doc.output('bloburl').toString()
}

export function downloadPdf(doc: jsPDF, fileName: string): void {
  doc.save(fileName)
}
