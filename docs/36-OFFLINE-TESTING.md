# 36 — Offline & Resilience Testing

> Derived from `docs/_CANON.md` (§9, §11, §12, §15, §17, §19). Companion to docs/35-TESTING.md (tooling, pyramid, configs). If this doc deviates from CANON, CANON wins.
> **No test files are bundled in the sandbox (CANON §19.5)** — this document is the executable blueprint applied when the monorepo is scaffolded.

## 1. Purpose

Specify exactly **how** InvoiceFlow's offline-first guarantees are proven: network interception with Playwright, service-worker update behavior, IndexedDB persistence across reloads, the outbox→online drain scenario, conflict simulation between two devices, clock-dependent logic (overdue, fiscal-year boundary, quotation expiry), and offline desktop launch. Every scenario ends with concrete assertions so it can be transcribed into Playwright specs verbatim.

## 2. Scope

| In scope | Out of scope |
|---|---|
| Playwright network emulation (`context.setOffline`), route blocking, heartbeats | Real-world flaky-network field testing (manual) |
| Service worker update/activation tests (production builds only) | SW behavior in dev (registration disabled by design, CANON §17) |
| IndexedDB persistence assertions across reloads and cold starts | Browser storage-quota stress tests (documented limitation instead) |
| Outbox→online drain walkthrough with step-by-step assertions | Gateway/webhook testing (extension points, CANON §19.3) |
| Two-context conflict simulation recipe | Supabase PITR drills (ops concern → docs/37, docs/39) |
| Clock-based tests (overdue, FY boundary Mar 31/Apr 1, expiry) | Timezone/locale matrix testing (single locale en-IN, CANON §19.1) |
| Electron offline launch (`_electron`) | Electron packaging/signing (docs/37-DEPLOYMENT.md) |

## 3. Business requirements

- **BR-1** Every business operation works locally first with zero network (CANON golden rule); tests must prove full CRUD + PDF + finalize offline.
- **BR-2** Data must survive reload and browser restart (IndexedDB is the store of record, CANON §17).
- **BR-3** Queued operations must drain automatically, exactly once per op (idempotent server, CANON §9), when connectivity returns — without user intervention beyond having the app open.
- **BR-4** Two devices editing the same record must converge through the documented conflict framework (CANON §10) with user resolution, never silent financial merges.
- **BR-5** Date-sensitive behavior must be deterministic and testable: overdue invoices, `fiscalYearOf` boundary (2025-03-31 → `2024-25`; 2025-04-01 → `2025-26`), quotation `EXPIRED` lazy status (CANON §6, §12).
- **BR-6** The Electron desktop app must launch and be fully usable with no network (CANON §17).
- **BR-7** Every scenario in §7 checklist must be automated except where marked manual.

## 4. Technical design

### 4.1 Playwright network interception

```ts
// e2e/helpers/offline.ts
export async function goOffline(context: BrowserContext) {
  await context.setOffline(true);            // navigator.onLine === false in pages
}
export async function goOnline(context: BrowserContext) {
  await context.setOffline(false);           // fires synthetic 'online' → sync trigger (CANON §9)
}
// Hard block for "server unreachable but browser online" (heartbeat failure path):
export async function blockServer(context: BrowserContext, baseURL: string) {
  await context.route('**/api/**', route => route.abort('internetdisconnected'));
}
```

Semantics to rely on:
- `context.setOffline(true)` makes `navigator.onLine` return `false` → the app's offline badge shows via the `online`/`offline` events; the sync engine skips runs (CANON §9 guard).
- `/api/health` heartbeat failures must keep the badge **Offline** even if some requests were intercepted — test with `blockServer` while `navigator.onLine` is `true` (browser thinks it's online, server isn't).
- Offline detection is belt-and-braces: `navigator.onLine` events **and** the `/api/health` heartbeat (CANON §17) — both paths are tested.

### 4.2 Service worker update testing

SW registers **only in production builds** (CANON §17) → these specs run against `pnpm build && pnpm start` (`E2E_SW=1` project, docs/35 §4.10).

