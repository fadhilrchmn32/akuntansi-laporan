-- ==============================================================================
-- FINOPS_SHARED_V1 — UAT SYNTHETIC DATA SEED (TESTING / STAGING ONLY)
-- PERINGATAN: JANGAN jalankan script ini di database produksi!
-- Script ini terpisah sepenuhnya dari migrasi produksi (0005-0008).
-- Semua data bersifat SINTETIS untuk pengujian UAT lintas App 1, App 2, App 3.
-- ==============================================================================

BEGIN;

-- 1. Perusahaan & Cabang Sintetis
INSERT INTO public.companies (id, code, name, legal_name, base_currency, timezone, is_active)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'UAT-DIST',
  'PT Distribusi Nusantara (DATA SINTETIS UAT)',
  'PT Distribusi Nusantara Tbk (Sintetis)',
  'IDR',
  'Asia/Jakarta',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.branches (id, company_id, code, name, is_headquarters, is_active)
VALUES
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111', 'JKT-01', 'Cabang Pusat Jakarta', true, true),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111111', 'BDG-01', 'Cabang Bandung', false, true)
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO public.app_settings (company_id, app1_url, app2_url, app3_url, auto_post_enabled)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'https://app1-uat.example.local',
  'https://app2-uat.example.local',
  'https://app3-uat.example.local',
  false
)
ON CONFLICT (company_id) DO NOTHING;

