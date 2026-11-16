import { LedgerDataset } from './accountingEngine';
import { buildDefaultCoa } from '../data/syntheticSeed';
import { supabase } from './supabase';
import { RoleCode } from '../types/finops';

export interface LiveSessionInfo {
  userId: string;
  email: string;
  fullName: string;
  companyId: string;
  companyName: string;
  roles: RoleCode[];
  allBranches: boolean;
  branchIds: string[];
}

export async function loadLiveSessionInfo(): Promise<LiveSessionInfo | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', user.id)
    .single();

  const { data: memberships, error: memErr } = await supabase
    .from('memberships')
    .select('company_id, branch_id, all_branches, role_code, companies(id, name)')
    .eq('user_id', user.id)
    .eq('is_active', true);

  if (memErr || !memberships || memberships.length === 0) {
    throw new Error('Akun Anda berhasil login, tetapi belum memiliki keanggotaan (membership) perusahaan aktif pada backend bersama.');
  }

  const first = memberships[0] as unknown as {
    company_id: string;
    branch_id: string | null;
    all_branches: boolean;
    role_code: RoleCode;
    companies?: { id: string; name: string } | null;
  };

  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? '',
    fullName: profile?.full_name ?? user.email ?? 'Pengguna',
    companyId: first.company_id,
    companyName: first.companies?.name ?? 'Perusahaan Terdaftar',
    roles: memberships.map((m) => m.role_code as RoleCode),
    allBranches: memberships.some((m) => m.all_branches),
    branchIds: memberships.map((m) => m.branch_id).filter((x): x is string => Boolean(x)),
  };
}

