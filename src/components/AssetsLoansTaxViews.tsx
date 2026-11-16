import React, { useState } from 'react';
import { Plus, Play, AlertTriangle } from 'lucide-react';
import { FinancialStatementsResult, LedgerDataset } from '../lib/accountingEngine';
import { D, formatDateID, formatIDR, roundMoney, subMoney } from '../lib/decimal';
import { RoleCode } from '../types/finops';

interface AsetTetapViewProps {
  dataset: LedgerDataset;
  roles: RoleCode[];
  onRegisterAsset: (input: {
    branchId: string;
    name: string;
    acquisitionDate: string;
    readyToUseDate: string;
    cost: string;
    residualValue: string;
    usefulLifeMonths: number;
    location: string;
    fundAccountId: string | null;
  }) => void;
  onRunDepreciation: (periodCode: string) => void;
}

export const AsetTetapView: React.FC<AsetTetapViewProps> = ({
  dataset,
  roles,
  onRegisterAsset,
  onRunDepreciation,
}) => {
  const [name, setName] = useState('');
  const [acqDate, setAcqDate] = useState('2026-11-16');
  const [cost, setCost] = useState('');
  const [residual, setResidual] = useState('0');
  const [lifeMonths, setLifeMonths] = useState('48');
  const [location, setLocation] = useState('Kantor Pusat');
  const [fundId, setFundId] = useState(dataset.fundAccounts[1]?.id ?? '');
  const [depPeriod, setDepPeriod] = useState(dataset.fiscalPeriods.find((p) => p.status === 'open')?.period_code ?? '2026-11');
  const [msg, setMsg] = useState<string | null>(null);

  const canManage = roles.some((r) => ['accountant', 'accounting_approver'].includes(r));

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    onRegisterAsset({
      branchId: dataset.branches[0]?.id ?? '',
      name,
      acquisitionDate: acqDate,
      readyToUseDate: acqDate,
      cost,
      residualValue: residual,
      usefulLifeMonths: Number(lifeMonths),
      location,
      fundAccountId: fundId || null,
    });
    setName('');
    setCost('');
    setMsg('Aset tetap baru dicatat dan dijurnal ke Perolehan Aset Tetap (1201).');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Register Aset Tetap & Jadwal Penyusutan</h3>
          <p className="text-xs text-slate-600">
            Metode penyusutan garis lurus (Straight-Line) dikonfirmasi akuntan. Eksekusi penyusutan bersifat unik per aset & periode (idempoten).
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <select value={depPeriod} onChange={(e) => setDepPeriod(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono">
              {dataset.fiscalPeriods.filter((p) => p.status === 'open').map((p) => (
                <option key={p.id} value={p.period_code}>{p.period_code}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                try {
                  onRunDepreciation(depPeriod);
                  setMsg(`Penyusutan periode ${depPeriod} dijalankan secara idempoten.`);
                } catch (err) {
                  setMsg(err instanceof Error ? err.message : String(err));
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" /> Jalankan Penyusutan Periode
            </button>
          </div>
        )}
      </div>

      {msg && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-800">{msg}</div>}

      {canManage && (
        <form onSubmit={handleRegister} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="text-xs font-semibold text-slate-900">Tambah Aset Tetap Baru (Investasi Kas/Bank → 1201 Aset Tetap)</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama aset (mis. Rak Gudang)" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs" />
            <input type="date" required value={acqDate} onChange={(e) => setAcqDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs" />
            <input type="number" min="1" required value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Harga Perolehan" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-right font-mono" />
            <input type="number" min="1" required value={lifeMonths} onChange={(e) => setLifeMonths(e.target.value)} placeholder="Umur (bln)" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-right font-mono" />
            <select value={fundId} onChange={(e) => setFundId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs">
              {dataset.fundAccounts.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800">
              <Plus className="h-3.5 w-3.5" /> Daftarkan Aset Tetap
            </button>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Kode & Nama Aset</th>
              <th className="px-4 py-3 font-medium">Siap Pakai & Lokasi</th>
              <th className="px-4 py-3 font-medium text-right">Harga Perolehan</th>
              <th className="px-4 py-3 font-medium text-right">Masa (Bln)</th>
              <th className="px-4 py-3 font-medium text-right">Penyusutan/Bln</th>
              <th className="px-4 py-3 font-medium text-right">Akumulasi</th>
              <th className="px-4 py-3 font-medium text-right">Nilai Buku Neto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dataset.fixedAssets.map((fa) => {
              const monthly = roundMoney(D(fa.cost).minus(D(fa.residual_value)).div(fa.useful_life_months), 0);
              const nbv = subMoney(fa.cost, fa.accumulated_depreciation);
              return (
                <tr key={fa.id}>
                  <td className="px-4 py-3">
                    <div className="font-mono font-medium text-slate-900">{fa.asset_code}</div>
                    <div className="text-slate-700">{fa.name}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{formatDateID(fa.ready_to_use_date)}</div>
                    <div className="text-[11px] text-slate-400">{fa.location}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(fa.cost)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{fa.useful_life_months}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(monthly)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(fa.accumulated_depreciation)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-slate-900">{formatIDR(nbv)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface PinjamanModalViewProps {
  dataset: LedgerDataset;
  roles: RoleCode[];
  onRecordLoanRepayment: (input: {
    loanId: string;
    paymentDate: string;
    principalPaid: string;
    interestPaid: string;
    fundAccountId: string;
    evidenceRef: string;
  }) => void;
  onCreateEquityTxn: (input: {
    branchId: string;
    txnType: 'capital_injection' | 'owner_draw';
    txnDate: string;
    partyName: string;
    fundAccountId: string;
    amount: string;
    notes: string;
  }) => void;
}

export const PinjamanModalView: React.FC<PinjamanModalViewProps> = ({
  dataset,
  roles,
  onRecordLoanRepayment,
  onCreateEquityTxn,
}) => {
  const [loanId, setLoanId] = useState(dataset.loans[0]?.id ?? '');
  const [principalPaid, setPrincipalPaid] = useState('2000000');
  const [interestPaid, setInterestPaid] = useState('300000');
  const [eqType, setEqType] = useState<'capital_injection' | 'owner_draw'>('capital_injection');
  const [eqAmount, setEqAmount] = useState('');
  const [eqParty, setEqParty] = useState('');
  const [fundId, setFundId] = useState(dataset.fundAccounts[1]?.id ?? '');
  const [date, setDate] = useState('2026-11-16');

  const canManage = roles.some((r) => ['accountant', 'accounting_approver'].includes(r));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Pinjaman (Pokok Bukan Biaya, Pencairan Bukan Penjualan)</h3>
            <p className="text-xs text-slate-500">Pembayaran pokok mengurangi 2201 Pinjaman; hanya bunga yang masuk Beban Bunga (6401).</p>
          </div>

          {dataset.loans.map((ln) => (
            <div key={ln.id} className="rounded border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
              <div className="flex justify-between font-medium text-slate-900">
                <span>{ln.loan_number} · {ln.lender_name}</span>
                <span className="font-mono tabular-nums">{formatIDR(ln.outstanding_principal)}</span>
              </div>
              <div className="text-slate-500">Pokok Awal: {formatIDR(ln.principal_amount)} · Bunga: {(Number(ln.annual_interest_rate) * 100).toFixed(2)}%/thn</div>
            </div>
          ))}

          {canManage && dataset.loans.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onRecordLoanRepayment({
                  loanId,
                  paymentDate: date,
                  principalPaid,
                  interestPaid,
                  fundAccountId: fundId,
                  evidenceRef: 'bukti-angsuran-bank.pdf',
                });
              }}
              className="space-y-3 pt-2 border-t border-slate-100"
            >
              <div className="text-xs font-medium text-slate-800">Catat Angsuran Pinjaman</div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min="0" required value={principalPaid} onChange={(e) => setPrincipalPaid(e.target.value)} placeholder="Pokok (2201)" className="rounded border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-right" />
                <input type="number" min="0" required value={interestPaid} onChange={(e) => setInterestPaid(e.target.value)} placeholder="Bunga (6401)" className="rounded border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-right" />
              </div>
              <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800">
                Catat & Posting Angsuran Pinjaman
              </button>
            </form>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Modal & Prive / Distribusi (Terpisah dari Laba Rugi)</h3>
            <p className="text-xs text-slate-500">Setoran modal (3101) dan prive (3103) langsung memengaruhi ekuitas serta arus kas pendanaan.</p>
          </div>

          {canManage && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onCreateEquityTxn({
                  branchId: dataset.branches[0]?.id ?? '',
                  txnType: eqType,
                  txnDate: date,
                  partyName: eqParty,
                  fundAccountId: fundId,
                  amount: eqAmount,
                  notes: eqType === 'capital_injection' ? 'Setoran modal pemilik' : 'Prive / distribusi pemilik',
                });
                setEqAmount('');
                setEqParty('');
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-2">
                <select value={eqType} onChange={(e) => setEqType(e.target.value as 'capital_injection' | 'owner_draw')} className="rounded border border-slate-300 px-2.5 py-1.5 text-xs">
                  <option value="capital_injection">Setoran Modal (3101)</option>
                  <option value="owner_draw">Prive / Distribusi (3103)</option>
                </select>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-slate-300 px-2.5 py-1.5 text-xs" />
                <input type="text" required value={eqParty} onChange={(e) => setEqParty(e.target.value)} placeholder="Nama Pemilik / Pemegang Saham" className="rounded border border-slate-300 px-2.5 py-1.5 text-xs" />
                <input type="number" min="1" required value={eqAmount} onChange={(e) => setEqAmount(e.target.value)} placeholder="Nominal IDR" className="rounded border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-right" />
              </div>
              <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800">
                Catat Transaksi Ekuitas
              </button>
            </form>
          )}

          {dataset.equityTransactions.length > 0 && (
            <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
              {dataset.equityTransactions.map((eq) => (
                <div key={eq.id} className="flex justify-between">
                  <span><span className="font-mono">{eq.doc_number}</span> · {eq.party_name} ({eq.txn_type})</span>
                  <span className="font-mono tabular-nums font-semibold">{formatIDR(eq.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface PajakViewProps {
  dataset: LedgerDataset;
  statements: FinancialStatementsResult;
  roles: RoleCode[];
  onToggleTaxCode: (taxId: string) => void;
}

export const PajakView: React.FC<PajakViewProps> = ({
  dataset,
  statements,
  roles,
  onToggleTaxCode,
}) => {
  const canConfig = roles.some((r) => ['accountant', 'accounting_approver'].includes(r));
  const pphOutput = statements.trialBalance.find((r) => r.coa_code === '2105')?.closing_signed ?? '0.00';
  const ppnInput = statements.trialBalance.find((r) => r.coa_code === '1107')?.closing_signed ?? '0.00';

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1">
        <div className="font-semibold flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <span>Status Kebijakan Pajak Usaha: {dataset.policy.tax_policy_status === 'unconfigured' ? 'Belum Ditetapkan' : dataset.policy.tax_policy_status}</span>
        </div>
        <p>
          Rekap pajak di bawah ini murni rekap pembukuan berdasarkan konfigurasi tax code yang disahkan.
          Aplikasi ini <strong>tidak</strong> mengklaim terintegrasi dengan e-Faktur/Coretax atau pelaporan SPT resmi DJP, dan tidak mengasumsikan tarif atau status PKP secara hardcoded.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Utang Pajak Keluaran (GL 2105)</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">{formatIDR(pphOutput)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Pajak Masukan Dapat Dikreditkan (GL 1107)</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">{formatIDR(ppnInput)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Kode & Nama Pajak</th>
              <th className="px-4 py-3 font-medium">Tanggal Efektif</th>
              <th className="px-4 py-3 font-medium">Mode & Arah</th>
              <th className="px-4 py-3 font-medium text-right">Tarif</th>
              <th className="px-4 py-3 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dataset.taxCodes.map((tc) => (
              <tr key={tc.id}>
                <td className="px-4 py-3">
                  <div className="font-mono font-medium text-slate-900">{tc.code}</div>
                  <div className="text-slate-600">{tc.name}</div>
                </td>
                <td className="px-4 py-3 font-mono">{formatDateID(tc.effective_date)}</td>
                <td className="px-4 py-3">
                  {tc.tax_mode} · {tc.direction} · {tc.is_recoverable ? 'Recoverable' : 'Non-recoverable'} · COA {tc.coa_code}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{(Number(tc.rate) * 100).toFixed(2)}%</td>
                <td className="px-4 py-3 text-right">
                  {canConfig ? (
                    <button
                      type="button"
                      onClick={() => onToggleTaxCode(tc.id)}
                      className={`rounded px-3 py-1 text-xs font-medium ${tc.is_active ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}
                    >
                      {tc.is_active ? 'Aktif (Klik Nonaktifkan)' : 'Non-Aktif (Klik Aktifkan)'}
                    </button>
                  ) : (
                    <span>{tc.is_active ? 'Aktif' : 'Non-Aktif'}</span>
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
