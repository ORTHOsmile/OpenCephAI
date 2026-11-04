import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES, BUILT_INS, foundBy, ISBI19, LANDMARKS } from '@ceph/analyses';
import { DEFAULT_ENABLED, enableNew, enabledDefs, filmCoverage, forgetEnabled, mergeEnabled, parseEnabled, shownDefs, visibleEnabled } from './enabled';

const steiner = ALL_ANALYSES.find((a) => a.id === 'steiner')!;
const ORIGINAL_19 = [...ISBI19];                                    // P22: the 19 original points, imported, not retyped
const found19 = foundBy([{ points: ORIGINAL_19.map((id) => ({ id, status: { kind: 'original' } })) }]);

/** Fix round 1 (review ruling T6-1, (1)): a literal copy of today's three analyses — ids, every measurement's node
 *  and label — written out by hand from `BUILT_INS` at commit `1d25d63` (the base this task started from), NOT
 *  imported from `BUILT_INS` or `ALL_ANALYSES`. `enabledDefs(DEFAULT_ENABLED)).toEqual(BUILT_INS)` cannot fail on
 *  anything but membership (both sides are `ALL_ANALYSES.filter(ids.includes(...))`, so order/nodes/labels are
 *  identical by construction — the review's finding). This guard goes through `parseEnabled(null)`, the path the
 *  app actually takes, and fails on a catalogue edit to any of these three analyses' ids, order, nodes or labels,
 *  not only on membership. */
const PINNED_PRE_PART_D = [
  { id: 'steiner', name: 'Steiner', m: [
    ['m01_SNA', 'SNA'], ['m02_SNB', 'SNB'], ['m03_ANB', 'ANB'], ['m20_SNGoGn', 'SN–GoGn'],
    ['m60_OPSN', 'Occlusal plane to SN'], ['m53_Interincisal', 'Interincisal angle'],
    ['m46_U1NAmm', 'U1–NA (mm), tip'], ['m47_U1NAdeg', 'U1–NA (°)'], ['m49_L1NBmm', 'L1–NB (mm), tip'],
    ['m50_L1NBdeg', 'L1–NB (°)'], ['m59_L1GoGn', 'L1–GoGn'], ['m70a_U6NA', 'U6–NA (mm)'],
    ['m70b_L6NB', 'L6–NB (mm)'], ['m18_PogNB', 'Pog to NB (mm)'] ] },
  { id: 'downs', name: 'Downs', m: [
    ['m04_FacialAngle', 'Facial angle'], ['m05_Convexity', 'Angle of convexity'], ['m06_ABPlane', 'A–B plane angle'],
    ['m22_FHMPt', 'FH–MP, tangent (FMA, Downs mandibular plane)'], ['m24_YAxis', 'Y-axis'],
    ['m61_CantOP', 'Cant of occlusal plane'], ['m53_Interincisal', 'Interincisal angle'],
    ['m56_IMPAt', 'IMPA, tangent'], ['m62_L1OPdev', 'L1 to occlusal plane'], ['m63_U1APog', 'U1 to A–Pog (mm)'] ] },
  { id: 'mcnamara', name: 'McNamara', m: [
    ['m08_ANperp', 'A to N-perpendicular (mm)'], ['m09_PogNperp', 'Pog to N-perpendicular (mm)'], ['m10_CoA', 'Co–A (mm)'],
    ['m11_CoGn', 'Co–Gn (mm)'], ['m12_MaxMandDiff', 'Maxillomandibular difference (mm)'], ['m28_LAFH', 'LAFH, ANS–Me (mm)'],
    ['m23_FHGoMe', 'FH–GoMe'], ['m31_FacAxisM', 'Facial axis, McNamara'], ['m67_U1Avert', 'U1 to A-vertical (mm)'],
    ['m64_L1APog', 'L1 to A–Pog (mm), tip'], ['m84_UpperPharynx', 'Upper pharynx (mm)'], ['m85_LowerPharynx', 'Lower pharynx (mm)'] ] },
];
const shownToday = () => enabledDefs(parseEnabled(null)).map((a) => ({ id: a.id, name: a.name, m: a.measurements.map((x) => [x.node, x.label]) }));

