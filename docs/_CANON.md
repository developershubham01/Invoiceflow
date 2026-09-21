# InvoiceFlow — Canonical Specification (CANON)

> **READ ME FIRST.** This file is the single source of truth for every agent working on InvoiceFlow.
> All documentation, SQL, Electron code, and application code MUST be consistent with this spec.
> If a doc needs to deviate, it must state the deviation explicitly and justify it.

---

## 1. Product identity

**InvoiceFlow** — an offline-first Invoice & Quotation management SaaS for Indian businesses (GST-aware), with local-first data (IndexedDB/Dexie), optional cloud sync (Supabase in production; a dev-cloud via Next.js API routes + Prisma/SQLite in this environment), offline PDF generation, and a secure Electron desktop shell.

Target environments: Windows/macOS/Linux desktop (Electron), browser (PWA), offline & online modes.
Golden rule: **every business operation works locally first** — `USER ACTION → DOMAIN VALIDATION → LOCAL DB TRANSACTION → LOCAL UI UPDATE → OUTBOX QUEUE → CLOUD SYNC WHEN AVAILABLE`.

## 2. Sandbox mapping (IMPORTANT)

The production target is a pnpm/Turborepo monorepo (`apps/web`, `apps/desktop`, `packages/domain`, `packages/local-db`, `packages/cloud`, `packages/pdf`, …). In this sandbox, the web app IS the deliverable and the monorepo packages are folded into it 1:1:

| Monorepo package | Sandbox location |
|---|---|
| `packages/domain` | `src/lib/domain/` (entities, money, gst, numbering, schemas, documents) |
| `packages/local-db` | `src/lib/db/` (Dexie schema, repositories, seed) |
| `packages/cloud` | `src/lib/server/` + `src/app/api/*` + `prisma/schema.prisma` (dev cloud) + `supabase/` (production DDL) |
| `packages/pdf` | `src/lib/pdf/` (shared document model + jsPDF renderer) |
| `apps/web` | `src/app/` + `src/components/` |
| `apps/desktop` | `electron/` (scaffold: main, preload, typed IPC, services, builder config) |
| `packages/shared`,`config` | `src/lib/utils.ts`, root configs |

Docs describe the **full production architecture**; the sandbox mapping above explains where each concern lives today.

**Routing constraint:** the sandbox preview can only serve `/`. The app therefore ships as an SPA at `/` with **hash navigation** (`#/invoices`, `#/invoices/inv_123`, …). docs/32-ROUTES.md maps each production route to its hash equivalent. API routes (`/api/*`) are real HTTP endpoints (no server actions).

**Testing note:** per environment rules, no test files are bundled in the sandbox. docs/35-TESTING.md and 36-OFFLINE-TESTING.md define the complete Vitest/RTL/Playwright strategies to be added when the monorepo is scaffolded.

## 3. Identity & metadata conventions

- All business entity IDs are **UUIDv4** (`crypto.randomUUID()`). No auto-increment identity for synced entities.
- Every synced entity carries: `id, workspace_id, created_at (ISO), updated_at (ISO), deleted_at (ISO|null), version (int, starts 1), sync_state, origin_device_id`.
- `sync_state` enum: `local` (never pushed) → `pending` (queued op exists) → `synced` → `failed` | `conflict`.
- `device_id`: random UUID persisted in localStorage on first launch.
- Soft deletion: `deleted_at` set, record retained (historical invoices keep meaning). UI hides soft-deleted by default.
- **Dates of financial documents (invoice_date, due_date, quotation_date, valid_until, paid_at) are stored as `YYYY-MM-DD` strings** — never as JS Dates. Timestamps (`created_at`, `updated_at`) are ISO-8601 strings. Currency: INR only in MVP.

## 4. Money & quantity rules (NON-NEGOTIABLE)

