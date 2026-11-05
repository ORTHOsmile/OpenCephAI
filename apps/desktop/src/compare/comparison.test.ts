import { describe, it, expect } from 'vitest';
import { compile, type AnalysisDef, type Expr, type Vec2 } from '@ceph/geometry';
import { docOf } from '../library/fixtures';
import type { CaseDoc, FilmFit, SeriesFilm } from '../ipc';
import { scaleOf } from '../tracing/spacing';
import { alignOnSN } from './align';
import { buildComparison, fittedValues, type Comparison, type ComparisonInput } from './comparison';
import { fittedScale } from './fit';
import { startPose } from './fit';

// SYNTHETIC: three landmarks and three measurements (mm, an angle and a ratio) are enough to see every rule.
const nodes: Record<string, Expr> = { S: { kind: 'landmark', id: 'S' }, N: { kind: 'landmark', id: 'N' }, Me: { kind: 'landmark', id: 'Me' },
  SN: { kind: 'distance', a: 'S', b: 'N' }, NSMe: { kind: 'angle3', a: 'N', vertex: 'S', b: 'Me' },
  // Task 6: a ratio of two mm distances — mathematically free of the scale, but (a·k)/(b·k) can differ from a/b in the
  // last bit (this one does on T2 at ×1.042: 89.46345577730837 vs …835), so the "angles and ratios never change with a
  // fit" check needs one.
  SMe: { kind: 'distance', a: 'S', b: 'Me' }, NMe: { kind: 'distance', a: 'N', b: 'Me' }, MeRatio: { kind: 'ratio', a: 'NMe', b: 'SMe', percent: true } };
const compiled = compile(nodes);
const defs: AnalysisDef[] = [{ id: 'syn', name: 'SYNTHETIC', nodes: {}, measurements: [{ node: 'SN', label: 'S–N' }, { node: 'NSMe', label: 'N-S-Me' }, { node: 'MeRatio', label: 'N–Me / S–Me' }] }];
const shape = (k: number, dx = 0, dy = 0, mirror = false): Record<string, Vec2> => Object.fromEntries(
  Object.entries({ S: [0, 0], N: [700, -100], Me: [640, 850] }).map(([id, [x, y]]) => {
    const px = 250 + dx + k * x; return [id, { x: mirror ? 1199 - px : px, y: 300 + dy + k * y }]; }));
const doc = (id: string, tp: string, spacingMm: number | null, pts: Record<string, Vec2>, over: Partial<CaseDoc> = {}): CaseDoc =>
  docOf({ id, facing: 'right', orientation: { mirror: false, rotDeg: 0, source: 'none' }, display: {} as never,
    landmarks: Object.entries(pts).map(([lid, p]) => ({ id: lid, x: p.x, y: p.y, source: 'manual', verified: true, aiX: null, aiY: null, confidence: null })) },
    { timepoint: tp, spacingMm, takenOn: `202${tp.slice(1)}-01-10`, takenOnSource: 'label', patientKey: 'demo series', ...over });
const series = (d: CaseDoc): SeriesFilm => ({ id: d.id, timepoint: d.timepoint, takenOn: d.takenOn, takenOnSource: 'label', createdAt: d.id,
  stage: null, inSeries: true, nameOnly: false, fitRef: d.fit?.refCaseId ?? null, calibrated: d.spacingMm !== null });
const input = (open: CaseDoc, others: CaseDoc[], over: Partial<ComparisonInput> = {}): ComparisonInput => {
  const pts = Object.fromEntries(open.landmarks.map((l) => [l.id, { x: l.x, y: l.y }]));
  const openScale = scaleOf(open.spacingMm);
  return { open, openPoints: pts, openValues: compiled.evaluate(pts, openScale.mmPerPx), openScale,
    films: [open, ...others].map(series), docs: Object.fromEntries(others.map((d) => [d.id, d])), failed: new Set(),
    compiled, defs, dateFormat: 'AU', pairChoice: null, ...over };
};

