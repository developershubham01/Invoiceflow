# Changelog

All notable changes to InvoiceFlow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0] - 2025-09-22

### Added

- **Document templates — 8 themed designs for invoices and 8 for quotations** (Settings → My Company → Document templates):
  - Every template pairs a distinct **page layout** with a distinct **color theme**, so switching changes the whole identity of the PDF, not just a color: Classic Emerald (accent band), Midnight Slate (full-width dark header block, amber total), Royal Violet (corner brand block, violet table head), Sunset Orange (vertical accent sidebar on every page, outlined total), Ocean Teal (centered letterhead, teal table head), Crimson Formal (serif two-tone split letterhead, ruled table, deep-crimson total panel), Mono Minimal (ink-saver: heavy top rule, no fills, outlined total), Saffron Gold (festive banner, gold total bar).
  - **Template gallery** with live miniature mockups (header geometry, table-head treatment and grand-total style mirror the real PDF), Invoice/Quotation tabs, per-kind selection stored on the company profile (`invoice_template` / `quotation_template`), cloud-synced end-to-end (Prisma, Zod, Dexie, push handler).
  - **Template switcher inside the PDF preview dialog** — preview/export any document in any of the 8 templates ("This preview only" — the saved default is untouched); the company default is resolved and labeled in the dropdown.
  - Template resolution happens inside the shared renderer, so detail-page export, batch export and preview all honor the selection automatically; UPI scan-to-pay QR, amount-in-words, bank details and signatures render correctly in every template.

### Verified (QA round 13)

- Gallery renders 8 distinct thumbnails per tab (desktop 4-col, mobile 390px 2-col, no horizontal overflow); selection ring + check badge; saved values persisted (`midnight-slate` invoice / `crimson-formal` quotation confirmed in IndexedDB).
- Invoice PDF preview renders Midnight Slate (dark header block, amber grand total); override → Ocean Teal re-renders (centered teal letterhead, teal table head); UPI QR intact in both.
- Quotation PDF preview renders Crimson Formal (serif split letterhead, ruled table with crimson underline, deep-crimson total panel); override → Sunset Orange (full-height sidebar strip, outlined total).
- Statement PDF export path (`downloadPdf` consumers) functional; console clean after a Turbopack cache rebuild (transient mid-edit export warnings were stale history — occurrence count flat across navigation); lint exit 0; tsc 0 errors in `src/`.

## [0.12.0] - 2025-09-22

### Added

- **Document formats section (My Company)** — full control over how invoice & quotation numbers and dates are laid out:
  - **Number format builder** per document type: a token pattern (`{PREFIX}` `/{FY}` `{Y}` `{M}` `{SEQ}` / `{SEQ:N}` for N-digit padding) with clickable token chips, inline validation (must contain a `{SEQ}` token, safe characters only, ≤ 60 chars), a **live "Next number" preview** that updates as you type, and a one-click reset to the classic `INV/2026-27/0001` layout.
  - The offline allocator renders the configured pattern while keeping the per-fiscal-year running sequence untouched — verified that switching layouts mid-year is safe (sequence continued `0007 → 0008` across a layout change).
  - **Document date format**: `DD MMM YYYY` (default), `DD/MM/YYYY`, `DD-MM-YYYY`, `MM/DD/YYYY` — with a live sample, an explicit "Default" option to unset, and application across invoice/quotation **PDFs** (`Date`/`Due`/`Valid until`), **customer statement PDFs** (period + ledger dates) and the **detail pages** (Issued/Due/Dated/Valid until, payment history).
  - Patterns and the date format sync through the cloud pipeline (`invoice_number_pattern`, `quotation_number_pattern`, `doc_date_format` — type, Zod schema, Dexie defaults, Prisma columns, push handler).
- Invalid patterns block saving (Save is disabled and the specific error is shown inline under the field).

### Verified (QA round 12)

- `{PREFIX}-{Y}-{SEQ:2}` → invoice finalized as **INV-2026-07**; `QT-{FY}-{SEQ:3}` → quotation sent as **QT-2026-27-004**; token chips insert, reset chips restore defaults, invalid pattern (`{PREFIX}/{FY}`) → inline error + disabled Save.
- Date format DD/MM/YYYY → detail header "Issued 22/09/2026" and the PDF preview renders the same under the document number (with the UPI QR unaffected).
- Header stable through the whole flow; mobile 390px shows the card without horizontal scroll; light + dark screenshots captured; lint exit 0; tsc 0 errors in `src/`.

## [0.11.1] - 2025-09-22

### Fixed