- All monetary amounts are **integer minor units (paise)**. Never floats.
- Quantities are **integer milli-units** (`qty_milli`: 2500 = 2.5). Prices in paise per unit.
- Discount and tax rates are **basis points** (bps): 18% GST = `1800`; 5% discount = `500`.
- Rounding: **half-up** on the paise. `roundHalfUp(x) = Math.floor(x + 0.5)` for positive values.
- All math shared by client and server via `src/lib/domain/documents.ts` (`computeDocumentTotals`) — the server **recomputes** every total and overwrites client numbers (never trust client arithmetic).

### Line item computation (exact order)
1. `gross = roundHalfUp(qty_milli * unit_price_paise / 1000)`
2. `discount = roundHalfUp(gross * discount_bps / 10000)`; `grossAfterDisc = gross - discount`
3. **Tax-exclusive pricing:** `taxable = grossAfterDisc`; `taxCombined = roundHalfUp(taxable * gst_rate_bps / 10000)`; `lineTotal = taxable + taxCombined`
   **Tax-inclusive pricing:** `taxable = roundHalfUp(grossAfterDisc * 10000 / (10000 + gst_rate_bps))`; `taxCombined = grossAfterDisc - taxable`; `lineTotal = grossAfterDisc`
4. Intra-state: `cgst = roundHalfUp(taxCombined / 2)`, `sgst = taxCombined - cgst` (odd paise → SGST; UTGST is recorded as SGST with a flag). Inter-state: `igst = taxCombined`.

### Document totals
`subtotalGross = Σ gross`; `discountTotal = Σ discount`; `taxableTotal = Σ taxable`; `cgstTotal/sgstTotal/igstTotal = Σ …`;
additional charges: each `{ id, label, amount_paise, taxable: bool, gst_rate_bps }`; charge tax computed same rule → `chargesTotal = Σ amount`, `chargesTaxTotal = Σ chargeTax`;
`grandTotalRaw = taxableTotal + cgstTotal + sgstTotal + igstTotal + chargesTotal + chargesTaxTotal`;
round-off (configurable): `grandTotal = roundHalfUp(grandTotalRaw / 100) * 100`; `roundOff = grandTotal - grandTotalRaw`.
Amount in words: Indian numbering (crore/lakh/thousand) → `"Rupees One Lakh Twenty Three Thousand and Fifty Paise Only"`.

## 5. GST domain

- GSTIN format validation regex: `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$` (15 chars; state code = first 2 digits).
- 38 state/UT codes (01 Jammu & Kashmir … 38 Sikkim; UTs flagged: Ladakh 38? no — 01 JK(UT), 04 CH, 07 DD&NH & Daman-Diu(merged UT), 09? no). Use the standard list in `src/lib/domain/gst.ts` (`INDIAN_STATES`) with `ut: boolean` for AND(35), CHD(04), DNHDD(26), J&K(01), LDAK(38), PND(07... actual codes preserved there). **Agents: reference the code file; do not re-list states in docs.**
- Intra-state (supplier state code == place-of-supply code) → CGST+SGST (UTGST mapped to SGST slot). Inter-state → IGST.
- Place of supply defaults to customer's billing state; user can override per document.
- Tax rates are configurable per product AND per workspace default (`tax_rates` table keeps versioned rate history: `name, rate_bps, active, effective_from`).
- HSN (goods) / SAC (services) codes stored per product and per line item (snapshot).
- **No legal-compliance claims**: docs must state the app is not certified GST-compliant; it computes GST per rules as understood, keep rates configurable.

## 6. Document numbering

- Format: `{prefix}/{FY}/{seq4}` e.g. `INV/2025-26/0042`; quotation default prefix `QT`. Fiscal year: April–March (`fiscalYearOf('2025-06-01') = '2025-26'`).
- **Drafts get provisional numbers** `DRAFT-<8 random chars>` (displayed clearly as provisional).
- Finalization allocates the real number:
  - Online: server allocates from `document_sequences(workspace_id, doc_type, fiscal_year, next_seq)` inside a serializable transaction; number returned in the op result; **server number always wins** (client adopts it, audit logged).
  - Offline: client allocates locally in a Dexie transaction; on push, server re-validates — if the server sequence is behind, server adopts client number by fast-forwarding its sequence; if the server already issued that number, server issues the next free one and returns it as a **number reassignment** (`status: 'applied'` + `record` with new number + `notice: 'number_reassigned'`); client must adopt it (document immutable once finalized).
