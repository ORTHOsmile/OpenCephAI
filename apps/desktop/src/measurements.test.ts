import { describe, it, expect } from 'vitest';
import { compile } from '@ceph/geometry';
import { ALL_ANALYSES, BUILT_INS, buildRegistry, ISBI19, LANDMARKS, MCNAMARA, STEINER, unconfirmedAiPointsLine } from '@ceph/analyses';
import { measurementRows, missingPoints, missingText, otherLandmarks, placedViaOf, placerOf, placerStatus, rowKey, unconfirmedAiPoints, unplacedLandmarks } from './measurements';
import { DEFAULT_DECIMALS } from './format';
import { scaleOf } from './tracing/spacing';
import { initialTracing, tracingReducer } from './tracing/state';

const g = compile(buildRegistry(BUILT_INS));
const pos = { S: { x: 0, y: 0 }, N: { x: 700, y: -100 }, A: { x: 720, y: 300 }, B: { x: 690, y: 650 }, Gn: { x: 680, y: 820 } };
describe('measurement rows', () => {
  const rows = measurementRows([STEINER, MCNAMARA], g, g.evaluate(pos, 0.1), new Set(Object.keys(pos)), DEFAULT_DECIMALS);
  it('formats present values with their unit', () => {
    expect(rows.find((r) => r.node === 'm01_SNA')!.value).toMatch(/^\d+\.\d°$/);
  });
  // Owner DEC-1 (Task 4 fix round 2): measured values use the same formatter and setting as the norm text.
  it('the operator decimals setting reaches the measured value (3 → three decimals)', () => {
    const three = measurementRows([STEINER], g, g.evaluate(pos, 0.1), new Set(Object.keys(pos)), 3).find((r) => r.node === 'm01_SNA')!;
    expect(three.value).toMatch(/^\d+\.\d{3}°$/);
  });
  it('lists exactly the missing landmarks instead of a value', () => {
    const coa = rows.find((r) => r.node === 'm10_CoA')!;
    expect(coa.value).toBeNull(); expect(coa.needs).toEqual(['Co']);
  });
  it('Review Focus 2 in the UI: coincident points give an explicit reason, not an empty "Needs:"', () => {
    const same = { ...pos, N: { ...pos.S } };
    const r = measurementRows([STEINER], g, g.evaluate(same, 0.1), new Set(Object.keys(same)), DEFAULT_DECIMALS).find((x) => x.node === 'm01_SNA')!;
    expect(r.value).toBeNull(); expect(r.needs).toEqual([]);
    expect(r.undefinedReason).toMatch(/coincide/);
    const ok = rows.find((x) => x.node === 'm01_SNA')!;
    expect(ok.undefinedReason).toBeNull();
  });
  it('a built-in row resolves its norm as itself (normAnalysisId === analysisId)', () => {
    for (const r of rows) expect(r.normAnalysisId).toBe(r.analysisId);
  });
});

// P24: zBand duplicated @ceph/analyses' band() thresholds and is now deleted; the Inspector's colour comes from
// normCell/band instead (Task 4/5). grep -rn zBand apps/desktop/src finds nothing once this lands.

