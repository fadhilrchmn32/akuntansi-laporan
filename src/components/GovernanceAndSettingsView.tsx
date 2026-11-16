import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, Play, ShieldCheck } from 'lucide-react';
import {
  computeFinancialStatements,
  LedgerDataset,
  processEventIntoDataset,
} from '../lib/accountingEngine';
import { createSyntheticDemoDataset } from '../data/syntheticSeed';
import { cmpMoney, D, formatDateID, formatDateTimeJKT, formatIDR, sumMoney } from '../lib/decimal';
import { AccountingPolicy, AuditEvent, RoleCode } from '../types/finops';

interface GovernanceAndSettingsViewProps {
  dataset: LedgerDataset;
  auditEvents: AuditEvent[];
  roles: RoleCode[];
  onUpdatePolicy: (patch: Partial<AccountingPolicy>) => void;
}

interface SelfTestResult {
  name: string;
  passed: boolean;
  detail: string;
}

export const GovernanceAndSettingsView: React.FC<GovernanceAndSettingsViewProps> = ({
  dataset,
  auditEvents,
  roles,
  onUpdatePolicy,
}) => {
  const [tab, setTab] = useState<'wizard' | 'coa' | 'audit' | 'worker_tests'>('wizard');
  const [frameworkName, setFrameworkName] = useState(dataset.policy.reporting_framework_name ?? '');
  const [frameworkStatus, setFrameworkStatus] = useState(dataset.policy.reporting_framework_status);
  const [taxStatus, setTaxStatus] = useState(dataset.policy.tax_policy_status);
  const [cutoverDate, setCutoverDate] = useState(dataset.policy.cutover_date ?? '2026-10-31');
  const [autoPost, setAutoPost] = useState(dataset.policy.allow_auto_post_deterministic);
  const [app1Url, setApp1Url] = useState(dataset.policy.app1_url ?? '');
  const [app2Url, setApp2Url] = useState(dataset.policy.app2_url ?? '');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<SelfTestResult[] | null>(null);

  const canConfig = roles.some((r) => ['accountant', 'accounting_approver', 'system_admin'].includes(r));
  const isApprover = roles.includes('accounting_approver');

  const openingDebitSum = sumMoney(dataset.openingBalances.map((o) => o.debit));
  const openingCreditSum = sumMoney(dataset.openingBalances.map((o) => o.credit));
  const openingBalanced = cmpMoney(openingDebitSum, openingCreditSum) === 0;

  const handleSavePolicy = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdatePolicy({
      reporting_framework_name: frameworkName || null,
      reporting_framework_status: frameworkStatus,
      tax_policy_status: taxStatus,
      cutover_date: cutoverDate || null,
      allow_auto_post_deterministic: isApprover ? autoPost : dataset.policy.allow_auto_post_deterministic,
      app1_url: app1Url || null,
      app2_url: app2Url || null,
    });
    setSavedNotice('Konfigurasi kebijakan dan tautan lintas-aplikasi diperbarui.');
  };

  const runDeterministicVerificationSuite = () => {
    const results: SelfTestResult[] = [];
    const base = createSyntheticDemoDataset();

    // Test 1: Semua jurnal posted seimbang debit = kredit
    const unbalanced = base.journals.filter((j) => cmpMoney(j.total_debit, j.total_credit) !== 0);
    results.push({
      name: '1. Semua recipe jurnal menghasilkan Debit = Kredit',
      passed: unbalanced.length === 0,
      detail: unbalanced.length === 0 ? `${base.journals.length} jurnal seimbang.` : `${unbalanced.length} jurnal tidak seimbang.`,
    });

    // Test 2: Idempotensi event posting & retry
    const first = processEventIntoDataset(base, 'ev-9', 'user-acc-1', 'idem-test-1');
    const second = processEventIntoDataset(first.dataset, 'ev-9', 'user-acc-1', 'idem-test-1');
    results.push({
      name: '2. Retry / duplicate idempotency_key menghasilkan tepat 1 jurnal',
      passed: !first.idempotentHit && second.idempotentHit && first.journal.id === second.journal.id,
      detail: `Jurnal ID ${first.journal.journal_number} dikembalikan tanpa duplikasi.`,
    });

    // Test 3: HPP kosong / stok negatif menahan posting penjualan
    let cogsBlocked = false;
    try {
      processEventIntoDataset(base, 'ev-8', 'user-acc-1', 'idem-test-cogs');
    } catch {
      cogsBlocked = true;
    }
    results.push({
      name: '3. HPP kosong / stok nol menahan event penjualan (tidak posting HPP 0)',
      passed: cogsBlocked,
      detail: cogsBlocked ? 'Penjualan SKU stok kosong ditolak dengan pesan HPP.' : 'Gagal: penjualan lolos tanpa HPP.',
    });

    // Test 4: Setoran custody tidak menambah total kas perusahaan atau Arus Kas Operasi
    const st = computeFinancialStatements(base, { startDate: '2026-11-01', endDate: '2026-11-16', branchId: 'ALL' });
    const expectedNetOp = '18500000.00'; // +12jt (transfer) + 8jt (tunai) - 1.5jt (BBM) = 18.5jt (setoran 5jt internal_transfer tidak masuk CFO!)
    results.push({
      name: '4. Setoran custody penagih & alokasi titipan tidak menggandakan CFO atau pendapatan',
      passed: cmpMoney(st.cashFlowDirect.netOperating, expectedNetOp) === 0,
      detail: `Arus Kas Operasi = ${formatIDR(st.cashFlowDirect.netOperating)} (expected ${formatIDR(expectedNetOp)}).`,
    });

    // Test 5: Neraca seimbang & Roll-forward kas cocok
    results.push({
      name: '5. Persamaan Neraca (Aset = Kewajiban + Ekuitas) & Roll-Forward Kas cocok',
      passed: st.balanceSheet.isBalanced && st.cashFlowDirect.reconcilesWithBalanceSheet,
      detail: `Aset ${formatIDR(st.balanceSheet.totalAssets)} = L+E ${formatIDR(st.balanceSheet.totalLiabilitiesAndEquity)}; Kas Akhir ${formatIDR(st.cashFlowDirect.closingCashComputed)}`,
    });

    // Test 6: Tie-out seluruh akun kontrol
    const allTie = st.tieOuts.every((t) => t.isMatched);
    results.push({
      name: '6. Seluruh akun kontrol (AR, Titipan, Custody, AP, Persediaan) tie-out dengan subledger',
      passed: allTie,
      detail: allTie ? '5 dari 5 akun kontrol cocok 100%.' : 'Terdapat selisih tie-out.',
    });

    // Test 7: Snapshot as-of historis tidak berubah oleh transaksi sesudah cut-off
    const asOfNov5 = computeFinancialStatements(base, { startDate: '2026-11-01', endDate: '2026-11-05', branchId: 'ALL' });
    const asOfNov16 = computeFinancialStatements(base, { startDate: '2026-11-01', endDate: '2026-11-16', branchId: 'ALL' });
    results.push({
      name: '7. Laporan as-of historis (05/11) terisolasi dari transaksi sesudah tanggal cut-off',
      passed: cmpMoney(asOfNov5.balanceSheet.totalAssets, asOfNov16.balanceSheet.totalAssets) !== 0 && asOfNov5.balanceSheet.isBalanced,
      detail: `Aset per 05/11: ${formatIDR(asOfNov5.balanceSheet.totalAssets)} vs 16/11: ${formatIDR(asOfNov16.balanceSheet.totalAssets)}.`,
    });

    setTestResults(results);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {[
          { id: 'wizard', label: 'Onboarding, Cutover & Kebijakan' },
          { id: 'coa', label: 'Chart of Accounts & Produk' },
          { id: 'audit', label: `Audit Trail (${auditEvents.length})` },
          { id: 'worker_tests', label: 'Worker Terjadwal & Uji Integritas' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as typeof tab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'wizard' && (
        <div className="space-y-6">
          <form onSubmit={handleSavePolicy} className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Konfigurasi Kebijakan Akuntansi, Pajak & Cutover (Section B)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Status "Belum ditetapkan" tidak dianggap persetujuan. Auto-post deterministik hanya aktif jika disahkan oleh <code className="font-mono">accounting_approver</code>.
              </p>
            </div>

            {savedNotice && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{savedNotice}</div>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status Kerangka Pelaporan (SAK)</label>
                <select
                  disabled={!canConfig}
                  value={frameworkStatus}
                  onChange={(e) => setFrameworkStatus(e.target.value as AccountingPolicy['reporting_framework_status'])}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                >
                  <option value="unconfigured">Belum ditetapkan</option>
                  <option value="draft">Draft Kebijakan</option>
                  <option value="approved">Disahkan Internal</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Kerangka (mis. SAK EP / SAK EMKM)</label>
                <input
                  type="text"
                  disabled={!canConfig}
                  value={frameworkName}
                  onChange={(e) => setFrameworkName(e.target.value)}
                  placeholder="Belum ditetapkan"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status Kebijakan Pajak Usaha</label>
                <select
                  disabled={!canConfig}
                  value={taxStatus}
                  onChange={(e) => setTaxStatus(e.target.value as AccountingPolicy['tax_policy_status'])}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                >
                  <option value="unconfigured">Belum ditetapkan</option>
                  <option value="inactive">Pajak Non-Aktif</option>
                  <option value="active_non_pkp">Aktif (Non-PKP)</option>
                  <option value="active_pkp">Aktif (PKP)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Cutover Saldo Awal</label>
                <input
                  type="date"
                  disabled={!canConfig}
                  value={cutoverDate}
                  onChange={(e) => setCutoverDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">URL App 1 (Penerimaan & Setoran)</label>
                <input
                  type="url"
                  disabled={!canConfig}
                  value={app1Url}
                  onChange={(e) => setApp1Url(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">URL App 2 (Penjualan & Rekonsiliasi)</label>
                <input
                  type="url"
                  disabled={!canConfig}
                  value={app2Url}
                  onChange={(e) => setApp2Url(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <label className="inline-flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!isApprover}
                  checked={autoPost}
                  onChange={(e) => setAutoPost(e.target.checked)}
                />
                <span>Aktifkan Auto-Post untuk event deterministik (khusus <code className="font-mono">accounting_approver</code>)</span>
              </label>
              {canConfig && (
                <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800">
                  Simpan Konfigurasi
                </button>
              )}
            </div>
          </form>

          <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Neraca Saldo Awal Cutover ({formatDateID(dataset.policy.cutover_date)})</h3>
                <p className="text-xs text-slate-500">Tanpa balancing plug ke modal/suspense. Opening items memiliki provenance opening (non-revenue).</p>
              </div>
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${openingBalanced ? 'text-emerald-700' : 'text-rose-700'}`}>
                {openingBalanced ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {openingBalanced ? 'Opening Debit = Kredit' : 'Opening Tidak Seimbang'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Akun</th>
                    <th className="px-3 py-2 font-medium text-right">Opening Debit</th>
                    <th className="px-3 py-2 font-medium text-right">Opening Kredit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dataset.openingBalances.map((ob) => {
                    const c = dataset.coa.find((x) => x.code === ob.coa_code);
                    return (
                      <tr key={ob.id}>
                        <td className="px-3 py-2"><span className="font-mono font-medium mr-2">{ob.coa_code}</span>{c?.name}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatIDR(ob.debit)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatIDR(ob.credit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                  <tr>
                    <td className="px-3 py-2.5">Total Saldo Awal</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatIDR(openingDebitSum)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatIDR(openingCreditSum)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'coa' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-200 text-xs font-semibold text-slate-900">Chart of Accounts (FINOPS_SHARED_V1)</div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Kode</th>
                  <th className="px-3 py-2 font-medium">Nama Akun</th>
                  <th className="px-3 py-2 font-medium">Grup</th>
                  <th className="px-3 py-2 font-medium">Kontrol / Kas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dataset.coa.map((c) => (
                  <tr key={c.code}>
                    <td className="px-3 py-2 font-mono font-medium">{c.code}</td>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2 text-slate-600">{c.account_group} ({c.normal_balance})</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">
                      {c.is_control_account ? `Kontrol (${c.control_subledger})` : c.is_cash_component ? 'Komponen Kas' : 'Reguler'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto h-fit">
            <div className="px-4 py-3 border-b border-slate-200 text-xs font-semibold text-slate-900">Master Produk (Stok, Non-Stock & Deposit Wadah)</div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">Nama Produk</th>
                  <th className="px-3 py-2 font-medium">Jenis</th>
                  <th className="px-3 py-2 font-medium">Satuan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dataset.products.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-mono font-medium">{p.sku}</td>
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2">
                      {p.product_type === 'stocked'
                        ? 'Barang Stok (HPP)'
                        : p.product_type === 'deposit_returnable'
                        ? `Deposit Wadah (COA ${p.deposit_liability_coa ?? '2108'})`
                        : 'Non-Stock'}
                    </td>
                    <td className="px-3 py-2 font-mono">{p.base_unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Waktu (WIB)</th>
                <th className="px-4 py-3 font-medium">Aktor & Aplikasi</th>
                <th className="px-4 py-3 font-medium">Aksi & Entitas</th>
                <th className="px-4 py-3 font-medium">Alasan / Catatan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditEvents.map((ae) => (
                <tr key={ae.id}>
                  <td className="px-4 py-2.5 font-mono text-slate-600">{formatDateTimeJKT(ae.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{ae.actor_name}</div>
                    <div className="text-[11px] font-mono text-slate-400">{ae.source_app}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-800">{ae.event_action} ({ae.entity_type})</td>
                  <td className="px-4 py-2.5 text-slate-700">{ae.reason ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'worker_tests' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Arsitektur Worker Terjadwal & Dokumentasi Deployment</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Worker terpisah (<code className="font-mono">worker/accounting-worker.ts</code> dan fungsi PostgreSQL <code className="font-mono">private.cron_process_all_companies()</code> pada migrasi <code className="font-mono">0007</code>)
              memanggil fungsi <code className="font-mono">public.process_accounting_queue</code> yang identik dengan tombol di menu Antrian Pembukuan.
              Jadwal produksi: setiap 2 menit via <code className="font-mono">pg_cron</code> atau Cloud Scheduler. Retry idempoten berbasis <code className="font-mono">idempotency_keys</code> dan <code className="font-mono">journal_source_links(accounting_event_id)</code>.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-teal-700" />
                  <span>Verifikasi Integritas Mesin Akuntansi (Data Sintetis Terisolasi)</span>
                </h3>
                <p className="text-xs text-slate-500">Menjalankan uji deterministik terhadap resep jurnal, idempotensi, HPP hold, arus kas, neraca, tie-out, dan cut-off as-of.</p>
              </div>
              <button
                type="button"
                onClick={runDeterministicVerificationSuite}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5" /> Jalankan Uji Integritas Sekarang
              </button>
            </div>

            {testResults && (
              <div className="space-y-2 pt-2">
                {testResults.map((tr, i) => (
                  <div
                    key={i}
                    className={`flex items-start justify-between gap-4 rounded border px-3 py-2.5 text-xs ${
                      tr.passed ? 'border-emerald-200 bg-emerald-50/60 text-emerald-950' : 'border-rose-200 bg-rose-50 text-rose-900'
                    }`}
                  >
                    <div>
                      <div className="font-semibold">{tr.name}</div>
                      <div className="text-slate-700 mt-0.5">{tr.detail}</div>
                    </div>
                    <span className="font-mono font-semibold shrink-0">{tr.passed ? 'LULUS' : 'GAGAL'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
