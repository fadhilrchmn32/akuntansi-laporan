-- ==============================================================================
-- FINOPS_SHARED_V1 — Migration 0005: App 3 Accounting Engine, Ledger & Domain Extensions
-- Additive-only migration. Jangan jalankan DROP/TRUNCATE.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PERLUASAN MASTER & KONFIGURASI KEBIJAKAN AKUNTANSI (Section B)
-- ------------------------------------------------------------------------------
ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS is_postable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_control_account BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS control_subledger TEXT CHECK (control_subledger IN ('ar', 'ap', 'inventory', 'custody', 'customer_deposit', 'grni')),
  ADD COLUMN IF NOT EXISTS cash_flow_default TEXT CHECK (cash_flow_default IN ('operating', 'investing', 'financing', 'internal_transfer', 'non_cash')),
  ADD COLUMN IF NOT EXISTS parent_code TEXT,
  ADD COLUMN IF NOT EXISTS is_cash_component BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'stocked' CHECK (product_type IN ('stocked', 'non_stock', 'deposit_returnable')),
  ADD COLUMN IF NOT EXISTS deposit_liability_coa TEXT;

CREATE TABLE IF NOT EXISTS public.accounting_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE RESTRICT,
  reporting_framework_name TEXT,
  reporting_framework_status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (reporting_framework_status IN ('unconfigured', 'draft', 'approved')),
  tax_policy_status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (tax_policy_status IN ('unconfigured', 'inactive', 'active_pkp', 'active_non_pkp')),
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  cutover_date DATE,
  is_midyear_cutover BOOLEAN NOT NULL DEFAULT false,
  ytd_hist_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (ytd_hist_status IN ('not_applicable', 'pending', 'verified')),
  cogs_method TEXT NOT NULL DEFAULT 'moving_weighted_average' CHECK (cogs_method IN ('moving_weighted_average')),
  cogs_method_approved BOOLEAN NOT NULL DEFAULT false,
  revenue_recognition_policy TEXT NOT NULL DEFAULT 'on_confirmed_delivery_date',
  rounding_precision INTEGER NOT NULL DEFAULT 0,
  rounding_mode TEXT NOT NULL DEFAULT 'half_up',
  rounding_coa_code TEXT DEFAULT '6901',
  cash_components_approved BOOLEAN NOT NULL DEFAULT false,
  allow_auto_post_deterministic BOOLEAN NOT NULL DEFAULT false,
  unknown_cash_materiality_limit NUMERIC(20,2) NOT NULL DEFAULT 0,
  opening_status TEXT NOT NULL DEFAULT 'incomplete' CHECK (opening_status IN ('incomplete', 'submitted', 'approved')),
  opening_submitted_by UUID REFERENCES public.profiles(id),
  opening_approved_by UUID REFERENCES public.profiles(id),
  opening_approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 2. PERLUASAN LEDGER & IMMUTABILITY GUARDS (Section D)
