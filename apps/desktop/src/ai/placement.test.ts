import { describe, it, expect, vi } from 'vitest';
import { placeFromRuns, placeOnFilm } from './placement';
const lm = (id: string, x: number) => ({ id, x, y: 1, confidence: 0.9, peak: 0.9 });
const det = (modelId: string, ids: [string, number][]) => ({ modelId, landmarks: ids.map(([i, x]) => lm(i, x)) }) as any;
const row = (modelId: string, main: boolean, pts: [string, any][]) => ({ modelId, title: modelId, main, points: pts.map(([id, status]) => ({ id, status })) });
const O = { kind: 'original' }, OK = { kind: 'scored', mre: 1.5, n: 150, dataset: 'aariz' }, FAR = { kind: 'tooFar', mre: 2.6, n: 150, dataset: 'aariz' }, NS = { kind: 'notScored' };

describe('placeFromRuns (owner rulings R-B1, R-B2, R-B4, 7 Oct)', () => {
  const table = [row('main', true, [['S', O], ['U1A', FAR], ['Ba', NS]]), row('aariz', false, [['S', O], ['U1A', OK], ['Co', OK]])];
  it('the main model places what it finds and passes the gate; it is never overridden', () => {
    const r = placeFromRuns(det('main', [['S', 10], ['U1A', 20], ['Ba', 30]]), [det('aariz', [['S', 99], ['U1A', 21], ['Co', 40]])], table);
    expect(r.landmarks.find((l) => l.id === 'S')!.x).toBe(10);
    expect(r.source.S).toBe('main');
  });
  it('a point the main model has over 2 mm is filled from a model that passes', () => {
    const r = placeFromRuns(det('main', [['S', 10], ['U1A', 20]]), [det('aariz', [['U1A', 21]])], table);
    expect(r.landmarks.find((l) => l.id === 'U1A')!.x).toBe(21);
    expect(r.source.U1A).toBe('aariz');
  });
  it('a point nobody passes stays unplaced (kept as a ghost by the raw points)', () => {
    const t2 = [row('main', true, [['U1A', FAR]])];
    expect(placeFromRuns(det('main', [['U1A', 20]]), [], t2).landmarks).toEqual([]);
  });
  it('unscored points are placed (R-B1)', () => {
    expect(placeFromRuns(det('main', [['Ba', 30]]), [], table).source.Ba).toBe('main');
  });
  it('points the main model lacks are filled in catalogue order, first that passes', () => {
    const t3 = [row('main', true, [['S', O]]), row('a', false, [['Co', FAR]]), row('b', false, [['Co', OK]]), row('c', false, [['Co', OK]])];
    const r = placeFromRuns(det('main', [['S', 1]]), [det('a', [['Co', 5]]), det('b', [['Co', 6]]), det('c', [['Co', 7]])], t3);
    expect(r.source.Co).toBe('b');
  });
  it('a model whose run failed (no detection) is skipped', () => {
    expect(placeFromRuns(det('main', [['S', 1]]), [], table).landmarks.map((l) => l.id)).toEqual(['S']);
  });
  it('a point missing from the table counts as not scored (placed), never as an error', () => {
    expect(placeFromRuns(det('main', [['D', 3]]), [], [row('main', true, [])]).source.D).toBe('main');
  });
  // Rulings: never place from a tooFar row; never override the main model's passing point.
  it('a tooFar extra never places a point, even when nobody else has it', () => {
    const r = placeFromRuns(det('main', [['S', 1]]), [det('main2', [['U1A', 5]])], [row('main', true, [['S', O]]), row('main2', false, [['U1A', FAR]])]);
    expect(r.landmarks.map((l) => l.id)).toEqual(['S']);
    expect(r.source.U1A).toBeUndefined();
  });
  it('catalogue order is the table order, whatever order the extra runs arrive in', () => {
    const t3 = [row('main', true, []), row('b', false, [['Co', OK]]), row('c', false, [['Co', OK]])];
    expect(placeFromRuns(det('main', []), [det('c', [['Co', 7]]), det('b', [['Co', 6]])], t3).source.Co).toBe('b');
  });
  it('the placed points keep the finding model\'s position and confidence', () => {
    const r = placeFromRuns(det('main', [['S', 10]]), [det('aariz', [['Co', 40]])], table);
    expect(r.landmarks).toEqual([{ id: 'S', x: 10, y: 1, confidence: 0.9 }, { id: 'Co', x: 40, y: 1, confidence: 0.9 }]);
    expect(r.source).toEqual({ S: 'main', Co: 'aariz' });
  });
});