describe('buildComparison: what the Superimposition page showed before request G (plan Task 2)', () => {
  it('aligns another film on S–N at S through each film’s own scale, exactly as alignOnSN', () => {
    const t1 = doc('t1', 'T1', 0.1, shape(1)), t2 = doc('t2', 'T2', 0.2, shape(0.5, 30, 20));
    const c = buildComparison(input(t1, [t2]));
    const al = alignOnSN(shape(1), shape(0.5, 30, 20), 0.2 / 0.1, false)!;
    expect(c.tracings.map((t) => t.id)).toEqual(['t2']);
    for (const [k, p] of Object.entries(shape(0.5, 30, 20))) expect(c.tracings[0].points[k]).toEqual(al(p));
    const sn = c.change!.rows.find((r) => r.node === 'SN')!;
    expect(sn.values[0]).toBeCloseTo(Math.hypot(700, 100) * 0.1, 9);
    expect(sn.values[1]).toBeCloseTo(Math.hypot(350, 50) * 0.2, 9);
  });
  it('hides the mm of a film with no ruler, keeps its angles, and says why', () => {
    const t1 = doc('t1', 'T1', 0.1, shape(1)), t2 = doc('t2', 'T2', null, shape(0.96, 20, 10));
    const c = buildComparison(input(t1, [t2]));
    const sn = c.change!.rows.find((r) => r.node === 'SN')!, ang = c.change!.rows.find((r) => r.node === 'NSMe')!;
    expect([sn.values[1], sn.hidden?.[1], sn.hidden?.[0]]).toEqual([null, true, false]);
    expect(ang.values[1]).not.toBeNull();
    expect(c.change!.note).toBe('mm on a film not yet calibrated are hidden: calibrate each film from its ruler (K). Angles are unaffected.');
  });
  it('mirrors a film that faces the other way', () => {
    const t1 = doc('t1', 'T1', 0.1, shape(1)), t3 = doc('t3', 'T3', 0.1, shape(1, 0, 0, true), { facing: 'left' });
    const c = buildComparison(input(t1, [t3]));
    for (const k of ['S', 'N', 'Me']) { expect(c.tracings[0].points[k].x).toBeCloseTo(shape(1)[k].x, 9); expect(c.tracings[0].points[k].y).toBeCloseTo(shape(1)[k].y, 9); }
  });
  it('names a film it could not open and one without S and N, and draws neither', () => {
    const t1 = doc('t1', 'T1', 0.1, shape(1)), t2 = doc('t2', 'T2', 0.1, shape(1)), { N: _n, ...noN } = shape(1), t3 = doc('t3', 'T3', 0.1, noN);
    const x = input(t1, [t2, t3]); x.failed = new Set(['t2']); delete x.docs.t2;
    const c = buildComparison(x);
    expect(c.tracings).toEqual([]);
    expect(c.lines.map((l) => [l.id, l.note])).toEqual([['t1', null], ['t2', 'Couldn’t open this film'], ['t3', 'Place S and N to draw it']]);
  });
  it('asks for a name before an unnamed patient’s films can be compared', () => {
    const t1 = doc('t1', 'T1', 0.1, shape(1), { patientKey: '~t1' });
    expect(buildComparison(input(t1, [])).hint).toBe('Name the patient to compare their films');
  });
});

