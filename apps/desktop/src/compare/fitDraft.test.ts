import { describe, it, expect } from 'vitest';
import type { Vec2 } from '@ceph/geometry';
import type { SeriesFilm } from '../ipc';
import type { MachineScale } from '../tracing/spacing';
import { apply, simOf, startPose } from './fit';
import { defaultReference, draftReducer, fitBlock, pickStep, references, startDraft, toSave, type DraftFilm } from './fitDraft';
// Spec 2026-10-20 (owner MS1–MS4). SYNTHETIC machine and dates.
const ms = (over: Partial<MachineScale> = {}): MachineScale => ({ machineId: 'm1', machineName: 'Demo Radiology', spacingMm: 0.0998, widthPx: 2400, heightPx: 3000,
  source: 'film', sourceCaseId: 'c9', sourceFilmDate: '2025-03-12', setAt: '2026-10-24T00:00:00.000Z', applies: true, ...over });

// SYNTHETIC films: T1 (ruler 0.1), T2 (no ruler, its S–N 4 % shorter), T3 (ruler 0.12).
const pts = (k: number, dx = 0): Record<string, Vec2> => ({ S: { x: 250 + dx, y: 300 }, N: { x: 250 + dx + 700 * k, y: 300 - 100 * k }, Me: { x: 250 + dx + 640 * k, y: 300 + 850 * k } });
const F = (id: string, label: string, k: number, spacingMm: number | null, over: Partial<DraftFilm> = {}): DraftFilm =>
  ({ id, label, points: pts(k, id === 't2' ? 20 : 0), facing: 'right', spacingMm, dims: { W: 1200, H: 1400 }, ...over });
const t1 = F('t1', 'T1', 1, 0.1), t2 = F('t2', 'T2', 0.96, null), t3 = F('t3', 'T3', 1, 0.12);
const close = (a: Vec2, b: Vec2) => { expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); };

