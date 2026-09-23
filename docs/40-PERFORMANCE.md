# 40 — Performance

> Derived from `docs/_CANON.md` (§4, §7, §9, §13, §15, §16, §17). If this doc deviates from CANON, CANON wins.

## 1. Purpose

Set measurable performance budgets for InvoiceFlow and prescribe the techniques that guarantee them: Dexie index usage, `useLiveQuery` granularity, list virtualization, client-side pagination, memoized aggregations, lazy-loaded PDF and chart bundles, image limits, service-worker cache strategy, batched IndexedDB writes in the sync engine, and the web-vitals monitoring plan.

## 2. Scope

| In scope | Out of scope |
|---|---|
| Runtime budgets (TTI, list interaction, PDF generation) and their enforcement | Server capacity planning / horizontal scaling (managed platforms) |
| Client data-layer performance (Dexie indexes, live queries, batching) | Supabase query tuning beyond index/policy sanity (platform-managed) |
| Bundle-size discipline (dynamic imports, chunking) | Image CDN/optimization pipeline (local assets + dataURLs only in MVP) |
| Service worker caching behavior (production) | Load testing infrastructure (docs/35 §2) |
| Monitoring (web vitals) and acceptance gates | Battery/thermal profiling (out of v1 scope) |

## 3. Business requirements

- **BR-1 Time to interactive < 2 s** on a mid-range device over 4G for the production PWA (dashboard route), measured at p75.
- **BR-2 List interaction < 100 ms**: tap-to-paint for any list action (sort, filter, paginate, open row) on 10k-record workspaces.
- **BR-3 PDF generation < 1 s** for a 50-line invoice (jsPDF + jspdf-autotable, offline, CANON §13).
- **BR-4** The domain engine (`computeDocumentTotals`) computes a 100-line document in < 5 ms — totals panels recompute live while typing with no perceptible lag (CANON §4).
- **BR-5** A sync pull of 500 changes applies in a single transaction in < 3 s without blocking UI reads (CANON §9 pull limit 500).
- **BR-6** The initial JS payload of any route stays ≤ 300 KB gzipped; heavy libraries (jsPDF, recharts) load on demand only.
- **BR-7** Memory stays bounded on long sessions: no unbounded caches of documents/items; outbox pruning keeps `sync_operations` lean (done ops pruned after 7 days, CANON §9).

## 4. Technical design

### 4.1 Budgets

| ID | Metric | Budget | Measurement |
|---|---|---|---|
| P-1 | TTI (dashboard, prod PWA, mid-tier Android, 4G) | < 2 s (p75) | Lighthouse CI + field web vitals (§4.10) |
| P-2 | List interaction latency (sort/filter/page/open) | < 100 ms (p95) | Playwright performance trace helper |
| P-3 | PDF generation, 50-item invoice | < 1 s (p95) | `performance.now()` around the render call, asserted in unit benchmark |
| P-4 | `computeDocumentTotals`, 100 items | < 5 ms | Vitest benchmark |
| P-5 | Sync pull application, 500 changes | < 3 s | Integration benchmark with fake-indexeddb |
| P-6 | Initial route JS (any route) | ≤ 300 KB gz | `next build` analyzer gate |
| P-7 | Offline PWA cold load (cached shell) | < 1.5 s | Lighthouse offline run |
| P-8 | Logo/signature processing | ≤ 1 MB input, downscale to ≤ 1024 px | Upload validation (CANON §16) |

### 4.2 Dexie indexes (use them or lose them)

Every query must hit an index from the CANON §7 v1 schema — table scans are a review rejection. The indexes (verbatim from CANON §7):

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

Rules derived from them:
- List screens filter by the compound indexes (`[workspace_id+deleted_at]`, `[workspace_id+status]`, `[workspace_id+paid_at]`) — e.g., the invoices list is `invoices.where('[workspace_id+deleted_at]').equals([ws, null])`, never `filter()` on a collection.
- Outbox claiming uses `[status+created_at]` to fetch the oldest 25 `pending` ops in one indexed range (CANON §9 push batch).
- New query patterns require a schema-version bump (`db.version(n+1).stores(...)`, never mutate v1 — CANON §7).

### 4.3 `useLiveQuery` granularity

