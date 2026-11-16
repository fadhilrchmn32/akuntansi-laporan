import React, { useState } from 'react';
import { Download, Printer, Lock, Unlock, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { FinancialStatementsResult, LedgerDataset } from '../lib/accountingEngine';
import { D, formatDateID, formatDateTimeJKT, formatIDR } from '../lib/decimal';
import { downloadCSV, downloadExcel, ExportCell } from '../lib/exportUtils';
import { RoleCode } from '../types/finops';

interface LaporanKeuanganViewProps {
  dataset: LedgerDataset;
  statements: FinancialStatementsResult;
  onDrillToLedger: (coaCode: string) => void;
}

export const LaporanKeuanganView: React.FC<LaporanKeuanganViewProps> = ({
  dataset,
  statements,
  onDrillToLedger,
}) => {
  const [activeReport, setActiveReport] = useState<'pnl' | 'bs' | 'cf' | 'equity' | 'incomplete'>('pnl');

  const exportMeta = {
    title:
      activeReport === 'pnl'
        ? 'Laporan Laba Rugi'
        : activeReport === 'bs'
        ? 'Neraca (Posisi Keuangan)'
        : activeReport === 'cf'
        ? 'Laporan Arus Kas (Metode Langsung)'
        : activeReport === 'equity'
        ? 'Laporan Perubahan Ekuitas'
        : 'Laporan Data Awal Belum Lengkap & Gap Kesiapan',
    companyName: dataset.companyName,
    branchScope: statements.branchScopeLabel,
    dateRangeLabel: `${formatDateID(statements.startDate)} s.d. ${formatDateID(statements.endDate)}`,
    currency: 'IDR',
    reportStatus: statements.reportStatus,
    footnotes: [
      ...statements.completenessGaps,
      `Kerangka Pelaporan: ${dataset.policy.reporting_framework_status === 'unconfigured' ? 'Belum ditetapkan' : dataset.policy.reporting_framework_name}`,
      'Laporan internal dari double-entry ledger FINOPS_SHARED_V1; bukan pernyataan laporan auditan.',
    ],
  };

  const buildExportPayload = (): { headers: string[]; rows: ExportCell[][] } => {
    if (activeReport === 'pnl') {
      const rows: ExportCell[][] = [
        ['Penjualan Bruto', '4101', Number(statements.incomeStatement.grossSales)],
        ['Retur & Potongan Penjualan', '4102', -Number(statements.incomeStatement.salesReturnsDiscounts)],
        ['Pendapatan Neto', '', Number(statements.incomeStatement.netRevenue)],
        ['Harga Pokok Penjualan (HPP)', '5101', -Number(statements.incomeStatement.cogs)],
        ['Laba Kotor', '', Number(statements.incomeStatement.grossProfit)],
        ...statements.incomeStatement.operatingExpenses.map((e) => [e.coa_name, e.coa_code, -Number(e.amount)]),
        ['Total Beban Operasional', '', -Number(statements.incomeStatement.totalOperatingExpenses)],
        ['Laba Operasional', '', Number(statements.incomeStatement.operatingProfit)],
        ['Pendapatan Lainnya', '', Number(statements.incomeStatement.otherIncome)],
        ['Beban Lainnya', '', -Number(statements.incomeStatement.otherExpenses)],
        ['Hasil Sebelum Pajak', '', Number(statements.incomeStatement.profitBeforeTax)],
        ['Pajak Penghasilan (Sesuai Data Tercatat)', '6501', -Number(statements.incomeStatement.taxExpense)],
        ['Hasil Periode (Laba/Rugi Neto)', '', Number(statements.incomeStatement.netProfit)],
      ];
      return { headers: ['Pos Laporan', 'Kode Akun', 'Nilai (IDR)'], rows };
    }
    if (activeReport === 'bs') {
      const rows: ExportCell[][] = [
        ['ASET', '', ''],
        ...statements.balanceSheet.assets.map((a) => [a.coa_name, a.coa_code, Number(a.amount)]),
        ['TOTAL ASET', '', Number(statements.balanceSheet.totalAssets)],
        ['KEWAJIBAN', '', ''],
        ...statements.balanceSheet.liabilities.map((l) => [l.coa_name, l.coa_code, Number(l.amount)]),
        ['Total Kewajiban', '', Number(statements.balanceSheet.totalLiabilities)],
        ['EKUITAS', '', ''],
        ...statements.balanceSheet.equityItems.map((e) => [e.coa_name, e.coa_code, Number(e.amount)]),
        ['Laba/Rugi Periode Berjalan (Belum Ditutup)', '', Number(statements.balanceSheet.currentPeriodEarnings)],
        ['Total Ekuitas', '', Number(statements.balanceSheet.totalEquity)],
        ['TOTAL KEWAJIBAN + EKUITAS', '', Number(statements.balanceSheet.totalLiabilitiesAndEquity)],
      ];
      return { headers: ['Akun / Pos Neraca', 'Kode Akun', 'Saldo Per Tanggal (IDR)'], rows };
    }
    if (activeReport === 'cf') {
      const rows: ExportCell[][] = [
        ['Saldo Awal Komponen Kas Disahkan', Number(statements.cashFlowDirect.openingCash)],
        ...statements.cashFlowDirect.operatingLines.map((l) => [`Operasi: ${l.label}`, Number(l.amount)]),
        ['Arus Kas Bersih Operasi', Number(statements.cashFlowDirect.netOperating)],
        ...statements.cashFlowDirect.investingLines.map((l) => [`Investasi: ${l.label}`, Number(l.amount)]),
        ['Arus Kas Bersih Investasi', Number(statements.cashFlowDirect.netInvesting)],
        ...statements.cashFlowDirect.financingLines.map((l) => [`Pendanaan: ${l.label}`, Number(l.amount)]),
        ['Arus Kas Bersih Pendanaan', Number(statements.cashFlowDirect.netFinancing)],
        ['Kas Masuk Belum Terklasifikasi', Number(statements.cashFlowDirect.unclassifiedAmount)],
        ['Kenaikan (Penurunan) Bersih Kas', Number(statements.cashFlowDirect.netCashChange)],
        ['Saldo Akhir Kas (Roll-Forward)', Number(statements.cashFlowDirect.closingCashComputed)],
        ['Saldo Akhir Kas di Neraca', Number(statements.cashFlowDirect.closingCashBalanceSheet)],
      ];
      return { headers: ['Aktivitas Arus Kas (Metode Langsung)', 'Nilai (IDR)'], rows };
    }
    return {
      headers: ['Komponen Perubahan Ekuitas', 'Nilai (IDR)'],
      rows: [
        ['Ekuitas Awal Periode', Number(statements.equityChanges.openingEquity)],
        ['Setoran Modal', Number(statements.equityChanges.capitalInjections)],
        ['Laba / Rugi Periode', Number(statements.equityChanges.periodNetProfit)],
        ['Prive / Distribusi', -Number(statements.equityChanges.ownerDrawings)],
        ['Ekuitas Akhir Periode', Number(statements.equityChanges.closingEquity)],
      ],
    };
  };

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {[
            { id: 'pnl', label: 'Laba Rugi' },
            { id: 'bs', label: 'Neraca' },
            { id: 'cf', label: 'Arus Kas (Langsung)' },
            { id: 'equity', label: 'Perubahan Ekuitas' },
            { id: 'incomplete', label: `Data Awal & Gap (${statements.completenessGaps.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveReport(tab.id as typeof activeReport)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                activeReport === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const { headers, rows } = buildExportPayload();
              downloadCSV(`laporan-${activeReport}-${statements.asOfDate}`, exportMeta, headers, rows);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" /> Ekspor CSV
          </button>
          <button
            type="button"
            onClick={() => {
              const { headers, rows } = buildExportPayload();
              downloadExcel(`laporan-${activeReport}-${statements.asOfDate}`, exportMeta, headers, rows);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Ekspor Excel (.xlsx)
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Printer className="h-3.5 w-3.5" /> Cetak / PDF
          </button>
        </div>
      </div>

      {/* Printable Report Sheet */}
      <div className="print-container rounded-lg border border-slate-200 bg-white p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs text-slate-500">{dataset.companyName} · {statements.branchScopeLabel}</div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{exportMeta.title}</h2>
            <div className="mt-1 text-xs text-slate-600">
              Periode: {exportMeta.dateRangeLabel} · Mata Uang: IDR · Basis: Akrual Double-Entry (Posted)
            </div>
          </div>
          <div className="text-right text-xs">
            <span
              className={`inline-block rounded px-2.5 py-1 font-semibold ${
                statements.reportStatus === 'Final Internal'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              Status: {statements.reportStatus}
            </span>
            <div className="mt-1 text-[11px] text-slate-500">Dibuat: {formatDateTimeJKT(new Date().toISOString())}</div>
          </div>
        </div>

        {activeReport === 'pnl' && (
          <div className="space-y-4">
            {dataset.policy.is_midyear_cutover && (
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                Cakupan cutover tengah tahun sejak {formatDateID(dataset.policy.cutover_date)}: laporan hanya mencerminkan transaksi sejak tanggal cutover dan tidak diklaim sebagai laporan setahun penuh tanpa data historis tervalidasi.
              </div>
            )}
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                <tr className="cursor-pointer hover:bg-slate-50" onClick={() => onDrillToLedger('4101')}>
                  <td className="py-2.5 text-slate-800">Penjualan Bruto (4101)</td>
                  <td className="py-2.5 text-right font-mono tabular-nums">{formatIDR(statements.incomeStatement.grossSales)}</td>
                </tr>
                <tr className="cursor-pointer hover:bg-slate-50" onClick={() => onDrillToLedger('4102')}>
                  <td className="py-2.5 text-slate-800">Retur & Potongan Penjualan (4102)</td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-rose-700">({formatIDR(statements.incomeStatement.salesReturnsDiscounts)})</td>
                </tr>
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2.5 px-2">Pendapatan Neto</td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums">{formatIDR(statements.incomeStatement.netRevenue)}</td>
                </tr>
                <tr className="cursor-pointer hover:bg-slate-50" onClick={() => onDrillToLedger('5101')}>
                  <td className="py-2.5 text-slate-800">Harga Pokok Penjualan / HPP (5101)</td>
                  <td className="py-2.5 text-right font-mono tabular-nums text-rose-700">({formatIDR(statements.incomeStatement.cogs)})</td>
                </tr>
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2.5 px-2">Laba Kotor</td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums">{formatIDR(statements.incomeStatement.grossProfit)}</td>
                </tr>
                {statements.incomeStatement.operatingExpenses.map((e) => (
                  <tr key={e.coa_code} className="cursor-pointer hover:bg-slate-50" onClick={() => onDrillToLedger(e.coa_code)}>
                    <td className="py-2 text-slate-700 pl-4">{e.coa_code} — {e.coa_name}</td>
                    <td className="py-2 text-right font-mono tabular-nums">({formatIDR(e.amount)})</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2.5">Total Beban Operasional & Penyusutan</td>
                  <td className="py-2.5 text-right font-mono tabular-nums">({formatIDR(statements.incomeStatement.totalOperatingExpenses)})</td>
                </tr>
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2.5 px-2">Laba / Rugi Operasional</td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums">{formatIDR(statements.incomeStatement.operatingProfit)}</td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-700">Pendapatan / (Beban) Lain-lain Neto</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatIDR(D(statements.incomeStatement.otherIncome).minus(D(statements.incomeStatement.otherExpenses)).toFixed(2))}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-700">Hasil Sebelum Pajak</td>
                  <td className="py-2 text-right font-mono tabular-nums font-medium">{formatIDR(statements.incomeStatement.profitBeforeTax)}</td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-700">
                    Pajak Penghasilan {dataset.policy.tax_policy_status === 'unconfigured' ? '(Kebijakan pajak belum ditetapkan)' : ''}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{formatIDR(statements.incomeStatement.taxExpense)}</td>
                </tr>
                <tr className="border-t-2 border-slate-900 font-bold text-sm">
                  <td className="py-3">Hasil Periode (Laba/Rugi Neto)</td>
                  <td className="py-3 text-right font-mono tabular-nums text-teal-800">{formatIDR(statements.incomeStatement.netProfit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {activeReport === 'bs' && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-2">ASET</h3>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  {statements.balanceSheet.assets.map((a) => (
                    <tr key={a.coa_code} className="cursor-pointer hover:bg-slate-50" onClick={() => onDrillToLedger(a.coa_code)}>
                      <td className="py-2 text-slate-800"><span className="font-mono text-teal-800 mr-2">{a.coa_code}</span>{a.coa_name}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{formatIDR(a.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-900 font-bold">
                    <td className="py-3">TOTAL ASET</td>
                    <td className="py-3 text-right font-mono tabular-nums">{formatIDR(statements.balanceSheet.totalAssets)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-2">KEWAJIBAN & EKUITAS</h3>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  {statements.balanceSheet.liabilities.map((l) => (
                    <tr key={l.coa_code} className="cursor-pointer hover:bg-slate-50" onClick={() => onDrillToLedger(l.coa_code)}>
                      <td className="py-2 text-slate-800"><span className="font-mono text-teal-800 mr-2">{l.coa_code}</span>{l.coa_name}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{formatIDR(l.amount)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="py-2 px-1">Total Kewajiban</td>
                    <td className="py-2 px-1 text-right font-mono tabular-nums">{formatIDR(statements.balanceSheet.totalLiabilities)}</td>
                  </tr>
                  {statements.balanceSheet.equityItems.map((e) => (
                    <tr key={e.coa_code} className="cursor-pointer hover:bg-slate-50" onClick={() => onDrillToLedger(e.coa_code)}>
                      <td className="py-2 text-slate-800"><span className="font-mono text-teal-800 mr-2">{e.coa_code}</span>{e.coa_name}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{formatIDR(e.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 text-slate-800">Laba/Rugi Berjalan (Belum Ditutup ke Saldo Laba)</td>
                    <td className="py-2 text-right font-mono tabular-nums">{formatIDR(statements.balanceSheet.currentPeriodEarnings)}</td>
                  </tr>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="py-2 px-1">Total Ekuitas</td>
                    <td className="py-2 px-1 text-right font-mono tabular-nums">{formatIDR(statements.balanceSheet.totalEquity)}</td>
                  </tr>
                  <tr className="border-t-2 border-slate-900 font-bold">
                    <td className="py-3">TOTAL KEWAJIBAN + EKUITAS</td>
                    <td className="py-3 text-right font-mono tabular-nums">{formatIDR(statements.balanceSheet.totalLiabilitiesAndEquity)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeReport === 'cf' && (
          <div className="space-y-4">
            {statements.cashFlowDirect.cashFlowHeldForUnclassified && (
              <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <strong>Arus Kas Final Ditahan:</strong> Terdapat penerimaan kas belum teridentifikasi sebesar{' '}
                <span className="font-mono font-semibold">{formatIDR(statements.cashFlowDirect.unclassifiedAmount)}</span> melebihi batas materialitas. Selesaikan identifikasi sebelum finalisasi.
              </div>
            )}
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2.5 px-2">Saldo Awal Komponen Kas Disahkan (Kas Kantor + Bank + Kas Penagih)</td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums">{formatIDR(statements.cashFlowDirect.openingCash)}</td>
                </tr>
                {statements.cashFlowDirect.operatingLines.map((l, i) => (
                  <tr key={i}><td className="py-2 pl-4">{l.label}</td><td className="py-2 text-right font-mono tabular-nums">{formatIDR(l.amount)}</td></tr>
                ))}
                <tr className="font-semibold"><td className="py-2">Arus Kas Bersih Aktivitas Operasi</td><td className="py-2 text-right font-mono tabular-nums">{formatIDR(statements.cashFlowDirect.netOperating)}</td></tr>
                {statements.cashFlowDirect.investingLines.map((l, i) => (
                  <tr key={i}><td className="py-2 pl-4">{l.label}</td><td className="py-2 text-right font-mono tabular-nums">{formatIDR(l.amount)}</td></tr>
                ))}
                <tr className="font-semibold"><td className="py-2">Arus Kas Bersih Aktivitas Investasi</td><td className="py-2 text-right font-mono tabular-nums">{formatIDR(statements.cashFlowDirect.netInvesting)}</td></tr>
                {statements.cashFlowDirect.financingLines.map((l, i) => (
                  <tr key={i}><td className="py-2 pl-4">{l.label}</td><td className="py-2 text-right font-mono tabular-nums">{formatIDR(l.amount)}</td></tr>
                ))}
                <tr className="font-semibold"><td className="py-2">Arus Kas Bersih Aktivitas Pendanaan</td><td className="py-2 text-right font-mono tabular-nums">{formatIDR(statements.cashFlowDirect.netFinancing)}</td></tr>
                <tr><td className="py-2 text-amber-800">Kas Masuk Belum Terklasifikasi (Antrean Identifikasi)</td><td className="py-2 text-right font-mono tabular-nums">{formatIDR(statements.cashFlowDirect.unclassifiedAmount)}</td></tr>
                <tr className="border-t-2 border-slate-900 font-bold">
                  <td className="py-3">Saldo Akhir Kas (Roll-Forward) — Cocok dengan Neraca ({formatIDR(statements.cashFlowDirect.closingCashBalanceSheet)})</td>
                  <td className="py-3 text-right font-mono tabular-nums text-teal-800">{formatIDR(statements.cashFlowDirect.closingCashComputed)}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-[11px] text-slate-500">
              Catatan: Setoran penagih ke kantor/bank (internal_transfer), alokasi titipan ke AR, penyusutan, dan penjualan kredit (non_cash) dikecualikan agar tidak menggandakan arus kas operasi.
            </p>
          </div>
        )}

        {activeReport === 'equity' && (
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              <tr><td className="py-2.5">Saldo Ekuitas Awal Periode</td><td className="py-2.5 text-right font-mono tabular-nums">{formatIDR(statements.equityChanges.openingEquity)}</td></tr>
              <tr><td className="py-2.5">Setoran Modal Disetor (3101)</td><td className="py-2.5 text-right font-mono tabular-nums">{formatIDR(statements.equityChanges.capitalInjections)}</td></tr>
              <tr><td className="py-2.5">Laba / (Rugi) Neto Periode</td><td className="py-2.5 text-right font-mono tabular-nums">{formatIDR(statements.equityChanges.periodNetProfit)}</td></tr>
              <tr><td className="py-2.5">Prive / Distribusi Pemilik (3103)</td><td className="py-2.5 text-right font-mono tabular-nums text-rose-700">({formatIDR(statements.equityChanges.ownerDrawings)})</td></tr>
              <tr className="border-t-2 border-slate-900 font-bold">
                <td className="py-3">Saldo Ekuitas Akhir Periode (Cocok dengan Neraca: {statements.equityChanges.reconcilesWithBalanceSheet ? 'Ya' : 'Tidak'})</td>
                <td className="py-3 text-right font-mono tabular-nums">{formatIDR(statements.equityChanges.closingEquity)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {activeReport === 'incomplete' && (
          <div className="space-y-3 text-xs">
            {statements.completenessGaps.length === 0 ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                Tidak ada gap data awal atau dokumen tertahan pada tanggal cut-off yang dipilih.
              </div>
            ) : (
              statements.completenessGaps.map((g, i) => (
                <div key={i} className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  {i + 1}. {g}
                </div>
              ))
            )}
          </div>
        )}

        <div className="border-t border-slate-200 pt-4 text-[11px] text-slate-500 space-y-1">
          <div className="font-semibold text-slate-700">Catatan Kaki & Kepatuhan:</div>
          {exportMeta.footnotes.map((fn, idx) => (
            <div key={idx}>• {fn}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface TutupBukuViewProps {
  dataset: LedgerDataset;
  statements: FinancialStatementsResult;
  roles: RoleCode[];
  currentUserId: string;
  onClosePeriod: (periodId: string) => void;
  onReopenPeriod: (periodId: string, reason: string) => void;
  onCreateSnapshot: (periodCode: string) => void;
}

export const TutupBukuView: React.FC<TutupBukuViewProps> = ({
  dataset,
  statements,
  roles,
  currentUserId,
  onClosePeriod,
  onReopenPeriod,
  onCreateSnapshot,
}) => {
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const canApproveClose = roles.includes('accounting_approver');

  const negativeStockCount = dataset.inventoryValuations.filter((v) => D(v.qty_on_hand).lt(0)).length;
  const allTieMatched = statements.tieOuts.every((t) => t.isMatched);

  const checklist = [
    { label: '1. Opening GL & Subledger Disetujui & Cocok', ok: dataset.policy.opening_status === 'approved' },
    { label: '2. Semua Event Periode Selesai Diproses (Tanpa Event Tertahan/Gagal)', ok: statements.unpostedEventsCount === 0 },
    { label: '3. Neraca Saldo Seimbang (Total Debit = Kredit)', ok: statements.trialBalanceTotals.isBalanced },
    { label: '4. Rekonsiliasi Bank & Custody Penagih Dipertanggungjawabkan', ok: dataset.bankReconciliations.some((b) => b.status === 'approved') || dataset.bankReconciliations.length === 0 },
    { label: '5. Tie-Out AR / AP / Titipan / Custody / Persediaan Cocok', ok: allTieMatched },
    { label: '6. HPP Lengkap & Tidak Ada Stok Negatif', ok: statements.failedCogsCount === 0 && negativeStockCount === 0 },
    { label: '7. Klasifikasi Arus Kas & Pajak Diperiksa', ok: !statements.cashFlowDirect.cashFlowHeldForUnclassified },
    { label: '8. Persamaan Neraca (Aset = Kewajiban + Ekuitas) & Roll-Forward Kas Cocok', ok: statements.balanceSheet.isBalanced && statements.cashFlowDirect.reconcilesWithBalanceSheet },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Checklist Integritas Sebelum Tutup Buku (Section I)</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
          {checklist.map((item, i) => (
            <div key={i} className={`flex items-center justify-between rounded border px-3 py-2 ${item.ok ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900' : 'border-amber-200 bg-amber-50/60 text-amber-900'}`}>
              <span>{item.label}</span>
              {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{err}</div>}

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Periode Fiskal</th>
              <th className="px-4 py-3 font-medium">Rentang Tanggal</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Riwayat Tutup / Buka Ulang</th>
              <th className="px-4 py-3 font-medium text-right">Aksi Berizin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dataset.fiscalPeriods.map((fp) => (
              <tr key={fp.id}>
                <td className="px-4 py-3 font-mono font-semibold text-slate-900">{fp.period_code}</td>
                <td className="px-4 py-3 font-mono">{formatDateID(fp.start_date)} – {formatDateID(fp.end_date)}</td>
                <td className="px-4 py-3">
                  <span className={fp.status === 'open' ? 'text-emerald-700 font-medium' : 'text-slate-700 font-medium'}>
                    {fp.status === 'open' ? 'Terbuka (Open)' : 'Terkunci (Closed)'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {fp.closed_at && <div>Ditutup: {formatDateTimeJKT(fp.closed_at)}</div>}
                  {fp.reopen_reason && <div className="text-amber-700">Dibuka ulang: {fp.reopen_reason}</div>}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    type="button"
                    onClick={() => onCreateSnapshot(fp.period_code)}
                    className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Simpan Snapshot
                  </button>
                  {fp.status === 'open' && canApproveClose && (
                    <button
                      type="button"
                      onClick={() => {
                        setErr(null);
                        try {
                          onClosePeriod(fp.id);
                        } catch (e) {
                          setErr(e instanceof Error ? e.message : String(e));
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <Lock className="h-3 w-3" /> Tutup Periode
                    </button>
                  )}
                  {fp.status === 'closed' && canApproveClose && fp.closed_by !== currentUserId && (
                    <button
                      type="button"
                      onClick={() => setReopenId(fp.id)}
                      className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    >
                      <Unlock className="h-3 w-3" /> Buka Ulang
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reopenId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3 text-xs">
          <div className="font-semibold text-amber-900">Buka Ulang Periode Terkunci (Menandai Snapshot Lama sebagai Superseded)</div>
          <input
            type="text"
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            placeholder="Alasan audit pembukaan ulang periode (min 10 karakter)..."
            className="w-full rounded border border-amber-300 bg-white px-3 py-2"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setReopenId(null)} className="rounded border border-slate-300 bg-white px-3 py-1.5">Batal</button>
            <button
              type="button"
              onClick={() => {
                setErr(null);
                try {
                  onReopenPeriod(reopenId, reopenReason);
                  setReopenId(null);
                  setReopenReason('');
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              }}
              className="rounded bg-amber-700 px-3 py-1.5 font-medium text-white hover:bg-amber-800"
            >
              Konfirmasi Buka Ulang
            </button>
          </div>
        </div>
      )}

      {dataset.reportSnapshots.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Arsip Snapshot Laporan (Versi Tidak Pernah Dihapus)</h3>
          <div className="space-y-2 text-xs">
            {dataset.reportSnapshots.map((sn) => (
              <div key={sn.id} className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <span className="font-mono font-medium">{sn.period_code} v{sn.snapshot_version}</span> · {formatDateTimeJKT(sn.created_at)}
                </div>
                <div className="flex items-center gap-4 font-mono">
                  <span>Aset: {formatIDR(sn.summary_totals.totalAssets)}</span>
                  <span>Laba: {formatIDR(sn.summary_totals.netProfit)}</span>
                  <span className={sn.snapshot_status === 'superseded' ? 'text-amber-700 font-sans font-medium' : 'text-emerald-700 font-sans font-medium'}>
                    {sn.snapshot_status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
