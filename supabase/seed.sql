-- =============================================================================
-- InvoiceFlow — supabase/seed.sql
--
-- DEV ONLY — do not run in production.
--
-- Development sample data (CANON §15 onboarding "Load sample data" parity):
--   * 1 demo workspace  : Acme Traders (Demo), slug 'acme-traders-demo'
--   * 1 company profile : Acme Traders Pvt Ltd — Maharashtra (state code 27)
--   * 1 device membership row (guest-style OWNER, user_id NULL — resolved at
--     workspace claim time per CANON §11)
--   * 3 customers       : 2 intra-state (Maharashtra 27), 1 inter-state (Karnataka 29)
--   * 4 products        : GST rates 5% / 12% / 18% (bps: 500 / 1200 / 1800)
--   * 2 tax rates       : 'GST 5%' (500), 'GST 18%' (1800)
--   * 1 document_sequence: INVOICE / FY 2025-26 / next_seq 1
--
-- The whole script is wrapped in a DO block and is idempotent: re-running it
-- never duplicates or overwrites existing rows (fixed UUIDs + ON CONFLICT).
-- Applied automatically by `supabase db reset` in local development; NEVER
-- against a production database (guard: skip when the slug already exists).
-- =============================================================================

DO $$
DECLARE
  -- fixed, readable UUIDs so the seed is deterministic and re-runnable
  v_ws      uuid := '00000000-0000-0000-0000-000000000001';
  v_company uuid := '00000000-0000-0000-0000-000000000002';
  v_member  uuid := '00000000-0000-0000-0000-000000000003';
  v_c1      uuid := '00000000-0000-0000-0000-0000000000a1';  -- intra (27)
  v_c2      uuid := '00000000-0000-0000-0000-0000000000a2';  -- intra (27)
  v_c3      uuid := '00000000-0000-0000-0000-0000000000a3';  -- inter (29)
  v_p1      uuid := '00000000-0000-0000-0000-0000000000b1';  -- 5%
  v_p2      uuid := '00000000-0000-0000-0000-0000000000b2';  -- 12%
  v_p3      uuid := '00000000-0000-0000-0000-0000000000b3';  -- 18%
  v_p4      uuid := '00000000-0000-0000-0000-0000000000b4';  -- 18%
  v_t1      uuid := '00000000-0000-0000-0000-0000000000c1';
  v_t2      uuid := '00000000-0000-0000-0000-0000000000c2';
