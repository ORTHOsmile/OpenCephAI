import { describe, it, expect, vi } from 'vitest';
import { placeFromRuns, placeOnFilm, ORIGINAL_19 } from './placement';
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

describe('Part F: no switch made — every point placed exactly as before (untouched path)', () => {
  const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', CW = 'cwlachap-hrnet-w32';
  const at = (base: number) => det(AZ, ORIGINAL_19.map((id, i) => [id, base + i] as [string, number]));
  const main = at(0);
  const extras = [{ ...at(100), modelId: CW }, { ...at(200), modelId: SR }];
  const tbl = [AZ, CW, SR].map((m, i) => row(m, i === 0, ORIGINAL_19.map((id) => [id, O] as [string, any])));
  const table = { ruleVersion: 'main-point-source/1', confirmationPending: true, points: { ...Object.fromEntries(ORIGINAL_19.map((id) => [id, AZ])), PNS: CW } };
  it('PNS from cwlachap (the table), the other 18 from Aariz; an empty switch list changes nothing', () => {
    const before = placeFromRuns(main, extras, tbl, table);
    expect(before.landmarks.map((l) => [l.id, l.x])).toEqual(ORIGINAL_19.map((id, i) => [id, id === 'PNS' ? 100 + i : i]));
    expect(placeFromRuns(main, extras, tbl, { ...table, ownerChoices: {} })).toEqual(before);
  });
});

describe('Part F: your accepted switch places that point (rule item 8)', () => {
  const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', CW = 'cwlachap-hrnet-w32';
  const t = [row(AZ, true, [['Go', O], ['S', O], ['U1A', OK]]), row(SR, false, [['Go', O], ['S', O], ['U1A', OK]]), row(CW, false, [['Go', O], ['S', O]])];
  const src = (owner: Record<string, string>, points: Record<string, string> = { Go: AZ, S: AZ }) =>
    ({ ruleVersion: 'main-point-source/1', confirmationPending: true, points, ownerChoices: owner });
  it('Go switched to SRPose: SRPose places Go, Aariz the rest', () => {
    const r = placeFromRuns(det(AZ, [['Go', 10], ['S', 20]]), [det(SR, [['Go', 11], ['S', 21]])], t, src({ Go: SR }));
    expect([r.landmarks.find((l) => l.id === 'Go')!.x, r.source.Go, r.source.S, r.fallback]).toEqual([11, SR, AZ, []]);
  });
  it('the chosen model gave no Go on this film: Aariz places it, listed as a fallback', () => {
    const r = placeFromRuns(det(AZ, [['Go', 10]]), [det(SR, [['S', 21]])], t, src({ Go: SR }));
    expect([r.landmarks.find((l) => l.id === 'Go')!.x, r.source.Go, r.fallback]).toEqual([10, AZ, ['Go']]);
  });
  it('your switch wins over the built-in table', () => {
    expect(placeFromRuns(det(AZ, [['Go', 10]]), [det(SR, [['Go', 11]]), det(CW, [['Go', 12]])], t, src({ Go: SR }, { Go: CW })).source.Go).toBe(SR);
  });
  it('ignored when Aariz is not the main model, and for a point outside the 19', () => {
    expect(placeFromRuns(det(CW, [['Go', 12]]), [det(SR, [['Go', 11]])], [row(CW, true, [['Go', O]]), row(SR, false, [['Go', O]])], src({ Go: SR })).source.Go).toBe(CW);
    expect(placeFromRuns(det(AZ, [['U1A', 10]]), [det(SR, [['U1A', 11]])], t, src({ U1A: SR })).source.U1A).toBe(AZ);
  });
});

