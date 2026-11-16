export type RoleCode =
  | 'finance_maker'
  | 'finance_checker'
  | 'sales_admin'
  | 'reconciliation_reviewer'
  | 'accountant'
  | 'accounting_approver'
  | 'owner_viewer'
  | 'system_admin'
  | 'collector_optional';

export type AccountGroup = 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';
export type NormalBalance = 'debit' | 'credit';
export type ControlSubledger = 'ar' | 'ap' | 'inventory' | 'custody' | 'customer_deposit' | 'grni';
export type CashFlowCategory =
  | 'operating'
  | 'investing'
  | 'financing'
  | 'internal_transfer'
  | 'non_cash'
  | 'unclassified';

export type JournalStatus = 'draft' | 'posted' | 'reversed';
export type JournalType =
  | 'auto'
  | 'manual'
  | 'subledger_adjustment'
  | 'opening'
  | 'closing'
  | 'reversal'
  | 'depreciation'
  | 'inventory_revaluation';

export type AccountingEventStatus =
  | 'waiting_accounting_module'
  | 'queued'
  | 'draft_journal'
  | 'posted'
  | 'failed'
  | 'reversed';

export type MenuKey =
  | 'ringkasan'
  | 'antrian'
  | 'jurnal'
  | 'buku_besar'
  | 'neraca_saldo'
  | 'piutang_titipan'
  | 'utang_pemasok'
  | 'pembelian_penerimaan'
  | 'persediaan_hpp'
  | 'biaya'
  | 'kas_bank'
  | 'aset_tetap'
  | 'pinjaman_modal'
  | 'pajak'
  | 'laporan'
  | 'tutup_buku'
  | 'audit_pengaturan';

export interface Company {
  id: string;
  code: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  base_currency: string;
  timezone: string;
  is_active: boolean;
}

export interface Branch {
  id: string;
  company_id: string;
  code: string;
  name: string;
  is_headquarters: boolean;
  is_active: boolean;
}

export interface UserSessionProfile {
  user_id: string;
  email: string;
  full_name: string;
  roles: RoleCode[];
  branch_ids: string[];
  all_branches: boolean;
}

export interface AccountingPolicy {
  company_id: string;
  reporting_framework_name: string | null;
  reporting_framework_status: 'unconfigured' | 'draft' | 'approved';
  tax_policy_status: 'unconfigured' | 'inactive' | 'active_pkp' | 'active_non_pkp';
  fiscal_year_start_month: number;
  cutover_date: string | null;
  is_midyear_cutover: boolean;
  ytd_hist_status: 'not_applicable' | 'pending' | 'verified';
  cogs_method: 'moving_weighted_average';
  cogs_method_approved: boolean;
  revenue_recognition_policy: string;
  rounding_precision: number;
  rounding_mode: 'half_up';
  rounding_coa_code: string;
  cash_components_approved: boolean;
  allow_auto_post_deterministic: boolean;
  unknown_cash_materiality_limit: string;
  opening_status: 'incomplete' | 'submitted' | 'approved';
  opening_submitted_by: string | null;
  opening_approved_by: string | null;
  opening_approved_at: string | null;
  worker_configured: boolean;
  app1_url: string | null;
  app2_url: string | null;
  app3_url: string | null;
}

export interface ChartOfAccount {
  id: string;
  company_id: string;
  code: string;
  name: string;
  account_group: AccountGroup;
  normal_balance: NormalBalance;
  is_active: boolean;
  is_postable: boolean;
  is_control_account: boolean;
  control_subledger: ControlSubledger | null;
  cash_flow_default: CashFlowCategory | null;
  is_cash_component: boolean;
}

export interface AccountMapping {
  id: string;
  company_id: string;
  mapping_version: string;
  event_type: string;
  role_key: string;
  coa_code: string;
  is_active: boolean;
}

export interface FiscalPeriod {
  id: string;
  company_id: string;
  period_code: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'soft_closed' | 'closed';
  closed_by: string | null;
  closed_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  version: number;
}

export interface AccountingEvent {
  id: string;
  company_id: string;
  branch_id: string;
  event_type: string;
  source_type: string;
  source_id: string;
  source_version: number;
  effective_date: string;
  payload_snapshot: Record<string, unknown>;
  mapping_version: string;
  dependency_ids: string[];
  processing_status: AccountingEventStatus;
  error_message: string | null;
  retry_count: number;
  created_by: string | null;
  created_at: string;
}

export interface JournalLine {
  id: string;
  journal_entry_id: string;
  line_no: number;
  coa_code: string;
  debit: string;
  credit: string;
  memo: string | null;
  branch_id: string | null;
  customer_id?: string | null;
  supplier_id?: string | null;
  collector_staff_id?: string | null;
  product_id?: string | null;
  fund_account_id?: string | null;
  cash_flow_category: CashFlowCategory;
  source_detail?: string | null;
}