describe('buildComparison with request G fits (owner G2, G3; plan D-a, D-b)', () => {
  const t1 = doc('t1', 'T1', 0.1, shape(1)), t2pts = shape(0.96, 20, 10), t3 = doc('t3', 'T3', 0.12, shape(1, -10, 0, true), { facing: 'left' });
  const fitFor = (film: Record<string, Vec2>, refPts: Record<string, Vec2>, refId: string, refTp: string, refSpacing: number | null): FilmFit => {
    const p = startPose([refPts.S, refPts.N], [film.S, film.N], false)!;
    return { refCaseId: refId, refKind: 'sn', refPoints: [[refPts.S.x, refPts.S.y], [refPts.N.x, refPts.N.y]], filmPoints: [[film.S.x, film.S.y], [film.N.x, film.N.y]],
      mirror: false, scale: p.scale, rotation: p.rotation, dx: 0, dy: 0, useOwn: false, refTimepoint: refTp, refSpacingMm: refSpacing, savedBy: 'x', savedAt: 'x' };
  };
  const t2 = doc('t2', 'T2', null, t2pts, { fit: fitFor(t2pts, shape(1), 't1', 'T1', 0.1) }), t2plain = doc('t2', 'T2', null, t2pts);
  const row = (c: Comparison, node: string) => c.change!.rows.find((r) => r.node === node)!;
  it('takes the fitted film’s mm from the fit — its S–N then equals T1’s, the growth it hides — and marks it', () => {
    const c = buildComparison(input(t1, [t2, t3]));
    expect(row(c, 'SN').values[1]).toBeCloseTo(row(c, 'SN').values[0]!, 9);
    expect(row(c, 'SN').hidden?.[1]).toBe(false);
    expect(c.change!.marks).toEqual([null, 'scaled to T1 on S–N (×1.042)', null]);
    expect(c.change!.fitted).toEqual([false, true, false]);                  // † goes on T2's mm only
    expect(c.change!.fitNotes).toEqual(['T2 scaled to T1 on S–N (×1.042)']);   // fix round 2: shown as “† T2 scaled to T1 on S–N (×1.042)”
    expect(c.change!.note).toBeNull();
    expect(c.lines.find((l) => l.id === 't2')!.fit).toBe('Scaled to T1 on S–N (×1.042)');
  });
  it('leaves every un-fitted column and outline exactly as without the fit (Object.is), and moves the fitted one', () => {
    const a = buildComparison(input(t1, [t2, t3])), b = buildComparison(input(t1, [t2plain, t3]));
    for (const r of a.change!.rows) { const s = b.change!.rows.find((q) => q.node === r.node)!;
      for (const i of [0, 2]) { expect(Object.is(r.values[i], s.values[i])).toBe(true); expect(r.hidden?.[i]).toBe(s.hidden?.[i]); } }
    // Pre-flight ruling (a): the FITTED column's angles and ratios never change with a fit.
    for (const r of a.change!.rows.filter((q) => q.unit !== 'mm')) { const s = b.change!.rows.find((q) => q.node === r.node)!; expect(Object.is(r.values[1], s.values[1])).toBe(true); }
    expect(a.change!.rows.filter((q) => q.unit !== 'mm').map((q) => q.node)).toEqual(['NSMe', 'MeRatio']);   // rows compared > 0: an angle and a ratio
    expect(a.tracings.find((t) => t.id === 't3')).toEqual(b.tracings.find((t) => t.id === 't3'));
    expect(a.tracings.find((t) => t.id === 't2')).not.toEqual(b.tracings.find((t) => t.id === 't2'));   // the control
  });
  it('lands the fitted film with its S and N on the reference’s', () => {
    const p = buildComparison(input(t1, [t2])).tracings[0].points;
    for (const k of ['S', 'N']) { expect(p[k].x).toBeCloseTo(shape(1)[k].x, 9); expect(p[k].y).toBeCloseTo(shape(1)[k].y, 9); }
  });
  it('a ruler-calibrated film with a fit keeps its own mm, unmarked (G2, D-a)', () => {
    const c = buildComparison(input(t1, [doc('t2', 'T2', 0.1, t2pts, { fit: fitFor(t2pts, shape(1), 't1', 'T1', 0.1) })]));
    expect(row(c, 'SN').values[1]).toBeCloseTo(Math.hypot(672, 96) * 0.1, 9);
    expect(c.change!.marks).toEqual([null, null]);
    expect(c.lines.find((l) => l.id === 't2')!.fit).toBe('Placed on T1 by hand; its ruler gives its size');
  });
  it('G3 / D-b: a reference with no ruler shows its mm marked “assumed scale”; the fitted film says so too', () => {
    const c = buildComparison(input(doc('t1', 'T1', null, shape(1)), [doc('t2', 'T2', null, t2pts, { fit: fitFor(t2pts, shape(1), 't1', 'T1', null) })]));
    expect(row(c, 'SN').hidden).toEqual([false, false]);
    expect(c.change!.marks).toEqual(['assumed scale', 'scaled to T1 on S–N (×1.042), assumed scale']);
    // Fix round 2: † means exactly "scaled by a fit" — the reference's mm (assumed scale, not fitted) carry none.
    expect(c.change!.fitted).toEqual([false, true]);
    expect(c.change!.fitNotes).toEqual(['T2 scaled to T1 on S–N (×1.042), assumed scale']);
    expect(row(c, 'SN').values[0]).toBeCloseTo(Math.hypot(700, 100) * 0.1, 9);
  });
  it('fix round 1, I-1: a move-only fit on a RULER film (D-a) does not unhide a reference with no ruler — no mixed-scale mm change', () => {
    const ref = doc('t1', 'T1', null, shape(1)), ruled = doc('t2', 'T2', 0.1, t2pts, { fit: fitFor(t2pts, shape(1), 't1', 'T1', null) });
    const c = buildComparison(input(ref, [ruled]));
    expect(row(c, 'SN').hidden).toEqual([true, false]);                      // T1's S–N stays "calibrate to show", as without the fit
    expect(row(c, 'SN').values[0]).toBeNull();
    expect(row(c, 'SN').values[1]).toBeCloseTo(Math.hypot(672, 96) * 0.1, 9);   // T2's own ruler mm
    expect(c.change!.marks).toEqual([null, null]);
    expect(c.lines.find((l) => l.id === 't2')!.fit).toBe('Placed on T1 by hand; its ruler gives its size');
  });
  it('fix round 2: two fitted films of different sizes — one note line each, naming the film', () => {
    const t3pts = shape(0.9, 5, 5), t3fit = doc('t3', 'T3', null, t3pts, { fit: fitFor(t3pts, shape(1), 't1', 'T1', 0.1) });
    const c = buildComparison(input(t1, [t2, t3fit]));
    expect(c.change!.fitted).toEqual([false, true, true]);
    expect(c.change!.fitNotes).toEqual(['T2 scaled to T1 on S–N (×1.042)', 'T3 scaled to T1 on S–N (×1.111)']);
  });
  it('a film with no ruler that nothing is fitted to stays hidden, as on main', () => {
    expect(row(buildComparison(input(doc('t1', 'T1', null, shape(1)), [t2plain])), 'SN').hidden).toEqual([true, true]);
  });
  it('a film fitted to it but UNTICKED does not unhide a reference with no ruler (D-b: only a ticked fitted film does)', () => {
    const x = input(doc('t1', 'T1', null, shape(1)), [doc('t2', 'T2', null, t2pts, { fit: fitFor(t2pts, shape(1), 't1', 'T1', null) }), t3]);
    x.films = x.films.map((f) => (f.id === 't2' ? { ...f, inSeries: false } : f));
    const c = buildComparison(x);
    expect(c.change!.ids).toEqual(['t1', 't3']);
    expect(row(c, 'SN').hidden).toEqual([true, false]);
    expect(c.change!.marks).toEqual([null, null]);
  });
  it('the open film fitted: its own column uses the fit; the reference lands by the fit undone', () => {
    const c = buildComparison(input(t2, [t1]));                 // films [t2, t1]: the open, fitted film first
    expect(row(c, 'SN').values[0]).toBeCloseTo(row(c, 'SN').values[1]!, 9);
    expect(c.change!.marks).toEqual(['scaled to T1 on S–N (×1.042)', null]);
    const p = c.tracings[0].points;
    for (const k of ['S', 'N']) { expect(p[k].x).toBeCloseTo(t2pts[k].x, 9); expect(p[k].y).toBeCloseTo(t2pts[k].y, 9); }
  });
  it('draws and tabulates the fit being adjusted, live, in place of the saved one', () => {
    const p = { ...startPose([shape(1).S, shape(1).N], [t2pts.S, t2pts.N], false)!, scale: 1.1 };
    const c = buildComparison({ ...input(t1, [t2]), draft: { film: 't2', pose: p, kind: 'sn' } });
    expect(c.change!.marks[1]).toBe('scaled to T1 on S–N (×1.100)');
    expect(row(c, 'SN').values[1]).toBeCloseTo(Math.hypot(672, 96) * 0.1 * 1.1, 9);
  });
  it('offers "Adjust fit…" on a ticked film that can be fitted, not on one another film is fitted to', () => {
    const c = buildComparison(input(t1, [t2, t3]));
    expect(c.lines.map((l) => [l.id, l.canFit])).toEqual([['t1', false], ['t2', true], ['t3', true]]);
  });
  it('a fit whose reference is not loaded is ignored: the film reads as before', () => {
    const c = buildComparison(input(t1, [doc('t2', 'T2', null, t2pts, { fit: fitFor(t2pts, shape(1), 'gone', 'T9', 0.1) })]));
    expect(row(c, 'SN').hidden?.[1]).toBe(true);
    expect(c.change!.marks).toEqual([null, null]);
  });
  it('puts the advice on each ticked film that is not scaled, and none on a fitted or calibrated film', () => {
    const c = buildComparison(input(t1, [t2plain, t3]));
    expect(c.lines.map((l) => [l.id, l.advice?.filmLabel ?? null])).toEqual([['t1', null], ['t2', 'T2'], ['t3', null]]);
    expect(buildComparison(input(t1, [t2, t3])).lines.find((l) => l.id === 't2')!.advice).toBeNull();
  });
});

