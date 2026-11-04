import { describe, it, expect } from 'vitest';
import { initialTracing, tracingReducer as r, positions, replacedOnRedetect, superimpositionView, verifiedSet, type TracingState } from './state';
import { levelRotation } from '../canvas/orientation';

const load = () => r(initialTracing, { type: 'load', landmarks: [
  { id: 'Po', x: 300, y: 1100 }, { id: 'Or', x: 1500, y: 1010 }, { id: 'S', x: 700, y: 800 }, { id: 'N', x: 1600, y: 700 },
] });

describe('tracing state', () => {
  it('loads AI points as unverified, with the AI position kept for audit', () => {
    const s = load();
    expect(s.points.S).toEqual({ x: 700, y: 800, source: 'ai', verified: false, ai: { x: 700, y: 800 } });
    expect(s.past).toEqual([]);
  });
  it('a drag is one undo step however many moves it has', () => {
    let s = r(load(), { type: 'beginDrag', id: 'S' });
    for (let i = 1; i <= 30; i++) s = r(s, { type: 'dragTo', pos: { x: 700 + i, y: 800 } });
    s = r(s, { type: 'endDrag' });
    expect(s.points.S).toMatchObject({ x: 730, source: 'ai-adjusted', verified: true });
    expect(s.past).toHaveLength(1);
    s = r(s, { type: 'undo' });
    expect(s.points.S).toMatchObject({ x: 700, source: 'ai', verified: false });
    s = r(s, { type: 'redo' });
    expect(s.points.S.x).toBe(730);
  });
  it('clicking a point without moving it is not an undo step and keeps redo', () => {
    let s = r(r(load(), { type: 'select', id: 'N' }), { type: 'nudge', delta: { x: 1, y: 0 } });
    s = r(s, { type: 'undo' });
    expect(s.future).toHaveLength(1);
    s = r(r(s, { type: 'beginDrag', id: 'Po' }), { type: 'endDrag' });
    expect(s.past).toHaveLength(0); expect(s.future).toHaveLength(1);
    expect(s.points.Po).toMatchObject({ source: 'ai', verified: false });
  });
  it('Review Focus 4: undo after dragging Po while levelled restores the point and the rotation together', () => {
    let s = r(load(), { type: 'orient', op: 'level' });
    const levelled = s.orientation.rotDeg;
    s = r(s, { type: 'beginDrag', id: 'Po' }); s = r(s, { type: 'dragTo', pos: { x: 300, y: 1300 } }); s = r(s, { type: 'endDrag' });
    expect(s.orientation.rotDeg).not.toBeCloseTo(levelled, 3);            // re-levelled on release
    s = r(s, { type: 'undo' });
    expect(s.points.Po.y).toBe(1100); expect(s.orientation.rotDeg).toBeCloseTo(levelled, 12);
  });
  it('no re-level happens mid-drag', () => {
    let s = r(r(load(), { type: 'orient', op: 'level' }), { type: 'beginDrag', id: 'Or' });
    const before = s.orientation.rotDeg;
    s = r(s, { type: 'dragTo', pos: { x: 1500, y: 800 } });
    expect(s.orientation.rotDeg).toBe(before);
  });
  it('a manual rotation stops re-levelling; Restore clears mirror and rotation', () => {
    let s = r(r(load(), { type: 'orient', op: 'level' }), { type: 'orient', op: 'rotate', deg: 0.5 });
    expect(s.orientation.source).toBe('manual');
    const rot = s.orientation.rotDeg;
    s = r(r(r(s, { type: 'beginDrag', id: 'Po' }), { type: 'dragTo', pos: { x: 300, y: 1300 } }), { type: 'endDrag' });
    expect(s.orientation.rotDeg).toBe(rot);
    s = r(r(s, { type: 'orient', op: 'flip' }), { type: 'orient', op: 'restore' });
    expect(s.orientation).toEqual({ mirror: false, rotDeg: 0, source: 'restored' });
  });
  it('flip keeps a levelled view level', () => {
    const s = r(r(load(), { type: 'orient', op: 'level' }), { type: 'orient', op: 'flip' });
    expect(s.orientation.mirror).toBe(true); expect(s.orientation.source).toBe('auto-FH');
  });
  it('nudge and accept verify the active point, one undo step each', () => {
    let s = r(load(), { type: 'select', id: 'N' });
    s = r(s, { type: 'nudge', delta: { x: -1, y: 0 } });
    expect(s.points.N).toMatchObject({ x: 1599, verified: true });
    s = r(r(s, { type: 'select', id: 'S' }), { type: 'accept' });
    expect(s.points.S).toMatchObject({ x: 700, source: 'ai', verified: true });
    expect(s.past).toHaveLength(2);
    expect([...verifiedSet(s)].sort()).toEqual(['N', 'S']);
  });
  it('overlay toggles are not undo steps; P toggles all planes and restores the last set', () => {
    let s: TracingState = r(load(), { type: 'togglePlane', key: 'pp' });
    expect(s.overlays.planes.pp).toBe(true); expect(s.past).toHaveLength(0);
    s = r(s, { type: 'toggleAllPlanes' });
    expect(Object.values(s.overlays.planes).every((v) => !v)).toBe(true);
    s = r(s, { type: 'toggleAllPlanes' });
    expect(s.overlays.planes.pp).toBe(true);
  });
  it('reset clears the previous case (points, orientation, history) but keeps overlay choices', () => {
    let s = r(r(r(load(), { type: 'orient', op: 'level' }), { type: 'togglePlane', key: 'pp' }), { type: 'select', id: 'S' });
    s = r(s, { type: 'accept' });
    s = r(s, { type: 'reset' });
    expect(s.points).toEqual({}); expect(s.active).toBeNull();
    expect(s.orientation).toEqual({ mirror: false, rotDeg: 0, source: 'none' });
    expect(s.past).toEqual([]); expect(s.future).toEqual([]);
    expect(s.overlays.planes.pp).toBe(true);
  });
  it('positions() gives image coordinates for the geometry engine', () => {
    expect(positions(load()).N).toEqual({ x: 1600, y: 700 });
  });
});
describe('Week 3 additions', () => {
  it('a new case keeps the overlay choices, including the planes remembered by P', () => {
    let s = r(r(load(), { type: 'togglePlane', key: 'pp' }), { type: 'toggleAllPlanes' });   // all off; remembers the set with PP on
    s = r(s, { type: 'load', landmarks: [{ id: 'S', x: 1, y: 2 }] });
    expect(Object.values(s.overlays.planes).some(Boolean)).toBe(false);
    expect(r(s, { type: 'toggleAllPlanes' }).overlays.planes.pp).toBe(true);
    expect(r(s, { type: 'reset' }).lastPlanes).toEqual(s.lastPlanes);
  });
  it('hydrate restores a saved case exactly, is not an undo step, and selects the first unverified point', () => {
    const points = { S: { x: 1, y: 2, source: 'manual' as const, verified: true }, N: { x: 3, y: 4, source: 'ai' as const, verified: false, ai: { x: 3, y: 4 }, confidence: 0.7 } };
    const s = r(r(load(), { type: 'orient', op: 'flip' }), { type: 'hydrate', points, orientation: { mirror: true, rotDeg: -2, source: 'auto-FH' }, display: { brightness: 1.2, contrast: 1, invert: true, sharpness: 0 } });
    expect(s.points).toEqual(points);
    expect(s.orientation).toEqual({ mirror: true, rotDeg: -2, source: 'auto-FH' });
    expect(s.display).toEqual({ brightness: 1.2, contrast: 1, invert: true, sharpness: 0 });
    expect([s.past.length, s.future.length, s.active]).toEqual([0, 0, 'N']);
  });
  it('Review focus 4: re-detect replaces only untouched AI points unless overwrite, as one undo step', () => {
    let s = r(r(r(load(), { type: 'beginDrag', id: 'S' }), { type: 'dragTo', pos: { x: 710, y: 800 } }), { type: 'endDrag' });   // S moved
    s = r(r(s, { type: 'select', id: 'N' }), { type: 'accept' });                                                                // N accepted
    s = r(s, { type: 'place', id: 'Co', pos: { x: 100, y: 500 } });                                                              // Co by hand
    const det = [{ id: 'Po', x: 305, y: 1101 }, { id: 'Or', x: 1502, y: 1011 }, { id: 'S', x: 1, y: 1 }, { id: 'N', x: 2, y: 2 }, { id: 'Co', x: 3, y: 3 }];
    const kept = r(s, { type: 'redetect', landmarks: det, overwrite: false });
    expect(kept.points.Po).toMatchObject({ x: 305, source: 'ai', verified: false });
    expect([kept.points.S.x, kept.points.N.x, kept.points.Co.x]).toEqual([710, 1600, 100]);
    const all = r(s, { type: 'redetect', landmarks: det, overwrite: true });
    expect([all.points.S.x, all.points.N.x, all.points.Co.x]).toEqual([1, 2, 3]);
    expect(r(all, { type: 'undo' }).points.S.x).toBe(710);
  });
  it('autoOrient mirrors a left-facing film and levels Frankfort; without Po and Or it only mirrors', () => {
    const s = r(load(), { type: 'autoOrient', mirror: true });
    expect(s.orientation).toMatchObject({ mirror: true, source: 'auto-FH' });
    expect(s.orientation.rotDeg).toBeCloseTo(levelRotation({ x: 300, y: 1100 }, { x: 1500, y: 1010 }, true), 12);
    expect(s.past).toHaveLength(0);
    const bare = r(r(initialTracing, { type: 'load', landmarks: [{ id: 'S', x: 1, y: 1 }] }), { type: 'autoOrient', mirror: false });
    expect(bare.orientation).toEqual({ mirror: false, rotDeg: 0, source: 'none' });
  });
  it('selecting an unplaced catalogue landmark enters placement; Esc leaves it but never deselects a placed point', () => {
    const s = r(load(), { type: 'select', id: 'Co' });
    expect(s.active).toBe('Co');
    expect(r(s, { type: 'select', id: 'NotALandmark' }).active).toBe('Co');
    expect(r(s, { type: 'cancel' }).active).toBeNull();
    expect(r(r(s, { type: 'select', id: 'S' }), { type: 'cancel' }).active).toBe('S');
  });
  it('place makes a verified manual point in one undo step; remove deletes the active point in one step', () => {
    let s = r(load(), { type: 'place', id: 'U1A', pos: { x: 900, y: 1500 } });
    expect(s.points.U1A).toEqual({ x: 900, y: 1500, source: 'manual', verified: true });
    expect([s.active, s.past.length]).toEqual(['U1A', 1]);
    s = r(s, { type: 'remove' });
    expect(s.points.U1A).toBeUndefined();
    expect(r(s, { type: 'undo' }).points.U1A).toBeDefined();
    expect(r(load(), { type: 'place', id: 'Nonsense', pos: { x: 0, y: 0 } }).points.Nonsense).toBeUndefined();
  });
  it('placing Po on a levelled view re-levels it', () => {
    const s = r(r(load(), { type: 'orient', op: 'level' }), { type: 'place', id: 'Po', pos: { x: 300, y: 1300 } });
    expect(s.orientation.rotDeg).toBeCloseTo(levelRotation({ x: 300, y: 1300 }, { x: 1500, y: 1010 }, false), 12);
  });
  it('a rotate drag is one undo step and makes the rotation manual; rotateTo outside a drag does nothing', () => {
    let s = r(r(load(), { type: 'orient', op: 'level' }), { type: 'beginRotate' });
    for (const d of [1, 2, 3.25]) s = r(s, { type: 'rotateTo', deg: d });
    s = r(s, { type: 'endRotate' });
    expect(s.orientation).toMatchObject({ rotDeg: 3.25, source: 'manual' });
    expect(s.past).toHaveLength(2);                                           // level + the whole rotate drag
    expect(r(s, { type: 'undo' }).orientation.source).toBe('auto-FH');
    expect(r(load(), { type: 'rotateTo', deg: 9 }).orientation.rotDeg).toBe(0);
  });
  it('display and overlay setters are view state, never undo steps; the superimposition view forces profilogram on grid', () => {
    const s = r(r(load(), { type: 'setDisplay', display: { invert: true, sharpness: 0 } }), { type: 'setOverlays', overlays: { ...initialTracing.overlays, profilogram: true } });
    expect(s.display).toEqual({ brightness: 1, contrast: 1, invert: true, sharpness: 0 });
    expect([s.overlays.profilogram, s.past.length]).toEqual([true, 0]);
    const v = superimpositionView(load());
    expect([v.overlays.profilogram, v.overlays.background]).toEqual([true, 'grid']);
    expect(load().overlays.profilogram).toBe(false);
  });
});

it('replacedOnRedetect matches what the redetect reducer replaces', () => {
  const ai = { x: 1, y: 1, source: 'ai', verified: false } as any;
  expect([replacedOnRedetect(undefined, false), replacedOnRedetect(ai, false), replacedOnRedetect({ ...ai, verified: true }, false),
    replacedOnRedetect({ ...ai, source: 'manual' }, false), replacedOnRedetect({ ...ai, source: 'manual' }, true)]).toEqual([true, true, false, false, true]);
});