describe('the chosen analyses', () => {
  it('first use shows the same three analyses as BUILT_INS, by membership (both filter ALL_ANALYSES the same way; order/nodes/labels follow by construction, not tested here — see "pinned" below)', () => {
    expect(enabledDefs(DEFAULT_ENABLED)).toEqual(BUILT_INS);
  });
  it('first use shows exactly the pre-Part-D three, pinned: ids, every node and every label (fails on a catalogue drift the membership check above cannot see)', () => {
    expect(shownToday()).toEqual(PINNED_PRE_PART_D);
  });
  it('first use: today\'s three', () => expect(parseEnabled(null)).toEqual(['steiner', 'downs', 'mcnamara']));
  it('a stored choice, in catalogue order, unknown ids dropped', () => expect(parseEnabled('["nus","steiner","nope"]')).toEqual(['steiner', 'nus']));
  it('unreadable or empty falls back to the three', () => {
    expect(parseEnabled('{')).toEqual(DEFAULT_ENABLED); expect(parseEnabled('[]')).toEqual(DEFAULT_ENABLED);
  });
  it('enabledDefs keeps catalogue order', () => expect(enabledDefs(['nus', 'kim']).map((a) => a.id)).toEqual(['kim', 'nus']));
});
describe('automatic or partly automatic for this film', () => {
  it('Steiner on the 19 original points is partly automatic and names its hand points', () => {
    const c = filmCoverage(steiner, found19, new Set(ORIGINAL_19));
    expect(c.automatic).toBe(false);
    expect(c.handPoints).toEqual(expect.arrayContaining(['U1A', 'L1A', 'U6', 'L6']));
    expect(c.stillToPlace).toEqual(c.handPoints);
  });
  it('a hand point already placed on this film is no longer "still to place"', () => {
    const c = filmCoverage(steiner, found19, new Set([...ORIGINAL_19, 'L1A']));
    expect(c.handPoints).toContain('L1A'); expect(c.stillToPlace).not.toContain('L1A');
  });
  it('every point found by a model: automatic (positive control)', () => {
    const all = new Set(Object.keys(LANDMARKS)) as any;
    expect(filmCoverage(steiner, all, new Set()).automatic).toBe(true);
  });
  it('no models table (found is empty): every point Steiner needs counts as hand-placed', () => {
    const c = filmCoverage(steiner, new Set(), new Set());
    expect(c.automatic).toBe(false);
    expect(c.handPoints.length).toBeGreaterThan(0);
    expect(c.stillToPlace).toEqual(c.handPoints);
  });
  // Fix round 1 (review m3): the marking is live — it moves with the film's placed points AND with which models
  // are installed, not a static label. Same analysis (Steiner), three different (found, placed) pairs.
  it('the marking changes with which models are installed: no models -> partly automatic; every point found -> automatic', () => {
    const noModels = filmCoverage(steiner, new Set(), new Set());
    const everyModel = filmCoverage(steiner, new Set(Object.keys(LANDMARKS)) as any, new Set());
    expect(noModels.automatic).toBe(false);
    expect(everyModel.automatic).toBe(true);
    expect(noModels.handPoints).not.toEqual(everyModel.handPoints);
  });
  it('the marking changes with this film\'s own placed points, for the same found set: placing a hand point removes it from "still to place" without changing "automatic"', () => {
    const before = filmCoverage(steiner, found19, new Set(ORIGINAL_19));
    const after = filmCoverage(steiner, found19, new Set([...ORIGINAL_19, 'U1A', 'L1A', 'U6', 'L6']));
    expect(before.automatic).toBe(false); expect(after.automatic).toBe(false);   // still not automatic: no model found them
    expect(before.stillToPlace.length).toBeGreaterThan(0);
    expect(after.stillToPlace).toEqual([]);   // every hand point is now placed on this film
    expect(before.handPoints).toEqual(after.handPoints);   // "needs" (model coverage) itself is unchanged
  });
});
describe('"My analysis" among the shown analyses (owner B1, B2)', () => {
  const mineA = [{ id: 'my:a', name: 'NOS clinic SYNTHETIC', items: [{ id: 'm03_ANB', from: 'steiner' }, { id: 'm99_Gone', from: '' }] }];
  it('stored my: ids are kept after the built-ins, in stored order, once', () => {
    expect(parseEnabled('["my:b","nus","my:a","steiner","my:b"]')).toEqual(['steiner', 'nus', 'my:b', 'my:a']);
    expect(parseEnabled('["my:b"]')).toEqual(['my:b']);   // not the three defaults: something is chosen
  });
  it("another clinician's analyses are not shown; nothing shown falls back to the three", () => {
    expect(visibleEnabled(['steiner', 'my:a', 'my:z'], mineA)).toEqual(['steiner', 'my:a']);
    expect(visibleEnabled(['my:z'], mineA)).toEqual(DEFAULT_ENABLED);
    expect(visibleEnabled(['my:a'], [])).toEqual(DEFAULT_ENABLED);   // the list not read yet
  });
  it('shownDefs: built-ins first, then this clinician\'s, as plain AnalysisDefs (unavailable rows never computed)', () => {
    const d = shownDefs(['steiner', 'my:a'], mineA);
    expect(d.map((x) => x.id)).toEqual(['steiner', 'my:a']);
    expect(d[1].measurements).toEqual([{ node: 'm03_ANB', label: 'ANB' }]);
  });
  it("changing the ticks keeps another clinician's ids in the stored list", () => {
    expect(mergeEnabled(['steiner', 'my:a', 'my:z'], ['downs'], mineA)).toEqual(['downs', 'my:z']);
  });
  it('a new analysis is shown at once without hiding what was shown; a deleted one leaves the stored list', () => {
    expect(enableNew(['steiner', 'my:z'], mineA, 'my:new')).toEqual(['steiner', 'my:z', 'my:new']);
    expect(enableNew(['my:z'], mineA, 'my:new')).toEqual(['steiner', 'downs', 'mcnamara', 'my:z', 'my:new']);
    expect(forgetEnabled(['steiner', 'my:a'], 'my:a')).toEqual(['steiner']);
    expect(forgetEnabled(['my:a'], 'my:a')).toEqual(DEFAULT_ENABLED);
    // the pitfall forgetEnabled exists for: after a delete the id is no longer "mine", so mergeEnabled would keep it
    expect(mergeEnabled(['steiner', 'my:a'], ['steiner'], [])).toContain('my:a');
  });
});