- **Header can no longer disappear on interaction (structural fix).** The app had zero error boundaries: any uncaught exception during a view's render/effect unmounted the *entire* React root — header, sidebar and footer included — leaving a blank page (the reported "header sometimes disappears" symptom). Now:
  - New `ViewErrorBoundary` wraps the view slot inside `AppShell`: a crashing view is replaced by an in-place recovery card ("Try again" / "Go to dashboard") while the header, sidebar and footer stay mounted and stable. The boundary auto-resets on route change (keyed by the first route segment).
  - New `src/app/error.tsx` (route-level) and `src/app/global-error.tsx` (last-resort) boundaries cover the full-screen views (onboarding, sign-in) and catastrophic failures, each with an explicit recovery action.
  - Verified with an injected render crash: header remained at `top:0`, sidebar intact, fallback card shown, "Try again" recovered the view, subsequent navigation normal.

- **Creating a customer was broken** (`Failed to execute 'put' on 'IDBObjectStore': Evaluating the object store's key path yielded a value that is not a valid key`). Root cause: the views pass `id: form.id`, which is explicitly `undefined` for creates; the create branch spread `...input` *after* `id: crypto.randomUUID()`, so the explicit `undefined` clobbered the generated UUID and the IndexedDB put failed with `DataError`. Fixed with a `withoutBlankId()` guard in the repository layer (`saveCustomer`, `saveProduct`, `saveCompany` — the same latent bug existed in all three, including first-time company save from My Company). Verified: new customer auto-numbered `CUS-0006`, new product saved, dialog closes, toast + row correct.

- **Mobile nav sheet logged Radix a11y warnings** ("Missing `Description` or `aria-describedby={undefined}` for {DialogContent}") on every open — added an sr-only `SheetDescription`. Also fixed the stale hardcoded `v0.1.0` footer inside the mobile sheet (now uses `APP_VERSION`).

### Improved (styling)

- At 320px viewports the header's right control cluster overflowed the viewport by 3px (`body.scrollWidth 323 > 320`) — the cluster gap now tightens below `sm:` (`gap-1.5 sm:gap-2`); verified no horizontal scroll at any width from 320–1920.

### Verified (QA round 11 — full audit)

- Header present, visible, sticky at `top:0` after: all 9 nav routes, invoice/quotation/customer details, editor form typing + comboboxes, validation errors, successful submits, payment dialog, finalize confirm dialog, PDF preview, search dialog (click + Ctrl+K), theme toggle, user menu, workspace switcher, mobile hamburger menu, scrolling (desktop + 390px mobile), browser back/forward, malformed ids (`#/invoices/does-not-exist`) and unknown segments.
- Console clean apart from pre-existing historical entries; no hydration errors; lint exit 0; tsc 0 errors in `src/`.

## [0.11.0] - 2025-09-21

### Added

- **UPI scan-to-pay QR** — the flagship of this release, fully offline:
  - New `upi_vpa` field on the company profile (validated `name@bank` format, lowercased). Synced end-to-end: local schema/type, push handler (`upiVpa`), and Prisma `CompanyProfile.upiVpa` (db pushed).
  - **Invoice detail gains a "Scan to pay" card** (right column, when a VPA is set and balance > 0): locally-generated QR (`upi://pay?pa=…&pn=…&am=…&cu=INR&tn=Invoice <number>` — amount pre-filled), the balance, and a copy-UPI-ID chip. Drafts, cancelled and fully-paid invoices correctly show nothing.
  - **Invoice PDFs embed the same QR** bottom-right beside the bank details (framed, captioned "Scan to pay via UPI" + VPA), via the new `withUpiQr()` model hydrator — wired into the detail PDF, the PDF preview dialog, and batch PDF export. Generation is pure client-side (`qrcode` package, canvas data URL) — no network, works fully offline; any UPI app (GPay/PhonePe/Paytm/BHIM) can scan it.
  - **My Company**: UPI ID (VPA) input with live QR preview (debounced), format guidance, and contextual hints; the sample workspace ships with `acmetraders@hdfcbank`.

### Fixed

- **Mobile horizontal overflow (pre-existing, now eliminated)**: `body.scrollWidth` was 588px at 390px viewport on invoice detail. Two causes: (a) the line-items table's min-content width blew out the CSS grid (`min-width:auto` chain) — the table now scrolls inside its own `overflow-x-auto` container (`min-w-[560px]`) with `min-w-0` on the grid columns/cards; (b) the header's sync pill ("Guest workspace — local only", 216px) pushed the right cluster past the viewport — it now shows the short "Guest" label on phones (`sm:` breakpoint switch). Verified `scrollWidth 390 == viewport 390` on every view.