BEGIN
  ---------------------------------------------------------------- guard ------
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE slug = 'acme-traders-demo') THEN
    RAISE NOTICE 'seed.sql: demo workspace already present — skipping (DEV ONLY seed).';
    RETURN;
  END IF;

  ------------------------------------------------------------- workspace -----
  INSERT INTO public.workspaces (id, name, slug, owner_user_id, settings)
  VALUES (v_ws, 'Acme Traders (Demo)', 'acme-traders-demo', NULL,
          '{"theme":"system","enable_round_off":true}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- guest-style device membership (OWNER). user_id NULL: claimed later via
  -- POST /api/workspace/claim equivalent in production (CANON §11).
  INSERT INTO public.workspace_members (id, workspace_id, user_id, device_id, role)
  VALUES (v_member, v_ws, NULL, 'demo-device-0001', 'OWNER')
  ON CONFLICT (id) DO NOTHING;

  --------------------------------------------------------- company profile ---
  INSERT INTO public.company_profiles (
    id, workspace_id, name, business_type,
    address_line1, address_line2, city, state_name, state_code, pincode,
    gstin, pan, phone, email, website,
    bank_name, bank_account, bank_ifsc, bank_branch,
    authorized_signatory,
    invoice_prefix, quotation_prefix,
    default_gst_rate_bps, price_includes_tax, enable_round_off,
    default_terms, default_notes
  ) VALUES (
    v_company, v_ws,
    'Acme Traders Pvt Ltd', 'Private Limited',
    '12, M.G. Road', 'Near Shaniwar Wada', 'Pune', 'Maharashtra', '27', '411001',
    '27ABCDE1234F1Z5', 'ABCDE1234F', '+91 98200 12345', 'billing@acmetraders.example', 'https://acmetraders.example',
    'HDFC Bank', '50200012345678', 'HDFC0000123', 'Pune Camp Branch',
    'Rohit Sharma, Director',
    'INV', 'QT',
    1800, false, true,
    'Payment due within 15 days of invoice date. Interest @18% p.a. on overdue amounts.',
    'Thank you for your business!'
  ) ON CONFLICT (id) DO NOTHING;

  ------------------------------------------------------------- customers -----
  -- intra-state #1 (Maharashtra, GSTIN starts 27) → CGST+SGST
  INSERT INTO public.customers (
    id, workspace_id, code, type, business_name, contact_person,
    email, phone, gstin, billing_address, shipping_address,
    state_name, state_code, notes
  ) VALUES (
    v_c1, v_ws, 'CUS-0001', 'BUSINESS', 'Sharma Stationers', 'Anil Sharma',
    'anil@sharmastationers.example', '+91 98200 22222', '27AAECS1234F1ZQ',
    '45, Laxmi Road, Pune, Maharashtra 411002', '45, Laxmi Road, Pune, Maharashtra 411002',
    'Maharashtra', '27', 'Net 15 days; prefers UPI.'
  ) ON CONFLICT (id) DO NOTHING;

  -- intra-state #2 (Maharashtra, individual — no GSTIN)
  INSERT INTO public.customers (
    id, workspace_id, code, type, business_name, contact_person,
    email, phone, gstin, billing_address,
    state_name, state_code, notes
  ) VALUES (
    v_c2, v_ws, 'CUS-0002', 'INDIVIDUAL', 'Meenal Kulkarni', 'Meenal Kulkarni',
    'meenal.k@example.com', '+91 98200 33333', NULL,
    '7, Koregaon Park, Pune, Maharashtra 411001',
    'Maharashtra', '27', 'Walk-in customer.'
  ) ON CONFLICT (id) DO NOTHING;

  -- inter-state (Karnataka, GSTIN starts 29) → IGST
  INSERT INTO public.customers (
    id, workspace_id, code, type, business_name, contact_person,
    email, phone, gstin, billing_address, shipping_address,
    state_name, state_code, notes
  ) VALUES (
    v_c3, v_ws, 'CUS-0003', 'BUSINESS', 'Bangalore Office Supplies Pvt Ltd', 'Priya Nair',
    'accounts@bosupplies.example', '+91 98860 44444', '29AABCB5678G1Z3',
    '301, MG Road, Bengaluru, Karnataka 560001', 'Warehouse 2, Whitefield, Bengaluru 560066',
    'Karnataka', '29', 'Ships interstate; PO required on every invoice.'
  ) ON CONFLICT (id) DO NOTHING;

  -------------------------------------------------------------- products -----
  -- 5% (500 bps)
  INSERT INTO public.products (
    id, workspace_id, name, sku, hsn_sac, description, unit,
    selling_price_paise, cost_price_paise, gst_rate_bps, price_includes_tax, active
  ) VALUES (
    v_p1, v_ws, 'Notebook Ruled 200 Pages', 'NB-200-A', '48202010',
    'A4 single-line ruled notebook, 200 pages', 'NOS',
    7000, 5200, 500, false, true
  ) ON CONFLICT (id) DO NOTHING;

  -- 12% (1200 bps)
  INSERT INTO public.products (
    id, workspace_id, name, sku, hsn_sac, description, unit,
    selling_price_paise, cost_price_paise, gst_rate_bps, price_includes_tax, active
  ) VALUES (
    v_p2, v_ws, 'A4 Copier Paper Ream', 'PP-A4-500', '48025610',
    '75 GSM, 500 sheets per ream', 'PKT',
    24900, 21000, 1200, false, true
  ) ON CONFLICT (id) DO NOTHING;

  -- 18% (1800 bps)
  INSERT INTO public.products (
    id, workspace_id, name, sku, hsn_sac, description, unit,
    selling_price_paise, cost_price_paise, gst_rate_bps, price_includes_tax, active
  ) VALUES (
    v_p3, v_ws, 'Ballpoint Pen Blue', 'PEN-BLU', '96081010',
    '0.7mm ballpoint, box-friendly retail pack', 'NOS',
    1500, 900, 1800, false, true
  ) ON CONFLICT (id) DO NOTHING;

  -- 18% (1800 bps)
  INSERT INTO public.products (
    id, workspace_id, name, sku, hsn_sac, description, unit,
    selling_price_paise, cost_price_paise, gst_rate_bps, price_includes_tax, active
  ) VALUES (
    v_p4, v_ws, 'Stapler Heavy Duty', 'STP-HD-01', '84729030',
    'Full-strip metal stapler, 25 sheets', 'NOS',
    32500, 26000, 1800, false, true
  ) ON CONFLICT (id) DO NOTHING;

  ------------------------------------------------------------- tax rates -----
  INSERT INTO public.tax_rates (id, workspace_id, name, rate_bps, active, effective_from)
  VALUES
    (v_t1, v_ws, 'GST 5%',  500,  true, DATE '2025-04-01'),
    (v_t2, v_ws, 'GST 18%', 1800, true, DATE '2025-04-01')
  ON CONFLICT (id) DO NOTHING;

  ------------------------------------------------------ document sequence ----
  INSERT INTO public.document_sequences (workspace_id, doc_type, fiscal_year, next_seq)
  VALUES (v_ws, 'INVOICE', '2025-26', 1)
  ON CONFLICT (workspace_id, doc_type, fiscal_year) DO NOTHING;

  RAISE NOTICE 'seed.sql: demo workspace ''acme-traders-demo'' seeded (DEV ONLY — do not run in production).';
END
$$;
