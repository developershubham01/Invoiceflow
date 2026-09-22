// InvoiceFlow — Sync server op application (CANON §9)
// Server rules: idempotency (ProcessedOp) → membership/role check → Zod validation →
// CAS version check → RECOMPUTE all financial totals from shared domain engine →
// authoritative number allocation → ChangeLog entry. Never trust client arithmetic.

import { db as prisma } from '@/lib/db'
import { computeDocumentTotals, type DocItemInput } from '@/lib/domain/documents'
import { fiscalYearOf, formatDocNumber, provisionalNumber } from '@/lib/domain/numbering'
import { orNull } from '@/lib/domain/schemas'
import type { DocCharge } from '@/lib/domain/types'

export interface OpInput {
  op_id: string
  entity: string
  entity_id: string
  action: 'upsert' | 'finalize' | 'cancel' | 'delete'
  base_version: number
  payload: Record<string, unknown>
}

export type OpOutcome =
  | { op_id: string; status: 'applied' | 'duplicate' | 'conflict' | 'rejected' | 'number_reassigned'; record?: unknown; error?: string }

type Json = Record<string, unknown>

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function nowDate(): Date {
  return new Date()
}

function parseItems(payload: Json): DocItemInput[] {
  const items = Array.isArray(payload.items) ? payload.items : []
  return items.map((raw) => {
    const it = raw as Json
    return {
      id: str(it.id) ?? crypto.randomUUID(),
      description: str(it.description) ?? '',
      hsn_sac: str(it.hsn_sac),
      qty_milli: num(it.qty_milli),
      unit: str(it.unit),
      unit_price_paise: num(it.unit_price_paise),
      discount_bps: num(it.discount_bps),
      gst_rate_bps: num(it.gst_rate_bps, 1800),
    }
  })
}

function parseCharges(payload: Json): DocCharge[] {
  // charges arrive either as an array or as a serialized charges_json string (Dexie row form)
  const rawCharges = Array.isArray(payload.charges_json)
    ? payload.charges_json
    : Array.isArray(payload.charges)
      ? payload.charges
      : typeof payload.charges_json === 'string'
        ? safeParseJson(payload.charges_json)
        : []
  const charges = Array.isArray(rawCharges) ? rawCharges : []
  return charges.map((raw) => {
    const c = raw as Json
    return {
      id: str(c.id) ?? crypto.randomUUID(),
      label: str(c.label) ?? 'Charge',
      amount_paise: num(c.amount_paise),
      taxable: bool(c.taxable),
      gst_rate_bps: num(c.gst_rate_bps, 1800),
    }
  })
}

function safeParseJson(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}

/** Recompute document totals from shared domain engine; returns canonical (snake_case) record. */
async function recomputeDocument(workspaceId: string, payload: Json, entity: 'invoice' | 'quotation') {
  const items = parseItems(payload)
  if (items.length === 0) return { error: 'Document requires at least one line item' as const }
  const charges = parseCharges(payload)
  const company = await prisma.companyProfile.findFirst({ where: { workspaceId, deletedAt: null } })
  const supplierState = company?.stateCode ?? null
  const placeOfSupply = str(payload.place_of_supply_code)
  const priceIncludesTax = bool(payload.price_includes_tax)
  const enableRoundOff = company?.enableRoundOff ?? true
  const totals = computeDocumentTotals({
    items,
    charges,
    price_includes_tax: priceIncludesTax,
    supplier_state_code: supplierState,
    place_of_supply_code: placeOfSupply,
    enable_round_off: enableRoundOff,
  })
  const customerId = str(payload.customer_id)
  if (!customerId) return { error: 'Customer is required' as const }
  const customer = await prisma.customer.findFirst({ where: { id: customerId, workspaceId } })
  if (!customer) return { error: 'Customer not found in this workspace' as const }
  const dateStr = str(payload.invoice_date) ?? str(payload.quotation_date)
  if (!dateStr) return { error: 'Document date is required' as const }

  const canonical: Json = {
    id: str(payload.id) ?? crypto.randomUUID(),
    workspace_id: workspaceId,
    number: str(payload.number) ?? provisionalNumber(),
    status: ['DRAFT', 'CONVERTED'].includes(str(payload.status) ?? '') ? (str(payload.status) as string) : 'DRAFT',
    [entity === 'invoice' ? 'invoice_date' : 'quotation_date']: dateStr,
    [entity === 'invoice' ? 'due_date' : 'valid_until']: str(payload.due_date) ?? str(payload.valid_until),
    customer_id: customerId,
    customer_name_snapshot: customer.businessName,
    customer_gstin_snapshot: customer.gstin,
    place_of_supply_code: placeOfSupply,
    tax_mode: supplierState && placeOfSupply && supplierState !== placeOfSupply ? 'INTER' : 'INTRA',
    price_includes_tax: priceIncludesTax,
    subtotal_gross_paise: totals.subtotal_gross_paise,
    discount_total_paise: totals.discount_total_paise,
    taxable_total_paise: totals.taxable_total_paise,
    cgst_paise: totals.cgst_paise,
    sgst_paise: totals.sgst_paise,
    igst_paise: totals.igst_paise,
    charges_total_paise: totals.charges_total_paise,
    charges_tax_paise: totals.charges_tax_paise,
    round_off_paise: totals.round_off_paise,
    grand_total_paise: totals.grand_total_paise,
    charges_json: JSON.stringify(charges),
    notes: str(payload.notes),
    terms: str(payload.terms),
    created_at: str(payload.created_at) ?? nowDate().toISOString(),
    updated_at: nowDate().toISOString(),
    deleted_at: str(payload.deleted_at) ?? null,
    origin_device_id: str(payload.origin_device_id),
  }
  const itemsCanonical = totals.lines.map((l, idx) => ({
    id: l.item.id,
    [entity === 'invoice' ? 'invoice_id' : 'quotation_id']: canonical.id,
    workspace_id: workspaceId,
    position: idx + 1,
    description: l.item.description,
    hsn_sac: l.item.hsn_sac ?? null,
    qty_milli: l.item.qty_milli,
    unit: l.item.unit ?? null,
    unit_price_paise: l.item.unit_price_paise,
    discount_bps: l.item.discount_bps,
    gst_rate_bps: l.item.gst_rate_bps,
    gross_paise: l.gross_paise,
    discount_paise: l.discount_paise,
    taxable_paise: l.taxable_paise,
    cgst_paise: l.cgst_paise,
    sgst_paise: l.sgst_paise,
    igst_paise: l.igst_paise,
    tax_paise: l.tax_paise,
    total_paise: l.total_paise,
    price_includes_tax: priceIncludesTax,
  }))
  return { canonical, items: itemsCanonical, itemsForPrisma: parseItems(payload) }
}

