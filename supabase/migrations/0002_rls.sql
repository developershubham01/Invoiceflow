-- =============================================================================
-- InvoiceFlow — supabase/migrations/0002_rls.sql
-- Row Level Security for every workspace table + profiles,
-- storage buckets + policies ('company-assets', 'attachments').
--
-- Model (docs/_CANON.md §8, §16):
--   * All access is workspace-scoped. Membership lives in workspace_members
--     and is resolved through the SECURITY DEFINER helpers below (bypass RLS
--     on the helpers' own reads; run as the table owner inside the function).
--   * Roles: OWNER > ADMIN > MEMBER > VIEWER.
--       - VIEWER / MEMBER / ADMIN / OWNER: SELECT on workspace data.
--       - MEMBER+: INSERT/UPDATE (MEMBER cannot delete).
--       - ADMIN+: DELETE (MEMBER/VIEWER cannot delete).
--       - workspaces themselves: SELECT/UPDATE for members (created only by
--         handle_new_user() or via service role — no client INSERT policy).
--       - workspace_members roster: managed by OWNER/ADMIN only.
--       - change_log / processed_ops: SELECT for members; writes happen via
--         service role or SECURITY DEFINER functions (no client policies).
--       - audit_logs: append-only (SELECT + INSERT for members).
--   * Storage path convention: '{workspace_id}/{entity}/{filename}' — the
--     first path segment must be the caller's workspace_id (uuid).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Enable RLS on all tables (idempotent)
-- -----------------------------------------------------------------------------
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
    'attachments',
    'audit_logs',
    'change_log',
    'processed_ops'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 1. Helper functions
-- -----------------------------------------------------------------------------

-- True when the current Supabase user (auth.uid()) has ANY membership row in
-- the workspace. SECURITY DEFINER + stable: safe to call inside policies.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.workspace_members m
     where m.workspace_id = ws
       and m.user_id = auth.uid()
  );
$$;

comment on function public.is_workspace_member(uuid) is
  'RLS helper: does auth.uid() have a membership row in the workspace? (user-based; device rows are not considered per CANON §8).';

-- True when the current user holds one of the given roles in the workspace.
create or replace function public.has_role(ws uuid, roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.workspace_members m
     where m.workspace_id = ws
       and m.user_id = auth.uid()
       and m.role = any (roles)
  );
$$;

comment on function public.has_role(uuid, text[]) is
  'RLS helper: does auth.uid() hold one of the given roles (OWNER/ADMIN/MEMBER/VIEWER) in the workspace?';

-- Parse the workspace uuid out of a storage object path ('{ws}/{entity}/{file}').
-- Returns NULL for anything that is not a valid uuid — policies then fail
-- closed without raising on foreign bucket objects.
create or replace function public.storage_path_workspace_id(p_path text)
returns uuid
language plpgsql
stable
as $$
declare
  v_seg text;
begin
  v_seg := split_part(coalesce(p_path, ''), '/', 1);
  if v_seg !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return v_seg::uuid;
exception
  when invalid_text_representation then return null;
end;
$$;

comment on function public.storage_path_workspace_id(text) is
  'RLS helper (storage): extracts the workspace_id (first path segment) from a Storage object key; NULL if not a uuid.';

-- -----------------------------------------------------------------------------
-- 2. profiles — a user sees and edits only their own profile row
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
-- Own profile readable.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
-- Own profile insertable (normally created by handle_new_user()).
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
-- Own profile editable; no delete (identity rows are never deleted by clients).
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. workspaces — SELECT/UPDATE for members; creation via trigger/service role
-- -----------------------------------------------------------------------------
drop policy if exists workspaces_select_member on public.workspaces;
-- Any member can read the workspace.
create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

drop policy if exists workspaces_update_member on public.workspaces;
-- Members can update workspace settings; must remain a member after the change.
create policy workspaces_update_member on public.workspaces
  for update to authenticated
  using (public.is_workspace_member(id))
  with check (public.is_workspace_member(id));

-- No INSERT/DELETE policies on purpose:
--   INSERT — workspaces are created by the handle_new_user() trigger (0003)
--            or the claim flow via service role (bypasses RLS).
--   DELETE — workspaces are never deleted by client roles (ADMIN cannot delete
--            the workspace per CANON §8); account deletion cascades via service role.

-- -----------------------------------------------------------------------------
-- 4. workspace_members — visible to members, managed by OWNER/ADMIN only
-- -----------------------------------------------------------------------------
drop policy if exists workspace_members_select_member on public.workspace_members;
-- Members can see the roster of workspaces they belong to.
create policy workspace_members_select_member on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_members_insert_owner_admin on public.workspace_members;
-- Only OWNER/ADMIN can add members.
create policy workspace_members_insert_owner_admin on public.workspace_members
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

