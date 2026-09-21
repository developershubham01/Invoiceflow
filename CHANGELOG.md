# Changelog

All notable changes to InvoiceFlow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-09-21

### Added

- Customer statement PDF export: ledger-style A4 document (company header, customer block, period, Invoiced/Collected/Outstanding tiles, zebra debit/credit/balance table with totals row, offline footer note) rendered on-device with jsPDF — the "PDF" button sits beside the statement's CSV export and honours the selected period.
- Payment-method chips: icon + label badges (CASH → banknote/emerald, BANK_TRANSFER → landmark/teal, UPI → smartphone/amber, CHEQUE → scroll/orange, CARD → card/accent, OTHER → muted) used in the payments list and per-invoice payment history; payment history rows restructured with hover feedback.

### Fixed

- **Quotation lifecycle lost in sync (major)**: quotation status transitions (DRAFT→SENT→ACCEPTED/REJECTED) were sent as ordinary upsert ops, which the server treats as content edits — `recomputeDocument` preserves only `DRAFT|CONVERTED`, so the server reset the status to DRAFT and the pull then silently reverted the client. `setQuotationStatus` now flags its op with `status_change: true`, routing the server into the dedicated lifecycle-transition branch; that branch also adopts a client-allocated official number on DRAFT→SENT and fast-forwards the server sequence (CANON §6). Verified end-to-end: DRAFT→SENT→ACCEPTED→CONVERTED all persist server-side (versions 3/4) and locally after pull, with the convert banner linking to the generated draft invoice.

### Verified (QA round)

- Full quotation lifecycle with sync persistence; quotation→invoice conversion totals match; finalize allocates `INV/2026-27/0007`; partial payment ₹10,000 → local PARTIALLY_PAID + server-side recalculation published via ChangeLog; editor creates a synced draft from catalog fields; GST Summary / reports tabs; company numbering config (prefixes, default GST rate, round-off); mobile 390 px layout (hamburger nav, horizontally scrollable tables).

## [0.2.0] - 2025-09-21

### Added

- Customer account statement (detail view): period-filtered chronological debits (tax invoices) and credits (payments) with a running balance, Invoiced/Collected/Outstanding summary tiles, and per-customer CSV export following the docs/21 column conventions.
- Payment-reminder assistant on finalized invoices: one-click "Reminder" builds a polite, WhatsApp/SMS-ready message with invoice number, due-date/overdue-day computation, amount paid, balance due, and company bank details, then copies it to the clipboard with a toast.
- Dashboard "Top customers by outstanding" widget with proportional amber/emerald bars, all-time invoiced totals, and click-through to the customer detail.
- Dashboard activity feed upgrade: per-action iconography (payment/finalize/convert/cancel/status) with emerald/amber/red tones and human-readable labels.
- Global keyboard shortcuts (desktop power users): `N` new invoice, `Shift+N` new quotation, `D/I/Q/C/P/R/S` view navigation — suppressed while typing or when a modal is open; discoverable via a shortcuts group in the Ctrl+K palette and a hint row in the sidebar footer.
- Editable customer code in the customer form (blank = auto-numbered; custom ledger codes such as `RM-001` are allowed).

### Fixed

- **Sync correctness (major)**: outbox ops were enqueued with the *post-save* record version as `base_version`, so the server's compare-and-swap rejected every first update of any already-synced record as a spurious conflict. All 14 repository call sites (company/customer/product upserts and deletes, invoice upsert/finalize/cancel/delete, payments, quotation upserts/status/convert/delete) now pass the *pre-edit* base version. Verified end-to-end: create → claim → edit → sync lands cleanly; pre-existing conflicts resolve via keep-mine.
- **Customer code duplication**: concurrent `saveCustomer` calls (Promise.all demo seeding, rapid UI saves) raced on the read-modify-write of `CUS-####` allocation. Allocation now happens inside the same IndexedDB readwrite transaction as the put (IDB serializes overlapping rw transactions), so every concurrent create observes a unique sequence. Verified: concurrent seed produces CUS-0001…0005 with zero duplicates.
- Pre-existing TypeScript error in `setQuotationStatus`: Dexie six-table `transaction()` call now uses the array-form overload (clean `tsc --noEmit` for `src/`).
- Sandbox rendering defect: a stale Turbopack CSS chunk served the default shadcn theme (white sidebar, `#171717` primary, default charts) instead of the InvoiceFlow emerald/dark-sidebar tokens; touching `globals.css` forced a recompile and the intended theme restored everywhere (including chart tokens in Reports).

### Changed

- Visual polish: subtle per-view enter animation (respects `prefers-reduced-motion`), hover lift + shadow on KPI stat cards and customer cards, `active:scale-[0.98]` press feedback on all buttons, and horizontal scroll enabled on the invoice/quotation/payment list tables for narrow screens.