/** Items from the payload, or (for status/payment-driven upserts) the stored server items. */
async function resolveItems(
  payload: Json,
  existing: { items: Array<Record<string, unknown>> } | null,
  fk: 'invoice_id' | 'quotation_id',
): Promise<DocItemInput[]> {
  if (Array.isArray(payload.items) && payload.items.length > 0) return parseItems(payload)
  if (existing && existing.items.length > 0) {
    return existing.items.map((it) => ({
      id: String(it.id),
      description: String(it.description),
      hsn_sac: (it.hsnSac as string | null) ?? null,
      qty_milli: Number(it.qtyMilli ?? 0),
      unit: (it.unit as string | null) ?? null,
      unit_price_paise: Number(it.unitPricePaise ?? 0),
      discount_bps: Number(it.discountBps ?? 0),
      gst_rate_bps: Number(it.gstRateBps ?? 1800),
      // items keep their canonical id; fk resolved by caller mapping below
      ...(fk === 'invoice_id' ? {} : {}),
    })) as DocItemInput[]
  }
  return []
}

async function allocateNumber(workspaceId: string, docType: 'INVOICE' | 'QUOTATION', prefix: string, onDate: string): Promise<string> {
  const fy = fiscalYearOf(onDate)
  const existing = await prisma.documentSequence.findUnique({
    where: { workspaceId_docType_fiscalYear: { workspaceId, docType, fiscalYear: fy } },
  })
  let seq: number
  if (existing) {
    const updated = await prisma.documentSequence.update({
      where: { id: existing.id },
      data: { nextSeq: { increment: 1 } },
      select: { nextSeq: true },
    })
    seq = updated.nextSeq - 1
  } else {
    await prisma.documentSequence.create({ data: { workspaceId, docType, fiscalYear: fy, nextSeq: 2 } })
    seq = 1
  }
  return formatDocNumber(prefix, fy, seq)
}

async function writeChangeLog(workspaceId: string, entity: string, entityId: string, op: string, payload: unknown): Promise<void> {
  await prisma.changeLog.create({
    data: { workspaceId, entity, entityId, op, payload: JSON.stringify(payload) },
  })
}

function meta(record: Json, payload: Json, newVersion: number) {
  return {
    id: String(record.id),
    version: newVersion,
    createdAt: new Date(String(record.created_at ?? nowDate().toISOString())),
    updatedAt: nowDate(),
    deletedAt: record.deleted_at ? new Date(String(record.deleted_at)) : null,
    originDeviceId: str(payload.origin_device_id),
  }
}

/** Apply a single sync op. All financial math is recomputed here. */
export async function applyOp(workspaceId: string, role: string, op: OpInput): Promise<OpOutcome> {
  if (role === 'VIEWER') {
    return { op_id: op.op_id, status: 'rejected', error: 'Viewers cannot modify workspace data' }
  }

  // Idempotency: replay of an already-processed op returns the stored outcome —
  // unless the stored outcome was a rejection/conflict, which must stay retryable.
  const processed = await prisma.processedOp.findUnique({ where: { opId: op.op_id } })
  if (processed) {
    const prior = JSON.parse(processed.result || '{}') as OpOutcome
    if (prior.status === 'applied' || prior.status === 'number_reassigned') {
      return { ...prior, op_id: op.op_id, status: 'duplicate' }
    }
    // rejected/conflict stored outcome → fall through and re-attempt
  }

  const result = await applyOpInner(workspaceId, op)
  // Idempotency store: only successful (or already-duplicate) outcomes are remembered.
  // Rejections/conflicts remain retryable after the user fixes the underlying issue.
  if (result.status === 'applied' || result.status === 'number_reassigned' || result.status === 'duplicate') {
    await prisma.processedOp.create({
      data: { opId: op.op_id, workspaceId, result: JSON.stringify(result) },
    }).catch(() => undefined) // unique race → op was processed concurrently
  }
  return result
}

async function persistOutcome(op: OpInput, outcome: OpOutcome): Promise<OpOutcome> {
  // Update stored outcome for idempotent replays when it differs from initial processing.
  await prisma.processedOp.updateMany({
    where: { opId: op.op_id },
    data: { result: JSON.stringify(outcome) },
  }).catch(() => undefined)
  return outcome
}