-- 2. Bagan Akun (Chart of Accounts) UAT
INSERT INTO public.chart_of_accounts (
  company_id, code, name, account_group, normal_balance, is_active, is_postable,
  is_control_account, control_subledger, cash_flow_default, is_cash_component
)
VALUES
  ('11111111-1111-4111-8111-111111111111', '1101', 'Kas Kantor', 'asset', 'debit', true, true, false, NULL, 'operating', true),
  ('11111111-1111-4111-8111-111111111111', '1102', 'Kas di Penagih', 'asset', 'debit', true, true, true, 'custody', 'operating', true),
  ('11111111-1111-4111-8111-111111111111', '1103', 'Bank Perusahaan', 'asset', 'debit', true, true, false, NULL, 'operating', true),
  ('11111111-1111-4111-8111-111111111111', '1104', 'Piutang Usaha', 'asset', 'debit', true, true, true, 'ar', 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '1105', 'Persediaan Barang Dagang', 'asset', 'debit', true, true, true, 'inventory', 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '1106', 'Uang Muka Pembelian / Prepaid', 'asset', 'debit', true, true, false, NULL, 'operating', false),
  ('11111111-1111-4111-8111-111111111111', '1107', 'Pajak Masukan Dapat Dikreditkan', 'asset', 'debit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '1201', 'Aset Tetap', 'asset', 'debit', true, true, false, NULL, 'investing', false),
  ('11111111-1111-4111-8111-111111111111', '1202', 'Akumulasi Penyusutan Aset Tetap', 'asset', 'credit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '2101', 'Utang Usaha Pemasok', 'liability', 'credit', true, true, true, 'ap', 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '2102', 'Uang Muka / Titipan Pelanggan', 'liability', 'credit', true, true, true, 'customer_deposit', 'operating', false),
  ('11111111-1111-4111-8111-111111111111', '2103', 'Penerimaan Belum Teridentifikasi', 'liability', 'credit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '2105', 'Utang Pajak Keluaran', 'liability', 'credit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '2106', 'GRNI (Barang Diterima Belum Ditagih)', 'liability', 'credit', true, true, true, 'grni', 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '2107', 'Utang Biaya / Beban Akrual', 'liability', 'credit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '2108', 'Deposit Wadah Pelanggan', 'liability', 'credit', true, true, false, NULL, 'operating', false),
  ('11111111-1111-4111-8111-111111111111', '2201', 'Utang Pinjaman', 'liability', 'credit', true, true, false, NULL, 'financing', false),
  ('11111111-1111-4111-8111-111111111111', '3101', 'Modal Disetor', 'equity', 'credit', true, true, false, NULL, 'financing', false),
  ('11111111-1111-4111-8111-111111111111', '3102', 'Saldo Laba', 'equity', 'credit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '3103', 'Prive / Distribusi Pemilik', 'equity', 'debit', true, true, false, NULL, 'financing', false),
  ('11111111-1111-4111-8111-111111111111', '4101', 'Penjualan Bruto', 'revenue', 'credit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '4102', 'Retur & Potongan Penjualan', 'revenue', 'debit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '5101', 'Harga Pokok Penjualan (HPP)', 'cogs', 'debit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '6101', 'Beban Gaji & Operasional Kantor', 'expense', 'debit', true, true, false, NULL, 'operating', false),
  ('11111111-1111-4111-8111-111111111111', '6102', 'Beban Pengiriman & BBM', 'expense', 'debit', true, true, false, NULL, 'operating', false),
  ('11111111-1111-4111-8111-111111111111', '6109', 'Beban Administrasi Bank', 'expense', 'debit', true, true, false, NULL, 'operating', false),
  ('11111111-1111-4111-8111-111111111111', '6201', 'Beban Penyusutan Aset Tetap', 'expense', 'debit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '6301', 'Beban Selisih Kas Disahkan', 'expense', 'debit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '6401', 'Beban Bunga Pinjaman', 'expense', 'debit', true, true, false, NULL, 'operating', false),
  ('11111111-1111-4111-8111-111111111111', '6501', 'Beban Pajak Penghasilan', 'expense', 'debit', true, true, false, NULL, 'operating', false),
  ('11111111-1111-4111-8111-111111111111', '6901', 'Selisih Pembulatan', 'expense', 'debit', true, true, false, NULL, 'non_cash', false),
  ('11111111-1111-4111-8111-111111111111', '7101', 'Pendapatan Bunga Bank', 'revenue', 'credit', true, true, false, NULL, 'operating', false)
ON CONFLICT (company_id, code) DO NOTHING;

-- 3. Kebijakan Akuntansi (Sengaja "Belum ditetapkan" untuk SAK & Pajak sesuai kontrak)
INSERT INTO public.accounting_policies (
  company_id, reporting_framework_name, reporting_framework_status, tax_policy_status,
  fiscal_year_start_month, cutover_date, is_midyear_cutover, ytd_hist_status,
  cogs_method, cogs_method_approved, revenue_recognition_policy, rounding_precision,
  rounding_mode, rounding_coa_code, cash_components_approved, allow_auto_post_deterministic,
  unknown_cash_materiality_limit, opening_status
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  NULL,
  'unconfigured',
  'unconfigured',
  1,
  DATE '2026-10-31',
  true,
  'pending',
  'moving_weighted_average',
  true,
  'on_confirmed_delivery_date',
  0,
  'half_up',
  '6901',
  true,
  false,
  500000.00,
  'approved'
)
ON CONFLICT (company_id) DO NOTHING;

-- 4. Periode Fiskal
INSERT INTO public.fiscal_periods (id, company_id, period_code, start_date, end_date, status, version)
VALUES
  ('33333333-3333-4333-8333-333333333010', '11111111-1111-4111-8111-111111111111', '2026-10', DATE '2026-10-01', DATE '2026-10-31', 'closed', 1),
  ('33333333-3333-4333-8333-333333333011', '11111111-1111-4111-8111-111111111111', '2026-11', DATE '2026-11-01', DATE '2026-11-30', 'open', 1)
ON CONFLICT (company_id, period_code) DO NOTHING;

-- 5. Rekening Dana, Pelanggan, Pemasok, Produk
INSERT INTO public.fund_accounts (id, company_id, branch_id, code, name, account_type, bank_name, account_number, coa_account_code, is_active)
VALUES
  ('44444444-4444-4444-8444-444444444001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', 'KAS-PST', 'Kas Kantor Pusat', 'office_cash', NULL, NULL, '1101', true),
  ('44444444-4444-4444-8444-444444444002', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', 'BCA-8890', 'BCA Giro Operasional', 'bank', 'BCA', '889-0112-345', '1103', true)
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO public.customers (id, company_id, branch_id, cust_id, name, is_active)
VALUES
  ('55555555-5555-4555-8555-555555555001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', '00104', 'Toko Sinar Makmur', true),
  ('55555555-5555-4555-8555-555555555002', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', '00209', 'UD Berkah Jaya', true)
ON CONFLICT (company_id, cust_id) DO NOTHING;

INSERT INTO public.suppliers (id, company_id, supplier_code, name, is_active)
VALUES
  ('66666666-6666-4666-8666-666666666001', '11111111-1111-4111-8111-111111111111', 'SUP-001', 'PT Sumber Pangan Utama', true),
  ('66666666-6666-4666-8666-666666666002', '11111111-1111-4111-8111-111111111111', 'SUP-002', 'CV Logam Kemasan Abadi', true)
ON CONFLICT (company_id, supplier_code) DO NOTHING;

INSERT INTO public.products (id, company_id, sku, name, base_unit, product_type, is_stocked, is_active)
VALUES
  ('77777777-7777-4777-8777-777777777001', '11111111-1111-4111-8111-111111111111', 'BRS-PREM-5KG', 'Beras Premium 5 Kg', 'SAK', 'stocked', true, true),
  ('77777777-7777-4777-8777-777777777002', '11111111-1111-4111-8111-111111111111', 'GLA-KRS-1KG', 'Gula Kristal 1 Kg', 'PCS', 'stocked', true, true),
  ('77777777-7777-4777-8777-777777777003', '11111111-1111-4111-8111-111111111111', 'MYK-GRG-5L', 'Minyak Goreng 5 Liter (Stok Kosong UAT)', 'JERIGEN', 'stocked', true, true)
ON CONFLICT (company_id, sku) DO NOTHING;

INSERT INTO public.product_units (company_id, product_id, unit_code, conversion_factor)
VALUES
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777001', 'SAK', 1),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777002', 'PCS', 1),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777002', 'DUS', 24),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777003', 'JERIGEN', 1)
ON CONFLICT (product_id, unit_code) DO NOTHING;

-- 6. Saldo Awal & Valuasi Stok Cutover (31/10/2026) — Total Debit = Total Kredit = Rp 255.000.000
INSERT INTO public.opening_balances (company_id, branch_id, as_of_date, coa_code, debit, credit, status)
VALUES
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '1101', 10000000.00, 0, 'approved'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '1103', 120000000.00, 0, 'approved'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '1104', 25000000.00, 0, 'approved'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '1105', 50000000.00, 0, 'approved'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '1201', 60000000.00, 0, 'approved'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '1202', 0, 10000000.00, 'approved'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '2101', 0, 15000000.00, 'approved'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '2201', 0, 40000000.00, 'approved'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '3101', 0, 180000000.00, 'approved'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', DATE '2026-10-31', '3102', 0, 20000000.00, 'approved');

INSERT INTO public.inventory_valuations (company_id, branch_id, product_id, qty_on_hand, avg_unit_cost, total_value)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222201',
  '77777777-7777-4777-8777-777777777001',
  1000.000000,
  50000.000000,
  50000000.00
)
ON CONFLICT (company_id, branch_id, product_id) DO NOTHING;

-- Jurnal Saldo Awal Cutover
INSERT INTO public.journal_entries (
  id, company_id, branch_id, journal_number, accounting_date, effective_date,
  description, status, total_debit, total_credit, source_type, journal_type, fiscal_period_id, posted_at
)
VALUES (
  '88888888-8888-4888-8888-888888888001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222201',
  'OPN-202610-0001',
  DATE '2026-10-31',
  DATE '2026-10-31',
  'Saldo Awal Cutover UAT per 31/10/2026',
  'posted',
  255000000.00,
  255000000.00,
  'opening_balance',
  'opening',
  '33333333-3333-4333-8333-333333333010',
  now()
)
ON CONFLICT (company_id, journal_number) DO NOTHING;

INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, cash_flow_category)
VALUES
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 1, '1101', 10000000.00, 0, 'Saldo awal Kas Kantor', '22222222-2222-4222-8222-222222222201', 'non_cash'),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 2, '1103', 120000000.00, 0, 'Saldo awal Bank BCA', '22222222-2222-4222-8222-222222222201', 'non_cash'),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 3, '1104', 25000000.00, 0, 'Saldo awal Piutang Usaha', '22222222-2222-4222-8222-222222222201', 'non_cash'),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 4, '1105', 50000000.00, 0, 'Saldo awal Persediaan (1000 SAK Beras)', '22222222-2222-4222-8222-222222222201', 'non_cash'),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 5, '1201', 60000000.00, 0, 'Saldo awal Aset Tetap', '22222222-2222-4222-8222-222222222201', 'non_cash'),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 6, '1202', 0, 10000000.00, 'Akumulasi Penyusutan awal', '22222222-2222-4222-8222-222222222201', 'non_cash'),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 7, '2101', 0, 15000000.00, 'Utang Usaha awal', '22222222-2222-4222-8222-222222222201', 'non_cash'),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 8, '2201', 0, 40000000.00, 'Pinjaman Bank BCA awal', '22222222-2222-4222-8222-222222222201', 'non_cash'),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 9, '3101', 0, 180000000.00, 'Modal Disetor awal', '22222222-2222-4222-8222-222222222201', 'non_cash'),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888001', 10, '3102', 0, 20000000.00, 'Saldo Laba awal', '22222222-2222-4222-8222-222222222201', 'non_cash')
ON CONFLICT (journal_entry_id, line_no) DO NOTHING;

