import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  BookOpen,
  Building2,
  Calculator,
  ClipboardList,
  CreditCard,
  ExternalLink,
  FileText,
  Landmark,
  Layers,
  Lock,
  LogOut,
  Package,
  Receipt,
  RefreshCw,
  Scale,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
} from 'lucide-react';
import {
  assertOpenPeriod,
  checkMenuAccess,
  computeFinancialStatements,
  LedgerDataset,
  processEventIntoDataset,
} from './lib/accountingEngine';
import { createSyntheticDemoDataset } from './data/syntheticSeed';
import { D, formatDateTimeJKT, roundMoney, roundQty, sumMoney } from './lib/decimal';
import { fetchLiveLedgerDataset, LiveSessionInfo, loadLiveSessionInfo } from './lib/liveSupabaseLoader';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import {
  AccountingPolicy,
  AuditEvent,
  CashFlowCategory,
  JournalEntry,
  MenuKey,
  RoleCode,
} from './types/finops';
import { SetupAndAuthView } from './components/SetupAndAuthView';
import { SourceDrawer } from './components/SourceDrawer';
import { AntrianPembukuanView, RingkasanKeuanganView } from './components/OverviewAndQueueViews';
import { BukuBesarView, JurnalUmumView, NeracaSaldoView } from './components/LedgerViews';
import { PembelianPenerimaanView, PiutangTitipanView, UtangPemasokView } from './components/ReceivablesPayablesViews';
import { BiayaView, KasBankRekonsiliasiView, PersediaanHppView } from './components/InventoryExpensesCashViews';
import { AsetTetapView, PajakView, PinjamanModalView } from './components/AssetsLoansTaxViews';
import { LaporanKeuanganView, TutupBukuView } from './components/ReportsAndCloseViews';
import { GovernanceAndSettingsView } from './components/GovernanceAndSettingsView';

const MENU_GROUPS: {
  group: string;
  items: { key: MenuKey; label: string; icon: React.ComponentType<{ className?: string }> }[];
}[] = [
  {
    group: 'Inti Pembukuan',
    items: [
      { key: 'ringkasan', label: 'Ringkasan Keuangan', icon: Activity },
      { key: 'antrian', label: 'Antrian Pembukuan', icon: ClipboardList },
      { key: 'jurnal', label: 'Jurnal Umum', icon: FileText },
      { key: 'buku_besar', label: 'Buku Besar', icon: BookOpen },
      { key: 'neraca_saldo', label: 'Neraca Saldo', icon: Scale },
    ],
  },
  {
    group: 'Subledger & Operasional',
    items: [
      { key: 'piutang_titipan', label: 'Piutang & Titipan', icon: Users },
      { key: 'utang_pemasok', label: 'Utang Pemasok', icon: CreditCard },
      { key: 'pembelian_penerimaan', label: 'Pembelian & Penerimaan', icon: ShoppingCart },
      { key: 'persediaan_hpp', label: 'Persediaan & HPP', icon: Package },
      { key: 'biaya', label: 'Biaya', icon: Receipt },
      { key: 'kas_bank', label: 'Kas/Bank & Rekonsiliasi', icon: Wallet },
    ],
  },
  {
    group: 'Aset, Pendanaan & Pajak',
    items: [
      { key: 'aset_tetap', label: 'Aset Tetap', icon: Building2 },
      { key: 'pinjaman_modal', label: 'Pinjaman/Modal/Prive', icon: Landmark },
      { key: 'pajak', label: 'Pajak', icon: Calculator },
    ],
  },
  {
    group: 'Pelaporan & Tata Kelola',
    items: [
      { key: 'laporan', label: 'Laporan Keuangan', icon: Layers },
      { key: 'tutup_buku', label: 'Tutup Buku', icon: Lock },
      { key: 'audit_pengaturan', label: 'Audit & Pengaturan', icon: Settings },
    ],
  },
];