export interface JournalEntry {
  id: string;
  company_id: string;
  branch_id: string;
  journal_number: string;
  accounting_date: string;
  effective_date: string;
  description: string;
  status: JournalStatus;
  total_debit: string;
  total_credit: string;
  source_event_id: string | null;
  source_type: string | null;
  source_id: string | null;
  mapping_version: string;
  journal_type: JournalType;
  reversal_of_id: string | null;
  reversed_by_id: string | null;
  fiscal_period_id: string | null;
  created_by: string | null;
  reviewed_by?: string | null;
  approved_by: string | null;
  posted_at: string | null;
  reason?: string | null;
  version: number;
  created_at: string;
  lines: JournalLine[];
}

export interface FundAccount {
  id: string;
  company_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  account_type: 'bank' | 'office_cash' | 'petty_cash';
  bank_name: string | null;
  account_number: string | null;
  coa_account_code: string | null;
  is_active: boolean;
}

export interface CustodyAccount {
  id: string;
  company_id: string;
  branch_id: string;
  collector_staff_id: string;
  collector_name: string;
  verified_balance: string;
  unverified_reported_balance: string;
  shortage_open_amount: string;
}

export interface Customer {
  id: string;
  company_id: string;
  branch_id: string;
  cust_id: string;
  name: string;
}

export interface Supplier {
  id: string;
  company_id: string;
  supplier_code: string;
  name: string;
  is_active: boolean;
}

export interface Product {
  id: string;
  company_id: string;
  sku: string;
  name: string;
  base_unit: string;
  product_type: 'stocked' | 'non_stock' | 'deposit_returnable';
  is_stocked: boolean;
  deposit_liability_coa?: string | null;
  units: { unit_code: string; conversion_factor: string }[];
}

export interface SalesDocument {
  id: string;
  company_id: string;
  branch_id: string;
  doc_number: string;
  doc_type: 'sales_invoice' | 'credit_note' | 'debit_note';
  customer_id: string;
  invoice_date: string;
  delivery_date: string | null;
  due_date: string | null;
  total_amount: string;
  allocated_amount: string;
  status: string;
  accounting_status: string;
  provenance: 'app2' | 'opening';
  lines: {
    id: string;
    product_id: string;
    unit_code: string;
    quantity: string;
    net_unit_price: string;
    line_total: string;
    cogs_amount: string | null;
  }[];
}

export interface CustomerReceipt {
  id: string;
  company_id: string;
  branch_id: string;
  receipt_number: string;
  receipt_channel: 'bank_transfer' | 'cash';
  customer_id: string | null;
  is_unknown_identity: boolean;
  customer_paid_at: string;
  bank_value_date: string | null;
  verified_amount: string;
  allocated_amount: string;
  refunded_amount: string;
  fund_account_id: string | null;
  actual_collector_id: string | null;
  status: string;
  accounting_status: string;
  evidence_ref: string | null;
}

export interface GoodsReceipt {
  id: string;
  company_id: string;
  branch_id: string;
  grn_number: string;
  supplier_id: string;
  received_date: string;
  status: 'draft' | 'posted';
  invoiced_status: 'uninvoiced' | 'partially_invoiced' | 'invoiced';
  total_estimated_cost: string;
  lines: {
    id: string;
    product_id: string;
    unit_code: string;
    quantity: string;
    conversion_factor: string;
    estimated_unit_cost: string;
    condition_status: 'good' | 'damaged';
  }[];
}

export interface PurchaseDocument {
  id: string;
  company_id: string;
  branch_id: string;
  doc_number: string;
  doc_type: 'purchase_invoice' | 'purchase_return' | 'freight_bill';
  supplier_id: string;
  invoice_date: string;
  due_date: string | null;
  payment_terms_type: 'cash' | 'credit';
  goods_receipt_id: string | null;
  is_prepayment_exception: boolean;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  freight_amount: string;
  total_amount: string;
  paid_amount: string;
  status: 'draft' | 'approved' | 'voided';
  accounting_status: string;
  created_by: string;
  approved_by: string | null;
  lines: {
    id: string;
    product_id: string;
    unit_code: string;
    quantity: string;
    conversion_factor: string;
    unit_cost: string;
    discount_amount: string;
    line_total: string;
  }[];
}

export interface SupplierPayment {
  id: string;
  company_id: string;
  branch_id: string;
  payment_number: string;
  supplier_id: string;
  fund_account_id: string;
  payment_date: string;
  amount: string;
  reference_no: string | null;
  status: 'draft' | 'approved';
  created_by: string;
  approved_by: string | null;
  allocations: { purchase_document_id: string; allocated_amount: string }[];
}

export interface InventoryValuation {
  id: string;
  company_id: string;
  branch_id: string;
  product_id: string;
  qty_on_hand: string;
  avg_unit_cost: string;
  total_value: string;
}

export interface InventoryMovement {
  id: string;
  company_id: string;
  branch_id: string;
  product_id: string;
  movement_date: string;
  direction: 'in' | 'out';
  quantity: string;
  unit_code: string;
  base_quantity: string;
  unit_cost: string;
  total_cost: string;
  balance_qty_after: string;
  balance_value_after: string;
  avg_cost_after: string;
  condition_status: 'good' | 'damaged';
  source_type: string;
  source_id: string;
  sales_line_id?: string | null;
  original_cost_ref_id?: string | null;
}

