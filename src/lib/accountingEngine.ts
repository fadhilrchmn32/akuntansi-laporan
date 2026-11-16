import {
  AccountingEvent,
  AccountingPolicy,
  BankReconciliation,
  ChartOfAccount,
  CustomerReceipt,
  CustodyAccount,
  DepreciationRun,
  EquityTransaction,
  ExpenseDocument,
  FiscalPeriod,
  FixedAsset,
  FundAccount,
  GoodsReceipt,
  InventoryMovement,
  InventoryRevaluation,
  InventoryValuation,
  JournalEntry,
  JournalLine,
  LoanRecord,
  OpeningBalanceLine,
  OpeningSubledgerItem,
  Product,
  PurchaseDocument,
  ReportSnapshot,
  RoleCode,
  SalesDocument,
  SupplierPayment,
  TaxCode,
} from '../types/finops';
import { addMoney, cmpMoney, D, daysBetween, roundMoney, roundQty, subMoney, sumMoney } from './decimal';

export interface LedgerDataset {
  companyId: string;
  companyName: string;
  branches: { id: string; code: string; name: string; is_headquarters: boolean }[];
  policy: AccountingPolicy;
  coa: ChartOfAccount[];
  fiscalPeriods: FiscalPeriod[];
  events: AccountingEvent[];
  journals: JournalEntry[];
  fundAccounts: FundAccount[];
  custodyAccounts: CustodyAccount[];
  customers: { id: string; cust_id: string; name: string; branch_id: string }[];
  suppliers: { id: string; supplier_code: string; name: string; is_active?: boolean }[];
  products: Product[];
  salesDocuments: SalesDocument[];
  receipts: CustomerReceipt[];
  goodsReceipts: GoodsReceipt[];
  purchaseDocuments: PurchaseDocument[];
  supplierPayments: SupplierPayment[];
  inventoryValuations: InventoryValuation[];
  inventoryMovements: InventoryMovement[];
  inventoryRevaluations: InventoryRevaluation[];
  expenses: ExpenseDocument[];
  fixedAssets: FixedAsset[];
  depreciationRuns: DepreciationRun[];
  loans: LoanRecord[];
  equityTransactions: EquityTransaction[];
  taxCodes: TaxCode[];
  bankReconciliations: BankReconciliation[];
  openingBalances: OpeningBalanceLine[];
  openingSubledgers: OpeningSubledgerItem[];
  reportSnapshots: ReportSnapshot[];
  processedIdempotencyKeys: Record<string, unknown>;
}

export interface TrialBalanceRow {
  coa_code: string;
  coa_name: string;
  account_group: ChartOfAccount['account_group'];
  normal_balance: ChartOfAccount['normal_balance'];
  opening_debit: string;
  opening_credit: string;
  mutation_debit: string;
  mutation_credit: string;
  closing_debit: string;
  closing_credit: string;
  closing_signed: string;
}

export interface GeneralLedgerEntryRow {
  journal_entry_id: string;
  journal_number: string;
  accounting_date: string;
  effective_date: string;
  description: string;
  source_type: string | null;
  source_id: string | null;
  memo: string | null;
  debit: string;
  credit: string;
  running_balance: string;
}

export interface FinancialStatementsResult {
  asOfDate: string;
  startDate: string;
  endDate: string;
  branchScopeLabel: string;
  reportStatus: 'Draft' | 'Final Internal';
  completenessGaps: string[];
  unpostedEventsCount: number;
  unpostedEventsValue: string;
  failedCogsCount: number;
  unclassifiedCashAmount: string;
  trialBalance: TrialBalanceRow[];
  trialBalanceTotals: {
    opening_debit: string;
    opening_credit: string;
    mutation_debit: string;
    mutation_credit: string;
    closing_debit: string;
    closing_credit: string;
    isBalanced: boolean;
  };
  incomeStatement: {
    grossSales: string;
    salesReturnsDiscounts: string;
    netRevenue: string;
    cogs: string;
    grossProfit: string;
    operatingExpenses: { coa_code: string; coa_name: string; amount: string }[];
    totalOperatingExpenses: string;
    operatingProfit: string;
    otherIncome: string;
    otherExpenses: string;
    profitBeforeTax: string;
    taxExpense: string;
    netProfit: string;
  };
  balanceSheet: {
    assets: { coa_code: string; coa_name: string; amount: string }[];
    totalAssets: string;
    liabilities: { coa_code: string; coa_name: string; amount: string }[];
    totalLiabilities: string;
    equityItems: { coa_code: string; coa_name: string; amount: string }[];
    currentPeriodEarnings: string;
    totalEquity: string;
    totalLiabilitiesAndEquity: string;
    isBalanced: boolean;
    imbalanceDiff: string;
  };
  cashFlowDirect: {
    openingCash: string;
    operatingLines: { label: string; amount: string }[];
    netOperating: string;
    investingLines: { label: string; amount: string }[];
    netInvesting: string;
    financingLines: { label: string; amount: string }[];
    netFinancing: string;
    unclassifiedAmount: string;
    netCashChange: string;
    closingCashComputed: string;
    closingCashBalanceSheet: string;
    reconcilesWithBalanceSheet: boolean;
    cashFlowHeldForUnclassified: boolean;
  };
  equityChanges: {
    openingEquity: string;
    capitalInjections: string;
    periodNetProfit: string;
    ownerDrawings: string;
    approvedAdjustments: string;
    closingEquity: string;
    reconcilesWithBalanceSheet: boolean;
  };
  tieOuts: {
    label: string;
    coaCode: string;
    glBalance: string;
    subledgerBalance: string;
    difference: string;
    isMatched: boolean;
  }[];
  agingAR: AgingSummary;
  agingAP: AgingSummary;
}

export interface AgingBucketRow {
  entityId: string;
  entityName: string;
  docNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  outstanding: string;
  notDue: string;
  d0_30: string;
  d31_60: string;
  d61_90: string;
  dOver90: string;
  missingDueDate: boolean;
}

export interface AgingSummary {
  rows: AgingBucketRow[];
  totalOutstanding: string;
  notDue: string;
  d0_30: string;
  d31_60: string;
  d61_90: string;
  dOver90: string;
  missingDueDateCount: number;
  missingDueDateAmount: string;
}

function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function assertOpenPeriod(periods: FiscalPeriod[], accountingDate: string): FiscalPeriod {
  const period = periods.find((p) => accountingDate >= p.start_date && accountingDate <= p.end_date);
  if (!period) {
    throw new Error(`Periode fiskal untuk tanggal ${accountingDate} belum dikonfigurasi.`);
  }
  if (period.status !== 'open') {
    throw new Error(`Periode ${period.period_code} berstatus ${period.status}. Posting/edit ke periode terkunci ditolak.`);
  }
  return period;
}

