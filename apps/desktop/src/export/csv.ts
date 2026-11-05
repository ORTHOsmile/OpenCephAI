/** CSV for Excel (spec 2026-10-17 report-exports; master plan §8): RFC 4180, UTF-8 with a byte-order mark, CRLF line
 *  ends, '.' decimals, numbers at full precision. */
export const BOM = '﻿';
export type Cell = string | number | null;
export interface Column<R> { name: string; get: (r: R) => Cell; text?: boolean }

/** Excel runs a cell starting with = + - @ (or a tab or CR) as a formula, and a typed word or name could start that
 *  way. In text columns only (a negative number keeps its minus) it gets an apostrophe, which Excel shows as text. */
export const guardFormula = (s: string): string => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function field(v: Cell, text = false): string {
  if (v === null) return '';
  let s: string;
  if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else s = text ? guardFormula(v) : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<R>(columns: Column<R>[], rows: R[]): string {
  const lines = [columns.map((c) => field(c.name)).join(','), ...rows.map((r) => columns.map((c) => field(c.get(r), c.text)).join(','))];
  return BOM + lines.join('\r\n') + '\r\n';
}

export const csvBytes = (csv: string): Uint8Array => new TextEncoder().encode(csv);