async function applyOpInner(workspaceId: string, op: OpInput): Promise<OpOutcome> {
  const payload = op.payload ?? {}
  const entityId = op.entity_id

  switch (op.entity) {
    // ---------------- company ----------------
    case 'company': {
      const existing = await prisma.companyProfile.findFirst({ where: { id: entityId, workspaceId } })
      if (existing && existing.version !== op.base_version) {
        return { op_id: op.op_id, status: 'conflict', record: existing }
      }
      const data = {
        workspaceId,
        name: str(payload.name) ?? 'Unnamed company',
        businessType: str(payload.business_type),
        logoData: str(payload.logo_data),
        addressLine1: str(payload.address_line1),
        addressLine2: str(payload.address_line2),
        city: str(payload.city),
        stateName: str(payload.state_name),
        stateCode: str(payload.state_code),
        pincode: str(payload.pincode),
        gstin: str(payload.gstin),
        pan: str(payload.pan),
        phone: str(payload.phone),
        email: str(payload.email),
        website: str(payload.website),
        bankName: str(payload.bank_name),
        bankAccount: str(payload.bank_account),
        bankIfsc: str(payload.bank_ifsc),
        bankBranch: str(payload.bank_branch),
        upiVpa: str(payload.upi_vpa),
        authorizedSignatory: str(payload.authorized_signatory),
        signatureData: str(payload.signature_data),
        invoicePrefix: str(payload.invoice_prefix) ?? 'INV',
        quotationPrefix: str(payload.quotation_prefix) ?? 'QT',
        invoiceNumberPattern: str(payload.invoice_number_pattern),
        quotationNumberPattern: str(payload.quotation_number_pattern),
        docDateFormat: str(payload.doc_date_format),
        invoiceTemplate: str(payload.invoice_template),
        quotationTemplate: str(payload.quotation_template),
        defaultGstRateBps: num(payload.default_gst_rate_bps, 1800),
        priceIncludesTax: bool(payload.price_includes_tax),
        enableRoundOff: bool(payload.enable_round_off, true),
        defaultTerms: str(payload.default_terms),
        defaultNotes: str(payload.default_notes),
        ...meta(payload as Json, payload as Json, (existing?.version ?? 0) + 1),
      }
      const saved = await prisma.companyProfile.upsert({
        where: { id: entityId },
        create: { ...data, id: entityId },
        update: data,
      })
      const canonical = { ...payload, version: saved.version, updated_at: saved.updatedAt.toISOString(), sync_state: 'synced' }
      await writeChangeLog(workspaceId, 'company', entityId, op.action, canonical)
      return { op_id: op.op_id, status: 'applied', record: canonical }
    }

    // ---------------- customer ----------------
    case 'customer': {
      const existing = await prisma.customer.findFirst({ where: { id: entityId, workspaceId } })
      if (existing && op.action === 'upsert' && !payload.deleted_at && existing.version !== op.base_version) {
        return { op_id: op.op_id, status: 'conflict', record: existing }
      }
      const version = (existing?.version ?? 0) + 1
      const data = {
        workspaceId,
        code: str(payload.code) ?? existing?.code ?? undefined,
        type: str(payload.type) === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'BUSINESS',
        businessName: str(payload.business_name) ?? 'Unnamed',
        contactPerson: str(payload.contact_person),
        email: str(payload.email),
        phone: str(payload.phone),
        gstin: str(payload.gstin),
        billingAddress: str(payload.billing_address),
        shippingAddress: str(payload.shipping_address),
        stateName: str(payload.state_name),
        stateCode: str(payload.state_code),
        notes: str(payload.notes),
        version,
        deletedAt: op.action === 'delete' || payload.deleted_at ? nowDate() : null,
        updatedAt: nowDate(),
        originDeviceId: str(payload.origin_device_id),
      }
      const saved = await prisma.customer.upsert({ where: { id: entityId }, create: { ...data, id: entityId, createdAt: nowDate() }, update: data })
      const canonical = { ...payload, version, deleted_at: saved.deletedAt?.toISOString() ?? null, updated_at: saved.updatedAt.toISOString(), sync_state: 'synced' }
      await writeChangeLog(workspaceId, 'customer', entityId, op.action, canonical)
      return { op_id: op.op_id, status: 'applied', record: canonical }
    }

    // ---------------- product ----------------
    case 'product': {
      const existing = await prisma.product.findFirst({ where: { id: entityId, workspaceId } })
      if (existing && op.action === 'upsert' && !payload.deleted_at && existing.version !== op.base_version) {
        return { op_id: op.op_id, status: 'conflict', record: existing }
      }
      const version = (existing?.version ?? 0) + 1
      const data = {
        workspaceId,
        name: str(payload.name) ?? 'Unnamed',
        sku: str(payload.sku),
        hsnSac: str(payload.hsn_sac),
        description: str(payload.description),
        unit: str(payload.unit) ?? 'NOS',
        sellingPricePaise: num(payload.selling_price_paise),
        costPricePaise: typeof payload.cost_price_paise === 'number' ? payload.cost_price_paise : null,
        gstRateBps: num(payload.gst_rate_bps, 1800),
        priceIncludesTax: bool(payload.price_includes_tax),
        active: bool(payload.active, true),
        version,
        deletedAt: op.action === 'delete' || payload.deleted_at ? nowDate() : null,
        updatedAt: nowDate(),
        originDeviceId: str(payload.origin_device_id),
      }
      const saved = await prisma.product.upsert({ where: { id: entityId }, create: { ...data, id: entityId, createdAt: nowDate() }, update: data })
      const canonical = { ...payload, version, deleted_at: saved.deletedAt?.toISOString() ?? null, updated_at: saved.updatedAt.toISOString(), sync_state: 'synced' }
      await writeChangeLog(workspaceId, 'product', entityId, op.action, canonical)
      return { op_id: op.op_id, status: 'applied', record: canonical }
    }

    // ---------------- payment ----------------
    case 'payment': {
      const existing = await prisma.payment.findFirst({ where: { id: entityId, workspaceId } })
      if (existing && existing.version !== op.base_version && op.action === 'upsert' && !payload.deleted_at) {
        return { op_id: op.op_id, status: 'conflict', record: existing }
      }
      const invoiceId = str(payload.invoice_id)
      if (!invoiceId) return { op_id: op.op_id, status: 'rejected', error: 'invoice_id is required' }
      const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId } })
      if (!invoice) return { op_id: op.op_id, status: 'rejected', error: 'Invoice not found in this workspace' }
      const amount = num(payload.amount_paise)
      if (amount <= 0) return { op_id: op.op_id, status: 'rejected', error: 'Payment amount must be > 0' }
      const version = (existing?.version ?? 0) + 1
      const data = {
        workspaceId,
        invoiceId,
        amountPaise: amount,
        paidAt: str(payload.paid_at) ?? nowDate().toISOString().slice(0, 10),
        method: str(payload.method) ?? 'BANK_TRANSFER',
        reference: str(payload.reference),
        notes: str(payload.notes),
        version,
        deletedAt: op.action === 'delete' || payload.deleted_at ? nowDate() : null,
        updatedAt: nowDate(),
        originDeviceId: str(payload.origin_device_id),
      }
      const saved = await prisma.payment.upsert({ where: { id: entityId }, create: { ...data, id: entityId, createdAt: nowDate() }, update: data })
      await recalcInvoicePaid(invoiceId)
      const canonical = { ...payload, version, updated_at: saved.updatedAt.toISOString(), sync_state: 'synced' }
      await writeChangeLog(workspaceId, 'payment', entityId, op.action, canonical)
      return { op_id: op.op_id, status: 'applied', record: canonical }
    }

    // ---------------- invoice ----------------
    case 'invoice': {
      const existing = await prisma.invoice.findFirst({ where: { id: entityId, workspaceId }, include: { items: true, payments: true } })
      const version = (existing?.version ?? 0) + 1

      if (op.action === 'finalize') {
        if (!existing) return { op_id: op.op_id, status: 'rejected', error: 'Invoice not found' }
        if (existing.status !== 'DRAFT') {
          return { op_id: op.op_id, status: 'conflict', record: prismaInvoiceToCanonical(existing) }
        }
        const payloadItems = Array.isArray(payload.items) ? payload.items : existing.items
        const recompute = await recomputeDocument(workspaceId, { ...payload, items: payloadItems, status: 'FINALIZED' }, 'invoice')
        if ('error' in recompute && recompute.error) return { op_id: op.op_id, status: 'rejected', error: recompute.error }
        const canonical = recompute.canonical! as Json
        const company = await prisma.companyProfile.findFirst({ where: { workspaceId, deletedAt: null } })
        let number = str(payload.number) ?? existing.number
        let reassigned = false
        if (!number || number.startsWith('DRAFT-') || provisional(number)) {
          number = await allocateNumber(workspaceId, 'INVOICE', company?.invoicePrefix ?? 'INV', String(canonical.invoice_date))
          reassigned = true
        } else if (number !== existing.number) {
          // Offline-allocated number: ensure it is not already taken
          const taken = await prisma.invoice.findFirst({ where: { workspaceId, number, id: { not: entityId } } })
          if (taken) {
            number = await allocateNumber(workspaceId, 'INVOICE', company?.invoicePrefix ?? 'INV', String(canonical.invoice_date))
            reassigned = true
          } else {
            await fastForwardSequence(workspaceId, 'INVOICE', company?.invoicePrefix ?? 'INV', number, String(canonical.invoice_date))
          }
        }
        canonical.number = number
        canonical.status = 'FINALIZED'
        canonical.finalized_at = nowDate().toISOString()
        canonical.version = version
        const prismaItems = canonicalItemsToPrisma(recompute.items!, 'invoiceId')
        const saved = await prisma.invoice.update({
          where: { id: entityId },
          data: {
            ...documentColumns(canonical),
            number,
            status: 'FINALIZED',
            finalizedAt: new Date(),
            version,
            updatedAt: nowDate(),
            items: { deleteMany: {}, create: prismaItems },
          },
          include: { items: true },
        })
        const responseCanonical = prismaInvoiceToCanonical(saved)
        await writeChangeLog(workspaceId, 'invoice', entityId, 'finalize', responseCanonical)
        const outcome: OpOutcome = { op_id: op.op_id, status: reassigned ? 'number_reassigned' : 'applied', record: responseCanonical }
        return await persistOutcome(op, outcome)
      }

      if (op.action === 'cancel') {
        if (!existing) return { op_id: op.op_id, status: 'rejected', error: 'Invoice not found' }
        if (existing.status !== 'FINALIZED' && existing.status !== 'PARTIALLY_PAID') {
          return { op_id: op.op_id, status: 'rejected', error: 'Only finalized invoices can be cancelled' }
        }
        if (existing.paidTotalPaise > 0) {
          return { op_id: op.op_id, status: 'rejected', error: 'Invoices with recorded payments cannot be cancelled' }
        }
        const saved = await prisma.invoice.update({
          where: { id: entityId },
          data: { status: 'CANCELLED', cancelledAt: new Date(), version, updatedAt: nowDate() },
        })
        const canonical = { ...existingToCanonical(existing), status: 'CANCELLED', cancelled_at: saved.cancelledAt?.toISOString(), version, updated_at: saved.updatedAt.toISOString(), sync_state: 'synced' }
        await writeChangeLog(workspaceId, 'invoice', entityId, 'cancel', canonical)
        return { op_id: op.op_id, status: 'applied', record: canonical }
      }

      // upsert / delete
      const finalizedLocked = existing && existing.status !== 'DRAFT' && existing.status !== 'CANCELLED'
      if (finalizedLocked && op.action === 'upsert' && !payload.deleted_at) {
        return { op_id: op.op_id, status: 'rejected', error: 'Finalized invoices are immutable — duplicate the invoice to make corrections' }
      }
      if (existing && op.action === 'upsert' && !payload.deleted_at && existing.version !== op.base_version) {
        return { op_id: op.op_id, status: 'conflict', record: existing }
      }

      if (op.action === 'delete' || payload.deleted_at) {
        if (existing && existing.status === 'DRAFT') {
          const saved = await prisma.invoice.update({ where: { id: entityId }, data: { deletedAt: nowDate(), version, updatedAt: nowDate() } })
          const canonical = { ...existingToCanonical(existing), deleted_at: saved.deletedAt?.toISOString(), version, updated_at: saved.updatedAt.toISOString(), sync_state: 'synced' }
          await writeChangeLog(workspaceId, 'invoice', entityId, 'delete', canonical)
          return { op_id: op.op_id, status: 'applied', record: canonical }
        }
        return { op_id: op.op_id, status: 'rejected', error: 'Only draft invoices can be deleted' }
      }

      const invoiceItemsForRecompute = await resolveItems(payload, existing ? { items: existing.items as unknown as Array<Record<string, unknown>> } : null, 'invoice_id')
      const recompute = await recomputeDocument(workspaceId, { ...payload, items: invoiceItemsForRecompute }, 'invoice')
      if ('error' in recompute && recompute.error) return { op_id: op.op_id, status: 'rejected', error: recompute.error }
      const canonical = recompute.canonical! as Json
      canonical.version = version
      canonical.paid_total_paise = existing?.paidTotalPaise ?? 0
      canonical.source_quotation_id = str(payload.source_quotation_id) ?? existing?.sourceQuotationId ?? null
      const saved = await prisma.invoice.upsert({
        where: { id: entityId },
        create: {
          id: entityId,
          ...documentColumns(canonical),
          invoiceDate: String(canonical.invoice_date),
          dueDate: (canonical.due_date as string | null) ?? null,
          paidTotalPaise: 0,
          sourceQuotationId: canonical.source_quotation_id as string | null,
          status: String(canonical.status),
          version,
          workspaceId,
          createdAt: new Date(String(canonical.created_at)),
          updatedAt: nowDate(),
          originDeviceId: str(payload.origin_device_id),
          items: { create: canonicalItemsToPrisma(recompute.items!, 'invoiceId') },
        },
        update: {
          ...documentColumns(canonical),
          status: String(canonical.status),
          version,
          updatedAt: nowDate(),
          originDeviceId: str(payload.origin_device_id),
          items: { deleteMany: {}, create: canonicalItemsToPrisma(recompute.items!, 'invoiceId') },
        },
        include: { items: true },
      })
      const responseCanonical = prismaInvoiceToCanonical(saved)
      await writeChangeLog(workspaceId, 'invoice', entityId, op.action, responseCanonical)
      return { op_id: op.op_id, status: 'applied', record: responseCanonical }
    }

    // ---------------- quotation ----------------
    case 'quotation': {
      const existing = await prisma.quotation.findFirst({ where: { id: entityId, workspaceId }, include: { items: true } })
      const version = (existing?.version ?? 0) + 1

      if (existing && existing.status !== 'DRAFT' && op.action === 'upsert' && !payload.deleted_at && !payload.status_change) {
        if (typeof payload.status === 'string' && payload.status !== existing.status && ['SENT', 'ACCEPTED', 'REJECTED'].includes(payload.status)) {
          // status transition — allowed
        } else {
          return { op_id: op.op_id, status: 'rejected', error: 'Only draft quotations can be edited — use status transitions' }
        }
      }
      if (existing && op.action === 'upsert' && !payload.deleted_at && existing.version !== op.base_version && !payload.status_change) {
        return { op_id: op.op_id, status: 'conflict', record: existing }
      }

      if (op.action === 'delete' || payload.deleted_at) {
        if (existing && existing.status === 'DRAFT') {
          const saved = await prisma.quotation.update({ where: { id: entityId }, data: { deletedAt: nowDate(), version, updatedAt: nowDate() } })
          const canonical = { ...existingToCanonical(existing), deleted_at: saved.deletedAt?.toISOString(), version, updated_at: saved.updatedAt.toISOString(), sync_state: 'synced' }
          await writeChangeLog(workspaceId, 'quotation', entityId, 'delete', canonical)
          return { op_id: op.op_id, status: 'applied', record: canonical }
        }
        return { op_id: op.op_id, status: 'rejected', error: 'Only draft quotations can be deleted' }
      }

      const isStatusTransition = Boolean(payload.status_change) || (existing && existing.status !== 'DRAFT' && !Array.isArray(payload.items))
      if (isStatusTransition && existing) {
        const nextStatus = str(payload.status) ?? existing.status
        const allowed: Record<string, string[]> = { DRAFT: ['SENT'], SENT: ['ACCEPTED', 'REJECTED'], ACCEPTED: [], REJECTED: [], EXPIRED: [], CONVERTED: [] }
        if (!allowed[existing.status]?.includes(nextStatus)) {
          return { op_id: op.op_id, status: 'rejected', error: `Cannot change quotation from ${existing.status} to ${nextStatus}` }
        }
        // DRAFT→SENT carries the client-allocated official number (CANON §6):
        // adopt it and fast-forward the sequence so later devices cannot reuse it.
        let numberUpdate: string | undefined
        const incomingNumber = str(payload.number)
        if (incomingNumber && incomingNumber !== existing.number && !provisional(incomingNumber)) {
          const company = await prisma.companyProfile.findFirst({ where: { workspaceId, deletedAt: null } })
          const prefix = company?.quotationPrefix ?? 'QT'
          const taken = await prisma.quotation.findFirst({ where: { workspaceId, number: incomingNumber, id: { not: entityId } } })
          if (!taken) {
            await fastForwardSequence(workspaceId, 'QUOTATION', prefix, incomingNumber, String(existing.quotationDate).slice(0, 10))
            numberUpdate = incomingNumber
          }
        }
        const saved = await prisma.quotation.update({
          where: { id: entityId },
          data: { status: nextStatus, version, updatedAt: nowDate(), ...(numberUpdate ? { number: numberUpdate } : {}) },
          include: { items: true },
        })
        const canonical = prismaQuotationToCanonical(saved)
        await writeChangeLog(workspaceId, 'quotation', entityId, 'upsert', canonical)
        return { op_id: op.op_id, status: 'applied', record: canonical }
      }

      const quotationItemsForRecompute = await resolveItems(payload, existing ? { items: existing.items as unknown as Array<Record<string, unknown>> } : null, 'quotation_id')
      const recompute = await recomputeDocument(workspaceId, { ...payload, items: quotationItemsForRecompute }, 'quotation')
      if ('error' in recompute && recompute.error) return { op_id: op.op_id, status: 'rejected', error: recompute.error }
      const canonical = recompute.canonical! as Json
      canonical.version = version
      canonical.converted_invoice_id = str(payload.converted_invoice_id) ?? existing?.convertedInvoiceId ?? null
      // Numbering authority (CANON §6): adopt client-allocated numbers by fast-forwarding
      // the sequence; allocate when the client is still on a provisional number.
      {
        const company = await prisma.companyProfile.findFirst({ where: { workspaceId, deletedAt: null } })
        const prefix = company?.quotationPrefix ?? 'QT'
        let number = String(canonical.number ?? '')
        if (!number || provisional(number)) {
          number = await allocateNumber(workspaceId, 'QUOTATION', prefix, String(canonical.quotation_date))
        } else if (number !== existing?.number) {
          const taken = await prisma.quotation.findFirst({ where: { workspaceId, number, id: { not: entityId } } })
          if (!taken) {
            await fastForwardSequence(workspaceId, 'QUOTATION', prefix, number, String(canonical.quotation_date))
          }
        }
        canonical.number = number
      }
      const saved = await prisma.quotation.upsert({
        where: { id: entityId },
        create: {
          id: entityId,
          ...documentColumns(canonical),
          quotationDate: String(canonical.quotation_date),
          validUntil: (canonical.valid_until as string | null) ?? null,
          convertedInvoiceId: canonical.converted_invoice_id as string | null,
          status: String(canonical.status),
          version,
          workspaceId,
          createdAt: new Date(String(canonical.created_at)),
          updatedAt: nowDate(),
          originDeviceId: str(payload.origin_device_id),
          items: { create: canonicalItemsToPrisma(recompute.items!, 'quotationId') },
        },
        update: {
          ...documentColumns(canonical),
          status: String(canonical.status),
          convertedInvoiceId: canonical.converted_invoice_id as string | null,
          version,
          updatedAt: nowDate(),
          originDeviceId: str(payload.origin_device_id),
          items: { deleteMany: {}, create: canonicalItemsToPrisma(recompute.items!, 'quotationId') },
        },
        include: { items: true },
      })
      const responseCanonical = prismaQuotationToCanonical(saved)
      await writeChangeLog(workspaceId, 'quotation', entityId, op.action, responseCanonical)
      return { op_id: op.op_id, status: 'applied', record: responseCanonical }
    }

    // ---------------- workspace ----------------
    case 'workspace': {
      const ws = await prisma.workspace.findUnique({ where: { id: entityId } })
      if (!ws) return { op_id: op.op_id, status: 'rejected', error: 'Workspace not found' }
      const saved = await prisma.workspace.update({ where: { id: entityId }, data: { name: str(payload.name) ?? ws.name, version: ws.version + 1 } })
      await writeChangeLog(workspaceId, 'workspace', entityId, 'upsert', { id: saved.id, name: saved.name, version: saved.version, updated_at: saved.updatedAt.toISOString(), sync_state: 'synced' })
      return { op_id: op.op_id, status: 'applied', record: { id: saved.id, name: saved.name, version: saved.version, updated_at: saved.updatedAt.toISOString(), sync_state: 'synced' } }
    }

    default:
      return { op_id: op.op_id, status: 'rejected', error: `Unknown entity: ${op.entity}` }
  }
}