## [0.1.0] - 2025-09-21

### Added

- Offline-first core: Dexie schema v1 (17 tables) with a compound-index strategy, typed repositories, and an operation outbox (`sync_operations`) tracking per-op status, attempts, and backoff.
- Domain engine: integer-paise money math (quantities in milli-units, rates/discounts in basis points, half-up rounding), tax-inclusive and tax-exclusive pricing, document totals with additional charges and round-off, CGST/SGST/IGST split by place of supply, GSTIN/state-code validation, Indian-numbering amount in words, and fiscal-year document numbering (April–March) with provisional draft numbers and server-authoritative allocation.
- Quotation module with full lifecycle (DRAFT → SENT → ACCEPTED/REJECTED, CONVERTED, lazy EXPIRED) and conversion into invoices.
- Invoice module with lifecycle (DRAFT → FINALIZED → PARTIALLY_PAID → PAID, CANCELLED), finalization immutability, payment-driven status, cancellation blocked when payments exist, and manual payment recording (CASH/BANK_TRANSFER/UPI/CHEQUE/CARD/OTHER).
- PDF generation with jsPDF + jspdf-autotable from a shared UnifiedDocumentModel: A4 portrait layout, GST breakdown, bank details, amount in words, signature block, page numbering; save/preview outputs (`Rs.` renders instead of `₹` due to jsPDF core-font limitation).
- Dashboard with 8 KPI stat cards, monthly invoiced-vs-collected revenue trend, recent activity, and quick actions.
- Reports (Sales, GST Summary, Outstanding, Customers, Products) with date ranges and CSV export (UTF-8 BOM).
- Sync engine: batched push (25 ops) and cursor-based pull (500 changes), single-run mutex, retry with exponential backoff capped at 10 minutes and failure after 8 attempts, schema-version guard (409), auth-expiry pause with `needs_reauth`, and done-op pruning.
- Dev cloud: Next.js API routes (auth register/login/logout/session/account, workspace claim, sync push/pull, health) over Prisma/SQLite with a server-side ChangeLog and `ProcessedOp` idempotency.
- Auth: scrypt password hashing (random salt, timing-safe compare), httpOnly `SameSite=Lax` session cookies with 30-day expiry, in-memory rate limiting (10 req/min/IP) on auth routes, and guest-workspace claim flow (guest → account migration).
- Conflict-resolution framework: compare-and-swap on `base_version`, six documented conflict classes with a policy matrix, and a side-by-side conflict UI (keep mine / keep server's / delete) with `SYNC_CONFLICT` audit logging.
- Settings: JSON backup export/import, CSV shortcuts, clear local data, sync status with outbox inspector and failed-op retry, preferences, and security (account, guest→cloud, delete account).
- PWA: `manifest.webmanifest` and service worker (cache-first static assets, network-first navigation with offline fallback, versioned caches), offline badge driven by `navigator.onLine` plus a `/api/health` heartbeat.
- Electron desktop scaffold: hardened main/preload with typed IPC, services, CSP, and electron-builder configuration (scaffold only; renderer reuses the web app verbatim).
- Supabase migrations: initial DDL, row-level-security policies with `is_workspace_member`/`has_role` helpers on every table, functions, and seed data.
- Documentation: canonical specification (`docs/_CANON.md`) plus 41 module documents (`docs/01-PROJECT-OVERVIEW` through `docs/41-FUTURE-ROADMAP`).

### Changed

- The sandbox build serves the app as a single-page application at `/` with hash navigation (`#/invoices`, `#/quotations`, …) so every screen works from one served route; the production route table is documented in `docs/32-ROUTES.md`.
- Quotation and invoice editing shares one document editor and domain engine rather than parallel implementations; totals shown anywhere come exclusively from `computeDocumentTotals`.

### Security

- Server-side recomputation of all monetary totals and workspace membership/role checks on every operation; Zod validation on both client and server.
- scrypt password hashing (16-byte random salt, 64-byte key, timing-safe comparison), httpOnly `SameSite=Lax` session cookies with 30-day expiry, and JSON-only API (no GET mutations) for CSRF safety.
- Rate limiting on auth routes (10 requests/min/IP, in-memory token bucket) and upload validation for logos/signatures (PNG/JPEG ≤ 1 MB).
- Supabase row-level security on every table with OWNER/ADMIN/MEMBER/VIEWER role helpers (migrations provided; enforcement server-side only).
- Electron hardening baseline: contextIsolation enabled, nodeIntegration disabled, sandbox enabled, strict CSP, typed contextBridge API only, https allow-listed external links, no remote content.
- Service-role keys restricted to server-side code (never bundled); audit logs recorded for finalize/convert/cancel/payment/conflict events.
