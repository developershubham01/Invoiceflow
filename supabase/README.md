# InvoiceFlow — Supabase (production cloud)

Production PostgreSQL schema for InvoiceFlow, per `docs/_CANON.md` §7 (entity model), §8 (cloud schema) and §11 (roles). Everything below targets **Supabase PostgreSQL** (the `public`, `auth` and `storage` schemas are Supabase built-ins).

## File map

| File | Purpose |
|---|---|
| `migrations/0001_init.sql` | Tables, constraints, indexes, `set_updated_at()` triggers |
| `migrations/0002_rls.sql` | RLS enablement, `is_workspace_member()` / `has_role()` helpers, policies, storage buckets + policies |
| `migrations/0003_functions.sql` | `allocate_document_number()`, `sync_finalize_invoice()`, `handle_new_user()` trigger on `auth.users` |
| `seed.sql` | **DEV ONLY** demo dataset (`Acme Traders (Demo)`) — never run in production |

## 1. Applying the migrations

### Option A — Supabase CLI (recommended)

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push          # applies supabase/migrations/* in filename order
```

`supabase db push` is idempotent at the migration level (applied files are recorded in `supabase_migrations.schema_migrations`). The SQL itself is also written defensively (`if not exists`, `drop policy if exists`, `on conflict do nothing`).

### Option B — plain psql

Get the connection string from Supabase → Project Settings → Database, then:

```bash
export DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/0001_init.sql \
  -f supabase/migrations/0002_rls.sql \
  -f supabase/migrations/0003_functions.sql
```

> ⚠️ Run files in order (`0001 → 0002 → 0003`); `0002` depends on the tables of `0001`, and `0003`'s policies/grants assume both.

### Seed (development only)

```bash
# local stack only — `supabase db reset` also replays seed.sql automatically
psql "$LOCAL_DATABASE_URL" -f supabase/seed.sql
```

`seed.sql` is guarded (`DEV ONLY — do not run in production`): it skips itself if the demo workspace `acme-traders-demo` already exists, uses fixed UUIDs and `ON CONFLICT DO NOTHING`. Do **not** execute it against a production database.

## 2. Verifying RLS

Run in the Supabase SQL Editor (or psql). Policies deny everything for `anon` and scope reads to the caller's workspaces for `authenticated`:

```sql
begin;

-- 1) anon sees nothing
set local role anon;
select count(*) from public.customers;          -- → 0 rows (RLS denies)

-- 2) authenticated user with no membership sees nothing
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}';
select count(*) from public.customers;          -- → 0 rows

-- 3) a member sees exactly their workspace's rows
--    (substitute a user id that has a workspace_members row)
set local role authenticated;
set local request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';
select id, name from public.workspaces;         -- → only member workspaces
select count(*) from public.customers;          -- → only that workspace's customers

rollback;
```

Role matrix enforced by the policies (CANON §8):

| Table(s) | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| customers, products, tax_rates, quotations(+items), invoices(+items), payments, attachments | any member | OWNER/ADMIN/MEMBER | OWNER/ADMIN/MEMBER | OWNER/ADMIN |
| company_profiles | any member | OWNER/ADMIN | OWNER/ADMIN/MEMBER | OWNER/ADMIN |
| workspaces | member | — (trigger/service role only) | member | — (service role only) |
| workspace_members | member | OWNER/ADMIN | OWNER/ADMIN | OWNER/ADMIN |
| document_sequences | member | — (numbering fn only) | — | — |
| change_log, processed_ops | member | — (service role only) | — | — |
| audit_logs | member | member (`actor_user_id = auth.uid()`) | — | — |
| profiles | own row | own row | own row | — |

Note: the `service_role` (used by Edge Functions and the sync server) **bypasses RLS** — that is by design and is why `change_log`/`processed_ops` have no write policies.

## 3. Storage buckets

`0002_rls.sql` creates the two private buckets idempotently:

```sql
select id, public from storage.buckets where id in ('company-assets', 'attachments');
```

* `company-assets` — logos, signatures (uploaded from Settings → Company).
* `attachments` — generic document attachments.

**Path convention (mandatory):** `{workspace_id}/{entity}/{filename}`, e.g. `00000000-0000-0000-0000-000000000001/company/logo.png`. The policies parse the first path segment (`storage_path_workspace_id()`) and fail closed when it is not a valid workspace uuid the caller belongs to. Read = any member; write = OWNER/ADMIN/MEMBER; delete = OWNER/ADMIN.

Upload from the client with `supabase.storage.from('attachments').upload(`${workspaceId}/${entity}/${filename}`, file)`.

## 4. Document numbering & finalization

* `public.allocate_document_number(workspace, 'INVOICE'|'QUOTATION', fiscal_year)` → `INV/2025-26/0042` style numbers; row-locked on `document_sequences`, sequences never decrement. Executable by `authenticated` + `service_role`.
* `public.sync_finalize_invoice(op_id, workspace, invoice_id, base_version, payload, actor?, device_id?)` → the `finalize` push op (CANON §9): idempotent via `processed_ops`, CAS on `base_version`, DRAFT-only, recomputes all totals from the payload (CANON §4 math incl. round-off), replaces items atomically, appends `change_log` + `audit_logs`, and returns `{ status: applied|duplicate|conflict|rejected, record? , error? }`. Executable by `service_role` only — call it from the `sync-push` Edge Function after verifying the caller's JWT.
* `public.handle_new_user()` — trigger on `auth.users` that provisions `profiles` + personal workspace + OWNER membership on signup.

## 5. Key safety rules

* **Never bundle the service-role key** (`SUPABASE_SERVICE_ROLE_KEY`) into the web app, PWA, or Electron renderer. It bypasses RLS. Server-side (Edge Functions / CI) only — see CANON §16.
* Client apps use the **anon key** + Supabase Auth JWTs; RLS is the security boundary.
* Migrations are append-only; never edit an applied migration. To change the schema, add `0004_*.sql`. For local experiments: `supabase db reset` (drops + re-applies migrations + seed).
* `seed.sql` is development-only and skipped automatically when the demo workspace exists.