describe('mm hidden until the film is calibrated (N5)', () => {
  // P2: Pog to NB measures along FH, so the fixture needs Po and Or as well as Pog.
  const full = { ...pos, Pog: { x: 700, y: 760 }, Po: { x: -200, y: 100 }, Or: { x: 560, y: 80 } };
  const rowsAt = (spacing: number | null) =>
    measurementRows([STEINER], g, g.evaluate(full, scaleOf(spacing).mmPerPx), new Set(Object.keys(full)), DEFAULT_DECIMALS, scaleOf(spacing));
  it('the fixture really computes Pog to NB (control: without this, the hidden check could pass for the wrong reason)', () => {
    expect(g.evaluate(full, 0.1)['m18_PogNB']).not.toBeNull();
  });
  it('assumed scale: an mm row is hidden, with no number in it', () => {
    const r = rowsAt(null).find((x) => x.node === 'm18_PogNB')!;
    expect([r.hidden, r.value, r.num, r.unit]).toEqual([true, null, null, 'mm']);
  });
  it('assumed scale: an angle shows straight away', () => {
    const r = rowsAt(null).find((x) => x.node === 'm01_SNA')!;
    expect(r.hidden).toBe(false); expect(r.num).not.toBeNull();
  });
  it('calibrated: the mm row shows its number (positive control)', () => {
    const r = rowsAt(0.1).find((x) => x.node === 'm18_PogNB')!;
    expect(r.hidden).toBe(false); expect(r.value).toMatch(/ mm$/);
  });
  it('rows carry the analysis id the resolver needs', () => {
    expect(rowsAt(0.1).every((x) => x.analysisId === 'steiner')).toBe(true);
  });
  // Edge case: no scale passed at all (the Change table's seriesRows path never
  // builds MeasurementRow, but a defensive caller might) — never hidden, since nothing says it's uncalibrated.
  it('no scale argument at all: mm rows are not hidden', () => {
    const r = measurementRows([STEINER], g, g.evaluate(full, 0.1), new Set(Object.keys(full)), DEFAULT_DECIMALS).find((x) => x.node === 'm18_PogNB')!;
    expect(r.hidden).toBe(false);
  });
});

