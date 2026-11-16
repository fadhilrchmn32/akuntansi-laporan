import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Play, RefreshCw, ArrowRight } from 'lucide-react';
import { FinancialStatementsResult, LedgerDataset } from '../lib/accountingEngine';
import { formatDateID, formatDateTimeJKT, formatIDR } from '../lib/decimal';
import { AccountingEvent, JournalEntry, MenuKey, RoleCode } from '../types/finops';

interface OverviewViewProps {
  dataset: LedgerDataset;
  statements: FinancialStatementsResult;
  roles: RoleCode[];
  onNavigate: (menu: MenuKey) => void;
  onSelectJournal: (j: JournalEntry) => void;
}

export const RingkasanKeuanganView: React.FC<OverviewViewProps> = ({
  dataset,
  statements,
  roles,
  onNavigate,
  onSelectJournal,
}) => {
  const canSeeCogs = roles.some((r) => ['accountant', 'accounting_approver', 'owner_viewer', 'system_admin'].includes(r));

  const cashOffice = statements.trialBalance.find((r) => r.coa_code === '1101')?.closing_signed ?? '0.00';
  const cashCustody = statements.trialBalance.find((r) => r.coa_code === '1102')?.closing_signed ?? '0.00';
  const cashBank = statements.trialBalance.find((r) => r.coa_code === '1103')?.closing_signed ?? '0.00';
  const totalCash = statements.cashFlowDirect.closingCashBalanceSheet;

  const arBalance = statements.trialBalance.find((r) => r.coa_code === '1104')?.closing_signed ?? '0.00';
  const apBalance = statements.trialBalance.find((r) => r.coa_code === '2101')?.closing_signed ?? '0.00';

  const queuedCount = dataset.events.filter((e) => ['waiting_accounting_module', 'queued'].includes(e.processing_status)).length;
  const failedCount = dataset.events.filter((e) => e.processing_status === 'failed').length;
  const draftJournals = dataset.journals.filter((j) => j.status === 'draft').length;

  return (
    <div className="space-y-6">
      {statements.completenessGaps.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
              <span>Laporan Berstatus Draft — Terdapat {statements.completenessGaps.length} Gap Data & Konfigurasi</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('audit_pengaturan')}
              className="text-xs font-medium text-amber-900 underline hover:text-amber-700 whitespace-nowrap shrink-0"
            >
              Lengkapi Pengaturan & Saldo Awal
            </button>
          </div>
          <ul className="list-disc pl-5 text-xs text-amber-900 space-y-1">
            {statements.completenessGaps.map((gap, i) => (
              <li key={i}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Total Kas & Custody (Disahkan)</div>
          <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-slate-900">{formatIDR(totalCash)}</div>
          <div className="mt-2 text-xs text-slate-600 space-y-0.5 font-mono tabular-nums">
            <div className="flex justify-between"><span>Kas Kantor (1101)</span><span>{formatIDR(cashOffice)}</span></div>
            <div className="flex justify-between"><span>Bank (1103)</span><span>{formatIDR(cashBank)}</span></div>
            <div className="flex justify-between"><span>Kas Penagih (1102)</span><span>{formatIDR(cashCustody)}</span></div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Piutang & Utang Usaha</div>
          <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-slate-900">{formatIDR(arBalance)}</div>
          <div className="text-[11px] text-slate-500">Piutang Usaha (GL 1104)</div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-xs">
            <span className="text-slate-600">Utang Pemasok (2101)</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">{formatIDR(apBalance)}</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Kinerja Periode ({formatDateID(statements.startDate)} – {formatDateID(statements.endDate)})</div>
          <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-slate-900">
            {formatIDR(statements.incomeStatement.netRevenue)}
          </div>
          <div className="text-[11px] text-slate-500">Pendapatan Neto (Posted)</div>
          {canSeeCogs ? (
            <div className="mt-2 pt-2 border-t border-slate-100 space-y-0.5 text-xs font-mono tabular-nums">
              <div className="flex justify-between text-slate-600"><span>HPP</span><span>{formatIDR(statements.incomeStatement.cogs)}</span></div>
              <div className="flex justify-between font-semibold text-slate-900"><span>Hasil Periode</span><span>{formatIDR(statements.incomeStatement.netProfit)}</span></div>
            </div>
          ) : (
            <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">Detail HPP & biaya dibatasi sesuai peran.</div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Antrean Mesin Pembukuan</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono tabular-nums text-slate-900">{queuedCount + failedCount}</span>
            <span className="text-xs text-slate-500">event belum terposting</span>
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600">Menunggu proses</span>
              <span className="font-mono tabular-nums text-amber-700 font-medium">{queuedCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Ditahan (HPP / Error)</span>
              <span className="font-mono tabular-nums text-rose-700 font-medium">{failedCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Draft jurnal butuh review</span>
              <span className="font-mono tabular-nums text-slate-800 font-medium">{draftJournals}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Control Tie-Out & Recent Journals */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Tie-Out Akun Kontrol GL vs Subledger</h3>
            <span className="text-xs text-slate-500">Per {formatDateID(statements.asOfDate)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 font-medium">Akun Kontrol</th>
                  <th className="py-2 font-medium text-right">Saldo GL</th>
                  <th className="py-2 font-medium text-right">Subledger</th>
                  <th className="py-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statements.tieOuts.map((t) => (
                  <tr key={t.coaCode}>
                    <td className="py-2.5">
                      <div className="font-medium text-slate-900">{t.label}</div>
                      <div className="font-mono text-[11px] text-slate-500">COA {t.coaCode}</div>
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums">{formatIDR(t.glBalance)}</td>
                    <td className="py-2.5 text-right font-mono tabular-nums">{formatIDR(t.subledgerBalance)}</td>
                    <td className="py-2.5 text-right">
                      {t.isMatched ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Cocok
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                          <AlertTriangle className="h-3.5 w-3.5" /> Selisih {formatIDR(t.difference)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Jurnal Terbaru (Klik untuk Telusuri Sumber)</h3>
            <button
              type="button"
              onClick={() => onNavigate('jurnal')}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800"
            >
              Semua Jurnal <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 font-medium">Nomor & Tanggal</th>
                  <th className="py-2 font-medium">Keterangan</th>
                  <th className="py-2 font-medium text-right">Nominal</th>
                  <th className="py-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dataset.journals.slice(0, 6).map((j) => (
                  <tr
                    key={j.id}
                    onClick={() => onSelectJournal(j)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="py-2.5">
                      <div className="font-mono font-medium text-teal-800">{j.journal_number}</div>
                      <div className="font-mono text-[11px] text-slate-500">{formatDateID(j.accounting_date)}</div>
                    </td>
                    <td className="py-2.5 max-w-xs truncate text-slate-800">{j.description}</td>
                    <td className="py-2.5 text-right font-mono tabular-nums font-medium text-slate-900">{formatIDR(j.total_debit)}</td>
                    <td className="py-2.5 text-right">
                      <span className={j.status === 'posted' ? 'text-emerald-700 font-medium' : j.status === 'reversed' ? 'text-rose-700' : 'text-amber-700 font-medium'}>
                        {j.status === 'posted' ? 'Posted' : j.status === 'reversed' ? 'Reversed' : 'Draft'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

interface AntrianPembukuanViewProps {
  dataset: LedgerDataset;
  roles: RoleCode[];
  onProcessEvent: (eventId: string, mode: 'default' | 'posted') => void;
  onProcessAllQueue: () => void;
  onSelectJournal: (j: JournalEntry) => void;
}

export const AntrianPembukuanView: React.FC<AntrianPembukuanViewProps> = ({
  dataset,
  roles,
  onProcessEvent,
  onProcessAllQueue,
  onSelectJournal,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedEvent, setSelectedEvent] = useState<AccountingEvent | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canProcess = roles.some((r) => ['accountant', 'accounting_approver', 'system_admin'].includes(r));
  const canForcePost = roles.includes('accounting_approver');

  const filtered = dataset.events.filter((e) =>
    statusFilter === 'ALL' ? true : e.processing_status === statusFilter
  );

  const pendingCount = dataset.events.filter((e) =>
    ['waiting_accounting_module', 'queued', 'failed'].includes(e.processing_status)
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Clock className="h-4 w-4 text-amber-600" />
            <span>
              {dataset.policy.worker_configured
                ? 'Worker Terjadwal Aktif — Event App 1 & App 2 Diproses Otomatis'
                : 'Antrean menunggu pemrosesan — Worker terjadwal belum diaktifkan di server ini'}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Semua pemrosesan memanggil mesin terpusat <code className="font-mono">post_accounting_event</code> yang sama (idempoten, cek dependensi, lock periode, dan validasi HPP).
            Default membentuk <strong>Draft Jurnal</strong> kecuali auto-post deterministik diaktifkan oleh accounting_approver.
          </p>
        </div>

        {canProcess && (
          <button
            type="button"
            disabled={pendingCount === 0}
            onClick={() => {
              setActionError(null);
              try {
                onProcessAllQueue();
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5" />
            Proses Antrean Sekarang ({pendingCount})
          </button>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {actionError}
        </div>
      )}

      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {[
          { id: 'ALL', label: 'Semua Event' },
          { id: 'waiting_accounting_module', label: 'Menunggu' },
          { id: 'failed', label: 'Ditahan / Gagal' },
          { id: 'draft_journal', label: 'Draft Jurnal' },
          { id: 'posted', label: 'Terposting' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              statusFilter === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Tanggal Efektif</th>
              <th className="px-4 py-3 font-medium">Event & Sumber</th>
              <th className="px-4 py-3 font-medium">Dependensi</th>
              <th className="px-4 py-3 font-medium">Status & Alasan Penahanan</th>
              <th className="px-4 py-3 font-medium text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((ev) => {
              const linkedJournal = dataset.journals.find((j) => j.source_event_id === ev.id);
              const payload = ev.payload_snapshot as Record<string, unknown>;
              const docLabel = String(payload.doc_number ?? payload.receipt_number ?? payload.deposit_number ?? payload.transfer_number ?? ev.source_id.slice(0, 8));
              const amtLabel = String(payload.total_amount ?? payload.verified_amount ?? payload.received_amount ?? payload.amount ?? '0');

              return (
                <tr key={ev.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono tabular-nums align-top">
                    <div>{formatDateID(ev.effective_date)}</div>
                    <div className="text-[11px] text-slate-400">v{ev.source_version}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-slate-900">{ev.event_type}</div>
                    <div className="text-slate-600 font-mono text-[11px]">
                      {docLabel} · {formatIDR(amtLabel)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedEvent(selectedEvent?.id === ev.id ? null : ev)}
                      className="mt-1 text-[11px] text-teal-700 hover:underline"
                    >
                      {selectedEvent?.id === ev.id ? 'Sembunyikan Snapshot' : 'Lihat Snapshot'}
                    </button>
                    {selectedEvent?.id === ev.id && (
                      <pre className="mt-2 rounded bg-slate-900 p-2 text-[11px] font-mono text-slate-100 overflow-x-auto max-w-md">
                        {JSON.stringify(ev.payload_snapshot, null, 2)}
                      </pre>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-[11px] text-slate-600">
                    {ev.dependency_ids.length === 0 ? '-' : `${ev.dependency_ids.length} event prasyarat`}
                  </td>
                  <td className="px-4 py-3 align-top max-w-sm">
                    <div
                      className={`font-medium ${
                        ev.processing_status === 'posted'
                          ? 'text-emerald-700'
                          : ev.processing_status === 'failed'
                          ? 'text-rose-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {ev.processing_status}
                    </div>
                    {ev.error_message && (
                      <div className="mt-1 text-[11px] text-rose-700 leading-relaxed">{ev.error_message}</div>
                    )}
                    <div className="mt-0.5 text-[11px] text-slate-400">Retry: {ev.retry_count} · {formatDateTimeJKT(ev.created_at)}</div>
                  </td>
                  <td className="px-4 py-3 align-top text-right space-x-2 whitespace-nowrap">
                    {linkedJournal ? (
                      <button
                        type="button"
                        onClick={() => onSelectJournal(linkedJournal)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        Buka {linkedJournal.journal_number}
                      </button>
                    ) : (
                      canProcess && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null);
                              try {
                                onProcessEvent(ev.id, 'default');
                              } catch (err) {
                                setActionError(err instanceof Error ? err.message : String(err));
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Buat Draft
                          </button>
                          {canForcePost && (
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                try {
                                  onProcessEvent(ev.id, 'posted');
                                } catch (err) {
                                  setActionError(err instanceof Error ? err.message : String(err));
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                            >
                              Post Langsung
                            </button>
                          )}
                        </>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