-- ------------------------------------------------------------------------------
ALTER TABLE public.fiscal_periods
  ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS source_event_id UUID REFERENCES public.accounting_events(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS mapping_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS journal_type TEXT NOT NULL DEFAULT 'auto' CHECK (
    journal_type IN ('auto', 'manual', 'subledger_adjustment', 'opening', 'closing', 'reversal', 'depreciation', 'inventory_revaluation')
  ),
  ADD COLUMN IF NOT EXISTS reversal_of_id UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversed_by_id UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fiscal_period_id UUID REFERENCES public.fiscal_periods(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS correlation_id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS collector_staff_id UUID REFERENCES public.staff(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fund_account_id UUID REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cash_flow_category TEXT CHECK (
    cash_flow_category IN ('operating', 'investing', 'financing', 'internal_transfer', 'non_cash', 'unclassified')
  ),
  ADD COLUMN IF NOT EXISTS source_detail JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_journal_line_single_side') THEN
    ALTER TABLE public.journal_lines
      ADD CONSTRAINT chk_journal_line_single_side CHECK (
        (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
      );
  END IF;
END $$;

-- Trigger imutabilitas: jurnal posted/reversed tidak dapat diedit atau dihapus langsung
CREATE OR REPLACE FUNCTION private.guard_immutable_journal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'Jurnal yang sudah terposting/dibalik bersifat immutable dan tidak boleh dihapus.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'reversed' THEN
      RAISE EXCEPTION 'Jurnal yang sudah dibalik tidak boleh diubah.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'posted' THEN
      -- Hanya izinkan transisi posted -> reversed dengan mengisi reversed_by_id
      IF NEW.status = 'reversed' AND NEW.reversed_by_id IS NOT NULL
         AND NEW.total_debit = OLD.total_debit
         AND NEW.total_credit = OLD.total_credit
         AND NEW.accounting_date = OLD.accounting_date
         AND NEW.effective_date = OLD.effective_date THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Jurnal terposting bersifat immutable. Gunakan fungsi reversal berizin.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_immutable_journal_entries ON public.journal_entries;
CREATE TRIGGER trg_guard_immutable_journal_entries
  BEFORE UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION private.guard_immutable_journal();

CREATE OR REPLACE FUNCTION private.guard_immutable_journal_line()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.journal_entries WHERE id = COALESCE(OLD.journal_entry_id, NEW.journal_entry_id);
  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Baris jurnal terposting/dibalik tidak dapat dimodifikasi atau dihapus.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_immutable_journal_lines ON public.journal_lines;
CREATE TRIGGER trg_guard_immutable_journal_lines
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION private.guard_immutable_journal_line();

-- ------------------------------------------------------------------------------
-- 3. PERLUASAN PEMBELIAN, STOK, BIAYA, ASET, PINJAMAN, PAJAK & OPENING (Section E, F)
-- ------------------------------------------------------------------------------
ALTER TABLE public.purchase_documents
  ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'purchase_invoice' CHECK (doc_type IN ('purchase_invoice', 'purchase_return', 'freight_bill')),
  ADD COLUMN IF NOT EXISTS payment_terms_type TEXT NOT NULL DEFAULT 'credit' CHECK (payment_terms_type IN ('cash', 'credit')),
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS goods_receipt_id UUID REFERENCES public.goods_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_code_id UUID,
  ADD COLUMN IF NOT EXISTS is_prepayment_exception BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid')),
  ADD COLUMN IF NOT EXISTS accounting_status TEXT NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE public.purchase_lines
  ADD COLUMN IF NOT EXISTS unit_code TEXT NOT NULL DEFAULT 'PCS',
  ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(20,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goods_receipt_line_id UUID;

ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS purchase_document_id UUID REFERENCES public.purchase_documents(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS accounting_status TEXT NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.goods_receipt_lines
  ADD COLUMN IF NOT EXISTS unit_code TEXT NOT NULL DEFAULT 'PCS',
  ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(20,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS condition_status TEXT NOT NULL DEFAULT 'good' CHECK (condition_status IN ('good', 'damaged'));

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS reference_no TEXT,
  ADD COLUMN IF NOT EXISTS evidence_path TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS accounting_status TEXT NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS unit_code TEXT NOT NULL DEFAULT 'PCS',
  ADD COLUMN IF NOT EXISTS base_quantity NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_qty_after NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_value_after NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_cost_after NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS condition_status TEXT NOT NULL DEFAULT 'good' CHECK (condition_status IN ('good', 'damaged')),
  ADD COLUMN IF NOT EXISTS sales_line_id UUID REFERENCES public.sales_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS original_cost_ref_id UUID;

CREATE TABLE IF NOT EXISTS public.inventory_revaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  effective_from_date DATE NOT NULL,
  reason TEXT NOT NULL,
  old_avg_cost NUMERIC(20,6) NOT NULL,
  new_avg_cost NUMERIC(20,6) NOT NULL,
  remaining_stock_impact NUMERIC(20,2) NOT NULL DEFAULT 0,
  cogs_impact NUMERIC(20,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted')),
  created_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_documents
  ADD COLUMN IF NOT EXISTS expense_mode TEXT NOT NULL DEFAULT 'direct_paid' CHECK (expense_mode IN ('direct_paid', 'accrued', 'prepaid', 'accrual_settlement')),
  ADD COLUMN IF NOT EXISTS paid_date DATE,
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS vendor_name TEXT,
  ADD COLUMN IF NOT EXISTS fund_account_id UUID REFERENCES public.fund_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS accrued_expense_id UUID REFERENCES public.expense_documents(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS tax_code_id UUID,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS evidence_path TEXT,
  ADD COLUMN IF NOT EXISTS accounting_status TEXT NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ready_to_use_date DATE,
  ADD COLUMN IF NOT EXISTS residual_value NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS depreciation_method TEXT NOT NULL DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line')),
  ADD COLUMN IF NOT EXISTS asset_coa_code TEXT NOT NULL DEFAULT '1201',
  ADD COLUMN IF NOT EXISTS accum_depr_coa_code TEXT NOT NULL DEFAULT '1202',
  ADD COLUMN IF NOT EXISTS depr_expense_coa_code TEXT NOT NULL DEFAULT '6201',
  ADD COLUMN IF NOT EXISTS fund_account_id UUID REFERENCES public.fund_accounts(id),
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS disposal_date DATE,
  ADD COLUMN IF NOT EXISTS disposal_proceeds NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS accumulated_depreciation NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.depreciation_runs
  ADD COLUMN IF NOT EXISTS fixed_asset_id UUID REFERENCES public.fixed_assets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS run_date DATE,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES public.journal_entries(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_depreciation_asset_period') THEN
    ALTER TABLE public.depreciation_runs
      ADD CONSTRAINT uq_depreciation_asset_period UNIQUE (company_id, fixed_asset_id, period_code);
  END IF;
END $$;

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS disbursement_date DATE,
  ADD COLUMN IF NOT EXISTS maturity_date DATE,
  ADD COLUMN IF NOT EXISTS annual_interest_rate NUMERIC(10,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_principal NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fund_account_id UUID REFERENCES public.fund_accounts(id),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.equity_transactions
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS party_name TEXT,
  ADD COLUMN IF NOT EXISTS fund_account_id UUID REFERENCES public.fund_accounts(id),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.tax_codes
  ADD COLUMN IF NOT EXISTS effective_date DATE NOT NULL DEFAULT DATE '2026-01-01',
  ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('inclusive', 'exclusive')),
  ADD COLUMN IF NOT EXISTS is_recoverable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rounding_mode TEXT NOT NULL DEFAULT 'half_up',
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'output' CHECK (direction IN ('input', 'output', 'withholding'));

ALTER TABLE public.opening_balances
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fund_account_id UUID REFERENCES public.fund_accounts(id),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id);

ALTER TABLE public.opening_subledger_items
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reference_no TEXT,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS qty NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS provenance TEXT NOT NULL DEFAULT 'opening',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE public.bank_reconciliations
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS statement_opening_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS book_opening_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_deposits NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_payments NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unrecorded_bank_charges NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unrecorded_interest NUMERIC(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id);

ALTER TABLE public.report_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS snapshot_status TEXT NOT NULL DEFAULT 'draft' CHECK (snapshot_status IN ('draft', 'final_internal', 'superseded')),
  ADD COLUMN IF NOT EXISTS as_of_date DATE,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

CREATE TABLE IF NOT EXISTS public.worker_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  worker_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  held_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT
);

-- Aktifkan RLS pada tabel baru
ALTER TABLE public.accounting_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_policies FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounting_policies FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.accounting_policies FROM authenticated;
GRANT SELECT ON TABLE public.accounting_policies TO authenticated;
CREATE POLICY accounting_policies_select ON public.accounting_policies
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));

ALTER TABLE public.inventory_revaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_revaluations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_revaluations FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.inventory_revaluations FROM authenticated;
GRANT SELECT ON TABLE public.inventory_revaluations TO authenticated;
CREATE POLICY inventory_revaluations_select ON public.inventory_revaluations
  FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));

ALTER TABLE public.worker_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.worker_runs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.worker_runs FROM authenticated;
GRANT SELECT ON TABLE public.worker_runs TO authenticated;
CREATE POLICY worker_runs_select ON public.worker_runs
  FOR SELECT TO authenticated USING (company_id IS NULL OR private.is_company_member(company_id));

-- Kebijakan SELECT untuk tabel App 3 yang sudah ada di 0001
CREATE POLICY coa_select ON public.chart_of_accounts FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY mappings_select ON public.account_mappings FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY fiscal_periods_select ON public.fiscal_periods FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY journal_entries_select ON public.journal_entries FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));
CREATE POLICY journal_lines_select ON public.journal_lines FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.id = journal_lines.journal_entry_id));
CREATE POLICY journal_source_links_select ON public.journal_source_links FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY products_select ON public.products FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY product_units_select ON public.product_units FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY purchase_docs_select ON public.purchase_documents FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));
CREATE POLICY purchase_lines_select ON public.purchase_lines FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY goods_receipts_select ON public.goods_receipts FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));
CREATE POLICY goods_receipt_lines_select ON public.goods_receipt_lines FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY supplier_payments_select ON public.supplier_payments FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));
CREATE POLICY supplier_allocations_select ON public.supplier_allocations FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY inventory_movements_select ON public.inventory_movements FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));
CREATE POLICY inventory_valuations_select ON public.inventory_valuations FOR SELECT TO authenticated USING (private.has_branch_access(company_id, branch_id));
CREATE POLICY expense_documents_select ON public.expense_documents FOR SELECT TO authenticated USING (
  private.has_branch_access(company_id, branch_id) AND private.has_company_role(company_id, ARRAY['accountant','accounting_approver','finance_checker','owner_viewer','system_admin'])
);
CREATE POLICY fixed_assets_select ON public.fixed_assets FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY depreciation_runs_select ON public.depreciation_runs FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY loans_select ON public.loans FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY equity_transactions_select ON public.equity_transactions FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY tax_codes_select ON public.tax_codes FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY opening_balances_select ON public.opening_balances FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY opening_subledger_select ON public.opening_subledger_items FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY report_snapshots_select ON public.report_snapshots FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY period_close_checks_select ON public.period_close_checks FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY bank_reconciliations_select ON public.bank_reconciliations FOR SELECT TO authenticated USING (private.is_company_member(company_id));