function provisional(number: string): boolean {
  return number.startsWith('DRAFT-')
}

/** Fast-forward the server sequence when adopting a client-allocated number. */
async function fastForwardSequence(workspaceId: string, docType: 'INVOICE' | 'QUOTATION', prefix: string, number: string, onDate: string): Promise<void> {
  const fy = fiscalYearOf(onDate)
  const expected = Number(number.split('/').pop())
  if (!Number.isFinite(expected)) return
  const existing = await prisma.documentSequence.findUnique({
    where: { workspaceId_docType_fiscalYear: { workspaceId, docType, fiscalYear: fy } },
  })
  if (existing) {
    if (existing.nextSeq <= expected) {
      await prisma.documentSequence.update({ where: { id: existing.id }, data: { nextSeq: expected + 1 } })
    }
  } else {
    await prisma.documentSequence.create({ data: { workspaceId, docType, fiscalYear: fy, nextSeq: expected + 1 } })
  }
  void prefix
}

/** Recompute an invoice's paid total and payment-driven status (trusted server rule).
 *  Bumps the invoice version and publishes the change so other devices pull it. */
async function recalcInvoicePaid(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, items: true } })
  if (!invoice) return
  const paid = invoice.payments.filter((p) => !p.deletedAt).reduce((s, p) => s + p.amountPaise, 0)
  let status = invoice.status
  if (['FINALIZED', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status)) {
    status = paid === 0 ? 'FINALIZED' : paid >= invoice.grandTotalPaise ? 'PAID' : 'PARTIALLY_PAID'
  }
  const saved = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { paidTotalPaise: paid, status, version: { increment: 1 }, updatedAt: nowDate() },
    include: { items: true },
  })
  await writeChangeLog(saved.workspaceId, 'invoice', invoiceId, 'upsert', prismaInvoiceToCanonical(saved))
}

