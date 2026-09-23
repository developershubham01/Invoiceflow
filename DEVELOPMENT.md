# DEVELOPMENT.md

Developer guide for InvoiceFlow. Read [`docs/_CANON.md`](docs/_CANON.md) first — it is the single source of truth for architecture, data model, and the sync protocol. All code and docs must stay consistent with it.

---

## Prerequisites

- **Node.js 20+** or **Bun 1.x** (Bun is the runtime used in this repository)
- Basic familiarity with Next.js App Router, TypeScript, and Dexie/IndexedDB

## Setup

```bash
# 1. Install dependencies
bun install

# 2. Environment
cp .env.example .env        # then edit values — see docs/38-ENVIRONMENT.md
# At minimum, DATABASE_URL points at the dev-cloud SQLite file (e.g. file:./db/custom.db)

# 3. Dev-cloud database (Prisma/SQLite)
bun run db:push

# 4. Start the dev server
bun run dev                 # http://localhost:3000
```

The app boots in **guest mode** (no account required). Use **"Load sample data"** on the onboarding screen to seed a demo workspace, or create your company manually. Registering an account enables cloud sync and automatically claims the guest workspace.

## Useful scripts

| Script | Purpose |
|---|---|
| `bun run dev` | Start Next.js dev server on port 3000. |
| `bun run lint` | ESLint over the repository. |
| `bun run build` | Production build. |
| `bun run db:push` | Push `prisma/schema.prisma` to the dev-cloud SQLite database. |
| `bun run db:generate` | Regenerate the Prisma client. |
| `bun run db:migrate` / `db:reset` | Dev-cloud migration workflow. |

---

## Code style conventions

- **TypeScript strict mode.** No `any` — use precise types, generics, or `unknown` with narrowing. Let the compiler prove the domain rules.
- **Business logic lives in the domain layer** (`src/lib/domain/`). UI components and repositories must not embed money, GST, numbering, or lifecycle rules — they call the domain engine (`computeDocumentTotals`, state-machine helpers, validators).
- **Integer paise rule (CANON §4, non-negotiable).**
  - Monetary amounts are **integer minor units (paise)** — never floats.
  - Quantities are **integer milli-units** (`qty_milli`: `2500` = 2.5).
  - Rates and discounts are **basis points** (`1800` = 18%).
  - Rounding is **half-up on the paise** (`roundHalfUp(x) = Math.floor(x + 0.5)` for positive values).
- **Date strings rule.** Financial document dates (`invoice_date`, `due_date`, `quotation_date`, `valid_until`, `paid_at`) are **`YYYY-MM-DD` strings**, never JS `Date` objects. Timestamps (`created_at`, `updated_at`) are ISO-8601 strings. Currency is INR only in the MVP.
- **Zod on both ends.** Shared schemas live in `src/lib/domain/schemas.ts` and are reused by the client and the API routes. Validation errors must surface, never be swallowed.
- **Never trust client arithmetic.** The server recomputes every total and overwrites client numbers (CANON §4/§9).
- **UI conventions** (palette, states, routes) are defined in [docs/31-UI-UX.md](docs/31-UI-UX.md) and [docs/32-ROUTES.md](docs/32-ROUTES.md); the sandbox app navigates via hash routes (`#/invoices`, …) from a single `/` route.

---

## Adding a Dexie migration (CANON §7)

The local database (`src/lib/db/`) is versioned by Dexie:

1. **Never mutate schema v1 in place.** Append a new version instead:

   ```ts
   this.version(2).stores({
     // full store map: changed tables with new indexes, unchanged tables repeated
     products: 'id, workspace_id, sku, hsn_sac, active, sync_state, updated_at, deleted_at, [workspace_id+active], [workspace_id+deleted_at], new_index',
   }).upgrade((tx) => {
     // data transformation for existing rows (return the promise)
   });
   ```

2. Keep the **same primary key** and redeclare the complete index set for any table you touch.
3. Update the corresponding repository and the Zod schema if fields change.
4. Document the migration in [docs/16-INDEXEDDB-DATABASE.md](docs/16-INDEXEDDB-DATABASE.md) (what changed, why, upgrade steps).
5. Bump `schema_version` sent in sync push payloads if the change affects cloud records, and align the server model (see next section).