- Sequences never decrement. Cancelled invoices keep their number (audit preserved).

## 7. Entity model (fields per table)

Common metadata fields from §3 are implied on all tables below (omitted for brevity). Money fields end in `_paise`; rates in `_bps`; quantities `_milli`. Strings nullable unless stated.

**workspaces**: `name`, `slug` (derived), `owner_user_id?` (cloud), `cloud_linked_at?` (local-only flag), `settings_json?`
**workspace_members**: `workspace_id`, `user_id?`, `device_id?`, `role` (`OWNER|ADMIN|MEMBER|VIEWER`)
**company_profiles** (1 per workspace in MVP; schema supports many): `name`, `business_type`, `logo_data?` (dataURL or attachment ref), `address_line1, address_line2, city, state_name, state_code, pincode`, `gstin`, `pan`, `phone`, `email`, `website`, `bank_name, bank_account, bank_ifsc, bank_branch`, `authorized_signatory`, `signature_data?`, `invoice_prefix` (default `INV`), `quotation_prefix` (default `QT`), `default_gst_rate_bps` (default 1800), `price_includes_tax` (default false), `enable_round_off` (default true), `default_terms?`, `default_notes?`
**customers**: `code?` (auto `CUS-0001`), `type` (`BUSINESS|INDIVIDUAL`), `business_name`, `contact_person`, `email`, `phone`, `gstin`, `billing_address`, `shipping_address`, `state_name`, `state_code`, `notes`
**products**: `name` (req), `sku?`, `hsn_sac?`, `description?`, `unit` (default `NOS`), `selling_price_paise` (req ≥0), `cost_price_paise?`, `gst_rate_bps` (default from company), `price_includes_tax` (bool; falls back to company default), `active` (bool)
**quotations**: `number` (req), `status` (`DRAFT|SENT|ACCEPTED|REJECTED|EXPIRED|CONVERTED`), `quotation_date` (YYYY-MM-DD), `valid_until?`, `customer_id` (req), `customer_name_snapshot`, `customer_gstin_snapshot?`, `place_of_supply_code`, `tax_mode` (`INTRA|INTER` snapshot), `price_includes_tax` (snapshot bool), `subtotal_gross_paise, discount_total_paise, taxable_total_paise, cgst_paise, sgst_paise, igst_paise, charges_total_paise, charges_tax_paise, round_off_paise, grand_total_paise`, `charges_json` (stringified DocCharge[]), `notes?`, `terms?`, `converted_invoice_id?`, `finalized_at?`
**quotation_items**: `quotation_id`, `position` (int), `description`, `hsn_sac?`, `qty_milli`, `unit?`, `unit_price_paise`, `discount_bps`, `gst_rate_bps`, plus computed snapshot columns: `gross_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise`, `price_includes_tax` (snapshot)
**invoices**: mirrors quotations plus: `status` (`DRAFT|FINALIZED|PARTIALLY_PAID|PAID|CANCELLED`), `invoice_date`, `due_date?`, `paid_total_paise` (default 0), `source_quotation_id?`, `cancelled_at?`. (`VOIDED` is future.)
**invoice_items**: mirrors quotation_items (invoice_id).
**payments**: `invoice_id` (req), `amount_paise` (>0), `paid_at` (YYYY-MM-DD), `method` (`CASH|BANK_TRANSFER|UPI|CHEQUE|CARD|OTHER`), `reference?`, `notes?`
**tax_rates**: `name`, `rate_bps`, `active`, `effective_from?`
**document_sequences**: `doc_type` (`INVOICE|QUOTATION`), `fiscal_year`, `next_seq` — unique `[workspace_id+doc_type+fiscal_year]`
**attachments**: `entity_type`, `entity_id`, `filename`, `mime`, `size_bytes`, `data?` (small blobs inline in MVP)
**audit_logs**: `entity_type`, `entity_id`, `action` (`CREATE|UPDATE|FINALIZE|CONVERT|CANCEL|PAYMENT|DELETE|SYNC_CONFLICT|STATUS`), `detail_json?`, `device_id?`, `at`
**sync_operations** (outbox): `op_id` (=id), `workspace_id`, `entity` (`invoice|quotation|customer|product|company|payment|workspace`), `entity_id`, `action` (`upsert|finalize|cancel|delete`), `base_version`, `payload_json` (full record, items embedded for documents), `server_record_json?` (on conflict), `status` (`pending|in_flight|done|failed|conflict`), `attempts`, `last_error?`, `next_attempt_at?`, `created_at`
**sync_metadata** (pk = workspace_id): `push_cursor?`, `pull_cursor` (server ChangeLog seq, default 0), `last_sync_at?`, `last_sync_error?`
**app_settings** (pk = key): generic k/v (`active_workspace_id`, `device_id`, `theme`, `session_cache`, …)

