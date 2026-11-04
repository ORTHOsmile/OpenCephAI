import type { Unit } from '@ceph/geometry';
import type { settings } from './ipc';

/** Owner ruling DEC-1 (12 Oct, Task 4 fix round 2): how many decimals numbers are SHOWN with — 0 to 3, chosen by the
 *  operator, kept on this Mac (like the analyses choice, ANALYSES-1; the Settings control is Part D Task 10).
 *  Display only: every calculation (z-score, colour, comparisons) uses the full figures, never these. */
export type Decimals = 0 | 1 | 2 | 3;
export const DECIMALS_KEY = 'display_decimals';
export const DEFAULT_DECIMALS: Decimals = 1;
export const parseDecimals = (v: string | null | undefined): Decimals =>
  v === '0' ? 0 : v === '1' ? 1 : v === '2' ? 2 : v === '3' ? 3 : DEFAULT_DECIMALS;
/** The setting, read with its default; a failed read is the default (it changes only how numbers look). */
export async function readDecimals(s: Pick<typeof settings, 'get'>): Promise<Decimals> {
  try {
    return parseDecimals(await s.get(DECIMALS_KEY));
  } catch {
    return DEFAULT_DECIMALS;
  }
}

/** The suffix after a number of each unit; the one copy (Task 4 review M-4). */
export const UNIT_SUFFIX: Record<Unit, string> = { deg: '°', mm: ' mm', '%': '%', '': '' };

/** The decimals actually shown: the setting; a plain ratio (unit '') at least 2 and at most 3 (DEC-1). */
export const shownDecimals = (unit: Unit, d: Decimals): number => (unit === '' ? Math.min(3, Math.max(2, d)) : d);

/** A number as shown (no unit). A value that rounds to zero never shows a minus sign ("0.0", never "-0.0"). */
export function fmtNumber(x: number, unit: Unit, d: Decimals): string {
  const s = x.toFixed(shownDecimals(unit, d));
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}
/** A number with its unit: measured values, norm values, the Change table. */
export const fmtValue = (x: number, unit: Unit, d: Decimals) => fmtNumber(x, unit, d) + UNIT_SUFFIX[unit];
/** Later − earlier in the Change table: + increased, − decreased, ± no change at the shown precision. */
export function fmtDelta(x: number, unit: Unit, d: Decimals): string {
  const shown = fmtNumber(Math.abs(x), unit, d);
  const zero = Number(shown) === 0;
  return (zero ? '±' : x > 0 ? '+' : '−') + shown + UNIT_SUFFIX[unit];
}