// ---------- canonical ↔ prisma mapping helpers ----------

function documentColumns(c: Json) {
  const isInvoice = 'invoice_date' in c
  return {
    number: String(c.number),
    invoiceDate: isInvoice ? String(c.invoice_date) : undefined,
    quotationDate: !isInvoice ? String(c.quotation_date) : undefined,
    dueDate: isInvoice ? (c.due_date as string | null) : undefined,
    validUntil: !isInvoice ? (c.valid_until as string | null) : undefined,
    customerId: String(c.customer_id),
    customerNameSnapshot: (c.customer_name_snapshot as string | null) ?? null,
    customerGstinSnapshot: (c.customer_gstin_snapshot as string | null) ?? null,
    placeOfSupplyCode: (c.place_of_supply_code as string | null) ?? null,
    taxMode: String(c.tax_mode ?? 'INTRA'),
    priceIncludesTax: Boolean(c.price_includes_tax),
    subtotalGrossPaise: Number(c.subtotal_gross_paise ?? 0),
    discountTotalPaise: Number(c.discount_total_paise ?? 0),
    taxableTotalPaise: Number(c.taxable_total_paise ?? 0),
    cgstPaise: Number(c.cgst_paise ?? 0),
    sgstPaise: Number(c.sgst_paise ?? 0),
    igstPaise: Number(c.igst_paise ?? 0),
    chargesTotalPaise: Number(c.charges_total_paise ?? 0),
    chargesTaxPaise: Number(c.charges_tax_paise ?? 0),
    roundOffPaise: Number(c.round_off_paise ?? 0),
    grandTotalPaise: Number(c.grand_total_paise ?? 0),
    charges: String(c.charges_json ?? '[]'),
    notes: (c.notes as string | null) ?? null,
    terms: (c.terms as string | null) ?? null,
    finalizedAt: c.finalized_at ? new Date(String(c.finalized_at)) : null,
    deletedAt: c.deleted_at ? new Date(String(c.deleted_at)) : null,
  }
}