### Dexie schema v1 (indexes)

```
workspaces:            'id, name, updated_at'
workspace_members:     'id, workspace_id, user_id, role'
company_profiles:      'id, workspace_id, updated_at'
customers:             'id, workspace_id, code, gstin, phone, sync_state, updated_at, deleted_at, [workspace_id+deleted_at]'
products:              'id, workspace_id, sku, hsn_sac, active, sync_state, updated_at, deleted_at, [workspace_id+active], [workspace_id+deleted_at]'
quotations:            'id, workspace_id, number, status, quotation_date, customer_id, sync_state, updated_at, deleted_at, [workspace_id+status], [workspace_id+deleted_at]'
quotation_items:       'id, quotation_id, workspace_id, [quotation_id]'
invoices:              'id, workspace_id, number, status, invoice_date, due_date, customer_id, sync_state, updated_at, deleted_at, [workspace_id+status], [workspace_id+deleted_at]'
invoice_items:         'id, invoice_id, workspace_id, [invoice_id]'
payments:              'id, workspace_id, invoice_id, paid_at, sync_state, updated_at, deleted_at, [workspace_id+paid_at], [invoice_id]'
tax_rates:             'id, workspace_id, active, [workspace_id+active]'
document_sequences:    'id, [workspace_id+doc_type+fiscal_year]'
attachments:           'id, workspace_id, entity_type, entity_id, [entity_type+entity_id]'
audit_logs:            'id, workspace_id, entity_type, entity_id, at, [workspace_id+at], [entity_type+entity_id]'
sync_operations:       'id, workspace_id, entity_id, status, created_at, next_attempt_at, [workspace_id+status], [status+created_at]'
sync_metadata:         'workspace_id'
app_settings:          'key'
```
Dexie versioning strategy: append `db.version(n+1).stores({...})` with upgrade callbacks; never mutate v1 in place. Migration docs: docs/16-INDEXEDDB-DATABASE.md.

## 8. Cloud schema & sync server

Production: **Supabase PostgreSQL** — migrations in `supabase/migrations/` (0001_init.sql tables, 0002_rls.sql policies, 0003_functions.sql, seed.sql). UUID PKs, FK to `workspaces(id)`, `updated_at` triggers, soft deletes, RLS on every table via `is_workspace_member(workspace_id)` / `has_role(workspace_id, role[])` helper functions; storage buckets `company-assets` (logos, signatures) and `attachments` with path convention `{workspace_id}/{entity}/{filename}`. Roles: OWNER > ADMIN > MEMBER > VIEWER (VIEWER read-only; MEMBER cannot delete; ADMIN cannot delete workspace). Server-side enforcement only.

