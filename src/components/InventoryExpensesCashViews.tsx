import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { FinancialStatementsResult, LedgerDataset } from '../lib/accountingEngine';
import { D, formatDateID, formatIDR, formatNumber, sumMoney } from '../lib/decimal';
import { RoleCode } from '../types/finops';

interface PersediaanHppViewProps {
  dataset: LedgerDataset;
  roles: RoleCode[];
  onRecalculateValuation: (productId: string, newUnitCost: string, reason: string) => void;
}

export const PersediaanHppView: React.FC<PersediaanHppViewProps> = ({
  dataset,
  roles,
  onRecalculateValuation,
}) => {
  const [revalProd, setRevalProd] = useState(dataset.products[0]?.id ?? '');
  const [revalCost, setRevalCost] = useState('52000');
  const [revalReason, setRevalReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const canReval = roles.some((r) => ['accountant', 'accounting_approver'].includes(r));

  const handleReval = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (revalReason.trim().length < 5) {
      setErr('Alasan rekalkulasi/revaluasi wajib diisi.');
      return;
    }
    try {
      onRecalculateValuation(revalProd, revalCost, revalReason.trim());
      setRevalReason('');
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">Valuasi Persediaan (Perpetual Moving Weighted Average)</div>
          <p className="text-xs text-slate-600 mt-0.5">
            Harga jual App 2 tidak pernah mengubah harga pokok. Stok negatif dilarang pada posting final.
            Status metode HPP: <strong>{dataset.policy.cogs_method_approved ? 'Disetujui Akuntan' : 'Menunggu Konfirmasi Akuntan'}</strong>.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Total Nilai Persediaan</div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
            {formatIDR(sumMoney(dataset.inventoryValuations.map((v) => v.total_value)))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">SKU & Produk</th>
              <th className="px-4 py-3 font-medium">Tipe & Satuan Dasar</th>
              <th className="px-4 py-3 font-medium text-right">Qty Tersedia</th>
              <th className="px-4 py-3 font-medium text-right">Average Cost / Unit</th>
              <th className="px-4 py-3 font-medium text-right">Total Nilai Persediaan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dataset.products.filter((p) => p.is_stocked).map((p) => {
              const val = dataset.inventoryValuations.find((v) => v.product_id === p.id);
              const qty = val?.qty_on_hand ?? '0';
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <div className="font-mono font-medium text-slate-900">{p.sku}</div>
                    <div className="text-slate-700">{p.name}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{p.base_unit}</div>
                    <div className="text-[11px] text-slate-400">
                      Konversi: {p.units.map((u) => `1 ${u.unit_code}=${Number(u.conversion_factor)} ${p.base_unit}`).join(', ')}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    <span className={D(qty).lte(0) ? 'text-rose-700 font-semibold' : 'text-slate-900'}>
                      {formatNumber(qty, 2)} {p.base_unit}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(val?.avg_unit_cost ?? '0')}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">{formatIDR(val?.total_value ?? '0')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canReval && (
        <form onSubmit={handleReval} className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Rekalkulasi / Revaluasi Biaya Berizin (Jejak Sebelum & Sesudah)</h3>
          <p className="text-xs text-slate-600">
            Digunakan untuk perubahan harga masuk atau penyesuaian backdated dengan mencatat dampak ke stok tersisa dan selisih HPP secara transparan.
          </p>
          {err && <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{err}</div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <select value={revalProd} onChange={(e) => setRevalProd(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs">
              {dataset.products.filter((p) => p.is_stocked).map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
            </select>
            <input type="number" min="1" required value={revalCost} onChange={(e) => setRevalCost(e.target.value)} placeholder="Harga rata-rata baru" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-right font-mono" />
            <input type="text" required value={revalReason} onChange={(e) => setRevalReason(e.target.value)} placeholder="Alasan revaluasi / koreksi nota" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs" />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800">
              <RefreshCw className="h-3.5 w-3.5" /> Jalankan Rekalkulasi Berizin
            </button>
          </div>
        </form>
      )}

      {dataset.inventoryRevaluations.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-xs font-semibold text-slate-900">Log Revaluasi & Dampak Biaya</div>
          {dataset.inventoryRevaluations.map((rv) => (
            <div key={rv.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
              <div>
                <span className="font-mono font-medium">{dataset.products.find((p) => p.id === rv.product_id)?.sku}</span> · {rv.reason}
              </div>
              <div className="font-mono tabular-nums text-slate-700">
                Lama: {formatIDR(rv.old_avg_cost)} → Baru: {formatIDR(rv.new_avg_cost)} · Dampak Stok: {formatIDR(rv.remaining_stock_impact)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-200 text-xs font-semibold text-slate-900">Kartu Mutasi & HPP Kronologis</div>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-2.5 font-medium">Tanggal</th>
              <th className="px-4 py-2.5 font-medium">Produk</th>
              <th className="px-4 py-2.5 font-medium">Arah & Sumber</th>
              <th className="px-4 py-2.5 font-medium text-right">Qty (Dasar)</th>
              <th className="px-4 py-2.5 font-medium text-right">Biaya Unit</th>
              <th className="px-4 py-2.5 font-medium text-right">Total Biaya</th>
              <th className="px-4 py-2.5 font-medium text-right">Saldo Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dataset.inventoryMovements.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2.5 font-mono">{formatDateID(m.movement_date)}</td>
                <td className="px-4 py-2.5">{dataset.products.find((p) => p.id === m.product_id)?.name}</td>
                <td className="px-4 py-2.5">
                  <span className={m.direction === 'in' ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                    {m.direction === 'in' ? 'Masuk' : 'Keluar (HPP)'}
                  </span>{' '}
                  · {m.source_type} · {m.condition_status}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(m.base_quantity, 2)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(m.unit_cost)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(m.total_cost)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums font-medium">{formatNumber(m.balance_qty_after, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface BiayaViewProps {
  dataset: LedgerDataset;
  roles: RoleCode[];
  currentUserId: string;
  onCreateExpense: (input: {
    branchId: string;
    expenseMode: 'direct_paid' | 'accrued' | 'prepaid' | 'accrual_settlement';
    expenseDate: string;
    categoryCoa: string;
    vendorName: string;
    fundAccountId: string | null;
    amount: string;
    description: string;
    evidenceRef: string;
  }) => void;
  onApproveExpense: (expenseId: string) => void;
}

export const BiayaView: React.FC<BiayaViewProps> = ({
  dataset,
  roles,
  currentUserId,
  onCreateExpense,
  onApproveExpense,
}) => {
  const [mode, setMode] = useState<'direct_paid' | 'accrued' | 'prepaid' | 'accrual_settlement'>('direct_paid');
  const [date, setDate] = useState('2026-11-16');
  const [coaCode, setCoaCode] = useState('6101');
  const [vendor, setVendor] = useState('');
  const [fundId, setFundId] = useState(dataset.fundAccounts[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [evidence, setEvidence] = useState('');

  const canCreate = roles.some((r) => ['accountant', 'accounting_approver', 'finance_maker'].includes(r));
  const canApprove = roles.some((r) => ['accounting_approver', 'finance_checker'].includes(r));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateExpense({
      branchId: dataset.branches[0]?.id ?? '',
      expenseMode: mode,
      expenseDate: date,
      categoryCoa: coaCode,
      vendorName: vendor,
      fundAccountId: mode === 'accrued' ? null : fundId,
      amount,
      description: desc,
      evidenceRef: evidence || 'lampiran-internal.pdf',
    });
    setVendor('');
    setAmount('');
    setDesc('');
    setEvidence('');
  };

  return (
    <div className="space-y-6">
      {canCreate && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Catat Dokumen Biaya Operasional</h3>
            <span className="text-xs text-slate-500">Pemisahan Direct Paid, Accrued (2107), Prepaid (1106), dan Pelunasan Akrual mencegah pengakuan biaya ganda.</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Pengakuan Biaya</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">
                <option value="direct_paid">Dibayar Langsung (Beban vs Kas/Bank)</option>
                <option value="accrued">Biaya Akrual Belum Dibayar (Beban vs Utang Biaya 2107)</option>
                <option value="prepaid">Dibayar di Muka / Prepaid (1106 vs Kas/Bank)</option>
                <option value="accrual_settlement">Pelunasan Utang Biaya (2107 vs Kas/Bank)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Akun Biaya</label>
              <select value={coaCode} onChange={(e) => setCoaCode(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">
                {dataset.coa.filter((c) => c.account_group === 'expense').map((c) => (
                  <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Transaksi</label>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nominal (IDR)</label>
              <input type="number" min="1" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-right font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Vendor / Penerima</label>
              <input type="text" required value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="PLN / Pertamina / Toko ATK" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kas / Rekening Terkait</label>
              <select disabled={mode === 'accrued'} value={fundId} onChange={(e) => setFundId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-100">
                {dataset.fundAccounts.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan & Referensi Bukti</label>
              <input type="text" required value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Keterangan pengeluaran & nomor nota bukti" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs" />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800">
              Simpan Draft Biaya
            </button>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">No. Dokumen</th>
              <th className="px-4 py-3 font-medium">Tanggal</th>
              <th className="px-4 py-3 font-medium">Mode & Akun</th>
              <th className="px-4 py-3 font-medium">Vendor & Keterangan</th>
              <th className="px-4 py-3 font-medium text-right">Nominal</th>
              <th className="px-4 py-3 font-medium text-right">Status / Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dataset.expenses.map((ex) => (
              <tr key={ex.id}>
                <td className="px-4 py-2.5 font-mono font-medium">{ex.doc_number}</td>
                <td className="px-4 py-2.5 font-mono">{formatDateID(ex.expense_date)}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-800">{ex.expense_mode}</div>
                  <div className="font-mono text-[11px] text-slate-500">COA {ex.category_coa}</div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-900">{ex.vendor_name}</div>
                  <div className="text-slate-600">{ex.description}</div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold">{formatIDR(ex.amount)}</td>
                <td className="px-4 py-2.5 text-right">
                  {ex.status === 'draft' && canApprove && ex.created_by !== currentUserId ? (
                    <button type="button" onClick={() => onApproveExpense(ex.id)} className="rounded bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800">
                      Setujui Biaya
                    </button>
                  ) : (
                    <span className={ex.status === 'approved' ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                      {ex.status === 'approved' ? 'Disetujui' : 'Draft'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface KasBankViewProps {
  dataset: LedgerDataset;
  statements: FinancialStatementsResult;
  roles: RoleCode[];
  onApproveBankReconciliation: (recId: string) => void;
}

export const KasBankRekonsiliasiView: React.FC<KasBankViewProps> = ({
  dataset,
  statements,
  roles,
  onApproveBankReconciliation,
}) => {
  const custodyTie = statements.tieOuts.find((t) => t.coaCode === '1102');
  const canApprove = roles.some((r) => ['accountant', 'accounting_approver', 'finance_checker'].includes(r));

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs text-slate-500">
          Catatan Operasional: Aplikasi hanya mencatat dan membukukan transaksi yang telah disetujui; tidak ada eksekusi transfer dana bank otomatis dari UI.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Rekening Kas Kantor & Bank (Terpisah per Fund Account)</h3>
          <table className="w-full text-xs text-left">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2 font-medium">Rekening / Kas</th>
                <th className="py-2 font-medium">Tipe & COA</th>
                <th className="py-2 font-medium text-right">Saldo Buku (Posted)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dataset.fundAccounts.map((fa) => {
                // Hitung saldo buku per fund_account_id dari jurnal posted
                let bal = D(0);
                for (const j of dataset.journals) {
                  if (j.status !== 'posted') continue;
                  for (const l of j.lines) {
                    if (l.fund_account_id === fa.id) {
                      bal = bal.plus(D(l.debit)).minus(D(l.credit));
                    }
                  }
                }
                return (
                  <tr key={fa.id}>
                    <td className="py-2.5">
                      <div className="font-medium text-slate-900">{fa.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{fa.bank_name ?? 'Kas Tunai'} · {fa.account_number ?? fa.code}</div>
                    </td>
                    <td className="py-2.5 font-mono text-slate-600">{fa.account_type} ({fa.coa_account_code})</td>
                    <td className="py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900">{formatIDR(bal.toFixed(2))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Uang di Penagih (Custody GL 1102)</h3>
            {custodyTie?.isMatched ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Tie-out GL Cocok</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> Selisih {formatIDR(custodyTie?.difference)}</span>
            )}
          </div>
          <table className="w-full text-xs text-left">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2 font-medium">Penagih</th>
                <th className="py-2 font-medium text-right">Terverifikasi</th>
                <th className="py-2 font-medium text-right">Kurang Setor Terbuka</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dataset.custodyAccounts.map((ca) => (
                <tr key={ca.id}>
                  <td className="py-2.5 font-medium text-slate-900">{ca.collector_name}</td>
                  <td className="py-2.5 text-right font-mono tabular-nums font-semibold">{formatIDR(ca.verified_balance)}</td>
                  <td className="py-2.5 text-right font-mono tabular-nums">{formatIDR(ca.shortage_open_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">Rekonsiliasi Bank (Saldo Awal & Akhir Statement vs Buku)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">Rekening</th>
                <th className="px-4 py-2.5 font-medium">Periode</th>
                <th className="px-4 py-2.5 font-medium text-right">Statement Awal → Akhir</th>
                <th className="px-4 py-2.5 font-medium text-right">Buku Awal → Akhir</th>
                <th className="px-4 py-2.5 font-medium text-right">Pos Penyesuai</th>
                <th className="px-4 py-2.5 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dataset.bankReconciliations.map((br) => {
                const fa = dataset.fundAccounts.find((f) => f.id === br.fund_account_id);
                const diff = D(br.statement_closing_balance).minus(D(br.book_closing_balance));
                return (
                  <tr key={br.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{fa?.name ?? br.fund_account_id}</td>
                    <td className="px-4 py-3 font-mono">{formatDateID(br.period_start)} – {formatDateID(br.period_end)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatIDR(br.statement_opening_balance)} → <strong>{formatIDR(br.statement_closing_balance)}</strong>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatIDR(br.book_opening_balance)} → <strong>{formatIDR(br.book_closing_balance)}</strong>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      Selisih: {formatIDR(diff.toFixed(2))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {br.status === 'approved' ? (
                        <span className="text-emerald-700 font-medium">Disahkan</span>
                      ) : canApprove ? (
                        <button
                          type="button"
                          onClick={() => onApproveBankReconciliation(br.id)}
                          className="rounded bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800"
                        >
                          Sahkan Rekonsiliasi
                        </button>
                      ) : (
                        <span className="text-amber-700">Draft</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