describe('Automatic best as the main model (spec §3; owner D1, Q1, Q4)', () => {
  const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', GU = 'gu2net-isbi19';
  const t = [row(AZ, true, [['Go', O], ['S', O], ['B', O]]), row(SR, false, [['Go', O], ['S', O], ['B', O]]), row(GU, false, [['B', O]])];
  const src = (on: boolean, uses: Record<string, string>) => ({ ruleVersion: 'x', confirmationPending: false, points: { Go: AZ, S: AZ, B: AZ },
    ownerChoices: { B: GU }, autoBest: { available: true, on, base: AZ, uses, notes: {}, kept: {}, latest: [] } });
  const az = det(AZ, [['Go', 10], ['S', 20], ['B', 30]]), sr = det(SR, [['Go', 11], ['S', 21], ['B', 31]]), gu = det(GU, [['B', 32]]);
  it('on: the evidence picks the model per point; Part F switches are not read (Q1); the rest is Aariz (Q4)', () => {
    const r = placeFromRuns(az, [sr, gu], t, src(true, { Go: SR }));
    expect([r.source.Go, r.source.S, r.source.B]).toEqual([SR, AZ, AZ]);
    expect(r.landmarks.find((l) => l.id === 'Go')!.x).toBe(11);
    expect(r.via).toBe('auto-best');
  });
  it('off: as before — your Part F switch places B, the evidence is not used, nothing is marked', () => {
    const r = placeFromRuns(az, [sr, gu], t, src(false, { Go: SR }));
    expect([r.source.Go, r.source.B, r.via]).toEqual([AZ, GU, null]);
  });
  it('the favoured model gave no point: Aariz’s mark, a fallback, and the model it waited for', () => {
    const r = placeFromRuns(az, [], t, src(true, { Go: SR }));
    expect([r.source.Go, r.fallback, r.wanted]).toEqual([AZ, ['Go'], { Go: SR }]);
  });
  it('a main model other than Aariz never takes Automatic best’s choices; no table: nothing marked', () => {
    expect(placeFromRuns(det(GU, [['Go', 5]]), [sr], t, src(true, { Go: SR })).via).toBeNull();
    expect(placeFromRuns(az, [sr], t, null).via).toBeNull();
  });
});

describe('the base model places (plan 2026-10-29 Task 5; spec §4)', () => {
  const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', GU = 'gu2net-isbi19', CW = 'cwlachap-hrnet-w32';
  const t = [row(GU, true, [['Go', O], ['B', O], ['S', O]]), row(SR, false, [['Go', O], ['B', O], ['S', O]]), row(AZ, false, [['Go', O], ['B', O], ['S', O]]), row(CW, false, [['S', O]])];
  const src = (base: string | undefined, on: boolean, uses: Record<string, string>) => ({ ruleVersion: 'x', confirmationPending: false, points: { Go: AZ, B: AZ, S: CW },
    ownerChoices: { B: SR }, autoBest: { available: true, on, ...(base === undefined ? {} : { base }), uses, notes: {}, kept: {}, latest: [] } as any });
  it('with GU2Net as the base, its run places the points without evidence and the evidence picks the rest', () => {
    const gu = det(GU, [['Go', 10], ['B', 20], ['S', 30]]), sr = det(SR, [['Go', 11], ['B', 21], ['S', 31]]), cw = det(CW, [['S', 32]]);
    const p = placeFromRuns(gu, [sr, cw], t, src(GU, true, { Go: SR }));
    expect([p.source.Go, p.source.B, p.source.S]).toEqual([SR, GU, GU]);
    expect(p.via).toBe('auto-best');
  });
  it('a main run that is not the base never takes Automatic best’s map', () => {
    const az = det(AZ, [['Go', 10]]), sr = det(SR, [['Go', 11]]);
    expect(placeFromRuns(az, [sr], t, src(GU, true, { Go: SR })).via).toBeNull();
  });
  // Final review C1 (ruling A, 2 Nov): Part F switches are judged against the base, so they apply when the main
  // model IS the base, never in place of a model they were not judged against.
  it('base GU2Net, main GU2Net, Automatic best off: your accepted switch places Go', () => {
    const gu = det(GU, [['Go', 10], ['B', 20]]), sr = det(SR, [['Go', 11], ['B', 21]]);
    const p = placeFromRuns(gu, [sr], t, { ...src(GU, false, {}), ownerChoices: { Go: SR } });
    expect([p.source.Go, p.source.B, p.via]).toEqual([SR, GU, null]);
  });
  it('base GU2Net, main Aariz: a switch judged against GU2Net is not applied in place of Aariz', () => {
    const az = det(AZ, [['Go', 10]]), sr = det(SR, [['Go', 11]]);
    const p = placeFromRuns(az, [sr], t, { ...src(GU, false, {}), ownerChoices: { Go: SR } });
    expect(p.source.Go).toBe(AZ);
  });
  it('control: base Aariz, main Aariz: the switch applies, as before', () => {
    const az = det(AZ, [['Go', 10]]), sr = det(SR, [['Go', 11]]);
    expect(placeFromRuns(az, [sr], t, { ...src(AZ, false, {}), ownerChoices: { Go: SR } }).source.Go).toBe(SR);
  });
  it('a map from an older back end (no base) reads as Aariz, as before', () => {
    const az = det(AZ, [['Go', 10], ['S', 20]]), sr = det(SR, [['Go', 11]]), cw = det(CW, [['S', 32]]);
    const p = placeFromRuns(az, [sr, cw], t, src(undefined, true, { Go: SR }));
    expect([p.source.Go, p.source.S, p.via]).toEqual([SR, CW, 'auto-best']);
    expect(placeFromRuns(det(GU, [['Go', 5]]), [sr], t, src(undefined, true, { Go: SR })).via).toBeNull();
  });
});