describe('fittedValues: the film’s own page with “Use the scale from the fit” on (owner G2, Task 10)', () => {
  const pts = shape(0.96, 20, 10), own = compiled.evaluate(pts, 0.1);
  const fit = fittedScale(scaleOf(null), { scale: 1 / 0.96, refKind: 'sn' }, scaleOf(0.1), 'T1');
  it('angles and ratios are bit-identical to the switch-off values (Object.is); only mm take the fit', () => {
    const v = fittedValues(own, compiled, pts, fit);
    const others = Object.keys(own).filter((k) => !(own[k]?.t === 'scalar' && (own[k] as { unit: string }).unit === 'mm'));
    let compared = 0;
    for (const k of others) { expect(Object.is(v[k], own[k])).toBe(true); compared++; }
    expect(compared).toBeGreaterThan(0);
    expect(others).toEqual(expect.arrayContaining(['NSMe', 'MeRatio']));        // an angle and a ratio (the ratio moves in its last bit if recomputed)
    const at = compiled.evaluate(pts, fit.mmPerPx);
    for (const k of ['SN', 'SMe', 'NMe']) expect(v[k]).toEqual(at[k]);
    expect((v.SN as { v: number }).v).toBeCloseTo((own.SN as { v: number }).v / 0.96, 9);
  });
  it('switch off, or a ruler: the own values, untouched', () => {
    expect(fittedValues(own, compiled, pts, scaleOf(null))).toBe(own);
    expect(fittedValues(own, compiled, pts, scaleOf(0.1))).toBe(own);
  });
});