describe('placeOnFilm: the import and re-detect paths (Task 7)', () => {
  const table = [row('main', true, [['S', O], ['U1A', FAR]]), row('aariz', false, [['U1A', OK]])];
  it('fills from the extras that ran; an extra that errored (no detection) is skipped', async () => {
    const r = await placeOnFilm(det('main', [['S', 1], ['U1A', 2]]), [{ detection: null }, { detection: det('aariz', [['U1A', 3]]) }], async () => table);
    expect(r.landmarks.map((l) => [l.id, l.x])).toEqual([['S', 1], ['U1A', 3]]);
  });
  it('if the table cannot be read, the main model\'s points are used as they are (today\'s behaviour), and it is logged once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const main = det('main', [['S', 1], ['Go', 2]]);
    const a = await placeOnFilm(main, [{ detection: det('aariz', [['Go', 3]]) }], async () => { throw new Error('nope'); });
    const b = await placeOnFilm(main, [], async () => null as any);
    expect(a.landmarks).toEqual(main.landmarks.map(({ id, x, y, confidence }: any) => ({ id, x, y, confidence })));
    expect(a.source).toEqual({ S: 'main', Go: 'main' });
    expect(b.landmarks.map((l) => l.id)).toEqual(['S', 'Go']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('if the table cannot be read, only the original 19 are placed: a new point (U1A, Ba) is not placed unchecked (review M1)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await placeOnFilm(det('main', [['S', 1], ['U1A', 2], ['Ba', 3], ['Ar', 4]]), [], async () => { throw new Error('nope'); });
    expect(r.landmarks.map((l) => l.id)).toEqual(['S', 'Ar']);
    expect(r.source).toEqual({ S: 'main', Ar: 'main' });
    warn.mockRestore();
  });
  it('no extras installed: the main model\'s points, gated by its own row', async () => {
    const r = await placeOnFilm(det('main', [['S', 1]]), [], async () => [row('main', true, [['S', O]])]);
    expect(r.landmarks.map((l) => l.id)).toEqual(['S']);
  });
});

import { AARIZ, CWLACHAP, type MainPointSource } from './placement';
describe('the per-point source table (owner O6, spec §5.1)', () => {
  const src: MainPointSource = { ruleVersion: 'main-point-source/1', confirmationPending: true, points: { S: AARIZ, Go: CWLACHAP } };
  const t = [row(AARIZ, true, [['S', O], ['Go', O], ['Co', FAR]]), row(CWLACHAP, false, [['S', O], ['Go', O]]), row('srpose-cldet23', false, [['Ba', NS]])];
  it('Aariz main: a point the table gives to cwlachap comes from cwlachap, exactly; the rest from Aariz', () => {
    const r = placeFromRuns(det(AARIZ, [['S', 10], ['Go', 20]]), [det(CWLACHAP, [['S', 11], ['Go', 21]])], t, src);
    expect(r.landmarks.find((l) => l.id === 'Go')!.x).toBe(21);
    expect(r.landmarks.find((l) => l.id === 'S')!.x).toBe(10);
    expect(r.source).toEqual({ S: AARIZ, Go: CWLACHAP });
    expect(r.fallback).toEqual([]);
  });
  it('the table names cwlachap but cwlachap gave nothing on this film: Aariz places it and says so', () => {
    const r = placeFromRuns(det(AARIZ, [['S', 10], ['Go', 20]]), [], t, src);
    expect(r.source.Go).toBe(AARIZ);
    expect(r.fallback).toEqual(['Go']);
  });
  it('another main model (chosen in Models…) ignores the table', () => {
    const r = placeFromRuns(det(CWLACHAP, [['S', 11], ['Go', 21]]), [det(AARIZ, [['S', 10], ['Go', 20]])], [row(CWLACHAP, true, [['S', O], ['Go', O]])], src);
    expect(r.source).toEqual({ S: CWLACHAP, Go: CWLACHAP });
  });
  it('no table: Aariz places every point it finds (today\'s rule)', () => {
    const r = placeFromRuns(det(AARIZ, [['S', 10], ['Go', 20]]), [det(CWLACHAP, [['Go', 21]])], t, null);
    expect(r.source.Go).toBe(AARIZ);
  });
  it('the table never touches a new point: Co stays gated, Ba is filled as today (R-B2, R-B4)', () => {
    const r = placeFromRuns(det(AARIZ, [['Co', 5]]), [det('srpose-cldet23', [['Ba', 6]])], t, { ...src, points: { ...src.points, Co: CWLACHAP } });
    expect(r.source.Co).toBeUndefined();
    expect(r.source.Ba).toBe('srpose-cldet23');
  });
  it('the table never moves a new point that passes the gate to cwlachap, even if the table names it (preflight c4)', () => {
    const t2 = [row(AARIZ, true, [['L1A', OK]]), row(CWLACHAP, false, [['L1A', OK]])];
    const r = placeFromRuns(det(AARIZ, [['L1A', 7]]), [det(CWLACHAP, [['L1A', 9]])], t2, { ...src, points: { L1A: CWLACHAP } });
    expect([r.source.L1A, r.landmarks.find((l) => l.id === 'L1A')!.x, r.fallback]).toEqual([AARIZ, 7, []]);
  });
});
describe('placeOnFilm reads the source table and survives losing it', () => {
  it('passes the table through; a table that cannot be read is logged once and Aariz places everything', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = [row(AARIZ, true, [['Go', O]]), row(CWLACHAP, false, [['Go', O]])];
    const ok = await placeOnFilm(det(AARIZ, [['Go', 20]]), [{ detection: det(CWLACHAP, [['Go', 21]]) }], async () => t,
      async () => ({ ruleVersion: 'v', confirmationPending: true, points: { Go: CWLACHAP } }));
    expect(ok.source.Go).toBe(CWLACHAP);
    const bad = await placeOnFilm(det(AARIZ, [['Go', 20]]), [{ detection: det(CWLACHAP, [['Go', 21]]) }], async () => t, async () => { throw new Error('nope'); });
    expect(bad.source.Go).toBe(AARIZ);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
