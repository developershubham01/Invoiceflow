-- =============================================================================
-- InvoiceFlow — supabase/migrations/0003_functions.sql
-- Domain functions + auth trigger.
--
-- Contents:
--   public.round_half_up(numeric)            — CANON §4 rounding (half-up, paise)
--   public.fiscal_year_of(date)              — CANON §6 fiscal year (April–March)
--   public.allocate_document_number(...)     — CANON §6 numbering (row-locked)
--   public.sync_finalize_invoice(...)        — CANON §9 finalize op (idempotent,
--                                              recomputes totals, CAS on version,
--                                              writes change_log/audit/processed_ops)
--   public.handle_new_user()                 — CANON §11: profile + personal
--                                              workspace + OWNER membership
--
-- Sync pipeline note: the production sync endpoint is a Supabase Edge Function
-- (`sync-push`). It authenticates the caller's JWT, then calls
-- public.sync_finalize_invoice() with service-role privileges. The function is
-- SECURITY DEFINER, re-checks workspace membership/role itself, and is the ONLY
-- code path that allocates final invoice numbers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- round_half_up — half-up rounding on the paise (CANON §4, non-negotiable).
-- roundHalfUp(x) = floor(x + 0.5) for positive values.
-- -----------------------------------------------------------------------------
create or replace function public.round_half_up(p_value numeric)
returns bigint
language sql
immutable
as $$
  select floor(p_value + 0.5)::bigint;
$$;

comment on function public.round_half_up(numeric) is
  'Money rounding: half-up on the paise. Used by every server-side total recomputation (CANON §4).';

-- -----------------------------------------------------------------------------
-- fiscal_year_of — Indian fiscal year April–March → '2025-26' (CANON §6).
-- -----------------------------------------------------------------------------
create or replace function public.fiscal_year_of(p_date date)
returns text
language sql
immutable
as $$
  select case
           when extract(month from p_date) >= 4
             then extract(year from p_date)::int || '-' ||
                  right((extract(year from p_date)::int + 1)::text, 2)
           else (extract(year from p_date)::int - 1) || '-' ||
                right(extract(year from p_date)::int::text, 2)
         end;
$$;

comment on function public.fiscal_year_of(date) is
  'Fiscal year label (April–March) used in document numbers, e.g. fiscal_year_of(''2025-06-01'') = ''2025-26''.';

