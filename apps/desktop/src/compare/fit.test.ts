import { describe, it, expect } from 'vitest';
import type { Vec2 } from '@ceph/geometry';
import { alignOnSN } from './align';
import { IDENTITY, MIN_PAIR_PX, alignSim, apply, compose, fittedScale, invert, ownPages, poseOf, refScaleOf, simOf, startPose, toOpen, wrap, type Placed } from './fit';
import type { FilmFit } from '../ipc';
import { scaleOf, type MachineScale } from '../tracing/spacing';

// Spec 2026-10-20 (owner MS1–MS4). SYNTHETIC machine and dates.
const ms = (over: Partial<MachineScale> = {}): MachineScale => ({ machineId: 'm1', machineName: 'Demo Radiology', spacingMm: 0.0998, widthPx: 2400, heightPx: 3000,
  source: 'film', sourceCaseId: 'c9', sourceFilmDate: '2025-03-12', setAt: '2026-10-24T00:00:00.000Z', applies: true, ...over });

const close = (a: Vec2, b: Vec2) => { expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); };
const dist = (p: Vec2, q: Vec2) => Math.hypot(q.x - p.x, q.y - p.y);
// SYNTHETIC reference points (image px), and films made from them by a KNOWN turn, size and move.
const ref = { S: { x: 250, y: 300 }, N: { x: 950, y: 200 }, Me: { x: 890, y: 1150 }, Ba: { x: 150, y: 520 } };
type Shape = typeof ref;
const known = (theta: number, k: number, to: Vec2, mirror = false) => (p: Vec2): Vec2 => {
  const dx = p.x - ref.S.x, dy = p.y - ref.S.y, c = Math.cos(theta) * k, s = Math.sin(theta) * k;
  const x = to.x + c * dx - s * dy, y = to.y + s * dx + c * dy; return { x: mirror ? -x : x, y }; };
const mapAll = (f: (p: Vec2) => Vec2) => Object.fromEntries(Object.entries(ref).map(([k, p]) => [k, f(p)])) as Shape;
const keys = Object.keys(ref) as (keyof Shape)[];

describe('the start of a fit (spec G step 2)', () => {
  it('puts both reference points on the reference’s and sizes the film so the distances are equal', () => {
    const film = mapAll(known(0.3, 1 / 1.04, { x: 500, y: 400 }));
    const p = startPose([ref.S, ref.N], [film.S, film.N], false)!;
    expect(p.scale).toBeCloseTo(1.04, 12);
    for (const k of keys) close(apply(simOf(p), film[k]), ref[k]);        // an exact similarity: the whole shape lands
  });
  it('recovers a known placement from two points the operator picks', () => {
    const film = mapAll(known(-0.7, 0.8, { x: 300, y: 900 }));
    const p = startPose([ref.Ba, ref.Me], [film.Ba, film.Me], false)!;
    for (const k of keys) close(apply(simOf(p), film[k]), ref[k]);
  });
  /** A left-facing film is mirrored before it is placed, never turned upside down. */
  it('mirrors a film that faces the other way', () => {
    const film = mapAll(known(0.2, 1, { x: -800, y: 300 }, true));
    const s = simOf(startPose([ref.S, ref.N], [film.S, film.N], true)!);
    for (const k of keys) close(apply(s, film[k]), ref[k]);
    expect(apply(s, film.Me).y).toBeGreaterThan(apply(s, film.N).y);
  });
  it('is today’s S–N superimposition when given today’s size (alignOnSN and alignSim agree to 1e-9)', () => {
    const film = { ...mapAll(known(0.4, 0.9, { x: 600, y: 700 })), Me: { x: 777, y: 1111 } };   // Me off the similarity on purpose
    for (const mirror of [false, true]) {
      const al = alignOnSN(ref, film, 1.25, mirror)!, m = alignSim(ref, film, 1.25, mirror)!;
      const s = simOf(startPose([ref.S, ref.N], [film.S, film.N], mirror, 1.25)!);
      for (const k of keys) { close(apply(s, film[k]), al(film[k])); close(apply(m, film[k]), al(film[k])); }
    }
    expect(alignSim(ref, { ...ref, N: ref.S }, 1, false)).toBeNull();
  });
  /** Owner G2: a ruler-calibrated film keeps its true size; only the S–N line is matched in place and direction. */
  it('keeps a locked size', () => {
    const film = mapAll(known(0.1, 1 / 1.04, { x: 500, y: 400 }));
    const p = startPose([ref.S, ref.N], [film.S, film.N], false, 1.25)!;
    expect(p.scale).toBe(1.25);
    close(apply(simOf(p), film.S), ref.S);
    expect(dist(apply(simOf(p), film.S), apply(simOf(p), film.N))).toBeCloseTo(dist(film.S, film.N) * 1.25, 9);
  });
  it('refuses points closer than 20 px, numbers that are not finite, and sizes outside ×0.2–×5 (boundaries accepted)', () => {
    expect(MIN_PAIR_PX).toBe(20);                                                              // fix round 1, minor 2: pin the value itself
    const a = { x: 0, y: 0 }, near = { x: MIN_PAIR_PX - 0.01, y: 0 }, at = { x: MIN_PAIR_PX, y: 0 };
    expect(startPose([a, near], [a, at], false)).toBeNull();
    expect(startPose([a, at], [a, near], false)).toBeNull();
    expect(startPose([a, at], [a, at], false)).not.toBeNull();
    expect(startPose([a, { x: NaN, y: 0 }], [a, at], false)).toBeNull();
    expect(startPose([a, { x: 101, y: 0 }], [a, { x: 20, y: 0 }], false)).toBeNull();          // ×5.05 > ×5
    expect(startPose([a, { x: 100, y: 0 }], [a, { x: 20, y: 0 }], false)!.scale).toBe(5);      // ×5 exactly: accepted
    expect(startPose([a, at], [a, at], false, 0.19)).toBeNull();                               // a locked size outside the range
    expect(startPose([a, at], [a, at], false, 0.2)!.scale).toBe(0.2);
  });
});