function uid(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const [mode, setMode] = useState<'loading' | 'auth_setup' | 'live' | 'demo'>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [liveSession, setLiveSession] = useState<LiveSessionInfo | null>(null);
  const [dataset, setDataset] = useState<LedgerDataset>(() => createSyntheticDemoDataset());
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([
    {
      id: 'ae-init-1',
      company_id: '11111111-1111-4111-8111-111111111111',
      branch_id: null,
      actor_id: 'user-app-1',
      actor_name: 'Sari (Accounting Approver)',
      event_action: 'opening.approve',
      entity_type: 'opening_balance',
      entity_id: 'opn-batch-1',
      before_state: null,
      after_state: { status: 'approved', total: '255000000.00' },
      reason: 'Persetujuan saldo awal cutover 31/10/2026',
      source_app: 'app3_accounting_reports',
      created_at: '2026-10-31T18:00:00+07:00',
    },
  ]);

  // Demo role simulator (ONLY active in explicit Demo Mode)
  const [demoRole, setDemoRole] = useState<RoleCode>('accounting_approver');
  const [demoUserId, setDemoUserId] = useState<string>('user-app-1');

  const [activeMenu, setActiveMenu] = useState<MenuKey>('ringkasan');
  const [selectedBranch, setSelectedBranch] = useState<string | 'ALL'>('ALL');
  const [startDate, setStartDate] = useState('2026-11-01');
  const [endDate, setEndDate] = useState('2026-11-16');
  const [ledgerCoaJump, setLedgerCoaJump] = useState<string>('1103');
  const [selectedJournal, setSelectedJournal] = useState<JournalEntry | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toISOString());
  const [realtimeConnected, setRealtimeConnected] = useState<boolean>(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const loadLive = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setMode('auth_setup');
      return;
    }
    try {
      const info = await loadLiveSessionInfo();
      if (!info) {
        setMode('auth_setup');
        return;
      }
      setLiveSession(info);
      const ds = await fetchLiveLedgerDataset(info);
      setDataset(ds);
      setLastUpdated(new Date().toISOString());
      setMode('live');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
      setMode('auth_setup');
    }
  }, []);

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  // Realtime invalidation + fallback polling in Live mode
  useEffect(() => {
    if (mode !== 'live' || !supabase || !liveSession) return;
    const channel = supabase
      .channel(`finops-app3-${liveSession.companyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounting_events' }, () => void loadLive())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'journal_entries' }, () => void loadLive())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fiscal_periods' }, () => void loadLive())
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    const interval = window.setInterval(() => {
      void loadLive();
    }, 45000);

    return () => {
      void supabase?.removeChannel(channel);
      window.clearInterval(interval);
    };
  }, [mode, liveSession, loadLive]);

  const currentRoles: RoleCode[] = mode === 'live' && liveSession ? liveSession.roles : [demoRole];
  const currentUserId = mode === 'live' && liveSession ? liveSession.userId : demoUserId;
  const currentActorName =
    mode === 'live' && liveSession
      ? liveSession.fullName
      : demoRole === 'accounting_approver'
      ? 'Sari (Approver Demo)'
      : demoRole === 'accountant'
      ? 'Budi (Akuntan Demo)'
      : demoRole === 'owner_viewer'
      ? 'Hendra (Owner Viewer Demo)'
      : 'Rina (Finance Checker Demo)';

  const statements = useMemo(
    () => computeFinancialStatements(dataset, { startDate, endDate, branchId: selectedBranch }),
    [dataset, startDate, endDate, selectedBranch]
  );

  const appendAudit = (action: string, entityType: string, entityId: string, reason: string) => {
    setAuditLog((prev) => [
      {
        id: uid(),
        company_id: dataset.companyId,
        branch_id: selectedBranch === 'ALL' ? null : selectedBranch,
        actor_id: currentUserId,
        actor_name: currentActorName,
        event_action: action,
        entity_type: entityType,
        entity_id: entityId,
        before_state: null,
        after_state: null,
        reason,
        source_app: 'app3_accounting_reports',
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  // --- Handlers (Live RPCs vs Deterministic Sandbox Engine) ---
  const handleProcessEvent = async (eventId: string, forceMode: 'default' | 'posted') => {
    setBannerError(null);
    const idempotencyKey = `ui-${eventId}-${forceMode}-${Date.now()}`;
    if (mode === 'live' && supabase) {
      const { error } = await supabase.rpc('post_accounting_event', {
        p_idempotency_key: idempotencyKey,
        p_accounting_event_id: eventId,
        p_force_status: forceMode === 'posted' ? 'posted' : null,
      });
      if (error) {
        setBannerError(error.message);
        await loadLive();
        return;
      }
      await loadLive();
      return;
    }

    const res = processEventIntoDataset(
      dataset,
      eventId,
      currentUserId,
      idempotencyKey,
      forceMode === 'posted' ? 'posted' : undefined
    );
    setDataset(res.dataset);
    setLastUpdated(new Date().toISOString());
    appendAudit('accounting.post_event', 'journal_entry', res.journal.id, `Event ${eventId} diproses`);
  };

  const handleProcessAllQueue = async () => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      const { error } = await supabase.rpc('process_accounting_queue', {
        p_company_id: dataset.companyId,
        p_limit: 50,
      });
      if (error) setBannerError(error.message);
      await loadLive();
      return;
    }

    let next = dataset;
    const errors: string[] = [];
    for (const ev of dataset.events) {
      if (['waiting_accounting_module', 'queued'].includes(ev.processing_status)) {
        try {
          const out = processEventIntoDataset(next, ev.id, currentUserId, `batch-${ev.id}`);
          next = out.dataset;
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
    }
    setDataset(next);
    setLastUpdated(new Date().toISOString());
    if (errors.length > 0) setBannerError(errors.join(' | '));
    appendAudit('accounting.process_queue', 'accounting_events', dataset.companyId, 'Pemrosesan antrean event pembukuan');
  };

  const handleCreateManualJournal = async (input: {
    branchId: string;
    accountingDate: string;
    effectiveDate: string;
    description: string;
    journalType: 'manual' | 'subledger_adjustment';
    reason: string;
    lines: {
      coa_code: string;
      debit: string;
      credit: string;
      memo: string;
      cash_flow_category: CashFlowCategory;
      customer_id?: string;
      supplier_id?: string;
      product_id?: string;
    }[];
  }) => {
    if (mode === 'live' && supabase) {
      const { error } = await supabase.rpc('create_manual_journal', {
        p_idempotency_key: `mj-${uid()}`,
        p_company_id: dataset.companyId,
        p_branch_id: input.branchId,
        p_accounting_date: input.accountingDate,
        p_effective_date: input.effectiveDate,
        p_description: input.description,
        p_journal_type: input.journalType,
        p_lines: input.lines,
        p_reason: input.reason,
      });
      if (error) throw new Error(error.message);
      await loadLive();
      return;
    }

    const period = assertOpenPeriod(dataset.fiscalPeriods, input.accountingDate);
    const totalD = sumMoney(input.lines.map((l) => l.debit));
    const totalC = sumMoney(input.lines.map((l) => l.credit));
    const jeId = uid();
    const jeNo = `JRM-${input.accountingDate.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;

    const newJe: JournalEntry = {
      id: jeId,
      company_id: dataset.companyId,
      branch_id: input.branchId,
      journal_number: jeNo,
      accounting_date: input.accountingDate,
      effective_date: input.effectiveDate,
      description: input.description,
      status: 'draft',
      total_debit: totalD,
      total_credit: totalC,
      source_event_id: null,
      source_type: input.journalType,
      source_id: jeId,
      mapping_version: 'v1',
      journal_type: input.journalType,
      reversal_of_id: null,
      reversed_by_id: null,
      fiscal_period_id: period.id,
      created_by: currentUserId,
      approved_by: null,
      posted_at: null,
      reason: input.reason,
      version: 1,
      created_at: new Date().toISOString(),
      lines: input.lines.map((l, idx) => ({
        ...l,
        id: uid(),
        journal_entry_id: jeId,
        line_no: idx + 1,
        branch_id: input.branchId,
      })),
    };
    setDataset((prev) => ({ ...prev, journals: [newJe, ...prev.journals] }));
    appendAudit('journal.create_manual', 'journal_entry', jeId, input.reason);
  };

  const handleApproveJournal = async (journalId: string) => {
    const j = dataset.journals.find((x) => x.id === journalId);
    if (!j) return;
    if (j.created_by === currentUserId) {
      throw new Error('Pelanggaran pemisahan tugas (maker-checker): pembuat jurnal tidak boleh menyetujui jurnal buatannya sendiri.');
    }

    if (mode === 'live' && supabase) {
      const { error } = await supabase.rpc('approve_manual_journal', {
        p_idempotency_key: `apj-${journalId}-${j.version}`,
        p_journal_entry_id: journalId,
        p_expected_version: j.version,
      });
      if (error) throw new Error(error.message);
      setSelectedJournal(null);
      await loadLive();
      return;
    }

    assertOpenPeriod(dataset.fiscalPeriods, j.accounting_date);
    const updated: JournalEntry = {
      ...j,
      status: 'posted',
      approved_by: currentUserId,
      posted_at: new Date().toISOString(),
      version: j.version + 1,
    };
    setDataset((prev) => ({
      ...prev,
      journals: prev.journals.map((x) => (x.id === journalId ? updated : x)),
    }));
    setSelectedJournal(updated);
    appendAudit('journal.approve', 'journal_entry', journalId, `Posting jurnal ${j.journal_number}`);
  };

  const handleReverseJournal = async (journalId: string, reversalDate: string, reason: string) => {
    const orig = dataset.journals.find((x) => x.id === journalId);
    if (!orig) return;

    if (mode === 'live' && supabase) {
      const { error } = await supabase.rpc('reverse_journal', {
        p_idempotency_key: `rev-${journalId}`,
        p_journal_entry_id: journalId,
        p_reversal_date: reversalDate,
        p_reason: reason,
      });
      if (error) throw new Error(error.message);
      setSelectedJournal(null);
      await loadLive();
      return;
    }

    const period = assertOpenPeriod(dataset.fiscalPeriods, reversalDate);
    if (orig.reversed_by_id) throw new Error('Jurnal sudah pernah dibalik.');

    const revId = uid();
    const revNo = `REV-${reversalDate.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;
    const revEntry: JournalEntry = {
      id: revId,
      company_id: dataset.companyId,
      branch_id: orig.branch_id,
      journal_number: revNo,
      accounting_date: reversalDate,
      effective_date: reversalDate,
      description: `Reversal ${orig.journal_number}: ${reason}`,
      status: 'posted',
      total_debit: orig.total_credit,
      total_credit: orig.total_debit,
      source_event_id: null,
      source_type: orig.source_type,
      source_id: orig.source_id,
      mapping_version: orig.mapping_version,
      journal_type: 'reversal',
      reversal_of_id: orig.id,
      reversed_by_id: null,
      fiscal_period_id: period.id,
      created_by: currentUserId,
      approved_by: currentUserId,
      posted_at: new Date().toISOString(),
      reason,
      version: 1,
      created_at: new Date().toISOString(),
      lines: orig.lines.map((l, idx) => ({
        ...l,
        id: uid(),
        journal_entry_id: revId,
        line_no: idx + 1,
        debit: l.credit,
        credit: l.debit,
        memo: `Reversal: ${l.memo ?? ''}`,
      })),
    };

    setDataset((prev) => ({
      ...prev,
      journals: [
        revEntry,
        ...prev.journals.map((x) => (x.id === orig.id ? { ...x, status: 'reversed' as const, reversed_by_id: revId } : x)),
      ],
    }));
    setSelectedJournal(revEntry);
    appendAudit('journal.reverse', 'journal_entry', orig.id, reason);
  };

  const handleCreateGoodsReceipt = async (input: {
    branchId: string;
    supplierId: string;
    receivedDate: string;
    productId: string;
    unitCode: string;
    quantity: string;
    estimatedUnitCost: string;
  }) => {
    setBannerError(null);
    const prod = dataset.products.find((p) => p.id === input.productId);
    const conv = D(prod?.units.find((u) => u.unit_code === input.unitCode)?.conversion_factor ?? '1');

    if (mode === 'live' && supabase) {
      try {
        const { data: created, error: cErr } = await supabase.rpc('create_goods_receipt', {
          p_idempotency_key: `grn-c-${uid()}`,
          p_company_id: dataset.companyId,
          p_branch_id: input.branchId,
          p_supplier_id: input.supplierId,
          p_received_date: input.receivedDate,
          p_lines: [
            {
              product_id: input.productId,
              unit_code: input.unitCode,
              quantity: Number(input.quantity),
              conversion_factor: Number(conv.toFixed(6)),
              estimated_unit_cost: Number(input.estimatedUnitCost),
              condition_status: 'good',
            },
          ],
        });
        if (cErr) throw new Error(cErr.message);
        const grnId = (created as { goods_receipt_id: string }).goods_receipt_id;
        const { error: pErr } = await supabase.rpc('post_goods_receipt', {
          p_idempotency_key: `grn-p-${grnId}`,
          p_goods_receipt_id: grnId,
          p_expected_version: 1,
        });
        if (pErr) throw new Error(pErr.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const period = assertOpenPeriod(dataset.fiscalPeriods, input.receivedDate);
    const baseQty = D(input.quantity).times(conv);
    const totalCost = D(roundMoney(D(input.quantity).times(D(input.estimatedUnitCost)), 0));

    const grnId = uid();
    const grnNo = `GRN-${input.receivedDate.slice(0, 7).replace('-', '')}-${String(dataset.goodsReceipts.length + 1).padStart(4, '0')}`;
    const jeId = uid();
    const jeNo = `JRN-${input.receivedDate.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;

    setDataset((prev) => {
      const nextVals = [...prev.inventoryValuations];
      const idx = nextVals.findIndex((v) => v.branch_id === input.branchId && v.product_id === input.productId);
      const oldQty = idx >= 0 ? D(nextVals[idx].qty_on_hand) : D(0);
      const oldVal = idx >= 0 ? D(nextVals[idx].total_value) : D(0);
      const newQty = oldQty.plus(baseQty);
      const newVal = oldVal.plus(totalCost);
      const newAvg = newVal.div(newQty);

      if (idx >= 0) {
        nextVals[idx] = { ...nextVals[idx], qty_on_hand: roundQty(newQty), total_value: newVal.toFixed(2), avg_unit_cost: roundQty(newAvg) };
      } else {
        nextVals.push({ id: uid(), company_id: prev.companyId, branch_id: input.branchId, product_id: input.productId, qty_on_hand: roundQty(newQty), avg_unit_cost: roundQty(newAvg), total_value: newVal.toFixed(2) });
      }

      return {
        ...prev,
        goodsReceipts: [
          {
            id: grnId,
            company_id: prev.companyId,
            branch_id: input.branchId,
            grn_number: grnNo,
            supplier_id: input.supplierId,
            received_date: input.receivedDate,
            status: 'posted',
            invoiced_status: 'uninvoiced',
            total_estimated_cost: totalCost.toFixed(2),
            lines: [{ id: uid(), product_id: input.productId, unit_code: input.unitCode, quantity: roundQty(input.quantity), conversion_factor: roundQty(conv), estimated_unit_cost: input.estimatedUnitCost, condition_status: 'good' }],
          },
          ...prev.goodsReceipts,
        ],
        inventoryValuations: nextVals,
        inventoryMovements: [
          {
            id: uid(),
            company_id: prev.companyId,
            branch_id: input.branchId,
            product_id: input.productId,
            movement_date: input.receivedDate,
            direction: 'in',
            quantity: roundQty(input.quantity),
            unit_code: input.unitCode,
            base_quantity: roundQty(baseQty),
            unit_cost: roundQty(totalCost.div(baseQty)),
            total_cost: totalCost.toFixed(2),
            balance_qty_after: roundQty(newQty),
            balance_value_after: newVal.toFixed(2),
            avg_cost_after: roundQty(newAvg),
            condition_status: 'good',
            source_type: 'goods_receipt',
            source_id: grnId,
          },
          ...prev.inventoryMovements,
        ],
        journals: [
          {
            id: jeId,
            company_id: prev.companyId,
            branch_id: input.branchId,
            journal_number: jeNo,
            accounting_date: input.receivedDate,
            effective_date: input.receivedDate,
            description: `Penerimaan Barang ${grnNo} (GRNI)`,
            status: 'posted',
            total_debit: totalCost.toFixed(2),
            total_credit: totalCost.toFixed(2),
            source_event_id: null,
            source_type: 'goods_receipt',
            source_id: grnId,
            mapping_version: 'v1',
            journal_type: 'auto',
            reversal_of_id: null,
            reversed_by_id: null,
            fiscal_period_id: period.id,
            created_by: currentUserId,
            approved_by: currentUserId,
            posted_at: new Date().toISOString(),
            version: 1,
            created_at: new Date().toISOString(),
            lines: [
              { id: uid(), journal_entry_id: jeId, line_no: 1, coa_code: '1105', debit: totalCost.toFixed(2), credit: '0.00', memo: `Persediaan masuk ${prod?.sku ?? ''}`, branch_id: input.branchId, product_id: input.productId, cash_flow_category: 'non_cash' },
              { id: uid(), journal_entry_id: jeId, line_no: 2, coa_code: '2106', debit: '0.00', credit: totalCost.toFixed(2), memo: `GRNI ${grnNo}`, branch_id: input.branchId, supplier_id: input.supplierId, cash_flow_category: 'non_cash' },
            ],
          },
          ...prev.journals,
        ],
      };
    });
    appendAudit('goods_receipt.post', 'goods_receipt', grnId, `Posting ${grnNo}`);
  };

  const handleCreatePurchaseInvoice = async (input: {
    branchId: string;
    supplierId: string;
    invoiceDate: string;
    dueDate: string;
    goodsReceiptId: string | null;
    isPrepaymentException: boolean;
    productId: string;
    unitCode: string;
    quantity: string;
    unitCost: string;
    freightAmount: string;
  }) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const prod = dataset.products.find((p) => p.id === input.productId);
        const conv = prod?.units.find((u) => u.unit_code === input.unitCode)?.conversion_factor ?? '1';
        const { error } = await supabase.rpc('create_purchase_document', {
          p_idempotency_key: `po-c-${uid()}`,
          p_company_id: dataset.companyId,
          p_branch_id: input.branchId,
          p_supplier_id: input.supplierId,
          p_invoice_date: input.invoiceDate,
          p_due_date: input.dueDate,
          p_goods_receipt_id: input.goodsReceiptId,
          p_is_prepayment_exception: input.isPrepaymentException,
          p_freight_amount: Number(input.freightAmount || '0'),
          p_lines: input.goodsReceiptId
            ? []
            : [
                {
                  product_id: input.productId,
                  unit_code: input.unitCode,
                  quantity: Number(input.quantity),
                  conversion_factor: Number(conv),
                  unit_cost: Number(input.unitCost),
                },
              ],
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    assertOpenPeriod(dataset.fiscalPeriods, input.invoiceDate);
    const grn = input.goodsReceiptId ? dataset.goodsReceipts.find((g) => g.id === input.goodsReceiptId) : null;
    const subtotal = grn ? D(grn.total_estimated_cost) : D(roundMoney(D(input.quantity).times(D(input.unitCost)), 0));
    const total = subtotal.plus(D(input.freightAmount || '0'));
    const poId = uid();
    const docNo = `PINV-${input.invoiceDate.slice(0, 7).replace('-', '')}-${String(dataset.purchaseDocuments.length + 1).padStart(4, '0')}`;

    setDataset((prev) => ({
      ...prev,
      purchaseDocuments: [
        {
          id: poId,
          company_id: prev.companyId,
          branch_id: input.branchId,
          doc_number: docNo,
          doc_type: 'purchase_invoice',
          supplier_id: grn ? grn.supplier_id : input.supplierId,
          invoice_date: input.invoiceDate,
          due_date: input.dueDate,
          payment_terms_type: 'credit',
          goods_receipt_id: input.goodsReceiptId,
          is_prepayment_exception: input.isPrepaymentException,
          subtotal_amount: subtotal.toFixed(2),
          discount_amount: '0.00',
          tax_amount: '0.00',
          freight_amount: D(input.freightAmount || '0').toFixed(2),
          total_amount: total.toFixed(2),
          paid_amount: '0.00',
          status: 'draft',
          accounting_status: 'not_ready',
          created_by: currentUserId,
          approved_by: null,
          lines: [],
        },
        ...prev.purchaseDocuments,
      ],
    }));
    appendAudit('purchase.create', 'purchase_document', poId, `Draft invoice pembelian ${docNo}`);
  };

  const handleApprovePurchaseInvoice = async (poId: string) => {
    setBannerError(null);
    const po = dataset.purchaseDocuments.find((p) => p.id === poId);
    if (!po) return;
    if (po.created_by === currentUserId) {
      setBannerError('Maker tidak boleh menyetujui invoice buatannya sendiri.');
      return;
    }

    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('approve_purchase_document', {
          p_idempotency_key: `po-a-${poId}`,
          p_purchase_document_id: poId,
          p_expected_version: 1,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const period = assertOpenPeriod(dataset.fiscalPeriods, po.invoice_date);
    const debitCoa = po.goods_receipt_id ? '2106' : po.is_prepayment_exception ? '1106' : '1105';
    const jeId = uid();
    const jeNo = `JRN-${po.invoice_date.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;

    setDataset((prev) => ({
      ...prev,
      purchaseDocuments: prev.purchaseDocuments.map((p) => (p.id === poId ? { ...p, status: 'approved', approved_by: currentUserId, accounting_status: 'posted' } : p)),
      goodsReceipts: po.goods_receipt_id
        ? prev.goodsReceipts.map((g) => (g.id === po.goods_receipt_id ? { ...g, invoiced_status: 'invoiced' } : g))
        : prev.goodsReceipts,
      journals: [
        {
          id: jeId,
          company_id: prev.companyId,
          branch_id: po.branch_id,
          journal_number: jeNo,
          accounting_date: po.invoice_date,
          effective_date: po.invoice_date,
          description: `Invoice Pembelian ${po.doc_number} (${po.goods_receipt_id ? 'Clearing GRNI' : po.is_prepayment_exception ? 'Prepayment' : 'Stok'})`,
          status: 'posted',
          total_debit: po.total_amount,
          total_credit: po.total_amount,
          source_event_id: null,
          source_type: 'purchase_document',
          source_id: po.id,
          mapping_version: 'v1',
          journal_type: 'auto',
          reversal_of_id: null,
          reversed_by_id: null,
          fiscal_period_id: period.id,
          created_by: po.created_by,
          approved_by: currentUserId,
          posted_at: new Date().toISOString(),
          version: 1,
          created_at: new Date().toISOString(),
          lines: [
            { id: uid(), journal_entry_id: jeId, line_no: 1, coa_code: debitCoa, debit: po.total_amount, credit: '0.00', memo: debitCoa === '2106' ? 'Clearing GRNI' : 'Pembelian / Uang Muka', branch_id: po.branch_id, supplier_id: po.supplier_id, cash_flow_category: 'non_cash' },
            { id: uid(), journal_entry_id: jeId, line_no: 2, coa_code: '2101', debit: '0.00', credit: po.total_amount, memo: `Utang usaha ${po.doc_number}`, branch_id: po.branch_id, supplier_id: po.supplier_id, cash_flow_category: 'non_cash' },
          ],
        },
        ...prev.journals,
      ],
    }));
    appendAudit('purchase.approve', 'purchase_document', poId, `Setujui invoice ${po.doc_number}`);
  };

  const handleCreateSupplierPayment = async (input: {
    branchId: string;
    supplierId: string;
    fundAccountId: string;
    paymentDate: string;
    referenceNo: string;
    allocations: { purchase_document_id: string; allocated_amount: string }[];
  }) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('create_supplier_payment', {
          p_idempotency_key: `sp-c-${uid()}`,
          p_company_id: dataset.companyId,
          p_branch_id: input.branchId,
          p_supplier_id: input.supplierId,
          p_fund_account_id: input.fundAccountId,
          p_payment_date: input.paymentDate,
          p_reference_no: input.referenceNo,
          p_allocations: input.allocations.map((a) => ({
            purchase_document_id: a.purchase_document_id,
            allocated_amount: Number(a.allocated_amount),
          })),
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    assertOpenPeriod(dataset.fiscalPeriods, input.paymentDate);
    const total = sumMoney(input.allocations.map((a) => a.allocated_amount));
    const payId = uid();
    const payNo = `PAY-SUP-${input.paymentDate.slice(0, 7).replace('-', '')}-${String(dataset.supplierPayments.length + 1).padStart(4, '0')}`;
    setDataset((prev) => ({
      ...prev,
      supplierPayments: [
        {
          id: payId,
          company_id: prev.companyId,
          branch_id: input.branchId,
          payment_number: payNo,
          supplier_id: input.supplierId,
          fund_account_id: input.fundAccountId,
          payment_date: input.paymentDate,
          amount: total,
          reference_no: input.referenceNo,
          status: 'draft',
          created_by: currentUserId,
          approved_by: null,
          allocations: input.allocations,
        },
        ...prev.supplierPayments,
      ],
    }));
    appendAudit('supplier_payment.create', 'supplier_payment', payId, `Draft pembayaran pemasok ${payNo}`);
  };

  const handleApproveSupplierPayment = async (paymentId: string) => {
    setBannerError(null);
    const sp = dataset.supplierPayments.find((x) => x.id === paymentId);
    if (!sp) return;
    if (sp.created_by === currentUserId) {
      setBannerError('Pembuat pembayaran tidak boleh menyetujui pembayarannya sendiri.');
      return;
    }

    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('approve_supplier_payment', {
          p_idempotency_key: `sp-a-${paymentId}`,
          p_supplier_payment_id: paymentId,
          p_expected_version: 1,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const period = assertOpenPeriod(dataset.fiscalPeriods, sp.payment_date);
    const fund = dataset.fundAccounts.find((f) => f.id === sp.fund_account_id);
    const cashCoa = fund?.coa_account_code ?? '1103';
    const jeId = uid();
    const jeNo = `JRN-${sp.payment_date.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;

    setDataset((prev) => ({
      ...prev,
      supplierPayments: prev.supplierPayments.map((x) => (x.id === paymentId ? { ...x, status: 'approved', approved_by: currentUserId } : x)),
      purchaseDocuments: prev.purchaseDocuments.map((po) => {
        const alloc = sp.allocations.find((a) => a.purchase_document_id === po.id);
        if (!alloc) return po;
        return { ...po, paid_amount: D(po.paid_amount).plus(D(alloc.allocated_amount)).toFixed(2) };
      }),
      journals: [
        {
          id: jeId,
          company_id: prev.companyId,
          branch_id: sp.branch_id,
          journal_number: jeNo,
          accounting_date: sp.payment_date,
          effective_date: sp.payment_date,
          description: `Pembayaran Utang Pemasok ${sp.payment_number}`,
          status: 'posted',
          total_debit: sp.amount,
          total_credit: sp.amount,
          source_event_id: null,
          source_type: 'supplier_payment',
          source_id: sp.id,
          mapping_version: 'v1',
          journal_type: 'auto',
          reversal_of_id: null,
          reversed_by_id: null,
          fiscal_period_id: period.id,
          created_by: sp.created_by,
          approved_by: currentUserId,
          posted_at: new Date().toISOString(),
          version: 1,
          created_at: new Date().toISOString(),
          lines: [
            { id: uid(), journal_entry_id: jeId, line_no: 1, coa_code: '2101', debit: sp.amount, credit: '0.00', memo: `Pelunasan utang ${sp.payment_number}`, branch_id: sp.branch_id, supplier_id: sp.supplier_id, cash_flow_category: 'operating' },
            { id: uid(), journal_entry_id: jeId, line_no: 2, coa_code: cashCoa, debit: '0.00', credit: sp.amount, memo: `Pembayaran via ${fund?.name ?? 'Bank'}`, branch_id: sp.branch_id, fund_account_id: sp.fund_account_id, cash_flow_category: 'operating' },
          ],
        },
        ...prev.journals,
      ],
    }));
    appendAudit('supplier_payment.approve', 'supplier_payment', paymentId, `Setujui pembayaran ${sp.payment_number}`);
  };

  const handleRecalculateValuation = async (productId: string, newUnitCost: string, reason: string) => {
    setBannerError(null);
    const val = dataset.inventoryValuations.find((v) => v.product_id === productId);
    if (!val || D(val.qty_on_hand).lte(0)) {
      setBannerError('Tidak ada stok tersisa untuk direvaluasi.');
      return;
    }

    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('recalculate_inventory_valuation', {
          p_idempotency_key: `reval-${uid()}`,
          p_company_id: dataset.companyId,
          p_branch_id: val.branch_id,
          p_product_id: productId,
          p_new_unit_cost: Number(newUnitCost),
          p_effective_date: endDate,
          p_reason: reason,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const oldAvg = D(val.avg_unit_cost);
    const newAvg = D(newUnitCost);
    const diffTotal = D(roundMoney(newAvg.minus(oldAvg).times(D(val.qty_on_hand)), 0));
    const revalId = uid();

    setDataset((prev) => ({
      ...prev,
      inventoryValuations: prev.inventoryValuations.map((v) =>
        v.id === val.id
          ? { ...v, avg_unit_cost: roundQty(newAvg), total_value: D(v.total_value).plus(diffTotal).toFixed(2) }
          : v
      ),
      inventoryRevaluations: [
        {
          id: revalId,
          company_id: prev.companyId,
          branch_id: val.branch_id,
          product_id: productId,
          effective_from_date: endDate,
          reason,
          old_avg_cost: oldAvg.toFixed(6),
          new_avg_cost: newAvg.toFixed(6),
          remaining_stock_impact: diffTotal.toFixed(2),
          cogs_impact: '0.00',
          status: 'approved',
          created_by: currentUserId,
          approved_by: currentUserId,
          created_at: new Date().toISOString(),
        },
        ...prev.inventoryRevaluations,
      ],
    }));
    appendAudit('inventory.recalculate', 'inventory_valuation', val.id, reason);
  };

  const handleCreateExpense = async (input: {
    branchId: string;
    expenseMode: 'direct_paid' | 'accrued' | 'prepaid' | 'accrual_settlement';
    expenseDate: string;
    categoryCoa: string;
    vendorName: string;
    fundAccountId: string | null;
    amount: string;
    description: string;
    evidenceRef: string;
  }) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('create_expense_document', {
          p_idempotency_key: `exp-c-${uid()}`,
          p_company_id: dataset.companyId,
          p_branch_id: input.branchId,
          p_expense_mode: input.expenseMode,
          p_expense_date: input.expenseDate,
          p_category_coa: input.categoryCoa,
          p_vendor_name: input.vendorName,
          p_fund_account_id: input.fundAccountId,
          p_amount: Number(input.amount),
          p_description: input.description,
          p_evidence_path: input.evidenceRef || null,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    assertOpenPeriod(dataset.fiscalPeriods, input.expenseDate);
    const expId = uid();
    const docNo = `EXP-${input.expenseDate.slice(0, 7).replace('-', '')}-${String(dataset.expenses.length + 1).padStart(4, '0')}`;
    setDataset((prev) => ({
      ...prev,
      expenses: [
        {
          id: expId,
          company_id: prev.companyId,
          branch_id: input.branchId,
          doc_number: docNo,
          expense_mode: input.expenseMode,
          expense_date: input.expenseDate,
          paid_date: input.expenseMode === 'accrued' ? null : input.expenseDate,
          category_coa: input.categoryCoa,
          vendor_name: input.vendorName,
          fund_account_id: input.fundAccountId,
          accrued_expense_id: null,
          tax_code_id: null,
          tax_amount: '0.00',
          net_amount: D(input.amount).toFixed(2),
          amount: D(input.amount).toFixed(2),
          description: input.description,
          evidence_ref: input.evidenceRef,
          status: 'draft',
          created_by: currentUserId,
          approved_by: null,
        },
        ...prev.expenses,
      ],
    }));
    appendAudit('expense.create', 'expense_document', expId, `Draft biaya ${docNo}`);
  };

  const handleApproveExpense = async (expenseId: string) => {
    setBannerError(null);
    const ex = dataset.expenses.find((e) => e.id === expenseId);
    if (!ex) return;
    if (ex.created_by === currentUserId) {
      setBannerError('Pembuat biaya tidak boleh menyetujui dokumennya sendiri.');
      return;
    }

    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('approve_expense_document', {
          p_idempotency_key: `exp-a-${expenseId}`,
          p_expense_document_id: expenseId,
          p_expected_version: 1,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const period = assertOpenPeriod(dataset.fiscalPeriods, ex.expense_date);
    const fund = dataset.fundAccounts.find((f) => f.id === ex.fund_account_id);
    const cashCoa = fund?.coa_account_code ?? '1103';
    const jeId = uid();
    const jeNo = `JRN-${ex.expense_date.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;

    const debitCoa = ex.expense_mode === 'accrual_settlement' ? '2107' : ex.expense_mode === 'prepaid' ? '1106' : ex.category_coa;
    const creditCoa = ex.expense_mode === 'accrued' ? '2107' : cashCoa;
    const cfCat: CashFlowCategory = ex.expense_mode === 'accrued' ? 'non_cash' : 'operating';

    setDataset((prev) => ({
      ...prev,
      expenses: prev.expenses.map((e) => (e.id === expenseId ? { ...e, status: 'approved', approved_by: currentUserId } : e)),
      journals: [
        {
          id: jeId,
          company_id: prev.companyId,
          branch_id: ex.branch_id,
          journal_number: jeNo,
          accounting_date: ex.expense_date,
          effective_date: ex.expense_date,
          description: `Biaya ${ex.doc_number} — ${ex.vendor_name}`,
          status: 'posted',
          total_debit: ex.amount,
          total_credit: ex.amount,
          source_event_id: null,
          source_type: 'expense_document',
          source_id: ex.id,
          mapping_version: 'v1',
          journal_type: 'auto',
          reversal_of_id: null,
          reversed_by_id: null,
          fiscal_period_id: period.id,
          created_by: ex.created_by,
          approved_by: currentUserId,
          posted_at: new Date().toISOString(),
          version: 1,
          created_at: new Date().toISOString(),
          lines: [
            { id: uid(), journal_entry_id: jeId, line_no: 1, coa_code: debitCoa, debit: ex.amount, credit: '0.00', memo: ex.description, branch_id: ex.branch_id, cash_flow_category: cfCat },
            { id: uid(), journal_entry_id: jeId, line_no: 2, coa_code: creditCoa, debit: '0.00', credit: ex.amount, memo: ex.expense_mode === 'accrued' ? 'Akrual utang biaya' : `Dibayar via ${fund?.name ?? 'Kas/Bank'}`, branch_id: ex.branch_id, fund_account_id: ex.fund_account_id, cash_flow_category: cfCat },
          ],
        },
        ...prev.journals,
      ],
    }));
    appendAudit('expense.approve', 'expense_document', expenseId, `Setujui biaya ${ex.doc_number}`);
  };

  const handleRegisterAsset = async (input: {
    branchId: string;
    name: string;
    acquisitionDate: string;
    readyToUseDate: string;
    cost: string;
    residualValue: string;
    usefulLifeMonths: number;
    location: string;
    fundAccountId: string | null;
  }) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('register_fixed_asset', {
          p_idempotency_key: `ast-${uid()}`,
          p_company_id: dataset.companyId,
          p_branch_id: input.branchId,
          p_name: input.name,
          p_acquisition_date: input.acquisitionDate,
          p_ready_to_use_date: input.readyToUseDate,
          p_cost: Number(input.cost),
          p_residual_value: Number(input.residualValue || '0'),
          p_useful_life_months: input.usefulLifeMonths,
          p_location: input.location,
          p_fund_account_id: input.fundAccountId,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const period = assertOpenPeriod(dataset.fiscalPeriods, input.acquisitionDate);
    const assetId = uid();
    const code = `AST-${String(dataset.fixedAssets.length + 1).padStart(3, '0')}`;
    const costFixed = D(input.cost).toFixed(2);
    const fund = dataset.fundAccounts.find((f) => f.id === input.fundAccountId);
    const jeId = uid();
    const jeNo = `JRN-${input.acquisitionDate.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;

    setDataset((prev) => ({
      ...prev,
      fixedAssets: [
        {
          id: assetId,
          company_id: prev.companyId,
          branch_id: input.branchId,
          asset_code: code,
          name: input.name,
          acquisition_date: input.acquisitionDate,
          ready_to_use_date: input.readyToUseDate,
          cost: costFixed,
          residual_value: D(input.residualValue || '0').toFixed(2),
          useful_life_months: input.usefulLifeMonths,
          depreciation_method: 'straight_line',
          location: input.location,
          accumulated_depreciation: '0.00',
          status: 'active',
          disposal_date: null,
          disposal_proceeds: null,
        },
        ...prev.fixedAssets,
      ],
      journals: [
        {
          id: jeId,
          company_id: prev.companyId,
          branch_id: input.branchId,
          journal_number: jeNo,
          accounting_date: input.acquisitionDate,
          effective_date: input.acquisitionDate,
          description: `Perolehan Aset Tetap ${code} (${input.name})`,
          status: 'posted',
          total_debit: costFixed,
          total_credit: costFixed,
          source_event_id: null,
          source_type: 'fixed_asset',
          source_id: assetId,
          mapping_version: 'v1',
          journal_type: 'auto',
          reversal_of_id: null,
          reversed_by_id: null,
          fiscal_period_id: period.id,
          created_by: currentUserId,
          approved_by: currentUserId,
          posted_at: new Date().toISOString(),
          version: 1,
          created_at: new Date().toISOString(),
          lines: [
            { id: uid(), journal_entry_id: jeId, line_no: 1, coa_code: '1201', debit: costFixed, credit: '0.00', memo: input.name, branch_id: input.branchId, cash_flow_category: 'investing' },
            { id: uid(), journal_entry_id: jeId, line_no: 2, coa_code: fund?.coa_account_code ?? '1103', debit: '0.00', credit: costFixed, memo: `Pembelian aset via ${fund?.name ?? 'Bank'}`, branch_id: input.branchId, fund_account_id: input.fundAccountId, cash_flow_category: 'investing' },
          ],
        },
        ...prev.journals,
      ],
    }));
    appendAudit('asset.register', 'fixed_asset', assetId, `Daftarkan aset ${code}`);
  };

  const handleRunDepreciation = async (periodCode: string) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('run_depreciation', {
          p_idempotency_key: `dep-${dataset.companyId}-${periodCode}`,
          p_company_id: dataset.companyId,
          p_period_code: periodCode,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const fp = dataset.fiscalPeriods.find((p) => p.period_code === periodCode);
    if (!fp || fp.status !== 'open') throw new Error(`Periode ${periodCode} terkunci atau tidak ditemukan.`);

    let totalDep = D(0);
    const newRuns = [...dataset.depreciationRuns];
    const updatedAssets = dataset.fixedAssets.map((fa) => {
      if (fa.status !== 'active' || fa.ready_to_use_date > fp.end_date) return fa;
      const already = newRuns.some((r) => r.fixed_asset_id === fa.id && r.period_code === periodCode);
      if (already) return fa;
      const rem = D(fa.cost).minus(D(fa.residual_value)).minus(D(fa.accumulated_depreciation));
      const monthly = D(roundMoney(D(fa.cost).minus(D(fa.residual_value)).div(fa.useful_life_months), 0));
      const charge = D(Math.min(monthly.toNumber(), Math.max(0, rem.toNumber())));
      if (charge.lte(0)) return fa;
      totalDep = totalDep.plus(charge);
      newRuns.push({
        id: uid(),
        company_id: dataset.companyId,
        fixed_asset_id: fa.id,
        period_code: periodCode,
        run_date: fp.end_date,
        total_depreciation: charge.toFixed(2),
        status: 'posted',
        journal_entry_id: null,
      });
      return { ...fa, accumulated_depreciation: D(fa.accumulated_depreciation).plus(charge).toFixed(2) };
    });

    if (totalDep.lte(0)) throw new Error(`Tidak ada penyusutan baru untuk periode ${periodCode} (sudah dijalankan / idempoten).`);

    const jeId = uid();
    const jeNo = `DEP-${periodCode.replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;
    const amt = totalDep.toFixed(2);
    const branchId = dataset.branches[0]?.id ?? '';

    setDataset((prev) => ({
      ...prev,
      fixedAssets: updatedAssets,
      depreciationRuns: newRuns,
      journals: [
        {
          id: jeId,
          company_id: prev.companyId,
          branch_id: branchId,
          journal_number: jeNo,
          accounting_date: fp.end_date,
          effective_date: fp.end_date,
          description: `Penyusutan Aset Tetap Periode ${periodCode}`,
          status: 'posted',
          total_debit: amt,
          total_credit: amt,
          source_event_id: null,
          source_type: 'depreciation_run',
          source_id: jeId,
          mapping_version: 'v1',
          journal_type: 'depreciation',
          reversal_of_id: null,
          reversed_by_id: null,
          fiscal_period_id: fp.id,
          created_by: currentUserId,
          approved_by: currentUserId,
          posted_at: new Date().toISOString(),
          version: 1,
          created_at: new Date().toISOString(),
          lines: [
            { id: uid(), journal_entry_id: jeId, line_no: 1, coa_code: '6201', debit: amt, credit: '0.00', memo: `Beban penyusutan ${periodCode}`, branch_id: branchId, cash_flow_category: 'non_cash' },
            { id: uid(), journal_entry_id: jeId, line_no: 2, coa_code: '1202', debit: '0.00', credit: amt, memo: `Akumulasi penyusutan ${periodCode}`, branch_id: branchId, cash_flow_category: 'non_cash' },
          ],
        },
        ...prev.journals,
      ],
    }));
    appendAudit('depreciation.run', 'depreciation_run', jeId, `Penyusutan ${periodCode}`);
  };

  const handleRecordLoanRepayment = async (input: {
    loanId: string;
    paymentDate: string;
    principalPaid: string;
    interestPaid: string;
    fundAccountId: string;
    evidenceRef: string;
  }) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('create_loan_repayment', {
          p_idempotency_key: `ln-${uid()}`,
          p_loan_id: input.loanId,
          p_payment_date: input.paymentDate,
          p_principal_paid: Number(input.principalPaid),
          p_interest_paid: Number(input.interestPaid),
          p_fund_account_id: input.fundAccountId,
          p_evidence_ref: input.evidenceRef || null,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const period = assertOpenPeriod(dataset.fiscalPeriods, input.paymentDate);
    const loan = dataset.loans.find((l) => l.id === input.loanId);
    if (!loan) return;
    const total = D(input.principalPaid).plus(D(input.interestPaid)).toFixed(2);
    const fund = dataset.fundAccounts.find((f) => f.id === input.fundAccountId);
    const jeId = uid();
    const jeNo = `JRN-${input.paymentDate.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;

    setDataset((prev) => ({
      ...prev,
      loans: prev.loans.map((l) =>
        l.id === loan.id
          ? { ...l, outstanding_principal: D(l.outstanding_principal).minus(D(input.principalPaid)).toFixed(2) }
          : l
      ),
      journals: [
        {
          id: jeId,
          company_id: prev.companyId,
          branch_id: loan.branch_id,
          journal_number: jeNo,
          accounting_date: input.paymentDate,
          effective_date: input.paymentDate,
          description: `Angsuran Pinjaman ${loan.loan_number}`,
          status: 'posted',
          total_debit: total,
          total_credit: total,
          source_event_id: null,
          source_type: 'loan',
          source_id: loan.id,
          mapping_version: 'v1',
          journal_type: 'auto',
          reversal_of_id: null,
          reversed_by_id: null,
          fiscal_period_id: period.id,
          created_by: currentUserId,
          approved_by: currentUserId,
          posted_at: new Date().toISOString(),
          version: 1,
          created_at: new Date().toISOString(),
          lines: [
            { id: uid(), journal_entry_id: jeId, line_no: 1, coa_code: '2201', debit: D(input.principalPaid).toFixed(2), credit: '0.00', memo: 'Pembayaran pokok pinjaman', branch_id: loan.branch_id, cash_flow_category: 'financing' },
            { id: uid(), journal_entry_id: jeId, line_no: 2, coa_code: '6401', debit: D(input.interestPaid).toFixed(2), credit: '0.00', memo: 'Beban bunga pinjaman', branch_id: loan.branch_id, cash_flow_category: 'operating' },
            { id: uid(), journal_entry_id: jeId, line_no: 3, coa_code: fund?.coa_account_code ?? '1103', debit: '0.00', credit: total, memo: `Pembayaran via ${fund?.name ?? 'Bank'}`, branch_id: loan.branch_id, fund_account_id: input.fundAccountId, cash_flow_category: 'financing' },
          ],
        },
        ...prev.journals,
      ],
    }));
    appendAudit('loan.repay', 'loan', loan.id, `Angsuran pokok ${input.principalPaid} + bunga ${input.interestPaid}`);
  };

  const handleCreateEquityTxn = async (input: {
    branchId: string;
    txnType: 'capital_injection' | 'owner_draw';
    txnDate: string;
    partyName: string;
    fundAccountId: string;
    amount: string;
    notes: string;
  }) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('create_equity_transaction', {
          p_idempotency_key: `eq-${uid()}`,
          p_company_id: dataset.companyId,
          p_branch_id: input.branchId,
          p_txn_type: input.txnType,
          p_txn_date: input.txnDate,
          p_party_name: input.partyName,
          p_fund_account_id: input.fundAccountId,
          p_amount: Number(input.amount),
          p_notes: input.notes,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const period = assertOpenPeriod(dataset.fiscalPeriods, input.txnDate);
    const amt = D(input.amount).toFixed(2);
    const fund = dataset.fundAccounts.find((f) => f.id === input.fundAccountId);
    const cashCoa = fund?.coa_account_code ?? '1103';
    const eqId = uid();
    const docNo = `EQ-${input.txnDate.slice(0, 7).replace('-', '')}-${String(dataset.equityTransactions.length + 1).padStart(4, '0')}`;
    const jeId = uid();
    const jeNo = `JRN-${input.txnDate.slice(0, 7).replace('-', '')}-${String(dataset.journals.length + 1).padStart(4, '0')}`;

    setDataset((prev) => ({
      ...prev,
      equityTransactions: [
        {
          id: eqId,
          company_id: prev.companyId,
          branch_id: input.branchId,
          doc_number: docNo,
          txn_type: input.txnType,
          txn_date: input.txnDate,
          party_name: input.partyName,
          fund_account_id: input.fundAccountId,
          amount: amt,
          notes: input.notes,
          status: 'approved',
          created_by: currentUserId,
          approved_by: currentUserId,
        },
        ...prev.equityTransactions,
      ],
      journals: [
        {
          id: jeId,
          company_id: prev.companyId,
          branch_id: input.branchId,
          journal_number: jeNo,
          accounting_date: input.txnDate,
          effective_date: input.txnDate,
          description: `${input.txnType === 'capital_injection' ? 'Setoran Modal' : 'Prive Pemilik'} ${docNo} (${input.partyName})`,
          status: 'posted',
          total_debit: amt,
          total_credit: amt,
          source_event_id: null,
          source_type: 'equity_transaction',
          source_id: eqId,
          mapping_version: 'v1',
          journal_type: 'auto',
          reversal_of_id: null,
          reversed_by_id: null,
          fiscal_period_id: period.id,
          created_by: currentUserId,
          approved_by: currentUserId,
          posted_at: new Date().toISOString(),
          version: 1,
          created_at: new Date().toISOString(),
          lines:
            input.txnType === 'capital_injection'
              ? [
                  { id: uid(), journal_entry_id: jeId, line_no: 1, coa_code: cashCoa, debit: amt, credit: '0.00', memo: 'Modal disetor masuk rekening', branch_id: input.branchId, fund_account_id: input.fundAccountId, cash_flow_category: 'financing' },
                  { id: uid(), journal_entry_id: jeId, line_no: 2, coa_code: '3101', debit: '0.00', credit: amt, memo: `Setoran modal ${input.partyName}`, branch_id: input.branchId, cash_flow_category: 'financing' },
                ]
              : [
                  { id: uid(), journal_entry_id: jeId, line_no: 1, coa_code: '3103', debit: amt, credit: '0.00', memo: `Prive / distribusi ${input.partyName}`, branch_id: input.branchId, cash_flow_category: 'financing' },
                  { id: uid(), journal_entry_id: jeId, line_no: 2, coa_code: cashCoa, debit: '0.00', credit: amt, memo: 'Pembayaran prive dari kas/bank', branch_id: input.branchId, fund_account_id: input.fundAccountId, cash_flow_category: 'financing' },
                ],
        },
        ...prev.journals,
      ],
    }));
    appendAudit('equity.record', 'equity_transaction', eqId, input.notes);
  };

  const handleClosePeriod = async (periodId: string) => {
    setBannerError(null);
    const fp = dataset.fiscalPeriods.find((p) => p.id === periodId);
    if (!fp) return;
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('close_fiscal_period', {
          p_idempotency_key: `cls-${periodId}-${fp.version}`,
          p_fiscal_period_id: periodId,
          p_expected_version: fp.version,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (statements.unpostedEventsCount > 0 || !statements.balanceSheet.isBalanced) {
      throw new Error('Tutup buku ditolak: masih terdapat event tertahan/gagal atau neraca belum seimbang.');
    }

    setDataset((prev) => ({
      ...prev,
      fiscalPeriods: prev.fiscalPeriods.map((p) =>
        p.id === periodId ? { ...p, status: 'closed', closed_by: currentUserId, closed_at: new Date().toISOString(), version: p.version + 1 } : p
      ),
    }));
    appendAudit('period.close', 'fiscal_period', periodId, `Penutupan periode ${fp.period_code}`);
  };

  const handleReopenPeriod = async (periodId: string, reason: string) => {
    setBannerError(null);
    const fp = dataset.fiscalPeriods.find((p) => p.id === periodId);
    if (!fp) return;
    if (reason.trim().length < 10) throw new Error('Alasan pembukaan ulang wajib minimal 10 karakter.');
    if (fp.closed_by === currentUserId) throw new Error('Pelanggaran maker-checker: penutup periode tidak boleh membuka ulang periode yang ditutupnya sendiri.');

    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('reopen_fiscal_period', {
          p_idempotency_key: `rop-${periodId}-${fp.version}`,
          p_fiscal_period_id: periodId,
          p_expected_version: fp.version,
          p_reason: reason,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    setDataset((prev) => ({
      ...prev,
      reportSnapshots: prev.reportSnapshots.map((s) =>
        s.period_code === fp.period_code ? { ...s, snapshot_status: 'superseded' } : s
      ),
      fiscalPeriods: prev.fiscalPeriods.map((p) =>
        p.id === periodId ? { ...p, status: 'open', reopened_by: currentUserId, reopened_at: new Date().toISOString(), reopen_reason: reason, version: p.version + 1 } : p
      ),
    }));
    appendAudit('period.reopen', 'fiscal_period', periodId, reason);
  };

  const handleCreateSnapshot = async (periodCode: string) => {
    setBannerError(null);
    const summaryPayload = {
      totalAssets: statements.balanceSheet.totalAssets,
      netProfit: statements.incomeStatement.netProfit,
      closingCash: statements.cashFlowDirect.closingCashComputed,
    };
    const snapStatus = statements.reportStatus === 'Final Internal' ? 'final_internal' : 'draft';
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('create_report_snapshot', {
          p_idempotency_key: `snap-${uid()}`,
          p_company_id: dataset.companyId,
          p_report_code: 'full_financial_package',
          p_period_code: periodCode,
          p_as_of_date: endDate,
          p_snapshot_status: snapStatus,
          p_payload: summaryPayload,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const existingCount = dataset.reportSnapshots.filter((s) => s.period_code === periodCode).length;
    setDataset((prev) => ({
      ...prev,
      reportSnapshots: [
        {
          id: uid(),
          company_id: prev.companyId,
          report_code: 'full_financial_package',
          period_code: periodCode,
          as_of_date: endDate,
          snapshot_version: existingCount + 1,
          snapshot_status: snapStatus,
          summary_totals: summaryPayload,
          generated_by: currentUserId,
          created_at: new Date().toISOString(),
        },
        ...prev.reportSnapshots,
      ],
    }));
    appendAudit('report.snapshot', 'report_snapshot', periodCode, `Snapshot v${existingCount + 1}`);
  };

  const handleApproveBankReconciliation = async (recId: string) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('approve_bank_reconciliation', {
          p_idempotency_key: `brec-${recId}`,
          p_reconciliation_id: recId,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setDataset((prev) => ({
      ...prev,
      bankReconciliations: prev.bankReconciliations.map((b) =>
        b.id === recId ? { ...b, status: 'approved', approved_by: currentUserId } : b
      ),
    }));
    appendAudit('bank_reconciliation.approve', 'bank_reconciliation', recId, 'Rekonsiliasi bank disahkan');
  };

  const handleToggleTaxCode = async (taxId: string) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('toggle_tax_code', {
          p_idempotency_key: `tax-${taxId}-${Date.now()}`,
          p_tax_code_id: taxId,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setDataset((prev) => ({
      ...prev,
      taxCodes: prev.taxCodes.map((tc) => (tc.id === taxId ? { ...tc, is_active: !tc.is_active } : tc)),
    }));
  };

  const handleUpdatePolicy = async (patch: Partial<AccountingPolicy>) => {
    setBannerError(null);
    if (mode === 'live' && supabase) {
      try {
        const { error } = await supabase.rpc('update_accounting_policy', {
          p_idempotency_key: `pol-${uid()}`,
          p_company_id: dataset.companyId,
          p_patch: patch,
        });
        if (error) throw new Error(error.message);
        await loadLive();
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setDataset((prev) => ({ ...prev, policy: { ...prev.policy, ...patch } }));
    appendAudit('policy.update', 'accounting_policies', dataset.companyId, 'Pembaruan kebijakan akuntansi');
  };

  if (mode === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Memuat konfigurasi sesi & ledger FINOPS_SHARED_V1...
      </div>
    );
  }

  if (mode === 'auth_setup') {
    return (
      <SetupAndAuthView
        authError={authError}
        onEnterDemoMode={() => {
          setDataset(createSyntheticDemoDataset());
          setMode('demo');
        }}
        onAuthSuccess={() => void loadLive()}
      />
    );
  }

  const visibleMenuGroups = MENU_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => checkMenuAccess(currentRoles, it.key)),
  })).filter((g) => g.items.length > 0);

  const activeTitle = MENU_GROUPS.flatMap((g) => g.items).find((i) => i.key === activeMenu)?.label ?? 'Ringkasan Keuangan';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {mode === 'demo' && (
        <div className="no-print bg-amber-900 text-amber-50 px-6 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium">
            DEMO — DATA SINTETIS TERPISAH (PT Distribusi Nusantara). Tidak terhubung ke database produksi Supabase.
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <span className="text-amber-200">Simulasi Peran Uji:</span>
              <select
                value={demoRole}
                onChange={(e) => {
                  const r = e.target.value as RoleCode;
                  setDemoRole(r);
                  setDemoUserId(r === 'accounting_approver' ? 'user-app-1' : r === 'accountant' ? 'user-acc-1' : 'user-viewer-1');
                  if (!checkMenuAccess([r], activeMenu)) setActiveMenu('ringkasan');
                }}
                className="rounded bg-amber-950 border border-amber-700 px-2 py-0.5 text-xs text-white"
              >
                <option value="accounting_approver">accounting_approver (Sari)</option>
                <option value="accountant">accountant (Budi)</option>
                <option value="finance_checker">finance_checker (Rina)</option>
                <option value="owner_viewer">owner_viewer (Hendra)</option>
                <option value="system_admin">system_admin (Admin)</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setMode('auth_setup')}
              className="rounded border border-amber-500 px-2.5 py-0.5 text-xs hover:bg-amber-800"
            >
              Keluar Demo
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Sidebar Navigation */}
        <aside className="no-print w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="text-base font-bold tracking-tight text-slate-900">Akuntansi & Laporan</div>
            <div className="mt-0.5 text-[11px] text-slate-500 truncate">{dataset.companyName}</div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
            {visibleMenuGroups.map((grp) => (
              <div key={grp.group}>
                <div className="px-3 mb-1.5 text-[11px] font-semibold text-slate-400">{grp.group}</div>
                <div className="space-y-0.5">
                  {grp.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeMenu === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setActiveMenu(item.key)}
                        className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-slate-200 p-4 space-y-2 text-[11px] text-slate-500">
            <div className="font-medium text-slate-800 truncate">{currentActorName}</div>
            <div>Peran: <span className="font-mono">{currentRoles.join(', ')}</span></div>
            <div className="flex flex-col gap-1 pt-1">
              {dataset.policy.app1_url && (
                <a href={dataset.policy.app1_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-700 hover:underline">
                  <ExternalLink className="h-3 w-3" /> App 1: Penerimaan & Setoran
                </a>
              )}
              {dataset.policy.app2_url && (
                <a href={dataset.policy.app2_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-700 hover:underline">
                  <ExternalLink className="h-3 w-3" /> App 2: Penjualan & Rekonsiliasi
                </a>
              )}
            </div>
            {mode === 'live' && supabase && (
              <button
                type="button"
                onClick={async () => {
                  await supabase?.auth.signOut();
                  setMode('auth_setup');
                }}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <LogOut className="h-3.5 w-3.5" /> Keluar
              </button>
            )}
          </div>
        </aside>

        {/* Main Workspace */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="no-print border-b border-slate-200 bg-white px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold text-slate-900 whitespace-nowrap">{activeTitle}</h1>
              <span className="text-slate-300">|</span>
              <span className="text-xs text-slate-500">
                Pembaruan: {formatDateTimeJKT(lastUpdated)} ·{' '}
                {mode === 'live' ? (realtimeConnected ? 'Realtime Aktif' : 'Sinkronisasi Periodik') : 'Sandbox Lokal'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="ALL">Semua Cabang</option>
                {dataset.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono"
              />
              <span className="text-slate-400">s.d.</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono"
              />
              {mode === 'live' && (
                <button
                  type="button"
                  onClick={() => void loadLive()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Muat Ulang
                </button>
              )}
            </div>
          </header>

          <main className="flex-1 p-6 overflow-y-auto max-w-[1400px] w-full">
            {bannerError && (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 flex items-center justify-between">
                <span>{bannerError}</span>
                <button type="button" onClick={() => setBannerError(null)} className="font-medium underline">Tutup</button>
              </div>
            )}

            {activeMenu === 'ringkasan' && (
              <RingkasanKeuanganView
                dataset={dataset}
                statements={statements}
                roles={currentRoles}
                onNavigate={(m) => setActiveMenu(m)}
                onSelectJournal={(j) => setSelectedJournal(j)}
              />
            )}

            {activeMenu === 'antrian' && (
              <AntrianPembukuanView
                dataset={dataset}
                roles={currentRoles}
                onProcessEvent={(id, m) => void handleProcessEvent(id, m)}
                onProcessAllQueue={() => void handleProcessAllQueue()}
                onSelectJournal={(j) => setSelectedJournal(j)}
              />
            )}

            {activeMenu === 'jurnal' && (
              <JurnalUmumView
                dataset={dataset}
                roles={currentRoles}
                selectedBranch={selectedBranch}
                onSelectJournal={(j) => setSelectedJournal(j)}
                onCreateManualJournal={(inp) => void handleCreateManualJournal(inp)}
              />
            )}

            {activeMenu === 'buku_besar' && (
              <BukuBesarView
                dataset={dataset}
                startDate={startDate}
                endDate={endDate}
                selectedBranch={selectedBranch}
                initialCoaCode={ledgerCoaJump}
                onSelectJournalById={(id) => {
                  const found = dataset.journals.find((j) => j.id === id);
                  if (found) setSelectedJournal(found);
                }}
              />
            )}

            {activeMenu === 'neraca_saldo' && (
              <NeracaSaldoView
                statements={statements}
                onDrillToLedger={(code) => {
                  setLedgerCoaJump(code);
                  setActiveMenu('buku_besar');
                }}
              />
            )}

            {activeMenu === 'piutang_titipan' && (
              <PiutangTitipanView dataset={dataset} statements={statements} />
            )}

            {activeMenu === 'utang_pemasok' && (
              <UtangPemasokView
                dataset={dataset}
                statements={statements}
                roles={currentRoles}
                currentUserId={currentUserId}
                onCreateSupplierPayment={(inp) => void handleCreateSupplierPayment(inp)}
                onApproveSupplierPayment={(id) => void handleApproveSupplierPayment(id)}
              />
            )}

            {activeMenu === 'pembelian_penerimaan' && (
              <PembelianPenerimaanView
                dataset={dataset}
                roles={currentRoles}
                currentUserId={currentUserId}
                onCreateGoodsReceipt={(inp) => void handleCreateGoodsReceipt(inp)}
                onCreatePurchaseInvoice={(inp) => void handleCreatePurchaseInvoice(inp)}
                onApprovePurchaseInvoice={(id) => void handleApprovePurchaseInvoice(id)}
              />
            )}

            {activeMenu === 'persediaan_hpp' && (
              <PersediaanHppView
                dataset={dataset}
                roles={currentRoles}
                onRecalculateValuation={(p, c, r) => void handleRecalculateValuation(p, c, r)}
              />
            )}

            {activeMenu === 'biaya' && (
              <BiayaView
                dataset={dataset}
                roles={currentRoles}
                currentUserId={currentUserId}
                onCreateExpense={(inp) => void handleCreateExpense(inp)}
                onApproveExpense={(id) => void handleApproveExpense(id)}
              />
            )}

            {activeMenu === 'kas_bank' && (
              <KasBankRekonsiliasiView
                dataset={dataset}
                statements={statements}
                roles={currentRoles}
                onApproveBankReconciliation={(recId) => void handleApproveBankReconciliation(recId)}
              />
            )}

            {activeMenu === 'aset_tetap' && (
              <AsetTetapView
                dataset={dataset}
                roles={currentRoles}
                onRegisterAsset={(inp) => void handleRegisterAsset(inp)}
                onRunDepreciation={(pc) => void handleRunDepreciation(pc)}
              />
            )}

            {activeMenu === 'pinjaman_modal' && (
              <PinjamanModalView
                dataset={dataset}
                roles={currentRoles}
                onRecordLoanRepayment={(inp) => void handleRecordLoanRepayment(inp)}
                onCreateEquityTxn={(inp) => void handleCreateEquityTxn(inp)}
              />
            )}

            {activeMenu === 'pajak' && (
              <PajakView
                dataset={dataset}
                statements={statements}
                roles={currentRoles}
                onToggleTaxCode={(taxId) => void handleToggleTaxCode(taxId)}
              />
            )}

            {activeMenu === 'laporan' && (
              <LaporanKeuanganView
                dataset={dataset}
                statements={statements}
                onDrillToLedger={(code) => {
                  setLedgerCoaJump(code);
                  setActiveMenu('buku_besar');
                }}
              />
            )}

            {activeMenu === 'tutup_buku' && (
              <TutupBukuView
                dataset={dataset}
                statements={statements}
                roles={currentRoles}
                currentUserId={currentUserId}
                onClosePeriod={(id) => void handleClosePeriod(id)}
                onReopenPeriod={(id, rsn) => void handleReopenPeriod(id, rsn)}
                onCreateSnapshot={(pc) => void handleCreateSnapshot(pc)}
              />
            )}

            {activeMenu === 'audit_pengaturan' && (
              <GovernanceAndSettingsView
                dataset={dataset}
                auditEvents={auditLog}
                roles={currentRoles}
                onUpdatePolicy={(patch: Partial<AccountingPolicy>) => void handleUpdatePolicy(patch)}
              />
            )}
          </main>
        </div>
      </div>

      <SourceDrawer
        journal={selectedJournal}
        dataset={dataset}
        roles={currentRoles}
        currentUserId={currentUserId}
        onClose={() => setSelectedJournal(null)}
        onApproveJournal={(id) => void handleApproveJournal(id)}
        onReverseJournal={(id, dt, rsn) => void handleReverseJournal(id, dt, rsn)}
      />
    </div>
  );
}
