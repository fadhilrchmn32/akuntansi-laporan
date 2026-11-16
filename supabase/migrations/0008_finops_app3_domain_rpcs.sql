-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0008: App 3 Domain RPCs & Live-Mode Persistence
-- Additive-only migration. Semua RPC berjalan sebagai SECURITY DEFINER dengan
-- search_path = '', auth.uid(), membership/branch/role checks, FOR UPDATE,
-- idempotency_keys, dan audit_events.
-- ==============================================================================

-- Kolom tambahan untuk pelacakan pembayaran utang pemasok dan angsuran pinjaman
ALTER TABLE public.purchase_documents
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(20,2) NOT NULL DEFAULT 0;

ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS invoiced_status TEXT NOT NULL DEFAULT 'uninvoiced'
    CHECK (invoiced_status IN ('uninvoiced', 'partially_invoiced', 'invoiced')),
  ADD COLUMN IF NOT EXISTS total_estimated_cost NUMERIC(20,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.loan_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE RESTRICT,
  payment_date DATE NOT NULL,
  principal_paid NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (principal_paid >= 0),
  interest_paid NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (interest_paid >= 0),
  fee_paid NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (fee_paid >= 0),
  fund_account_id UUID NOT NULL REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  evidence_ref TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_repayments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.loan_repayments FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.loan_repayments FROM authenticated;
GRANT SELECT ON TABLE public.loan_repayments TO authenticated;
CREATE POLICY loan_repayments_select ON public.loan_repayments
  FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));