Dev cloud (this sandbox): identical relational model in **Prisma/SQLite** (`prisma/schema.prisma`) exposed through Next.js API routes. The sync endpoints are provider-agnostic; production swaps persistence to Supabase (documented in docs/19-CLOUD-SYNC.md). Prisma mirrors: User, Session, Workspace, WorkspaceMember, CompanyProfile, Customer, Product, Quotation(+Item), Invoice(+Item), Payment, TaxRate, DocumentSequence, ChangeLog, ProcessedOp.

**Server-side change log (pull feed):** every applied mutation appends `ChangeLog(seq autoincrement, workspace_id, entity, entity_id, op, payload_json(full record incl. items), at)`. Pull cursor = last seen `seq`.

## 9. Sync protocol (HTTP contract)

Auth: httpOnly session cookie (dev) / Supabase JWT (prod). All endpoints verify workspace membership (server-side).

### POST `/api/sync/push`
```json
// request
{ "device_id": "…", "workspace_id": "…", "schema_version": 1,
  "ops": [ { "op_id": "uuid", "entity": "invoice", "entity_id": "uuid",
             "action": "upsert|finalize|cancel|delete", "base_version": 3,
             "payload": { …full record… } } ] }
// response
{ "results": [ { "op_id": "uuid", "status": "applied|duplicate|conflict|rejected|number_reassigned",
                 "record": {…server record…}, "error": "…" } ], "server_time": "ISO" }
```
Server rules: (1) idempotency via `ProcessedOp(op_id PK)` — replays return `duplicate` with the stored outcome; (2) Zod validation (shared schemas from `src/lib/domain/schemas.ts`) → `rejected` with error; (3) CAS on `base_version` → `conflict` + server record; (4) **totals recomputed server-side** from item payloads; (5) `finalize` allocates document numbers (§6) and stamps `finalized_at`; FINALIZED/PAID invoices reject `upsert`/`delete` (only `cancel`/payments allowed; cancel blocked when payments exist); (6) every apply writes a ChangeLog row + bumps `version`; (7) workspace must exist & caller must be member with role ≥ MEMBER to write.

### GET `/api/sync/pull?workspace_id=…&cursor=<seq>&limit=500`
```json
{ "changes": [ { "seq": 41, "entity": "invoice", "op": "upsert", "record": {…incl items…} } ],
  "next_cursor": 41, "server_time": "ISO" }
```

### Client engine (`src/lib/sync/engine.ts`)
- Triggers: `online` event, app focus, post-mutation, 30 s interval, manual "Sync now".
- Guard: single concurrent run (mutex); skip when offline (navigator.onLine) or workspace not cloud-linked or not authenticated.
- Phase 1 **push**: claim oldest `pending` ops (batch 25, ordered `created_at`) → mark `in_flight` → POST → per-op result handling:
  - `applied|duplicate|number_reassigned` → update local record from `record` (version, sync_state='synced', adopt server number/totals), mark op `done`, prune done ops older than 7 days.
  - `conflict` → store `server_record` on op, op.status='conflict', entity.sync_state='conflict', surface in Settings → Sync → Conflicts.
  - `rejected` → op.status='failed' with error (visible; retryable only by user edit; never silently dropped).
- Phase 2 **pull**: GET changes since cursor; apply inside ONE Dexie transaction: skip records that have a pending local op for the same entity_id (conflict resolved at push time), else upsert (server wins when `record.version > local.version`, setting sync_state='synced'); documents replace embedded items atomically; update `sync_metadata.pull_cursor` + `last_sync_at`.
- Retry/backoff: `attempts++`, `next_attempt_at = now + min(10 min, 2^attempts * 2 s)`; after 8 attempts op → `failed` (manual retry in UI).
- Auth expiry (401): pause sync, flag `needs_reauth`, prompt re-login without data loss.
- Schema version mismatch (HTTP 409 with `{code:'schema_version'}`): stop syncing, show upgrade notice (documented).

## 10. Conflict-resolution framework

Conflict classes & policy matrix:

