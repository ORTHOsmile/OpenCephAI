import { describe, it, expect } from 'vitest';
import type { AnalysisDef, Value } from '@ceph/geometry';
import { autoStage, changeOf, looks, orderSeries, pairs, pickPair, seriesRows, stageOf } from './series';

type F = { timepoint: string; takenOn: string | null; takenOnSource: 'label' | 'image' | 'import' | 'manual' | null; createdAt: string };
const f = (timepoint: string, takenOn: string | null, takenOnSource: F['takenOnSource'], createdAt: string): F => ({ timepoint, takenOn, takenOnSource, createdAt });
const tps = (xs: F[]) => orderSeries(xs).map((x) => x.timepoint);

describe('orderSeries (spec 2026-09-30: one rule for the whole list)', () => {
  it('orders by film date when every film has a real one', () => {
    expect(tps([f('T2', '2026-03-02', 'label', '2026-09-30T01:00:00Z'), f('T1', '2024-03-02', 'manual', '2026-09-30T02:00:00Z'),
      f('T3', '2025-03-02', 'image', '2026-09-30T03:00:00Z')])).toEqual(['T1', 'T3', 'T2']);
  });
  it('same film date: T-number, then import time', () => {
    expect(tps([f('T2', '2026-03-02', 'label', 'a'), f('T1', '2026-03-02', 'label', 'b')])).toEqual(['T1', 'T2']);
  });
  it('any import-dated film: T-number order, named timepoints after, by import time', () => {
    expect(tps([f('Post', '2026-09-30', 'import', '2026-09-30T05:00:00Z'), f('T2', '2026-03-02', 'label', '2026-09-30T01:00:00Z'),
      f('T1', '2026-09-30', 'import', '2026-09-30T02:00:00Z'), f('Pre', '2026-09-30', 'import', '2026-09-30T04:00:00Z')]))
      .toEqual(['T1', 'T2', 'Pre', 'Post']);
  });
  it('mixed dates never loops: the result does not depend on the input order', () => {
    const a = f('T1', '2025-01-01', 'label', '1'), b = f('T2', '2026-09-30', 'import', '2'), c = f('T3', '2024-01-01', 'label', '3');
    const perms = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
    for (const p of perms) expect(tps(p)).toEqual(['T1', 'T2', 'T3']);
  });
  it('two films dated only by the same import day go in timepoint order (the 30 Sep bug)', () => {
    expect(tps([f('T2', '2026-09-30', 'import', 'b'), f('T1', '2026-09-30', 'import', 'a')])).toEqual(['T1', 'T2']);
  });
});

describe('stages (ABO: Initial black, Progress blue, Final red, Retention green)', () => {
  it('Auto is guessed from the place in the ticked series', () => {
    expect([0].map((i) => autoStage(i, 1))).toEqual(['initial']);
    expect([0, 1].map((i) => autoStage(i, 2))).toEqual(['initial', 'final']);
    expect([0, 1, 2, 3, 4].map((i) => autoStage(i, 5))).toEqual(['initial', 'progress', 'progress', 'progress', 'final']);
  });
  it('a chosen stage beats Auto', () => {
    expect(stageOf({ stage: 'retention' }, 1, 3)).toBe('retention');
    expect(stageOf({ stage: null }, 2, 3)).toBe('final');
  });
  it('each stage has its colour; repeats are solid, dashed, dotted', () => {
    expect(looks(['initial', 'progress', 'progress', 'progress', 'progress', 'final'])).toEqual([
      { colour: 'var(--stage-initial)' }, { colour: 'var(--stage-progress)' }, { colour: 'var(--stage-progress)', dash: '8 5' },
      { colour: 'var(--stage-progress)', dash: '2 4' }, { colour: 'var(--stage-progress)' }, { colour: 'var(--stage-final)' }]);
  });
});

const defs: AnalysisDef[] = [
  { id: 'a', name: 'A', nodes: {}, measurements: [{ node: 'SNA', label: 'SNA' }, { node: 'ANB', label: 'ANB' }] },
  { id: 'b', name: 'B', nodes: {}, measurements: [{ node: 'SNA', label: 'SNA' }, { node: 'Wits', label: 'Wits' }] },
];
const deg = (v: number): Value => ({ t: 'scalar', v, unit: 'deg' });