function canonicalItemsToPrisma(items: Array<Record<string, unknown>>, fk: 'invoiceId' | 'quotationId') {
  // NOTE: used only inside nested `items: { create: [...] }` — Prisma wires the FK
  // automatically, so the FK field must NOT be included here.
  void fk
  return items.map((it) => ({
    id: String(it.id),
    position: Number(it.position ?? 0),
    description: String(it.description),
    hsnSac: (it.hsn_sac as string | null) ?? null,
    qtyMilli: Number(it.qty_milli ?? 0),
    unit: (it.unit as string | null) ?? null,
    unitPricePaise: Number(it.unit_price_paise ?? 0),
    discountBps: Number(it.discount_bps ?? 0),
    gstRateBps: Number(it.gst_rate_bps ?? 0),
    grossPaise: Number(it.gross_paise ?? 0),
    discountPaise: Number(it.discount_paise ?? 0),
    taxablePaise: Number(it.taxable_paise ?? 0),
    cgstPaise: Number(it.cgst_paise ?? 0),
    sgstPaise: Number(it.sgst_paise ?? 0),
    igstPaise: Number(it.igst_paise ?? 0),
    taxPaise: Number(it.tax_paise ?? 0),
    totalPaise: Number(it.total_paise ?? 0),
    priceIncludesTax: Boolean(it.price_includes_tax),
  }))
}