| # | Scenario | Policy |
|---|---|---|
| 1 | Customer/product edited on 2 devices | 3-way field merge vs base_version; disjoint fields auto-merged; overlapping fields → user conflict UI |
| 2 | Draft invoice/quotation edited on 2 devices | Same as (1) but whole-document granularity for items: items conflict → user chooses local/server copy |
| 3 | Delete vs edit | Edit pushed after delete → conflict UI (restore vs keep deleted) |
| 4 | Two devices finalize same document | First finalize wins (CAS); second gets `conflict` → adopt server record |
| 5 | Two devices claim same invoice number | §6 numbering — deterministic, server authority, no user action needed |
| 6 | Finalized document edits | Rejected server-side (immutable); correction = duplicate → edit → reissue (documented workflow) |

Conflict UI (Settings → Sync → Conflicts): side-by-side diff (local vs server), actions **Keep mine** (re-enqueue as new op with base_version = server version) / **Keep server's** (adopt server record) / for deletable entities **Delete**. Every resolution writes `audit_logs(action='SYNC_CONFLICT')`. Never silently merge financial changes. Diagrams in docs/18-CONFLICT-RESOLUTION.md.

## 11. Auth & account model (offline-first, guest-first)

- **Guest mode** is first-class: app usable fully offline with a local workspace; no account required. Banner shows "Guest workspace — connect cloud to sync".
- Dev auth (this sandbox): `POST /api/auth/register {name,email,password}` / `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/session`. Passwords hashed with **scrypt** (random 16-byte salt, 64-byte key, timing-safe compare). Sessions: random 32-byte token, `if_session` httpOnly SameSite=Lax cookie, 30-day expiry, `Session` table. Rate limited (in-memory token bucket, 10 req/min/IP on auth routes). In production this adapter is replaced by **Supabase Auth** (email/password + Google OAuth); interface documented in docs/07-AUTHENTICATION.md (the app never embeds service keys).
- **Workspace claim** (`POST /api/workspace/claim {workspace_id, name, device_id}`, authenticated): creates server workspace owned by caller + OWNER membership + initial ChangeLog entry; client then sets `cloud_linked_at`, resets `pull_cursor=0`, and the sync engine pushes the full local dataset as normal ops (bulk-safe). This is the guest→account migration path. Registering while a guest workspace exists triggers claim automatically.
- Account deletion: `DELETE /api/auth/account` → cascades user data server-side; local data remains (user may clear it); documented in SECURITY docs.

## 12. Document lifecycles (state machines)

Quotation: `DRAFT → SENT → ACCEPTED → REJECTED`; `→ CONVERTED` (from ACCEPTED); `EXPIRED` computed when `valid_until < today` and not converted (lazy status update on read). Draft edits allowed; after SENT only status transitions; CONVERTED/EXPIRED terminal (EXPIRED allows duplicate).
Invoice: `DRAFT → FINALIZED` (number allocated, immutable) `→ PARTIALLY_PAID → PAID` (driven by payments; server recalculates); `FINALIZED|PARTIALLY_PAID → CANCELLED` only when `paid_total = 0` (else blocked with explanation). Draft number = provisional. Duplicate allowed from any state (creates fresh DRAFT). Conversion: ACCEPTED quotation → new invoice DRAFT (items/charges/notes/terms copied, `source_quotation_id` set) → quotation `CONVERTED` (with `converted_invoice_id`); conversion enqueues both ops; audit logged on both documents.
All transitions validate locally (Zod + state checks) AND server-side; audit_logs record every transition.

## 13. PDF system