describe('the table', () => {
  it('a row per measurement with a value on any film, gaps as null, once each', () => {
    expect(seriesRows(defs, [{ SNA: deg(80), ANB: null }, { SNA: deg(81.5), ANB: deg(3) }, { SNA: deg(82) }])).toEqual([
      { node: 'SNA', label: 'SNA', unit: 'deg', values: [80, 81.5, 82] },
      { node: 'ANB', label: 'ANB', unit: 'deg', values: [null, 3, null] }]);
  });
  it('change is later minus earlier, blank when either is missing', () => {
    const r = { node: 'ANB', label: 'ANB', unit: 'deg' as const, values: [4, 3, null] };
    expect(changeOf(r, 0, 1)).toBe(-1);
    expect(changeOf(r, 0, 2)).toBeNull();
  });
  it('pairs are every earlier → later pair', () => {
    expect(pairs(['a', 'b', 'c'])).toEqual([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' }]);
  });
  it('pickPair starts at first → last and keeps a valid choice', () => {
    expect(pickPair(['a', 'b', 'c'], null)).toEqual({ from: 'a', to: 'c' });
    expect(pickPair(['a', 'b', 'c'], { from: 'b', to: 'c' })).toEqual({ from: 'b', to: 'c' });
    expect(pickPair(['a'], null)).toBeNull();
  });
  it('pickPair falls back when a film leaves', () => {
    expect(pickPair(['a', 'c'], { from: 'b', to: 'c' })).toEqual({ from: 'a', to: 'c' });
  });
});

import { filmLabel, pairLabels, softDash, usable } from './series';
describe('owner 30 Sep: minor fixes', () => {
  const s = (id: string, over: Partial<{ inSeries: boolean; timepoint: string; takenOn: string | null; takenOnSource: F['takenOnSource'] }> = {}) =>
    ({ id, timepoint: 'T1', takenOn: '2024-01-10', takenOnSource: 'label' as F['takenOnSource'], createdAt: 'x', stage: null, inSeries: true, nameOnly: false, ...over });
  it('a film that failed to open is left out; the open film always stays', () => {
    const films = [s('a'), s('b'), s('c', { inSeries: false }), s('d')];
    expect(usable(films, 'd', new Set(['b', 'd'])).map((f) => f.id)).toEqual(['a', 'd']);
  });
  it('an import day is shown as one', () => {
    expect(filmLabel(s('a', { timepoint: 'T2' }), 'AU')).toBe('T2 · 10/01/2024');
    expect(filmLabel(s('a', { timepoint: 'T2', takenOn: '2026-09-30', takenOnSource: 'import' }), 'AU')).toBe('T2 · imported 30/09/2026');
  });
  it('pair names add the date only when a timepoint repeats', () => {
    expect(pairLabels([s('a'), s('b', { timepoint: 'T2' })], 'AU')).toEqual({ a: 'T1', b: 'T2' });
    expect(pairLabels([s('a'), s('b', { takenOn: '2025-02-03' })], 'AU')).toEqual({ a: 'T1 · 10/01/2024', b: 'T1 · 03/02/2025' });
  });
  it('soft tissue gets a pattern of its own for each repeat', () => {
    expect([undefined, '8 5', '2 4'].map(softDash)).toEqual(['4 2.5', '12 4 2 4', '1 3']);
  });
});

import { hideUncalibrated } from './series';
describe('the Change table hides mm from a film that is not calibrated (N5)', () => {
  const rows = [{ node: 'a', label: 'SNA', unit: 'deg' as const, values: [80, 82] }, { node: 'b', label: 'Pog–NB', unit: 'mm' as const, values: [1, 2] }];
  it('mm values of the uncalibrated film become null and are marked hidden; angles are untouched', () => {
    const out = hideUncalibrated(rows, [false, true]);
    expect(out[0].values).toEqual([80, 82]);
    expect(out[1].values).toEqual([1, null]);
    expect(out[1].hidden).toEqual([false, true]);
  });
  it('every film calibrated: nothing changes (positive control)', () => {
    expect(hideUncalibrated(rows, [false, false])[1].values).toEqual([1, 2]);
  });
  // Edge case: no rows at all — must not throw.
  it('no rows: an empty list back', () => {
    expect(hideUncalibrated([], [true, false])).toEqual([]);
  });
  // Edge case: a ratio (unit '') is unaffected, like angles.
  it('a plain ratio is untouched too', () => {
    const r = [{ node: 'c', label: 'Ratio', unit: '' as const, values: [1, 2] }];
    expect(hideUncalibrated(r, [true, true])[0].values).toEqual([1, 2]);
  });
  // Fix round 1, review Minor 1: a film that never had a value for this measurement (missing landmarks, or its
  // doc hadn't loaded) must not read as "hidden" just because it is also uncalibrated — `measurementRows` uses
  // `!!v` for the same decision (a row is only `hidden` when there WAS a value to hide), and `hideUncalibrated`
  // disagreed with it before this fix.
  it('a film with no value at all for this measurement: not marked hidden, even though it is uncalibrated', () => {
    const r = [{ node: 'b', label: 'Pog–NB', unit: 'mm' as const, values: [1, null] }];
    const out = hideUncalibrated(r, [false, true]);
    expect(out[0].values).toEqual([1, null]);
    expect(out[0].hidden).toEqual([false, false]);
  });
});