```ts
test('SW update: new cache version activates and cleans old caches', async ({ page }) => {
  await page.goto('/');
  const v1 = await getActiveCacheName(page);          // 'invoiceflow-v1'
  await page.evaluate(() => navigator.serviceWorker.getRegistrations()); // baseline
  await simulateNewDeploy(page);                      // test hook: injects sw.js with `invoiceflow-v2`
  await page.reload();
  await page.waitForFunction(() =>
    navigator.serviceWorker.controller?.scriptURL.includes('sw.js'), { timeout: 15_000 });
  await expectActiveCache(page, 'invoiceflow-v2');    // activate cleans old caches (CANON §17)
  expect(await cacheExists(page, v1)).toBe(false);
  await expect(page.getByText('Update available')).toBeVisible(); // update toast if shipped
});
```

Assertions: cache-first serves `/_next/static` from cache (assert via `performance.getEntriesByType('resource')` transferSize 0), network-first for `/` navigation with offline fallback page, activation deletes `invoiceflow-v1`.

### 4.3 IndexedDB persistence assertions across reloads

```ts
test('data survives reload and cold restart', async ({ page, context }) => {
  await seedWorkspace(page);
  await createCustomer(page, { name: 'Persistent Traders' });
  await page.reload();
  await expect(page.getByText('Persistent Traders')).toBeVisible();         // same context reload
  await page.close();
  const page2 = await context.newPage();                                     // same storage partition
  await page2.goto('/');
  await expect(page2.getByText('Persistent Traders')).toBeVisible();         // cold re-open
});
```

For true disk persistence (survives browser process exit) use `launchPersistentContext(userDataDir)` and assert after `context.close()` + relaunch. Also assert the eviction disclaimer: guest users see the durability advice (install as PWA / use desktop — CANON §19.8) on Settings → Data.

### 4.4 Outbox → online drain scenario (step-by-step walkthrough)

Single canonical spec: `e2e/offline-drain.spec.ts`. State machine: synced → offline edits (queued) → reload (persisted) → online (drained) → verified in second context.

| Step | Action | Assertion |
|---|---|---|
| 1 | Fresh context → onboarding → create company → register + claim workspace (CANON §11) → wait for sync | Sync pill = **Synced**; `sync_metadata.pull_cursor > 0` (via Settings → Sync status) |
| 2 | `await context.setOffline(true)` | Offline badge visible; pill = **Offline**; heartbeat to `/api/health` failing silently |
| 3 | Create customer "Drain Traders" | Customer list shows it; pill = **Pending 1** (upsert op in outbox) |
| 4 | Create invoice (2 items: `2.5 × ₹400.00`, `3 × ₹333.33` @ 18 %, discount 5 % on item 2) → Save draft | Draft visible; pill = **Pending 2**; totals panel shows grand total **₹2,360.00** (raw 235999 paise + 1 round-off — the exact docs/35 §4.3 math) |
| 5 | Save & finalize | Final number allocated **locally** `INV/<FY>/0001` (offline allocation, CANON §6); pill = **Pending 3** (draft upsert + finalize ops) |
| 6 | Export PDF offline | Download `INV-<FY>-0001.pdf` (filename rule CANON §13) — proves full offline PDF path |
| 7 | `page.reload()` **while still offline** | Customer, draft→final invoice, number, totals all present (IndexedDB store of record) |
| 8 | Settings → Sync → Outbox | 3 ops `pending`, ordered by `created_at`, attempts 0 |
| 9 | `await context.setOffline(false)` | Engine triggered by `online` event (≤ 30 s worst case, CANON §9); pill transitions Offline → **Syncing** → **Synced** |
| 10 | Outbox after drain | 3 ops `done`; prune age check N/A (fresh); entities `sync_state='synced'` |
| 11 | Number adoption check | Invoice still `INV/<FY>/0001` — server was behind, **adopts client number** (CANON §6); if server had issued it, UI must show reassigned number + notice (covered separately in docs/35 §4.4b) |
| 12 | Second browser context, same account → login → pull | Same customer + invoice with same number/totals (server record is source of truth) |
| 13 | Logout→login while offline (negative) | Sync paused, `needs_reauth` flag, local data intact (CANON §9) |

### 4.5 Conflict simulation recipe (two browser contexts, same workspace)

