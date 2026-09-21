# DATABASE.md

InvoiceFlow uses **three data stores**, each with a clear role. The local store is the source of truth on the device; the cloud stores are sync targets. Detailed field-level design lives in [docs/06-DATABASE-DESIGN.md](docs/06-DATABASE-DESIGN.md); the IndexedDB specifics in [docs/16-INDEXEDDB-DATABASE.md](docs/16-INDEXEDDB-DATABASE.md).

| Store | Technology | Role | Location |
|---|---|---|---|
| **Local** | IndexedDB via **Dexie** (`src/lib/db/`) | Source of truth per device; works fully offline | Browser/Electron origin storage |
| **Dev cloud** | **Prisma/SQLite** (`prisma/schema.prisma`) | Mirrors the Supabase model for local development; serves `/api/*` | SQLite file (e.g. `db/custom.db`, via `DATABASE_URL`) |
| **Production cloud** | **Supabase PostgreSQL** (`supabase/migrations/`) | Authoritative multi-device store with row-level security | Supabase project |

## 1. Local store — Dexie/IndexedDB

IndexedDB is the store of record: every business operation writes locally first, cloud sync is optional. All business entity IDs are UUIDv4, and every synced record carries the common metadata fields:

```
id, workspace_id, created_at (ISO), updated_at (ISO), deleted_at (ISO|null),
version (int, starts 1), sync_state (local|pending|synced|failed|conflict), origin_device_id
```

Deletion is soft (`deleted_at` set; records retained so historical invoices keep meaning; UI hides them by default). Financial document dates are `YYYY-MM-DD` strings; amounts are integer paise.

### Schema v1 — all 17 tables

| Table | Purpose | Key indexes (v1) |
|---|---|---|
| `workspaces` | Local workspaces (guest or cloud-linked) | `id, name, updated_at` |
| `workspace_members` | Membership & role per workspace/device/user | `id, workspace_id, user_id, role` |
| `company_profiles` | Seller profile, GSTIN, bank details, numbering/tax defaults | `id, workspace_id, updated_at` |
| `customers` | Customers (business/individual) with code, GSTIN, addresses | `id, workspace_id, code, gstin, phone, sync_state, updated_at, deleted_at, [workspace_id+deleted_at]` |
| `products` | Products/services: SKU, HSN/SAC, price, GST rate | `id, workspace_id, sku, hsn_sac, active, sync_state, updated_at, deleted_at, [workspace_id+active], [workspace_id+deleted_at]` |
| `quotations` | Quotation header incl. status, totals snapshot, place of supply | `id, workspace_id, number, status, quotation_date, customer_id, sync_state, updated_at, deleted_at, [workspace_id+status], [workspace_id+deleted_at]` |
| `quotation_items` | Line items (child of quotation, with computed totals snapshot) | `id, quotation_id, workspace_id, [quotation_id]` |
| `invoices` | Invoice header (mirrors quotation + due date, paid totals, source quotation) | `id, workspace_id, number, status, invoice_date, due_date, customer_id, sync_state, updated_at, deleted_at, [workspace_id+status], [workspace_id+deleted_at]` |
| `invoice_items` | Line items (child of invoice) | `id, invoice_id, workspace_id, [invoice_id]` |
| `payments` | Manual payments against invoices | `id, workspace_id, invoice_id, paid_at, sync_state, updated_at, deleted_at, [workspace_id+paid_at], [invoice_id]` |
| `tax_rates` | Versioned GST rates (`name, rate_bps, active, effective_from`) | `id, workspace_id, active, [workspace_id+active]` |
| `document_sequences` | Per `doc_type` + fiscal-year numbering state | `id, [workspace_id+doc_type+fiscal_year]` |
| `attachments` | Small inline blobs (logos, signatures) | `id, workspace_id, entity_type, entity_id, [entity_type+entity_id]` |
| `audit_logs` | Lifecycle/sync audit trail | `id, workspace_id, entity_type, entity_id, at, [workspace_id+at], [entity_type+entity_id]` |
| `sync_operations` | The **outbox**: queued ops with status, attempts, backoff | `id, workspace_id, entity_id, status, created_at, next_attempt_at, [workspace_id+status], [status+created_at]` |
| `sync_metadata` | Per-workspace sync cursors (`push_cursor?`, `pull_cursor`, last sync info) | `workspace_id` (PK) |
| `app_settings` | Generic key/value store (`active_workspace_id`, `device_id`, theme, …) | `key` (PK) |

