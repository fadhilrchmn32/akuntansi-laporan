-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0006: App 3 Subledger, Inventory COGS, Reporting Views & Realtime
-- Semua view menggunakan security_invoker = true agar RLS berlaku penuh.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RPC: process_accounting_queue (Dipanggil Worker Terjadwal & Tombol Proses Berizin)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_accounting_queue(
  p_company_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_run_id UUID;
  v_ev RECORD;
  v_processed INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  IF v_actor_id IS NOT NULL AND NOT private.has_company_role(p_company_id, ARRAY['accountant', 'accounting_approver', 'system_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak memproses antrean akuntansi.' USING ERRCODE = '42501';
  END IF;

  IF v_actor_id IS NULL THEN
    PERFORM set_config('app3.worker_active', 'true', true);
  END IF;

  INSERT INTO public.worker_runs (company_id, worker_name, status)
  VALUES (p_company_id, 'process_accounting_queue', 'running')
  RETURNING id INTO v_run_id;

  FOR v_ev IN
    SELECT id
    FROM public.accounting_events
    WHERE company_id = p_company_id
      AND processing_status IN ('waiting_accounting_module', 'queued')
    ORDER BY effective_date ASC, created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 200))
  LOOP
    BEGIN
      PERFORM public.post_accounting_event(
        'queue-' || v_ev.id::TEXT || '-' || to_char(now(), 'YYYYMMDDHH24MISS'),
        v_ev.id,
        NULL
      );
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      UPDATE public.accounting_events
      SET processing_status = 'failed',
          error_message = SQLERRM,
          retry_count = retry_count + 1,
          updated_at = now()
      WHERE id = v_ev.id;
    END;
  END LOOP;

  UPDATE public.worker_runs
  SET finished_at = now(),
      processed_count = v_processed,
      failed_count = v_failed,
      status = 'completed'
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'worker_run_id', v_run_id,
    'processed_count', v_processed,
    'failed_count', v_failed
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. RPC: create_manual_journal (Mencegah jurnal manual langsung ke control account)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_manual_journal(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_accounting_date DATE,
  p_effective_date DATE,
  p_description TEXT,
  p_journal_type TEXT, -- 'manual' | 'subledger_adjustment'
  p_lines JSONB,       -- [{coa_code, debit, credit, memo, cash_flow_category, customer_id, supplier_id, product_id, fund_account_id}]
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_je_id UUID;
  v_je_no TEXT;
  v_period_id UUID;
  v_line JSONB;
  v_coa public.chart_of_accounts%ROWTYPE;
  v_line_no INTEGER := 0;
  v_sum_d NUMERIC(20,2) := 0;
  v_sum_c NUMERIC(20,2) := 0;
  v_d NUMERIC(20,2);
  v_c NUMERIC(20,2);
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_manual_journal', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya akuntan berizin yang dapat membuat draft jurnal.' USING ERRCODE = '42501';
  END IF;

  IF p_journal_type NOT IN ('manual', 'subledger_adjustment') THEN
    RAISE EXCEPTION 'Tipe jurnal manual tidak valid.' USING ERRCODE = '22023';
  END IF;

  v_period_id := private.lock_open_fiscal_period(p_company_id, p_accounting_date);

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_coa
    FROM public.chart_of_accounts
    WHERE company_id = p_company_id AND code = (v_line->>'coa_code') AND is_active = true AND is_postable = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Akun % tidak aktif atau tidak dapat diposting.', v_line->>'coa_code' USING ERRCODE = '22023';
    END IF;

    IF v_coa.is_control_account = true AND p_journal_type <> 'subledger_adjustment' THEN
      RAISE EXCEPTION 'Akun kontrol % tidak boleh dijurnal manual langsung. Gunakan alur Jurnal Penyesuaian Subledger.', v_coa.code USING ERRCODE = '42501';
    END IF;

    IF v_coa.is_control_account = true AND p_journal_type = 'subledger_adjustment' THEN
      IF (v_line->>'customer_id') IS NULL AND (v_line->>'supplier_id') IS NULL AND (v_line->>'product_id') IS NULL AND (v_line->>'collector_staff_id') IS NULL THEN
        RAISE EXCEPTION 'Jurnal Penyesuaian Subledger untuk akun kontrol % wajib menyertakan detail item subledger.', v_coa.code USING ERRCODE = '22023';
      END IF;
    END IF;

    v_d := COALESCE((v_line->>'debit')::NUMERIC(20,2), 0);
    v_c := COALESCE((v_line->>'credit')::NUMERIC(20,2), 0);
    IF (v_d > 0 AND v_c > 0) OR (v_d = 0 AND v_c = 0) OR v_d < 0 OR v_c < 0 THEN
      RAISE EXCEPTION 'Setiap baris jurnal harus memiliki nilai positif pada tepat satu sisi (debit atau kredit).' USING ERRCODE = '22023';
    END IF;

    v_sum_d := v_sum_d + v_d;
    v_sum_c := v_sum_c + v_c;
  END LOOP;

  IF v_sum_d <= 0 OR v_sum_d <> v_sum_c THEN
    RAISE EXCEPTION 'Total debit (%) harus sama dengan total kredit (%).', v_sum_d, v_sum_c USING ERRCODE = '22023';
  END IF;

  v_je_no := private.next_document_number(p_company_id, 'journal_manual', 'JRM', p_accounting_date);

  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_number, accounting_date, effective_date,
    description, status, total_debit, total_credit, journal_type,
    fiscal_period_id, created_by, reason
  ) VALUES (
    p_company_id, p_branch_id, v_je_no, p_accounting_date, p_effective_date,
    p_description, 'draft', v_sum_d, v_sum_c, p_journal_type,
    v_period_id, v_actor_id, p_reason
  )
  RETURNING id INTO v_je_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      company_id, journal_entry_id, line_no, coa_code, debit, credit, memo,
      branch_id, customer_id, supplier_id, collector_staff_id, product_id, fund_account_id, cash_flow_category
    ) VALUES (
      p_company_id, v_je_id, v_line_no, v_line->>'coa_code',
      COALESCE((v_line->>'debit')::NUMERIC(20,2), 0),
      COALESCE((v_line->>'credit')::NUMERIC(20,2), 0),
      v_line->>'memo', p_branch_id,
      NULLIF(v_line->>'customer_id', '')::UUID,
      NULLIF(v_line->>'supplier_id', '')::UUID,
      NULLIF(v_line->>'collector_staff_id', '')::UUID,
      NULLIF(v_line->>'product_id', '')::UUID,
      NULLIF(v_line->>'fund_account_id', '')::UUID,
      COALESCE(v_line->>'cash_flow_category', 'non_cash')
    );
  END LOOP;

  v_result := jsonb_build_object('journal_entry_id', v_je_id, 'journal_number', v_je_no, 'status', 'draft', 'version', 1);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_manual_journal', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. RPC: post_goods_receipt & moving weighted average inventory lock
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_goods_receipt(
  p_idempotency_key TEXT,
  p_goods_receipt_id UUID,
  p_expected_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_gr public.goods_receipts%ROWTYPE;
  v_line RECORD;
  v_val public.inventory_valuations%ROWTYPE;
  v_base_qty NUMERIC(20,6);
  v_line_cost NUMERIC(20,2);
  v_new_qty NUMERIC(20,6);
  v_new_val NUMERIC(20,2);
  v_new_avg NUMERIC(20,6);
  v_total_grn NUMERIC(20,2) := 0;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'post_goods_receipt', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_gr FROM public.goods_receipts WHERE id = p_goods_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dokumen penerimaan barang tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_gr.company_id, v_gr.branch_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak.' USING ERRCODE = '42501';
  END IF;

  IF v_gr.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;
  IF v_gr.status <> 'draft' THEN RAISE EXCEPTION 'GRN sudah diproses.' USING ERRCODE = '22023'; END IF;

  PERFORM private.lock_open_fiscal_period(v_gr.company_id, v_gr.received_date);

  FOR v_line IN SELECT * FROM public.goods_receipt_lines WHERE goods_receipt_id = v_gr.id ORDER BY product_id LOOP
    v_base_qty := v_line.quantity * COALESCE(v_line.conversion_factor, 1);
    v_line_cost := round(v_line.quantity * v_line.estimated_unit_cost, 0);
    v_total_grn := v_total_grn + v_line_cost;

    SELECT * INTO v_val
    FROM public.inventory_valuations
    WHERE company_id = v_gr.company_id AND branch_id = v_gr.branch_id AND product_id = v_line.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_new_qty := v_base_qty;
      v_new_val := v_line_cost;
      v_new_avg := v_new_val / NULLIF(v_new_qty, 0);
      INSERT INTO public.inventory_valuations (company_id, branch_id, product_id, qty_on_hand, avg_unit_cost, total_value)
      VALUES (v_gr.company_id, v_gr.branch_id, v_line.product_id, v_new_qty, COALESCE(v_new_avg, 0), v_new_val);
    ELSE
      v_new_qty := v_val.qty_on_hand + v_base_qty;
      v_new_val := v_val.total_value + v_line_cost;
      v_new_avg := v_new_val / NULLIF(v_new_qty, 0);
      UPDATE public.inventory_valuations
      SET qty_on_hand = v_new_qty, total_value = v_new_val, avg_unit_cost = COALESCE(v_new_avg, 0), updated_at = now()
      WHERE id = v_val.id;
    END IF;

    INSERT INTO public.inventory_movements (
      company_id, branch_id, product_id, movement_date, direction, quantity, unit_cost,
      unit_code, base_quantity, total_cost, balance_qty_after, balance_value_after, avg_cost_after,
      condition_status, source_type, source_id
    ) VALUES (
      v_gr.company_id, v_gr.branch_id, v_line.product_id, v_gr.received_date, 'in', v_line.quantity,
      v_line_cost / NULLIF(v_base_qty, 0), v_line.unit_code, v_base_qty, v_line_cost,
      v_new_qty, v_new_val, COALESCE(v_new_avg, 0), v_line.condition_status, 'goods_receipt', v_gr.id
    );
  END LOOP;

  UPDATE public.goods_receipts
  SET status = 'posted', accounting_status = 'queued', approved_by = v_actor_id, approved_at = now(), version = version + 1
  WHERE id = v_gr.id;

  PERFORM private.emit_accounting_event(
    v_gr.company_id, v_gr.branch_id, 'goods_receipt_posted', 'goods_receipt', v_gr.id, v_gr.version + 1,
    v_gr.received_date,
    jsonb_build_object('grn_number', v_gr.grn_number, 'supplier_id', v_gr.supplier_id, 'total_estimated_cost', v_total_grn),
    ARRAY[]::UUID[], v_actor_id, gen_random_uuid()
  );

  v_result := jsonb_build_object('goods_receipt_id', v_gr.id, 'status', 'posted', 'total_estimated_cost', v_total_grn, 'version', v_gr.version + 1);
  PERFORM private.save_idempotency(v_gr.company_id, v_actor_id, 'post_goods_receipt', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. RPC: run_depreciation (Idempoten per aset dan periode)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_depreciation(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_period_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_fp public.fiscal_periods%ROWTYPE;
  v_asset RECORD;
  v_monthly NUMERIC(20,2);
  v_total NUMERIC(20,2) := 0;
  v_count INTEGER := 0;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'run_depreciation', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak menjalankan penyusutan.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_fp FROM public.fiscal_periods WHERE company_id = p_company_id AND period_code = p_period_code FOR UPDATE;
  IF NOT FOUND OR v_fp.status <> 'open' THEN
    RAISE EXCEPTION 'Periode % tidak ditemukan atau sudah terkunci.', p_period_code USING ERRCODE = '22023';
  END IF;

  FOR v_asset IN
    SELECT * FROM public.fixed_assets
    WHERE company_id = p_company_id AND status = 'active'
      AND COALESCE(ready_to_use_date, acquisition_date) <= v_fp.end_date
    FOR UPDATE
  LOOP
    IF EXISTS (SELECT 1 FROM public.depreciation_runs WHERE company_id = p_company_id AND fixed_asset_id = v_asset.id AND period_code = p_period_code) THEN
      CONTINUE;
    END IF;

    v_monthly := LEAST(
      round((v_asset.cost - v_asset.residual_value) / NULLIF(v_asset.useful_life_months, 0), 0),
      GREATEST(0, (v_asset.cost - v_asset.residual_value) - v_asset.accumulated_depreciation)
    );

    IF v_monthly > 0 THEN
      INSERT INTO public.depreciation_runs (company_id, fixed_asset_id, period_code, run_date, total_depreciation, status, created_by)
      VALUES (p_company_id, v_asset.id, p_period_code, v_fp.end_date, v_monthly, 'draft', v_actor_id);

      UPDATE public.fixed_assets SET accumulated_depreciation = accumulated_depreciation + v_monthly WHERE id = v_asset.id;
      v_total := v_total + v_monthly;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  v_result := jsonb_build_object('period_code', p_period_code, 'assets_depreciated', v_count, 'total_depreciation', v_total);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'run_depreciation', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. VIEW PELAPORAN BERBASIS SECURITY_INVOKER (Neraca Saldo & Tie-Out Kontrol)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_app3_trial_balance_posted
WITH (security_invoker = true) AS
SELECT
  je.company_id,
  je.branch_id,
  je.accounting_date,
  coa.code AS coa_code,
  coa.name AS coa_name,
  coa.account_group,
  coa.normal_balance,
  SUM(jl.debit)::NUMERIC(20,2) AS total_debit,
  SUM(jl.credit)::NUMERIC(20,2) AS total_credit
FROM public.journal_lines jl
JOIN public.journal_entries je ON je.id = jl.journal_entry_id
JOIN public.chart_of_accounts coa ON coa.company_id = je.company_id AND coa.code = jl.coa_code
WHERE je.status = 'posted'
GROUP BY je.company_id, je.branch_id, je.accounting_date, coa.code, coa.name, coa.account_group, coa.normal_balance;

REVOKE ALL ON public.v_app3_trial_balance_posted FROM PUBLIC, anon;
GRANT SELECT ON public.v_app3_trial_balance_posted TO authenticated;

REVOKE ALL ON FUNCTION public.process_accounting_queue(UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_accounting_queue(UUID,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.create_manual_journal(TEXT,UUID,UUID,DATE,DATE,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_journal(TEXT,UUID,UUID,DATE,DATE,TEXT,TEXT,JSONB,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.post_goods_receipt(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_goods_receipt(TEXT,UUID,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.run_depreciation(TEXT,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_depreciation(TEXT,UUID,TEXT) TO authenticated;

-- Publikasi Realtime untuk tabel App 3
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_entries;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fiscal_periods;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_documents;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_valuations;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

INSERT INTO public.schema_migrations (version, description)
VALUES ('0006_finops_app3_reports_and_views', 'App 3 queue processor, manual/subledger journal validation, GRN/COGS valuation, depreciation, and security_invoker reporting views')
ON CONFLICT (version) DO NOTHING;
