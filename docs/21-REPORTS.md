# 21 — Reports

> Derives from `docs/_CANON.md` (§4 money rules, §5 GST, §7 tables, §12 lifecycles, §15 UI). Computed **entirely client-side** from IndexedDB via the same domain engine used by the dashboard. Route: `#/reports`.

## Purpose

Specify the five operational reports — Sales, GST Summary, Outstanding, Customers, Products — including exact groupings, date-range filtering (fiscal-year default), and the CSV export format (UTF-8 BOM). Reports give the owner statutory-adjacent visibility (GST liability per month, receivables aging) without any server round-trip.

## Scope

- In scope: report definitions, aggregation rules, filtering semantics, CSV export spec, acceptance criteria; PDF export of the GST Summary as a **designed extension point**.
- Out of scope: dashboard KPIs (docs/20-DASHBOARD.md), PDF invoices (docs/14-PDF-GENERATION.md), cloud sync (docs/19-CLOUD-SYNC.md).

## Business requirements

1. BR-1 All five reports work **offline**, recomputed from local data on every filter change (no cached report tables).
2. BR-2 Every report is scoped to the active workspace and honors soft deletes; `CANCELLED` invoices and `DRAFT` documents never contribute to tax or revenue figures.
3. BR-3 The date range defaults to the **current fiscal year** (April–March) and supports presets + custom range (shared period component with docs/20).
4. BR-4 GST Summary must be grouped by month with explicit CGST / SGST(UTGST) / IGST columns so the owner can reconcile monthly liability.
5. BR-5 Outstanding must bucket receivables by age (0–30 / 31–60 / 61–90 / 90+ days past due).
6. BR-6 Every report exports to CSV that opens cleanly in Excel (UTF-8 BOM) and Google Sheets.
7. BR-7 The app makes **no legal-compliance claims**: reports compute GST as understood by the domain engine (CANON §5); professional validation is required before statutory reliance (disclaimer shown on the GST tab).

## Date-range filtering semantics

- `P = [from, to]`, inclusive, string comparison on `YYYY-MM-DD` (no timezone math).
- Presets: Current FY (default), Last FY, This month, Last month, Last 90 days, Custom.
- Date anchor per report: Sales / GST Summary / Outstanding / Products → `invoices.invoice_date`; Customers → `payments.paid_at` (revenue) and `invoices.invoice_date` (invoiced columns); quotation-based columns (future) would anchor on `quotation_date`.
- Filters compose: report tab + range + (Sales/Outstanding only) status filter + free-text search on number/customer.

## Report specifications

Population base for all invoice-sourced reports: `invoices WHERE deleted_at IS NULL AND status IN ('FINALIZED','PARTIALLY_PAID','PAID') AND invoice_date ∈ P`. Snapshot columns (`cgst_paise`, `sgst_paise`, `igst_paise`, `grand_total_paise`, …) are **authoritative** — never recomputed at report time (they were validated by the domain engine at finalize, CANON §4).

### 1. Sales
- Row per invoice in base population, sorted `invoice_date` desc, then `number` desc. Columns: Number, Date, Customer, Place of supply, Taxable, CGST, SGST, IGST, Grand total, Paid, Balance, Status.
- Balance = `grand_total_paise − paid_total_paise` (can be negative for overpayments → displayed, not clamped).
- Footer totals row for all money columns. Client-side pagination 10/page (CANON §15) with CSV exporting **all** rows, not just the page.

### 2. GST Summary
- Base population grouped by month of `invoice_date`. One row per fiscal month present in `P` (ordered Apr→Mar), plus a Grand-total row.
- Columns: Month (`2025-04`), Documents (count), Taxable value, CGST, SGST/UTGST, IGST, Total GST.
- Total GST = `Σ (cgst_paise + sgst_paise + igst_paise)`. Intra-state splits per CANON §5 (UTGST recorded in the SGST slot).
- Permanent footer disclaimer: "Computed locally from InvoiceFlow records; not a statutory GST return."