describe('M4: Automatic best\'s choices could not be read (owner ruling, 2 Nov 2026)', () => {
  const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', CW = 'cwlachap-hrnet-w32', GU = 'gu2net-isbi19';
  const t = [row(AZ, true, [['Go', O], ['S', O], ['Co', OK]]), row(SR, false, [['Go', O], ['S', O], ['Co', OK]]), row(CW, false, [['Go', O], ['S', O]]), row(GU, false, [['Go', O], ['S', O]])];
  const src = (unreadable: boolean): any => ({ ruleVersion: 'x', confirmationPending: false, points: { Go: AZ, S: CW }, ownerChoices: { Go: SR }, autoBest: null, autoBestUnreadable: unreadable });
  it('unreadable: every point the base finds is the base\'s: no Part F switch, no built-in switch, no label, no fallback', () => {
    const p = placeFromRuns(det(AZ, [['Go', 10], ['S', 20]]), [det(SR, [['Go', 11]]), det(CW, [['S', 21]])], t, src(true));
    expect([p.source.Go, p.source.S, p.via, p.fallback, p.wanted]).toEqual([AZ, AZ, null, [], {}]);
  });
  it('unreadable: a point the base lacks is still filled by another model under the 2 mm gate', () => {
    const p = placeFromRuns(det(AZ, [['S', 20]]), [det(SR, [['Co', 30]])], t, src(true));
    expect([p.source.S, p.source.Co]).toEqual([AZ, SR]);
  });
  it('unreadable with another base (GU2Net as the first run): that base places every point', () => {
    const p = placeFromRuns(det(GU, [['Go', 5]]), [det(SR, [['Go', 11]])], t, src(true));
    expect([p.source.Go, p.via]).toEqual([GU, null]);
  });
  it('unreadable and nothing found: an empty placement, not an error', () => {
    expect(placeFromRuns(det(AZ, []), [], t, src(true))).toEqual({ landmarks: [], source: {}, fallback: [], via: null, wanted: {} });
  });
  it('control: readable (flag false or absent): today\'s switch and table still apply', () => {
    const r = [det(AZ, [['Go', 10], ['S', 20]]), [det(SR, [['Go', 11]]), det(CW, [['S', 21]])]] as const;
    const p = placeFromRuns(r[0], [...r[1]], t, src(false));
    expect([p.source.Go, p.source.S]).toEqual([SR, CW]);
    const { autoBestUnreadable, ...absent } = src(false);
    expect(placeFromRuns(r[0], [...r[1]], t, absent).source).toEqual(p.source);
  });
});