describe('the draft of a fit (spec G step 2)', () => {
  it('starts at the S–N superimposition, sized so the S–N distances are equal', () => {
    const s = startDraft(t1, t2, null);
    expect([s.kind, s.saved, s.locked, s.message, s.show]).toEqual(['sn', false, null, null, 'both']);
    expect(s.pose.scale).toBeCloseTo(1 / 0.96, 12);
    close(apply(simOf(s.pose), t2.points.N), t1.points.N);
  });
  it('without S or N on a film it cannot start from S–N, says so, and cannot be saved', () => {
    const { N: _n, ...noN } = t2.points;
    const s = startDraft(t1, { ...t2, points: noN }, null);
    expect([s.start, s.message, toSave(s)]).toEqual([null, 'Place S and N on both films to start from S–N, or choose two points you pick.', null]);
    close(apply(simOf(s.pose), { x: 599.5, y: 699.5 }), { x: 599.5, y: 699.5 });      // drawn centre on centre meanwhile
  });
  /** Owner G2: a ruler-calibrated film's size is locked at its true size; − / + and a typed size do nothing. */
  it('locks the size of a ruler-calibrated film (G2)', () => {
    const s = startDraft(t1, t3, null);
    expect(s.locked).toBeCloseTo(0.12 / 0.1, 12);
    expect(s.pose.scale).toBeCloseTo(1.2, 12);
    for (const a of [{ type: 'step', n: 1 }, { type: 'size', k: 1.5 }] as const) expect(draftReducer(s, a).pose.scale).toBeCloseTo(1.2, 12);
  });
  /** MS-4: a machine-scaled film (no ruler) locks its size the same way a ruler-calibrated film does. */
  it('locks the size of a machine-scaled film (MS-4: machine above fit, like a ruler)', () => {
    const t2m = F('t2', 'T2', 0.96, null, { machineScale: ms({ spacingMm: 0.12 }) });
    const s = startDraft(t1, t2m, null);
    expect(s.locked).toBeCloseTo(0.12 / 0.1, 12);
    expect(s.pose.scale).toBeCloseTo(1.2, 12);
  });
  it('steps the size by 0.001 (rounded) and refuses a size it cannot use', () => {
    const s = startDraft(t1, t2, null);
    expect(draftReducer(s, { type: 'step', n: 1 }).pose.scale).toBe(1.043);
    expect(draftReducer(s, { type: 'step', n: -10 }).pose.scale).toBe(1.032);
    for (const k of [NaN, 0.1, 6]) {
      const r = draftReducer(s, { type: 'size', k });
      expect([r.pose.scale, r.message]).toEqual([s.pose.scale, 'The size must be between ×0.200 and ×5.000.']);
    }
    expect(draftReducer(s, { type: 'size', k: 5 }).pose.scale).toBe(5);
  });
  it('moves and turns about the landed S', () => {
    const s = draftReducer(draftReducer(startDraft(t1, t2, null), { type: 'move', d: { x: 3, y: -2 } }), { type: 'turn', rad: 0.1 });
    close(apply(simOf(s.pose), t2.points.S), { x: t1.points.S.x + 3, y: t1.points.S.y - 2 });
    expect(s.pose.rotation).toBeCloseTo(0.1, 12);
  });
  it('two points you pick: two on the reference, then the same two on the film, read through how it is drawn', () => {
    let s = draftReducer(startDraft(t1, t2, null), { type: 'kind', kind: 'points' });
    expect([s.picks, s.show, toSave(s), pickStep(s)]).toEqual([[], 'ref', null, 'Click a stable point on T1 (for example the front wall of sella turcica).']);
    const A = { x: 400, y: 330 }, B = { x: 700, y: 1000 };               // on T1
    s = draftReducer(draftReducer(s, { type: 'pick', at: A }), { type: 'pick', at: B });
    expect([s.show, pickStep(s)]).toEqual(['film', 'Click the same first point on T2.']);
    // The operator clicks where T2's own A and B are DRAWN now (screen → reference px).
    const onT2 = (p: Vec2) => ({ x: 270 + (p.x - 250) * 0.96, y: 300 + (p.y - 300) * 0.96 });   // T2 is T1 shrunk 4 % about S, moved 20 px
    const drawn = simOf(s.pose);
    s = draftReducer(draftReducer(s, { type: 'pick', at: apply(drawn, onT2(A)) }), { type: 'pick', at: apply(drawn, onT2(B)) });
    expect([s.picks.length, s.show, pickStep(s), s.message]).toEqual([4, 'both', null, null]);
    close(s.picks[2], onT2(A)); close(s.picks[3], onT2(B));
    expect(s.pose.scale).toBeCloseTo(1 / 0.96, 9);
    const f = toSave(s)!;
    expect([f.refKind, f.refPoints, f.filmPoints.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6))]).toEqual(['points', [[400, 330], [700, 1000]],
      [[onT2(A).x, onT2(A).y], [onT2(B).x, onT2(B).y]].map((p) => p.map((v) => Math.round(v * 1e6) / 1e6))]);
  });
  it('points picked too close together are refused and picked again', () => {
    let s = draftReducer(startDraft(t1, t2, null), { type: 'kind', kind: 'points' });
    for (const at of [{ x: 400, y: 330 }, { x: 405, y: 330 }, { x: 400, y: 330 }, { x: 405, y: 330 }]) s = draftReducer(s, { type: 'pick', at });
    expect([s.picks, s.show, s.message]).toEqual([[], 'ref', 'Pick two points at least 20 px apart on each film, then try again.']);
  });
  /** A saved fit reopens as it was saved, anchored on its SAVED points — even if S was moved since. */
  it('reopens a saved fit as saved, and saves it again on its own anchor', () => {
    const p = startPose([t1.points.S, t1.points.N], [t2.points.S, t2.points.N], false)!;
    const saved = { refCaseId: 't1', refKind: 'sn' as const, refPoints: [[250, 300], [950, 200]] as [[number, number], [number, number]],
      filmPoints: [[270, 300], [942, 204]] as [[number, number], [number, number]], mirror: false, scale: 1.05, rotation: p.rotation + 0.01, dx: 4, dy: 1 };
    const moved = { ...t2, points: { ...t2.points, S: { x: 290, y: 310 } } };
    const s = startDraft(t1, moved, saved);
    expect([s.saved, s.kind, s.pose.scale, s.pose.dx]).toEqual([true, 'sn', 1.05, 4]);
    expect(toSave(s)).toEqual(saved);
    // Owner D-f (18 Oct, supersedes the plan): Reset goes back to the SAVED fit, still on its own anchor …
    expect(draftReducer(draftReducer(s, { type: 'step', n: 3 }), { type: 'restart' }).pose).toEqual(s.pose);
    // … and only with nothing saved does it start again from today's S–N.
    expect(draftReducer(draftReducer(s, { type: 'saved', fit: null }), { type: 'restart' }).pose.b).toEqual({ x: 290, y: 310 });
  });
});

/** Owner D-f, 18 Oct (binding; supersedes the plan's "Reset removes the saved fit"): Reset discards unsaved changes back
 *  to the last SAVED fit — the S–N start when nothing is saved — and writes nothing; "Remove fit" is the separate way to
 *  remove a saved fit (the draft then reads as unsaved), and undoing it puts the saved placement back. */