- One live query per screen slice; the observer set is the query's keyset, so queries must be as **narrow** as the UI: the invoice list observes only the invoice range (paged), the detail screen observes the document + its items via `[invoice_id]`, the dashboard KPIs observe only the aggregates' source ranges.
- Never `db.table.toArray()` inside `useLiveQuery` — it re-renders on every write to that table and defeats index use; always `.where(...)` with the §4.2 indexes and `.limit(...)` for pages.
- Detail screens avoid N+1: items are fetched by the compound index in one query; customer names render from the document's `customer_name_snapshot` (CANON §7) instead of joining customers on every keystroke.
- Writes that trigger re-computation are batched (§4.8) so a single pull transaction causes one re-render wave, not 500.

### 4.4 Virtualization & pagination

- Tables are client-side paginated at **10/page** (CANON §15) with sort/search/filter applied before paging; pages render within the P-2 budget trivially.
- Any list that *cannot* paginate (outbox viewer, audit log explorer, reports over large ranges) virtualizes at a **threshold of 500+ rows** using fixed-height row windows (e.g., `@tanstack/react-virtual`, ~48 px rows) — DOM nodes stay ≤ ~40 regardless of result size.
- Sortable/searchable datasets > 5,000 rows must pre-filter by index and only then virtualize; `filter()` post-processing on full tables is prohibited (§4.2 rule).

### 4.5 Memoized aggregations

- Dashboard KPIs (8 stat cards, CANON §15) and report totals are computed in a **single pass** (`reduce`) over their indexed ranges inside `useMemo` keyed on the live-query result reference — recomputation happens only when the underlying rows change.
- Document totals on lists render from the stored snapshot columns (`grand_total_paise`, `paid_total_paise`, CANON §7) — the domain engine recomputes only in the editor (live typing) and on save; lists never re-derive totals from items.
- Memoization discipline: stable dependencies only; no `Date.now()`/`Math.random()` inside render paths (determinism also serves docs/35 tests).

### 4.6 Lazy-loaded heavy modules

```ts
// PDF: jsPDF + autotable load only when a preview/export/print is requested (CANON §13)
const { renderInvoicePdf } = await import('@/lib/pdf/render');
renderInvoicePdf(model, 'save');           // dynamic chunk, excluded from initial JS (P-6)

// Charts: recharts loads only on routes that render it (dashboard/reports)
const RevenueTrend = dynamic(() => import('@/components/dashboard/revenue-trend'), {
  ssr: false,                              // charts are client-only by nature
  loading: () => <ChartSkeleton />,
});
```

- The PDF chunk is warm after first use (browser HTTP cache + SW cache-first for `/_next/static`), so subsequent exports within a session cost no network.
- Route-level code splitting via the App Router keeps each route's initial JS within P-6; the bundle analyzer runs in CI and fails on budget breach.

### 4.7 Image size limits

- Logo/signature uploads accept **PNG/JPEG ≤ 1 MB** (client check + dataURL size check, CANON §16); the uploader downsizes serverlessly client-side (canvas) to max 1024 px before storing to keep both IndexedDB rows and PDF embedding fast (P-3, P-8).
- PDF embedding uses the stored dataURL directly; no per-render re-encoding.
- Icons are lucide SVGs (CANON §15) — no icon fonts, no raster icon sets.

### 4.8 Service worker cache strategy & batched IndexedDB writes

**SW (production only, CANON §17):**
- `invoiceflow-v1` cache; **cache-first** for static assets (`/_next/static/**`, fonts, icons) — immutable content, zero revalidation cost; **network-first** for `/` navigation with offline fallback page; activate deletes old caches (rotation on version bump).
- API calls (`/api/**`) are **never** cached — sync correctness relies on the outbox/pull model, not HTTP caching.

**IndexedDB write batching (sync engine, CANON §9):**
- Push claims the oldest 25 `pending` ops per run; pull applies up to 500 changes inside **one** Dexie transaction; within that transaction, record upserts execute in **`bulkPut` batches of 25** to bound transaction memory and avoid write-lock stalls on low-end devices (BR-5).
- Document changes replace embedded items atomically in the same transaction (delete-then-bulkPut of items keyed by `[invoice_id]`/`[quotation_id]`).
- Done ops are pruned older than 7 days, keeping the outbox table small (BR-7).

### 4.9 Rendering discipline

- Document editor uses controlled state with totals computed via `useMemo` (BR-4); item rows are memoized components keyed by `id + updated fields` so typing in one line does not re-render 50.
- Lists use `content-visibility: auto` where virtualization is overkill; skeletons (CANON §15) prevent layout shift (CLS component of P-1).
- Fonts: Geist self-hosted with `font-display: swap`; no render-blocking third-party fonts.

