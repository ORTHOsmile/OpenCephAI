import { describe, it, expect } from 'vitest';
import { DECIMALS_KEY, DEFAULT_DECIMALS, fmtDelta, fmtNumber, fmtValue, parseDecimals, readDecimals, UNIT_SUFFIX } from './format';

// Owner ruling DEC-1 (12 Oct, Task 4 fix round 2): every number is DISPLAYED at 0–3 decimals by an operator setting
// kept on this Mac (default 1); plain ratios always show at least 2 (at most 3); never "-0.0". Calculations never
// use the displayed figure. One formatter for the norm text, the measured values and the Change table.

describe('the decimals setting (DEC-1)', () => {
  it('kept on this Mac under one key; default 1', () => {
    expect([DECIMALS_KEY, DEFAULT_DECIMALS]).toEqual(['display_decimals', 1]);
  });
  it("'0'..'3' are read as such; anything else is the default", () => {
    expect(['0', '1', '2', '3'].map(parseDecimals)).toEqual([0, 1, 2, 3]);
    expect([null, undefined, '', '4', '-1', '1.5', 'two', ' 2'].map(parseDecimals)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
  it('read from the settings with the default; a failed read is the default', async () => {
    expect(await readDecimals({ get: async () => '3' })).toBe(3);
    expect(await readDecimals({ get: async () => null })).toBe(1);
    expect(await readDecimals({ get: async () => { throw new Error('SYNTHETIC settings error'); } })).toBe(1);
  });
});

describe('fmtNumber / fmtValue', () => {
  it('degrees, mm and % at the setting, 0 to 3', () => {
    expect([0, 1, 2, 3].map((d) => fmtValue(139.32849, 'deg', d as 0 | 1 | 2 | 3))).toEqual(['139°', '139.3°', '139.33°', '139.328°']);
    expect(fmtValue(-1, 'mm', 1)).toBe('-1.0 mm');
    expect(fmtValue(54.9, '%', 2)).toBe('54.90%');
  });
  it('a plain ratio shows at least 2 decimals and at most 3, whatever the setting', () => {
    expect([0, 1, 2, 3].map((d) => fmtNumber(0.79949, '', d as 0 | 1 | 2 | 3))).toEqual(['0.80', '0.80', '0.80', '0.799']);
  });
  it('a value that rounds to zero never shows "-0.0" (shows 0.0); a real negative keeps its sign', () => {
    expect(fmtNumber(-0.04, 'deg', 1)).toBe('0.0');
    expect(fmtNumber(-0.4, 'deg', 0)).toBe('0');
    expect(fmtNumber(-0.001, '', 1)).toBe('0.00');
    expect(fmtNumber(-0.06, 'deg', 1)).toBe('-0.1');
  });
  it('one suffix per unit', () => expect(UNIT_SUFFIX).toEqual({ deg: '°', mm: ' mm', '%': '%', '': '' }));
});

describe('fmtDelta (Change table): + increased, − decreased, ± no change at the shown precision', () => {
  it('signed differences with units', () => {
    expect(fmtDelta(2.5, 'deg', 1)).toBe('+2.5°');
    expect(fmtDelta(-2, 'mm', 1)).toBe('−2.0 mm');
    expect(fmtDelta(0, 'deg', 1)).toBe('±0.0°');
  });
  it('a difference that rounds to zero reads ±, never "−0.0"', () => {
    expect(fmtDelta(-0.02, 'deg', 1)).toBe('±0.0°');
    expect(fmtDelta(-0.02, 'deg', 2)).toBe('−0.02°');
  });
});