### Improved (styling)

- QR presentation: white rounded tile with soft shadow on the detail card; bordered frame + caption in the PDF; dashed placeholder with a QR icon while no VPA is configured.
- Detail header/cards participate in the min-w-0 chain so long customer names wrap instead of stretching.

### Verified (QA round 10)

- VPA typed in My Company → live QR preview appears within the debounce; saved ("Company profile saved"); survives navigation.
- INV/2026-27/0006 (finalized, ₹14,160.00 due) → Scan-to-pay card with QR + copy chip; Export PDF → preview shows the QR framed bottom-right with VPA caption; draft invoice shows no card.
- Negative cases: invalid VPA ("not a vpa!") → guidance text + preview hidden; draft → no QR; batch export path uses the same hydrator.
- Mobile 390: scrollWidth == viewport on detail + products + settings; header fits with the short Guest label; table scrolls horizontally inside its frame. Desktop 1440 light + dark screenshots clean. One dev-server OOM recurred mid-round (RSS 1.85GB) — restarted with the standard recipe, no data loss (offline-first resume held).
- `bun run lint` exit 0; `tsc --noEmit` 0 errors in `src/`; version strings unified at v0.11.0.

## [0.10.0] - 2025-09-21

### Fixed

- **Dexie schema defect — phantom `[quotation_id]`/`[invoice_id]` indexes** (found while verifying bulk convert): the v1 stores string declared single-key compound indexes (`[quotation_id]`, `[invoice_id]`). Dexie's parser collapsed the simple index and the phantom into one entry keyed by name `[quotation_id]`, so `where('quotation_id')` resolved to an index whose keys are array-wrapped → **0 rows for every lookup** (`convertQuotationToInvoice` failed with "Quotation has no line items"; any other `quotation_id`/`invoice_id` query on affected installs would silently return nothing). New schema v2 drops the phantom tokens; a fresh install was re-seeded end-to-end and convert now finds its line items. Existing installs receive the v2 upgrade automatically (native version 10 → 20).

### Added

- **Bulk convert accepted quotations → invoices** (quotations bulk bar): new emerald-outline **Convert N accepted** action drafts one invoice per ACCEPTED quotation in the selection (reuses `convertQuotationToInvoice` — real totals, per-row transactions), toasts the created draft numbers (first 3 + "+N more"), surfaces per-item failure toasts, and clears the selection. Bulk bar hint now reads "N accepted, ready to convert"; quotations footer tip teaches the full set. The bulk story is now complete: Mark drafts sent · Convert accepted · Delete drafts · PDFs · CSV · Clear.
- **Local data health card** (Settings → Data): a live, offline-only diagnostics panel — browser **storage estimate** (usage of quota with an emerald progress bar, e.g. "336.0 KB of 10.00 GB"), **outbox health** (pending in amber when > 0, failed in red, contextual hint), **last backup** (amber "Never" warning until first export), and six **live record-count tiles** (invoices, quotations, customers, products, payments, sync ops) via Dexie observers. Refresh re-reads the storage estimate (browsers throttle it).
- **Command palette recency**: Recent Invoices / Recent Quotations now sort by `created_at` descending (previously DB insertion order), so the palette opens with the document you just made; customers and products sort alphabetically.

### Improved (styling)

- Health card: emerald hairline gradient, activity icon chip, three bordered metric panels and muted count tiles that tint on hover — consistent with the install card's design language.
- Convert action styled as an emerald-outline chip in the bulk bar (distinct from destructive red and neutral actions).

### Verified (QA round 9)

- Bulk convert exercised end-to-end on a fresh install: detail-view Accept → list bulk "Convert 1 accepted" → toast "1 invoice drafted from quotations · DRAFT-F6ZZF68D — review and finalize when ready", row flipped to CONVERTED, and DRAFT-F6ZZF68D (Priya Design Studio, dated today) appeared atop the invoices list.
- Health card cross-checked: storage 336 KB/10 GB, outbox 34 pending/0 failed (guest mode — correct), counts 9 invoices · 3 quotations · 5 customers · 6 products · 4 payments · 34 sync ops (9 = 8 seeded + 1 converted draft).
- Palette: Ctrl+K lists the convert-created draft first under Recent Invoices.
- Desktop 1440 + mobile 390, light + dark screenshots; `bun run lint` exit 0; `tsc --noEmit` 0 errors in `src/`; console clean after instrumentation removed.