export function buildLinesForEvent(
  ev: AccountingEvent,
  dataset: LedgerDataset
): { lines: Omit<JournalLine, 'id' | 'journal_entry_id' | 'line_no'>[]; description: string } {
  const p = ev.payload_snapshot as Record<string, unknown>;
  const branchId = ev.branch_id;

  switch (ev.event_type) {
    case 'receipt_transfer_verified': {
      const gross = D(p.customer_gross_amount as string);
      const net = D(p.bank_net_amount as string);
      const fee = D((p.bank_fee_amount as string) ?? '0');
      const bearer = (p.bank_fee_bearer as string) ?? 'none';
      const depositCredit = bearer === 'company' ? gross : gross.minus(fee);
      const lines: Omit<JournalLine, 'id' | 'journal_entry_id' | 'line_no'>[] = [
        {
          coa_code: '1103',
          debit: net.toFixed(2),
          credit: '0.00',
          memo: `Masuk bank dari ${String(p.receipt_number ?? ev.source_id)}`,
          branch_id: branchId,
          customer_id: (p.customer_id as string) ?? null,
          fund_account_id: (p.fund_account_id as string) ?? null,
          cash_flow_category: 'operating',
        },
        {
          coa_code: '2102',
          debit: '0.00',
          credit: depositCredit.toFixed(2),
          memo: 'Titipan pelanggan terverifikasi (transfer)',
          branch_id: branchId,
          customer_id: (p.customer_id as string) ?? null,
          cash_flow_category: 'operating',
        },
      ];
      if (fee.gt(0) && bearer === 'company') {
        lines.push({
          coa_code: '6109',
          debit: fee.toFixed(2),
          credit: '0.00',
          memo: 'Biaya admin transfer bank ditanggung perusahaan',
          branch_id: branchId,
          cash_flow_category: 'operating',
        });
      }
      return { lines, description: `Penerimaan transfer ${String(p.receipt_number ?? '')}` };
    }

    case 'receipt_cash_verified': {
      const amt = D(p.verified_amount as string).toFixed(2);
      return {
        description: `Penerimaan tunai penagih ${String(p.receipt_number ?? '')}`,
        lines: [
          {
            coa_code: '1102',
            debit: amt,
            credit: '0.00',
            memo: 'Kas dikuasai penagih',
            branch_id: branchId,
            collector_staff_id: (p.actual_collector_id as string) ?? null,
            cash_flow_category: 'operating',
          },
          {
            coa_code: '2102',
            debit: '0.00',
            credit: amt,
            memo: 'Titipan pelanggan tunai terverifikasi',
            branch_id: branchId,
            customer_id: (p.customer_id as string) ?? null,
            cash_flow_category: 'operating',
          },
        ],
      };
    }

    case 'receipt_unidentified_verified': {
      const amt = D(p.verified_amount as string).toFixed(2);
      return {
        description: `Dana masuk belum teridentifikasi ${String(p.receipt_number ?? '')}`,
        lines: [
          {
            coa_code: '1103',
            debit: amt,
            credit: '0.00',
            memo: 'Dana masuk rekening belum teridentifikasi',
            branch_id: branchId,
            fund_account_id: (p.fund_account_id as string) ?? null,
            cash_flow_category: 'unclassified',
          },
          {
            coa_code: '2103',
            debit: '0.00',
            credit: amt,
            memo: 'Penerimaan belum teridentifikasi (menunggu klaim identitas)',
            branch_id: branchId,
            cash_flow_category: 'unclassified',
          },
        ],
      };
    }

    case 'receipt_identity_resolved': {
      const amt = D(p.amount as string).toFixed(2);
      return {
        description: `Pengesahan identitas ${String(p.receipt_number ?? '')}`,
        lines: [
          {
            coa_code: '2103',
            debit: amt,
            credit: '0.00',
            memo: 'Reklasifikasi penerimaan belum teridentifikasi',
            branch_id: branchId,
            cash_flow_category: 'non_cash',
          },
          {
            coa_code: '2102',
            debit: '0.00',
            credit: amt,
            memo: 'Titipan pelanggan setelah identitas disahkan',
            branch_id: branchId,
            customer_id: (p.customer_id as string) ?? null,
            cash_flow_category: 'non_cash',
          },
        ],
      };
    }

    case 'payment_allocated': {
      const amt = D(p.allocated_amount as string).toFixed(2);
      return {
        description: `Alokasi pembayaran ${String(p.receipt_number ?? '')} -> ${String(p.invoice_number ?? '')}`,
        lines: [
          {
            coa_code: '2102',
            debit: amt,
            credit: '0.00',
            memo: 'Pemakaian titipan pelanggan untuk pelunasan nota',
            branch_id: branchId,
            customer_id: (p.customer_id as string) ?? null,
            cash_flow_category: 'non_cash',
          },
          {
            coa_code: '1104',
            debit: '0.00',
            credit: amt,
            memo: `Pelunasan piutang ${String(p.invoice_number ?? '')}`,
            branch_id: branchId,
            customer_id: (p.customer_id as string) ?? null,
            cash_flow_category: 'non_cash',
          },
        ],
      };
    }

    case 'cash_deposit_office_accepted': {
      const amt = D(p.received_amount as string).toFixed(2);
      return {
        description: `Setoran kas penagih ke kas kantor ${String(p.deposit_number ?? '')}`,
        lines: [
          {
            coa_code: '1101',
            debit: amt,
            credit: '0.00',
            memo: 'Kas kantor menerima setoran penagih',
            branch_id: branchId,
            fund_account_id: (p.target_fund_account_id as string) ?? null,
            cash_flow_category: 'internal_transfer',
          },
          {
            coa_code: '1102',
            debit: '0.00',
            credit: amt,
            memo: 'Pengurangan kas di penagih',
            branch_id: branchId,
            collector_staff_id: (p.collector_staff_id as string) ?? null,
            cash_flow_category: 'internal_transfer',
          },
        ],
      };
    }

    case 'cash_deposit_direct_bank_accepted': {
      const amt = D(p.received_amount as string).toFixed(2);
      return {
        description: `Setoran langsung penagih ke bank ${String(p.deposit_number ?? '')}`,
        lines: [
          {
            coa_code: '1103',
            debit: amt,
            credit: '0.00',
            memo: 'Setoran langsung penagih masuk bank',
            branch_id: branchId,
            fund_account_id: (p.target_fund_account_id as string) ?? null,
            cash_flow_category: 'internal_transfer',
          },
          {
            coa_code: '1102',
            debit: '0.00',
            credit: amt,
            memo: 'Pengurangan kas di penagih',
            branch_id: branchId,
            collector_staff_id: (p.collector_staff_id as string) ?? null,
            cash_flow_category: 'internal_transfer',
          },
        ],
      };
    }

    case 'internal_fund_transfer_approved': {
      const amt = D(p.amount as string).toFixed(2);
      return {
        description: `Transfer kas internal ${String(p.transfer_number ?? '')}`,
        lines: [
          {
            coa_code: '1103',
            debit: amt,
            credit: '0.00',
            memo: 'Setoran kas kantor ke bank',
            branch_id: branchId,
            fund_account_id: (p.to_fund_account_id as string) ?? null,
            cash_flow_category: 'internal_transfer',
          },
          {
            coa_code: '1101',
            debit: '0.00',
            credit: amt,
            memo: 'Kas kantor disetorkan ke bank',
            branch_id: branchId,
            fund_account_id: (p.from_fund_account_id as string) ?? null,
            cash_flow_category: 'internal_transfer',
          },
        ],
      };
    }

    case 'sales_delivery_recognized': {
      const total = D(p.total_amount as string);
      const taxAmt = D((p.tax_amount as string) ?? '0');
      const netSales = total.minus(taxAmt);
      const hasStocked = (p.has_stocked_items as boolean) ?? true;
      let cogs = D((p.cogs_amount as string) ?? '0');

      // Hitung atau validasi HPP dari inventory valuation jika tersedia
      const saleDoc = dataset.salesDocuments.find((s) => s.id === ev.source_id);
      if (saleDoc && hasStocked && cogs.lte(0)) {
        let computedCogs = D(0);
        for (const sl of saleDoc.lines) {
          const prod = dataset.products.find((pr) => pr.id === sl.product_id);
          if (!prod || !prod.is_stocked) continue;
          const val = dataset.inventoryValuations.find(
            (v) => v.branch_id === saleDoc.branch_id && v.product_id === sl.product_id
          );
          if (!val || D(val.qty_on_hand).lt(D(sl.quantity)) || D(val.avg_unit_cost).lte(0)) {
            throw new Error(
              `HPP/Stok tidak mencukupi untuk SKU ${prod.sku} (${prod.name}). Dibutuhkan ${sl.quantity} ${prod.base_unit}, tersedia ${val?.qty_on_hand ?? '0'}. Lengkapi saldo awal atau penerimaan barang terlebih dahulu.`
            );
          }
          computedCogs = computedCogs.plus(D(roundMoney(D(sl.quantity).times(D(val.avg_unit_cost)), 0)));
        }
        cogs = computedCogs;
      }

      if (hasStocked && cogs.lte(0)) {
        throw new Error(
          `Penjualan barang stok ${String(p.doc_number ?? ev.source_id)} ditahan: nilai HPP sah tidak tersedia (dilarang memposting HPP nol).`
        );
      }

      const lines: Omit<JournalLine, 'id' | 'journal_entry_id' | 'line_no'>[] = [
        {
          coa_code: '1104',
          debit: total.toFixed(2),
          credit: '0.00',
          memo: `Piutang penjualan ${String(p.doc_number ?? '')}`,
          branch_id: branchId,
          customer_id: (p.customer_id as string) ?? null,
          cash_flow_category: 'non_cash',
        },
        {
          coa_code: '4101',
          debit: '0.00',
          credit: netSales.toFixed(2),
          memo: `Pendapatan penjualan diakui pada tanggal kirim ${ev.effective_date}`,
          branch_id: branchId,
          customer_id: (p.customer_id as string) ?? null,
          cash_flow_category: 'non_cash',
        },
      ];
      if (taxAmt.gt(0)) {
        lines.push({
          coa_code: '2105',
          debit: '0.00',
          credit: taxAmt.toFixed(2),
          memo: 'Pajak keluaran penjualan',
          branch_id: branchId,
          cash_flow_category: 'non_cash',
        });
      }
      if (cogs.gt(0)) {
        lines.push(
          {
            coa_code: '5101',
            debit: cogs.toFixed(2),
            credit: '0.00',
            memo: 'Harga Pokok Penjualan (Moving Weighted Average)',
            branch_id: branchId,
            cash_flow_category: 'non_cash',
          },
          {
            coa_code: '1105',
            debit: '0.00',
            credit: cogs.toFixed(2),
            memo: 'Pengurangan nilai persediaan barang terjual',
            branch_id: branchId,
            cash_flow_category: 'non_cash',
          }
        );
      }
      return { lines, description: `Pengakuan penjualan & HPP ${String(p.doc_number ?? '')}` };
    }

    case 'goods_receipt_posted': {
      const amt = D(p.total_estimated_cost as string).toFixed(2);
      return {
        description: `Penerimaan barang GRN ${String(p.grn_number ?? '')}`,
        lines: [
          {
            coa_code: '1105',
            debit: amt,
            credit: '0.00',
            memo: 'Persediaan barang masuk (GRN)',
            branch_id: branchId,
            supplier_id: (p.supplier_id as string) ?? null,
            cash_flow_category: 'non_cash',
          },
          {
            coa_code: '2106',
            debit: '0.00',
            credit: amt,
            memo: 'GRNI (Barang diterima belum difaktur)',
            branch_id: branchId,
            supplier_id: (p.supplier_id as string) ?? null,
            cash_flow_category: 'non_cash',
          },
        ],
      };
    }

    case 'purchase_invoice_approved': {
      const amt = D(p.total_amount as string).toFixed(2);
      const clearsGrni = Boolean(p.clears_grni);
      const isPrepayment = Boolean(p.is_prepayment_exception);
      const debitCoa = clearsGrni ? '2106' : isPrepayment ? '1106' : '1105';
      const debitMemo = clearsGrni
        ? 'Clearing GRNI atas invoice pemasok'
        : isPrepayment
        ? 'Uang muka pembelian (barang belum diterima)'
        : 'Pembelian persediaan barang dagang';

      return {
        description: `Invoice pembelian ${String(p.doc_number ?? '')}`,
        lines: [
          {
            coa_code: debitCoa,
            debit: amt,
            credit: '0.00',
            memo: debitMemo,
            branch_id: branchId,
            supplier_id: (p.supplier_id as string) ?? null,
            cash_flow_category: 'non_cash',
          },
          {
            coa_code: '2101',
            debit: '0.00',
            credit: amt,
            memo: 'Utang usaha pemasok',
            branch_id: branchId,
            supplier_id: (p.supplier_id as string) ?? null,
            cash_flow_category: 'non_cash',
          },
        ],
      };
    }

    case 'supplier_payment_approved': {
      const amt = D(p.amount as string).toFixed(2);
      return {
        description: `Pembayaran utang pemasok ${String(p.payment_number ?? '')}`,
        lines: [
          {
            coa_code: '2101',
            debit: amt,
            credit: '0.00',
            memo: 'Pelunasan utang usaha pemasok',
            branch_id: branchId,
            supplier_id: (p.supplier_id as string) ?? null,
            cash_flow_category: 'operating',
          },
          {
            coa_code: '1103',
            debit: '0.00',
            credit: amt,
            memo: 'Kas/Bank keluar untuk pembayaran pemasok',
            branch_id: branchId,
            fund_account_id: (p.fund_account_id as string) ?? null,
            cash_flow_category: 'operating',
          },
        ],
      };
    }

    case 'expense_approved': {
      const amt = D(p.amount as string).toFixed(2);
      const mode = (p.expense_mode as string) ?? 'direct_paid';
      const catCoa = (p.category_coa as string) ?? '6101';
      if (mode === 'accrued') {
        return {
          description: `Beban akrual ${String(p.doc_number ?? '')}`,
          lines: [
            { coa_code: catCoa, debit: amt, credit: '0.00', memo: String(p.description ?? 'Beban akrual'), branch_id: branchId, cash_flow_category: 'non_cash' },
            { coa_code: '2107', debit: '0.00', credit: amt, memo: 'Utang biaya akrual', branch_id: branchId, cash_flow_category: 'non_cash' },
          ],
        };
      }
      if (mode === 'accrual_settlement') {
        return {
          description: `Pelunasan utang biaya ${String(p.doc_number ?? '')}`,
          lines: [
            { coa_code: '2107', debit: amt, credit: '0.00', memo: 'Penyelesaian utang biaya akrual', branch_id: branchId, cash_flow_category: 'operating' },
            { coa_code: (p.cash_coa as string) ?? '1103', debit: '0.00', credit: amt, memo: 'Pengeluaran kas/bank', branch_id: branchId, fund_account_id: (p.fund_account_id as string) ?? null, cash_flow_category: 'operating' },
          ],
        };
      }
      if (mode === 'prepaid') {
        return {
          description: `Pembayaran biaya dibayar di muka ${String(p.doc_number ?? '')}`,
          lines: [
            { coa_code: '1106', debit: amt, credit: '0.00', memo: 'Biaya dibayar di muka', branch_id: branchId, cash_flow_category: 'operating' },
            { coa_code: (p.cash_coa as string) ?? '1103', debit: '0.00', credit: amt, memo: 'Pengeluaran kas/bank', branch_id: branchId, fund_account_id: (p.fund_account_id as string) ?? null, cash_flow_category: 'operating' },
          ],
        };
      }
      return {
        description: `Biaya operasional dibayar langsung ${String(p.doc_number ?? '')}`,
        lines: [
          { coa_code: catCoa, debit: amt, credit: '0.00', memo: String(p.description ?? 'Biaya operasional'), branch_id: branchId, cash_flow_category: 'operating' },
          { coa_code: (p.cash_coa as string) ?? '1103', debit: '0.00', credit: amt, memo: 'Pengeluaran kas/bank', branch_id: branchId, fund_account_id: (p.fund_account_id as string) ?? null, cash_flow_category: 'operating' },
        ],
      };
    }

    default:
      throw new Error(`Event type "${ev.event_type}" belum memiliki recipe jurnal.`);
  }
}

