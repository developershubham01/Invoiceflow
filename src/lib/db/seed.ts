// InvoiceFlow — Demo data seeder (user-triggered from onboarding; clearly labelled sample data)

import { getDb } from './db'
import { addAudit, enqueueOp, getCompany, saveCompany, saveCustomer, saveProduct } from './repositories'
import { saveInvoiceDraft, finalizeInvoice, recordPayment, saveQuotationDraft, setQuotationStatus } from './repositories'
import { getDeviceId } from '@/lib/device'
import { todayStr, addDaysStr } from '@/lib/date'
import { computeDocumentTotals, type DocItemInput } from '@/lib/domain/documents'
import type { DocCharge, Payment } from '@/lib/domain/types'

const SAMPLE_GSTIN = '27AAACA1234A1Z5' // format-valid sample (Maharashtra)

export async function seedDemoData(workspaceId: string): Promise<void> {
  const db = getDb()
  const existing = await getCompany(workspaceId)
  if (existing) throw new Error('Workspace already has a company profile')

  await saveCompany(workspaceId, {
    name: 'Acme Traders Pvt Ltd',
    business_type: 'Private Limited',
    address_line1: '402, Sunrise Business Park',
    address_line2: 'Bandra Kurla Complex',
    city: 'Mumbai',
    state_name: 'Maharashtra',
    state_code: '27',
    pincode: '400051',
    gstin: SAMPLE_GSTIN,
    pan: 'AAACA1234A',
    phone: '98200 12345',
    email: 'accounts@acmetraders.in',
    website: 'www.acmetraders.in',
    bank_name: 'HDFC Bank',
    bank_account: '50200012345678',
    bank_ifsc: 'HDFC0000123',
    bank_branch: 'BKC, Mumbai',
    upi_vpa: 'acmetraders@hdfcbank',
    authorized_signatory: 'Aditi Sharma',
    invoice_prefix: 'INV',
    quotation_prefix: 'QT',
    default_gst_rate_bps: 1800,
    price_includes_tax: false,
    enable_round_off: true,
    default_terms: '1. Payment due within 15 days of invoice date.\n2. Interest @18% p.a. on overdue amounts.\n3. Goods once sold will not be taken back.',
    default_notes: 'Thank you for your business!',
  })

  // Sequential (not Promise.all): keeps CUS-#### codes strictly ordered even without the
  // allocation lock, and mirrors how users actually add customers.
  const customers: Array<{ id: string; state_code: string }> = []
  for (const c of [
    saveCustomer(workspaceId, { business_name: 'Sharma Electronics', contact_person: 'Rajesh Sharma', email: 'rajesh@sharmaelec.in', phone: '98201 11111', gstin: '27AABCS1429B1Z1', billing_address: '12, Laxmi Industrial Estate, Andheri West, Mumbai', state_code: '27', state_name: 'Maharashtra', type: 'BUSINESS' as const }),
    saveCustomer(workspaceId, { business_name: 'Patel Hardware & Supplies', contact_person: 'Nirav Patel', email: 'nirav@patelhardware.in', phone: '98240 22222', gstin: '24AACCP1234K1Z9', billing_address: '88, Ring Road, Surat', state_code: '24', state_name: 'Gujarat', type: 'BUSINESS' as const }),
    saveCustomer(workspaceId, { business_name: 'Verma Enterprises', contact_person: 'Sunita Verma', email: 'sunita@vermaent.in', phone: '98110 33333', gstin: '07AAECV5678M1ZP', billing_address: '45, Connaught Place, New Delhi', state_code: '07', state_name: 'Delhi', type: 'BUSINESS' as const }),
    saveCustomer(workspaceId, { business_name: 'Priya Design Studio', contact_person: 'Priya Nair', email: 'priya@priyadesign.in', phone: '98860 44444', billing_address: '9, Indiranagar 100ft Road, Bengaluru', state_code: '29', state_name: 'Karnataka', type: 'INDIVIDUAL' as const }),
    saveCustomer(workspaceId, { business_name: 'Kolkata Traders Co', contact_person: 'Amit Bose', email: 'amit@koltraders.in', phone: '98300 55555', gstin: '19AAACK9012P1ZQ', billing_address: '7, Park Street, Kolkata', state_code: '19', state_name: 'West Bengal', type: 'BUSINESS' as const }),
  ]) {
    const saved = await c
    customers.push({ id: saved.id, state_code: saved.state_code ?? '' })
  }

  await Promise.all([
    saveProduct(workspaceId, { name: 'LED Panel Light 18W', sku: 'LED-18W', hsn_sac: '9405', description: '18W slim LED ceiling panel, cool white', unit: 'PCS', selling_price_paise: 45000, cost_price_paise: 31000, gst_rate_bps: 1200 }),
    saveProduct(workspaceId, { name: 'Copper Wire 1.5mm (90m)', sku: 'CU-15-90', hsn_sac: '8544', description: 'FR PVC insulated copper wire, 90m coil', unit: 'ROLL', selling_price_paise: 189000, cost_price_paise: 151000, gst_rate_bps: 1800 }),
    saveProduct(workspaceId, { name: 'Modular Switch 6A', sku: 'SW-6A', hsn_sac: '8536', description: '6A modular switch, white', unit: 'PCS', selling_price_paise: 8500, cost_price_paise: 5200, gst_rate_bps: 1800 }),
    saveProduct(workspaceId, { name: 'Ceiling Fan 1200mm', sku: 'FAN-1200', hsn_sac: '8414', description: '1200mm energy-efficient ceiling fan', unit: 'PCS', selling_price_paise: 250000, cost_price_paise: 185000, gst_rate_bps: 1800 }),
    saveProduct(workspaceId, { name: 'Installation Service (per hour)', sku: 'SVC-INST', hsn_sac: '998739', description: 'On-site electrical installation service', unit: 'HRS', selling_price_paise: 70000, gst_rate_bps: 1800 }),
    saveProduct(workspaceId, { name: 'AMC — Annual Maintenance', sku: 'SVC-AMC', hsn_sac: '998719', description: 'Annual maintenance contract, 2 visits/quarter', unit: 'YR', selling_price_paise: 1200000, gst_rate_bps: 1800 }),
  ])

  const today = todayStr()
  const products = await db.products.where('workspace_id').equals(workspaceId).toArray()
  const p = (sku: string) => products.find((x) => x.sku === sku)!

  const mkItems = (specs: Array<[string, number]>): DocItemInput[] =>
    specs.map(([sku, qty], i) => {
      const prod = p(sku)
      return {
        id: crypto.randomUUID(),
        description: prod.description || prod.name,
        hsn_sac: prod.hsn_sac,
        qty_milli: Math.round(qty * 1000),
        unit: prod.unit,
        unit_price_paise: prod.selling_price_paise,
        discount_bps: i === 0 && specs.length > 1 ? 500 : 0,
        gst_rate_bps: prod.gst_rate_bps,
      }
    })

  const charges: DocCharge[] = []

  // ---- Quotations ----
  const q1 = await saveQuotationDraft(workspaceId, '27', { enable_round_off: true }, {
    customer_id: customers[1].id, quotation_date: addDaysStr(today, -12), valid_until: addDaysStr(today, 18),
    place_of_supply_code: '24', price_includes_tax: false,
    items: mkItems([['FAN-1200', 25], ['SW-6A', 120]]), charges: [{ id: crypto.randomUUID(), label: 'Freight & insurance', amount_paise: 350000, taxable: false, gst_rate_bps: 0 }], notes: 'Bulk order for new residential project.', terms: null,
  })
  await setQuotationStatus(workspaceId, q1.id, 'SENT')
  await setQuotationStatus(workspaceId, q1.id, 'ACCEPTED')

  const q2 = await saveQuotationDraft(workspaceId, '27', { enable_round_off: true }, {
    customer_id: customers[3].id, quotation_date: addDaysStr(today, -5), valid_until: addDaysStr(today, 25),
    place_of_supply_code: '29', price_includes_tax: false,
    items: mkItems([['SVC-INST', 20], ['LED-18W', 40]]), charges, notes: 'Studio lighting retrofit.', terms: null,
  })
  await setQuotationStatus(workspaceId, q2.id, 'SENT')

  const q3 = await saveQuotationDraft(workspaceId, '27', { enable_round_off: true }, {
    customer_id: customers[4].id, quotation_date: addDaysStr(today, -40), valid_until: addDaysStr(today, -10),
    place_of_supply_code: '19', price_includes_tax: false,
    items: mkItems([['SVC-AMC', 1]]), charges, notes: null, terms: null,
  })
  await setQuotationStatus(workspaceId, q3.id, 'SENT')
  await setQuotationStatus(workspaceId, q3.id, 'REJECTED')

  // ---- Invoices spread over the last 6 months ----
  const finalizeAndPay = async (invId: string, payRatio?: number, method: Payment['method'] = 'BANK_TRANSFER') => {
    const finalized = await finalizeInvoice(workspaceId, 'INV', invId)
    if (payRatio && payRatio > 0) {
      const amount = Math.min(finalized.grand_total_paise, Math.round(finalized.grand_total_paise * payRatio))
      if (amount > 0) {
        await recordPayment(workspaceId, {
          id: crypto.randomUUID(),
          invoice_id: invId,
          amount_paise: amount,
          paid_at: todayStr(),
          method,
          reference: `UTR${Math.floor(100000 + Math.random() * 899999)}`,
          notes: null,
        } as Payment, finalized.grand_total_paise)
      }
    }
    return finalized
  }

  const monthsBack = (n: number) => {
    const d = new Date()
    d.setMonth(d.getMonth() - n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-05`
  }

  const inv1 = await saveInvoiceDraft(workspaceId, '27', { price_includes_tax: false, enable_round_off: true }, {
    customer_id: customers[0].id, invoice_date: monthsBack(4), due_date: addDaysStr(monthsBack(4), 15),
    place_of_supply_code: '27', price_includes_tax: false, items: mkItems([['LED-18W', 60], ['SW-6A', 100]]), charges, notes: null, terms: null,
  })
  await finalizeAndPay(inv1.id, 1)

  const inv2 = await saveInvoiceDraft(workspaceId, '27', { price_includes_tax: false, enable_round_off: true }, {
    customer_id: customers[2].id, invoice_date: monthsBack(3), due_date: addDaysStr(monthsBack(3), 15),
    place_of_supply_code: '07', price_includes_tax: false, items: mkItems([['CU-15-90', 30]]), charges: [{ id: crypto.randomUUID(), label: 'Delivery', amount_paise: 150000, taxable: true, gst_rate_bps: 1800 }], notes: null, terms: null,
  })
  await finalizeAndPay(inv2.id, 1)

  const inv3 = await saveInvoiceDraft(workspaceId, '27', { price_includes_tax: false, enable_round_off: true }, {
    customer_id: customers[1].id, invoice_date: monthsBack(2), due_date: addDaysStr(monthsBack(2), 15),
    place_of_supply_code: '24', price_includes_tax: false, items: mkItems([['FAN-1200', 10], ['CU-15-90', 8]]), charges, notes: null, terms: null,
  })
  await finalizeAndPay(inv3.id, 0.5)

  const inv4 = await saveInvoiceDraft(workspaceId, '27', { price_includes_tax: false, enable_round_off: true }, {
    customer_id: customers[4].id, invoice_date: monthsBack(1), due_date: addDaysStr(monthsBack(1), 10),
    place_of_supply_code: '19', price_includes_tax: false, items: mkItems([['LED-18W', 25]]), charges, notes: null, terms: null,
  })
  await finalizeAndPay(inv4.id, 0)

  const inv5 = await saveInvoiceDraft(workspaceId, '27', { price_includes_tax: false, enable_round_off: true }, {
    customer_id: customers[0].id, invoice_date: addDaysStr(today, -20), due_date: addDaysStr(today, -5),
    place_of_supply_code: '27', price_includes_tax: false, items: mkItems([['SVC-INST', 8], ['SW-6A', 40]]), charges, notes: null, terms: null,
  })
  await finalizeAndPay(inv5.id, 0.6, 'UPI')

  const inv6 = await saveInvoiceDraft(workspaceId, '27', { price_includes_tax: false, enable_round_off: true }, {
    customer_id: customers[2].id, invoice_date: addDaysStr(today, -8), due_date: addDaysStr(today, 22),
    place_of_supply_code: '07', price_includes_tax: false, items: mkItems([['SVC-AMC', 1]]), charges, notes: null, terms: null,
  })
  await finalizeAndPay(inv6.id, 0)

  // One draft left in the editor pipeline
  await saveInvoiceDraft(workspaceId, '27', { price_includes_tax: false, enable_round_off: true }, {
    customer_id: customers[3].id, invoice_date: today, due_date: addDaysStr(today, 15),
    place_of_supply_code: '29', price_includes_tax: false, items: mkItems([['LED-18W', 12]]), charges, notes: 'Studio retrofit phase 2.', terms: null,
  })

  // Link accepted quotation → converted invoice demo (convert q1)
  const { convertQuotationToInvoice } = await import('./repositories')
  await convertQuotationToInvoice(workspaceId, '27', { enable_round_off: true }, q1.id)

  await addAudit(db, workspaceId, 'workspace', workspaceId, 'CREATE', { seeded: 'demo-data' })
  void enqueueOp // ops are enqueued by the individual save helpers above
  void computeDocumentTotals
}