## [0.9.0] - 2025-09-21

### Fixed

- **PWA installability defect**: the web manifest referenced `icon-192.png` / `icon-512.png` that did not exist in `public/` — Chrome can never offer installation without a 192px+ PNG icon. Both icons (plus `apple-touch-icon.png`, 180px) are now generated from the existing brand SVG via sharp, and the layout metadata declares all icon sizes + `appleWebApp` capability. Verified all four assets serve HTTP 200.

### Added

- **Install InvoiceFlow card** (Settings → Preferences): a new full-width card captures the browser's deferred `beforeinstallprompt` event (new module `src/lib/pwa-install.ts` — external store via `useSyncExternalStore`, no context provider) and adapts to four states: already running standalone → green "Running as an installed app" panel; installable → one-tap **Install InvoiceFlow** button that drives the native prompt and toasts on acceptance; iOS Safari → numbered Add-to-Home-Screen steps; other browsers → address-bar/⋮-menu hint. Standalone detection covers `display-mode: standalone`/`minimal-ui` and iOS `navigator.standalone`, and re-renders automatically on `appinstalled`.
- **Quotation batch PDF export**: the quotation bulk bar gains the same **PDFs** action as invoices — one offline PDF per selected quotation (`buildQuotationModel` → renderer, 350 ms download stagger), per-item failure toasts plus the success summary. Bulk bar actions now match invoices exactly: Mark drafts sent · Delete drafts · PDFs · CSV · Clear.
- **Products sales insights**: catalog cards show per-product usage — invoice lines, **units sold** (`qty_milli` aggregated, formatted via `formatQty`), and revenue with a gradient **revenue-share mini-bar** relative to the top product (`role="img"` aria label with the %). New sort segmented control: **A–Z / Most used / Top revenue** (`aria-pressed`, emerald active state).
- **Usage attribution fixed along the way**: usage now resolves through `prod.description || prod.name` first (exactly what the editor's catalog pick and the seeder write into line items), falling back to the bare product name — previously the sample workspace showed zero usage everywhere because seeded descriptions are marketing copy, not product names.

### Improved (styling)

- Install card: emerald hairline gradient across the top edge, smartphone icon chip, and a settle-in fade for the action panel (`install-chip-in`, reduced-motion safe).
- Revenue-share bars grow in from the left (`usage-bar-in` keyframe, reduced-motion safe) with a consistent emerald gradient.
- Sort chips are 44px tall on touch devices (`h-11`, 36px from `sm:` up) and hide their text labels on narrow screens (icon-only, tooltip-preserving `title`).

### Verified (QA round 8)

- Simulated `beforeinstallprompt` (synthetic event with `prompt`/`userChoice` stubs): card flips to the install button; clicking calls `prompt()` and shows the "InvoiceFlow installed" toast; fallback desktop instructions verified headless; all icon/manifest assets return 200.
- Products: 6 usage bars render; sort exercised — A–Z first = AMC, Most used = LED Panel Light 18W, Top revenue = Ceiling Fan 1200mm; bar widths cross-checked against revenue/max (86%, 48%, 27%, 14%, 6%); usage lines read e.g. "2 lines · 35 PCS sold ₹47,376.00".
- Quotations: 2 rows selected → bulk bar shows all five actions → "2 PDFs exported" toast, console clean.
- Desktop 1440 + mobile 390 px, light + dark; `bun run lint` exit 0; `tsc --noEmit` 0 errors in `src/`; version strings unified at v0.9.0 (sidebar, status bar, Settings).

## [0.8.0] - 2025-09-21

### Added

- **Payments view filters**: a method dropdown (All / Cash / Bank transfer / UPI / Cheque / Card / Other, each with a live count) and a period dropdown (All time / This month / Last 30 days / This fiscal year — FY computed locally on the Apr–Mar Indian convention, string math only, no UTC). The collected summary card switches to **"Filtered collected"** with an emerald accent and shows `filtered of total`, plus an inline *clear* button.
- **Payment method-mix bar**: a compact stacked bar above the table showing how the filtered collections split across methods (segments in the same palette as the method chips), with a legend listing method → amount → share %. Recomputes live with the filters.
- **Batch PDF export**: the invoice bulk bar gains a **PDFs** action — renders one PDF per selected invoice locally (offline, jsPDF) and queues the downloads with a 350 ms stagger so browsers don't drop them; per-invoice failure toasts plus a success summary ("allow multiple downloads if your browser asks").

### Changed

- **Canonical overdue rule extracted**: new `src/lib/invoice-status.ts` (`isInvoiceOverdue`, `daysOverdue`) is now the single source of truth used by the invoices list filter + row badges, the dashboard KPI/banner/activity rows, and the reminder wording module (which re-exports it). Removes three hand-rolled copies of the rule that could drift.

### Improved (styling)

- Payments: rows gained the same hover-revealed emerald chevron as invoices/quotations; active method/period filters tint their dropdown triggers emerald (matching the filtered-total card); filtered state shows a "Clear filters" empty-state action.
- Method-mix segments grow in from the left with a staggered spring (`mix-seg-in`, reduced-motion safe).
- Product cards lift 2px on hover with a soft shadow and an emerald border tint (`product-card`).
- Invoices footer tip now teaches the full bulk set: finalize, PDFs, CSV.

### Verified (QA round 7)

- Fresh profile → seeded sample data (4 payments, ₹1,36,541.50). Payments filters exercised via Radix pointer events: UPI → 1 payment, card flips to "Filtered collected ₹6,174.00 of ₹1,36,541.50" with clear chip, mix recalculates to 100% UPI; Last 30 days → all 4 payments (₹1,36,541.50 of ₹1,36,541.50); combined search "Sharma" + Last 30 days → 2 payments ₹44,932.00, mix 86% bank / 14% UPI (cross-checked).
- Batch PDFs: 2 drafts selected (₹91,647.00) → success toast "2 PDFs exported", downloads queued, console clean.
- Canonical overdue rule: dashboard Overdue KPI (3) == banner ₹39,649.50 == invoices "Overdue (3)" filter via the Review-overdue CTA (one-shot preset still consumed exactly once after the refactor).
- `bun run lint` exit 0; `tsc --noEmit` 0 errors in `src/`; desktop 1440 + mobile 390 px, light + dark verified; product-card hover class present on all 6 cards; console clean.

## [0.7.0] - 2025-09-21

### Added

- **Dashboard overdue attention banner**: when issued invoices sit past their due date, a red/amber gradient banner appears under the KPI grid — "N invoices are overdue · ₹X outstanding past the due date — reminders are one click away." — with a "Review overdue" CTA and a dismiss button. The outstanding amount is computed live (overdue count × balance).
- **One-shot cross-view filter presets**: new `viewParams` in the Zustand store (with `setViewParams`/`consumeViewParam`). The banner CTA — and the dashboard "Overdue" KPI card — now land on the invoices list **pre-filtered to Overdue**, a new pseudo-status in the filter dropdown (with live count) matching the same overdue rule as the badges. The preset is consumed on arrival, so plain navigation afterwards shows all statuses again.
- **Quick payment-term chips in the document editor**: under the Due date / Valid until input, one-tap `+15d / +30d / +45d` chips compute from the document date (shared `addDaysStr`), highlight in emerald while active (`aria-pressed`), and a `clear` chip appears whenever a date is set. Works for both invoices and quotations.

### Fixed

- **Overdue-CTA preset lost on arrival**: the invoices view mounts twice per navigation (pre-existing AppShell re-key behaviour), so clearing the one-shot filter preset in a mount effect meant the second mount read an empty store and reset the filter. The clear is now deferred to a `setTimeout(0)` after the view settles — both mounts see the preset, and it is consumed exactly once afterwards (verified by navigating away and back).

### Improved (styling)

- Banner uses a red→amber→transparent gradient with a red icon chip and a red-outline CTA that tints on hover — attention-grabbing without leaving the emerald/red/amber palette.
- Term chips: idle = hairline border with emerald hover tint; active = solid emerald tint + border; clear = red-on-hover ghost chip.
- Overdue filter option shows its live count in the dropdown, consistent with the other statuses.

### Verified (QA round 6)

- Fresh-profile seed → dashboard shows the banner with the exact outstanding amount (₹4,116 + ₹12,600 + ₹22,933.50 = ₹39,649.50 across 3 invoices, cross-checked row by row).
- CTA end-to-end: "Review overdue" → invoices list opens with "Overdue (3)" selected, exactly the 3 overdue invoices rendered with OVERDUE badges; navigating away and back returns to "All statuses" (one-shot semantics); the banner's dismiss (X) hides it for the session.
- Editor chips: doc date 2026-09-21 → +15d = 2026-10-06, +30d = 2026-10-21, +45d available; only the active chip highlights; clear empties the date (all state changes verified after React flush).
- `bun run lint` exit 0, `tsc --noEmit` 0 errors in `src/`; desktop + mobile 390 px screenshots verified (banner wraps below KPI grid on mobile).

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