### 3. Outstanding
- Population: invoices `deleted_at IS NULL AND status IN ('FINALIZED','PARTIALLY_PAID')` with `balance > 0` (registration date `invoice_date ∈ P`); PAID invoices are excluded (nothing outstanding).
- **Aging bucket**: `days_overdue = max(0, daysBetween(today, due_date))`; if `due_date` is null, use `invoice_date` as the anchor. Buckets: `0–30`, `31–60`, `61–90`, `90+`. Not-yet-due invoices land in `0–30` with age 0 (documented choice — keeps exactly four buckets).
- Columns: Number, Customer, Invoice date, Due date, Grand total, Paid, Balance, Bucket. Sorted `due_date` asc. Summary strip: balance per bucket + grand total.

### 4. Customers by revenue
- **Revenue = collected**: `Σ payments.amount_paise` (payment not deleted) grouped by the parent invoice's `customer_id`, payment `paid_at ∈ P`.
- Supporting columns: Invoiced (`Σ grand_total_paise` of base population per customer), Invoices (count), Outstanding (`Σ balance` of the Outstanding population per customer). Sorted revenue desc; searchable.

### 5. Products by quantity + revenue
- Aggregate `invoice_items` joined to the base population: `quantity = Σ qty_milli` per `product_id` (fallback: description+hsn_sac snapshot for ad-hoc lines under a pseudo-product "Ad-hoc line items"); **revenue = Σ total_paise** (tax-inclusive line total); also show `Σ taxable_paise` and `Σ tax_paise`.
- Sortable by revenue (default) or quantity. Quantity displayed as decimal units (`qty_milli / 1000`, up to 3 decimals).

## CSV export spec (all reports)

| Rule | Value |
|---|---|
| Encoding | UTF-8 with **BOM** (`U+FEFF` as first byte) |
| Delimiter | Comma |
| Quoting | RFC 4180: fields containing comma, double-quote, CR or LF are wrapped in `"`; embedded `"` doubled |
| Line endings | CRLF (`\r\n`) |
| Header | First row = column labels, exactly as rendered (e.g. `Invoice Number,Invoice Date,Customer,Taxable,CGST,SGST,IGST,Grand Total,Paid,Balance,Status`) |
| Money | Decimal rupees with 2 decimals (`paise / 100`, fixed 2, no thousands separators) — machine-friendly, Excel-safe |
| Quantity | Decimal units, up to 3 decimals |
| Dates | `YYYY-MM-DD` |
| Totals | Reports with footer totals include a final `TOTAL` row |
| Filename | `invoiceflow-{report}-{from}_to_{to}.csv` (e.g. `invoiceflow-gst-summary-2025-04-01_to_2026-03-31.csv`) |
| Trigger | Explicit "Export CSV" button; browser download via Blob + object URL (Electron: save dialog via typed IPC) |

Implementation: shared `src/lib/reports/csv.ts` — `toCsv(columns, rows)` pure function; rows come from the same pure aggregators that feed the tables, guaranteeing WYSIWYG exports.

### Appendix — exact CSV column dictionaries

```
invoiceflow-sales-*.csv
Invoice Number,Invoice Date,Customer,Place of Supply,Taxable,CGST,SGST,IGST,Grand Total,Paid,Balance,Status

invoiceflow-gst-summary-*.csv
Month,Documents,Taxable Value,CGST,SGST/UTGST,IGST,Total GST
(…rows…, TOTAL,…totals…)

invoiceflow-outstanding-*.csv
Invoice Number,Customer,Invoice Date,Due Date,Age (Days),Bucket,Grand Total,Paid,Balance

invoiceflow-customers-*.csv
Customer,Code,Invoiced,Collected (Revenue),Invoices,Outstanding

invoiceflow-products-*.csv
Product,SKU / HSN-SAC,Quantity,Taxable,Tax,Revenue
```

Rules: `Status` exports the raw enum (`FINALIZED`); `Bucket` exports the label (`0-30`); `Age (Days)` is the integer clamped age; empty optional fields export as empty strings (never `null`/`undefined`/`-`). Numbers use the dot decimal separator regardless of locale.

## Technical design

- `src/lib/reports/` — pure aggregation modules per report (`sales.ts`, `gstSummary.ts`, `outstanding.ts`, `customers.ts`, `products.ts`) + shared `period.ts` (fiscal-year math reused from domain) and `csv.ts`.
- Data access: `useLiveQuery` over the CANON §7 tables filtered by active `workspace_id`; aggregation is a single in-memory pass per report (datasets in target segment: < 10k documents — trivial).
- UI: tabs (Sales, GST Summary, Outstanding, Customers, Products) + period selector + per-tab filter/search; tables sortable per CANON §15; GST tab carries the compliance disclaimer.
- Reports reuse the dashboard's period component and the domain engine's conventions — one source of truth for money semantics (CANON §4).

