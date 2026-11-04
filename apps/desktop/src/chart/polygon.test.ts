import { describe, it, expect } from 'vitest';
import { tickLabels, ticks, xOf, SPAN } from './polygon';

// Owner CHART-TAB-1 (16 Oct): each row is drawn in SD units around its norm's mean, ±3 SD across the cell.
describe('polygon geometry', () => {
  it('the mean is the middle; each SD is a sixth of the width; beyond 3 SD sits at the edge, marked', () => {
    expect(SPAN).toBe(3);
    expect(xOf(0, 120)).toEqual({ x: 60, off: 0 });
    expect(xOf(1, 120)).toEqual({ x: 80, off: 0 });
    expect(xOf(-3, 120)).toEqual({ x: 0, off: 0 });
    expect(xOf(4.2, 120)).toEqual({ x: 120, off: 1 });
    expect(xOf(-9, 120)).toEqual({ x: 0, off: -1 });
  });
  it('tick values: mean and ±2 SD in the row\'s own units', () => {
    expect(ticks(82, 3.5)).toEqual([75, 82, 89]);
  });
  // Review I-1 (16 Oct): tick numbers at the operator's decimals, never rounded off their marks (ANB 2.0 ± 1.2).
  it('tick labels: -0.4 · 2 · 4.4 for 2.0 ± 1.2 at 1 decimal, not 0 · 2 · 4', () => {
    expect(ticks(2, 1.2).map((t) => Number(t.toFixed(6)))).toEqual([-0.4, 2, 4.4]);
    expect(tickLabels(2, 1.2, 'deg', 1)).toEqual(['-0.4', '2.0', '4.4']);   // the app's own number format (fmtNumber)
    expect(tickLabels(82, 3.5, 'deg', 1)).toEqual(['75.0', '82.0', '89.0']);
  });
});