drop policy if exists workspace_members_update_owner_admin on public.workspace_members;
-- Only OWNER/ADMIN can change roles.
create policy workspace_members_update_owner_admin on public.workspace_members
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

drop policy if exists workspace_members_delete_owner_admin on public.workspace_members;
-- Only OWNER/ADMIN can remove members.
create policy workspace_members_delete_owner_admin on public.workspace_members
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- -----------------------------------------------------------------------------
-- 5. Business tables — standard matrix
--    SELECT: any member (incl. VIEWER)
--    INSERT/UPDATE: OWNER, ADMIN, MEMBER
--    DELETE: OWNER, ADMIN
-- -----------------------------------------------------------------------------
-- customers -------------------------------------------------------------------
drop policy if exists customers_select_member on public.customers;
create policy customers_select_member on public.customers
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists customers_insert_member on public.customers;
create policy customers_insert_member on public.customers
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists customers_update_member on public.customers;
create policy customers_update_member on public.customers
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists customers_delete_owner_admin on public.customers;
create policy customers_delete_owner_admin on public.customers
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- products --------------------------------------------------------------------
drop policy if exists products_select_member on public.products;
create policy products_select_member on public.products
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists products_insert_member on public.products;
create policy products_insert_member on public.products
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists products_update_member on public.products;
create policy products_update_member on public.products
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists products_delete_owner_admin on public.products;
create policy products_delete_owner_admin on public.products
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- tax_rates -------------------------------------------------------------------
drop policy if exists tax_rates_select_member on public.tax_rates;
create policy tax_rates_select_member on public.tax_rates
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists tax_rates_insert_member on public.tax_rates;
create policy tax_rates_insert_member on public.tax_rates
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists tax_rates_update_member on public.tax_rates;
create policy tax_rates_update_member on public.tax_rates
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists tax_rates_delete_owner_admin on public.tax_rates;
create policy tax_rates_delete_owner_admin on public.tax_rates
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- company_profiles ------------------------------------------------------------
-- Deviation per spec: MEMBER may UPDATE the company profile (fix details) but
-- gets no DELETE; INSERT is OWNER/ADMIN (onboarding creates the single profile).
drop policy if exists company_profiles_select_member on public.company_profiles;
create policy company_profiles_select_member on public.company_profiles
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists company_profiles_insert_owner_admin on public.company_profiles;
create policy company_profiles_insert_owner_admin on public.company_profiles
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

drop policy if exists company_profiles_update_member on public.company_profiles;
create policy company_profiles_update_member on public.company_profiles
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists company_profiles_delete_owner_admin on public.company_profiles;
create policy company_profiles_delete_owner_admin on public.company_profiles
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- quotations ------------------------------------------------------------------
drop policy if exists quotations_select_member on public.quotations;
create policy quotations_select_member on public.quotations
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists quotations_insert_member on public.quotations;
create policy quotations_insert_member on public.quotations
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists quotations_update_member on public.quotations;
create policy quotations_update_member on public.quotations
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists quotations_delete_owner_admin on public.quotations;
create policy quotations_delete_owner_admin on public.quotations
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- quotation_items -------------------------------------------------------------
-- Item rows inherit the parent document's permission matrix.
drop policy if exists quotation_items_select_member on public.quotation_items;
create policy quotation_items_select_member on public.quotation_items
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists quotation_items_insert_member on public.quotation_items;
create policy quotation_items_insert_member on public.quotation_items
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists quotation_items_update_member on public.quotation_items;
create policy quotation_items_update_member on public.quotation_items
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists quotation_items_delete_owner_admin on public.quotation_items;
create policy quotation_items_delete_owner_admin on public.quotation_items
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- invoices --------------------------------------------------------------------
drop policy if exists invoices_select_member on public.invoices;
create policy invoices_select_member on public.invoices
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists invoices_insert_member on public.invoices;
create policy invoices_insert_member on public.invoices
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists invoices_update_member on public.invoices;
create policy invoices_update_member on public.invoices
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists invoices_delete_owner_admin on public.invoices;
create policy invoices_delete_owner_admin on public.invoices
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- invoice_items ---------------------------------------------------------------
drop policy if exists invoice_items_select_member on public.invoice_items;
create policy invoice_items_select_member on public.invoice_items
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists invoice_items_insert_member on public.invoice_items;
create policy invoice_items_insert_member on public.invoice_items
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists invoice_items_update_member on public.invoice_items;
create policy invoice_items_update_member on public.invoice_items
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists invoice_items_delete_owner_admin on public.invoice_items;
create policy invoice_items_delete_owner_admin on public.invoice_items
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- payments --------------------------------------------------------------------
drop policy if exists payments_select_member on public.payments;
create policy payments_select_member on public.payments
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists payments_insert_member on public.payments;
create policy payments_insert_member on public.payments
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists payments_update_member on public.payments;
create policy payments_update_member on public.payments
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists payments_delete_owner_admin on public.payments;
create policy payments_delete_owner_admin on public.payments
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- attachments -----------------------------------------------------------------
drop policy if exists attachments_select_member on public.attachments;
create policy attachments_select_member on public.attachments
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists attachments_insert_member on public.attachments;
create policy attachments_insert_member on public.attachments
  for insert to authenticated
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists attachments_update_member on public.attachments;
create policy attachments_update_member on public.attachments
  for update to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']))
  with check (public.has_role(workspace_id, array['OWNER', 'ADMIN', 'MEMBER']));