describe('Inspector row keys for BUILT_INS (Task 8 review, fix round 1: Steiner and Downs both list #53)', () => {
  const rows = measurementRows(BUILT_INS, g, g.evaluate({}, 0.1), new Set(), DEFAULT_DECIMALS);
  it('r.node alone is NOT a unique React key: Steiner and Downs both list m53_Interincisal', () => {
    expect(rows.filter((r) => r.node === 'm53_Interincisal')).toHaveLength(2);
  });
  it('rowKey (`${analysis}:${node}`, the key the Inspector table actually uses) is unique for every row', () => {
    const keys = rows.map(rowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// Part A task 9: the Inspector's "Not placed" list shows only points some enabled analysis needs,
// not every catalogue point (~59). All of required-by-content on BUILT_INS, so the list on a real
// film has to equal exactly what McNamara/Steiner/Downs can use.
describe('unplacedLandmarks: "Not placed" lists only what the enabled analyses use (Part A task 9)', () => {
  const needed = () => { const s = new Set<string>();
    for (const d of BUILT_INS) for (const m of d.measurements) for (const l of g.requiredLandmarks(m.node)) s.add(l);
    return s; };

  it('with no points placed, BUILT_INS needs Co (McNamara Co-A/Co-Gn) and U1A (Steiner #47), but not SPogS (Holdaway-only, not in BUILT_INS)', () => {
    const list = unplacedLandmarks(BUILT_INS, g, new Set());
    expect(list).toContain('Co');
    expect(list).toContain('U1A');
    expect(list).not.toContain('SPogS');
  });

  it('no enabled analyses -> an empty list even with nothing placed', () => {
    expect(unplacedLandmarks([], g, new Set())).toEqual([]);
  });

  it('every needed point already placed -> an empty list', () => {
    expect(unplacedLandmarks(BUILT_INS, g, needed())).toEqual([]);
  });

  it('a placed point that gets deleted goes back into the list', () => {
    const allPlaced = needed();
    const afterDelete = new Set(allPlaced); afterDelete.delete('Co');
    expect(unplacedLandmarks(BUILT_INS, g, afterDelete)).toContain('Co');
  });

  it('is given in LANDMARKS order, not catalogue or insertion order', () => {
    const order = Object.keys(LANDMARKS);
    const idxs = unplacedLandmarks(BUILT_INS, g, new Set()).map((k) => order.indexOf(k));
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });

  it('a point already placed still shows in the placed list whether or not any analysis needs it (documents existing Inspector behaviour, not this function)', () => {
    // state.points is the "placed" source in Inspector.tsx; this function only controls the
    // unplaced side, so a placed-but-unneeded point (e.g. SPogS) is simply absent from here.
    const list = unplacedLandmarks(BUILT_INS, g, new Set(['SPogS']));
    expect(list).not.toContain('SPogS');
  });
});

// Task 9 review, fix round 1: the filter also removed the ONLY way to place a point
// no enabled analysis needs (e.g. SPogS) — the brief requires manual placement of any catalogue
// point to stay possible. `otherLandmarks` is the rest of the picker: every unplaced catalogue
// point that `unplacedLandmarks` leaves out, shown collapsed under "Other points" in the Inspector.
describe('otherLandmarks: the rest of the landmark picker, for points no enabled analysis needs (Task 9 fix round 1)', () => {
  const needed = () => { const s = new Set<string>();
    for (const d of BUILT_INS) for (const m of d.measurements) for (const l of g.requiredLandmarks(m.node)) s.add(l);
    return s; };

  it('with BUILT_INS and nothing placed, contains SPogS (Holdaway-only) and not Co (McNamara needs it)', () => {
    const list = otherLandmarks(BUILT_INS, g, new Set());
    expect(list).toContain('SPogS');
    expect(list).not.toContain('Co');
  });

  it('union with unplacedLandmarks is every unplaced catalogue point, and the two lists are disjoint', () => {
    const placed = new Set<string>();
    const notPlaced = unplacedLandmarks(BUILT_INS, g, placed), other = otherLandmarks(BUILT_INS, g, placed);
    const union = new Set([...notPlaced, ...other]);
    expect(union).toEqual(new Set(Object.keys(LANDMARKS)));
    expect(notPlaced.some((k) => other.includes(k))).toBe(false);
  });

  it('everything placed -> both unplacedLandmarks and otherLandmarks are empty', () => {
    const allPlaced = new Set(Object.keys(LANDMARKS));
    expect(unplacedLandmarks(BUILT_INS, g, allPlaced)).toEqual([]);
    expect(otherLandmarks(BUILT_INS, g, allPlaced)).toEqual([]);
  });

  it('no enabled analyses -> otherLandmarks is every catalogue point not yet placed', () => {
    expect(otherLandmarks([], g, new Set())).toEqual(Object.keys(LANDMARKS));
  });

  it('a placed "other" point removed goes back into otherLandmarks, not unplacedLandmarks', () => {
    const placed = new Set(['SPogS']);
    expect(otherLandmarks(BUILT_INS, g, placed)).not.toContain('SPogS');
    const afterDelete = new Set(placed); afterDelete.delete('SPogS');
    expect(otherLandmarks(BUILT_INS, g, afterDelete)).toContain('SPogS');
    expect(unplacedLandmarks(BUILT_INS, g, afterDelete)).not.toContain('SPogS');
  });

  it('is given in LANDMARKS order', () => {
    const order = Object.keys(LANDMARKS);
    const idxs = otherLandmarks(BUILT_INS, g, new Set()).map((k) => order.indexOf(k));
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });

  it('every id otherLandmarks returns is one no measurement of BUILT_INS requires', () => {
    const n = needed();
    for (const k of otherLandmarks(BUILT_INS, g, new Set())) expect(n.has(k)).toBe(false);
  });
});

describe('"Needs points no model finds" (appendix §2 wording)', () => {
  const ORIGINAL_19 = new Set<string>(ISBI19);                       // P22: imported, not retyped
  it('lists points no installed model finds and that are not placed, and what they complete', () => {
    const m = missingPoints([STEINER], g, ORIGINAL_19, ORIGINAL_19);
    expect(m.points).toEqual(expect.arrayContaining(['U1A', 'L1A', 'U6', 'L6']));
    expect(m.completes).toContain('Interincisal angle');
    expect(missingText(m)).toMatch(/^Needs points no model finds: .*U1A.*\. Place them to complete .*Interincisal angle/);
  });
  it('a point a model finds is not listed, even when not placed yet', () => {
    expect(missingPoints([STEINER], g, new Set([...ORIGINAL_19, 'U1A']), ORIGINAL_19).points).not.toContain('U1A');
  });
  it('nothing missing: no line', () => {
    expect(missingText({ points: [], completes: [] })).toBeNull();
  });
});

// Spec 2026-10-19 addendum 2 (M) supersedes the owner's 7 Oct rule and reviews I-3/T9-3 and T9-2: the placing model,
// its score and the "to confirm" wording no longer decide the bubble; only "AI and not yet accepted" does.
describe('the AI bubble does not depend on the placing model, its score or the definition (addendum 2, M)', () => {
  const gAll = compile(buildRegistry(ALL_ANALYSES));
  const ai = () => ({ x: 1, y: 1, source: 'ai' as const, verified: false, ai: { x: 1, y: 1 } });
  it('Co, AI and not accepted, is listed: placement, score and definition are no longer consulted', () => {
    expect(unconfirmedAiPoints('m10_CoA', gAll, { Co: ai() })).toEqual(['Co']);
  });
  it('Pt (not scored, "unconfirmed") and U6 (scored, "to confirm") are listed exactly like any other point', () => {
    expect(unconfirmedAiPoints('m31_FacAxisM', gAll, { Pt: ai() })).toEqual([]);   // #31 uses PTM, not Pt
    expect(unconfirmedAiPoints('m30_FacAxisR', gAll, { Pt: ai() })).toEqual(['Pt']);
    expect(unconfirmedAiPoints('m60_OPSN', gAll, { U6: ai() })).toContain('U6');
  });
  it('control: once accepted, or hand-placed, a point is not listed', () => {
    expect(unconfirmedAiPoints('m10_CoA', gAll, { Co: { ...ai(), verified: true } })).toEqual([]);
    expect(unconfirmedAiPoints('m30_FacAxisR', gAll, { Pt: { x: 1, y: 1, source: 'manual', verified: true } })).toEqual([]);
  });
});
describe('placerStatus skips an over-the-gate row in the table-order fallback (Minor, induction 3)', () => {
  it('no record: the first row is tooFar, so the fallback moves on instead of stopping there', () => {
    const table = [
      { modelId: 'main', title: 'Main', main: true, points: [{ id: 'Pt', status: { kind: 'tooFar' as const, mre: 3, n: 50, dataset: 'x' } }] },
      { modelId: 'aariz', title: 'Aariz', main: false, points: [{ id: 'Pt', status: { kind: 'scored' as const, mre: 1, n: 50, dataset: 'x' } }] },
    ];
    expect(placerStatus('Pt', null, table)).toBe('scored');
  });
});
describe('placedViaOf: the stored via of each point; none before format 15', () => {
  it('reads placedVia, skipping null and missing', () => {
    expect(placedViaOf({ landmarks: [{ id: 'Go', placedVia: 'auto-best' }, { id: 'S', placedVia: null }, { id: 'N' }] })).toEqual({ Go: 'auto-best' });
  });
});

describe('who placed an AI point: the record, not a re-derivation (pre-flight P16)', () => {
  // Main finds nothing for Pt; Aariz scores it; SRPose finds it unscored. Aariz errored on this film, so SRPose placed it.
  const table = [
    { modelId: 'main', title: 'Main', main: true, points: [] },
    { modelId: 'aariz', title: 'Aariz', main: false, points: [{ id: 'Pt', status: { kind: 'scored' as const, mre: 1.2, n: 150, dataset: 'aariz' } }] },
    { modelId: 'srpose', title: 'SRPose', main: false, points: [{ id: 'Pt', status: { kind: 'notScored' as const } }] },
  ];
  const pt = { x: 5, y: 6, source: 'ai' as const, verified: false, ai: { x: 5, y: 6 } };
  it('the placement record names SRPose: not scored, so marked (the table order alone would have said Aariz, scored)', () => {
    expect(placerOf('Pt', pt, { Pt: 'srpose' }, [])).toBe('srpose');
    expect(placerStatus('Pt', 'srpose', table)).toBe('notScored');
    expect(placerStatus('Pt', null, table)).toBe('scored');             // the fallback the record overrides
  });
  it('a reopened case: the recorded run whose point sits where the AI put it', () => {
    const runs = [{ modelId: 'aariz', ranAt: 'SYNTHETIC', facing: 'right' as const, points: [{ channel: 0, landmarkId: 'Pt', x: 9, y: 9, peak: 1 }] },
      { modelId: 'srpose', ranAt: 'SYNTHETIC', facing: 'right' as const, points: [{ channel: 27, landmarkId: 'Pt', x: 5, y: 6, peak: 1 }] }];
    expect(placerOf('Pt', pt, null, runs)).toBe('srpose');
  });
  it('no record at all: null, and the table order is the fallback', () => {
    expect(placerOf('Pt', pt, null, [])).toBeNull();
  });
});

describe('the AI bubble: every row that uses an AI point not yet accepted (spec 2026-10-19 addendum 2, M)', () => {
  const gAll = compile(buildRegistry(ALL_ANALYSES));
  const ai = () => ({ x: 1, y: 1, source: 'ai' as const, verified: false, ai: { x: 1, y: 1 } });
  it('N, AI and not accepted (status original): SNA (deg), N–Me (mm), Jarabak (%) and SN:GoMe (ratio) each list it', () => {
    for (const node of ['m01_SNA', 'm41_NMe', 'm42_Jarabak', 'm43_SNtoGoMe']) expect(unconfirmedAiPoints(node, gAll, { N: ai() }), node).toEqual(['N']);
  });
  it('catalogue-wide: with every point AI and not accepted, each row lists exactly the points it uses', () => {
    const all = Object.fromEntries(Object.keys(LANDMARKS).map((id) => [id, ai()]));
    const nodes = [...new Set(ALL_ANALYSES.flatMap((d) => d.measurements.map((m) => m.node)))];
    expect(nodes.length).toBeGreaterThan(80);                                  // control: the catalogue was read (85 rows, 19 Oct)
    const wrong = nodes.filter((n) => JSON.stringify(unconfirmedAiPoints(n, gAll, all))
      !== JSON.stringify(Object.keys(LANDMARKS).filter((id) => gAll.requiredLandmarks(n).has(id))));
    expect(wrong).toEqual([]);
  });
  it('accepted, moved (ai-adjusted) or hand-placed points are never listed; the rest of the row still is', () => {
    const pts = { S: { x: 1, y: 1, source: 'manual' as const, verified: true }, N: { ...ai(), verified: true }, A: ai() };
    expect(unconfirmedAiPoints('m01_SNA', gAll, pts)).toEqual(['A']);
    expect(unconfirmedAiPoints('m01_SNA', gAll, { ...pts, A: { ...ai(), source: 'ai-adjusted' as const, verified: true } })).toEqual([]);
  });
  it('a bulk accept (Accept remaining) clears every bubble it covers', () => {
    const loaded = tracingReducer(initialTracing, { type: 'load', landmarks: [{ id: 'S', x: 1, y: 1 }, { id: 'N', x: 50, y: 1 }, { id: 'A', x: 50, y: 50 }] });
    expect(unconfirmedAiPoints('m01_SNA', gAll, loaded.points)).toEqual(['S', 'N', 'A']);
    expect(unconfirmedAiPoints('m01_SNA', gAll, tracingReducer(loaded, { type: 'acceptRemaining' }).points)).toEqual([]);
  });
  it('the hover words say "not yet accepted" (P1), in one place', () => {
    expect(unconfirmedAiPointsLine(['N', 'Go'])).toBe('Uses AI points not yet accepted: N, Go');
  });
});
