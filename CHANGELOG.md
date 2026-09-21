# Changelog

All notable changes to InvoiceFlow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2025-09-21

### Added

- **Bulk actions on the quotations list** (parity with invoices): checkbox column with select-all/indeterminate header, floating bulk bar with count + value, "Mark N drafts sent" (drives the real lifecycle transition so official `QT/FY/####` numbers are allocated per document — the same path as the detail view), "Delete drafts" with confirmation, selected-rows CSV export, and Clear. Same conditional-disable, per-item error toast, and auto-clear semantics as invoices.
- **Bulk payment reminders from the invoices selection**: when the selection contains issued invoices with a balance, a "Remind (N)" button appears in the bulk bar. It opens a menu with "Copy N reminders" (one polished block per invoice, separated by dividers — each greeting uses the customer's contact person when known) and "Open in WhatsApp (most overdue)" — the single most overdue, then largest-balance invoice is pre-filled via its own `wa.me` deep link, never a tab-per-invoice flood. The menu footer reports "X overdue · Y due later".
- **Shared reminder module** (`src/lib/reminder.ts`): `buildPaymentReminderText`, `isInvoiceOverdue`, `whatsappTarget` and `openWhatsAppReminder` extracted from the invoice detail view; the detail view now delegates to it so single and bulk reminders can never drift apart in wording.
- **Next-number preview in My Company**: the invoice and quotation prefix fields now show a live, read-only "Next: INV/2026-27/0007" style hint beneath them (new read-only `peekNextNumber` repository helper — no sequence mutation). The preview updates as you type a custom prefix, and demonstrates sequence continuity (prefix changes don't reset numbers, per CANON §6).

### Improved (styling)

- Stat-card icon micro-interaction: tone-coloured icon chips scale to 110% with a −6° tilt on card hover and compress to 95% on press — tactile feedback on every dashboard KPI.
- Quotations "expiring" hint: sent quotations within 7 days of their valid-until date get an amber clock chip beside the date (reuses the shared local-safe `addDaysStr` helper; no timezone drift).
- Remind button styled as an emerald-outline chip inside the bulk bar, visually grouped with the WhatsApp concept it triggers.

### Verified (QA round 5)

- Fresh-profile boot test: empty IndexedDB correctly lands on onboarding; "Explore with sample data" seeds 8 invoices / 5 customers with unique codes CUS-0001..0005 (Task-4 race fix still holds); guest mode exercised end-to-end.
- Dev server OOM (2.1 GB RSS) killed the server mid-round; restarted detached (`(bun run dev > /tmp/devlive.log 2>&1 &)`), app recovered with hash-route and IndexedDB intact — the offline-first resume path held.
- Quotation bulk flow exercised by creating a draft through the editor UI (live totals ₹3,540.00 = 2 × ₹1,500 + 18% GST), then bulk "Mark 1 draft sent" → QT/2026-27/0004 SENT with official number; second draft (valid-until +5 days) → QT/2026-27/0005 shows the amber "expiring" chip.
- Bulk reminders: selected INV/0005+0004 (overdue) + INV/0006 (due later) → menu correctly reported "2 overdue · 1 due later"; "Open in WhatsApp" captured via stubbed `window.open` → `wa.me/919830055555` pre-filled with the most-overdue invoice (INV/2026-27/0004), greeting the contact person by name, balance Rs. 12,600.00. Clipboard write is permission-blocked in the headless session (clean fallback toast verified; pattern proven in real browsers in Task 4).
- My Company preview verified live: INV/2026-27/0007 / QT/2026-27/0006, and typing a custom prefix ("ACME") instantly re-renders "ACME/2026-27/0007" without mutating the stored sequence.
- Mobile 390 px: quotation bulk bar wraps to two rows of ≥44 px targets with correct disabled dimming; `bun run lint` exit 0; `tsc --noEmit` 0 errors in `src/`.

## [0.5.0] - 2025-09-21

### Added

- **Bulk actions on the invoices list**: a checkbox column (with select-all / indeterminate header state) and a floating bulk-action bar. The bar shows the selection count and combined value, then offers "Finalize N drafts" (loops the offline number allocator, official numbers per document), "Delete drafts" (AlertDialog confirmation; drafts only — finalized documents must be cancelled), "CSV" (export exactly the selected rows with totals/balances), and "Clear". Buttons are conditionally disabled when the selection contains no drafts; per-item failures surface as individual error toasts next to the summary success toast; selection auto-clears after every operation.
- **Dashboard insight panel** (right column): the three stacked cards (Top customers by outstanding, Cash-flow health, Recent activity) are now tabs in one card — Customers / Cash flow / Activity — roughly halving the column height on short screens (the Task-6 layout risk). Content fades in on tab switch; the Workspace card stays pinned above it.
- **Statement share (WhatsApp-ready)**: the customer account statement gains a "Share" menu — "Open in WhatsApp" deep-links `wa.me` with a period-aware summary (greeting to the contact person, invoice count, Invoiced/Received/Outstanding in Rs., a settle-or-thanks closing line, and the company signature; phone normalised to the 91 prefix when 10 digits), while "Copy summary text" mirrors it to the clipboard; the menu footer shows the target number (same pattern as the invoice payment reminder).

### Improved (styling)

- Bulk bar: slide-up entrance animation, emerald hairline glow along its top edge, emerald count pill, sticky positioning above the table.
- Selected rows get an emerald tint (light + dark) and `aria-selected`, visually distinct from hover.
- Invoices and quotations rows now reveal an emerald chevron affordance on hover (last column) — consistent "this row opens" cue across sales lists.
- Quotations status filter now shows per-status counts, matching the invoices filter.
- Tab panels animate a 200 ms fade-rise on activation (reduced-motion safe, shared keyframe).

### Verified (QA round 4)

- Baseline agent-browser sweep: all 9 views render, console clean, light + dark themes correct (a bottom-left circular "N" was investigated and identified as the Next.js dev-tools portal overlay — dev-only, not an app bug), mobile 390 px OK, `bun run lint` exit 0, `tsc --noEmit` 0 errors in `src/`.
- Bulk finalize exercised in-browser: 2 drafts selected → bar showed "2 selected · ₹91,647.00" → Finalize → both rows FINALIZED with official numbers INV/2026-27/0008 and 0009 allocated; KPIs recomputed live (Total invoiced ₹2.26L→₹3.18L, collection rate 65%→46%); cloud ChangeLog recorded `finalize` ops at seq 296/297.
- Bulk delete exercised: remaining draft selected → confirmation dialog → removed; cloud ChangeLog `delete` op at seq 298. Sync pill stayed Synced throughout.
- Dashboard tabs switched via Radix triggers (Customers / Cash flow / Activity all render correct content); statement Share menu verified with stubbed `window.open` (URL `wa.me/919886044444`, 91-prefixed, pre-filled 401-char summary) and the copy path exercised.

## [0.4.0] - 2025-09-21

### Added

- WhatsApp payment reminder (one-tap share): the invoice "Reminder" button is now a split menu — "Open in WhatsApp" builds a `wa.me` deep link with the reminder pre-filled (customer phone normalised to the 91 country code when 10 digits; falls back to contact-picker mode with a hint when no number is saved), while "Copy reminder text" keeps the clipboard path; the menu footer shows the target number (or "No phone saved").
- Line-item reordering in the invoice/quotation editor: hover-revealed ↑/↓ arrows around the row number on desktop (disabled arrows fade out at the boundaries), always-visible touch controls on mobile; line order is part of the saved document payload and therefore flows to PDF output and sync unchanged.
- Dashboard "Cash-flow health" card: collection rate (gradient emerald progress bar with collected-vs-invoiced caption), average days-to-pay computed per payment (payment date − invoice date, with payment count), and overdue share of outstanding in a warning-tinted tile that highlights amber above 25%.
- Single source of truth for the app version: `src/lib/version.ts` (`APP_VERSION`) now feeds the sidebar footer, status bar, Settings → App & device, onboarding, and auth screens; `package.json` aligned at 0.4.0.

### Fixed

- **Editor line-items grid misalignment (desktop)**: the header declared 8 columns but each row rendered 9 cells, so every field sat under the wrong label (unit under "Rate", rate under "Discount") and the GST select/trash wrapped off-grid. Rebuilt as an explicit 9-column grid (`reorder / description / HSN / qty / unit / rate / discount / GST / remove`) with matching header labels including the previously missing "Unit".
- Stale version strings: three files still advertised v0.1.0 (and package.json 0.2.1) while the changelog was at 0.3.0.

### Improved (styling)

- Soft zebra striping on all data tables via `color-mix` on `--muted` (works in light and dark), with hover override for keyboard/touch scanning.
- Editor item rows: emerald hover tint, focus-within border highlight, hover-revealed delete button (always visible on touch), tabular-nums on qty/rate inputs; spin-buttons removed from decimal inputs globally.
- Dashboard KPI grid entrance: staggered rise-in animation (40 ms per card, disabled under `prefers-reduced-motion`).

### Verified (QA round)

- agent-browser sweep of all 9 views, invoice detail, PDF preview dialog, editor (desktop 1440 px + mobile 390 px), light and dark themes; reminder menu exercised end-to-end with a stubbed `window.open` (URL prefix 91, 334-char pre-filled text); reorder verified by moving a typed row down (order swaps); cash-flow metrics cross-checked against reports (65% = ₹1.47L/₹2.26L collected/invoiced); `bun run lint` clean; `tsc --noEmit` clean for `src/`.

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