function itemsToCanonical(items: Array<Record<string, unknown>>, fk: 'invoice_id' | 'quotation_id') {
  return items.map((it) => ({
    id: it.id,
    [fk]: it[fk === 'invoice_id' ? 'invoiceId' : 'quotationId'],
    workspace_id: it.workspaceId,
    position: it.position,
    description: it.description,
    hsn_sac: it.hsnSac,
    qty_milli: it.qtyMilli,
    unit: it.unit,
    unit_price_paise: it.unitPricePaise,
    discount_bps: it.discountBps,
    gst_rate_bps: it.gstRateBps,
    gross_paise: it.grossPaise,
    discount_paise: it.discountPaise,
    taxable_paise: it.taxablePaise,
    cgst_paise: it.cgstPaise,
    sgst_paise: it.sgstPaise,
    igst_paise: it.igstPaise,
    tax_paise: it.taxPaise,
    total_paise: it.totalPaise,
    price_includes_tax: it.priceIncludesTax,
  }))
}

function prismaInvoiceToCanonical(inv: {
  id: string; workspaceId: string; number: string; status: string; invoiceDate: string; dueDate: string | null
  customerId: string; customerNameSnapshot: string | null; customerGstinSnapshot: string | null
  placeOfSupplyCode: string | null; taxMode: string; priceIncludesTax: boolean
  subtotalGrossPaise: number; discountTotalPaise: number; taxableTotalPaise: number
  cgstPaise: number; sgstPaise: number; igstPaise: number
  chargesTotalPaise: number; chargesTaxPaise: number; roundOffPaise: number; grandTotalPaise: number
  paidTotalPaise: number; charges: string; notes: string | null; terms: string | null
  sourceQuotationId: string | null; finalizedAt: Date | null; cancelledAt: Date | null
  version: number; deletedAt: Date | null; createdAt: Date; updatedAt: Date; originDeviceId: string | null
  items?: Array<Record<string, unknown>>
}): Json {
  return {
    id: inv.id,
    workspace_id: inv.workspaceId,
    number: inv.number,
    status: inv.status,
    invoice_date: inv.invoiceDate,
    due_date: inv.dueDate,
    customer_id: inv.customerId,
    customer_name_snapshot: inv.customerNameSnapshot,
    customer_gstin_snapshot: inv.customerGstinSnapshot,
    place_of_supply_code: inv.placeOfSupplyCode,
    tax_mode: inv.taxMode,
    price_includes_tax: inv.priceIncludesTax,
    subtotal_gross_paise: inv.subtotalGrossPaise,
    discount_total_paise: inv.discountTotalPaise,
    taxable_total_paise: inv.taxableTotalPaise,
    cgst_paise: inv.cgstPaise,
    sgst_paise: inv.sgstPaise,
    igst_paise: inv.igstPaise,
    charges_total_paise: inv.chargesTotalPaise,
    charges_tax_paise: inv.chargesTaxPaise,
    round_off_paise: inv.roundOffPaise,
    grand_total_paise: inv.grandTotalPaise,
    paid_total_paise: inv.paidTotalPaise,
    charges_json: inv.charges,
    notes: inv.notes,
    terms: inv.terms,
    source_quotation_id: inv.sourceQuotationId,
    finalized_at: inv.finalizedAt?.toISOString() ?? null,
    cancelled_at: inv.cancelledAt?.toISOString() ?? null,
    created_at: inv.createdAt.toISOString(),
    updated_at: inv.updatedAt.toISOString(),
    deleted_at: inv.deletedAt?.toISOString() ?? null,
    version: inv.version,
    origin_device_id: inv.originDeviceId,
    sync_state: 'synced',
    ...(inv.items ? { items: itemsToCanonical(inv.items, 'invoice_id') } : {}),
  }
}

