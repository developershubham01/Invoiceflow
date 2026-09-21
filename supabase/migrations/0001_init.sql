-- =============================================================================
-- InvoiceFlow — supabase/migrations/0001_init.sql
-- Production schema (tables, indexes, updated_at triggers).
-- Target: Supabase PostgreSQL (public schema + auth/storage built-ins).
--
-- Conventions (docs/_CANON.md §3, §4, §7):
--   * All business IDs are UUIDv4 (gen_random_uuid()); no auto-increment for
--     synced entities (change_log.seq is server-internal and may use identity).
--   * Money = integer paise (bigint, `_paise`); rates = basis points (`_bps`);
--     quantities = integer milli-units (`_milli`). NEVER floats.
--   * Document dates (invoice_date, due_date, quotation_date, valid_until,
--     paid_at) are plain `date` columns (YYYY-MM-DD).
--   * Every synced table: created_at, updated_at (trigger-maintained),
--     deleted_at (soft delete), version (optimistic concurrency),
--     workspace_id (tenant scope, FK -> workspaces ON DELETE CASCADE),
--     origin_device_id (offline-origin traceability).
--   * Item tables (quotation_items / invoice_items) are computed snapshots
--     replaced atomically with their parent document; they still carry the
--     common metadata for uniform sync payloads.
-- =============================================================================

-- pgcrypto: gen_random_uuid() (pre-installed on Supabase; kept for portability)
create extension if not exists pgcrypto;

-- =============================================================================
-- profiles — 1:1 extension of auth.users (Supabase Auth)
-- =============================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'User profile, 1:1 with auth.users. Row is created by the handle_new_user() trigger (0003_functions.sql).';

-- =============================================================================
-- workspaces — tenant root. Created by handle_new_user() (personal workspace)
-- or by the workspace-claim flow (service role); no client INSERT policy.
-- =============================================================================
create table if not exists public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  slug          text        not null unique,
  owner_user_id uuid        references auth.users (id) on delete set null,
  settings      jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer     not null default 1
);

comment on table public.workspaces is
  'Tenant root. All business tables reference workspaces(id) ON DELETE CASCADE. slug is the stable public identifier.';
comment on column public.workspaces.settings is
  'Workspace preferences JSON (round-off, invoice defaults overrides, sync options).';

-- =============================================================================
-- workspace_members — role roster. user_id nullable: device-originated rows
-- (guest workspaces pre-claim); role per CANON §7/§8: OWNER > ADMIN > MEMBER > VIEWER.
-- =============================================================================
create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces (id) on delete cascade,
  user_id      uuid        references auth.users (id) on delete cascade,
  device_id    text,
  role         text        not null default 'MEMBER'
               check (role in ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
  invited_by   uuid        references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- one membership per user per workspace (NULL user_ids are device rows)
  constraint workspace_members_ws_user_uq unique (workspace_id, user_id)
);

-- device rows: one membership per device per workspace
create unique index if not exists workspace_members_ws_device_uq
  on public.workspace_members (workspace_id, device_id)
  where device_id is not null;

create index if not exists workspace_members_user_id_idx on public.workspace_members (user_id);
create index if not exists workspace_members_workspace_id_idx on public.workspace_members (workspace_id);

comment on table public.workspace_members is
  'Membership roster driving RLS (is_workspace_member / has_role helpers). OWNER,ADMIN manage; rows with NULL user_id are device memberships (read-only to RLS, resolved at claim time).';

-- =============================================================================
-- company_profiles — seller identity printed on documents (1 per workspace in MVP)
-- =============================================================================
create table if not exists public.company_profiles (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid        not null references public.workspaces (id) on delete cascade,
  name               text,
  business_type      text,
  logo_url           text,           -- storage path in 'company-assets' bucket
  address_line1      text,
  address_line2      text,
  city               text,
  state_name         text,
  state_code         text,           -- GST state code, e.g. '27' = Maharashtra
  pincode            text,
  gstin              text,           -- ^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$
  pan                text,
  phone              text,
  email              text,
  website            text,
  bank_name          text,
  bank_account       text,
  bank_ifsc          text,
  bank_branch        text,
  authorized_signatory text,
  signature_url      text,           -- storage path in 'company-assets' bucket
  invoice_prefix     text        not null default 'INV',
  quotation_prefix   text        not null default 'QT',
  default_gst_rate_bps integer   not null default 1800,
  price_includes_tax boolean     not null default false,
  enable_round_off   boolean     not null default true,
  default_terms      text,
  default_notes      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  version            integer     not null default 1,
  origin_device_id   text
);

