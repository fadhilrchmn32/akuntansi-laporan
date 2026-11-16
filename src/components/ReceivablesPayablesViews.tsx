import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus } from 'lucide-react';
import { FinancialStatementsResult, LedgerDataset } from '../lib/accountingEngine';
import { D, formatDateID, formatIDR, subMoney } from '../lib/decimal';
import { RoleCode } from '../types/finops';

interface PiutangTitipanViewProps {
  dataset: LedgerDataset;
  statements: FinancialStatementsResult;
}

export const PiutangTitipanView: React.FC<PiutangTitipanViewProps> = ({ dataset, statements }) => {
  const [tab, setTab] = useState<'ar' | 'titipan'>('ar');
  const arTie = statements.tieOuts.find((t) => t.coaCode === '1104');
  const titipanTie = statements.tieOuts.find((t) => t.coaCode === '2102');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Tie-Out Piutang Usaha (GL 1104)</span>
            {arTie?.isMatched ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Cocok
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700">
                <AlertTriangle className="h-3.5 w-3.5" /> Selisih {formatIDR(arTie?.difference)}
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
            <div><span className="text-slate-500 block font-sans">GL 1104:</span> <strong>{formatIDR(arTie?.glBalance)}</strong></div>
            <div><span className="text-slate-500 block font-sans">Subledger Nota Terbuka:</span> <strong>{formatIDR(arTie?.subledgerBalance)}</strong></div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Titipan Pelanggan (GL 2102 — Tidak Di-Net ke AR)</span>
            {titipanTie?.isMatched ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Cocok
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700">
                <AlertTriangle className="h-3.5 w-3.5" /> Selisih {formatIDR(titipanTie?.difference)}
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
            <div><span className="text-slate-500 block font-sans">GL 2102:</span> <strong>{formatIDR(titipanTie?.glBalance)}</strong></div>
            <div><span className="text-slate-500 block font-sans">Saldo Penerimaan Belum Dialokasikan:</span> <strong>{formatIDR(titipanTie?.subledgerBalance)}</strong></div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setTab('ar')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md ${tab === 'ar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
        >
          Aging & Kartu Piutang ({statements.agingAR.rows.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('titipan')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md ${tab === 'titipan' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
        >
          Saldo Titipan per Penerimaan ({dataset.receipts.length})
        </button>
      </div>

      {tab === 'ar' ? (
        <div className="space-y-4">
          {statements.agingAR.missingDueDateCount > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Gap Data Jatuh Tempo:</strong> Terdapat {statements.agingAR.missingDueDateCount} nota senilai{' '}
              <span className="font-mono font-semibold">{formatIDR(statements.agingAR.missingDueDateAmount)}</span> yang belum memiliki{' '}
              <code className="font-mono">due_date</code>. Nilai tidak diasumsikan otomatis dari tanggal kirim.
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Nota & Provenance</th>
                  <th className="px-4 py-3 font-medium">Pelanggan</th>
                  <th className="px-4 py-3 font-medium">Jatuh Tempo</th>
                  <th className="px-4 py-3 font-medium text-right">Belum JT</th>
                  <th className="px-4 py-3 font-medium text-right">0–30 hr</th>
                  <th className="px-4 py-3 font-medium text-right">31–60 hr</th>
                  <th className="px-4 py-3 font-medium text-right">61–90 hr</th>
                  <th className="px-4 py-3 font-medium text-right">&gt;90 hr</th>
                  <th className="px-4 py-3 font-medium text-right">Total Sisa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statements.agingAR.rows.map((r) => {
                  const sale = dataset.salesDocuments.find((s) => s.doc_number === r.docNumber);
                  return (
                    <tr key={r.docNumber} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="font-mono font-medium text-slate-900">{r.docNumber}</div>
                        <div className="text-[11px] text-slate-500">
                          {sale?.provenance === 'opening' ? 'Opening Balance (Non-Revenue)' : 'Penjualan App 2'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">{r.entityName}</td>
                      <td className="px-4 py-2.5 font-mono">
                        {r.missingDueDate ? (
                          <span className="text-amber-700 font-medium font-sans">Gap: due_date kosong</span>
                        ) : (
                          formatDateID(r.dueDate)
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.notDue)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.d0_30)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.d31_60)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.d61_90)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.dOver90)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900">{formatIDR(r.outstanding)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-900">
                <tr>
                  <td colSpan={3} className="px-4 py-3">Total Piutang Terbuka</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.agingAR.notDue)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.agingAR.d0_30)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.agingAR.d31_60)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.agingAR.d61_90)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.agingAR.dOver90)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatIDR(statements.agingAR.totalOutstanding)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">No. Penerimaan</th>
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Pelanggan</th>
                <th className="px-4 py-3 font-medium text-right">Terverifikasi</th>
                <th className="px-4 py-3 font-medium text-right">Dialokasikan</th>
                <th className="px-4 py-3 font-medium text-right">Sisa Titipan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dataset.receipts.map((r) => {
                const cust = dataset.customers.find((c) => c.id === r.customer_id);
                const avail = subMoney(subMoney(r.verified_amount, r.allocated_amount), r.refunded_amount);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-900">{r.receipt_number}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums">{formatDateID(r.bank_value_date ?? r.customer_paid_at)}</td>
                    <td className="px-4 py-2.5">
                      {r.is_unknown_identity ? <span className="text-amber-700 font-medium">Belum Teridentifikasi</span> : cust?.name ?? r.customer_id}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.verified_amount)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.allocated_amount)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-teal-800">{formatIDR(avail)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

interface UtangPemasokViewProps {
  dataset: LedgerDataset;
  statements: FinancialStatementsResult;
  roles: RoleCode[];
  currentUserId: string;
  onCreateSupplierPayment: (input: {
    branchId: string;
    supplierId: string;
    fundAccountId: string;
    paymentDate: string;
    referenceNo: string;
    allocations: { purchase_document_id: string; allocated_amount: string }[];
  }) => void;
  onApproveSupplierPayment: (paymentId: string) => void;
}

export const UtangPemasokView: React.FC<UtangPemasokViewProps> = ({
  dataset,
  statements,
  roles,
  currentUserId,
  onCreateSupplierPayment,
  onApproveSupplierPayment,
}) => {
  const [supplierId, setSupplierId] = useState(dataset.suppliers[0]?.id ?? '');
  const [fundAccountId, setFundAccountId] = useState(dataset.fundAccounts[1]?.id ?? dataset.fundAccounts[0]?.id ?? '');
  const [paymentDate, setPaymentDate] = useState('2026-11-16');
  const [referenceNo, setReferenceNo] = useState('');
  const [allocMap, setAllocMap] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const canPay = roles.some((r) => ['accountant', 'accounting_approver', 'finance_maker', 'finance_checker'].includes(r));
  const canApprove = roles.some((r) => ['accounting_approver', 'finance_checker'].includes(r));
  const apTie = statements.tieOuts.find((t) => t.coaCode === '2101');

  const openBills = dataset.purchaseDocuments.filter(
    (p) => p.supplier_id === supplierId && p.status === 'approved' && D(subMoney(p.total_amount, p.paid_amount)).gt(0)
  );

  const handlePay = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const allocations = openBills
      .map((b) => ({ purchase_document_id: b.id, allocated_amount: allocMap[b.id] ?? '0' }))
      .filter((a) => D(a.allocated_amount).gt(0));

    if (allocations.length === 0) {
      setError('Masukkan nominal alokasi pembayaran minimal untuk 1 tagihan pemasok.');
      return;
    }

    try {
      onCreateSupplierPayment({
        branchId: dataset.branches[0]?.id ?? '',
        supplierId,
        fundAccountId,
        paymentDate,
        referenceNo,
        allocations,
      });
      setAllocMap({});
      setReferenceNo('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Tie-Out Utang Usaha Pemasok (GL 2101 vs Subledger Tagihan)</div>
          <div className="mt-1 flex items-center gap-4 text-xs font-mono tabular-nums">
            <span>GL 2101: <strong>{formatIDR(apTie?.glBalance)}</strong></span>
            <span>Subledger: <strong>{formatIDR(apTie?.subledgerBalance)}</strong></span>
            <span className={apTie?.isMatched ? 'text-emerald-700 font-sans font-medium' : 'text-rose-700 font-sans font-medium'}>
              {apTie?.isMatched ? 'Cocok' : `Selisih ${formatIDR(apTie?.difference)}`}
            </span>
          </div>
        </div>
        <div className="text-xs text-slate-500">Status lunas dihitung otomatis dari alokasi pembayaran disetujui (tidak ada edit manual).</div>
      </div>

      {canPay && (
        <form onSubmit={handlePay} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">Catat Pembayaran Pemasok (Alokasi Many-to-Many)</h3>
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Pemasok</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs">
                {dataset.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Rekening / Kas Sumber</label>
              <select value={fundAccountId} onChange={(e) => setFundAccountId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs">
                {dataset.fundAccounts.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Bayar</label>
              <input type="date" required value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Referensi Bukti Transfer</label>
              <input type="text" required value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="TR-BCA-..." className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-700">Alokasi ke Tagihan Terbuka:</div>
            {openBills.length === 0 ? (
              <div className="text-xs text-slate-500">Tidak ada tagihan terbuka untuk pemasok ini.</div>
            ) : (
              openBills.map((b) => {
                const rem = subMoney(b.total_amount, b.paid_amount);
                return (
                  <div key={b.id} className="flex items-center justify-between gap-4 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div>
                      <span className="font-mono font-medium text-slate-900 mr-2">{b.doc_number}</span>
                      <span className="text-slate-500">JT: {formatDateID(b.due_date)} · Sisa: <strong className="font-mono">{formatIDR(rem)}</strong></span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={Number(rem)}
                      value={allocMap[b.id] ?? ''}
                      onChange={(e) => setAllocMap({ ...allocMap, [b.id]: e.target.value })}
                      placeholder="Nominal bayar"
                      className="w-40 rounded border border-slate-300 bg-white px-2.5 py-1 text-right font-mono text-xs"
                    />
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-end">
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800">
              Simpan Draft Pembayaran Pemasok
            </button>
          </div>
        </form>
      )}

      {dataset.supplierPayments.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">No. Pembayaran</th>
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Pemasok & Ref</th>
                <th className="px-4 py-3 font-medium text-right">Nominal</th>
                <th className="px-4 py-3 font-medium text-right">Status / Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dataset.supplierPayments.map((sp) => (
                <tr key={sp.id}>
                  <td className="px-4 py-2.5 font-mono font-medium">{sp.payment_number}</td>
                  <td className="px-4 py-2.5 font-mono">{formatDateID(sp.payment_date)}</td>
                  <td className="px-4 py-2.5">{dataset.suppliers.find((s) => s.id === sp.supplier_id)?.name} · {sp.reference_no}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold">{formatIDR(sp.amount)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {sp.status === 'draft' && canApprove && sp.created_by !== currentUserId ? (
                      <button
                        type="button"
                        onClick={() => onApproveSupplierPayment(sp.id)}
                        className="rounded bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800"
                      >
                        Setujui Pembayaran
                      </button>
                    ) : (
                      <span className={sp.status === 'approved' ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                        {sp.status === 'approved' ? 'Disetujui' : 'Draft (Menunggu Approver Lain)'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-200 text-xs font-semibold text-slate-900">Aging Utang Pemasok</div>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-2.5 font-medium">No. Tagihan</th>
              <th className="px-4 py-2.5 font-medium">Pemasok</th>
              <th className="px-4 py-2.5 font-medium">Jatuh Tempo</th>
              <th className="px-4 py-2.5 font-medium text-right">Belum JT</th>
              <th className="px-4 py-2.5 font-medium text-right">0–30 hr</th>
              <th className="px-4 py-2.5 font-medium text-right">&gt;30 hr</th>
              <th className="px-4 py-2.5 font-medium text-right">Sisa Utang</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {statements.agingAP.rows.map((r) => (
              <tr key={r.docNumber}>
                <td className="px-4 py-2.5 font-mono font-medium">{r.docNumber}</td>
                <td className="px-4 py-2.5">{r.entityName}</td>
                <td className="px-4 py-2.5 font-mono">{r.missingDueDate ? 'Gap due_date' : formatDateID(r.dueDate)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.notDue)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(r.d0_30)}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(D(r.d31_60).plus(D(r.d61_90)).plus(D(r.dOver90)).toFixed(2))}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold">{formatIDR(r.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface PembelianPenerimaanViewProps {
  dataset: LedgerDataset;
  roles: RoleCode[];
  currentUserId: string;
  onCreateGoodsReceipt: (input: {
    branchId: string;
    supplierId: string;
    receivedDate: string;
    productId: string;
    unitCode: string;
    quantity: string;
    estimatedUnitCost: string;
  }) => void;
  onCreatePurchaseInvoice: (input: {
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
  }) => void;
  onApprovePurchaseInvoice: (poId: string) => void;
}

export const PembelianPenerimaanView: React.FC<PembelianPenerimaanViewProps> = ({
  dataset,
  roles,
  currentUserId,
  onCreateGoodsReceipt,
  onCreatePurchaseInvoice,
  onApprovePurchaseInvoice,
}) => {
  const [subTab, setSubTab] = useState<'grn' | 'invoice'>('grn');
  const [supplierId, setSupplierId] = useState(dataset.suppliers[0]?.id ?? '');
  const [productId, setProductId] = useState(dataset.products[2]?.id ?? dataset.products[0]?.id ?? '');
  const [unitCode, setUnitCode] = useState('JERIGEN');
  const [qty, setQty] = useState('100');
  const [unitCost, setUnitCost] = useState('70000');
  const [docDate, setDocDate] = useState('2026-11-16');
  const [dueDate, setDueDate] = useState('2026-12-16');
  const [linkedGrnId, setLinkedGrnId] = useState<string>('');
  const [isPrepayment, setIsPrepayment] = useState(false);
  const [freight, setFreight] = useState('0');
  const [err, setErr] = useState<string | null>(null);

  const canCreate = roles.some((r) => ['accountant', 'accounting_approver'].includes(r));
  const canApprove = roles.includes('accounting_approver');
  const selectedProd = dataset.products.find((p) => p.id === productId);

  const handleGrnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      onCreateGoodsReceipt({
        branchId: dataset.branches[0]?.id ?? '',
        supplierId,
        receivedDate: docDate,
        productId,
        unitCode: selectedProd?.units[0]?.unit_code ?? unitCode,
        quantity: qty,
        estimatedUnitCost: unitCost,
      });
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    }
  };

  const handlePoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      onCreatePurchaseInvoice({
        branchId: dataset.branches[0]?.id ?? '',
        supplierId,
        invoiceDate: docDate,
        dueDate,
        goodsReceiptId: linkedGrnId || null,
        isPrepaymentException: !linkedGrnId && isPrepayment,
        productId,
        unitCode: selectedProd?.units[0]?.unit_code ?? unitCode,
        quantity: qty,
        unitCost,
        freightAmount: freight,
      });
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        <button type="button" onClick={() => setSubTab('grn')} className={`px-3 py-1.5 text-xs font-medium rounded-md ${subTab === 'grn' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
          Penerimaan Barang (GRN → Persediaan / GRNI)
        </button>
        <button type="button" onClick={() => setSubTab('invoice')} className={`px-3 py-1.5 text-xs font-medium rounded-md ${subTab === 'invoice' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
          Invoice Pembelian & Clearing GRNI
        </button>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{err}</div>}

      {subTab === 'grn' ? (
        <div className="space-y-5">
          {canCreate && (
            <form onSubmit={handleGrnSubmit} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Catat Penerimaan Barang (GRN)</h3>
                <span className="text-xs text-slate-500">Menambah stok moving average & mengkredit GRNI (2106) tanpa menggandakan stok saat invoice datang.</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Pemasok</label>
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">
                    {dataset.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Produk</label>
                  <select value={productId} onChange={(e) => { setProductId(e.target.value); const pr = dataset.products.find((x) => x.id === e.target.value); if (pr) setUnitCode(pr.base_unit); }} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">
                    {dataset.products.filter((p) => p.is_stocked).map((p) => <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Terima</label>
                  <input type="date" required value={docDate} onChange={(e) => setDocDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Qty ({selectedProd?.base_unit})</label>
                  <input type="number" min="1" required value={qty} onChange={(e) => setQty(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-right font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Estimasi Harga Beli/Unit</label>
                  <input type="number" min="1" required value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-right font-mono" />
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800">
                  <Plus className="h-3.5 w-3.5" /> Simpan & Posting GRN ke Stok
                </button>
              </div>
            </form>
          )}

          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">No. GRN</th>
                  <th className="px-4 py-3 font-medium">Tanggal</th>
                  <th className="px-4 py-3 font-medium">Pemasok</th>
                  <th className="px-4 py-3 font-medium text-right">Estimasi Nilai</th>
                  <th className="px-4 py-3 font-medium text-right">Status Penagihan GRNI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dataset.goodsReceipts.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-2.5 font-mono font-medium">{g.grn_number}</td>
                    <td className="px-4 py-2.5 font-mono">{formatDateID(g.received_date)}</td>
                    <td className="px-4 py-2.5">{dataset.suppliers.find((s) => s.id === g.supplier_id)?.name}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatIDR(g.total_estimated_cost)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={g.invoiced_status === 'invoiced' ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                        {g.invoiced_status === 'invoiced' ? 'Sudah Clearing Invoice' : 'Belum Difaktur (GRNI 2106 Terbuka)'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {canCreate && (
            <form onSubmit={handlePoSubmit} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">Catat Invoice Pembelian Pemasok</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tautkan GRN (Clearing GRNI)</label>
                  <select value={linkedGrnId} onChange={(e) => setLinkedGrnId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs">
                    <option value="">-- Tanpa GRN (Pembelian Langsung / Prepayment) --</option>
                    {dataset.goodsReceipts.filter((g) => g.invoiced_status !== 'invoiced').map((g) => (
                      <option key={g.id} value={g.id}>{g.grn_number} ({formatIDR(g.total_estimated_cost)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Invoice</label>
                  <input type="date" required value={docDate} onChange={(e) => setDocDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jatuh Tempo</label>
                  <input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Ongkos Kirim / Freight</label>
                  <input type="number" min="0" value={freight} onChange={(e) => setFreight(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-right font-mono" />
                </div>
              </div>

              {!linkedGrnId && (
                <label className="inline-flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 cursor-pointer">
                  <input type="checkbox" checked={isPrepayment} onChange={(e) => setIsPrepayment(e.target.checked)} />
                  Barang belum diterima di gudang (catatkan ke Uang Muka Pembelian 1106 — tidak menambah stok sebelum GRN!)
                </label>
              )}

              <div className="flex justify-end">
                <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800">
                  Simpan Draft Invoice Pembelian
                </button>
              </div>
            </form>
          )}

          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">No. Tagihan</th>
                  <th className="px-4 py-3 font-medium">Tanggal / JT</th>
                  <th className="px-4 py-3 font-medium">Pemasok & Mode</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Status / Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dataset.purchaseDocuments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 font-mono font-medium">{p.doc_number}</td>
                    <td className="px-4 py-2.5 font-mono">{formatDateID(p.invoice_date)} · JT {formatDateID(p.due_date)}</td>
                    <td className="px-4 py-2.5">
                      <div>{dataset.suppliers.find((s) => s.id === p.supplier_id)?.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {p.goods_receipt_id ? 'Clearing GRNI (Tidak menggandakan stok)' : p.is_prepayment_exception ? 'Prepayment (Barang belum diterima)' : 'Pembelian langsung'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold">{formatIDR(p.total_amount)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {p.status === 'draft' && canApprove && p.created_by !== currentUserId ? (
                        <button
                          type="button"
                          onClick={() => onApprovePurchaseInvoice(p.id)}
                          className="rounded bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800"
                        >
                          Setujui Invoice
                        </button>
                      ) : (
                        <span className={p.status === 'approved' ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                          {p.status === 'approved' ? 'Disetujui' : 'Draft'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