drop policy if exists attachments_delete_owner_admin on public.attachments;
create policy attachments_delete_owner_admin on public.attachments
  for delete to authenticated
  using (public.has_role(workspace_id, array['OWNER', 'ADMIN']));

-- -----------------------------------------------------------------------------
-- 6. Server-only tables — members read; writes via service role / definer fns
-- -----------------------------------------------------------------------------
-- change_log (pull feed): SELECT only. The sync server (service role, which
-- bypasses RLS) and SECURITY DEFINER functions append rows.
drop policy if exists change_log_select_member on public.change_log;
create policy change_log_select_member on public.change_log
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- processed_ops (idempotency ledger): SELECT only, same rationale.
drop policy if exists processed_ops_select_member on public.processed_ops;
create policy processed_ops_select_member on public.processed_ops
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- audit_logs: append-only. Members read; members may insert rows stamped with
-- their own user id (spoof-proof); no UPDATE/DELETE policies at all.
drop policy if exists audit_logs_select_member on public.audit_logs;
create policy audit_logs_select_member on public.audit_logs
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists audit_logs_insert_member on public.audit_logs;
create policy audit_logs_insert_member on public.audit_logs
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and actor_user_id = auth.uid());

-- document_sequences: numbering is server-owned (allocate_document_number is
-- SECURITY DEFINER; service role bypasses RLS). Clients get read-only access
-- so the UI can preview the next number; no write policies.
drop policy if exists document_sequences_select_member on public.document_sequences;
create policy document_sequences_select_member on public.document_sequences
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- -----------------------------------------------------------------------------
-- 7. Storage: buckets + policies for 'company-assets' and 'attachments'
--    Path convention: '{workspace_id}/{entity}/{filename}' (CANON §8).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('company-assets', 'company-assets', false),
  ('attachments',    'attachments',    false)
on conflict (id) do nothing;

-- SELECT: any member of the workspace that owns the object path.
drop policy if exists ifl_storage_read on storage.objects;
create policy ifl_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('company-assets', 'attachments')
    and public.is_workspace_member(public.storage_path_workspace_id(name))
  );

-- INSERT: OWNER/ADMIN/MEMBER may upload; path must start with their workspace_id.
drop policy if exists ifl_storage_write on storage.objects;
create policy ifl_storage_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('company-assets', 'attachments')
    and public.has_role(
          public.storage_path_workspace_id(name),
          array['OWNER', 'ADMIN', 'MEMBER'])
  );

-- UPDATE: same write matrix (e.g. content-type/metadata fixes, re-uploads).
drop policy if exists ifl_storage_update on storage.objects;
create policy ifl_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('company-assets', 'attachments')
    and public.has_role(
          public.storage_path_workspace_id(name),
          array['OWNER', 'ADMIN', 'MEMBER'])
  )
  with check (
    bucket_id in ('company-assets', 'attachments')
    and public.has_role(
          public.storage_path_workspace_id(name),
          array['OWNER', 'ADMIN', 'MEMBER'])
  );

-- DELETE: OWNER/ADMIN only (mirrors table-level delete policy).
drop policy if exists ifl_storage_delete on storage.objects;
create policy ifl_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('company-assets', 'attachments')
    and public.has_role(
          public.storage_path_workspace_id(name),
          array['OWNER', 'ADMIN'])
  );
