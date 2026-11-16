import * as XLSX from 'xlsx';
import { formatDateTimeJKT } from './decimal';

export interface ExportMetadata {
  title: string;
  companyName: string;
  branchScope: string;
  dateRangeLabel: string;
  currency: string;
  reportStatus: 'Draft' | 'Final Internal';
  footnotes: string[];
}

export type ExportCell = string | number | null | undefined;

/**
 * Mencegah CSV Formula Injection pada sel teks tanpa merusak angka murni.
 */
export function sanitizeCsvCell(cell: ExportCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? String(cell) : '';
  }
  const str = String(cell);
  const trimmedStart = str.replace(/^\s+/, '');
  const isFormulaRisk =
    trimmedStart.startsWith('=') ||
    trimmedStart.startsWith('+') ||
    trimmedStart.startsWith('-') ||
    trimmedStart.startsWith('@') ||
    str.startsWith('\t') ||
    str.startsWith('\r');

  // Hanya prefix apostrof jika ini benar-benar teks berisiko formula (bukan angka negatif murni)
  const isPureNumeric = /^-?\d+(\.\d+)?$/.test(str.trim());
  const safe = isFormulaRisk && !isPureNumeric ? `'${str}` : str;
  const escaped = safe.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildCSVString(
  meta: ExportMetadata,
  headers: string[],
  rows: ExportCell[][],
  generatedAt: string = formatDateTimeJKT(new Date().toISOString())
): string {
  const lines: string[] = [
    [meta.title].map(sanitizeCsvCell).join(','),
    ['Badan Usaha', meta.companyName, 'Cabang', meta.branchScope].map(sanitizeCsvCell).join(','),
    ['Cakupan Tanggal', meta.dateRangeLabel, 'Mata Uang', meta.currency, 'Status', meta.reportStatus].map(sanitizeCsvCell).join(','),
    ['Waktu Dibuat', generatedAt].map(sanitizeCsvCell).join(','),
    '',
    headers.map(sanitizeCsvCell).join(','),
    ...rows.map((r) => r.map(sanitizeCsvCell).join(',')),
    '',
    ...meta.footnotes.map((fn) => ['Catatan', fn].map(sanitizeCsvCell).join(',')),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadCSV(
  filename: string,
  meta: ExportMetadata,
  headers: string[],
  rows: ExportCell[][]
): void {
  const csvContent = buildCSVString(meta, headers, rows);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function downloadExcel(
  filename: string,
  meta: ExportMetadata,
  headers: string[],
  rows: ExportCell[][]
): void {
  const generatedAt = formatDateTimeJKT(new Date().toISOString());
  const sheetData: ExportCell[][] = [
    [meta.title],
    ['Badan Usaha', meta.companyName, 'Cabang', meta.branchScope],
    ['Cakupan Tanggal', meta.dateRangeLabel, 'Mata Uang', meta.currency, 'Status', meta.reportStatus],
    ['Waktu Dibuat', generatedAt],
    [],
    headers,
    ...rows,
    [],
    ...meta.footnotes.map((fn) => ['Catatan:', fn]),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