Principle: two contexts = two devices. Both must reach **synced** state first so both hold identical server versions; then diverge offline; then race their pushes.

```ts
test('concurrent edits converge via conflict UI', async ({ browser }) => {
  const ctxA = await browser.newContext(); const ctxB = await browser.newContext();
  const a = await ctxA.newPage(); const b = await ctxB.newPage();

  // 1. Same account on both "devices"; B pulls the full dataset (fresh pull_cursor=0)
  await signIn(a, USER); await firstSync(a);            // Synced
  await signIn(b, USER); await firstSync(b);            // Synced — B now holds server copies
  const customerId = await createCustomer(a, { name: 'Conflict Traders', phone: '111', email: 'a@x.test' });
  await pullOn(b, customerId);                          // wait until visible on B

  // 2. Both go offline and edit the SAME customer
  await ctxA.setOffline(true); await ctxB.setOffline(true);
  await editCustomer(a, customerId, { phone: '222' });   // base_version = N
  await editCustomer(b, customerId, { email: 'b@x.test' }); // base_version = N

  // 3. Race: A comes online first → applied; B second → conflict (CAS, CANON §9)
  await ctxA.setOffline(false); await expectSyncedWithin(a, 30_000);
  await ctxB.setOffline(false);
  await expect(b.getByText('Pending 1')).toBeVisible({ timeout: 5_000 });
  await expectSyncedWithin(b, 30_000);                   // push returns conflict → op.status='conflict'

  // 4. Resolve in Settings → Sync → Conflicts (CANON §10)
  await openConflicts(b);
  await expect(b.getByText('Conflict Traders')).toBeVisible();          // side-by-side diff shown
  await b.getByRole('button', { name: "Keep server's" }).click();       // adopt server record
  await expect(page2Field(b, 'phone', customerId)).toHaveText('222');   // server wins locally
  await expectField(b, 'email', customerId).toHaveText('b@x.test');     // B's local edit discarded by choice
  await expect(b.getByText('No conflicts')).toBeVisible();              // audit_logs row written server-side
});
```

Variants (same recipe, different edits):
- **Delete vs edit** (class 3, CANON §10): A deletes product, B edits price → B's push conflicts → resolution offers *restore vs keep deleted*.
- **Two devices finalize the same draft** (class 4): first `applied`, second `conflict` → adopt server record (immutable document).
- **Same invoice number claimed offline** (class 5): deterministic server authority — loser gets `number_reassigned`, UI shows notice, no user action (CANON §6).
- **Overlapping vs disjoint field merge** (class 1): disjoint fields (phone on A, address on B) auto-merge without conflict UI when the 3-way merge finds no overlap; overlapping fields always escalate to the user — **never silently merge financial changes** (CANON §10).

### 4.6 Clock-based tests

The app reads "today" exclusively from the domain `today()`/`now()` helpers → Playwright ≥ 1.45 `page.clock` API freezes time deterministically; unit level uses `vi.setSystemTime`.

```ts
test('overdue invoice is derived at read time', async ({ page }) => {
  await seedWorkspace(page);
  const id = await createFinalInvoice(page, { date: '2025-03-01', due: '2025-03-20', amount: 118000 });
  await page.clock.setFixedTime(new Date('2025-03-19T12:00:00+05:30'));
  await openInvoice(page, id);
  await expect(page.getByText('Unpaid')).toBeVisible();          // amber (CANON §15)
  await page.clock.setFixedTime(new Date('2025-03-21T12:00:00+05:30'));
  await page.reload();                                            // derived state, not stored
  await expect(page.getByText('Overdue')).toBeVisible();          // red; dashboard KPI increments
});
```

Fiscal-year boundary (CANON §6 — FY is April–March):