### Index strategy

- **`workspace_id`** is indexed on every synced table — all queries are workspace-scoped.
- **Compound indexes** `[workspace_id+status]`, `[workspace_id+active]`, `[workspace_id+deleted_at]`, `[workspace_id+paid_at]`, `[workspace_id+at]` back the list screens (filter by status/active, hide soft-deleted) and reports (date ranges).
- **`sync_state` / `updated_at`** support the sync engine: pending-record lookups and change detection.
- **`[status+created_at]`** on `sync_operations` lets the engine claim the oldest pending ops in order; `[status+created_at]` + `next_attempt_at` drive retry scheduling.
- Child tables (`quotation_items`, `invoice_items`, `attachments`) index their parent (`[quotation_id]`, `[invoice_id]`, `[entity_type+entity_id]`) for atomic document assembly.

**Versioning strategy:** append `db.version(n+1).stores({...})` with upgrade callbacks; never mutate v1 in place. See [docs/16-INDEXEDDB-DATABASE.md](docs/16-INDEXEDDB-DATABASE.md) and the migration recipe in [DEVELOPMENT.md](DEVELOPMENT.md).

## 2. Dev cloud — Prisma/SQLite

For this environment the cloud is served by Next.js API routes over **Prisma/SQLite** (`prisma/schema.prisma`, database file set by `DATABASE_URL`). It mirrors the production relational model 1:1:

`User, Session, Workspace, WorkspaceMember, CompanyProfile, Customer, Product, Quotation(+Item), Invoice(+Item), Payment, TaxRate, DocumentSequence, ChangeLog, ProcessedOp`

Two server-only tables are central to sync:

- **`ChangeLog`** — append-only feed; every applied mutation writes `(seq autoincrement, workspace_id, entity, entity_id, op, payload_json including items, at)`.
- **`ProcessedOp`** — push idempotency; replayed `op_id`s return the stored outcome instead of re-applying.

The sync endpoints are provider-agnostic: swapping persistence to Supabase requires no protocol change ([docs/19-CLOUD-SYNC.md](docs/19-CLOUD-SYNC.md)).

## 3. Production cloud — Supabase Postgres

Migrations in `supabase/migrations/`: `0001_init.sql` (tables: UUID PKs, FKs to `workspaces(id)`, `updated_at` triggers, soft deletes), `0002_rls.sql` (row-level security on every table via `is_workspace_member(workspace_id)` / `has_role(workspace_id, role[])`), `0003_functions.sql`, and `seed.sql`. Storage buckets: `company-assets` (logos, signatures) and `attachments` with the path convention `{workspace_id}/{entity}/{filename}`.

Roles are enforced **server-side only**: `OWNER > ADMIN > MEMBER > VIEWER` (VIEWER read-only; MEMBER cannot delete; ADMIN cannot delete the workspace). The application never embeds service keys.

## 4. How the stores relate (sync model)

- **Push (op-based):** local mutations enqueue ops in the `sync_operations` outbox (action `upsert|finalize|cancel|delete`, `base_version` for CAS). The engine posts batches to `/api/sync/push`; the server validates (Zod), recomputes totals, applies inside transactions, writes a `ChangeLog` row per apply, and returns per-op outcomes (`applied | duplicate | conflict | rejected | number_reassigned`).
- **Pull (cursor-based):** the engine GETs `/api/sync/pull?cursor=<last seq>` and applies changes inside one Dexie transaction — skipping records with pending local ops for the same entity, otherwise adopting the server record when its `version` is higher — then advances `sync_metadata.pull_cursor`.
- Version numbers and `sync_state` are the join between the worlds; conflicts surface in Settings → Sync → Conflicts ([docs/18-CONFLICT-RESOLUTION.md](docs/18-CONFLICT-RESOLUTION.md)).

## 5. Common operations

| Task | How |
|---|---|
| Create/update the dev cloud schema | `bun run db:push` (applies `prisma/schema.prisma` to SQLite) |
| Reset the dev cloud database | `bun run db:reset` |
| Regenerate Prisma client | `bun run db:generate` |
| Inspect the local database | DevTools → Application → IndexedDB → the app database (17 tables above) |
| Back up / restore local data | **Settings → Data** — JSON backup export & import (plus CSV shortcuts and "clear local data"); see [docs/39-BACKUP-RESTORE.md](docs/39-BACKUP-RESTORE.md) |
| Inspect sync state | **Settings → Sync** — status, outbox table, failed-op retry, conflicts |