create index if not exists company_profiles_workspace_id_idx on public.company_profiles (workspace_id);

comment on table public.company_profiles is
  'Seller/company details (one per workspace in MVP). Prefixes drive document numbering; default_gst_rate_bps is the workspace fallback rate.';

-- =============================================================================
-- customers — master data (soft-deleted rows kept for historical documents)
-- =============================================================================
create table if not exists public.customers (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid        not null references public.workspaces (id) on delete cascade,
  code             text,       -- auto 'CUS-0001' (client-generated)
  type             text        not null check (type in ('BUSINESS', 'INDIVIDUAL')),
  business_name    text,
  contact_person   text,
  email            text,
  phone            text,
  gstin            text,
  billing_address  text,
  shipping_address text,
  state_name       text,
  state_code       text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  version          integer     not null default 1,
  origin_device_id text
);

create index if not exists customers_workspace_id_idx    on public.customers (workspace_id);
create index if not exists customers_ws_code_idx         on public.customers (workspace_id, code);
create index if not exists customers_ws_gstin_idx        on public.customers (workspace_id, gstin);
create index if not exists customers_ws_deleted_idx      on public.customers (workspace_id, deleted_at);

comment on table public.customers is
  'Customer master. state_code drives intra/inter GST determination; documents keep name/GSTIN snapshots.';

-- =============================================================================
-- products — master data. Prices in paise; rate in bps (1800 = 18%).
-- =============================================================================
create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid        not null references public.workspaces (id) on delete cascade,
  name                text        not null,
  sku                 text,
  hsn_sac             text,
  description         text,
  unit                text        not null default 'NOS',
  selling_price_paise bigint      not null check (selling_price_paise >= 0),
  cost_price_paise    bigint               check (cost_price_paise    >= 0),
  gst_rate_bps        integer     not null default 1800 check (gst_rate_bps between 0 and 10000),
  price_includes_tax  boolean,    -- null -> fall back to company_profiles default
  active              boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  version             integer     not null default 1,
  origin_device_id    text
);

create index if not exists products_workspace_id_idx  on public.products (workspace_id);
create index if not exists products_ws_sku_idx        on public.products (workspace_id, sku);
create index if not exists products_ws_hsn_idx        on public.products (workspace_id, hsn_sac);
create index if not exists products_ws_active_idx     on public.products (workspace_id, active);

comment on table public.products is
  'Product/service master. selling_price_paise >= 0; gst_rate_bps in [0,10000]; price_includes_tax null means inherit company default.';