| Test | Clock | Action | Assertion |
|---|---|---|---|
| FY cutoff −1 day | `2025-03-31T23:59:59+05:30` | finalize invoice | number `INV/2024-25/…` (`fiscalYearOf('2025-03-31') = '2024-25'`) |
| FY cutoff +1 day | `2025-04-01T00:00:01+05:30` | finalize invoice | number `INV/2025-26/0001` — **new sequence row**, starts at 1 (CANON §6/§7 `document_sequences`) |
| Quotation expiry | `2025-04-01` with `valid_until = '2025-03-31'`, status SENT | open quotation | lazy status shows **EXPIRED**; duplicate allowed (CANON §12) |
| Quotation not expired | `2025-03-31` same quotation | open quotation | still SENT |
| Paid-before-overdue | payment recorded at clock `2025-03-20` for invoice due `2025-03-20` | open invoice | PAID, never overdue (paid_total ≥ grand total, CANON §12) |

Overdue is a **derived read-time state** (stored statuses stay canonical per CANON §12) — tests assert the derived badge, not a mutated status column.

### 4.7 Electron offline launch test

```ts
// e2e/desktop.offline.electron.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';

test('desktop launches and works fully offline', async () => {
  const app = await electron.launch({ args: ['.'] });            // hardened main: sandbox, contextIsolation (CANON §16)
  const win = await app.firstWindow();
  await app.context().setOffline(true);                          // kill network for the whole app
  await expect(win.getByRole('heading', { name: 'Dashboard' })).toBeVisible(); // loads from local bundle
  await createAndFinalizeInvoice(win, { /* … */ });              // full CRUD offline
  const [download] = await Promise.all([
    win.waitForEvent('download'),
    win.getByRole('button', { name: 'Export PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^INV-.+\.pdf$/); // offline PDF (CANON §13)
  await expect(win.getByText(/^Pending \d+$/)).toBeVisible();    // outbox queued
  await app.context().setOffline(false);
  await expect(win.getByText('Synced', { exact: true })).toBeVisible({ timeout: 30_000 });
  await app.close();
});
```

Notes: production Electron loads the **local web bundle** (renderer reuses the web app verbatim, CANON §19.6); `ELECTRON_START_URL` overrides to a dev server only in development (docs/38-ENVIRONMENT.md). Offline launch with cold storage shows onboarding — same guest-first flow as web (CANON §11).

### 4.8 Trace & debugging conventions

- Every offline spec runs with `trace: 'retain-on-failure'` (docs/35 §4.10) and logs the sync pill transitions via console messages (`window.__syncDebug` test hook) so a failure shows exactly which phase (push/pull/backoff) stalled.
- Time-travel specs reset clock with `page.clock.pauseAt`/`restore` in `afterEach` to avoid cross-test contamination.

## 5. Data models / API contracts

- Outbox rows follow CANON §7 `sync_operations` (`op_id`, `action`, `base_version`, `payload_json`, `status`, `attempts`, `next_attempt_at`); the walkthrough asserts on the UI rendering of that table, never on internals.
- Push/pull wire shapes are CANON §9 exactly; `context.route` may inspect request bodies: assert push contains `"schema_version": 1` and ops ordered by `created_at`.
- Conflict op carries `server_record_json` — the conflicts UI test asserts the diff renders both sides.

## 6. Offline behavior

This entire document is the offline-behavior contract. Non-negotiables proven here: local-first CRUD (BR-1), persistence (BR-2), one-time drain (BR-3), user-resolved conflicts (BR-4), deterministic clocks (BR-5), offline desktop (BR-6). Browser limitations documented as such, not tested: storage eviction risk (CANON §19.8), SW absence → online-first degradation (CANON §17).

## 7. Online behavior

Drain, pull adoption, conflict convergence, and re-auth are the online halves of offline scenarios; they are asserted inside the same specs (steps 9–13 of §4.4, §4.5). Backoff behavior (`min(10 min, 2^attempts × 2 s)`, 8 attempts → failed, manual retry in UI) is covered at engine level in docs/35 §4.4(b) — E2E asserts only the visible retry affordance to keep runtime bounded.

## 8. Security considerations

- Offline tests run against local dev-cloud fixtures; no production credentials, no real workspaces, no service keys (CANON §16).
- Negative security assertions included offline: finalized document edits rejected locally *and* server-side; Electron E2E fails on CSP violations or any `nodeIntegration` leakage; external links route through the allow-listed `shell.openExternal` (CANON §16).
- Two-context tests must not share storage partitions — each `newContext()` is isolated by default; sharing is achieved only through the server (never through storage copying), which is what makes the conflict recipe honest.