describe('matrices', () => {
  it('undoes a placement and composes in order', () => {
    const p = startPose([ref.S, ref.N], [{ x: 10, y: 20 }, { x: 400, y: -30 }], true)!, s = simOf({ ...p, dx: 7, dy: -3 });
    const back = invert(s)!;
    for (const k of keys) { close(apply(back, apply(s, ref[k])), ref[k]); close(apply(compose(back, s), ref[k]), apply(IDENTITY, ref[k])); }
    expect(invert({ a: 0, b: 0, c: 0, d: 0, e: 1, f: 1 })).toBeNull();
  });
  /** Fine-tune (spec G step 2): moving, turning and sizing happen about where the film's first point lands. */
  it('turns and sizes about the landed first point', () => {
    const p = { ...startPose([ref.S, ref.N], [{ x: 10, y: 20 }, { x: 400, y: -30 }], false)!, dx: 12, dy: -8 };
    const pivot = { x: ref.S.x + 12, y: ref.S.y - 8 };
    close(apply(simOf(p), p.b), pivot);
    close(apply(simOf({ ...p, rotation: wrap(p.rotation + 0.3) }), p.b), pivot);
    close(apply(simOf({ ...p, scale: p.scale * 1.1 }), p.b), pivot);
    expect(wrap(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrap(-Math.PI)).toBeCloseTo(Math.PI, 12);
  });
  /** Fix round 1, ruling 4: the old while-loop hung forever on ±Infinity and on |t| ≳ 1e16 (shown with a 3s
   *  alarm outside Vitest, since a real hang here would stall the whole suite). The closed form settles instantly. */
  it('never loops forever: NaN for non-finite input, settles on a huge finite one', () => {
    expect(wrap(Infinity)).toBeNaN();
    expect(wrap(-Infinity)).toBeNaN();
    expect(wrap(NaN)).toBeNaN();
    const huge = wrap(1e16);
    expect(Number.isFinite(huge)).toBe(true);
    expect(huge).toBeGreaterThan(-Math.PI);
    expect(huge).toBeLessThanOrEqual(Math.PI);
    expect(wrap(7)).toBeCloseTo(0.7168146928204138, 12);          // unchanged from the old implementation
  });
  it('reads a saved fit back as the same placement', () => {
    const f = { refCaseId: 'r', refKind: 'sn' as const, refPoints: [[250, 300], [950, 200]] as [[number, number], [number, number]],
      filmPoints: [[260, 310], [930, 230]] as [[number, number], [number, number]], mirror: false, scale: 1.04, rotation: 0.05, dx: 2, dy: -1 };
    expect(poseOf(f)).toEqual({ a: { x: 250, y: 300 }, b: { x: 260, y: 310 }, mirror: false, scale: 1.04, rotation: 0.05, dx: 2, dy: -1 });
  });
});

describe('fittedScale (owner G2, G3; spec example; re-signed MS-4 to take Scale, not raw numbers)', () => {
  const fit = { scale: 1.04, refKind: 'sn' as const };
  it('the spec’s example: T1 at 0.100 mm/px, T2 scaled ×1.04 → 0.104, marked', () => {
    const s = fittedScale(scaleOf(null), fit, scaleOf(0.1), 'T1');
    expect(s.mmPerPx).toBeCloseTo(0.104, 15);
    expect({ ...s, mmPerPx: 0 }).toEqual({ mmPerPx: 0, source: 'fit', fit: { ref: 'T1', kind: 'sn', k: 1.04, refAssumed: false } });
  });
  it('a ruler always wins: a calibrated film is never rescaled', () => expect(fittedScale(scaleOf(0.12), fit, scaleOf(0.1), 'T1')).toEqual(scaleOf(0.12)));
  it('a machine scale (MS-4: above fit, like a ruler) is never rescaled by a fit', () => {
    const own: ReturnType<typeof scaleOf> | { mmPerPx: number; source: 'machine'; machine: MachineScale } = { mmPerPx: 0.0998, source: 'machine', machine: ms() };
    expect(fittedScale(own, fit, scaleOf(0.1), 'T1')).toEqual(own);
  });
  it('no fit, or a fit whose size is not a usable number: the film’s own scale', () => {
    for (const f of [null, { ...fit, scale: NaN }, { ...fit, scale: 0.1 }, { ...fit, scale: 6 }]) expect(fittedScale(scaleOf(null), f, scaleOf(0.1), 'T1')).toEqual(scaleOf(null));
  });
  it('a reference with no ruler gives the assumed scale, marked so (G3)', () => {
    const s = fittedScale(scaleOf(null), fit, scaleOf(null), 'T1');
    expect(s.mmPerPx).toBeCloseTo(0.1 * 1.04, 15);
    expect(s.source === 'fit' && s.fit.refAssumed).toBe(true);
  });
  it('takes the reference’s own ruler, not the assumed 0.1 (fix round 1, I1)', () => {
    expect(fittedScale(scaleOf(null), fit, scaleOf(0.0875), 'T1').mmPerPx).toBeCloseTo(0.091, 15);
  });
  it('accepts the fit size at exactly the ×0.2/×5 limits (fix round 1, minor 1)', () => {
    expect(fittedScale(scaleOf(null), { ...fit, scale: 0.2 }, scaleOf(0.1), 'T1').source).toBe('fit');
    expect(fittedScale(scaleOf(null), { ...fit, scale: 5 }, scaleOf(0.1), 'T1').source).toBe('fit');
  });
});

describe('refScaleOf (MS-4): a reference\'s scale for a fit — its ruler, else its machine scale (counts as calibrated, not G3 assumed), else assumed', () => {
  const f = (over: Partial<FilmFit> = {}): FilmFit => ({ refCaseId: 'g1', refKind: 'sn', refPoints: [[0, 0], [100, 0]], filmPoints: [[0, 0], [96, 0]], mirror: false,
    scale: 1.04, rotation: 0, dx: 0, dy: 0, useOwn: false, refTimepoint: 'T1', refSpacingMm: 0.1, refMachineSpacingMm: null, savedBy: 'x', savedAt: 'y', ...over });
  it('a ruler always wins', () => expect(refScaleOf(f())).toEqual(scaleOf(0.1)));
  it('no ruler, a machine scale on the reference: calibrated, not assumed (not G3)', () => {
    expect(refScaleOf(f({ refSpacingMm: null, refMachineSpacingMm: 0.0998 }))).toEqual({ mmPerPx: 0.0998, source: 'calibration', steps: 0 });
  });
  it('neither: the assumed scale', () => expect(refScaleOf(f({ refSpacingMm: null, refMachineSpacingMm: null }))).toEqual(scaleOf(null)));
  it('refuses undefined for the reference’s mm/px: only null means "no ruler" (fix round 1, minor 7, moved here MS-4)', () => {
    expect(() => refScaleOf(f({ refSpacingMm: undefined as unknown as null }))).toThrow();
  });
});

describe('toOpen: a film placed onto the open film through fits and S–N', () => {
  const P = (id: string, points: Shape, spacing: number | null, fit: Placed['fit'] = null): Placed => ({ id, points, facing: 'right', own: scaleOf(spacing), fit });
  const by = (m: Record<string, Placed>) => (id: string) => m[id] ?? null;
  const R = P('r', ref, 0.1);
  const gPts = mapAll(known(0.2, 1 / 1.05, { x: 400, y: 380 }));
  const G = P('g', gPts, null, { refId: 'r', pose: startPose([ref.S, ref.N], [gPts.S, gPts.N], false)! });
  it('a film fitted to the open film lands by its fit', () => {
    const s = toOpen(G, R, by({ r: R, g: G }))!; for (const k of keys) close(apply(s, gPts[k]), ref[k]);
  });
  it('the open film fitted to the other: the other lands by the fit undone', () => {
    const s = toOpen(R, G, by({ r: R, g: G }))!; for (const k of keys) close(apply(s, ref[k]), gPts[k]);
  });
  it('a third, un-fitted open film sees the fitted film through its reference, on S–N', () => {
    const oPts = mapAll(known(-0.1, 1, { x: 300, y: 320 })), O = P('o', oPts, 0.1);
    const s = toOpen(G, O, by({ r: R, g: G, o: O }))!;
    for (const k of keys) close(apply(s, gPts[k]), oPts[k]);     // O is R moved rigidly, so G lands on O's own points
  });
  it('two films fitted to one reference land on each other', () => {
    const hPts = mapAll(known(-0.4, 1.1, { x: 350, y: 300 }));
    const H = P('h', hPts, null, { refId: 'r', pose: startPose([ref.S, ref.N], [hPts.S, hPts.N], false)! });
    const s = toOpen(G, H, by({ r: R, g: G, h: H }))!; for (const k of keys) close(apply(s, gPts[k]), hPts[k]);
  });
  it('nothing when the reference is not loaded', () => expect(toOpen(G, P('o', ref, 0.1), by({ g: G }))).toBeNull());
  /** Fix round 1, minor 3: when neither film is fitted, the two ROOTS are the films themselves, so a facing
   *  difference between them must still mirror (every other test here uses facing 'right' on both sides). */
  it('mirrors across a facing difference between two un-fitted roots', () => {
    const leftPts = mapAll(known(0.15, 1, { x: 500, y: 600 }, true));
    const O = { ...P('o', leftPts, 0.1), facing: 'left' };
    const s = toOpen(R, O, by({ r: R, o: O }))!;
    for (const k of keys) close(apply(s, ref[k]), leftPts[k]);
  });
  /** Owner G2: a ruler-calibrated film's stored size is never used; it is placed at its true size. */
  it('a calibrated fitted film keeps its true size, at the ruler ratio — not inverted, not dropped (fix round 1, I2)', () => {
    const R875 = P('r', ref, 0.0875);                          // distinct from the film's own 0.11: direction matters
    const C = P('c', gPts, 0.11, { refId: 'r', pose: { ...G.fit!.pose, scale: 3 } });
    const s = toOpen(C, R875, by({ r: R875, c: C }))!;
    expect(dist(apply(s, gPts.S), apply(s, gPts.N))).toBeCloseTo(dist(gPts.S, gPts.N) * 0.11 / 0.0875, 9);
  });
  it('neither fitted: exactly today’s alignOnSN', () => {
    const oPts = mapAll(known(-0.1, 1.2, { x: 300, y: 320 })), O = P('o', oPts, 0.12);
    const s = toOpen(R, O, by({ r: R, o: O }))!, al = alignOnSN(oPts, ref, 0.1 / 0.12, false)!;
    for (const k of keys) close(apply(s, ref[k]), al(ref[k]));
  });
});

describe('ownPages: the film’s own pages and “Use the scale from the fit” (owner G2, Task 10)', () => {
  // SYNTHETIC: T2 fitted to T1 (ruler 0.1 mm/px) on S–N at ×1.04.
  const f = (o: Partial<FilmFit> = {}): FilmFit => ({ refCaseId: 'g1', refKind: 'sn', refPoints: [[0, 0], [100, 0]], filmPoints: [[0, 0], [96, 0]], mirror: false,
    scale: 1.04, rotation: 0, dx: 0, dy: 0, useOwn: false, refTimepoint: 'T1', refSpacingMm: 0.1, savedBy: 'SYNTHETIC', savedAt: 'x', ...o });
  it('switch off: the film keeps its own (assumed) scale, and the switch is offered, off, with the fit’s note', () => {
    const p = ownPages({ spacingMm: null, scaleSteps: 0, fit: f() });
    expect(p.scale).toEqual(scaleOf(null)); expect(p.own).toEqual(scaleOf(null));
    expect(p.offer).toEqual({ on: false, note: { ref: 'T1', kind: 'sn', k: 1.04, refAssumed: false } });
  });
  it('switch on: the fit’s scale (0.100 × 1.04 = 0.104 mm/px), the own scale kept for the comparison', () => {
    const p = ownPages({ spacingMm: null, scaleSteps: 0, fit: f({ useOwn: true }) });
    expect(p.scale.source).toBe('fit'); expect(p.scale.mmPerPx).toBeCloseTo(0.104, 15);
    expect(p.own).toEqual(scaleOf(null));
    expect(p.offer).toEqual({ on: true, note: { ref: 'T1', kind: 'sn', k: 1.04, refAssumed: false } });
  });
  it('a ruler always wins: a calibrated film with a fit (even one left switched on) keeps its ruler and is offered no switch', () => {
    for (const useOwn of [false, true]) {
      const p = ownPages({ spacingMm: 0.12, scaleSteps: 0, fit: f({ useOwn }) });
      expect(p.scale).toEqual(scaleOf(0.12)); expect(p.offer).toBe('ruler');
    }
  });
  it('no fit, or a fit it cannot use: no switch, the own scale', () => {
    for (const fit of [null, undefined, f({ scale: 9, useOwn: true })]) {
      const p = ownPages({ spacingMm: null, scaleSteps: 0, fit });
      expect(p.scale).toEqual(scaleOf(null)); expect(p.offer).toBeNull();
    }
    expect(ownPages({ spacingMm: 0.1, scaleSteps: 0, fit: null }).offer).toBeNull();
  });
  it('ownPages carries a fine-tune (spec 2026-10-19 addendum 3): a ruler film\'s presses on its own scale, with or without a fit (a ruler always wins)', () => {
    expect(ownPages({ spacingMm: 0.101, scaleSteps: 2, fit: null }).scale).toEqual({ mmPerPx: 0.101, source: 'calibration', steps: 2 });
    const p = ownPages({ spacingMm: 0.101, scaleSteps: 2, fit: f({ useOwn: true }) });
    expect([p.scale, p.own, p.offer]).toEqual([{ mmPerPx: 0.101, source: 'calibration', steps: 2 }, { mmPerPx: 0.101, source: 'calibration', steps: 2 }, 'ruler']);
  });
});

describe('ownPages with a machine scale (spec 2026-10-20: machine above fit)', () => {
  const fit = { refCaseId: 'r', refKind: 'sn', refPoints: [[0, 0], [10, 0]], filmPoints: [[0, 0], [10, 0]], mirror: false, scale: 1.04, rotation: 0, dx: 0, dy: 0,
    useOwn: true, refTimepoint: 'T1', refSpacingMm: 0.1, refMachineSpacingMm: null, savedBy: 'x', savedAt: 'y' } as FilmFit;
  it('a machine-scaled film with its switch on keeps the machine scale and is offered no switch', () => {
    const p = ownPages({ spacingMm: null, scaleSteps: 0, fit, machineScale: ms() });
    expect([p.scale.source, p.own.source, p.offer]).toEqual(['machine', 'machine', 'machine']);
  });
  it('a fit to a reference with only a machine scale is a fit to a calibrated scale (not G3 assumed)', () => {
    const p = ownPages({ spacingMm: null, scaleSteps: 0, fit: { ...fit, refSpacingMm: null, refMachineSpacingMm: 0.0998 }, machineScale: null });
    expect(p.scale).toMatchObject({ source: 'fit', mmPerPx: 0.0998 * 1.04, fit: { refAssumed: false } });
  });
  it('no machine scale anywhere: exactly as before', () => {
    expect(ownPages({ spacingMm: null, scaleSteps: 0, fit })).toEqual(ownPages({ spacingMm: null, scaleSteps: 0, fit, machineScale: null }));
  });
});