### 4.10 Monitoring plan (web vitals)

- **Field**: Vercel Speed Insights (web-vitals) collects LCP, INP, CLS, TTFB, FCP at p75 per route and device class; alerts when p75 LCP > 2.5 s or INP > 200 ms sustained over 24 h.
- **CI**: Lighthouse CI on the production build per PR — asserts P-1 (< 2 s TTI equivalent via TTI/LCP proxies on emulated 4G), P-6 bundle budget, and P-7 offline cold load; budgets live in `lighthouserc.json` and fail the PR.
- **Micro-benchmarks**: P-3/P-4/P-5 run as Vitest performance assertions with generous CI headroom (2× budget) to catch regressions without flaking.
- **Ops dashboard**: error rate + p95 TTFB via Vercel Analytics reviewed for 24 h after each release (docs/37 §4.9).

## 5. Data models / API contracts

- Performance work never changes CANON §9 contracts (batch sizes and limits are protocol constants: push batch 25, pull limit 500) — clients of different speeds interoperate purely by paging.
- The sync engine's batching (§4.8) is an implementation detail *below* the wire contract: a slow device simply runs more pull pages.

## 6. Offline behavior

- Offline PWA cold load must beat P-7: the SW serves the cached app shell cache-first, so TTI offline is network-independent (CANON §17).
- All data-layer budgets (P-2/P-4/P-5) are independent of connectivity — IndexedDB is the store of record (CANON §17).
- Lazy PDF (§4.6) still works fully offline: the dynamic chunk is served from the SW cache after first load, and from the local bundle on desktop.

## 7. Online behavior

- Sync efficiency is bounded by protocol constants: ≤ 25 ops per push, ≤ 500 changes per pull page, one transaction per pull application — worst-case sync load is linear and capped.
- Heartbeats to `/api/health` are cheap and infrequent (connectivity badge only, CANON §17); no polling of data endpoints exists — reactivity is local, freshness comes from explicit sync runs.

## 8. Security considerations

- Performance must not buy insecurity: no client-side caching of API responses (SW excludes `/api/**`, §4.8); CSP and auth checks are never relaxed for speed (CANON §16).
- Batched writes stay inside the same validation pipeline — `bulkPut` never bypasses Zod/domain validation (CANON §9 rule 2).
- Virtualized tables render only windowed rows, which also limits accidental PII exposure in the DOM.

## 9. Error-handling rules

- Budget breaches in CI fail the build (Lighthouse/bundle gates) — performance regressions are release blockers, not backlog notes.
- A slow device that cannot apply a pull page within the transaction timeout retries the page (cursor unchanged) — the pull cursor advances only on successful transaction commit (CANON §9), so failures never skip changes.
- `bulkPut` failure rolls back the whole pull transaction (atomicity, CANON §9); the engine reschedules with backoff rather than partial-applying.
- Monitoring degradation (vitals collection failing) never affects the user path — collection is fire-and-forget and fail-open.

## 10. Acceptance criteria

1. Lighthouse CI green on P-1/P-6/P-7 budgets for every PR; field p75 vitals within budget over rolling 7 days in production.
2. A 10k-record seeded workspace passes the P-2 interaction benchmark on all list screens (playwright trace assertion < 100 ms p95).
3. The P-3 PDF benchmark (50 items) and P-4 totals benchmark (100 items) pass in CI with 2× headroom.
4. Code review checklist enforces §4.2 (indexed queries only), §4.3 (no `toArray()` in live queries), §4.4 (virtualize ≥ 500 rows), §4.6 (lazy jsPDF/recharts) — enforced additionally by ESLint rules where mechanical (e.g., `no-restricted-syntax` on `toArray()` inside `useLiveQuery`).
5. Pull of 500 changes applies in one transaction with `bulkPut` batches of 25 (integration benchmark P-5).
6. Logo upload rejects > 1 MB / non-PNG-JPEG and downscales to ≤ 1024 px before storage (CANON §16, P-8).

## 11. References

CANON §4 (domain engine), §7 (Dexie schema v1 — index list), §9 (sync batching/pruning), §13 (PDF system), §15 (UI/pagination), §16 (upload limits/security), §17 (PWA/SW), §19.1 (INR/format); docs/16-INDEXEDDB-DATABASE.md; docs/35-TESTING.md; docs/36-OFFLINE-TESTING.md; docs/37-DEPLOYMENT.md; docs/39-BACKUP-RESTORE.md.
