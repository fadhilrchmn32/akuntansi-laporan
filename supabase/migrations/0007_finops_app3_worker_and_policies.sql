-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0007: Scheduled Worker & Default COA Template
-- Jalankan sekali pada database bersama. Worker terjadwal mendukung pg_cron
-- atau Supabase Edge Function / Node cron (worker/accounting-worker.ts).
-- ==============================================================================

-- Fungsi helper untuk dipanggil pg_cron (jika ekstensi pg_cron diaktifkan di Supabase)
CREATE OR REPLACE FUNCTION private.cron_process_all_companies()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_comp RECORD;
BEGIN
  FOR v_comp IN SELECT id FROM public.companies WHERE is_active = true LOOP
    PERFORM public.process_accounting_queue(v_comp.id, 100);
  END LOOP;
END;
$$;

-- Dokumentasi aktivasi pg_cron (jalankan manual oleh DBA jika ekstensi pg_cron aktif):
-- SELECT cron.schedule('finops-accounting-worker', '*/2 * * * *', $$SELECT private.cron_process_all_companies();$$);

-- Fungsi seed template Chart of Accounts default (dapat dimodifikasi akuntan sebelum aktivasi)
CREATE OR REPLACE FUNCTION public.initialize_default_coa(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_inserted INTEGER := 0;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  IF NOT private.has_company_role(p_company_id, ARRAY['accountant', 'accounting_approver', 'system_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.chart_of_accounts (company_id, code, name, account_group, normal_balance, is_postable, is_control_account, control_subledger, is_cash_component)
  VALUES
    (p_company_id, '1101', 'Kas Kantor', 'asset', 'debit', true, false, NULL, true),
    (p_company_id, '1102', 'Kas di Penagih', 'asset', 'debit', true, true, 'custody', true),
    (p_company_id, '1103', 'Bank Perusahaan', 'asset', 'debit', true, false, NULL, true),
    (p_company_id, '1104', 'Piutang Usaha', 'asset', 'debit', true, true, 'ar', false),
    (p_company_id, '1105', 'Persediaan Barang Dagang', 'asset', 'debit', true, true, 'inventory', false),
    (p_company_id, '1106', 'Uang Muka Pembelian / Prepaid', 'asset', 'debit', true, false, NULL, false),
    (p_company_id, '1107', 'Pajak Masukan Dapat Dikreditkan', 'asset', 'debit', true, false, NULL, false),
    (p_company_id, '1201', 'Aset Tetap', 'asset', 'debit', true, false, NULL, false),
    (p_company_id, '1202', 'Akumulasi Penyusutan Aset Tetap', 'asset', 'credit', true, false, NULL, false),
    (p_company_id, '2101', 'Utang Usaha Pemasok', 'liability', 'credit', true, true, 'ap', false),
    (p_company_id, '2102', 'Uang Muka / Titipan Pelanggan', 'liability', 'credit', true, true, 'customer_deposit', false),
    (p_company_id, '2103', 'Penerimaan Belum Teridentifikasi', 'liability', 'credit', true, false, NULL, false),
    (p_company_id, '2104', 'Kewajiban Refund Pelanggan', 'liability', 'credit', true, false, NULL, false),
    (p_company_id, '2105', 'Utang Pajak Keluaran', 'liability', 'credit', true, false, NULL, false),
    (p_company_id, '2106', 'GRNI (Barang Diterima Belum Ditagih)', 'liability', 'credit', true, true, 'grni', false),
    (p_company_id, '2107', 'Utang Biaya / Beban Akrual', 'liability', 'credit', true, false, NULL, false),
    (p_company_id, '2108', 'Deposit Wadah Pelanggan', 'liability', 'credit', true, false, NULL, false),
    (p_company_id, '2201', 'Utang Pinjaman', 'liability', 'credit', true, false, NULL, false),
    (p_company_id, '3101', 'Modal Disetor', 'equity', 'credit', true, false, NULL, false),
    (p_company_id, '3102', 'Saldo Laba', 'equity', 'credit', true, false, NULL, false),
    (p_company_id, '3103', 'Prive / Distribusi Pemilik', 'equity', 'debit', true, false, NULL, false),
    (p_company_id, '4101', 'Penjualan Bruto', 'revenue', 'credit', true, false, NULL, false),
    (p_company_id, '4102', 'Retur & Potongan Penjualan', 'revenue', 'debit', true, false, NULL, false),
    (p_company_id, '5101', 'Harga Pokok Penjualan (HPP)', 'cogs', 'debit', true, false, NULL, false),
    (p_company_id, '6101', 'Beban Gaji & Operasional Kantor', 'expense', 'debit', true, false, NULL, false),
    (p_company_id, '6102', 'Beban Pengiriman & BBM', 'expense', 'debit', true, false, NULL, false),
    (p_company_id, '6109', 'Beban Administrasi Bank', 'expense', 'debit', true, false, NULL, false),
    (p_company_id, '6201', 'Beban Penyusutan Aset Tetap', 'expense', 'debit', true, false, NULL, false),
    (p_company_id, '6301', 'Beban Selisih Kas Disahkan', 'expense', 'debit', true, false, NULL, false),
    (p_company_id, '6401', 'Beban Bunga Pinjaman', 'expense', 'debit', true, false, NULL, false),
    (p_company_id, '6901', 'Selisih Pembulatan', 'expense', 'debit', true, false, NULL, false),
    (p_company_id, '7101', 'Pendapatan Bunga Bank', 'revenue', 'credit', true, false, NULL, false)
  ON CONFLICT (company_id, code) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN jsonb_build_object('inserted_accounts', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_default_coa(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initialize_default_coa(UUID) TO authenticated;

INSERT INTO public.schema_migrations (version, description)
VALUES ('0007_finops_app3_worker_and_policies', 'Scheduled worker helper and configurable default Chart of Accounts initializer')
ON CONFLICT (version) DO NOTHING;