-- 7. Aset Tetap, Pinjaman, Kode Pajak Non-Aktif
INSERT INTO public.fixed_assets (
  id, company_id, branch_id, asset_code, name, acquisition_date, ready_to_use_date,
  cost, residual_value, useful_life_months, accumulated_depreciation, location, status
)
VALUES (
  '99999999-9999-4999-8999-999999999001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222201',
  'AST-001',
  'Truk Box Engkel HINO (UAT)',
  DATE '2025-12-20',
  DATE '2026-01-01',
  60000000.00,
  0,
  60,
  10000000.00,
  'Pool Jakarta',
  'active'
)
ON CONFLICT (company_id, asset_code) DO NOTHING;

INSERT INTO public.loans (
  id, company_id, branch_id, loan_number, lender_name, disbursement_date,
  principal_amount, outstanding_principal, annual_interest_rate, fund_account_id, status
)
VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222201',
  'LON-2026-001',
  'Bank BCA Kredit Modal Kerja',
  DATE '2026-01-15',
  40000000.00,
  40000000.00,
  0.095000,
  '44444444-4444-4444-8444-444444444002',
  'active'
)
ON CONFLICT (company_id, loan_number) DO NOTHING;

INSERT INTO public.tax_codes (company_id, code, name, rate, effective_date, tax_mode, is_recoverable, direction, coa_code, is_active)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'PPN-OUT-11',
  'PPN Keluaran (Non-Aktif s.d. Konfirmasi PKP)',
  0.110000,
  DATE '2026-01-01',
  'exclusive',
  false,
  'output',
  '2105',
  false
)
ON CONFLICT (company_id, code) DO NOTHING;