### PDF export for GST Summary — EXTENSION POINT (not implemented in MVP)

Design for the future: reuse the jsPDF pipeline (docs/14-PDF-GENERATION.md) with a landscape A4 autotable of the monthly matrix + grand total + disclaimer footer; output `invoiceflow-gst-summary-{from}_to_{to}.pdf`. No server involvement; same offline guarantees. Deferred only to keep MVP scope tight — no architectural dependency blocks it.

### Aggregation pipeline (pseudocode, shared shape for all five reports)

```ts
function runReport(kind: ReportKind, range: Range, wsId: string): ReportResult {
  const rows = useLiveQuery(() => db.invoices
    .where('[workspace_id+deleted_at]').equals([wsId, null])   // index from CANON §7
    .toArray());
  const base = rows.filter(i => POPULATION[kind](i, range));   // §"Date-range filtering"
  const aggregated = AGGREGATORS[kind](base, { today, range }); // pure, snapshot-column reads
  return { columns: COLUMNS[kind], rows: aggregated, totals: TOTALS[kind](aggregated) };
}
```

- Population predicates are shared with the dashboard aggregator where they coincide (FINALIZED+ population, payment population) — one definition, two consumers (docs/20).
- All five aggregators are pure `(rows, ctx) → rows` functions; the only impurity (clock) enters via `ctx.today` and is injected by the caller (tests pass a fixed date, docs/35-TESTING.md).

## Data models

No new tables. Reads: `invoices`, `invoice_items`, `payments`, `customers`, `products` (CANON §7). Report outputs are plain typed objects (no persistence). `invoice_items.product_id` linkage: product picker stamps `product_id` on the line item (domain schema); ad-hoc lines have none → bucketed as "Ad-hoc line items".

## API contracts

None. Reports are local-only by design (BR-1). The dev-cloud and Supabase are never queried for reporting.

## Offline behavior

Fully offline. Changing filters, sorting, and CSV export all work with zero network. `today` (aging) derives from the device clock — documented clock caveat, same as docs/20.

## Online behavior

No report-specific requests. Pull-applied sync changes refresh live queries; the reports simply recompute on next render. No server-side report caching exists to invalidate.

## Security considerations

- Workspace-scoped queries only; switching workspaces resets all filters and results.
- CSV contains financial data: export is user-initiated only (no auto-download); Electron save dialog goes through the typed contextBridge API (CANON §16).
- No `dangerouslySetInnerHTML` anywhere in report rendering.

## Error-handling rules

- Orphaned line items (invoice row missing) are skipped with `console.warn` and counted in a dev-only integrity readout.
- Empty result sets render the standard empty state with a CTA to widen the date range.
- CSV export of 0 rows produces a header-only file (still valid CSV).
- Non-finite aggregates (impossible by validation) abort the render into the error boundary, never silently display wrong money.

## Acceptance criteria

1. AC-1 GST Summary for seeded FY data matches hand-computed monthly CGST/SGST/IGST sums; intra-state and inter-state invoices land in the correct columns.
2. AC-2 An invoice finalized on the last day of the fiscal year appears in that FY's range; one dated the next day does not (inclusive/exclusive boundary check).
3. AC-3 Outstanding buckets: invoices 5, 45, 75, 120 days past due land in 0–30, 31–60, 61–90, 90+ respectively; a not-yet-due invoice appears in 0–30 with age 0.
4. AC-4 Deleting (soft) a payment reduces the Customers-by-revenue figure and raises the invoice Balance immediately.
5. AC-5 CSV: exported file starts with BOM, opens in Excel with correct `₹`-free decimal numbers and uncorrupted commas-in-quotes fields; totals row matches the table footer.
6. AC-6 `CANCELLED` and `DRAFT` invoices appear in no report row and no total.
7. AC-7 All five reports render identically in airplane mode.
8. AC-8 Aggregator unit tests (docs/35-TESTING.md) cover empty data, single-record, overpayment (negative balance displayed), and EXPIRED-quotation exclusion from invoice reports.