export function processEventIntoDataset(
  dataset: LedgerDataset,
  eventId: string,
  actorId: string,
  idempotencyKey: string,
  forceStatus?: 'draft' | 'posted'
): { dataset: LedgerDataset; journal: JournalEntry; idempotentHit: boolean } {
  const existingKey = dataset.processedIdempotencyKeys[`post:${actorId}:${idempotencyKey}`];
  if (existingKey) {
    const existingJ = dataset.journals.find((j) => j.id === existingKey);
    if (existingJ) return { dataset, journal: existingJ, idempotentHit: true };
  }

  const evIndex = dataset.events.findIndex((e) => e.id === eventId);
  if (evIndex === -1) throw new Error('Event akuntansi tidak ditemukan.');
  const ev = dataset.events[evIndex];

  // Cek apakah sudah pernah menghasilkan jurnal (source event unique guard)
  const existingJournal = dataset.journals.find((j) => j.source_event_id === ev.id);
  if (existingJournal) {
    return { dataset, journal: existingJournal, idempotentHit: true };
  }

  // Cek dependensi
  if (ev.dependency_ids.length > 0) {
    const unpostedDeps = ev.dependency_ids.filter((depId) => {
      const dep = dataset.events.find((e) => e.id === depId);
      return !dep || dep.processing_status !== 'posted';
    });
    if (unpostedDeps.length > 0) {
      const nextEvents = [...dataset.events];
      nextEvents[evIndex] = {
        ...ev,
        processing_status: 'failed',
        retry_count: ev.retry_count + 1,
        error_message: `Menunggu ${unpostedDeps.length} event dependensi diposting lebih dahulu.`,
      };
      throw new Error(nextEvents[evIndex].error_message!);
    }
  }

  const period = assertOpenPeriod(dataset.fiscalPeriods, ev.effective_date);
  const { lines: builtLines, description } = buildLinesForEvent(ev, dataset);

  const sumD = sumMoney(builtLines.map((l) => l.debit));
  const sumC = sumMoney(builtLines.map((l) => l.credit));
  if (D(sumD).lte(0) || cmpMoney(sumD, sumC) !== 0) {
    throw new Error(`Jurnal tidak seimbang: Debit ${sumD} != Kredit ${sumC}`);
  }

  const targetStatus: JournalEntry['status'] =
    forceStatus ??
    (dataset.policy.allow_auto_post_deterministic && dataset.policy.opening_status === 'approved'
      ? 'posted'
      : 'draft');

  const jeId = makeUuid();
  const jeNo = `JRN-${ev.effective_date.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;

  const journal: JournalEntry = {
    id: jeId,
    company_id: dataset.companyId,
    branch_id: ev.branch_id,
    journal_number: jeNo,
    accounting_date: ev.effective_date,
    effective_date: ev.effective_date,
    description,
    status: targetStatus,
    total_debit: sumD,
    total_credit: sumC,
    source_event_id: ev.id,
    source_type: ev.source_type,
    source_id: ev.source_id,
    mapping_version: ev.mapping_version,
    journal_type: 'auto',
    reversal_of_id: null,
    reversed_by_id: null,
    fiscal_period_id: period.id,
    created_by: actorId,
    approved_by: targetStatus === 'posted' ? actorId : null,
    posted_at: targetStatus === 'posted' ? new Date().toISOString() : null,
    version: 1,
    created_at: new Date().toISOString(),
    lines: builtLines.map((l, idx) => ({
      ...l,
      id: makeUuid(),
      journal_entry_id: jeId,
      line_no: idx + 1,
    })),
  };

  // Jika penjualan barang stok diposting, kurangi inventory_valuations secara deterministik
  let nextValuations = dataset.inventoryValuations;
  let nextMovements = dataset.inventoryMovements;
  if (ev.event_type === 'sales_delivery_recognized' && targetStatus === 'posted') {
    const saleDoc = dataset.salesDocuments.find((s) => s.id === ev.source_id);
    if (saleDoc) {
      nextValuations = [...dataset.inventoryValuations];
      nextMovements = [...dataset.inventoryMovements];
      for (const sl of saleDoc.lines) {
        const prod = dataset.products.find((pr) => pr.id === sl.product_id);
        if (!prod || !prod.is_stocked) continue;
        const vIdx = nextValuations.findIndex(
          (v) => v.branch_id === saleDoc.branch_id && v.product_id === sl.product_id
        );
        if (vIdx === -1) throw new Error(`Saldo stok ${prod.sku} tidak ditemukan.`);
        const v = nextValuations[vIdx];
        const qtyOut = D(sl.quantity);
        if (D(v.qty_on_hand).lt(qtyOut)) {
          throw new Error(`Stok negatif dicegah untuk ${prod.sku}: tersisa ${v.qty_on_hand}, keluar ${sl.quantity}`);
        }
        const costOut = D(roundMoney(qtyOut.times(D(v.avg_unit_cost)), 0));
        const newQty = D(v.qty_on_hand).minus(qtyOut);
        const newVal = D(v.total_value).minus(costOut);
        const newAvg = newQty.gt(0) ? newVal.div(newQty) : D(0);
        nextValuations[vIdx] = {
          ...v,
          qty_on_hand: roundQty(newQty),
          total_value: newVal.toFixed(2),
          avg_unit_cost: roundQty(newAvg),
        };
        nextMovements.push({
          id: makeUuid(),
          company_id: dataset.companyId,
          branch_id: saleDoc.branch_id,
          product_id: sl.product_id,
          movement_date: saleDoc.delivery_date ?? saleDoc.invoice_date,
          direction: 'out',
          quantity: sl.quantity,
          unit_code: sl.unit_code,
          base_quantity: roundQty(qtyOut),
          unit_cost: v.avg_unit_cost,
          total_cost: costOut.toFixed(2),
          balance_qty_after: roundQty(newQty),
          balance_value_after: newVal.toFixed(2),
          avg_cost_after: roundQty(newAvg),
          condition_status: 'good',
          source_type: 'sales_document',
          source_id: saleDoc.id,
          sales_line_id: sl.id,
        });
      }
    }
  }

  const nextEvents = [...dataset.events];
  nextEvents[evIndex] = {
    ...ev,
    processing_status: targetStatus === 'posted' ? 'posted' : 'draft_journal',
    error_message: null,
  };

  return {
    idempotentHit: false,
    journal,
    dataset: {
      ...dataset,
      events: nextEvents,
      journals: [journal, ...dataset.journals],
      inventoryValuations: nextValuations,
      inventoryMovements: nextMovements,
      processedIdempotencyKeys: {
        ...dataset.processedIdempotencyKeys,
        [`post:${actorId}:${idempotencyKey}`]: jeId,
      },
    },
  };
}

export function computeFinancialStatements(
  dataset: LedgerDataset,
  opts: { startDate: string; endDate: string; branchId: string | 'ALL'; includeDrafts?: boolean }
): FinancialStatementsResult {
  const { startDate, endDate, branchId, includeDrafts = false } = opts;
  const activeStatuses: JournalEntry['status'][] = includeDrafts ? ['posted', 'draft'] : ['posted'];

  const branchFilteredJournals = dataset.journals.filter(
    (j) =>
      activeStatuses.includes(j.status) &&
      (branchId === 'ALL' || j.branch_id === branchId)
  );

  // 1. Trial Balance: Opening (< startDate), Mutation (startDate..endDate), Closing (<= endDate)
  const tbRows: TrialBalanceRow[] = dataset.coa.map((acct) => {
    let opD = D(0);
    let opC = D(0);
    let mutD = D(0);
    let mutC = D(0);

    for (const j of branchFilteredJournals) {
      for (const l of j.lines) {
        if (l.coa_code !== acct.code) continue;
        if (branchId !== 'ALL' && (l.branch_id ?? j.branch_id) !== branchId) continue;

        if (j.accounting_date < startDate) {
          opD = opD.plus(D(l.debit));
          opC = opC.plus(D(l.credit));
        } else if (j.accounting_date >= startDate && j.accounting_date <= endDate) {
          mutD = mutD.plus(D(l.debit));
          mutC = mutC.plus(D(l.credit));
        }
      }
    }

    const closeNet = opD.minus(opC).plus(mutD).minus(mutC);
    const opNet = opD.minus(opC);

    const opening_debit = opNet.gt(0) ? opNet.toFixed(2) : '0.00';
    const opening_credit = opNet.lt(0) ? opNet.abs().toFixed(2) : '0.00';
    const closing_debit = closeNet.gt(0) ? closeNet.toFixed(2) : '0.00';
    const closing_credit = closeNet.lt(0) ? closeNet.abs().toFixed(2) : '0.00';
    const closing_signed = acct.normal_balance === 'debit' ? closeNet.toFixed(2) : closeNet.neg().toFixed(2);

    return {
      coa_code: acct.code,
      coa_name: acct.name,
      account_group: acct.account_group,
      normal_balance: acct.normal_balance,
      opening_debit,
      opening_credit,
      mutation_debit: mutD.toFixed(2),
      mutation_credit: mutC.toFixed(2),
      closing_debit,
      closing_credit,
      closing_signed,
    };
  });

  const tbTotals = {
    opening_debit: sumMoney(tbRows.map((r) => r.opening_debit)),
    opening_credit: sumMoney(tbRows.map((r) => r.opening_credit)),
    mutation_debit: sumMoney(tbRows.map((r) => r.mutation_debit)),
    mutation_credit: sumMoney(tbRows.map((r) => r.mutation_credit)),
    closing_debit: sumMoney(tbRows.map((r) => r.closing_debit)),
    closing_credit: sumMoney(tbRows.map((r) => r.closing_credit)),
    isBalanced: false,
  };
  tbTotals.isBalanced =
    cmpMoney(tbTotals.opening_debit, tbTotals.opening_credit) === 0 &&
    cmpMoney(tbTotals.mutation_debit, tbTotals.mutation_credit) === 0 &&
    cmpMoney(tbTotals.closing_debit, tbTotals.closing_credit) === 0;

  // 2. Income Statement (periode startDate..endDate, excludes 'closing' journals so closed periods still report P&L)
  const pnlLinesInRange = branchFilteredJournals
    .filter((j) => j.journal_type !== 'closing' && j.accounting_date >= startDate && j.accounting_date <= endDate)
    .flatMap((j) => j.lines);

  const periodNetByCoa = (code: string, normal: 'debit' | 'credit'): string => {
    let net = D(0);
    for (const l of pnlLinesInRange) {
      if (l.coa_code !== code) continue;
      net = normal === 'credit' ? net.plus(D(l.credit)).minus(D(l.debit)) : net.plus(D(l.debit)).minus(D(l.credit));
    }
    return net.toFixed(2);
  };

  const grossSales = periodNetByCoa('4101', 'credit');
  const salesReturnsDiscounts = periodNetByCoa('4102', 'debit');
  const netRevenue = subMoney(grossSales, salesReturnsDiscounts);
  const cogs = periodNetByCoa('5101', 'debit');
  const grossProfit = subMoney(netRevenue, cogs);

  const operatingExpenses = dataset.coa
    .filter((a) => a.account_group === 'expense' && !a.code.startsWith('64') && !a.code.startsWith('69') && a.code !== '6501')
    .map((a) => ({
      coa_code: a.code,
      coa_name: a.name,
      amount: periodNetByCoa(a.code, 'debit'),
    }))
    .filter((x) => cmpMoney(x.amount, '0') !== 0);

  const totalOperatingExpenses = sumMoney(operatingExpenses.map((e) => e.amount));
  const operatingProfit = subMoney(grossProfit, totalOperatingExpenses);

  const otherIncome = sumMoney(
    dataset.coa
      .filter((a) => a.account_group === 'revenue' && a.code.startsWith('7'))
      .map((a) => periodNetByCoa(a.code, 'credit'))
  );
  const otherExpenses = sumMoney(
    dataset.coa
      .filter((a) => a.account_group === 'expense' && (a.code.startsWith('64') || a.code.startsWith('69')))
      .map((a) => periodNetByCoa(a.code, 'debit'))
  );

  const profitBeforeTax = subMoney(addMoney(operatingProfit, otherIncome), otherExpenses);
  const taxExpense = periodNetByCoa('6501', 'debit');
  const netProfit = subMoney(profitBeforeTax, taxExpense);

  // 3. Balance Sheet as of endDate
  const assets = tbRows
    .filter((r) => r.account_group === 'asset' && cmpMoney(r.closing_signed, '0') !== 0)
    .map((r) => ({
      coa_code: r.coa_code,
      coa_name: r.coa_name,
      amount: r.normal_balance === 'debit' ? r.closing_signed : D(r.closing_signed).neg().toFixed(2),
    }));
  const totalAssets = sumMoney(assets.map((a) => a.amount));

  const liabilities = tbRows
    .filter((r) => r.account_group === 'liability' && cmpMoney(r.closing_signed, '0') !== 0)
    .map((r) => ({
      coa_code: r.coa_code,
      coa_name: r.coa_name,
      amount: r.closing_signed,
    }));
  const totalLiabilities = sumMoney(liabilities.map((l) => l.amount));

  const equityItems = tbRows
    .filter((r) => r.account_group === 'equity' && cmpMoney(r.closing_signed, '0') !== 0)
    .map((r) => ({
      coa_code: r.coa_code,
      coa_name: r.coa_name,
      // 3103 Prive normal debit reduces equity
      amount: r.normal_balance === 'credit' ? r.closing_signed : D(r.closing_signed).neg().toFixed(2),
    }));

  // Unclosed cumulative P&L up to endDate (so before/after closing journals never double-count profit!)
  const unclosedPnlNet = tbRows
    .filter((r) => ['revenue', 'cogs', 'expense'].includes(r.account_group))
    .reduce((acc, r) => {
      const creditMinusDebit = D(r.closing_credit).minus(D(r.closing_debit));
      return acc.plus(creditMinusDebit);
    }, D(0))
    .toFixed(2);

  const totalEquity = addMoney(sumMoney(equityItems.map((e) => e.amount)), unclosedPnlNet);
  const totalLiabilitiesAndEquity = addMoney(totalLiabilities, totalEquity);
  const imbalanceDiff = subMoney(totalAssets, totalLiabilitiesAndEquity);

  // 4. Cash Flow Statement — Direct Method
  const cashCodes = new Set(dataset.coa.filter((c) => c.is_cash_component).map((c) => c.code));
  const openingCash = tbRows
    .filter((r) => cashCodes.has(r.coa_code))
    .reduce((acc, r) => acc.plus(D(r.opening_debit)).minus(D(r.opening_credit)), D(0))
    .toFixed(2);
  const closingCashBalanceSheet = tbRows
    .filter((r) => cashCodes.has(r.coa_code))
    .reduce((acc, r) => acc.plus(D(r.closing_debit)).minus(D(r.closing_credit)), D(0))
    .toFixed(2);

  let opCustomerReceipts = D(0);
  let opSupplierExpenseOut = D(0);
  let invAssetOut = D(0);
  let invAssetIn = D(0);
  let finLoanIn = D(0);
  let finLoanOut = D(0);
  let finEquityIn = D(0);
  let finDrawOut = D(0);
  let unclassifiedCash = D(0);

  for (const j of branchFilteredJournals) {
    if (j.accounting_date < startDate || j.accounting_date > endDate) continue;
    for (const l of j.lines) {
      if (!cashCodes.has(l.coa_code)) continue;
      if (l.cash_flow_category === 'internal_transfer' || l.cash_flow_category === 'non_cash') continue;
      const netCash = D(l.debit).minus(D(l.credit));

      if (l.cash_flow_category === 'unclassified') {
        unclassifiedCash = unclassifiedCash.plus(netCash);
      } else if (l.cash_flow_category === 'operating') {
        if (netCash.gt(0)) opCustomerReceipts = opCustomerReceipts.plus(netCash);
        else opSupplierExpenseOut = opSupplierExpenseOut.plus(netCash);
      } else if (l.cash_flow_category === 'investing') {
        if (netCash.lt(0)) invAssetOut = invAssetOut.plus(netCash);
        else invAssetIn = invAssetIn.plus(netCash);
      } else if (l.cash_flow_category === 'financing') {
        if (j.source_type === 'loan' || j.description.toLowerCase().includes('pinjaman')) {
          if (netCash.gt(0)) finLoanIn = finLoanIn.plus(netCash);
          else finLoanOut = finLoanOut.plus(netCash);
        } else {
          if (netCash.gt(0)) finEquityIn = finEquityIn.plus(netCash);
          else finDrawOut = finDrawOut.plus(netCash);
        }
      }
    }
  }

  const operatingLines = [
    { label: 'Penerimaan kas dari pelanggan (termasuk titipan terverifikasi)', amount: opCustomerReceipts.toFixed(2) },
    { label: 'Pembayaran kas ke pemasok, biaya operasional & refund', amount: opSupplierExpenseOut.toFixed(2) },
  ];
  const netOperating = opCustomerReceipts.plus(opSupplierExpenseOut).toFixed(2);

  const investingLines = [
    { label: 'Perolehan aset tetap', amount: invAssetOut.toFixed(2) },
    { label: 'Penerimaan pelepasan aset tetap', amount: invAssetIn.toFixed(2) },
  ];
  const netInvesting = invAssetOut.plus(invAssetIn).toFixed(2);

  const financingLines = [
    { label: 'Penerimaan pinjaman', amount: finLoanIn.toFixed(2) },
    { label: 'Pembayaran pokok pinjaman', amount: finLoanOut.toFixed(2) },
    { label: 'Setoran modal pemilik', amount: finEquityIn.toFixed(2) },
    { label: 'Prive / distribusi pemilik', amount: finDrawOut.toFixed(2) },
  ];
  const netFinancing = finLoanIn.plus(finLoanOut).plus(finEquityIn).plus(finDrawOut).toFixed(2);
  const netCashChange = D(netOperating).plus(D(netInvesting)).plus(D(netFinancing)).plus(unclassifiedCash).toFixed(2);
  const closingCashComputed = addMoney(openingCash, netCashChange);
  const limit = D(dataset.policy.unknown_cash_materiality_limit || '0');
  const cashFlowHeldForUnclassified = unclassifiedCash.abs().gt(limit);

  // 5. Equity Changes
  const openingEquity = tbRows
    .filter((r) => r.account_group === 'equity' || ['revenue', 'cogs', 'expense'].includes(r.account_group))
    .reduce((acc, r) => acc.plus(D(r.opening_credit)).minus(D(r.opening_debit)), D(0))
    .toFixed(2);
  const capitalInjections = sumMoney(
    branchFilteredJournals
      .filter((j) => j.accounting_date >= startDate && j.accounting_date <= endDate)
      .flatMap((j) => j.lines)
      .filter((l) => l.coa_code === '3101')
      .map((l) => subMoney(l.credit, l.debit))
  );
  const ownerDrawings = sumMoney(
    branchFilteredJournals
      .filter((j) => j.accounting_date >= startDate && j.accounting_date <= endDate)
      .flatMap((j) => j.lines)
      .filter((l) => l.coa_code === '3103')
      .map((l) => subMoney(l.debit, l.credit))
  );
  const approvedAdjustments = '0.00';
  const closingEquityComputed = subMoney(addMoney(addMoney(openingEquity, capitalInjections), netProfit), ownerDrawings);

  // 6. Control Account Tie-Outs as of endDate
  const getGlAsOf = (code: string, normal: 'debit' | 'credit'): string => {
    const row = tbRows.find((r) => r.coa_code === code);
    if (!row) return '0.00';
    return normal === 'debit'
      ? subMoney(row.closing_debit, row.closing_credit)
      : subMoney(row.closing_credit, row.closing_debit);
  };

  // Subledgers as of endDate
  const arSubledger = sumMoney(
    dataset.salesDocuments
      .filter((s) => s.invoice_date <= endDate && (branchId === 'ALL' || s.branch_id === branchId) && ['approved', 'released'].includes(s.status))
      .map((s) => subMoney(s.total_amount, s.allocated_amount))
  );
  const depositSubledger = sumMoney(
    dataset.receipts
      .filter((r) => (r.bank_value_date ?? r.customer_paid_at) <= endDate && !r.is_unknown_identity && r.status === 'verified' && (branchId === 'ALL' || r.branch_id === branchId))
      .map((r) => subMoney(subMoney(r.verified_amount, r.allocated_amount), r.refunded_amount))
  );
  const custodySubledger = sumMoney(
    dataset.custodyAccounts
      .filter((c) => branchId === 'ALL' || c.branch_id === branchId)
      .map((c) => addMoney(c.verified_balance, c.shortage_open_amount))
  );
  const apSubledger = sumMoney(
    dataset.purchaseDocuments
      .filter((p) => p.invoice_date <= endDate && p.status === 'approved' && (branchId === 'ALL' || p.branch_id === branchId))
      .map((p) => subMoney(p.total_amount, p.paid_amount))
  );
  const invSubledger = sumMoney(
    dataset.inventoryValuations
      .filter((v) => branchId === 'ALL' || v.branch_id === branchId)
      .map((v) => v.total_value)
  );

  const tieOuts = [
    { label: 'Piutang Usaha (AR)', coaCode: '1104', glBalance: getGlAsOf('1104', 'debit'), subledgerBalance: arSubledger },
    { label: 'Uang Muka / Titipan Pelanggan', coaCode: '2102', glBalance: getGlAsOf('2102', 'credit'), subledgerBalance: depositSubledger },
    { label: 'Kas di Penagih (Custody)', coaCode: '1102', glBalance: getGlAsOf('1102', 'debit'), subledgerBalance: custodySubledger },
    { label: 'Utang Usaha Pemasok (AP)', coaCode: '2101', glBalance: getGlAsOf('2101', 'credit'), subledgerBalance: apSubledger },
    { label: 'Persediaan Barang Dagang', coaCode: '1105', glBalance: getGlAsOf('1105', 'debit'), subledgerBalance: invSubledger },
  ].map((t) => {
    const difference = subMoney(t.glBalance, t.subledgerBalance);
    return { ...t, difference, isMatched: cmpMoney(difference, '0') === 0 };
  });

  // 7. Aging AR & AP
  const agingAR = buildAgingSummary(
    dataset.salesDocuments
      .filter((s) => s.invoice_date <= endDate && ['approved', 'released'].includes(s.status) && (branchId === 'ALL' || s.branch_id === branchId))
      .map((s) => ({
        entityId: s.customer_id,
        entityName: dataset.customers.find((c) => c.id === s.customer_id)?.name ?? s.customer_id,
        docNumber: s.doc_number,
        invoiceDate: s.invoice_date,
        dueDate: s.due_date,
        outstanding: subMoney(s.total_amount, s.allocated_amount),
      }))
      .filter((r) => cmpMoney(r.outstanding, '0') > 0),
    endDate
  );

  const agingAP = buildAgingSummary(
    dataset.purchaseDocuments
      .filter((p) => p.invoice_date <= endDate && p.status === 'approved' && (branchId === 'ALL' || p.branch_id === branchId))
      .map((p) => ({
        entityId: p.supplier_id,
        entityName: dataset.suppliers.find((sp) => sp.id === p.supplier_id)?.name ?? p.supplier_id,
        docNumber: p.doc_number,
        invoiceDate: p.invoice_date,
        dueDate: p.due_date,
        outstanding: subMoney(p.total_amount, p.paid_amount),
      }))
      .filter((r) => cmpMoney(r.outstanding, '0') > 0),
    endDate
  );

  // 8. Completeness Gaps & Status Draft vs Final Internal
  const completenessGaps: string[] = [];
  if (dataset.policy.reporting_framework_status === 'unconfigured') {
    completenessGaps.push('Kerangka pelaporan (SAK) berstatus "Belum ditetapkan".');
  }
  if (dataset.policy.tax_policy_status === 'unconfigured') {
    completenessGaps.push('Kebijakan pajak usaha (PKP/Non-PKP & tarif) belum ditetapkan.');
  }
  if (dataset.policy.opening_status !== 'approved') {
    completenessGaps.push('Saldo awal & cutover belum disetujui penuh ("Data Awal Belum Lengkap").');
  }
  if (dataset.policy.is_midyear_cutover && dataset.policy.ytd_hist_status !== 'verified') {
    completenessGaps.push('Cutover tengah tahun: histori YTD sebelum cutover belum tervalidasi (laporan hanya mencakup sejak cutover).');
  }

  const unpostedEvents = dataset.events.filter(
    (e) =>
      e.effective_date <= endDate &&
      ['waiting_accounting_module', 'queued', 'draft_journal', 'failed'].includes(e.processing_status) &&
      (branchId === 'ALL' || e.branch_id === branchId)
  );
  const failedCogsCount = unpostedEvents.filter((e) => (e.error_message ?? '').toLowerCase().includes('hpp')).length;
  const unpostedEventsValue = sumMoney(
    unpostedEvents.map((e) => {
      const p = e.payload_snapshot as Record<string, unknown>;
      return String(p.total_amount ?? p.verified_amount ?? p.received_amount ?? p.amount ?? '0');
    })
  );

  if (unpostedEvents.length > 0) {
    completenessGaps.push(`${unpostedEvents.length} event operasional belum terposting ke buku besar (estimasi nilai: ${unpostedEventsValue}).`);
  }
  if (cashFlowHeldForUnclassified) {
    completenessGaps.push(`Terdapat kas masuk belum teridentifikasi (${unclassifiedCash.toFixed(2)}) melebihi batas materialitas; arus kas final ditahan.`);
  }
  if (agingAR.missingDueDateCount > 0 || agingAP.missingDueDateCount > 0) {
    completenessGaps.push(
      `Gap tanggal jatuh tempo: ${agingAR.missingDueDateCount} nota piutang dan ${agingAP.missingDueDateCount} tagihan pemasok belum memiliki due_date.`
    );
  }
  const unmatchedTieOuts = tieOuts.filter((t) => !t.isMatched);
  if (unmatchedTieOuts.length > 0) {
    completenessGaps.push(`Selisih rekonsiliasi GL vs Subledger pada: ${unmatchedTieOuts.map((t) => t.label).join(', ')}.`);
  }

  const branchScopeLabel =
    branchId === 'ALL'
      ? 'Konsolidasi Semua Cabang'
      : dataset.branches.find((b) => b.id === branchId)?.name ?? branchId;

  const isFinalInternal =
    !includeDrafts &&
    completenessGaps.length === 0 &&
    tbTotals.isBalanced &&
    cmpMoney(imbalanceDiff, '0') === 0;

  return {
    asOfDate: endDate,
    startDate,
    endDate,
    branchScopeLabel,
    reportStatus: isFinalInternal ? 'Final Internal' : 'Draft',
    completenessGaps,
    unpostedEventsCount: unpostedEvents.length,
    unpostedEventsValue,
    failedCogsCount,
    unclassifiedCashAmount: unclassifiedCash.toFixed(2),
    trialBalance: tbRows,
    trialBalanceTotals: tbTotals,
    incomeStatement: {
      grossSales,
      salesReturnsDiscounts,
      netRevenue,
      cogs,
      grossProfit,
      operatingExpenses,
      totalOperatingExpenses,
      operatingProfit,
      otherIncome,
      otherExpenses,
      profitBeforeTax,
      taxExpense,
      netProfit,
    },
    balanceSheet: {
      assets,
      totalAssets,
      liabilities,
      totalLiabilities,
      equityItems,
      currentPeriodEarnings: unclosedPnlNet,
      totalEquity,
      totalLiabilitiesAndEquity,
      isBalanced: cmpMoney(imbalanceDiff, '0') === 0,
      imbalanceDiff,
    },
    cashFlowDirect: {
      openingCash,
      operatingLines,
      netOperating,
      investingLines,
      netInvesting,
      financingLines,
      netFinancing,
      unclassifiedAmount: unclassifiedCash.toFixed(2),
      netCashChange,
      closingCashComputed,
      closingCashBalanceSheet,
      reconcilesWithBalanceSheet: cmpMoney(closingCashComputed, closingCashBalanceSheet) === 0,
      cashFlowHeldForUnclassified,
    },
    equityChanges: {
      openingEquity,
      capitalInjections,
      periodNetProfit: netProfit,
      ownerDrawings,
      approvedAdjustments,
      closingEquity: closingEquityComputed,
      reconcilesWithBalanceSheet: cmpMoney(closingEquityComputed, totalEquity) === 0,
    },
    tieOuts,
    agingAR,
    agingAP,
  };
}

function buildAgingSummary(
  items: { entityId: string; entityName: string; docNumber: string; invoiceDate: string; dueDate: string | null; outstanding: string }[],
  asOfDate: string
): AgingSummary {
  const rows: AgingBucketRow[] = items.map((item) => {
    const missingDueDate = !item.dueDate;
    let notDue = '0.00';
    let d0_30 = '0.00';
    let d31_60 = '0.00';
    let d61_90 = '0.00';
    let dOver90 = '0.00';

    if (!missingDueDate && item.dueDate) {
      const overdueDays = daysBetween(item.dueDate, asOfDate);
      if (overdueDays <= 0) notDue = item.outstanding;
      else if (overdueDays <= 30) d0_30 = item.outstanding;
      else if (overdueDays <= 60) d31_60 = item.outstanding;
      else if (overdueDays <= 90) d61_90 = item.outstanding;
      else dOver90 = item.outstanding;
    }

    return {
      ...item,
      notDue,
      d0_30,
      d31_60,
      d61_90,
      dOver90,
      missingDueDate,
    };
  });

  const missingRows = rows.filter((r) => r.missingDueDate);
  return {
    rows,
    totalOutstanding: sumMoney(rows.map((r) => r.outstanding)),
    notDue: sumMoney(rows.map((r) => r.notDue)),
    d0_30: sumMoney(rows.map((r) => r.d0_30)),
    d31_60: sumMoney(rows.map((r) => r.d31_60)),
    d61_90: sumMoney(rows.map((r) => r.d61_90)),
    dOver90: sumMoney(rows.map((r) => r.dOver90)),
    missingDueDateCount: missingRows.length,
    missingDueDateAmount: sumMoney(missingRows.map((r) => r.outstanding)),
  };
}

export function computeGeneralLedger(
  dataset: LedgerDataset,
  coaCode: string,
  startDate: string,
  endDate: string,
  branchId: string | 'ALL'
): { openingBalance: string; entries: GeneralLedgerEntryRow[]; closingBalance: string } {
  const acct = dataset.coa.find((c) => c.code === coaCode);
  const normal = acct?.normal_balance ?? 'debit';
  const posted = dataset.journals
    .filter((j) => j.status === 'posted' && (branchId === 'ALL' || j.branch_id === branchId))
    .sort((a, b) => a.accounting_date.localeCompare(b.accounting_date) || a.journal_number.localeCompare(b.journal_number));

  let running = D(0);
  for (const j of posted) {
    if (j.accounting_date >= startDate) continue;
    for (const l of j.lines) {
      if (l.coa_code !== coaCode) continue;
      running = normal === 'debit' ? running.plus(D(l.debit)).minus(D(l.credit)) : running.plus(D(l.credit)).minus(D(l.debit));
    }
  }
  const openingBalance = running.toFixed(2);
  const entries: GeneralLedgerEntryRow[] = [];

  for (const j of posted) {
    if (j.accounting_date < startDate || j.accounting_date > endDate) continue;
    for (const l of j.lines) {
      if (l.coa_code !== coaCode) continue;
      running = normal === 'debit' ? running.plus(D(l.debit)).minus(D(l.credit)) : running.plus(D(l.credit)).minus(D(l.debit));
      entries.push({
        journal_entry_id: j.id,
        journal_number: j.journal_number,
        accounting_date: j.accounting_date,
        effective_date: j.effective_date,
        description: j.description,
        source_type: j.source_type,
        source_id: j.source_id,
        memo: l.memo,
        debit: l.debit,
        credit: l.credit,
        running_balance: running.toFixed(2),
      });
    }
  }

  return { openingBalance, entries, closingBalance: running.toFixed(2) };
}

export function checkMenuAccess(roles: RoleCode[], menu: string): boolean {
  if (roles.includes('system_admin') && ['ringkasan', 'audit_pengaturan'].includes(menu)) return true;
  if (roles.includes('owner_viewer')) {
    return ['ringkasan', 'jurnal', 'buku_besar', 'neraca_saldo', 'piutang_titipan', 'kas_bank', 'laporan', 'audit_pengaturan'].includes(menu);
  }
  if (roles.includes('accountant') || roles.includes('accounting_approver')) {
    return true;
  }
  if (roles.includes('finance_checker') || roles.includes('finance_maker')) {
    return ['ringkasan', 'kas_bank', 'piutang_titipan', 'utang_pemasok', 'biaya'].includes(menu);
  }
  if (roles.includes('sales_admin') || roles.includes('reconciliation_reviewer')) {
    return ['ringkasan', 'piutang_titipan'].includes(menu);
  }
  return false;
}
