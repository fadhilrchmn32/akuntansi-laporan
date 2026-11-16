import Decimal from 'decimal.js';

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
});

export function D(val: string | number | Decimal | null | undefined): Decimal {
  if (val === null || val === undefined || val === '') return new Decimal(0);
  return new Decimal(val);
}

export function roundMoney(val: string | number | Decimal, scale = 0): string {
  return D(val).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function roundQty(val: string | number | Decimal): string {
  return D(val).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

export function addMoney(a: string | number | Decimal, b: string | number | Decimal): string {
  return D(a).plus(D(b)).toFixed(2);
}

export function subMoney(a: string | number | Decimal, b: string | number | Decimal): string {
  return D(a).minus(D(b)).toFixed(2);
}

export function sumMoney(values: Array<string | number | Decimal>): string {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0)).toFixed(2);
}

export function cmpMoney(a: string | number | Decimal, b: string | number | Decimal): number {
  return D(a).comparedTo(D(b));
}

export function formatIDR(val: string | number | Decimal | null | undefined, showDecimals = false): string {
  const num = D(val).toNumber();
  const abs = Math.abs(num);
  const formatted = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(abs);
  return num < 0 ? `(Rp ${formatted})` : `Rp ${formatted}`;
}

export function formatNumber(val: string | number | Decimal | null | undefined, decimals = 0): string {
  const num = D(val).toNumber();
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatDateID(isoDate: string | null | undefined): string {
  if (!isoDate) return '-';
  const clean = isoDate.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatDateTimeJKT(isoTs: string | null | undefined): string {
  if (!isoTs) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(isoTs)) + ' WIB';
  } catch {
    return isoTs;
  }
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso.slice(0, 10) + 'T00:00:00Z').getTime();
  const b = new Date(toIso.slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.floor((b - a) / 86400000);
}