export async function fetchLiveLedgerDataset(session: LiveSessionInfo): Promise<LedgerDataset> {
  if (!supabase) throw new Error('Supabase client tidak terkonfigurasi.');
  const cid = session.companyId;

  const [
    branchesRes,
    policyRes,
    settingsRes,
    coaRes,
    periodsRes,
    eventsRes,
    journalsRes,
    fundRes,
    custodyRes,
    customersRes,
    suppliersRes,
    productsRes,
    salesRes,
    receiptsRes,
    grnRes,
    poRes,
    spRes,
    ivRes,
    imRes,
    irRes,
    expRes,
    faRes,
    depRes,
    loansRes,
    repRes,
    eqRes,
    taxRes,
    brecRes,
    obRes,
    osRes,
    snapRes,
    paRes,
  ] = await Promise.all([
    supabase.from('branches').select('*').eq('company_id', cid).eq('is_active', true),
    supabase.from('accounting_policies').select('*').eq('company_id', cid).maybeSingle(),
    supabase.from('app_settings').select('*').eq('company_id', cid).maybeSingle(),
    supabase.from('chart_of_accounts').select('*').eq('company_id', cid).order('code'),
    supabase.from('fiscal_periods').select('*').eq('company_id', cid).order('start_date'),
    supabase.from('accounting_events').select('*').eq('company_id', cid).order('created_at', { ascending: false }).limit(200),
    supabase.from('journal_entries').select('*, journal_lines(*)').eq('company_id', cid).order('accounting_date', { ascending: false }).limit(300),
    supabase.from('fund_accounts').select('*').eq('company_id', cid).eq('is_active', true),
    supabase.from('cash_custody_accounts').select('*, staff(full_name)').eq('company_id', cid),
    supabase.from('customers').select('id, cust_id, name, branch_id').eq('company_id', cid),
    supabase.from('suppliers').select('id, supplier_code, name, is_active').eq('company_id', cid),
    supabase.from('products').select('*, product_units(*)').eq('company_id', cid),
    supabase.from('sales_documents').select('*, sales_lines(*)').eq('company_id', cid).order('invoice_date', { ascending: false }).limit(200),
    supabase.from('receipts').select('*').eq('company_id', cid).order('customer_paid_at', { ascending: false }).limit(200),
    supabase.from('goods_receipts').select('*, goods_receipt_lines(*)').eq('company_id', cid).order('received_date', { ascending: false }),
    supabase.from('purchase_documents').select('*, purchase_lines(*)').eq('company_id', cid).order('invoice_date', { ascending: false }),
    supabase.from('supplier_payments').select('*, supplier_allocations(*)').eq('company_id', cid).order('payment_date', { ascending: false }),
    supabase.from('inventory_valuations').select('*').eq('company_id', cid),
    supabase.from('inventory_movements').select('*').eq('company_id', cid).order('movement_date', { ascending: false }).limit(200),
    supabase.from('inventory_revaluations').select('*').eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('expense_documents').select('*').eq('company_id', cid).order('expense_date', { ascending: false }),
    supabase.from('fixed_assets').select('*').eq('company_id', cid).order('asset_code'),
    supabase.from('depreciation_runs').select('*').eq('company_id', cid).order('period_code', { ascending: false }),
    supabase.from('loans').select('*').eq('company_id', cid),
    supabase.from('loan_repayments').select('*').eq('company_id', cid).order('payment_date', { ascending: false }),
    supabase.from('equity_transactions').select('*').eq('company_id', cid).order('txn_date', { ascending: false }),
    supabase.from('tax_codes').select('*').eq('company_id', cid),
    supabase.from('bank_reconciliations').select('*').eq('company_id', cid).order('period_end', { ascending: false }),
    supabase.from('opening_balances').select('*').eq('company_id', cid),
    supabase.from('opening_subledger_items').select('*').eq('company_id', cid),
    supabase.from('report_snapshots').select('*').eq('company_id', cid).order('created_at', { ascending: false }),
    supabase.from('payment_allocations').select('sales_document_id, receipt_id, allocated_amount, status').eq('company_id', cid).eq('status', 'active'),
  ]);

  const pol = policyRes.data;
  const sett = settingsRes.data;
  const coaList = (coaRes.data ?? []).length > 0 ? coaRes.data! : buildDefaultCoa(cid);

  const allocBySale = new Map<string, number>();
  const allocByReceipt = new Map<string, number>();
  for (const pa of (paRes.data ?? []) as Record<string, unknown>[]) {
    const amt = Number(pa.allocated_amount ?? 0);
    const sid = String(pa.sales_document_id ?? '');
    const rid = String(pa.receipt_id ?? '');
    if (sid) allocBySale.set(sid, (allocBySale.get(sid) ?? 0) + amt);
    if (rid) allocByReceipt.set(rid, (allocByReceipt.get(rid) ?? 0) + amt);
  }

  return {
    companyId: cid,
    companyName: session.companyName,
    branches: branchesRes.data ?? [],
    policy: {
      company_id: cid,
      reporting_framework_name: pol?.reporting_framework_name ?? null,
      reporting_framework_status: pol?.reporting_framework_status ?? 'unconfigured',
      tax_policy_status: pol?.tax_policy_status ?? 'unconfigured',
      fiscal_year_start_month: pol?.fiscal_year_start_month ?? 1,
      cutover_date: pol?.cutover_date ?? null,
      is_midyear_cutover: pol?.is_midyear_cutover ?? false,
      ytd_hist_status: pol?.ytd_hist_status ?? 'not_applicable',
      cogs_method: pol?.cogs_method ?? 'moving_weighted_average',
      cogs_method_approved: pol?.cogs_method_approved ?? false,
      revenue_recognition_policy: pol?.revenue_recognition_policy ?? 'on_confirmed_delivery_date',
      rounding_precision: pol?.rounding_precision ?? 0,
      rounding_mode: 'half_up',
      rounding_coa_code: pol?.rounding_coa_code ?? '6901',
      cash_components_approved: pol?.cash_components_approved ?? false,
      allow_auto_post_deterministic: pol?.allow_auto_post_deterministic ?? false,
      unknown_cash_materiality_limit: String(pol?.unknown_cash_materiality_limit ?? '0.00'),
      opening_status: pol?.opening_status ?? 'incomplete',
      opening_submitted_by: pol?.opening_submitted_by ?? null,
      opening_approved_by: pol?.opening_approved_by ?? null,
      opening_approved_at: pol?.opening_approved_at ?? null,
      worker_configured: false,
      app1_url: sett?.app1_url ?? null,
      app2_url: sett?.app2_url ?? null,
      app3_url: sett?.app3_url ?? null,
    },
    coa: coaList,
    fiscalPeriods: periodsRes.data ?? [],
    events: eventsRes.data ?? [],
    journals: (journalsRes.data ?? []).map((j: Record<string, unknown>) => ({
      ...(j as unknown as LedgerDataset['journals'][number]),
      total_debit: String(j.total_debit ?? '0.00'),
      total_credit: String(j.total_credit ?? '0.00'),
      lines: ((j.journal_lines as Record<string, unknown>[]) ?? []).map((l) => ({
        ...(l as unknown as LedgerDataset['journals'][number]['lines'][number]),
        debit: String(l.debit ?? '0.00'),
        credit: String(l.credit ?? '0.00'),
      })),
    })),
    fundAccounts: fundRes.data ?? [],
    custodyAccounts: (custodyRes.data ?? []).map((c: Record<string, unknown>) => ({
      id: String(c.id),
      company_id: String(c.company_id),
      branch_id: String(c.branch_id),
      collector_staff_id: String(c.collector_staff_id),
      collector_name: (c.staff as { full_name?: string } | null)?.full_name ?? String(c.collector_staff_id),
      verified_balance: String(c.verified_balance ?? '0.00'),
      unverified_reported_balance: String(c.unverified_reported_balance ?? '0.00'),
      shortage_open_amount: '0.00',
    })),
    customers: customersRes.data ?? [],
    suppliers: (suppliersRes.data ?? []).map((s: Record<string, unknown>) => ({
      id: String(s.id),
      company_id: cid,
      supplier_code: String(s.supplier_code ?? ''),
      name: String(s.name ?? ''),
      is_active: s.is_active !== false,
    })),
    products: (productsRes.data ?? []).map((p: Record<string, unknown>) => ({
      id: String(p.id),
      company_id: String(p.company_id),
      sku: String(p.sku),
      name: String(p.name),
      base_unit: String(p.base_unit),
      product_type: (p.product_type as 'stocked' | 'non_stock' | 'deposit_returnable') ?? 'stocked',
      is_stocked: Boolean(p.is_stocked),
      deposit_liability_coa: (p.deposit_liability_coa as string) ?? null,
      units: ((p.product_units as Record<string, unknown>[]) ?? []).map((u) => ({
        unit_code: String(u.unit_code),
        conversion_factor: String(u.conversion_factor),
      })),
    })),
    salesDocuments: (salesRes.data ?? []).map((s: Record<string, unknown>) => ({
      id: String(s.id),
      company_id: String(s.company_id),
      branch_id: String(s.branch_id),
      doc_number: String(s.doc_number),
      doc_type: s.doc_type as 'sales_invoice' | 'credit_note' | 'debit_note',
      customer_id: String(s.customer_id),
      invoice_date: String(s.invoice_date),
      delivery_date: (s.delivery_date as string) ?? null,
      due_date: (s.due_date as string) ?? null,
      total_amount: String(s.total_amount ?? '0.00'),
      allocated_amount: (allocBySale.get(String(s.id)) ?? 0).toFixed(2),
      status: String(s.status),
      accounting_status: String(s.accounting_status),
      provenance: 'app2',
      lines: ((s.sales_lines as Record<string, unknown>[]) ?? []).map((l) => ({
        id: String(l.id),
        product_id: String(l.product_id),
        unit_code: String(l.unit_code),
        quantity: String(l.quantity),
        net_unit_price: String(l.net_unit_price),
        line_total: String(l.line_total),
        cogs_amount: null,
      })),
    })),
    receipts: (receiptsRes.data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      company_id: String(r.company_id),
      branch_id: String(r.branch_id),
      receipt_number: String(r.receipt_number),
      receipt_channel: r.receipt_channel as 'bank_transfer' | 'cash',
      customer_id: (r.customer_id as string) ?? null,
      is_unknown_identity: Boolean(r.is_unknown_identity),
      customer_paid_at: String(r.customer_paid_at),
      bank_value_date: (r.bank_value_date as string) ?? null,
      verified_amount: String(r.verified_amount ?? '0.00'),
      allocated_amount: (allocByReceipt.get(String(r.id)) ?? 0).toFixed(2),
      refunded_amount: '0.00',
      fund_account_id: (r.fund_account_id as string) ?? null,
      actual_collector_id: (r.actual_collector_id as string) ?? null,
      status: String(r.status),
      accounting_status: String(r.accounting_status),
      evidence_ref: null,
    })),
    goodsReceipts: (grnRes.data ?? []).map((g: Record<string, unknown>) => ({
      id: String(g.id),
      company_id: String(g.company_id),
      branch_id: String(g.branch_id),
      grn_number: String(g.grn_number),
      supplier_id: String(g.supplier_id),
      received_date: String(g.received_date),
      status: g.status as 'draft' | 'posted',
      invoiced_status: (g.invoiced_status as 'uninvoiced' | 'partially_invoiced' | 'invoiced') ?? 'uninvoiced',
      total_estimated_cost: String(g.total_estimated_cost ?? '0.00'),
      lines: ((g.goods_receipt_lines as Record<string, unknown>[]) ?? []).map((l) => ({
        id: String(l.id),
        product_id: String(l.product_id),
        unit_code: String(l.unit_code ?? 'PCS'),
        quantity: String(l.quantity ?? '0'),
        conversion_factor: String(l.conversion_factor ?? '1'),
        estimated_unit_cost: String(l.estimated_unit_cost ?? '0'),
        condition_status: (l.condition_status as 'good' | 'damaged') ?? 'good',
      })),
    })),
    purchaseDocuments: (poRes.data ?? []).map((p: Record<string, unknown>) => ({
      ...(p as unknown as LedgerDataset['purchaseDocuments'][number]),
      paid_amount: String(p.paid_amount ?? '0.00'),
      total_amount: String(p.total_amount ?? '0.00'),
      lines: (p.purchase_lines as LedgerDataset['purchaseDocuments'][number]['lines']) ?? [],
    })),
    supplierPayments: (spRes.data ?? []).map((sp: Record<string, unknown>) => ({
      ...(sp as unknown as LedgerDataset['supplierPayments'][number]),
      amount: String(sp.amount ?? '0.00'),
      allocations: (sp.supplier_allocations as { purchase_document_id: string; allocated_amount: string }[]) ?? [],
    })),
    inventoryValuations: ivRes.data ?? [],
    inventoryMovements: imRes.data ?? [],
    inventoryRevaluations: irRes.data ?? [],
    expenses: expRes.data ?? [],
    fixedAssets: faRes.data ?? [],
    depreciationRuns: depRes.data ?? [],
    loans: (loansRes.data ?? []).map((l: Record<string, unknown>) => ({
      ...(l as unknown as LedgerDataset['loans'][number]),
      repayments: ((repRes.data ?? []) as Record<string, unknown>[])
        .filter((rp) => String(rp.loan_id) === String(l.id))
        .map((rp) => ({
          id: String(rp.id),
          payment_date: String(rp.payment_date),
          principal_paid: String(rp.principal_paid ?? '0.00'),
          interest_paid: String(rp.interest_paid ?? '0.00'),
          fee_paid: String(rp.fee_paid ?? '0.00'),
          fund_account_id: String(rp.fund_account_id ?? ''),
          evidence_ref: String(rp.evidence_ref ?? ''),
          journal_entry_id: (rp.journal_entry_id as string) ?? null,
        })),
    })),
    equityTransactions: eqRes.data ?? [],
    taxCodes: taxRes.data ?? [],
    bankReconciliations: brecRes.data ?? [],
    openingBalances: obRes.data ?? [],
    openingSubledgers: osRes.data ?? [],
    reportSnapshots: (snapRes.data ?? []).map((sn: Record<string, unknown>) => ({
      id: String(sn.id),
      company_id: String(sn.company_id),
      report_code: String(sn.report_code),
      period_code: String(sn.period_code),
      as_of_date: String(sn.as_of_date ?? ''),
      snapshot_version: Number(sn.snapshot_version ?? 1),
      snapshot_status: (sn.snapshot_status as 'draft' | 'final_internal' | 'superseded') ?? 'draft',
      summary_totals: (sn.payload as Record<string, string>) ?? {},
      generated_by: String(sn.generated_by ?? ''),
      created_at: String(sn.created_at),
    })),
    processedIdempotencyKeys: {},
  };
}