export interface InventoryRevaluation {
  id: string;
  company_id: string;
  branch_id: string;
  product_id: string;
  effective_from_date: string;
  reason: string;
  old_avg_cost: string;
  new_avg_cost: string;
  remaining_stock_impact: string;
  cogs_impact: string;
  status: 'draft' | 'approved' | 'posted';
  created_by: string;
  approved_by: string | null;
  created_at: string;
}

export interface ExpenseDocument {
  id: string;
  company_id: string;
  branch_id: string;
  doc_number: string;
  expense_mode: 'direct_paid' | 'accrued' | 'prepaid' | 'accrual_settlement';
  expense_date: string;
  paid_date: string | null;
  category_coa: string;
  vendor_name: string;
  fund_account_id: string | null;
  accrued_expense_id: string | null;
  tax_code_id: string | null;
  tax_amount: string;
  net_amount: string;
  amount: string;
  description: string;
  evidence_ref: string | null;
  status: 'draft' | 'approved';
  created_by: string;
  approved_by: string | null;
}

export interface FixedAsset {
  id: string;
  company_id: string;
  branch_id: string;
  asset_code: string;
  name: string;
  acquisition_date: string;
  ready_to_use_date: string;
  cost: string;
  residual_value: string;
  useful_life_months: number;
  depreciation_method: 'straight_line';
  location: string;
  accumulated_depreciation: string;
  status: 'active' | 'disposed';
  disposal_date: string | null;
  disposal_proceeds: string | null;
}

export interface DepreciationRun {
  id: string;
  company_id: string;
  fixed_asset_id: string;
  period_code: string;
  run_date: string;
  total_depreciation: string;
  status: 'draft' | 'posted';
  journal_entry_id: string | null;
}

export interface LoanRecord {
  id: string;
  company_id: string;
  branch_id: string;
  loan_number: string;
  lender_name: string;
  disbursement_date: string;
  principal_amount: string;
  outstanding_principal: string;
  annual_interest_rate: string;
  fund_account_id: string;
  status: 'active' | 'settled';
  repayments: {
    id: string;
    payment_date: string;
    principal_paid: string;
    interest_paid: string;
    fee_paid: string;
    fund_account_id: string;
    evidence_ref: string;
    journal_entry_id: string | null;
  }[];
}

export interface EquityTransaction {
  id: string;
  company_id: string;
  branch_id: string;
  doc_number: string;
  txn_type: 'capital_injection' | 'owner_draw' | 'dividend';
  txn_date: string;
  party_name: string;
  fund_account_id: string;
  amount: string;
  notes: string;
  status: 'draft' | 'approved';
  created_by: string;
  approved_by: string | null;
}

export interface TaxCode {
  id: string;
  company_id: string;
  code: string;
  name: string;
  rate: string; // e.g., "0.11" for 11%
  effective_date: string;
  tax_mode: 'inclusive' | 'exclusive';
  is_recoverable: boolean;
  direction: 'input' | 'output' | 'withholding';
  coa_code: string;
  is_active: boolean;
}

export interface BankStatementLine {
  id: string;
  fund_account_id: string;
  value_date: string;
  direction: 'credit' | 'debit';
  amount: string;
  description: string;
  bank_reference: string | null;
  match_status: 'unmatched' | 'proposed' | 'matched' | 'reviewed_exception';
  matched_amount: string;
}

export interface BankReconciliation {
  id: string;
  company_id: string;
  fund_account_id: string;
  period_start: string;
  period_end: string;
  statement_opening_balance: string;
  statement_closing_balance: string;
  book_opening_balance: string;
  book_closing_balance: string;
  pending_deposits: string;
  outstanding_payments: string;
  unrecorded_bank_charges: string;
  unrecorded_interest: string;
  status: 'draft' | 'approved';
  notes: string;
  approved_by: string | null;
}

export interface OpeningBalanceLine {
  id: string;
  company_id: string;
  branch_id: string;
  as_of_date: string;
  coa_code: string;
  debit: string;
  credit: string;
  status: 'draft' | 'submitted' | 'approved';
}

export interface OpeningSubledgerItem {
  id: string;
  company_id: string;
  branch_id: string;
  subledger_type: 'ar_invoice' | 'ap_invoice' | 'customer_deposit' | 'custody' | 'inventory_sku' | 'bank_cash' | 'fixed_asset' | 'loan' | 'ytd_pnl';
  entity_id: string;
  entity_label: string;
  reference_no: string;
  due_date: string | null;
  qty: string | null;
  unit_cost: string | null;
  amount: string;
  as_of_date: string;
  provenance: 'opening';
  status: 'draft' | 'submitted' | 'approved';
}

export interface ReportSnapshot {
  id: string;
  company_id: string;
  report_code: string;
  period_code: string;
  as_of_date: string;
  snapshot_version: number;
  snapshot_status: 'draft' | 'final_internal' | 'superseded';
  summary_totals: Record<string, string>;
  generated_by: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  company_id: string;
  branch_id: string | null;
  actor_id: string;
  actor_name: string;
  event_action: string;
  entity_type: string;
  entity_id: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  source_app: string;
  created_at: string;
}