## Adding a sync entity (checklist)

A new synced entity must be wired through every layer, in order:

- [ ] **Dexie table** — add the store with indexes in `src/lib/db/` (bump the Dexie version) and include the common metadata fields: `id, workspace_id, created_at, updated_at, deleted_at, version, sync_state, origin_device_id`.
- [ ] **Zod schema** — define/extend the entity schema in `src/lib/domain/schemas.ts` (shared client/server).
- [ ] **Repository** — add CRUD + soft-delete + `sync_state` handling in `src/lib/db/` following the existing repository pattern.
- [ ] **Server model** — add the Prisma model in `prisma/schema.prisma`, run `bun run db:push`, and add the API-side validation/apply logic in `src/lib/server/`.
- [ ] **ChangeLog + outbox** — add the entity to the `sync_operations.entity` enum, make every server-side mutation append a `ChangeLog` row (pull feed), and keep push idempotency (`ProcessedOp`) and CAS on `base_version` intact.
- [ ] **Docs** — update the relevant module doc and [docs/06-DATABASE-DESIGN.md](docs/06-DATABASE-DESIGN.md); note deviations from [docs/_CANON.md](docs/_CANON.md) explicitly.

## Running the dev cloud

No separate backend process is needed. The dev cloud runs **inside the Next.js dev server** as API routes under `src/app/api/` (auth, workspace claim, sync push/pull, health). Start `bun run dev` and the endpoints are live at `http://localhost:3000/api/*`. Contracts: [API.md](API.md) and [docs/30-API-DESIGN.md](docs/30-API-DESIGN.md). Production persistence is Supabase Postgres with RLS — the sync endpoints are provider-agnostic ([docs/19-CLOUD-SYNC.md](docs/19-CLOUD-SYNC.md)).

## Electron dev workflow

The desktop shell lives in `electron/` (scaffold: main process, preload with typed `contextBridge` API, IPC handlers, services, and electron-builder configuration). The renderer reuses the web app verbatim; point `ELECTRON_START_URL` at your dev server (default `http://localhost:3000`) so the shell loads the running app.

> **Note:** Electron cannot execute in this sandbox — the scaffold is security-hardened code plus builder config. For commands, packaging, and IPC conventions see [`electron/README.md`](electron/README.md) and [docs/37-DEPLOYMENT.md](docs/37-DEPLOYMENT.md).

---

## Git conventions

- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:`, optionally scoped — e.g. `feat(sync): backoff cap after 8 attempts`, `fix(domain): round-off edge on tax-inclusive lines`, `docs(api): expand pull contract`.
- One logical change per commit; keep schema changes and their migrations in the same commit.
- Never commit secrets (`.env` stays out of version control; use `.env.example` for documentation).

## Pull request checklist

- [ ] Lint passes (`bun run lint`) and the TypeScript build is clean — strict mode, **no `any`**.
- [ ] All money math stays in **integer paise / milli-units / basis points** with half-up rounding, and lives in the domain layer.
- [ ] Financial dates are `YYYY-MM-DD` strings; timestamps are ISO-8601 strings.
- [ ] Server still recomputes totals and enforces workspace membership/role checks for every new operation.
- [ ] Dexie schema changes ship as a new version (v1 untouched) with an upgrade callback; Prisma changes are pushed and mirrored in `supabase/migrations/` when relevant.
- [ ] New sync paths are idempotent (ProcessedOp), CAS-guarded (`base_version`), and append `ChangeLog` rows.
- [ ] No secrets or service-role keys in client bundles; uploads stay within the PNG/JPEG ≤ 1 MB rule.
- [ ] Docs updated (module doc + `docs/06`/`docs/16` as applicable); deviations from `docs/_CANON.md` stated and justified.
- [ ] UI follows [docs/31-UI-UX.md](docs/31-UI-UX.md): offline/sync states covered, destructive actions confirmed, toasts on outcomes.