-- ------------------------------------------------------------------------------
-- 1. create_goods_receipt
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_goods_receipt(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_supplier_id UUID,
  p_received_date DATE,
  p_lines JSONB, -- [{product_id, unit_code, quantity, conversion_factor, estimated_unit_cost, condition_status}]
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_grn_id UUID;
  v_grn_no TEXT;
  v_line JSONB;
  v_total NUMERIC(20,2) := 0;
  v_qty NUMERIC(20,6);
  v_cost NUMERIC(20,6);
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_goods_receipt', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak membuat penerimaan barang.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.lock_open_fiscal_period(p_company_id, p_received_date);

  v_grn_no := private.next_document_number(p_company_id, 'goods_receipt', 'GRN', p_received_date);

  INSERT INTO public.goods_receipts (
    company_id, branch_id, grn_number, supplier_id, received_date, status, notes, created_by
  ) VALUES (
    p_company_id, p_branch_id, v_grn_no, p_supplier_id, p_received_date, 'draft', p_notes, v_actor_id
  )
  RETURNING id INTO v_grn_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_line->>'quantity')::NUMERIC(20,6);
    v_cost := (v_line->>'estimated_unit_cost')::NUMERIC(20,6);
    IF v_qty <= 0 OR v_cost < 0 THEN
      RAISE EXCEPTION 'Kuantitas dan estimasi biaya GRN harus valid.' USING ERRCODE = '22023';
    END IF;
    v_total := v_total + round(v_qty * v_cost, 0);

    INSERT INTO public.goods_receipt_lines (
      company_id, goods_receipt_id, product_id, quantity, estimated_unit_cost,
      unit_code, conversion_factor, condition_status
    ) VALUES (
      p_company_id, v_grn_id, (v_line->>'product_id')::UUID, v_qty, v_cost,
      COALESCE(v_line->>'unit_code', 'PCS'),
      COALESCE((v_line->>'conversion_factor')::NUMERIC(20,6), 1),
      COALESCE(v_line->>'condition_status', 'good')
    );
  END LOOP;

  UPDATE public.goods_receipts SET total_estimated_cost = v_total WHERE id = v_grn_id;

  v_result := jsonb_build_object('goods_receipt_id', v_grn_id, 'grn_number', v_grn_no, 'total_estimated_cost', v_total, 'version', 1);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_goods_receipt', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. create_purchase_document & approve_purchase_document
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_document(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_supplier_id UUID,
  p_invoice_date DATE,
  p_due_date DATE,
  p_goods_receipt_id UUID DEFAULT NULL,
  p_is_prepayment_exception BOOLEAN DEFAULT false,
  p_freight_amount NUMERIC(20,2) DEFAULT 0,
  p_lines JSONB DEFAULT '[]'::jsonb,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_po_id UUID;
  v_doc_no TEXT;
  v_grn public.goods_receipts%ROWTYPE;
  v_subtotal NUMERIC(20,2) := 0;
  v_total NUMERIC(20,2);
  v_line JSONB;
  v_line_total NUMERIC(20,2);
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_purchase_document', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak membuat invoice pembelian.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.lock_open_fiscal_period(p_company_id, p_invoice_date);

  IF p_goods_receipt_id IS NOT NULL THEN
    SELECT * INTO v_grn FROM public.goods_receipts WHERE id = p_goods_receipt_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'GRN tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;
    v_subtotal := v_grn.total_estimated_cost;
  ELSE
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
      v_line_total := round(((v_line->>'quantity')::NUMERIC(20,6) * (v_line->>'unit_cost')::NUMERIC(20,6)) - COALESCE((v_line->>'discount_amount')::NUMERIC(20,2), 0), 0);
      v_subtotal := v_subtotal + v_line_total;
    END LOOP;
  END IF;

  v_total := v_subtotal + COALESCE(p_freight_amount, 0);
  IF v_total <= 0 THEN RAISE EXCEPTION 'Total invoice pembelian harus lebih dari 0.' USING ERRCODE = '22023'; END IF;

  v_doc_no := private.next_document_number(p_company_id, 'purchase_invoice', 'PINV', p_invoice_date);

  INSERT INTO public.purchase_documents (
    company_id, branch_id, doc_number, doc_type, supplier_id, invoice_date, due_date,
    payment_terms_type, goods_receipt_id, is_prepayment_exception, subtotal_amount,
    freight_amount, total_amount, status, accounting_status, notes, created_by
  ) VALUES (
    p_company_id, p_branch_id, v_doc_no, 'purchase_invoice', COALESCE(v_grn.supplier_id, p_supplier_id),
    p_invoice_date, p_due_date, 'credit', p_goods_receipt_id, p_is_prepayment_exception,
    v_subtotal, COALESCE(p_freight_amount, 0), v_total, 'draft', 'not_ready', p_notes, v_actor_id
  )
  RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_total := round(((v_line->>'quantity')::NUMERIC(20,6) * (v_line->>'unit_cost')::NUMERIC(20,6)) - COALESCE((v_line->>'discount_amount')::NUMERIC(20,2), 0), 0);
    INSERT INTO public.purchase_lines (
      company_id, purchase_document_id, product_id, quantity, unit_cost, line_total, unit_code, conversion_factor
    ) VALUES (
      p_company_id, v_po_id, (v_line->>'product_id')::UUID, (v_line->>'quantity')::NUMERIC(20,6),
      (v_line->>'unit_cost')::NUMERIC(20,6), v_line_total,
      COALESCE(v_line->>'unit_code', 'PCS'), COALESCE((v_line->>'conversion_factor')::NUMERIC(20,6), 1)
    );
  END LOOP;

  v_result := jsonb_build_object('purchase_document_id', v_po_id, 'doc_number', v_doc_no, 'total_amount', v_total, 'version', 1);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_purchase_document', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_purchase_document(
  p_idempotency_key TEXT,
  p_purchase_document_id UUID,
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
  v_po public.purchase_documents%ROWTYPE;
  v_ev_id UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_purchase_document', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_po FROM public.purchase_documents WHERE id = p_purchase_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice pembelian tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_po.company_id, v_po.branch_id, ARRAY['accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya accounting_approver yang dapat menyetujui invoice pembelian.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_po.created_by, v_actor_id, 'invoice pembelian');
  IF v_po.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi invoice pembelian.' USING ERRCODE = '40001'; END IF;
  IF v_po.status <> 'draft' THEN RAISE EXCEPTION 'Hanya invoice draft yang dapat disetujui.' USING ERRCODE = '22023'; END IF;

  PERFORM private.lock_open_fiscal_period(v_po.company_id, v_po.invoice_date);

  IF v_po.goods_receipt_id IS NOT NULL THEN
    UPDATE public.goods_receipts
    SET invoiced_status = 'invoiced', purchase_document_id = v_po.id, version = version + 1
    WHERE id = v_po.goods_receipt_id;
  END IF;

  UPDATE public.purchase_documents
  SET status = 'approved', accounting_status = 'queued', approved_by = v_actor_id, approved_at = now(), version = version + 1
  WHERE id = v_po.id;

  v_ev_id := private.emit_accounting_event(
    v_po.company_id, v_po.branch_id, 'purchase_invoice_approved', 'purchase_document', v_po.id, v_po.version + 1,
    v_po.invoice_date,
    jsonb_build_object(
      'doc_number', v_po.doc_number,
      'supplier_id', v_po.supplier_id,
      'total_amount', v_po.total_amount,
      'clears_grni', (v_po.goods_receipt_id IS NOT NULL),
      'is_prepayment_exception', v_po.is_prepayment_exception
    ),
    ARRAY[]::UUID[], v_actor_id, gen_random_uuid()
  );

  v_result := jsonb_build_object('purchase_document_id', v_po.id, 'accounting_event_id', v_ev_id, 'status', 'approved', 'version', v_po.version + 1);
  PERFORM private.save_idempotency(v_po.company_id, v_actor_id, 'approve_purchase_document', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. create_supplier_payment & approve_supplier_payment
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_supplier_payment(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_supplier_id UUID,
  p_fund_account_id UUID,
  p_payment_date DATE,
  p_reference_no TEXT,
  p_allocations JSONB -- [{purchase_document_id, allocated_amount}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_sp_id UUID;
  v_sp_no TEXT;
  v_alloc JSONB;
  v_amt NUMERIC(20,2);
  v_total NUMERIC(20,2) := 0;
  v_po public.purchase_documents%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_supplier_payment', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['accountant', 'accounting_approver', 'finance_maker', 'finance_checker']) THEN
    RAISE EXCEPTION 'Izin ditolak membuat pembayaran pemasok.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.lock_open_fiscal_period(p_company_id, p_payment_date);

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_amt := (v_alloc->>'allocated_amount')::NUMERIC(20,2);
    IF v_amt <= 0 THEN RAISE EXCEPTION 'Nominal alokasi harus lebih dari 0.' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_po FROM public.purchase_documents WHERE id = (v_alloc->>'purchase_document_id')::UUID FOR UPDATE;
    IF NOT FOUND OR v_po.status <> 'approved' THEN RAISE EXCEPTION 'Tagihan pemasok tidak ditemukan atau belum disetujui.' USING ERRCODE = '22023'; END IF;
    IF v_amt > (v_po.total_amount - v_po.paid_amount) THEN RAISE EXCEPTION 'Nominal alokasi melebihi sisa utang tagihan %.', v_po.doc_number USING ERRCODE = '22023'; END IF;
    v_total := v_total + v_amt;
  END LOOP;

  IF v_total <= 0 THEN RAISE EXCEPTION 'Total pembayaran wajib lebih dari 0.' USING ERRCODE = '22023'; END IF;
  v_sp_no := private.next_document_number(p_company_id, 'supplier_payment', 'PAY-SUP', p_payment_date);

  INSERT INTO public.supplier_payments (
    company_id, branch_id, payment_number, supplier_id, fund_account_id, payment_date, amount, reference_no, status, created_by
  ) VALUES (
    p_company_id, p_branch_id, v_sp_no, p_supplier_id, p_fund_account_id, p_payment_date, v_total, p_reference_no, 'draft', v_actor_id
  )
  RETURNING id INTO v_sp_id;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    INSERT INTO public.supplier_allocations (company_id, supplier_payment_id, purchase_document_id, allocated_amount)
    VALUES (p_company_id, v_sp_id, (v_alloc->>'purchase_document_id')::UUID, (v_alloc->>'allocated_amount')::NUMERIC(20,2));
  END LOOP;

  v_result := jsonb_build_object('supplier_payment_id', v_sp_id, 'payment_number', v_sp_no, 'amount', v_total, 'version', 1);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_supplier_payment', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_supplier_payment(
  p_idempotency_key TEXT,
  p_supplier_payment_id UUID,
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
  v_sp public.supplier_payments%ROWTYPE;
  v_al RECORD;
  v_ev_id UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_supplier_payment', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_sp FROM public.supplier_payments WHERE id = p_supplier_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran pemasok tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_sp.company_id, v_sp.branch_id, ARRAY['accounting_approver', 'finance_checker']) THEN
    RAISE EXCEPTION 'Izin ditolak menyetujui pembayaran pemasok.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_sp.created_by, v_actor_id, 'pembayaran pemasok');
  IF v_sp.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;
  IF v_sp.status <> 'draft' THEN RAISE EXCEPTION 'Hanya draft pembayaran yang dapat disetujui.' USING ERRCODE = '22023'; END IF;

  PERFORM private.lock_open_fiscal_period(v_sp.company_id, v_sp.payment_date);

  FOR v_al IN SELECT * FROM public.supplier_allocations WHERE supplier_payment_id = v_sp.id LOOP
    UPDATE public.purchase_documents
    SET paid_amount = paid_amount + v_al.allocated_amount,
        payment_status = CASE
          WHEN paid_amount + v_al.allocated_amount >= total_amount THEN 'paid'
          ELSE 'partially_paid'
        END
    WHERE id = v_al.purchase_document_id;
  END LOOP;

  UPDATE public.supplier_payments
  SET status = 'approved', accounting_status = 'queued', approved_by = v_actor_id, approved_at = now(), version = version + 1
  WHERE id = v_sp.id;

  v_ev_id := private.emit_accounting_event(
    v_sp.company_id, v_sp.branch_id, 'supplier_payment_approved', 'supplier_payment', v_sp.id, v_sp.version + 1,
    v_sp.payment_date,
    jsonb_build_object('payment_number', v_sp.payment_number, 'supplier_id', v_sp.supplier_id, 'amount', v_sp.amount, 'fund_account_id', v_sp.fund_account_id),
    ARRAY[]::UUID[], v_actor_id, gen_random_uuid()
  );

  v_result := jsonb_build_object('supplier_payment_id', v_sp.id, 'accounting_event_id', v_ev_id, 'status', 'approved', 'version', v_sp.version + 1);
  PERFORM private.save_idempotency(v_sp.company_id, v_actor_id, 'approve_supplier_payment', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. recalculate_inventory_valuation
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_inventory_valuation(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_product_id UUID,
  p_new_unit_cost NUMERIC(20,6),
  p_effective_date DATE,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_val public.inventory_valuations%ROWTYPE;
  v_diff NUMERIC(20,2);
  v_reval_id UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'recalculate_inventory_valuation', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak melakukan revaluasi persediaan.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.lock_open_fiscal_period(p_company_id, p_effective_date);

  SELECT * INTO v_val FROM public.inventory_valuations
  WHERE company_id = p_company_id AND branch_id = p_branch_id AND product_id = p_product_id FOR UPDATE;
  IF NOT FOUND OR v_val.qty_on_hand <= 0 THEN
    RAISE EXCEPTION 'Tidak ada stok tersisa untuk direvaluasi.' USING ERRCODE = '22023';
  END IF;

  v_diff := round((p_new_unit_cost - v_val.avg_unit_cost) * v_val.qty_on_hand, 0);

  INSERT INTO public.inventory_revaluations (
    company_id, branch_id, product_id, effective_from_date, reason,
    old_avg_cost, new_avg_cost, remaining_stock_impact, status, created_by, approved_by
  ) VALUES (
    p_company_id, p_branch_id, p_product_id, p_effective_date, p_reason,
    v_val.avg_unit_cost, p_new_unit_cost, v_diff, 'approved', v_actor_id, v_actor_id
  )
  RETURNING id INTO v_reval_id;

  UPDATE public.inventory_valuations
  SET avg_unit_cost = p_new_unit_cost, total_value = total_value + v_diff, updated_at = now()
  WHERE id = v_val.id;

  PERFORM private.write_audit_event(
    p_company_id, p_branch_id, v_actor_id, 'inventory.recalculate', 'inventory_revaluation', v_reval_id,
    jsonb_build_object('avg_unit_cost', v_val.avg_unit_cost, 'total_value', v_val.total_value),
    jsonb_build_object('avg_unit_cost', p_new_unit_cost, 'remaining_stock_impact', v_diff),
    p_reason
  );

  v_result := jsonb_build_object('revaluation_id', v_reval_id, 'remaining_stock_impact', v_diff);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'recalculate_inventory_valuation', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. create_expense_document & approve_expense_document
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_expense_document(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_expense_mode TEXT,
  p_expense_date DATE,
  p_category_coa TEXT,
  p_vendor_name TEXT,
  p_fund_account_id UUID,
  p_amount NUMERIC(20,2),
  p_description TEXT,
  p_evidence_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_exp_id UUID;
  v_doc_no TEXT;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_expense_document', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['accountant', 'accounting_approver', 'finance_maker']) THEN
    RAISE EXCEPTION 'Izin ditolak membuat dokumen biaya.' USING ERRCODE = '42501';
  END IF;

  IF p_amount <= 0 THEN RAISE EXCEPTION 'Nominal biaya harus lebih dari 0.' USING ERRCODE = '22023'; END IF;
  PERFORM private.lock_open_fiscal_period(p_company_id, p_expense_date);

  v_doc_no := private.next_document_number(p_company_id, 'expense_document', 'EXP', p_expense_date);

  INSERT INTO public.expense_documents (
    company_id, branch_id, doc_number, expense_mode, expense_date, paid_date,
    category_coa, vendor_name, fund_account_id, net_amount, amount, description, evidence_path, status, created_by
  ) VALUES (
    p_company_id, p_branch_id, v_doc_no, p_expense_mode, p_expense_date,
    CASE WHEN p_expense_mode = 'accrued' THEN NULL ELSE p_expense_date END,
    p_category_coa, p_vendor_name, p_fund_account_id, p_amount, p_amount, p_description, p_evidence_path, 'draft', v_actor_id
  )
  RETURNING id INTO v_exp_id;

  v_result := jsonb_build_object('expense_document_id', v_exp_id, 'doc_number', v_doc_no, 'status', 'draft', 'version', 1);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_expense_document', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_expense_document(
  p_idempotency_key TEXT,
  p_expense_document_id UUID,
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
  v_ex public.expense_documents%ROWTYPE;
  v_ev_id UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_expense_document', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_ex FROM public.expense_documents WHERE id = p_expense_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dokumen biaya tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_ex.company_id, v_ex.branch_id, ARRAY['accounting_approver', 'finance_checker']) THEN
    RAISE EXCEPTION 'Izin ditolak menyetujui biaya.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_ex.created_by, v_actor_id, 'dokumen biaya');
  IF v_ex.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi biaya.' USING ERRCODE = '40001'; END IF;
  IF v_ex.status <> 'draft' THEN RAISE EXCEPTION 'Hanya draft biaya yang dapat disetujui.' USING ERRCODE = '22023'; END IF;

  PERFORM private.lock_open_fiscal_period(v_ex.company_id, v_ex.expense_date);

  UPDATE public.expense_documents
  SET status = 'approved', accounting_status = 'queued', approved_by = v_actor_id, approved_at = now(), version = version + 1
  WHERE id = v_ex.id;

  v_ev_id := private.emit_accounting_event(
    v_ex.company_id, v_ex.branch_id, 'expense_approved', 'expense_document', v_ex.id, v_ex.version + 1,
    v_ex.expense_date,
    jsonb_build_object(
      'doc_number', v_ex.doc_number,
      'expense_mode', v_ex.expense_mode,
      'category_coa', v_ex.category_coa,
      'amount', v_ex.amount,
      'fund_account_id', v_ex.fund_account_id,
      'vendor_name', v_ex.vendor_name
    ),
    ARRAY[]::UUID[], v_actor_id, gen_random_uuid()
  );

  v_result := jsonb_build_object('expense_document_id', v_ex.id, 'accounting_event_id', v_ev_id, 'status', 'approved', 'version', v_ex.version + 1);
  PERFORM private.save_idempotency(v_ex.company_id, v_actor_id, 'approve_expense_document', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. register_fixed_asset, create_loan_repayment, create_equity_transaction
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_fixed_asset(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_name TEXT,
  p_acquisition_date DATE,
  p_ready_to_use_date DATE,
  p_cost NUMERIC(20,2),
  p_residual_value NUMERIC(20,2),
  p_useful_life_months INTEGER,
  p_location TEXT,
  p_fund_account_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_period_id UUID;
  v_asset_id UUID;
  v_asset_code TEXT;
  v_je_id UUID;
  v_je_no TEXT;
  v_cash_coa TEXT := '1103';
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'register_fixed_asset', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak mendaftarkan aset tetap.' USING ERRCODE = '42501';
  END IF;

  IF p_cost <= 0 OR p_useful_life_months <= 0 THEN
    RAISE EXCEPTION 'Harga perolehan dan umur ekonomis aset wajib positif.' USING ERRCODE = '22023';
  END IF;

  v_period_id := private.lock_open_fiscal_period(p_company_id, p_acquisition_date);
  v_asset_code := private.next_document_number(p_company_id, 'fixed_asset', 'AST', p_acquisition_date);

  IF p_fund_account_id IS NOT NULL THEN
    SELECT COALESCE(coa_account_code, '1103') INTO v_cash_coa FROM public.fund_accounts WHERE id = p_fund_account_id;
  END IF;

  INSERT INTO public.fixed_assets (
    company_id, branch_id, asset_code, name, acquisition_date, ready_to_use_date,
    cost, residual_value, useful_life_months, location, fund_account_id, status, created_by, approved_by
  ) VALUES (
    p_company_id, p_branch_id, v_asset_code, p_name, p_acquisition_date, p_ready_to_use_date,
    p_cost, COALESCE(p_residual_value, 0), p_useful_life_months, p_location, p_fund_account_id, 'active', v_actor_id, v_actor_id
  )
  RETURNING id INTO v_asset_id;

  v_je_no := private.next_document_number(p_company_id, 'journal_entry', 'JRN', p_acquisition_date);
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_number, accounting_date, effective_date,
    description, status, total_debit, total_credit, source_type, source_id, journal_type,
    fiscal_period_id, created_by, approved_by, posted_at
  ) VALUES (
    p_company_id, p_branch_id, v_je_no, p_acquisition_date, p_acquisition_date,
    'Perolehan Aset Tetap ' || v_asset_code || ' (' || p_name || ')',
    'posted', p_cost, p_cost, 'fixed_asset', v_asset_id, 'auto',
    v_period_id, v_actor_id, v_actor_id, now()
  )
  RETURNING id INTO v_je_id;

  INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, cash_flow_category)
  VALUES (p_company_id, v_je_id, 1, '1201', p_cost, 0, p_name, p_branch_id, 'investing');

  INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, fund_account_id, cash_flow_category)
  VALUES (p_company_id, v_je_id, 2, v_cash_coa, 0, p_cost, 'Pembelian aset tetap', p_branch_id, p_fund_account_id, 'investing');

  v_result := jsonb_build_object('fixed_asset_id', v_asset_id, 'asset_code', v_asset_code, 'journal_entry_id', v_je_id);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'register_fixed_asset', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_loan_repayment(
  p_idempotency_key TEXT,
  p_loan_id UUID,
  p_payment_date DATE,
  p_principal_paid NUMERIC(20,2),
  p_interest_paid NUMERIC(20,2),
  p_fund_account_id UUID,
  p_evidence_ref TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_loan public.loans%ROWTYPE;
  v_period_id UUID;
  v_total NUMERIC(20,2);
  v_cash_coa TEXT := '1103';
  v_je_id UUID;
  v_je_no TEXT;
  v_rep_id UUID;
  v_line_no INTEGER := 0;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_loan_repayment', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pinjaman tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_loan.company_id, v_loan.branch_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak mencatat angsuran pinjaman.' USING ERRCODE = '42501';
  END IF;

  v_total := COALESCE(p_principal_paid, 0) + COALESCE(p_interest_paid, 0);
  IF v_total <= 0 OR p_principal_paid < 0 OR p_interest_paid < 0 THEN
    RAISE EXCEPTION 'Nominal angsuran tidak valid.' USING ERRCODE = '22023';
  END IF;

  v_period_id := private.lock_open_fiscal_period(v_loan.company_id, p_payment_date);
  SELECT COALESCE(coa_account_code, '1103') INTO v_cash_coa FROM public.fund_accounts WHERE id = p_fund_account_id;

  v_je_no := private.next_document_number(v_loan.company_id, 'journal_entry', 'JRN', p_payment_date);
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_number, accounting_date, effective_date,
    description, status, total_debit, total_credit, source_type, source_id, journal_type,
    fiscal_period_id, created_by, approved_by, posted_at
  ) VALUES (
    v_loan.company_id, v_loan.branch_id, v_je_no, p_payment_date, p_payment_date,
    'Angsuran Pinjaman ' || v_loan.loan_number, 'posted', v_total, v_total, 'loan', v_loan.id, 'auto',
    v_period_id, v_actor_id, v_actor_id, now()
  )
  RETURNING id INTO v_je_id;

  IF p_principal_paid > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, cash_flow_category)
    VALUES (v_loan.company_id, v_je_id, v_line_no, '2201', p_principal_paid, 0, 'Pembayaran pokok pinjaman', v_loan.branch_id, 'financing');
  END IF;

  IF p_interest_paid > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, cash_flow_category)
    VALUES (v_loan.company_id, v_je_id, v_line_no, '6401', p_interest_paid, 0, 'Beban bunga pinjaman', v_loan.branch_id, 'operating');
  END IF;

  v_line_no := v_line_no + 1;
  INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, fund_account_id, cash_flow_category)
  VALUES (v_loan.company_id, v_je_id, v_line_no, v_cash_coa, 0, v_total, 'Pembayaran angsuran pinjaman', v_loan.branch_id, p_fund_account_id, 'financing');

  INSERT INTO public.loan_repayments (
    company_id, branch_id, loan_id, payment_date, principal_paid, interest_paid, fund_account_id, evidence_ref, journal_entry_id, created_by
  ) VALUES (
    v_loan.company_id, v_loan.branch_id, v_loan.id, p_payment_date, p_principal_paid, p_interest_paid, p_fund_account_id, p_evidence_ref, v_je_id, v_actor_id
  )
  RETURNING id INTO v_rep_id;

  UPDATE public.loans
  SET outstanding_principal = GREATEST(0, outstanding_principal - p_principal_paid),
      status = CASE WHEN outstanding_principal - p_principal_paid <= 0 THEN 'settled' ELSE 'active' END
  WHERE id = v_loan.id;

  v_result := jsonb_build_object('repayment_id', v_rep_id, 'journal_entry_id', v_je_id);
  PERFORM private.save_idempotency(v_loan.company_id, v_actor_id, 'create_loan_repayment', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_equity_transaction(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_branch_id UUID,
  p_txn_type TEXT,
  p_txn_date DATE,
  p_party_name TEXT,
  p_fund_account_id UUID,
  p_amount NUMERIC(20,2),
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_period_id UUID;
  v_eq_id UUID;
  v_doc_no TEXT;
  v_cash_coa TEXT := '1103';
  v_je_id UUID;
  v_je_no TEXT;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_equity_transaction', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_branch_role(p_company_id, p_branch_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak mencatat transaksi ekuitas.' USING ERRCODE = '42501';
  END IF;

  IF p_amount <= 0 OR p_txn_type NOT IN ('capital_injection', 'owner_draw', 'dividend') THEN
    RAISE EXCEPTION 'Parameter transaksi ekuitas tidak valid.' USING ERRCODE = '22023';
  END IF;

  v_period_id := private.lock_open_fiscal_period(p_company_id, p_txn_date);
  SELECT COALESCE(coa_account_code, '1103') INTO v_cash_coa FROM public.fund_accounts WHERE id = p_fund_account_id;

  v_doc_no := private.next_document_number(p_company_id, 'equity_transaction', 'EQ', p_txn_date);
  INSERT INTO public.equity_transactions (
    company_id, branch_id, doc_number, txn_type, txn_date, party_name, fund_account_id, amount, notes, status, created_by, approved_by
  ) VALUES (
    p_company_id, p_branch_id, v_doc_no, p_txn_type, p_txn_date, p_party_name, p_fund_account_id, p_amount, p_notes, 'approved', v_actor_id, v_actor_id
  )
  RETURNING id INTO v_eq_id;

  v_je_no := private.next_document_number(p_company_id, 'journal_entry', 'JRN', p_txn_date);
  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_number, accounting_date, effective_date,
    description, status, total_debit, total_credit, source_type, source_id, journal_type,
    fiscal_period_id, created_by, approved_by, posted_at
  ) VALUES (
    p_company_id, p_branch_id, v_je_no, p_txn_date, p_txn_date,
    CASE WHEN p_txn_type = 'capital_injection' THEN 'Setoran Modal ' ELSE 'Prive / Distribusi ' END || v_doc_no || ' (' || p_party_name || ')',
    'posted', p_amount, p_amount, 'equity_transaction', v_eq_id, 'auto',
    v_period_id, v_actor_id, v_actor_id, now()
  )
  RETURNING id INTO v_je_id;

  IF p_txn_type = 'capital_injection' THEN
    INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, fund_account_id, cash_flow_category)
    VALUES (p_company_id, v_je_id, 1, v_cash_coa, p_amount, 0, 'Modal disetor masuk rekening', p_branch_id, p_fund_account_id, 'financing');
    INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, cash_flow_category)
    VALUES (p_company_id, v_je_id, 2, '3101', 0, p_amount, 'Setoran modal ' || p_party_name, p_branch_id, 'financing');
  ELSE
    INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, cash_flow_category)
    VALUES (p_company_id, v_je_id, 1, '3103', p_amount, 0, 'Prive / distribusi ' || p_party_name, p_branch_id, 'financing');
    INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, fund_account_id, cash_flow_category)
    VALUES (p_company_id, v_je_id, 2, v_cash_coa, 0, p_amount, 'Pembayaran prive dari kas/bank', p_branch_id, p_fund_account_id, 'financing');
  END IF;

  v_result := jsonb_build_object('equity_transaction_id', v_eq_id, 'doc_number', v_doc_no, 'journal_entry_id', v_je_id);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_equity_transaction', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Opening Balance, Policy, Bank Reconciliation, Tax Toggle, Snapshot & Reports
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_opening_balance(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_as_of_date DATE,
  p_lines JSONB -- [{branch_id, coa_code, debit, credit, fund_account_id}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_line JSONB;
  v_sum_d NUMERIC(20,2) := 0;
  v_sum_c NUMERIC(20,2) := 0;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'submit_opening_balance', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak mengajukan saldo awal.' USING ERRCODE = '42501';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_sum_d := v_sum_d + COALESCE((v_line->>'debit')::NUMERIC(20,2), 0);
    v_sum_c := v_sum_c + COALESCE((v_line->>'credit')::NUMERIC(20,2), 0);
  END LOOP;

  IF v_sum_d <= 0 OR v_sum_d <> v_sum_c THEN
    RAISE EXCEPTION 'Saldo awal tidak seimbang: debit (%) != kredit (%). Tanpa balancing plug otomatis.', v_sum_d, v_sum_c USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.opening_balances WHERE company_id = p_company_id AND status <> 'approved';

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.opening_balances (
      company_id, branch_id, as_of_date, coa_code, debit, credit, fund_account_id, status, created_by
    ) VALUES (
      p_company_id, NULLIF(v_line->>'branch_id', '')::UUID, p_as_of_date, v_line->>'coa_code',
      COALESCE((v_line->>'debit')::NUMERIC(20,2), 0), COALESCE((v_line->>'credit')::NUMERIC(20,2), 0),
      NULLIF(v_line->>'fund_account_id', '')::UUID, 'submitted', v_actor_id
    );
  END LOOP;

  INSERT INTO public.accounting_policies (company_id, cutover_date, opening_status, opening_submitted_by)
  VALUES (p_company_id, p_as_of_date, 'submitted', v_actor_id)
  ON CONFLICT (company_id) DO UPDATE
  SET cutover_date = EXCLUDED.cutover_date, opening_status = 'submitted', opening_submitted_by = v_actor_id, updated_at = now();

  v_result := jsonb_build_object('status', 'submitted', 'total_debit', v_sum_d, 'total_credit', v_sum_c);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'submit_opening_balance', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_opening_balance(
  p_idempotency_key TEXT,
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_pol public.accounting_policies%ROWTYPE;
  v_sum_d NUMERIC(20,2);
  v_sum_c NUMERIC(20,2);
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_opening_balance', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya accounting_approver yang dapat menyetujui saldo awal.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pol FROM public.accounting_policies WHERE company_id = p_company_id FOR UPDATE;
  IF NOT FOUND OR v_pol.opening_status <> 'submitted' THEN
    RAISE EXCEPTION 'Saldo awal belum diajukan.' USING ERRCODE = '22023';
  END IF;
  PERFORM private.assert_maker_checker(v_pol.opening_submitted_by, v_actor_id, 'saldo awal');

  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0) INTO v_sum_d, v_sum_c
  FROM public.opening_balances WHERE company_id = p_company_id AND status = 'submitted';
  IF v_sum_d <= 0 OR v_sum_d <> v_sum_c THEN
    RAISE EXCEPTION 'Saldo awal tidak seimbang (% vs %).', v_sum_d, v_sum_c USING ERRCODE = '22023';
  END IF;

  UPDATE public.opening_balances
  SET status = 'approved', approved_by = v_actor_id
  WHERE company_id = p_company_id AND status = 'submitted';

  UPDATE public.opening_subledger_items
  SET status = 'approved'
  WHERE company_id = p_company_id AND status = 'submitted';

  UPDATE public.accounting_policies
  SET opening_status = 'approved', opening_approved_by = v_actor_id, opening_approved_at = now(), updated_at = now()
  WHERE company_id = p_company_id;

  v_result := jsonb_build_object('status', 'approved', 'total_debit', v_sum_d);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'approve_opening_balance', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_accounting_policy(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_patch JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'update_accounting_policy', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['accountant', 'accounting_approver', 'system_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak mengubah kebijakan akuntansi.' USING ERRCODE = '42501';
  END IF;

  IF (p_patch ? 'allow_auto_post_deterministic') AND NOT private.has_company_role(p_company_id, ARRAY['accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya accounting_approver yang dapat mengubah kebijakan auto-post.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.accounting_policies (company_id) VALUES (p_company_id) ON CONFLICT (company_id) DO NOTHING;

  UPDATE public.accounting_policies
  SET reporting_framework_name = COALESCE(p_patch->>'reporting_framework_name', reporting_framework_name),
      reporting_framework_status = COALESCE(p_patch->>'reporting_framework_status', reporting_framework_status),
      tax_policy_status = COALESCE(p_patch->>'tax_policy_status', tax_policy_status),
      cutover_date = COALESCE(NULLIF(p_patch->>'cutover_date', '')::DATE, cutover_date),
      allow_auto_post_deterministic = COALESCE((p_patch->>'allow_auto_post_deterministic')::BOOLEAN, allow_auto_post_deterministic),
      version = version + 1,
      updated_at = now()
  WHERE company_id = p_company_id;

  IF (p_patch ? 'app1_url') OR (p_patch ? 'app2_url') THEN
    UPDATE public.app_settings
    SET app1_url = COALESCE(NULLIF(p_patch->>'app1_url', ''), app1_url),
        app2_url = COALESCE(NULLIF(p_patch->>'app2_url', ''), app2_url)
    WHERE company_id = p_company_id;
  END IF;

  PERFORM private.write_audit_event(p_company_id, NULL, v_actor_id, 'policy.update', 'accounting_policies', p_company_id, NULL, p_patch, 'Pembaruan kebijakan akuntansi');

  v_result := jsonb_build_object('company_id', p_company_id, 'updated', true);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'update_accounting_policy', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_bank_reconciliation(
  p_idempotency_key TEXT,
  p_reconciliation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_br public.bank_reconciliations%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_bank_reconciliation', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_br FROM public.bank_reconciliations WHERE id = p_reconciliation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rekonsiliasi bank tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_company_role(v_br.company_id, ARRAY['accountant', 'accounting_approver', 'finance_checker']) THEN
    RAISE EXCEPTION 'Izin ditolak menyetujui rekonsiliasi bank.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.bank_reconciliations SET status = 'approved', approved_by = v_actor_id WHERE id = v_br.id;
  v_result := jsonb_build_object('reconciliation_id', v_br.id, 'status', 'approved');
  PERFORM private.save_idempotency(v_br.company_id, v_actor_id, 'approve_bank_reconciliation', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_tax_code(
  p_idempotency_key TEXT,
  p_tax_code_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_tc public.tax_codes%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'toggle_tax_code', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_tc FROM public.tax_codes WHERE id = p_tax_code_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kode pajak tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_company_role(v_tc.company_id, ARRAY['accountant', 'accounting_approver']) THEN
    RAISE EXCEPTION 'Izin ditolak mengubah status kode pajak.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.tax_codes SET is_active = NOT is_active WHERE id = v_tc.id;
  v_result := jsonb_build_object('tax_code_id', v_tc.id, 'is_active', NOT v_tc.is_active);
  PERFORM private.save_idempotency(v_tc.company_id, v_actor_id, 'toggle_tax_code', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_report_snapshot(
  p_idempotency_key TEXT,
  p_company_id UUID,
  p_report_code TEXT,
  p_period_code TEXT,
  p_as_of_date DATE,
  p_snapshot_status TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_next_ver INTEGER;
  v_snap_id UUID;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'create_report_snapshot', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF NOT private.has_company_role(p_company_id, ARRAY['accountant', 'accounting_approver', 'owner_viewer']) THEN
    RAISE EXCEPTION 'Izin ditolak menyimpan snapshot laporan.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(snapshot_version), 0) + 1 INTO v_next_ver
  FROM public.report_snapshots WHERE company_id = p_company_id AND period_code = p_period_code;

  INSERT INTO public.report_snapshots (
    company_id, report_code, period_code, as_of_date, snapshot_version, snapshot_status, payload, generated_by
  ) VALUES (
    p_company_id, p_report_code, p_period_code, p_as_of_date, v_next_ver, p_snapshot_status, p_payload, v_actor_id
  )
  RETURNING id INTO v_snap_id;

  v_result := jsonb_build_object('snapshot_id', v_snap_id, 'snapshot_version', v_next_ver);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'create_report_snapshot', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_financial_report(
  p_company_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_tb JSONB;
  v_unposted INTEGER;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  IF NOT private.is_company_member(p_company_id) THEN RAISE EXCEPTION 'Akses ditolak.' USING ERRCODE = '42501'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_tb
  FROM (
    SELECT coa_code, coa_name, account_group, normal_balance,
           SUM(total_debit)::NUMERIC(20,2) AS debit,
           SUM(total_credit)::NUMERIC(20,2) AS credit
    FROM public.v_app3_trial_balance_posted
    WHERE company_id = p_company_id
      AND accounting_date <= p_end_date
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
    GROUP BY coa_code, coa_name, account_group, normal_balance
    ORDER BY coa_code
  ) t;

  SELECT count(*) INTO v_unposted
  FROM public.accounting_events
  WHERE company_id = p_company_id
    AND effective_date <= p_end_date
    AND processing_status IN ('waiting_accounting_module', 'queued', 'draft_journal', 'failed');

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'unposted_events_count', v_unposted,
    'trial_balance_posted', v_tb
  );
END;
$$;

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
  v_branch_id UUID;
  v_je_id UUID;
  v_je_no TEXT;
  v_run_ids UUID[] := ARRAY[]::UUID[];
  v_run_id UUID;
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

  SELECT id INTO v_branch_id FROM public.branches WHERE company_id = p_company_id AND is_active = true ORDER BY is_headquarters DESC LIMIT 1;

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
      INSERT INTO public.depreciation_runs (company_id, fixed_asset_id, period_code, run_date, total_depreciation, status, created_by, approved_by)
      VALUES (p_company_id, v_asset.id, p_period_code, v_fp.end_date, v_monthly, 'posted', v_actor_id, v_actor_id)
      RETURNING id INTO v_run_id;

      v_run_ids := array_append(v_run_ids, v_run_id);
      UPDATE public.fixed_assets SET accumulated_depreciation = accumulated_depreciation + v_monthly WHERE id = v_asset.id;
      v_total := v_total + v_monthly;
      v_count := v_count + 1;
      IF v_branch_id IS NULL THEN v_branch_id := v_asset.branch_id; END IF;
    END IF;
  END LOOP;

  IF v_total > 0 THEN
    v_je_no := private.next_document_number(p_company_id, 'journal_entry', 'DEP', v_fp.end_date);
    INSERT INTO public.journal_entries (
      company_id, branch_id, journal_number, accounting_date, effective_date,
      description, status, total_debit, total_credit, source_type, journal_type,
      fiscal_period_id, created_by, approved_by, posted_at
    ) VALUES (
      p_company_id, v_branch_id, v_je_no, v_fp.end_date, v_fp.end_date,
      'Penyusutan Aset Tetap Periode ' || p_period_code, 'posted', v_total, v_total,
      'depreciation_run', 'depreciation', v_fp.id, v_actor_id, v_actor_id, now()
    )
    RETURNING id INTO v_je_id;

    INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, cash_flow_category)
    VALUES (p_company_id, v_je_id, 1, '6201', v_total, 0, 'Beban penyusutan ' || p_period_code, v_branch_id, 'non_cash');

    INSERT INTO public.journal_lines (company_id, journal_entry_id, line_no, coa_code, debit, credit, memo, branch_id, cash_flow_category)
    VALUES (p_company_id, v_je_id, 2, '1202', 0, v_total, 'Akumulasi penyusutan ' || p_period_code, v_branch_id, 'non_cash');

    UPDATE public.depreciation_runs SET journal_entry_id = v_je_id WHERE id = ANY(v_run_ids);
  END IF;

  v_result := jsonb_build_object('period_code', p_period_code, 'assets_depreciated', v_count, 'total_depreciation', v_total, 'journal_entry_id', v_je_id);
  PERFORM private.save_idempotency(p_company_id, v_actor_id, 'run_depreciation', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- Grants for all new RPCs
REVOKE ALL ON FUNCTION public.create_goods_receipt(TEXT,UUID,UUID,UUID,DATE,JSONB,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_goods_receipt(TEXT,UUID,UUID,UUID,DATE,JSONB,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.create_purchase_document(TEXT,UUID,UUID,UUID,DATE,DATE,UUID,BOOLEAN,NUMERIC,JSONB,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_document(TEXT,UUID,UUID,UUID,DATE,DATE,UUID,BOOLEAN,NUMERIC,JSONB,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_purchase_document(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_purchase_document(TEXT,UUID,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.create_supplier_payment(TEXT,UUID,UUID,UUID,UUID,DATE,TEXT,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_payment(TEXT,UUID,UUID,UUID,UUID,DATE,TEXT,JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_supplier_payment(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_supplier_payment(TEXT,UUID,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.recalculate_inventory_valuation(TEXT,UUID,UUID,UUID,NUMERIC,DATE,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_inventory_valuation(TEXT,UUID,UUID,UUID,NUMERIC,DATE,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.create_expense_document(TEXT,UUID,UUID,TEXT,DATE,TEXT,TEXT,UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expense_document(TEXT,UUID,UUID,TEXT,DATE,TEXT,TEXT,UUID,NUMERIC,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_expense_document(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_expense_document(TEXT,UUID,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.register_fixed_asset(TEXT,UUID,UUID,TEXT,DATE,DATE,NUMERIC,NUMERIC,INTEGER,TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_fixed_asset(TEXT,UUID,UUID,TEXT,DATE,DATE,NUMERIC,NUMERIC,INTEGER,TEXT,UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.create_loan_repayment(TEXT,UUID,DATE,NUMERIC,NUMERIC,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_loan_repayment(TEXT,UUID,DATE,NUMERIC,NUMERIC,UUID,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.create_equity_transaction(TEXT,UUID,UUID,TEXT,DATE,TEXT,UUID,NUMERIC,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_equity_transaction(TEXT,UUID,UUID,TEXT,DATE,TEXT,UUID,NUMERIC,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_opening_balance(TEXT,UUID,DATE,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_opening_balance(TEXT,UUID,DATE,JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_opening_balance(TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_opening_balance(TEXT,UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.update_accounting_policy(TEXT,UUID,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_accounting_policy(TEXT,UUID,JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_bank_reconciliation(TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_bank_reconciliation(TEXT,UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.toggle_tax_code(TEXT,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_tax_code(TEXT,UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.create_report_snapshot(TEXT,UUID,TEXT,TEXT,DATE,TEXT,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_report_snapshot(TEXT,UUID,TEXT,TEXT,DATE,TEXT,JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.get_financial_report(UUID,DATE,DATE,UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_report(UUID,DATE,DATE,UUID) TO authenticated;

INSERT INTO public.schema_migrations (version, description)
VALUES ('0008_finops_app3_domain_rpcs', 'Complete App 3 transactional RPCs for purchasing, GRN, inventory revaluation, expenses, assets, loans, equity, opening balances, bank reconciliations, tax codes, and reporting')
ON CONFLICT (version) DO NOTHING;