-- -----------------------------------------------------------------------------
-- allocate_document_number — serializable document numbering (CANON §6).
--   1. inserts-if-missing the (workspace, doc_type, fiscal_year) sequence row
--   2. locks the row FOR UPDATE (serializes concurrent allocators)
--   3. increments next_seq (sequences never decrement)
--   4. returns '{prefix}/{FY}/{seq4}' — prefix from company_profiles
--      (invoice_prefix / quotation_prefix), falling back to INV/QT.
-- Call inside a transaction (Edge Function / RPC) so the row lock is held
-- until commit.
-- -----------------------------------------------------------------------------
create or replace function public.allocate_document_number(
  p_workspace   uuid,
  p_type        text,
  p_fiscal_year text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_seq    bigint;
begin
  if p_type not in ('INVOICE', 'QUOTATION') then
    raise exception 'invalid doc_type: % (expected INVOICE|QUOTATION)', p_type
      using errcode = '22023';
  end if;
  if p_workspace is null or p_fiscal_year is null then
    raise exception 'workspace and fiscal_year are required'
      using errcode = '22004';
  end if;

  -- resolve prefix from the workspace company profile (first profile in MVP)
  select case
           when p_type = 'INVOICE'   then coalesce(cp.invoice_prefix,   'INV')
           else                           coalesce(cp.quotation_prefix, 'QT')
         end
    into v_prefix
    from public.company_profiles cp
   where cp.workspace_id = p_workspace
     and cp.deleted_at is null
   order by cp.created_at
   limit 1;

  v_prefix := coalesce(v_prefix, case when p_type = 'INVOICE' then 'INV' else 'QT' end);

  -- insert-if-missing, then lock and increment
  insert into public.document_sequences (workspace_id, doc_type, fiscal_year, next_seq)
  values (p_workspace, p_type, p_fiscal_year, 1)
  on conflict (workspace_id, doc_type, fiscal_year) do nothing;

  select ds.next_seq
    into v_seq
    from public.document_sequences ds
   where ds.workspace_id = p_workspace
     and ds.doc_type     = p_type
     and ds.fiscal_year  = p_fiscal_year
   for update;

  update public.document_sequences
     set next_seq   = v_seq + 1,
         updated_at = now()
   where workspace_id = p_workspace
     and doc_type     = p_type
     and fiscal_year  = p_fiscal_year;

  return v_prefix || '/' || p_fiscal_year || '/' || lpad(v_seq::text, 4, '0');
end;
$$;

comment on function public.allocate_document_number(uuid, text, text) is
  'Allocates the next document number ({prefix}/{FY}/{seq4}) under a row lock on document_sequences. Server authority per CANON §6; sequences never decrement.';

revoke execute on function public.allocate_document_number(uuid, text, text) from public, anon;
grant  execute on function public.allocate_document_number(uuid, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- sync_finalize_invoice — the `finalize` push op (CANON §9 rule 5, §12).
-- Security-definer; the Edge Function `sync-push` calls it after authenticating
-- the user JWT. Contract mirrors the sync protocol:
--   returns { status: 'applied'|'duplicate'|'conflict'|'rejected',
--             record?: jsonb, error?: text, op_id: uuid }
-- Guarantees:
--   * idempotency  — op_id replays return the stored result (duplicate)
--   * CAS          — p_base_version must match the stored version (conflict)
--   * state machine— only DRAFT invoices can finalize (else conflict)
--   * membership   — actor must be a member with role >= MEMBER
--   * server math  — totals recomputed from payload items/charges (CANON §4);
--                    client numbers are overwritten, items replaced atomically
--   * numbering    — real number allocated via allocate_document_number()
--   * audit        — change_log row + audit_logs(FINALIZE) + processed_ops
-- Run inside a transaction (Edge Function); exceptions roll everything back.
-- -----------------------------------------------------------------------------
create or replace function public.sync_finalize_invoice(
  p_op_id        uuid,       -- outbox op id (idempotency key)
  p_workspace    uuid,
  p_invoice_id   uuid,
  p_base_version integer,    -- optimistic concurrency (client base_version)
  p_payload      jsonb,      -- full record: fields + items[] + charges[]
  p_actor        uuid default null,  -- falls back to auth.uid() (JWT context)
  p_device_id    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invoice     public.invoices%rowtype;
  v_role        text;
  v_actor       uuid;
  v_record      jsonb;
  v_result      jsonb;
  v_number      text;
  v_fy          text;
  v_tax_mode    text;
  v_price_tax   boolean;
  v_round_off_on boolean;
  v_invoice_date date;
  v_due_date     date;

  -- per-item working values
  v_item        jsonb;
  v_item_id     uuid;
  v_items       jsonb;
  v_qty         bigint;
  v_price       bigint;
  v_disc_bps    integer;
  v_gst_bps     integer;
  v_gross       bigint;
  v_disc        bigint;
  v_after       bigint;
  v_taxable     bigint;
  v_tax         bigint;
  v_cgst        bigint;
  v_sgst        bigint;
  v_igst        bigint;
  v_line_total  bigint;

  -- document totals
  v_sub_gross   bigint := 0;
  v_disc_total  bigint := 0;
  v_tax_total   bigint := 0;
  v_taxable_tot bigint := 0;
  v_cgst_tot    bigint := 0;
  v_sgst_tot    bigint := 0;
  v_igst_tot    bigint := 0;
  v_ch_tot      bigint := 0;
  v_ch_tax_tot  bigint := 0;
  v_round_off   bigint := 0;
  v_grand       bigint := 0;
  v_grand_raw   bigint := 0;

  -- charges
  v_charges     jsonb;
  v_charge      jsonb;
  v_ch_amt      bigint;
  v_ch_taxable  boolean;
  v_ch_bps      integer;
begin
  ------------------------------------------------------------------ 0) actor
  -- explicit param wins; otherwise resolve from the caller's JWT context
  v_actor := coalesce(p_actor, auth.uid());
  if v_actor is null then
    return jsonb_build_object('status', 'rejected', 'error', 'actor_required', 'op_id', p_op_id);
  end if;

  ------------------------------------------------- 1) idempotency (processed_ops)
  select po.result
    into v_result
    from public.processed_ops po
   where po.op_id = p_op_id;
  if v_result is not null then
    return jsonb_build_object('status', 'duplicate', 'result', v_result, 'op_id', p_op_id);
  end if;

  ------------------------------------------------------- 2) membership + role
  select m.role
    into v_role
    from public.workspace_members m
   where m.workspace_id = p_workspace
     and m.user_id      = v_actor;

  if v_role is null or v_role = 'VIEWER' then
    return jsonb_build_object('status', 'rejected', 'error', 'forbidden', 'op_id', p_op_id);
  end if;

  ------------------------------------------------- 3) load invoice + CAS/state
  select i.* into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.workspace_id = p_workspace;

  if not found then
    return jsonb_build_object('status', 'rejected', 'error', 'not_found', 'op_id', p_op_id);
  end if;

  if p_base_version is not null and p_base_version <> v_invoice.version then
    -- CANON §10 #4: two devices finalize the same document → first wins
    select to_jsonb(i) into v_record from public.invoices i
     where i.id = p_invoice_id;
    return jsonb_build_object('status', 'conflict', 'error', 'base_version_mismatch',
                              'record', v_record, 'op_id', p_op_id);
  end if;

  if v_invoice.status <> 'DRAFT' then
    -- FINALIZED/PAID/CANCELLED documents are immutable (CANON §12)
    select to_jsonb(i) into v_record from public.invoices i
     where i.id = p_invoice_id;
    return jsonb_build_object('status', 'conflict', 'error', 'not_draft',
                              'record', v_record, 'op_id', p_op_id);
  end if;

  ------------------------------------------------------- 4) header from payload
  v_invoice_date := coalesce((p_payload->>'invoice_date')::date, v_invoice.invoice_date);
  if v_invoice_date is null then
    return jsonb_build_object('status', 'rejected', 'error', 'invoice_date_required', 'op_id', p_op_id);
  end if;
  v_due_date := coalesce((p_payload->>'due_date')::date, v_invoice.due_date);

  -- workspace config (company profile) with document/invoice fallbacks
  select cp.enable_round_off into v_round_off_on
    from public.company_profiles cp
   where cp.workspace_id = p_workspace and cp.deleted_at is null
   order by cp.created_at
   limit 1;
  v_round_off_on := coalesce(v_round_off_on, true);

  select cp.price_includes_tax into v_price_tax
    from public.company_profiles cp
   where cp.workspace_id = p_workspace and cp.deleted_at is null
   order by cp.created_at
   limit 1;
  v_price_tax := coalesce(
    (p_payload->>'price_includes_tax')::boolean,
    v_invoice.price_includes_tax,
    v_price_tax,
    false);

  -- tax mode: payload → existing snapshot → derive from company state vs POS
  v_tax_mode := coalesce(p_payload->>'tax_mode', v_invoice.tax_mode);
  if v_tax_mode is null then
    select case when cp.state_code = coalesce(p_payload->>'place_of_supply_code',
                                              v_invoice.place_of_supply_code)
                then 'INTRA' else 'INTER' end
      into v_tax_mode
      from public.company_profiles cp
     where cp.workspace_id = p_workspace and cp.deleted_at is null
     order by cp.created_at
     limit 1;
  end if;
  v_tax_mode := coalesce(v_tax_mode, 'INTRA');  -- documented conservative default

  ------------------------------------------------ 5) recompute totals (§4)
  if jsonb_typeof(coalesce(p_payload->'items', 'null'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0 then
    return jsonb_build_object('status', 'rejected', 'error', 'items_required', 'op_id', p_op_id);
  end if;

  -- items are replaced atomically (server is the source of truth for totals)
  delete from public.invoice_items
   where invoice_id = p_invoice_id and workspace_id = p_workspace;

  v_items := '[]'::jsonb;
  for v_item in select * from jsonb_array_elements(p_payload->'items')
  loop
    v_qty      := coalesce((v_item->>'qty_milli')::bigint, 0);
    v_price    := coalesce((v_item->>'unit_price_paise')::bigint, 0);
    v_disc_bps := coalesce((v_item->>'discount_bps')::integer, 0);
    v_gst_bps  := coalesce((v_item->>'gst_rate_bps')::integer, 0);

    -- 1) gross = roundHalfUp(qty_milli * unit_price / 1000)
    v_gross := public.round_half_up(v_qty::numeric * v_price / 1000);
    -- 2) discount; grossAfterDisc
    v_disc  := public.round_half_up(v_gross::numeric * v_disc_bps / 10000);
    v_after := v_gross - v_disc;
    -- 3) exclusive vs inclusive pricing
    if v_price_tax then
      v_taxable := public.round_half_up(v_after::numeric * 10000 / (10000 + v_gst_bps));
      v_tax     := v_after - v_taxable;
    else
      v_taxable := v_after;
      v_tax     := public.round_half_up(v_taxable::numeric * v_gst_bps / 10000);
    end if;
    -- 4) intra: CGST+SGST (odd paise → SGST); inter: IGST
    if v_tax_mode = 'INTER' then
      v_cgst := 0; v_sgst := 0; v_igst := v_tax;
    else
      v_cgst := public.round_half_up(v_tax::numeric / 2);
      v_sgst := v_tax - v_cgst;
      v_igst := 0;
    end if;
    v_line_total := v_taxable + v_cgst + v_sgst + v_igst;

    insert into public.invoice_items (
      id, workspace_id, invoice_id, position,
      description, hsn_sac, qty_milli, unit, unit_price_paise,
      discount_bps, gst_rate_bps,
      gross_paise, discount_paise, taxable_paise,
      cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise,
      price_includes_tax, origin_device_id
    ) values (
      v_item_id, p_workspace, p_invoice_id,
      coalesce((v_item->>'position')::integer, 0),
      v_item->>'description', v_item->>'hsn_sac',
      v_qty, v_item->>'unit', v_price,
      v_disc_bps, v_gst_bps,
      v_gross, v_disc, v_taxable,
      v_cgst, v_sgst, v_igst, v_tax, v_line_total,
      v_price_tax, p_device_id
    );

    v_sub_gross   := v_sub_gross   + v_gross;
    v_disc_total  := v_disc_total  + v_disc;
    v_taxable_tot := v_taxable_tot + v_taxable;
    v_tax_total   := v_tax_total   + v_tax;
    v_cgst_tot    := v_cgst_tot    + v_cgst;
    v_sgst_tot    := v_sgst_tot    + v_sgst;
    v_igst_tot    := v_igst_tot    + v_igst;

    -- server-computed snapshot goes into the returned record (client adopts it)
    v_item_id := gen_random_uuid();
    v_items := v_items || jsonb_build_object(
      'id', v_item_id,
      'invoice_id', p_invoice_id,
      'workspace_id', p_workspace,
      'position', coalesce((v_item->>'position')::integer, 0),
      'description', v_item->>'description',
      'hsn_sac', v_item->>'hsn_sac',
      'qty_milli', v_qty,
      'unit', v_item->>'unit',
      'unit_price_paise', v_price,
      'discount_bps', v_disc_bps,
      'gst_rate_bps', v_gst_bps,
      'gross_paise', v_gross,
      'discount_paise', v_disc,
      'taxable_paise', v_taxable,
      'cgst_paise', v_cgst,
      'sgst_paise', v_sgst,
      'igst_paise', v_igst,
      'tax_paise', v_tax,
      'total_paise', v_line_total,
      'price_includes_tax', v_price_tax
    );
  end loop;

  -- additional charges: each {id,label,amount_paise,taxable,gst_rate_bps}
  v_charges := coalesce(p_payload->'charges', '[]'::jsonb);
  if jsonb_typeof(v_charges) = 'array' then
    for v_charge in select * from jsonb_array_elements(v_charges)
    loop
      v_ch_amt     := coalesce((v_charge->>'amount_paise')::bigint, 0);
      v_ch_taxable := coalesce((v_charge->>'taxable')::boolean, false);
      v_ch_bps     := coalesce((v_charge->>'gst_rate_bps')::integer, 0);
      v_ch_tot     := v_ch_tot + v_ch_amt;
      if v_ch_taxable and v_ch_amt > 0 then
        v_ch_tax_tot := v_ch_tax_tot +
                        public.round_half_up(v_ch_amt::numeric * v_ch_bps / 10000);
      end if;
    end loop;
  end if;

  -- grand total + round-off (half-up to the rupee: floor((x+50)/100)*100)
  v_grand_raw := v_taxable_tot + v_cgst_tot + v_sgst_tot + v_igst_tot
               + v_ch_tot + v_ch_tax_tot;
  if v_round_off_on then
    v_grand     := ((v_grand_raw + 50) / 100) * 100;
    v_round_off := v_grand - v_grand_raw;
  else
    v_grand     := v_grand_raw;
    v_round_off := 0;
  end if;

  ------------------------------------------------------ 6) allocate the number
  v_fy     := public.fiscal_year_of(v_invoice_date);
  v_number := public.allocate_document_number(p_workspace, 'INVOICE', v_fy);

  ------------------------------------------------------- 7) finalize the header
  update public.invoices set
    number                  = v_number,
    status                  = 'FINALIZED',
    invoice_date            = v_invoice_date,
    due_date                = v_due_date,
    customer_id             = coalesce((p_payload->>'customer_id')::uuid, v_invoice.customer_id),
    customer_name_snapshot  = coalesce(p_payload->>'customer_name_snapshot',   v_invoice.customer_name_snapshot),
    customer_gstin_snapshot = coalesce(p_payload->>'customer_gstin_snapshot',  v_invoice.customer_gstin_snapshot),
    place_of_supply_code    = coalesce(p_payload->>'place_of_supply_code',     v_invoice.place_of_supply_code),
    tax_mode                = v_tax_mode,
    price_includes_tax      = v_price_tax,
    subtotal_gross_paise    = v_sub_gross,
    discount_total_paise    = v_disc_total,
    taxable_total_paise     = v_taxable_tot,
    cgst_paise              = v_cgst_tot,
    sgst_paise              = v_sgst_tot,
    igst_paise              = v_igst_tot,
    charges_total_paise     = v_ch_tot,
    charges_tax_paise       = v_ch_tax_tot,
    round_off_paise         = v_round_off,
    grand_total_paise       = v_grand,
    charges                 = coalesce(p_payload->'charges', v_invoice.charges),
    notes                   = coalesce(p_payload->>'notes', v_invoice.notes),
    terms                   = coalesce(p_payload->>'terms', v_invoice.terms),
    finalized_at            = now(),
    version                 = v_invoice.version + 1,
    origin_device_id        = coalesce(p_device_id, v_invoice.origin_device_id),
    updated_at              = now()
  where id = p_invoice_id
    and workspace_id = p_workspace;

  if not found then
    raise exception 'finalize update affected no rows (concurrent delete?)'
      using errcode = '40001';  -- caller transaction retries
  end if;

  ----------------------------------------------------------- 8) feed + audit
  select to_jsonb(i) into v_record
    from public.invoices i
   where i.id = p_invoice_id and i.workspace_id = p_workspace;
  v_record := jsonb_set(v_record, '{items}', v_items, true);

  insert into public.change_log (workspace_id, entity, entity_id, op, payload)
  values (p_workspace, 'invoice', p_invoice_id, 'finalize', v_record);

  insert into public.audit_logs
    (workspace_id, actor_user_id, entity_type, entity_id, action, detail, device_id, at)
  values
    (p_workspace, v_actor, 'invoice', p_invoice_id, 'FINALIZE',
     jsonb_build_object('number', v_number, 'fiscal_year', v_fy,
                        'grand_total_paise', v_grand,
                        'base_version', p_base_version),
     p_device_id, now());

  ------------------------------------------------------------- 9) idempotency
  v_result := jsonb_build_object('status', 'applied', 'record', v_record, 'op_id', p_op_id);
  insert into public.processed_ops (op_id, workspace_id, result)
  values (p_op_id, p_workspace, v_result);

  return v_result;