function prismaQuotationToCanonical(q: {
  id: string; workspaceId: string; number: string; status: string; quotationDate: string; validUntil: string | null
  customerId: string; customerNameSnapshot: string | null; customerGstinSnapshot: string | null
  placeOfSupplyCode: string | null; taxMode: string; priceIncludesTax: boolean
  subtotalGrossPaise: number; discountTotalPaise: number; taxableTotalPaise: number
  cgstPaise: number; sgstPaise: number; igstPaise: number
  chargesTotalPaise: number; chargesTaxPaise: number; roundOffPaise: number; grandTotalPaise: number
  charges: string; notes: string | null; terms: string | null
  convertedInvoiceId: string | null; finalizedAt: Date | null
  version: number; deletedAt: Date | null; createdAt: Date; updatedAt: Date; originDeviceId: string | null
  items?: Array<Record<string, unknown>>
}): Json {
  return {
    id: q.id,
    workspace_id: q.workspaceId,
    number: q.number,
    status: q.status,
    quotation_date: q.quotationDate,
    valid_until: q.validUntil,
    customer_id: q.customerId,
    customer_name_snapshot: q.customerNameSnapshot,
    customer_gstin_snapshot: q.customerGstinSnapshot,
    place_of_supply_code: q.placeOfSupplyCode,
    tax_mode: q.taxMode,
    price_includes_tax: q.priceIncludesTax,
    subtotal_gross_paise: q.subtotalGrossPaise,
    discount_total_paise: q.discountTotalPaise,
    taxable_total_paise: q.taxableTotalPaise,
    cgst_paise: q.cgstPaise,
    sgst_paise: q.sgstPaise,
    igst_paise: q.igstPaise,
    charges_total_paise: q.chargesTotalPaise,
    charges_tax_paise: q.chargesTaxPaise,
    round_off_paise: q.roundOffPaise,
    grand_total_paise: q.grandTotalPaise,
    charges_json: q.charges,
    notes: q.notes,
    terms: q.terms,
    converted_invoice_id: q.convertedInvoiceId,
    finalized_at: q.finalizedAt?.toISOString() ?? null,
    created_at: q.createdAt.toISOString(),
    updated_at: q.updatedAt.toISOString(),
    deleted_at: q.deletedAt?.toISOString() ?? null,
    version: q.version,
    origin_device_id: q.originDeviceId,
    sync_state: 'synced',
    ...(q.items ? { items: itemsToCanonical(q.items, 'quotation_id') } : {}),
  }
}

function existingToCanonical(existing: Record<string, unknown>): Json {
  // Best-effort canonical from a prisma row via the mapping fns (used by cancel/delete paths)
  if ('invoice_date' in existing) return prismaInvoiceToCanonical(existing as never)
  if ('quotation_date' in existing) return prismaQuotationToCanonical(existing as never)
  return { ...existing }
}

export { orNull }