-- =============================================================================
-- quotations — header + recomputed totals + charges snapshot
-- =============================================================================
create table if not exists public.quotations (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid        not null references public.workspaces (id) on delete cascade,
  number                 text        not null,          -- 'QT/2025-26/0001'; drafts: 'DRAFT-xxxxxxxx'
  status                 text        not null default 'DRAFT'
                         check (status in ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED')),
  quotation_date         date        not null,
  valid_until            date,
  customer_id            uuid        references public.customers (id) on delete set null,
  customer_name_snapshot text,
  customer_gstin_snapshot text,
  place_of_supply_code   text,
  tax_mode               text        check (tax_mode in ('INTRA', 'INTER')),
  price_includes_tax     boolean,
  -- totals (paise), recomputed server-side — client numbers are never trusted
  subtotal_gross_paise   bigint      not null default 0,
  discount_total_paise   bigint      not null default 0,
  taxable_total_paise    bigint      not null default 0,
  cgst_paise             bigint      not null default 0,
  sgst_paise             bigint      not null default 0,
  igst_paise             bigint      not null default 0,
  charges_total_paise    bigint      not null default 0,
  charges_tax_paise      bigint      not null default 0,
  round_off_paise        bigint      not null default 0,
  grand_total_paise      bigint      not null default 0,
  charges                jsonb       not null default '[]'::jsonb,  -- [{id,label,amount_paise,taxable,gst_rate_bps}]
  notes                  text,
  terms                  text,
  converted_invoice_id   uuid,       -- FK added after invoices exists (ALTER below)
  finalized_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  version                integer     not null default 1,
  origin_device_id       text
);

create index if not exists quotations_workspace_id_idx     on public.quotations (workspace_id);
create index if not exists quotations_ws_status_idx        on public.quotations (workspace_id, status);
create index if not exists quotations_ws_quotation_date_idx on public.quotations (workspace_id, quotation_date);
create index if not exists quotations_ws_valid_until_idx   on public.quotations (workspace_id, valid_until);
create index if not exists quotations_ws_number_idx        on public.quotations (workspace_id, number);
create index if not exists quotations_customer_id_idx      on public.quotations (customer_id);

comment on table public.quotations is
  'Quotation header. Lifecycle: DRAFT→SENT→ACCEPTED|REJECTED; ACCEPTED→CONVERTED; EXPIRED computed from valid_until. Totals recomputed server-side (CANON §4).';

-- =============================================================================
-- quotation_items — line snapshot (computed columns filled server-side)
-- =============================================================================
create table if not exists public.quotation_items (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid        not null references public.workspaces (id) on delete cascade,
  quotation_id        uuid        not null references public.quotations (id) on delete cascade,
  position            integer     not null default 0,
  description         text,
  hsn_sac             text,
  qty_milli           bigint      not null default 0 check (qty_milli >= 0),        -- 2500 = 2.5
  unit                text,
  unit_price_paise    bigint      not null default 0 check (unit_price_paise >= 0),
  discount_bps        integer     not null default 0 check (discount_bps between 0 and 10000),
  gst_rate_bps        integer     not null default 0 check (gst_rate_bps between 0 and 10000),
  gross_paise         bigint      not null default 0,
  discount_paise      bigint      not null default 0,
  taxable_paise       bigint      not null default 0,
  cgst_paise          bigint      not null default 0,
  sgst_paise          bigint      not null default 0,
  igst_paise          bigint      not null default 0,
  tax_paise           bigint      not null default 0,
  total_paise         bigint      not null default 0,
  price_includes_tax  boolean     not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  version             integer     not null default 1,
  origin_device_id    text
);

create index if not exists quotation_items_quotation_id_idx  on public.quotation_items (quotation_id);
create index if not exists quotation_items_ws_idx            on public.quotation_items (workspace_id);
create index if not exists quotation_items_position_idx      on public.quotation_items (quotation_id, position);

comment on table public.quotation_items is
  'Quotation line items (snapshot incl. computed tax columns). Replaced atomically whenever the parent document is upserted/finalized.';

-- =============================================================================
-- invoices — mirrors quotations + payment state + lifecycle guards
-- =============================================================================
create table if not exists public.invoices (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid        not null references public.workspaces (id) on delete cascade,
  number                 text        not null,          -- 'INV/2025-26/0042'; drafts: 'DRAFT-xxxxxxxx'
  status                 text        not null default 'DRAFT'
                         check (status in ('DRAFT', 'FINALIZED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
  invoice_date           date        not null,
  due_date               date,
  customer_id            uuid        references public.customers (id) on delete set null,
  customer_name_snapshot text,
  customer_gstin_snapshot text,
  place_of_supply_code   text,
  tax_mode               text        check (tax_mode in ('INTRA', 'INTER')),
  price_includes_tax     boolean,
  -- totals (paise), recomputed server-side
  subtotal_gross_paise   bigint      not null default 0,
  discount_total_paise   bigint      not null default 0,
  taxable_total_paise    bigint      not null default 0,
  cgst_paise             bigint      not null default 0,
  sgst_paise             bigint      not null default 0,
  igst_paise             bigint      not null default 0,
  charges_total_paise    bigint      not null default 0,
  charges_tax_paise      bigint      not null default 0,
  round_off_paise        bigint      not null default 0,
  grand_total_paise      bigint      not null default 0,
  charges                jsonb       not null default '[]'::jsonb,
  notes                  text,
  terms                  text,
  paid_total_paise       bigint      not null default 0 check (paid_total_paise >= 0),
  source_quotation_id    uuid        references public.quotations (id) on delete set null,
  finalized_at           timestamptz,
  cancelled_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  version                integer     not null default 1,
  origin_device_id       text
);

create index if not exists invoices_workspace_id_idx     on public.invoices (workspace_id);
create index if not exists invoices_ws_status_idx        on public.invoices (workspace_id, status);
create index if not exists invoices_ws_invoice_date_idx  on public.invoices (workspace_id, invoice_date);
create index if not exists invoices_ws_due_date_idx      on public.invoices (workspace_id, due_date);  -- overdue reports
create index if not exists invoices_ws_number_idx        on public.invoices (workspace_id, number);
create index if not exists invoices_customer_id_idx      on public.invoices (customer_id);
create index if not exists invoices_source_quotation_idx on public.invoices (source_quotation_id);

comment on table public.invoices is
  'Invoice header. DRAFT→FINALIZED (number allocated, immutable)→PARTIALLY_PAID→PAID; CANCELLED only while paid_total = 0. Numbers never reused.';

-- Circular reference quotations.converted_invoice_id -> invoices: add now that
-- invoices exists. ON DELETE SET NULL keeps workspace cascade deletes working
-- while documents preserve cross-references in practice.
alter table public.quotations
  add constraint quotations_converted_invoice_fkey
  foreign key (converted_invoice_id) references public.invoices (id) on delete set null;

create index if not exists quotations_converted_invoice_idx on public.quotations (converted_invoice_id);

-- =============================================================================
-- invoice_items — mirrors quotation_items
-- =============================================================================
create table if not exists public.invoice_items (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid        not null references public.workspaces (id) on delete cascade,
  invoice_id          uuid        not null references public.invoices (id) on delete cascade,
  position            integer     not null default 0,
  description         text,
  hsn_sac             text,
  qty_milli           bigint      not null default 0 check (qty_milli >= 0),
  unit                text,
  unit_price_paise    bigint      not null default 0 check (unit_price_paise >= 0),
  discount_bps        integer     not null default 0 check (discount_bps between 0 and 10000),
  gst_rate_bps        integer     not null default 0 check (gst_rate_bps between 0 and 10000),
  gross_paise         bigint      not null default 0,
  discount_paise      bigint      not null default 0,
  taxable_paise       bigint      not null default 0,
  cgst_paise          bigint      not null default 0,
  sgst_paise          bigint      not null default 0,
  igst_paise          bigint      not null default 0,
  tax_paise           bigint      not null default 0,
  total_paise         bigint      not null default 0,
  price_includes_tax  boolean     not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  version             integer     not null default 1,
  origin_device_id    text
);

create index if not exists invoice_items_invoice_id_idx  on public.invoice_items (invoice_id);
create index if not exists invoice_items_ws_idx          on public.invoice_items (workspace_id);
create index if not exists invoice_items_position_idx    on public.invoice_items (invoice_id, position);

comment on table public.invoice_items is
  'Invoice line items (snapshot incl. computed tax columns). Replaced atomically whenever the parent document is upserted/finalized.';

-- =============================================================================
-- payments — manual payment recording (no gateway in MVP)
-- =============================================================================
create table if not exists public.payments (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid        not null references public.workspaces (id) on delete cascade,
  invoice_id       uuid        not null references public.invoices (id) on delete cascade,
  amount_paise     bigint      not null check (amount_paise > 0),
  paid_at          date,
  method           text        check (method in ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'OTHER')),
  reference        text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  version          integer     not null default 1,
  origin_device_id text
);

create index if not exists payments_workspace_id_idx  on public.payments (workspace_id);
create index if not exists payments_invoice_id_idx    on public.payments (invoice_id);
create index if not exists payments_ws_paid_at_idx    on public.payments (workspace_id, paid_at);

comment on table public.payments is
  'Payments against invoices. Server maintains invoices.paid_total_paise and status transitions (PARTIALLY_PAID/PAID). amount_paise > 0 enforced.';

-- =============================================================================
-- tax_rates — versioned GST rate history per workspace (CANON §5)
-- =============================================================================
create table if not exists public.tax_rates (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid        not null references public.workspaces (id) on delete cascade,
  name             text        not null,
  rate_bps         integer     not null check (rate_bps between 0 and 10000),
  active           boolean     not null default true,
  effective_from   date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  version          integer     not null default 1,
  origin_device_id text
);

create index if not exists tax_rates_workspace_id_idx on public.tax_rates (workspace_id);
create index if not exists tax_rates_ws_active_idx    on public.tax_rates (workspace_id, active);

comment on table public.tax_rates is
  'Configurable GST rates (rate history). Documents snapshot the rate per line; this table is the picker source.';

-- =============================================================================
-- document_sequences — per-workspace numbering (workspace_id, doc_type, fiscal_year)
-- =============================================================================
create table if not exists public.document_sequences (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.workspaces (id) on delete cascade,
  doc_type      text        not null check (doc_type in ('INVOICE', 'QUOTATION')),
  fiscal_year   text        not null,     -- '2025-26' (April–March)
  next_seq      bigint      not null default 1 check (next_seq >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint document_sequences_ws_type_fy_uq unique (workspace_id, doc_type, fiscal_year)
);

comment on table public.document_sequences is
  'Sequence counter per workspace/doc_type/fiscal_year. Rows locked FOR UPDATE by allocate_document_number(); sequences never decrement.';

-- =============================================================================
-- attachments — metadata for files in Storage (path convention {workspace_id}/...)
-- =============================================================================
create table if not exists public.attachments (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid        not null references public.workspaces (id) on delete cascade,
  entity_type      text        not null,   -- 'invoice' | 'quotation' | 'customer' | 'company' | ...
  entity_id        uuid        not null,
  filename         text        not null,
  mime             text,
  size_bytes       bigint               check (size_bytes >= 0),
  storage_path     text,                   -- '{workspace_id}/{entity}/{filename}' in bucket
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  version          integer     not null default 1,
  origin_device_id text
);

create index if not exists attachments_workspace_id_idx on public.attachments (workspace_id);
create index if not exists attachments_entity_idx       on public.attachments (workspace_id, entity_type, entity_id);

comment on table public.attachments is
  'Attachment metadata; binaries live in Storage buckets (company-assets / attachments). entity_type+entity_id is polymorphic by design.';

-- =============================================================================
-- audit_logs — append-only trail (SELECT/INSERT for members; no UPDATE/DELETE)
-- =============================================================================
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.workspaces (id) on delete cascade,
  actor_user_id uuid        references auth.users (id) on delete set null,
  entity_type   text        not null,
  entity_id     uuid,
  action        text        not null
                check (action in ('CREATE', 'UPDATE', 'FINALIZE', 'CONVERT', 'CANCEL',
                                  'PAYMENT', 'DELETE', 'SYNC_CONFLICT', 'STATUS')),
  detail        jsonb       not null default '{}'::jsonb,
  device_id     text,
  at            timestamptz not null default now()
);

create index if not exists audit_logs_ws_at_idx      on public.audit_logs (workspace_id, at);
create index if not exists audit_logs_ws_entity_idx  on public.audit_logs (workspace_id, entity_type, entity_id);
create index if not exists audit_logs_actor_idx      on public.audit_logs (actor_user_id);

comment on table public.audit_logs is
  'Append-only audit trail for lifecycle events (finalize/convert/cancel/payment/conflicts). Written by clients (own uid) and by the sync server.';

-- =============================================================================
-- change_log — server pull feed (§8/§9): one row per applied mutation,
-- payload = full record incl. items. Written exclusively by the sync server
-- (service role / security-definer functions); clients only SELECT.
-- =============================================================================
create table if not exists public.change_log (
  seq          bigint generated always as identity primary key,
  workspace_id uuid        not null references public.workspaces (id) on delete cascade,
  entity       text        not null,   -- 'invoice' | 'quotation' | 'customer' | 'product' | 'company' | 'payment' | 'workspace'
  entity_id    uuid,
  op           text        not null,   -- 'upsert' | 'finalize' | 'cancel' | 'delete'
  payload      jsonb       not null,
  at           timestamptz not null default now()
);

-- pull feed cursor scan: WHERE workspace_id = ? AND seq > cursor ORDER BY seq
create index if not exists change_log_ws_seq_idx on public.change_log (workspace_id, seq);

comment on table public.change_log is
  'Server-side change feed. Pull cursor = last seen seq. seq is a server-internal identity (allowed exception to UUID rule). No client write policies (service role only).';

-- =============================================================================
-- processed_ops — idempotency for push operations (op_id replay => duplicate)
-- =============================================================================
create table if not exists public.processed_ops (
  op_id       uuid primary key,
  workspace_id uuid       not null references public.workspaces (id) on delete cascade,
  result      jsonb,
  applied_at  timestamptz not null default now()
);

create index if not exists processed_ops_workspace_id_idx on public.processed_ops (workspace_id);
create index if not exists processed_ops_applied_at_idx   on public.processed_ops (applied_at);

comment on table public.processed_ops is
  'Applied sync operations (op_id -> stored outcome). Replays return the stored result (duplicate). Written by the sync server only.';

-- =============================================================================
-- updated_at trigger — one function, attached to every table that carries
-- updated_at (audit_logs / change_log / processed_ops are append-only and
-- intentionally excluded).
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: keeps updated_at = now() on every UPDATE. Attached to all mutable tables (0001_init.sql).';

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'workspaces',
    'workspace_members',
    'company_profiles',
    'customers',
    'products',
    'quotations',
    'quotation_items',
    'invoices',
    'invoice_items',
    'payments',
    'tax_rates',
    'document_sequences',
    'attachments'
  ]
  loop
    execute format('drop trigger if exists trg_%s_set_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%s_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t, t);
  end loop;
end
$$;