-- 8. Event Lintas App 1 & App 2 di Outbox (untuk uji worker & antrian)
INSERT INTO public.accounting_events (
  id, company_id, branch_id, event_type, source_type, source_id, source_version,
  effective_date, payload_snapshot, mapping_version, processing_status, error_message
)
VALUES
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222201',
    'internal_fund_transfer_approved',
    'cash_transfer',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc001',
    1,
    DATE '2026-11-14',
    jsonb_build_object(
      'transfer_number', 'TRF-INT-202611-0001',
      'from_fund_account_id', '44444444-4444-4444-8444-444444444001',
      'to_fund_account_id', '44444444-4444-4444-8444-444444444002',
      'amount', '4000000.00'
    ),
    'v1',
    'waiting_accounting_module',
    NULL
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222201',
    'sales_delivery_recognized',
    'sales_document',
    'cccccccc-cccc-4ccc-8ccc-ccccccccc002',
    1,
    DATE '2026-11-12',
    jsonb_build_object(
      'doc_number', 'INV-202611-0002',
      'customer_id', '55555555-5555-4555-8555-555555555002',
      'total_amount', '4500000.00',
      'cogs_amount', '0.00',
      'has_stocked_items', true
    ),
    'v1',
    'failed',
    'HPP barang stok belum tersedia atau bernilai nol (Minyak Goreng 5L stok 0).'
  )
ON CONFLICT (company_id, event_type, source_id, source_version) DO NOTHING;

COMMIT;

-- CATATAN PENGUJIAN USER SUPABASE AUTH (UAT):
-- Setelah membuat user test di Supabase Auth Dashboard (mis. accountant@uat.local & approver@uat.local),
-- masukkan baris ke public.profiles dan public.memberships agar dapat login ke App 3 Live Mode.