describe('Reset and Remove fit (owner D-f)', () => {
  const p = startPose([t1.points.S, t1.points.N], [t2.points.S, t2.points.N], false)!;
  const saved = { refCaseId: 't1', refKind: 'sn' as const, refPoints: [[250, 300], [950, 200]] as [[number, number], [number, number]],
    filmPoints: [[270, 300], [942, 204]] as [[number, number], [number, number]], mirror: false, scale: 1.043, rotation: p.rotation, dx: 2, dy: -1 };
  const changed = (s: ReturnType<typeof startDraft>) => [{ type: 'step', n: 5 }, { type: 'move', d: { x: 7, y: 3 } }, { type: 'turn', rad: 0.05 }, { type: 'show', show: 'film' }]
    .reduce((q, a) => draftReducer(q, a as Parameters<typeof draftReducer>[1]), s);
  it('Reset after a save goes back to the saved placement, discarding every unsaved change', () => {
    const s = startDraft(t1, t2, saved), c = changed(s);
    expect(c.pose).not.toEqual(s.pose);                                          // the control: the changes did move it
    const r = draftReducer(c, { type: 'restart' });
    expect([r.pose, r.saved, r.kind, toSave(r)]).toEqual([s.pose, true, 'sn', saved]);
  });
  it('Reset with nothing saved goes back to the S–N start, from S–N or from two picked points', () => {
    const s = startDraft(t1, t2, null), c = changed(s);
    expect(c.pose).not.toEqual(s.pose);
    expect(draftReducer(c, { type: 'restart' }).pose).toEqual(s.pose);
    let q = draftReducer(s, { type: 'kind', kind: 'points' });
    for (const at of [{ x: 400, y: 330 }, { x: 700, y: 1000 }, { x: 420, y: 330 }, { x: 700, y: 980 }]) q = draftReducer(q, { type: 'pick', at });
    expect(q.pose).not.toEqual(s.pose);
    const r = draftReducer(q, { type: 'restart' });
    expect([r.kind, r.pose, r.picks, r.show]).toEqual(['sn', s.pose, [], 'both']);
  });
  it('a removed fit leaves an unsaved draft at the S–N start; putting it back restores the saved placement', () => {
    const s = startDraft(t1, t2, saved), c = changed(s);
    const removed = draftReducer(c, { type: 'saved', fit: null });
    expect([removed.saved, removed.pose, removed.message]).toEqual([false, startDraft(t1, t2, null).pose, null]);
    const back = draftReducer(removed, { type: 'saved', fit: saved });
    expect([back.saved, back.pose, toSave(back)]).toEqual([true, s.pose, saved]);
  });
  it('a fit saved to ANOTHER reference counts as saved (it can be removed) but Reset starts from S–N on this one', () => {
    const s = startDraft(t1, t2, { ...saved, refCaseId: 't9' });
    expect([s.saved, s.pose]).toEqual([true, startDraft(t1, t2, null).pose]);
    expect(draftReducer(changed(s), { type: 'restart' }).pose).toEqual(s.pose);
  });
});

describe('which films can be a reference (plan D-d)', () => {
  const f = (id: string, tp: string, over: Partial<SeriesFilm> = {}): SeriesFilm => ({ id, timepoint: tp, takenOn: `202${tp.slice(1)}-01-01`, takenOnSource: 'label',
    createdAt: id, stage: null, inSeries: true, nameOnly: false, fitRef: null, calibrated: false, ...over });
  it('the earliest film with a ruler, else the earliest; never a fitted film', () => {
    const films = [f('c', 'T3', { calibrated: true }), f('a', 'T1'), f('b', 'T2', { fitRef: 'a' })];
    expect(references(films, 'd').map((x) => x.id)).toEqual(['a', 'c']);
    expect(defaultReference(films, 'd')?.id).toBe('c');
    expect(defaultReference([f('a', 'T1'), f('d', 'T4')], 'd')?.id).toBe('a');
  });
  it('says why "Scale now" cannot start', () => {
    expect(fitBlock([f('a', 'T1')], 'a', true)).toBe('Name the patient first.');
    expect(fitBlock([f('a', 'T1')], 'a', false)).toBe('No other X-ray of this patient to scale it to.');
    expect(fitBlock([f('a', 'T1'), f('b', 'T2', { fitRef: 'a' })], 'a', false)).toBe('T2 is scaled to this film; remove that fit first.');
    expect(fitBlock([f('a', 'T1'), f('b', 'T2', { fitRef: 'a' })], 'b', false)).toBeNull();     // its own fit can be adjusted
    expect(fitBlock([f('a', 'T1', { fitRef: 'b' }), f('b', 'T2')], 'b', false)).toBe('T1 is scaled to this film; remove that fit first.');
  });
});