end;
$$;

comment on function public.sync_finalize_invoice(uuid, uuid, uuid, integer, jsonb, uuid, text) is
  'Finalize push op: idempotent (processed_ops), CAS on base_version, DRAFT-only, role >= MEMBER, recomputes all totals from payload (CANON §4), allocates the real number, replaces items atomically, appends change_log + audit_logs. Called by the sync-push Edge Function.';

revoke execute on function public.sync_finalize_invoice(uuid, uuid, uuid, integer, jsonb, uuid, text)
  from public, anon, authenticated;
grant  execute on function public.sync_finalize_invoice(uuid, uuid, uuid, integer, jsonb, uuid, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- handle_new_user — CANON §11: on signup create
--   1. profiles row (display_name from metadata/email)
--   2. a personal workspace ('ws-<user12>')
--   3. OWNER membership for the user
-- SECURITY DEFINER: runs as the table owner so it can insert into
-- workspaces/workspace_members, which have no client INSERT policies.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_workspace uuid;
  v_slug      text;
  v_name      text;
begin
  v_name := coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'full_name',
    split_part(coalesce(new.email, 'user'), '@', 1));

  -- 1) profile (idempotent on re-runs)
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, v_name, new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  -- 2) personal workspace; user-id-derived slug, suffix on the (near-impossible)
  --    collision so the trigger never fails a signup
  v_workspace := gen_random_uuid();
  v_slug := 'ws-' || left(replace(new.id::text, '-', ''), 12);
  if exists (select 1 from public.workspaces w where w.slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  end if;

  insert into public.workspaces (id, name, slug, owner_user_id, settings)
  values (v_workspace, coalesce(new.raw_user_meta_data->>'workspace_name', 'My Workspace'),
          v_slug, new.id, '{}'::jsonb);

  -- 3) OWNER membership
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace, new.id, 'OWNER')
  on conflict (workspace_id, user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger on auth.users INSERT: creates the profile row, a personal workspace, and the OWNER membership (CANON §11).';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
