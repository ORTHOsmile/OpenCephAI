import type { Unit } from '@ceph/geometry';
import { fmtNumber, type Decimals } from '../format';

/** Owner CHART-TAB-1 (16 Oct 2026): the polygon chart's geometry. Each row is drawn in SD units around its norm's mean,
 *  ±SPAN SD across the cell, so the norm is one straight vertical line and every row lines up. */
export const SPAN = 3;

/** Where a z sits across a cell `width` wide; a z beyond ±SPAN is drawn at the edge, with `off` saying which. */
export function xOf(z: number, width: number): { x: number; off: -1 | 0 | 1 } {
  const c = Math.max(-SPAN, Math.min(SPAN, z));
  return { x: width / 2 + (c * width) / (2 * SPAN), off: z > SPAN ? 1 : z < -SPAN ? -1 : 0 };
}

/** The tick values printed on a row's scale, in the row's own units: the mean and ±2 SD. */
export const ticks = (mean: number, sd: number): number[] => [mean - 2 * sd, mean, mean + 2 * sd];

/** The tick labels, at the operator's decimals setting through the app's one number formatter (review I-1: rounding
 *  them to whole units put "4" on a mark that is really 4.4). */
export const tickLabels = (mean: number, sd: number, unit: Unit, d: Decimals): string[] => ticks(mean, sd).map((t) => fmtNumber(t, unit, d));