## 9. Error-handling rules

- Every scenario ends in an observable, user-visible state (badge, pill, toast, conflicts screen) — no assertion may depend on console logs alone.
- Failure-path expectations are explicit: heartbeat failure with `navigator.onLine = true` keeps the badge Offline; 401 pauses sync with `needs_reauth` and zero data loss; `rejected` ops stay visible with their error and are never auto-deleted (CANON §9).
- A scenario that cannot assert its setup (e.g., first sync didn't complete) must hard-fail the test — never skip silently.

## 10. Acceptance criteria

1. All §7 checklist rows marked "Automated" exist as passing Playwright specs on chromium + webkit + firefox (and the Electron row via `_electron`).
2. The §4.4 walkthrough asserts every listed step including the number-adoption rule (CANON §6) and second-context verification.
3. The §4.5 recipe reproduces CANON §10 conflict classes 1, 3, 4, 5 and resolves through the documented UI with an audit trail.
4. Clock specs prove the Mar 31/Apr 1 FY boundary, overdue derivation, and lazy EXPIRED without flakiness (deterministic `page.clock`).
5. SW update spec proves cache-version rotation `invoiceflow-v1 → v2` with old-cache cleanup (CANON §17).
6. Full offline E2E suite completes in < 10 minutes in CI.

## 11. Scenario checklist (scenario × steps × expected)

| # | Scenario | Steps (condensed) | Expected |
|---|---|---|---|
| 1 | Cold offline first launch | Fresh profile → `setOffline(true)` → open app | Onboarding renders from local bundle; guest workspace creatable; no crash, no blank screen |
| 2 | Offline full CRUD | Offline → create customer/product/invoice/quotation/payment | All persist locally; sync pill counts pending ops |
| 3 | Offline finalize + PDF | Offline → finalize invoice → export PDF | Local number allocated; `INV-2025-26-0001.pdf` downloads (filename rule CANON §13: `/` → `-`) |
| 4 | Persistence across reload | Reload while offline | All offline-created data present (§4.3) |
| 5 | Persistence across restart | `launchPersistentContext` → close → relaunch offline | Data intact from disk |
| 6 | Outbox drain | §4.4 steps 1–10 | Ops `pending → in_flight → done`; pill → Synced; no duplicates after replay |
| 7 | Server-down heartbeat | `blockServer` with browser online | Badge stays Offline; no sync attempts loop |
| 8 | Two-device conflict | §4.5 recipe | CAS conflict → conflict UI → resolution + audit |
| 9 | Number reassignment | Pre-issue number server-side; push offline-finalized doc with same number | `number_reassigned` adopted; notice shown; immutable doc updated (CANON §6) |
| 10 | SW update | §4.2 | New cache activates, old cache deleted, update notice |
| 11 | Overdue derivation | §4.6 clock | Red Overdue after due date; dashboard KPI counts it |
| 12 | FY boundary numbering | §4.6 clock Mar 31 → Apr 1 | Sequence rollover to new fiscal year, restarts at 0001 |
| 13 | Quotation expiry | Clock past `valid_until` | Lazy EXPIRED badge; duplicate allowed; CONVERTED never auto-expires |
| 14 | Auth expiry offline cycle | 401 during offline drain attempt | Sync paused, `needs_reauth`, prompt re-login, data preserved |
| 15 | Electron offline launch | §4.7 | App usable, PDF exports, outbox drains on reconnect |
| 16 | Storage eviction advisory | Guest workspace → Settings → Data | Durability advice visible (PWA install / desktop / JSON backup — CANON §19.8) — **manual review** allowed |

## 12. References

CANON §6 (numbering/FY), §9 (sync protocol & engine), §10 (conflicts), §11 (auth/guest), §12 (lifecycles), §15 (UI states), §16 (security), §17 (offline/PWA), §19 (assumptions); docs/35-TESTING.md; docs/18-CONFLICT-RESOLUTION.md; docs/16-INDEXEDDB-DATABASE.md; docs/38-ENVIRONMENT.md (`ELECTRON_START_URL`, flags).
