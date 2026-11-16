import React, { useMemo, useState } from 'react';
import { Plus, Search, AlertTriangle } from 'lucide-react';
import { computeGeneralLedger, FinancialStatementsResult, LedgerDataset } from '../lib/accountingEngine';
import { D, formatDateID, formatIDR, sumMoney } from '../lib/decimal';
import { CashFlowCategory, JournalEntry, RoleCode } from '../types/finops';

interface JurnalUmumViewProps {
  dataset: LedgerDataset;
  roles: RoleCode[];
  selectedBranch: string | 'ALL';
  onSelectJournal: (j: JournalEntry) => void;
  onCreateManualJournal: (input: {
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
  }) => void;
}

export const JurnalUmumView: React.FC<JurnalUmumViewProps> = ({
  dataset,
  roles,
  selectedBranch,
  onSelectJournal,
  onCreateManualJournal,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'posted' | 'draft' | 'reversed'>('ALL');
  const [showModal, setShowModal] = useState<'manual' | 'subledger_adjustment' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const defaultBranch = selectedBranch === 'ALL' ? dataset.branches[0]?.id ?? '' : selectedBranch;
  const [branchId, setBranchId] = useState(defaultBranch);
  const [accountingDate, setAccountingDate] = useState('2026-11-16');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<
    { coa_code: string; side: 'debit' | 'credit'; amount: string; memo: string; cash_flow_category: CashFlowCategory; customer_id: string; supplier_id: string; product_id: string }[]
  >([
    { coa_code: '6101', side: 'debit', amount: '', memo: '', cash_flow_category: 'non_cash', customer_id: '', supplier_id: '', product_id: '' },
    { coa_code: '2107', side: 'credit', amount: '', memo: '', cash_flow_category: 'non_cash', customer_id: '', supplier_id: '', product_id: '' },
  ]);

  const canCreate = roles.some((r) => ['accountant', 'accounting_approver'].includes(r));

  const filtered = useMemo(() => {
    return dataset.journals.filter((j) => {
      if (selectedBranch !== 'ALL' && j.branch_id !== selectedBranch) return false;
      if (statusFilter !== 'ALL' && j.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          j.journal_number.toLowerCase().includes(q) ||
          j.description.toLowerCase().includes(q) ||
          j.lines.some((l) => l.coa_code.includes(q))
        );
      }
      return true;
    });
  }, [dataset.journals, selectedBranch, statusFilter, search]);

  const totalDebitInput = sumMoney(lines.filter((l) => l.side === 'debit').map((l) => l.amount || '0'));
  const totalCreditInput = sumMoney(lines.filter((l) => l.side === 'credit').map((l) => l.amount || '0'));

  const handleSaveJournal = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!showModal) return;
    if (lines.length < 2) {
      setFormError('Jurnal minimal memiliki 2 baris.');
      return;
    }
    for (const l of lines) {
      const coa = dataset.coa.find((c) => c.code === l.coa_code);
      if (!coa || !coa.is_active || !coa.is_postable) {
        setFormError(`Akun ${l.coa_code} tidak aktif atau bukan akun postable.`);
        return;
      }
      if (coa.is_control_account && showModal === 'manual') {
        setFormError(`Akun kontrol ${coa.code} (${coa.name}) dilarang dijurnal manual langsung. Gunakan tombol "Jurnal Penyesuaian Subledger".`);
        return;
      }
      if (coa.is_control_account && showModal === 'subledger_adjustment' && !l.customer_id && !l.supplier_id && !l.product_id) {
        setFormError(`Akun kontrol ${coa.code} wajib menyertakan rincian item subledger (pelanggan/pemasok/produk).`);
        return;
      }
      if (D(l.amount || '0').lte(0)) {
        setFormError('Setiap baris harus memiliki nominal positif.');
        return;
      }
    }
    if (D(totalDebitInput).comparedTo(D(totalCreditInput)) !== 0) {
      setFormError(`Total Debit (${formatIDR(totalDebitInput)}) harus sama persis dengan Kredit (${formatIDR(totalCreditInput)}).`);
      return;
    }

    try {
      onCreateManualJournal({
        branchId: branchId || dataset.branches[0]?.id,
        accountingDate,
        effectiveDate: accountingDate,
        description,
        journalType: showModal,
        reason,
        lines: lines.map((l) => ({
          coa_code: l.coa_code,
          debit: l.side === 'debit' ? D(l.amount).toFixed(2) : '0.00',
          credit: l.side === 'credit' ? D(l.amount).toFixed(2) : '0.00',
          memo: l.memo,
          cash_flow_category: l.cash_flow_category,
          customer_id: l.customer_id || undefined,
          supplier_id: l.supplier_id || undefined,
          product_id: l.product_id || undefined,
        })),
      });
      setShowModal(null);
      setDescription('');
      setReason('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nomor jurnal, akun, keterangan..."
              className="pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white w-72"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['ALL', 'posted', 'draft', 'reversed'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                  statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {st === 'ALL' ? 'Semua' : st === 'posted' ? 'Posted' : st === 'draft' ? 'Draft' : 'Reversed'}
              </button>
            ))}
          </div>
        </div>

        {canCreate && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setShowModal('subledger_adjustment');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Jurnal Penyesuaian Subledger
            </button>
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setShowModal('manual');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Buat Jurnal Manual
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">No. Jurnal</th>
              <th className="px-4 py-3 font-medium">Tgl Buku / Efektif</th>
              <th className="px-4 py-3 font-medium">Tipe & Sumber</th>
              <th className="px-4 py-3 font-medium">Keterangan</th>
              <th className="px-4 py-3 font-medium text-right">Debit</th>
              <th className="px-4 py-3 font-medium text-right">Kredit</th>
              <th className="px-4 py-3 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((j) => (
              <tr
                key={j.id}
                onClick={() => onSelectJournal(j)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-mono font-medium text-teal-800">{j.journal_number}</td>
                <td className="px-4 py-3 font-mono tabular-nums text-slate-700">
                  <div>{formatDateID(j.accounting_date)}</div>
                  {j.effective_date !== j.accounting_date && (
                    <div className="text-[11px] text-slate-400">Eff: {formatDateID(j.effective_date)}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{j.journal_type}</div>
                  <div className="font-mono text-[11px] text-slate-400">{j.source_type ?? 'manual'}</div>
                </td>
                <td className="px-4 py-3 text-slate-800 max-w-md">{j.description}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">{formatIDR(j.total_debit)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">{formatIDR(j.total_credit)}</td>
                <td className="px-4 py-3 text-right font-medium">
                  <span className={j.status === 'posted' ? 'text-emerald-700' : j.status === 'reversed' ? 'text-rose-700' : 'text-amber-700'}>
                    {j.status === 'posted' ? 'Posted' : j.status === 'reversed' ? 'Reversed' : 'Draft'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={handleSaveJournal}
            className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden"
          >
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {showModal === 'subledger_adjustment'
                    ? 'Jurnal Penyesuaian Subledger (Terikat Item Kontrol)'
                    : 'Buat Draft Jurnal Manual'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {showModal === 'subledger_adjustment'
                    ? 'Wajib menautkan pelanggan, pemasok, atau produk terkait agar control account GL tetap cocok dengan subledger.'
                    : 'Dilarang memposting langsung ke akun kontrol AR/AP/Persediaan/Custody/Titipan. Memerlukan persetujuan accounting_approver berbeda.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(null)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Tutup
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {formError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Cabang</label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  >
                    {dataset.branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Pembukuan</label>
                  <input
                    type="date"
                    required
                    value={accountingDate}
                    onChange={(e) => setAccountingDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Alasan / Referensi</label>
                  <input
                    type="text"
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Dasar penyesuaian..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Deskripsi Jurnal</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Contoh: Koreksi reklasifikasi beban listrik"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">Baris Jurnal</span>
                  <button
                    type="button"
                    onClick={() =>
                      setLines([
                        ...lines,
                        { coa_code: '6101', side: 'debit', amount: '', memo: '', cash_flow_category: 'non_cash', customer_id: '', supplier_id: '', product_id: '' },
                      ])
                    }
                    className="text-xs font-medium text-teal-700 hover:underline"
                  >
                    + Tambah Baris
                  </button>
                </div>

                {lines.map((l, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center rounded-lg border border-slate-200 p-2 bg-slate-50">
                    <div className="col-span-4">
                      <select
                        value={l.coa_code}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx].coa_code = e.target.value;
                          setLines(next);
                        }}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {dataset.coa.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} - {c.name} {c.is_control_account ? '(Kontrol)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <select
                        value={l.side}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx].side = e.target.value as 'debit' | 'credit';
                          setLines(next);
                        }}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value="debit">Debit</option>
                        <option value="credit">Kredit</option>
                      </select>
                    </div>
                    <div className="col-span-3">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={l.amount}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx].amount = e.target.value;
                          setLines(next);
                        }}
                        placeholder="Nominal IDR"
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-right font-mono"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        value={l.memo}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx].memo = e.target.value;
                          setLines(next);
                        }}
                        placeholder="Memo baris"
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      />
                    </div>
                    {showModal === 'subledger_adjustment' && (
                      <div className="col-span-12 grid grid-cols-3 gap-2 pt-1">
                        <select
                          value={l.customer_id}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx].customer_id = e.target.value;
                            setLines(next);
                          }}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                        >
                          <option value="">-- Pelanggan (AR/Titipan) --</option>
                          {dataset.customers.map((c) => (
                            <option key={c.id} value={c.id}>{c.cust_id} - {c.name}</option>
                          ))}
                        </select>
                        <select
                          value={l.supplier_id}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx].supplier_id = e.target.value;
                            setLines(next);
                          }}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                        >
                          <option value="">-- Pemasok (AP/GRNI) --</option>
                          {dataset.suppliers.map((s) => (
                            <option key={s.id} value={s.id}>{s.supplier_code} - {s.name}</option>
                          ))}
                        </select>
                        <select
                          value={l.product_id}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx].product_id = e.target.value;
                            setLines(next);
                          }}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                        >
                          <option value="">-- SKU Produk (Persediaan) --</option>
                          {dataset.products.map((p) => (
                            <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}

                <div className="flex justify-end gap-6 pt-2 text-xs font-mono tabular-nums">
                  <span>Total Debit: <strong>{formatIDR(totalDebitInput)}</strong></span>
                  <span>Total Kredit: <strong>{formatIDR(totalCreditInput)}</strong></span>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800"
              >
                Simpan Draft Jurnal
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

interface BukuBesarViewProps {
  dataset: LedgerDataset;
  startDate: string;
  endDate: string;
  selectedBranch: string | 'ALL';
  initialCoaCode?: string;
  onSelectJournalById: (journalId: string) => void;
}

export const BukuBesarView: React.FC<BukuBesarViewProps> = ({
  dataset,
  startDate,
  endDate,
  selectedBranch,
  initialCoaCode,
  onSelectJournalById,
}) => {
  const [coaCode, setCoaCode] = useState(initialCoaCode ?? '1103');
  const gl = useMemo(
    () => computeGeneralLedger(dataset, coaCode, startDate, endDate, selectedBranch),
    [dataset, coaCode, startDate, endDate, selectedBranch]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-700">Akun Buku Besar:</label>
          <select
            value={coaCode}
            onChange={(e) => setCoaCode(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900"
          >
            {dataset.coa.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-6 text-xs font-mono tabular-nums">
          <div>
            <span className="text-slate-500">Saldo Awal ({formatDateID(startDate)}): </span>
            <strong className="text-slate-900">{formatIDR(gl.openingBalance)}</strong>
          </div>
          <div>
            <span className="text-slate-500">Saldo Akhir ({formatDateID(endDate)}): </span>
            <strong className="text-teal-800">{formatIDR(gl.closingBalance)}</strong>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Tanggal</th>
              <th className="px-4 py-3 font-medium">No. Jurnal</th>
              <th className="px-4 py-3 font-medium">Keterangan & Memo</th>
              <th className="px-4 py-3 font-medium text-right">Debit</th>
              <th className="px-4 py-3 font-medium text-right">Kredit</th>
              <th className="px-4 py-3 font-medium text-right">Saldo Berjalan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50/70 font-medium">
              <td colSpan={5} className="px-4 py-2.5 text-slate-700">Saldo Awal sebelum {formatDateID(startDate)}</td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900">{formatIDR(gl.openingBalance)}</td>
            </tr>
            {gl.entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  Tidak ada mutasi jurnal terposting pada rentang tanggal ini.
                </td>
              </tr>
            ) : (
              gl.entries.map((row, idx) => (
                <tr
                  key={`${row.journal_entry_id}-${idx}`}
                  onClick={() => onSelectJournalById(row.journal_entry_id)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-2.5 font-mono tabular-nums text-slate-700">{formatDateID(row.accounting_date)}</td>
                  <td className="px-4 py-2.5 font-mono font-medium text-teal-800">{row.journal_number}</td>
                  <td className="px-4 py-2.5 text-slate-800">
                    <div>{row.description}</div>
                    {row.memo && <div className="text-[11px] text-slate-500">{row.memo}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{Number(row.debit) > 0 ? formatIDR(row.debit) : '-'}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{Number(row.credit) > 0 ? formatIDR(row.credit) : '-'}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium text-slate-900">{formatIDR(row.running_balance)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface NeracaSaldoViewProps {
  statements: FinancialStatementsResult;
  onDrillToLedger: (coaCode: string) => void;
}

export const NeracaSaldoView: React.FC<NeracaSaldoViewProps> = ({ statements, onDrillToLedger }) => {
  const [hideZero, setHideZero] = useState(true);
  const rows = hideZero
    ? statements.trialBalance.filter(
        (r) =>
          Number(r.opening_debit) !== 0 ||
          Number(r.opening_credit) !== 0 ||
          Number(r.mutation_debit) !== 0 ||
          Number(r.mutation_credit) !== 0 ||
          Number(r.closing_debit) !== 0 ||
          Number(r.closing_credit) !== 0
      )
    : statements.trialBalance;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-900">Neraca Saldo ({statements.reportStatus})</span>
          <span className="text-slate-500">
            {formatDateID(statements.startDate)} s.d. {formatDateID(statements.endDate)} · Klik akun untuk membuka Buku Besar
          </span>
        </div>
        <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
          Sembunyikan akun bersaldo nol
        </label>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Akun</th>
              <th className="px-4 py-3 font-medium text-right">Awal Debit</th>
              <th className="px-4 py-3 font-medium text-right">Awal Kredit</th>
              <th className="px-4 py-3 font-medium text-right">Mutasi Debit</th>
              <th className="px-4 py-3 font-medium text-right">Mutasi Kredit</th>
              <th className="px-4 py-3 font-medium text-right">Akhir Debit</th>
              <th className="px-4 py-3 font-medium text-right">Akhir Kredit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr
                key={r.coa_code}
                onClick={() => onDrillToLedger(r.coa_code)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-2.5">
                  <span className="font-mono font-medium text-teal-800 mr-2">{r.coa_code}</span>
                  <span className="text-slate-800">{r.coa_name}</span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.opening_debit)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.opening_credit)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.mutation_debit)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.mutation_credit)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium">{formatIDR(r.closing_debit)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium">{formatIDR(r.closing_credit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-900">
            <tr>
              <td className="px-4 py-3">Total (Tanpa Angka Penyeimbang Buatan)</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.trialBalanceTotals.opening_debit)}</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.trialBalanceTotals.opening_credit)}</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.trialBalanceTotals.mutation_debit)}</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.trialBalanceTotals.mutation_credit)}</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.trialBalanceTotals.closing_debit)}</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.trialBalanceTotals.closing_credit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