-- ------------------------------------------------------------------------------
-- 4. HELPER LOCKING PERIODE & POSTING ATOMIK TERPUSAT
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.lock_open_fiscal_period(
  p_company_id UUID,
  p_accounting_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period public.fiscal_periods%ROWTYPE;
BEGIN
  SELECT * INTO v_period
  FROM public.fiscal_periods
  WHERE company_id = p_company_id
    AND p_accounting_date BETWEEN start_date AND end_date
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Periode fiskal untuk tanggal % belum dikonfigurasi.', p_accounting_date USING ERRCODE = '22023';
  END IF;

  IF v_period.status <> 'open' THEN
    RAISE EXCEPTION 'Periode % berstatus %. Posting atau perubahan ke periode terkunci ditolak.', v_period.period_code, v_period.status USING ERRCODE = '42501';
  END IF;

  RETURN v_period.id;
END;
$$;

CREATE OR REPLACE FUNCTION private.resolve_mapped_coa(
  p_company_id UUID,
  p_mapping_version TEXT,
  p_event_type TEXT,
  p_role_key TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coa_code
  FROM public.account_mappings
  WHERE company_id = p_company_id
    AND mapping_version = p_mapping_version
    AND event_type = p_event_type
    AND role_key = p_role_key
    AND is_active = true
  LIMIT 1;
$$;

-- ------------------------------------------------------------------------------
-- 5. RPC: post_accounting_event (Mesin Event Terpusat)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_accounting_event(
  p_idempotency_key TEXT,
  p_accounting_event_id UUID,
  p_force_status TEXT DEFAULT NULL -- NULL mengikuti kebijakan auto_post; 'draft' atau 'posted'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_cached JSONB;
  v_ev public.accounting_events%ROWTYPE;
  v_pol public.accounting_policies%ROWTYPE;
  v_period_id UUID;
  v_existing_je UUID;
  v_je_id UUID;
  v_je_no TEXT;
  v_target_status TEXT;
  v_lines JSONB := '[]'::jsonb;
  v_line JSONB;
  v_line_no INTEGER := 0;
  v_sum_debit NUMERIC(20,2) := 0;
  v_sum_credit NUMERIC(20,2) := 0;
  v_coa_bank TEXT := '1103';
  v_coa_office_cash TEXT := '1101';
  v_coa_custody TEXT := '1102';
  v_coa_ar TEXT := '1104';
  v_coa_inv TEXT := '1105';
  v_coa_ap TEXT := '2101';
  v_coa_deposit TEXT := '2102';
  v_coa_unid TEXT := '2103';
  v_coa_grni TEXT := '2106';
  v_coa_accrued TEXT := '2107';
  v_coa_sales TEXT := '4101';
  v_coa_cogs TEXT := '5101';
  v_coa_bank_fee TEXT := '6109';
  v_amt NUMERIC(20,2);
  v_net NUMERIC(20,2);
  v_fee NUMERIC(20,2);
  v_gross NUMERIC(20,2);
  v_cogs NUMERIC(20,2);
  v_dep_unposted INTEGER;
  v_is_worker BOOLEAN := COALESCE(current_setting('app3.worker_active', true), '') = 'true';
  v_eff_actor UUID;
  v_fund_coa TEXT;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL AND NOT v_is_worker THEN
    RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501';
  END IF;
  v_eff_actor := COALESCE(v_actor_id, '00000000-0000-0000-0000-000000000000'::UUID);
  v_cached := private.check_idempotency(v_eff_actor, 'post_accounting_event', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_ev FROM public.accounting_events WHERE id = p_accounting_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event akuntansi tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT v_is_worker AND NOT private.has_branch_role(v_ev.company_id, v_ev.branch_id, ARRAY['accountant', 'accounting_approver', 'system_admin']) THEN
    RAISE EXCEPTION 'Izin ditolak untuk memproses event akuntansi.' USING ERRCODE = '42501';
  END IF;

  -- Idempotensi source event: jika sudah ada journal_source_links, kembalikan jurnal existing
  SELECT journal_entry_id INTO v_existing_je
  FROM public.journal_source_links WHERE accounting_event_id = v_ev.id LIMIT 1;
  IF v_existing_je IS NOT NULL THEN
    v_result := jsonb_build_object('accounting_event_id', v_ev.id, 'journal_entry_id', v_existing_je, 'status', v_ev.processing_status, 'idempotent_hit', true);
    PERFORM private.save_idempotency(v_ev.company_id, v_eff_actor, 'post_accounting_event', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  -- Cek dependensi event belum terposting
  IF array_length(v_ev.dependency_ids, 1) > 0 THEN
    SELECT count(*) INTO v_dep_unposted
    FROM public.accounting_events d
    WHERE d.id = ANY(v_ev.dependency_ids) AND d.processing_status <> 'posted';
    IF v_dep_unposted > 0 THEN
      UPDATE public.accounting_events
      SET processing_status = 'failed',
          error_message = 'Menunggu ' || v_dep_unposted || ' event dependensi selesai diposting.',
          retry_count = retry_count + 1,
          updated_at = now()
      WHERE id = v_ev.id;
      RAISE EXCEPTION 'Event ditahan karena % dependensi belum terposting.', v_dep_unposted USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT * INTO v_pol FROM public.accounting_policies WHERE company_id = v_ev.company_id;
  v_period_id := private.lock_open_fiscal_period(v_ev.company_id, v_ev.effective_date);

  IF p_force_status = 'posted' THEN
    IF NOT private.has_branch_role(v_ev.company_id, v_ev.branch_id, ARRAY['accounting_approver']) THEN
      RAISE EXCEPTION 'Hanya accounting_approver yang dapat langsung memposting jurnal.' USING ERRCODE = '42501';
    END IF;
    v_target_status := 'posted';
  ELSIF COALESCE(v_pol.allow_auto_post_deterministic, false) = true AND v_pol.opening_status = 'approved' THEN
    v_target_status := 'posted';
  ELSE
    v_target_status := 'draft';
  END IF;

  -- Bangun baris jurnal sesuai recipe kanonis FINOPS_SHARED_V1
  IF v_ev.event_type = 'receipt_transfer_verified' THEN
    v_gross := (v_ev.payload_snapshot->>'customer_gross_amount')::NUMERIC(20,2);
    v_net := (v_ev.payload_snapshot->>'bank_net_amount')::NUMERIC(20,2);
    v_fee := COALESCE((v_ev.payload_snapshot->>'bank_fee_amount')::NUMERIC(20,2), 0);
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_bank, 'debit', v_net, 'credit', 0, 'cash_flow_category', 'operating', 'memo', 'Penerimaan transfer bank'),
      jsonb_build_object('coa_code', v_coa_deposit, 'debit', 0, 'credit', v_gross - CASE WHEN (v_ev.payload_snapshot->>'bank_fee_bearer') = 'company' THEN 0 ELSE v_fee END, 'cash_flow_category', 'operating', 'memo', 'Titipan pelanggan terverifikasi')
    );
    IF v_fee > 0 AND (v_ev.payload_snapshot->>'bank_fee_bearer') = 'company' THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('coa_code', v_coa_bank_fee, 'debit', v_fee, 'credit', 0, 'cash_flow_category', 'operating', 'memo', 'Biaya administrasi bank ditanggung perusahaan')
      );
    END IF;
  ELSIF v_ev.event_type = 'receipt_cash_verified' THEN
    v_amt := (v_ev.payload_snapshot->>'verified_amount')::NUMERIC(20,2);
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_custody, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'operating', 'memo', 'Kas diterima penagih'),
      jsonb_build_object('coa_code', v_coa_deposit, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'operating', 'memo', 'Titipan pelanggan tunai')
    );
  ELSIF v_ev.event_type = 'receipt_unidentified_verified' THEN
    v_amt := (v_ev.payload_snapshot->>'verified_amount')::NUMERIC(20,2);
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_bank, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'unclassified', 'memo', 'Dana masuk belum teridentifikasi'),
      jsonb_build_object('coa_code', v_coa_unid, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'unclassified', 'memo', 'Penerimaan belum teridentifikasi')
    );
  ELSIF v_ev.event_type = 'receipt_identity_resolved' THEN
    v_amt := (v_ev.payload_snapshot->>'amount')::NUMERIC(20,2);
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_unid, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'non_cash', 'memo', 'Reklasifikasi identitas pengirim disahkan'),
      jsonb_build_object('coa_code', v_coa_deposit, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'non_cash', 'memo', 'Titipan pelanggan teridentifikasi')
    );
  ELSIF v_ev.event_type = 'payment_allocated' THEN
    v_amt := (v_ev.payload_snapshot->>'allocated_amount')::NUMERIC(20,2);
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_deposit, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'non_cash', 'memo', 'Alokasi titipan ke piutang nota'),
      jsonb_build_object('coa_code', v_coa_ar, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'non_cash', 'memo', 'Pelunasan piutang usaha')
    );
  ELSIF v_ev.event_type = 'cash_deposit_office_accepted' THEN
    v_amt := (v_ev.payload_snapshot->>'received_amount')::NUMERIC(20,2);
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_office_cash, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'internal_transfer', 'memo', 'Setoran tunai diterima kas kantor'),
      jsonb_build_object('coa_code', v_coa_custody, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'internal_transfer', 'memo', 'Pengurangan kas di penagih')
    );
  ELSIF v_ev.event_type = 'cash_deposit_direct_bank_accepted' THEN
    v_amt := (v_ev.payload_snapshot->>'received_amount')::NUMERIC(20,2);
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_bank, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'internal_transfer', 'memo', 'Setoran langsung penagih masuk bank'),
      jsonb_build_object('coa_code', v_coa_custody, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'internal_transfer', 'memo', 'Pengurangan kas di penagih')
    );
  ELSIF v_ev.event_type = 'internal_fund_transfer_approved' THEN
    v_amt := (v_ev.payload_snapshot->>'amount')::NUMERIC(20,2);
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_bank, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'internal_transfer', 'memo', 'Transfer kas internal masuk'),
      jsonb_build_object('coa_code', v_coa_office_cash, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'internal_transfer', 'memo', 'Transfer kas internal keluar')
    );
  ELSIF v_ev.event_type = 'sales_delivery_recognized' THEN
    v_amt := (v_ev.payload_snapshot->>'total_amount')::NUMERIC(20,2);
    v_cogs := COALESCE((v_ev.payload_snapshot->>'cogs_amount')::NUMERIC(20,2), 0);
    IF COALESCE((v_ev.payload_snapshot->>'has_stocked_items')::BOOLEAN, true) = true AND v_cogs <= 0 THEN
      UPDATE public.accounting_events
      SET processing_status = 'failed',
          error_message = 'HPP barang stok belum tersedia atau bernilai nol. Lengkapi saldo awal/penerimaan barang sebelum posting penjualan.',
          retry_count = retry_count + 1,
          updated_at = now()
      WHERE id = v_ev.id;
      RAISE EXCEPTION 'Penjualan ditahan: nilai HPP sah wajib tersedia sebelum posting penjualan+HPP.' USING ERRCODE = '22023';
    END IF;
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_ar, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'non_cash', 'memo', 'Pengakuan piutang penjualan'),
      jsonb_build_object('coa_code', v_coa_sales, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'non_cash', 'memo', 'Pengakuan pendapatan penjualan'),
      jsonb_build_object('coa_code', v_coa_cogs, 'debit', v_cogs, 'credit', 0, 'cash_flow_category', 'non_cash', 'memo', 'Beban pokok penjualan (HPP)'),
      jsonb_build_object('coa_code', v_coa_inv, 'debit', 0, 'credit', v_cogs, 'cash_flow_category', 'non_cash', 'memo', 'Pengurangan persediaan')
    );
  ELSIF v_ev.event_type = 'goods_receipt_posted' THEN
    v_amt := (v_ev.payload_snapshot->>'total_estimated_cost')::NUMERIC(20,2);
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_inv, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'non_cash', 'memo', 'Penerimaan barang masuk persediaan'),
      jsonb_build_object('coa_code', v_coa_grni, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'non_cash', 'memo', 'GRNI (Barang diterima belum ditagih)')
    );
  ELSIF v_ev.event_type = 'purchase_invoice_approved' THEN
    v_amt := (v_ev.payload_snapshot->>'total_amount')::NUMERIC(20,2);
    IF COALESCE((v_ev.payload_snapshot->>'clears_grni')::BOOLEAN, false) = true THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('coa_code', v_coa_grni, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'non_cash', 'memo', 'Clearing GRNI oleh invoice pemasok'),
        jsonb_build_object('coa_code', v_coa_ap, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'non_cash', 'memo', 'Pengakuan utang usaha')
      );
    ELSE
      v_lines := jsonb_build_array(
        jsonb_build_object('coa_code', v_coa_inv, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'non_cash', 'memo', 'Pembelian persediaan'),
        jsonb_build_object('coa_code', v_coa_ap, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'non_cash', 'memo', 'Utang usaha pemasok')
      );
    END IF;
  ELSIF v_ev.event_type = 'supplier_payment_approved' THEN
    v_amt := (v_ev.payload_snapshot->>'amount')::NUMERIC(20,2);
    SELECT COALESCE(coa_account_code, v_coa_bank) INTO v_fund_coa
    FROM public.fund_accounts WHERE id = NULLIF(v_ev.payload_snapshot->>'fund_account_id', '')::UUID;
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_code', v_coa_ap, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'operating', 'memo', 'Pembayaran utang pemasok'),
      jsonb_build_object('coa_code', COALESCE(v_fund_coa, v_coa_bank), 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'operating', 'memo', 'Kas/Bank keluar untuk pemasok', 'fund_account_id', v_ev.payload_snapshot->>'fund_account_id')
    );
  ELSIF v_ev.event_type = 'expense_approved' THEN
    v_amt := (v_ev.payload_snapshot->>'amount')::NUMERIC(20,2);
    SELECT COALESCE(coa_account_code, v_coa_bank) INTO v_fund_coa
    FROM public.fund_accounts WHERE id = NULLIF(v_ev.payload_snapshot->>'fund_account_id', '')::UUID;
    IF (v_ev.payload_snapshot->>'expense_mode') = 'accrued' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('coa_code', v_ev.payload_snapshot->>'category_coa', 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'non_cash', 'memo', 'Pengakuan beban akrual'),
        jsonb_build_object('coa_code', v_coa_accrued, 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'non_cash', 'memo', 'Utang biaya')
      );
    ELSIF (v_ev.payload_snapshot->>'expense_mode') = 'accrual_settlement' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('coa_code', v_coa_accrued, 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'operating', 'memo', 'Pelunasan utang biaya'),
        jsonb_build_object('coa_code', COALESCE(v_fund_coa, v_coa_bank), 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'operating', 'memo', 'Pengeluaran kas/bank', 'fund_account_id', v_ev.payload_snapshot->>'fund_account_id')
      );
    ELSIF (v_ev.payload_snapshot->>'expense_mode') = 'prepaid' THEN
      v_lines := jsonb_build_array(
        jsonb_build_object('coa_code', '1106', 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'operating', 'memo', 'Beban dibayar di muka (Prepaid)'),
        jsonb_build_object('coa_code', COALESCE(v_fund_coa, v_coa_bank), 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'operating', 'memo', 'Pengeluaran kas/bank', 'fund_account_id', v_ev.payload_snapshot->>'fund_account_id')
      );
    ELSE
      v_lines := jsonb_build_array(
        jsonb_build_object('coa_code', v_ev.payload_snapshot->>'category_coa', 'debit', v_amt, 'credit', 0, 'cash_flow_category', 'operating', 'memo', 'Beban operasional dibayar langsung'),
        jsonb_build_object('coa_code', COALESCE(v_fund_coa, v_coa_bank), 'debit', 0, 'credit', v_amt, 'cash_flow_category', 'operating', 'memo', 'Pengeluaran kas/bank', 'fund_account_id', v_ev.payload_snapshot->>'fund_account_id')
      );
    END IF;
  ELSE
    RAISE EXCEPTION 'Event type % belum memiliki recipe posting.', v_ev.event_type USING ERRCODE = '22023';
  END IF;

  -- Validasi keseimbangan debit = kredit sebelum insert
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    v_sum_debit := v_sum_debit + COALESCE((v_line->>'debit')::NUMERIC(20,2), 0);
    v_sum_credit := v_sum_credit + COALESCE((v_line->>'credit')::NUMERIC(20,2), 0);
  END LOOP;

  IF v_sum_debit <= 0 OR v_sum_debit <> v_sum_credit THEN
    RAISE EXCEPTION 'Jurnal tidak seimbang: debit (%) != kredit (%).', v_sum_debit, v_sum_credit USING ERRCODE = '22023';
  END IF;

  v_je_no := private.next_document_number(v_ev.company_id, 'journal_entry', 'JRN', v_ev.effective_date);

  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_number, accounting_date, effective_date,
    description, status, total_debit, total_credit,
    source_event_id, source_type, source_id, mapping_version, journal_type,
    fiscal_period_id, created_by, approved_by, posted_at, correlation_id
  ) VALUES (
    v_ev.company_id, v_ev.branch_id, v_je_no, v_ev.effective_date, v_ev.effective_date,
    'Auto-event: ' || v_ev.event_type || ' (' || COALESCE(v_ev.payload_snapshot->>'receipt_number', v_ev.source_id::TEXT) || ')',
    v_target_status, v_sum_debit, v_sum_credit,
    v_ev.id, v_ev.source_type, v_ev.source_id, v_ev.mapping_version, 'auto',
    v_period_id, COALESCE(v_actor_id, v_ev.created_by),
    CASE WHEN v_target_status = 'posted' THEN COALESCE(v_actor_id, v_ev.created_by) ELSE NULL END,
    CASE WHEN v_target_status = 'posted' THEN now() ELSE NULL END,
    v_ev.correlation_id
  )
  RETURNING id INTO v_je_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      company_id, journal_entry_id, line_no, coa_code, debit, credit, memo,
      branch_id, customer_id, supplier_id, collector_staff_id, fund_account_id, cash_flow_category
    ) VALUES (
      v_ev.company_id, v_je_id, v_line_no, v_line->>'coa_code',
      COALESCE((v_line->>'debit')::NUMERIC(20,2), 0),
      COALESCE((v_line->>'credit')::NUMERIC(20,2), 0),
      v_line->>'memo', v_ev.branch_id,
      NULLIF(v_ev.payload_snapshot->>'customer_id', '')::UUID,
      NULLIF(v_ev.payload_snapshot->>'supplier_id', '')::UUID,
      NULLIF(v_ev.payload_snapshot->>'collector_staff_id', '')::UUID,
      COALESCE(NULLIF(v_line->>'fund_account_id', '')::UUID, NULLIF(v_ev.payload_snapshot->>'fund_account_id', '')::UUID),
      v_line->>'cash_flow_category'
    );
  END LOOP;

  INSERT INTO public.journal_source_links (company_id, journal_entry_id, accounting_event_id, source_type, source_id)
  VALUES (v_ev.company_id, v_je_id, v_ev.id, v_ev.source_type, v_ev.source_id);

  UPDATE public.accounting_events
  SET processing_status = CASE WHEN v_target_status = 'posted' THEN 'posted' ELSE 'draft_journal' END,
      error_message = NULL,
      updated_at = now()
  WHERE id = v_ev.id;

  PERFORM private.write_audit_event(
    v_ev.company_id, v_ev.branch_id, COALESCE(v_actor_id, v_ev.created_by), 'accounting.post_event', 'journal_entry', v_je_id,
    NULL, jsonb_build_object('journal_number', v_je_no, 'status', v_target_status, 'amount', v_sum_debit),
    'Event ' || v_ev.event_type || ' diproses ke jurnal'
  );

  v_result := jsonb_build_object(
    'accounting_event_id', v_ev.id,
    'journal_entry_id', v_je_id,
    'journal_number', v_je_no,
    'status', v_target_status,
    'total_debit', v_sum_debit
  );
  PERFORM private.save_idempotency(v_ev.company_id, v_eff_actor, 'post_accounting_event', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. RPC: approve_manual_journal & reverse_journal
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_manual_journal(
  p_idempotency_key TEXT,
  p_journal_entry_id UUID,
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
  v_je public.journal_entries%ROWTYPE;
  v_period_id UUID;
  v_sum_d NUMERIC(20,2);
  v_sum_c NUMERIC(20,2);
  v_cnt INTEGER;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'approve_manual_journal', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_je FROM public.journal_entries WHERE id = p_journal_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jurnal tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_je.company_id, v_je.branch_id, ARRAY['accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya accounting_approver yang dapat menyetujui posting jurnal.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_je.created_by, v_actor_id, 'jurnal');

  IF v_je.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi jurnal.' USING ERRCODE = '40001'; END IF;
  IF v_je.status <> 'draft' THEN RAISE EXCEPTION 'Hanya jurnal draft yang dapat disetujui.' USING ERRCODE = '22023'; END IF;

  v_period_id := private.lock_open_fiscal_period(v_je.company_id, v_je.accounting_date);

  SELECT count(*), COALESCE(sum(debit), 0), COALESCE(sum(credit), 0)
  INTO v_cnt, v_sum_d, v_sum_c
  FROM public.journal_lines WHERE journal_entry_id = v_je.id;

  IF v_cnt < 2 OR v_sum_d <= 0 OR v_sum_d <> v_sum_c THEN
    RAISE EXCEPTION 'Validasi baris jurnal gagal: minimal 2 baris dan total debit (%) harus sama dengan kredit (%).', v_sum_d, v_sum_c USING ERRCODE = '22023';
  END IF;

  UPDATE public.journal_entries
  SET status = 'posted',
      total_debit = v_sum_d,
      total_credit = v_sum_c,
      fiscal_period_id = v_period_id,
      approved_by = v_actor_id,
      posted_at = now(),
      version = version + 1
  WHERE id = v_je.id;

  IF v_je.source_event_id IS NOT NULL THEN
    UPDATE public.accounting_events SET processing_status = 'posted', updated_at = now() WHERE id = v_je.source_event_id;
  END IF;

  INSERT INTO public.approvals (company_id, branch_id, target_type, target_id, action, decision, actor_id, reason)
  VALUES (v_je.company_id, v_je.branch_id, 'journal_entry', v_je.id, 'approve_manual_journal', 'approved', v_actor_id, 'Disetujui untuk posting');

  v_result := jsonb_build_object('journal_entry_id', v_je.id, 'status', 'posted', 'version', v_je.version + 1);
  PERFORM private.save_idempotency(v_je.company_id, v_actor_id, 'approve_manual_journal', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_journal(
  p_idempotency_key TEXT,
  p_journal_entry_id UUID,
  p_reversal_date DATE,
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
  v_orig public.journal_entries%ROWTYPE;
  v_period_id UUID;
  v_rev_id UUID;
  v_rev_no TEXT;
  v_line RECORD;
  v_line_no INTEGER := 0;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'reverse_journal', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Alasan pembalikan jurnal wajib diisi jelas.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_orig FROM public.journal_entries WHERE id = p_journal_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jurnal asal tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_branch_role(v_orig.company_id, v_orig.branch_id, ARRAY['accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya accounting_approver yang dapat membalik jurnal.' USING ERRCODE = '42501';
  END IF;

  IF v_orig.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya jurnal terposting yang dapat dibalik.' USING ERRCODE = '22023';
  END IF;

  IF v_orig.reversed_by_id IS NOT NULL THEN
    RAISE EXCEPTION 'Jurnal ini sudah pernah dibalik.' USING ERRCODE = '22023';
  END IF;

  v_period_id := private.lock_open_fiscal_period(v_orig.company_id, p_reversal_date);
  v_rev_no := private.next_document_number(v_orig.company_id, 'journal_reversal', 'REV', p_reversal_date);

  INSERT INTO public.journal_entries (
    company_id, branch_id, journal_number, accounting_date, effective_date,
    description, status, total_debit, total_credit,
    source_type, source_id, mapping_version, journal_type,
    reversal_of_id, fiscal_period_id, created_by, approved_by, posted_at, reason
  ) VALUES (
    v_orig.company_id, v_orig.branch_id, v_rev_no, p_reversal_date, p_reversal_date,
    'Reversal ' || v_orig.journal_number || ': ' || p_reason, 'posted', v_orig.total_credit, v_orig.total_debit,
    v_orig.source_type, v_orig.source_id, v_orig.mapping_version, 'reversal',
    v_orig.id, v_period_id, v_actor_id, v_actor_id, now(), p_reason
  )
  RETURNING id INTO v_rev_id;

  FOR v_line IN SELECT * FROM public.journal_lines WHERE journal_entry_id = v_orig.id ORDER BY line_no LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      company_id, journal_entry_id, line_no, coa_code, debit, credit, memo,
      branch_id, customer_id, supplier_id, collector_staff_id, product_id, fund_account_id, cash_flow_category
    ) VALUES (
      v_orig.company_id, v_rev_id, v_line_no, v_line.coa_code, v_line.credit, v_line.debit,
      'Reversal: ' || COALESCE(v_line.memo, ''),
      v_line.branch_id, v_line.customer_id, v_line.supplier_id, v_line.collector_staff_id,
      v_line.product_id, v_line.fund_account_id, v_line.cash_flow_category
    );
  END LOOP;

  UPDATE public.journal_entries
  SET status = 'reversed', reversed_by_id = v_rev_id
  WHERE id = v_orig.id;

  IF v_orig.source_event_id IS NOT NULL THEN
    UPDATE public.accounting_events SET processing_status = 'reversed', updated_at = now() WHERE id = v_orig.source_event_id;
  END IF;

  PERFORM private.write_audit_event(
    v_orig.company_id, v_orig.branch_id, v_actor_id, 'journal.reverse', 'journal_entry', v_orig.id,
    jsonb_build_object('status', 'posted'), jsonb_build_object('status', 'reversed', 'reversal_id', v_rev_id), p_reason
  );

  v_result := jsonb_build_object('original_journal_id', v_orig.id, 'reversal_journal_id', v_rev_id, 'reversal_number', v_rev_no, 'status', 'reversed');
  PERFORM private.save_idempotency(v_orig.company_id, v_actor_id, 'reverse_journal', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. RPC: close_fiscal_period & reopen_fiscal_period (Section I)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_fiscal_period(
  p_idempotency_key TEXT,
  p_fiscal_period_id UUID,
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
  v_fp public.fiscal_periods%ROWTYPE;
  v_unbalanced INTEGER;
  v_unposted_events INTEGER;
  v_neg_stock INTEGER;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'close_fiscal_period', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_fp FROM public.fiscal_periods WHERE id = p_fiscal_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Periode fiskal tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_company_role(v_fp.company_id, ARRAY['accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya accounting_approver yang dapat menutup periode.' USING ERRCODE = '42501';
  END IF;

  IF v_fp.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi periode.' USING ERRCODE = '40001'; END IF;
  IF v_fp.status = 'closed' THEN RAISE EXCEPTION 'Periode sudah ditutup.' USING ERRCODE = '22023'; END IF;

  -- Cek integritas sebelum tutup buku
  SELECT count(*) INTO v_unbalanced FROM public.journal_entries
  WHERE company_id = v_fp.company_id AND accounting_date BETWEEN v_fp.start_date AND v_fp.end_date
    AND status = 'posted' AND total_debit <> total_credit;

  SELECT count(*) INTO v_unposted_events FROM public.accounting_events
  WHERE company_id = v_fp.company_id AND effective_date BETWEEN v_fp.start_date AND v_fp.end_date
    AND processing_status IN ('waiting_accounting_module', 'queued', 'failed');

  SELECT count(*) INTO v_neg_stock FROM public.inventory_valuations
  WHERE company_id = v_fp.company_id AND qty_on_hand < 0;

  IF v_unbalanced > 0 OR v_unposted_events > 0 OR v_neg_stock > 0 THEN
    RAISE EXCEPTION 'Tutup buku ditolak: jurnal tidak seimbang (%), event tertahan (%), atau stok negatif (%).', v_unbalanced, v_unposted_events, v_neg_stock USING ERRCODE = '22023';
  END IF;

  UPDATE public.fiscal_periods
  SET status = 'closed', closed_by = v_actor_id, closed_at = now(), version = version + 1
  WHERE id = v_fp.id;

  PERFORM private.write_audit_event(
    v_fp.company_id, NULL, v_actor_id, 'period.close', 'fiscal_period', v_fp.id,
    jsonb_build_object('status', v_fp.status), jsonb_build_object('status', 'closed'), 'Penutupan periode ' || v_fp.period_code
  );

  v_result := jsonb_build_object('fiscal_period_id', v_fp.id, 'period_code', v_fp.period_code, 'status', 'closed', 'version', v_fp.version + 1);
  PERFORM private.save_idempotency(v_fp.company_id, v_actor_id, 'close_fiscal_period', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_fiscal_period(
  p_idempotency_key TEXT,
  p_fiscal_period_id UUID,
  p_expected_version INTEGER,
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
  v_fp public.fiscal_periods%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Autentikasi diperlukan.' USING ERRCODE = '42501'; END IF;
  v_cached := private.check_idempotency(v_actor_id, 'reopen_fiscal_period', p_idempotency_key);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Alasan pembukaan ulang periode wajib diisi minimal 10 karakter.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_fp FROM public.fiscal_periods WHERE id = p_fiscal_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Periode tidak ditemukan.' USING ERRCODE = 'P0002'; END IF;

  IF NOT private.has_company_role(v_fp.company_id, ARRAY['accounting_approver']) THEN
    RAISE EXCEPTION 'Hanya accounting_approver yang dapat membuka ulang periode.' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_maker_checker(v_fp.closed_by, v_actor_id, 'penutupan periode');

  IF v_fp.version <> p_expected_version THEN RAISE EXCEPTION 'Konflik versi.' USING ERRCODE = '40001'; END IF;
  IF v_fp.status <> 'closed' THEN RAISE EXCEPTION 'Periode tidak dalam status tertutup.' USING ERRCODE = '22023'; END IF;

  -- Tandai snapshot laporan periode lama sebagai superseded (tanpa menghapus)
  UPDATE public.report_snapshots
  SET snapshot_status = 'superseded'
  WHERE company_id = v_fp.company_id AND period_code = v_fp.period_code AND snapshot_status <> 'superseded';

  UPDATE public.fiscal_periods
  SET status = 'open', reopened_by = v_actor_id, reopened_at = now(), reopen_reason = p_reason, version = version + 1
  WHERE id = v_fp.id;

  PERFORM private.write_audit_event(
    v_fp.company_id, NULL, v_actor_id, 'period.reopen', 'fiscal_period', v_fp.id,
    jsonb_build_object('status', 'closed'), jsonb_build_object('status', 'open'), p_reason
  );

  v_result := jsonb_build_object('fiscal_period_id', v_fp.id, 'status', 'open', 'version', v_fp.version + 1);
  PERFORM private.save_idempotency(v_fp.company_id, v_actor_id, 'reopen_fiscal_period', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.post_accounting_event(TEXT,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_accounting_event(TEXT,UUID,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.approve_manual_journal(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_manual_journal(TEXT,UUID,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_journal(TEXT,UUID,DATE,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_journal(TEXT,UUID,DATE,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.close_fiscal_period(TEXT,UUID,INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_fiscal_period(TEXT,UUID,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.reopen_fiscal_period(TEXT,UUID,INTEGER,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_fiscal_period(TEXT,UUID,INTEGER,TEXT) TO authenticated;

INSERT INTO public.schema_migrations (version, description)
VALUES ('0005_finops_app3_accounting_engine', 'App 3 double-entry immutable ledger, policies, domain extensions, period locks, and core posting/reversal RPCs')
ON CONFLICT (version) DO NOTHING;
