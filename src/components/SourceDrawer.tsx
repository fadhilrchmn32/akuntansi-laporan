import React, { useState } from 'react';
import { X, ArrowUpRight, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { JournalEntry, RoleCode } from '../types/finops';
import { LedgerDataset } from '../lib/accountingEngine';
import { formatDateID, formatDateTimeJKT, formatIDR } from '../lib/decimal';

interface SourceDrawerProps {
  journal: JournalEntry | null;
  dataset: LedgerDataset;
  roles: RoleCode[];
  currentUserId: string;
  onClose: () => void;
  onApproveJournal: (journalId: string) => void;
  onReverseJournal: (journalId: string, reversalDate: string, reason: string) => void;
}

export const SourceDrawer: React.FC<SourceDrawerProps> = ({
  journal,
  dataset,
  roles,
  currentUserId,
  onClose,
  onApproveJournal,
  onReverseJournal,
}) => {
  const [reverseMode, setReverseMode] = useState(false);
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!journal) return null;

  const canApprove = roles.includes('accounting_approver') && journal.created_by !== currentUserId;
  const sourceEvent = journal.source_event_id
    ? dataset.events.find((e) => e.id === journal.source_event_id)
    : null;

  const crossAppUrl =
    journal.source_type === 'receipt' || journal.source_type === 'cash_deposit' || journal.source_type === 'cash_transfer'
      ? dataset.policy.app1_url
      : journal.source_type === 'sales_document' || journal.source_type === 'payment_allocation'
      ? dataset.policy.app2_url
      : null;

  const handleReverse = () => {
    setError(null);
    if (reason.trim().length < 5) {
      setError('Alasan pembalikan jurnal wajib diisi minimal 5 karakter.');
      return;
    }
    try {
      onReverseJournal(journal.id, reversalDate, reason.trim());
      setReverseMode(false);
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl border-l border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-medium text-slate-700">{journal.journal_number}</span>
              <span aria-hidden="true">·</span>
              <span>{journal.journal_type.toUpperCase()}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  journal.status === 'posted'
                    ? 'font-medium text-emerald-700'
                    : journal.status === 'reversed'
                    ? 'font-medium text-rose-700'
                    : 'font-medium text-amber-700'
                }
              >
                {journal.status === 'posted' ? 'Terposting' : journal.status === 'reversed' ? 'Dibalik (Reversed)' : 'Draft'}
              </span>
            </div>
            <h2 className="mt-1 text-base font-semibold text-slate-900">{journal.description}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Tutup panel detail"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
            <div>
              <div className="text-slate-500">Tanggal Pembukuan (Accounting Date)</div>
              <div className="mt-0.5 font-mono font-medium text-slate-900">{formatDateID(journal.accounting_date)}</div>
            </div>
            <div>
              <div className="text-slate-500">Tanggal Efektif Sumber (Effective Date)</div>
              <div className="mt-0.5 font-mono font-medium text-slate-900">{formatDateID(journal.effective_date)}</div>
            </div>
            <div>
              <div className="text-slate-500">Dokumen Sumber & Versi Mapping</div>
              <div className="mt-0.5 font-mono text-slate-800">
                {journal.source_type ?? 'manual'} · {journal.source_id ? journal.source_id.slice(0, 12) : '-'} · {journal.mapping_version}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Waktu Posting</div>
              <div className="mt-0.5 text-slate-800">{formatDateTimeJKT(journal.posted_at)}</div>
            </div>
          </div>

          {journal.reversal_of_id && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Jurnal ini merupakan pembalikan (reversal) dari jurnal ID <span className="font-mono">{journal.reversal_of_id}</span>.
            </div>
          )}

          {journal.reversed_by_id && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
              Jurnal ini telah dibalik oleh jurnal ID <span className="font-mono">{journal.reversed_by_id}</span>. Jurnal lama tetap tersimpan demi jejak audit.
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Baris Jurnal (Double-Entry)</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Akun</th>
                    <th className="px-3 py-2.5 font-medium">Memo & Arus Kas</th>
                    <th className="px-3 py-2.5 font-medium text-right">Debit</th>
                    <th className="px-3 py-2.5 font-medium text-right">Kredit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {journal.lines.map((line) => {
                    const coa = dataset.coa.find((c) => c.code === line.coa_code);
                    return (
                      <tr key={line.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 align-top">
                          <div className="font-mono font-medium text-slate-900">{line.coa_code}</div>
                          <div className="text-slate-600">{coa?.name ?? 'Akun tidak dikenal'}</div>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="text-slate-800">{line.memo || '-'}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">Arus kas: {line.cash_flow_category}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900">
                          {Number(line.debit) > 0 ? formatIDR(line.debit) : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900">
                          {Number(line.credit) > 0 ? formatIDR(line.credit) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-900">
                  <tr>
                    <td colSpan={2} className="px-3 py-2.5">Total Seimbang</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatIDR(journal.total_debit)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatIDR(journal.total_credit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {sourceEvent && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Snapshot Event Sumber ({sourceEvent.event_type})</h3>
              <pre className="rounded-lg border border-slate-200 bg-slate-900 p-3 text-[11px] font-mono text-slate-100 overflow-x-auto">
                {JSON.stringify(sourceEvent.payload_snapshot, null, 2)}
              </pre>
            </div>
          )}

          {crossAppUrl && journal.source_id && (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div>
                <div className="font-medium text-slate-900">Telusuri ke Aplikasi Sumber</div>
                <div className="text-slate-600">Buka dokumen sumber pada aplikasi pemilik dokumen sesuai izin Anda.</div>
              </div>
              <a
                href={`${crossAppUrl}?doc_type=${encodeURIComponent(journal.source_type ?? '')}&id=${encodeURIComponent(journal.source_id)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                Buka Dokumen Sumber
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {reverseMode && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4 space-y-3">
              <h4 className="text-xs font-semibold text-rose-900">Formulir Pembalikan Jurnal (Reversal)</h4>
              <p className="text-xs text-rose-800">
                Pembalikan akan membuat jurnal baru berlawanan pada periode terbuka tanpa menghapus jurnal asal.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Jurnal Pembalik</label>
                  <input
                    type="date"
                    value={reversalDate}
                    onChange={(e) => setReversalDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Pembalikan (Wajib)</label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Contoh: Koreksi klasifikasi beban antar cabang"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReverseMode(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleReverse}
                  className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
                >
                  Konfirmasi Pembalikan
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
          <div className="text-xs text-slate-500">
            Dibuat oleh: <span className="font-mono">{journal.created_by ?? '-'}</span>
          </div>
          <div className="flex items-center gap-2">
            {journal.status === 'draft' && (
              <button
                type="button"
                disabled={!canApprove}
                onClick={() => {
                  setError(null);
                  try {
                    onApproveJournal(journal.id);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="h-4 w-4" />
                {canApprove ? 'Setujui & Posting Jurnal' : 'Butuh Approver Berbeda'}
              </button>
            )}
            {journal.status === 'posted' && roles.includes('accounting_approver') && !reverseMode && (
              <button
                type="button"
                onClick={() => setReverseMode(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-4 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-4 w-4" />
                Balik Jurnal (Reversal)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