- Library: **jsPDF + jspdf-autotable** (client-side, offline-capable, deterministic vector output, no headless browser needed; Electron additionally offers native `printToPDF` via IPC). Rationale documented in docs/14-PDF-GENERATION.md.
- Shared **UnifiedDocumentModel** (`src/lib/pdf/document-model.ts`) built from either invoice or quotation via `src/lib/domain/documents.ts` — one source for preview & export; totals come exclusively from the domain engine.
- A4 portrait, Helvetica core fonts. **Known limitation:** the ₹ glyph is absent from jsPDF core fonts → PDFs render `Rs.` prefix (documented); UI shows `₹` via Intl.
- Layout: header (logo/company, doc title `TAX INVOICE`/`QUOTATION`, meta grid: number, dates, place of supply), Bill-To block (name, address, GSTIN, state), items table (# / Item & description / HSN-SAC / Qty / Rate / Discount / Taxable / GST% / GST amt / Amount), totals block (Subtotal, Discount, Taxable value, CGST, SGST/UTGST or IGST, charges, round-off, **Grand Total**), amount in words, bank details (invoices), notes, terms, signature image + authorized signatory, page numbering `Page x of y`, footer "Generated by InvoiceFlow".
- Outputs: `save` (download `INV-2025-26-0042.pdf`), `blob` (in-app preview via object URL in iframe), `print` (Electron only).
- Filename: doc number with `/` → `-`.

## 14. API surface (dev cloud)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | liveness + `{ ok, time, version }` (also used as connectivity heartbeat) |
| `/api/auth/register` | POST | create account (+claim guest workspace if any) |
| `/api/auth/login` | POST | session cookie |
| `/api/auth/logout` | POST | destroy session |
| `/api/auth/session` | GET | current user or `{ user: null }` |
| `/api/auth/account` | DELETE | delete account + server data |
| `/api/workspace/claim` | POST | attach local workspace to account (§11) |
| `/api/sync/push` | POST | §9 |
| `/api/sync/pull` | GET | §9 |

All request/response bodies JSON; errors `{ error: string, code?: string }` with proper HTTP codes (400 validation, 401 unauthenticated, 403 forbidden/not member, 404 missing, 409 conflict, 429 rate-limited, 500). Full contracts: docs/30-API-DESIGN.md & API.md.

## 15. UI/UX system

- **Layout**: fixed dark sidebar (slate-950) with emerald accents, content area light `slate-50`/dark `slate-950`; topbar (page title, global search ⌘K, offline badge, sync pill, theme toggle, user menu); **footer** sticky-bottom (`min-h-screen flex flex-col` root + `mt-auto`) showing app version • sync status • workspace. Mobile: Sheet-based drawer nav.
- **Palette**: primary = emerald (light `emerald-600`, dark `emerald-500`); neutrals = slate; semantic: paid=emerald, unpaid=amber, overdue=red, draft=slate, synced=emerald dot, pending-sync=amber dot. NO blue/indigo.
- **Hash routes** (`src/lib/router.ts`): `#/dashboard` (default), `#/invoices`, `#/invoices/new`, `#/invoices/:id`, `#/quotations`, `#/quotations/new`, `#/quotations/:id`, `#/customers`, `#/customers/:id`, `#/products`, `#/payments`, `#/reports`, `#/company`, `#/settings`, `#/login`. Production route table in docs/32-ROUTES.md.
- **States**: every list has empty state (icon + copy + CTA); loading skeletons; offline banner; sync pill (Synced / Pending N / Offline / Syncing / Error); destructive actions use AlertDialog confirm; toasts (sonner) for feedback; keyboard: ⌘K search, all actions reachable via tab focus, visible focus rings.
- **Tables**: sortable headers, search, filters, pagination (client-side, 10/page), `max-h-[70vh] overflow-y-auto` with custom scrollbars for long lists.
- **Document editor** (shared for invoice/quotation, `kind: 'invoice'|'quotation'`): customer picker (+quick-create), dates, place of supply, product picker per line (fills HSN/rate/unit/price), editable items, charges list, tax-inclusive toggle, live totals panel, notes/terms prefilled from company, Save draft / Save & finalize (invoice) or Save & mark SENT (quotation).
- **Forms** (customer/product/company/auth): react-hook-form + zodResolver; document editor uses controlled state (documented choice for dynamic line items).
- **Dashboard**: 8 KPI stat cards (total invoices, drafts, paid, unpaid, overdue, quotations, accepted quotations, outstanding), revenue trend chart (monthly invoiced vs collected, 6 months), recent activity, sync status card, quick actions.
- **Reports**: tabs (Sales, GST Summary, Outstanding, Customers, Products) + date range (FY default) + CSV export (UTF-8 BOM) everywhere.
- **Settings** tabs: Company (link), Preferences (defaults), Sync (status, manual sync, outbox table, conflicts UI, failed ops retry), Data (JSON backup export/import, CSV shortcuts, clear local data), Security (account, guest→cloud, logout, delete account), About.
- **Onboarding** (no company profile): welcome → create company form OR "Load sample data" OR sign in.
- Theme via next-themes (light/dark/system). Fonts: Geist. Icons: lucide only.

## 16. Security baseline

Zod validation on both ends; server recomputes money & membership/role checks on every op; parameterized queries (Prisma) / RLS (Supabase); XSS-safe React rendering (no dangerouslySetInnerHTML); CSRF: SameSite=Lax cookies + JSON-only APIs (no GET mutations); upload validation: logo/signature limited to PNG/JPEG ≤ 1 MB (client check + dataURL size check); rate limiting on auth; scrypt password hashing (dev) / Supabase Auth (prod); **service-role keys only server-side, never bundled**; Electron: contextIsolation true, nodeIntegration false, sandbox true, CSP `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`, typed contextBridge API only, external links via controlled `shell.openExternal` with https allow-list, no remote content; audit logs for finalize/convert/cancel/payment/conflict; dependency audit in CI. Details: docs/29-SECURITY.md.

## 17. Offline modes & PWA

- Desktop offline: full CRUD + PDF via Electron (local files), outbox drains on reconnect.
- Web offline: service worker `public/sw.js` (cache-first for static assets, network-first for `/` navigation with offline fallback, cache versioned `invoiceflow-v1`, activate cleans old caches) + `manifest.webmanifest` (installable). Registration only in production builds (avoids clobbering dev HMR). `navigator.onLine` + heartbeat to `/api/health` drive the offline badge. IndexedDB is the store of record — all features except cloud sync work with zero network.
- Browser limitations documented: storage eviction risk (no persistence API request in MVP), no native printing (falls back to PDF download), SW unsupported → app still works online-first.

## 18. Phase plan (delivery mapping)

Phase 0 docs/architecture → Phase 1 foundation (this sandbox scaffold) → Phase 2 local DB + domain (money/GST engine, repos) → Phase 3 MVP documents (quotation/invoice editors, numbering, PDF, dashboard) → Phase 4 offline engine (outbox, retry, pull/push, conflicts UI) → Phase 5 cloud (dev-auth now, Supabase migrations + RLS ready; swap documented) → Phase 6 reports (GST/outstanding/CSV, audit) → Phase 7 SaaS (subscription/teams extension points — NOT implemented; docs only) → Phase 8 testing/release (docs/CI defined; packaging via electron-builder config). Changelog tracks each.

## 19. Explicit assumptions & limitations (quote these in docs)

1. Currency INR only; English UI; `Rs.` in PDFs (font limitation).
2. GST logic follows Indian GST rules as commonly understood; **not legally certified** — professional validation required before statutory reliance.
3. MVP payments = manual recording (no gateway). Razorpay/Stripe/WhatsApp/email/subscription are designed extension points (docs 24-28), not implemented.
4. Dev cloud uses SQLite via Next API routes; production target is Supabase Postgres with RLS (migrations provided). Sync protocol identical for both.
5. No test files in sandbox (environment rule); full test strategy documented in docs/35-TESTING.md & 36-OFFLINE-TESTING.md.
6. Electron is a scaffold (cannot execute in sandbox) — security-hardened main/preload/IPC code + builder config provided; renderer reuses the web app verbatim.
7. Team collaboration (multi-user roles) is schema/policy-ready; UI limited to owner workflows in MVP.
8. Browser data eviction: users are advised to install as PWA / use desktop app for durability; JSON backup provided.
