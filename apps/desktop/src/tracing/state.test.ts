import { describe, it, expect } from 'vitest';
import { DISPLAY_DEFAULT, initialTracing, sameRuler, tracingReducer as r, positions, remaining, replacedOnRedetect, superimpositionView, verifiedSet, type Action, type TracingState } from './state';
import { levelRotation, NO_ORIENTATION } from '../canvas/orientation';
import type { RulerMarks } from '../ipc';

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
    expect(s.points.U1A).toEqual({ x: 900, y: 1500, source: 'manual', verified: true, acceptKind: 'hand' });
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

describe('accepting points where they are (spec 2026-10-19, V4–V6)', () => {
  it('acceptMany accepts the listed points without moving them, as one undo step, and clears the picks', () => {
    let s = r(r(load(), { type: 'togglePick', id: 'S' }), { type: 'togglePick', id: 'N' });
    s = r(s, { type: 'acceptMany', ids: ['S', 'N'] });
    // Part F reads this as "accepted without moving": x, y, source and the AI position are untouched.
    expect(s.points.S).toEqual({ x: 700, y: 800, source: 'ai', verified: true, ai: { x: 700, y: 800 }, acceptKind: 'bulk' });
    expect(s.points.N).toMatchObject({ x: 1600, y: 700, source: 'ai', verified: true });
    expect([s.points.Po.verified, s.past.length, s.picked]).toEqual([false, 1, []]);
    s = r(s, { type: 'undo' });
    expect([s.points.S.verified, s.points.N.verified]).toEqual([false, false]);
    s = r(s, { type: 'redo' });
    expect([s.points.S.verified, s.points.N.verified]).toEqual([true, true]);
  });
  it('acceptMany with nothing left to accept, or ids that are not placed, is not an undo step', () => {
    const s = r(load(), { type: 'accept' });                                   // active Po, now accepted
    expect(r(s, { type: 'acceptMany', ids: ['Po', 'Nonsense'] })).toBe(s);
  });
  it('acceptRemaining accepts every point not yet accepted, those no analysis uses too, in one step', () => {
    const h = r(initialTracing, { type: 'hydrate', orientation: NO_ORIENTATION, display: DISPLAY_DEFAULT, points: {
      S: { x: 1, y: 2, source: 'ai', verified: false }, Zz: { x: 3, y: 4, source: 'ai', verified: false }, N: { x: 5, y: 6, source: 'manual', verified: true } } });
    expect(remaining(h)).toEqual(['S', 'Zz']);
    const s = r(h, { type: 'acceptRemaining' });
    expect([remaining(s), s.past.length, s.points.Zz]).toEqual([[], 1, { x: 3, y: 4, source: 'ai', verified: true, acceptKind: 'bulk' }]);
  });
  it('⌘-pick adds and removes placed points, makes the added one active, and is never an undo step', () => {
    let s = r(r(load(), { type: 'togglePick', id: 'S' }), { type: 'togglePick', id: 'N' });
    expect([s.picked, s.active, s.past.length]).toEqual([['S', 'N'], 'N', 0]);
    s = r(s, { type: 'togglePick', id: 'S' });
    expect([s.picked, s.active]).toEqual([['N'], 'N']);
    expect(r(s, { type: 'togglePick', id: 'U1A' })).toBe(s);                 // not placed: nothing to pick
  });
  it('a plain click, a press that starts a drag, Esc and a click on empty film clear the picks', () => {
    const p = r(r(load(), { type: 'togglePick', id: 'S' }), { type: 'togglePick', id: 'N' });
    const clears: Action[] = [{ type: 'select', id: 'Or' }, { type: 'beginDrag', id: 'Or' }, { type: 'cancel' }, { type: 'unpick' }];
    for (const a of clears) expect(r(p, a).picked).toEqual([]);
  });
  it('the arrow keys nudge only the active point while several are picked', () => {
    const p = r(r(load(), { type: 'togglePick', id: 'S' }), { type: 'togglePick', id: 'N' });
    const s = r(p, { type: 'nudge', delta: { x: 1, y: 0 } });
    expect([s.points.N.x, s.points.S.x, s.picked]).toEqual([1601, 700, ['S', 'N']]);
  });
  it('a picked point that is removed drops out of the picks', () => {
    const s = r(r(r(load(), { type: 'togglePick', id: 'S' }), { type: 'togglePick', id: 'N' }), { type: 'remove' });   // removes N (active)
    expect(s.picked).toEqual(['S']);
  });
});

describe('the automatic sign-off request (spec 2026-10-19, V2)', () => {
  const allBut = (id: string) => r(load(), { type: 'acceptMany', ids: ['Po', 'Or', 'S', 'N'].filter((k) => k !== id) });
  it('asks once when an accept leaves every point accepted, never while some are left', () => {
    const a = allBut('N');
    expect(a.signOffAsk).toBe(0);
    expect(r(r(a, { type: 'select', id: 'N' }), { type: 'accept' }).signOffAsk).toBe(1);
    expect(r(load(), { type: 'acceptRemaining' }).signOffAsk).toBe(1);
  });
  it('a drag asks on release, not on each move; a press that moves nothing never asks', () => {
    let s = r(allBut('N'), { type: 'beginDrag', id: 'N' });
    s = r(r(s, { type: 'dragTo', pos: { x: 1601, y: 700 } }), { type: 'dragTo', pos: { x: 1602, y: 700 } });
    expect(s.signOffAsk).toBe(0);
    expect(r(s, { type: 'endDrag' }).signOffAsk).toBe(1);
    const click = r(r(r(load(), { type: 'acceptRemaining' }), { type: 'beginDrag', id: 'S' }), { type: 'endDrag' });
    expect(click.signOffAsk).toBe(1);                                          // only acceptRemaining asked
  });
  it('⌘Z of the last accept does not ask; ⌘⇧Z does (so undo and redo carry the sign-off with them)', () => {
    const s = r(load(), { type: 'acceptRemaining' });
    const u = r(s, { type: 'undo' });
    expect(u.signOffAsk).toBe(1);
    expect(r(u, { type: 'redo' }).signOffAsk).toBe(2);
  });
  it('removing the only point not yet accepted leaves every point accepted: it asks', () => {
    const s = r(r(allBut('N'), { type: 'select', id: 'N' }), { type: 'remove' });
    expect([Object.keys(s.points).length, s.signOffAsk]).toEqual([3, 1]);
  });
  it('view, orientation, picks, selection and detection never ask, even with every point accepted', () => {
    const s = r(load(), { type: 'acceptRemaining' });
    const acts: Action[] = [{ type: 'orient', op: 'flip' }, { type: 'setDisplay', display: { invert: true } }, { type: 'togglePick', id: 'S' },
      { type: 'select', id: 'N' }, { type: 'redetect', landmarks: [], overwrite: false }, { type: 'toggleAllPlanes' }];
    for (const a of acts) expect(r(s, a).signOffAsk).toBe(1);
  });
  it('a film with no points never asks, including when the last point is removed', () => {
    expect(r(initialTracing, { type: 'acceptRemaining' }).signOffAsk).toBe(0);
    expect(r(initialTracing, { type: 'undo' }).signOffAsk).toBe(0);
    const one = r(initialTracing, { type: 'load', landmarks: [{ id: 'S', x: 1, y: 1 }] });   // active S
    expect(r(one, { type: 'remove' }).signOffAsk).toBe(0);                     // nothing left to sign
  });
  it('a new case keeps the count, so a reset never looks like a request', () => {
    const s = r(load(), { type: 'acceptRemaining' });
    expect([r(s, { type: 'reset' }).signOffAsk, r(s, { type: 'load', landmarks: [] }).signOffAsk]).toEqual([1, 1]);
  });
});

describe('the ruler marks in the undo history (spec 2026-10-19, F, R1)', () => {
  const R1: RulerMarks = { p1: { x: 10, y: 10 }, p2: { x: 210, y: 10 }, mm: 20, steps: 0 };
  const R2: RulerMarks = { ...R1, p2: { x: 260, y: 10 } };
  it('a dropped mark (moveRuler) is one undo step: ⌘Z restores the previous marks, ⌘⇧Z the new', () => {
    let s = r(r(load(), { type: 'setRuler', ruler: R1 }), { type: 'moveRuler', ruler: R2 });
    expect([s.ruler, s.past.length]).toEqual([R2, 1]);
    s = r(s, { type: 'undo' }); expect(s.ruler).toEqual(R1);
    s = r(s, { type: 'redo' }); expect(s.ruler).toEqual(R2);
  });
  it('a calibration from the dialog (setRuler) is not an undo step, and ⌘Z never goes back past it', () => {
    let s = r(load(), { type: 'nudge', delta: { x: 1, y: 0 } });         // a point step before calibrating (Po, active)
    s = r(s, { type: 'setRuler', ruler: R1 });
    expect(s.past.length).toBe(1);
    s = r(s, { type: 'undo' });
    expect([s.ruler, s.points.Po.x]).toEqual([R1, 300]);                  // the nudge undone, the ruler kept
    expect(r(s, { type: 'redo' }).ruler).toEqual(R1);
  });
  it('moving or undoing the ruler never moves a point and never asks for a sign-off (V3)', () => {
    const a = r(load(), { type: 'acceptRemaining' });
    const m = r(r(a, { type: 'setRuler', ruler: R1 }), { type: 'moveRuler', ruler: R2 });
    expect(m.points).toBe(a.points);
    expect([m.signOffAsk, r(m, { type: 'undo' }).signOffAsk, r(r(m, { type: 'undo' }), { type: 'redo' }).signOffAsk]).toEqual([1, 1, 1]);
  });
  it('a new case starts with no ruler; sameRuler compares every number', () => {
    expect(r(r(load(), { type: 'setRuler', ruler: R1 }), { type: 'reset' }).ruler).toBeNull();
    expect([sameRuler(R1, { ...R1 }), sameRuler(R1, R2), sameRuler(R1, { ...R1, mm: 21 }), sameRuler(R1, { ...R1, steps: 1 }), sameRuler(R1, null), sameRuler(null, null)])
      .toEqual([true, false, false, false, false, true]);
  });
  it('a fine-tune press is one undo step; ⌘Z goes back one press at a time and never moves a point or asks (addendum 3)', () => {
    // Fix round 1, review M-2: `load()` alone has unverified AI points, so `allAccepted` is false and `signOffAsk`
    // could never rise regardless of what the reducer does with the ruler — the guard below could not fail. Accept
    // every point first (as the real screen would, before fine-tuning an already-signed-off film), so the check is
    // live: were `moveRuler` ever to raise `signOffAsk`, `base.signOffAsk` would already be 1 and the final equality
    // would show it moving to 2. Induced and confirmed (fix round 1 report): adding 'moveRuler' to `POINT_ACTIONS`
    // and `n.ruler !== s.ruler` to `touched` makes this assertion fail.
    const base = r(r(load(), { type: 'acceptRemaining' }), { type: 'setRuler', ruler: R1 });
    expect(base.signOffAsk).toBe(1);   // control: accepting did ask once, so a later rise would be visible
    let s = r(r(base, { type: 'moveRuler', ruler: { ...R1, steps: 1 } }), { type: 'moveRuler', ruler: { ...R1, steps: 2 } });
    expect([s.ruler!.steps, s.past.length - base.past.length]).toEqual([2, 2]);
    s = r(s, { type: 'undo' }); expect(s.ruler!.steps).toBe(1);
    s = r(s, { type: 'undo' }); expect(s.ruler!.steps).toBe(0);
    expect([s.points === base.points, s.signOffAsk === base.signOffAsk]).toEqual([true, true]);
  });
});

describe('Part F: how each point was accepted (chain spec answer 7)', () => {
  const kinds = (s: TracingState) => Object.fromEntries(Object.entries(s.points).map(([k, p]) => [k, p.acceptKind ?? null]));
  it('Accept position is single, Accept Positions and Accept remaining are bulk, a double-click is double-click', () => {
    let s = r(r(load(), { type: 'select', id: 'S' }), { type: 'accept' });
    s = r(s, { type: 'acceptMany', ids: ['N'] });
    s = r(s, { type: 'acceptMany', ids: ['Po'], kind: 'double-click' });
    s = r(s, { type: 'acceptRemaining' });
    expect(kinds(s)).toEqual({ Po: 'double-click', Or: 'bulk', S: 'single', N: 'bulk' });
  });
  it('a drag, a nudge and a click elsewhere are drag; a new point is hand; accepting either keeps its kind', () => {
    let s = r(r(r(load(), { type: 'beginDrag', id: 'S' }), { type: 'dragTo', pos: { x: 710, y: 800 } }), { type: 'endDrag' });
    s = r(r(s, { type: 'select', id: 'N' }), { type: 'nudge', delta: { x: 1, y: 0 } });
    s = r(s, { type: 'place', id: 'Po', pos: { x: 310, y: 1100 } });
    s = r(s, { type: 'place', id: 'Go', pos: { x: 500, y: 1200 } });
    s = r(s, { type: 'acceptRemaining' });
    expect(kinds(s)).toEqual({ Po: 'drag', Or: 'bulk', S: 'drag', N: 'drag', Go: 'hand' });
  });
  it('⌘Z takes the kind back with the acceptance; Re-detect over the point leaves none', () => {
    const accepted = r(r(load(), { type: 'select', id: 'S' }), { type: 'accept' });
    expect(r(accepted, { type: 'undo' }).points.S.acceptKind).toBeUndefined();
    const again = r(accepted, { type: 'redetect', landmarks: [{ id: 'S', x: 701, y: 800 }], overwrite: true });
    expect([again.points.S.verified, again.points.S.acceptKind]).toEqual([false, undefined]);
  });
  // Through the live reducer, `accept`/`acceptMany` only ever reach a point while it is still unverified (both guard
  // on `!verified`), and a point only becomes `manual`/`ai-adjusted` at the same moment it becomes verified (`place`,
  // `moved`). So the only way an unverified-but-already-moved/hand point reaches `accept` is a doc hydrated from an
  // older or inconsistent save (`hydrate` applies no such check) — exactly the case `acceptedAs`'s source branches
  // guard against ("a moved one is `drag` … however it is then accepted"). Positive control, below.
  it('a hydrated unverified point that was already moved or hand-placed keeps drag/hand when accepted, not the gesture', () => {
    const points = { S: { x: 1, y: 2, source: 'ai-adjusted' as const, verified: false }, N: { x: 3, y: 4, source: 'manual' as const, verified: false } };
    const h = r(initialTracing, { type: 'hydrate', points, orientation: NO_ORIENTATION, display: DISPLAY_DEFAULT });
    const s = r(h, { type: 'acceptMany', ids: ['S', 'N'] });
    expect([s.points.S.acceptKind, s.points.N.acceptKind]).toEqual(['drag', 'hand']);
  });
});

describe('a late point is part of the placement, never an undo step (Task 7 fix round 1, ruling)', () => {
  // A first placement without Go, then a drag of S, then Go arrives from a background model.
  const first = () => r(initialTracing, { type: 'redetect', landmarks: [{ id: 'S', x: 700, y: 800 }, { id: 'N', x: 1600, y: 700 }], overwrite: false });
  const dragS = (s: TracingState) => r(r(r(s, { type: 'beginDrag', id: 'S' }), { type: 'dragTo', pos: { x: 750, y: 850 } }), { type: 'endDrag' });
  const arrive = (s: TracingState, landmarks: { id: string; x: number; y: number }[], level = false): TracingState => r(s, { type: 'arrive', landmarks, level });
  it('place, drag S, Go arrives, ⌘Z: S goes back and Go stays', () => {
    const s = arrive(dragS(first()), [{ id: 'Go', x: 400, y: 1200 }]);
    const u = r(s, { type: 'undo' });
    expect([u.points.S.x, u.points.Go?.x, u.points.Go?.source]).toEqual([700, 400, 'ai']);
  });
  it('⌘Z right back to the start, and ⌘⇧Z again, never takes the late point away', () => {
    let s = arrive(dragS(first()), [{ id: 'Go', x: 400, y: 1200 }]);
    for (let k = 0; k < 5; k++) { s = r(s, { type: 'undo' }); expect(s.points.Go?.x).toBe(400); }
    for (let k = 0; k < 5; k++) { s = r(s, { type: 'redo' }); expect(s.points.Go?.x).toBe(400); }
    expect(s.points.S.x).toBe(750);
  });
  it('adds no undo step and keeps ⌘⇧Z', () => {
    const d = dragS(first());
    const s = arrive(d, [{ id: 'Go', x: 400, y: 1200 }]);
    expect(s.past.length).toBe(d.past.length);
    const undone = r(d, { type: 'undo' });                                 // S's drag undone: ⌘⇧Z is waiting
    const s2 = arrive(undone, [{ id: 'Go', x: 400, y: 1200 }]);
    expect([s2.future.length, r(s2, { type: 'redo' }).points.S.x, r(s2, { type: 'redo' }).points.Go?.x]).toEqual([1, 750, 400]);
  });
  it('a point you placed by hand meanwhile stays; ⌘Z of that placement shows the placement beneath it, late point included', () => {
    const placed = r(first(), { type: 'place', id: 'Go', pos: { x: 90, y: 90 } });
    const s = arrive(placed, [{ id: 'Go', x: 400, y: 1200 }]);
    expect([s.points.Go.x, s.points.Go.source]).toEqual([90, 'manual']);
    const u = r(s, { type: 'undo' });
    expect([u.points.Go.x, u.points.Go.source]).toEqual([400, 'ai']);
    expect(r(u, { type: 'redo' }).points.Go.x).toBe(90);                   // ⌘⇧Z: your point again
  });
  it('Po and Or arriving late level a film that was never levelled, and ⌘Z keeps it level', () => {
    const f = r(r(initialTracing, { type: 'redetect', landmarks: [{ id: 'S', x: 700, y: 800 }], overwrite: false }), { type: 'autoOrient', mirror: false });
    const s = arrive(dragS(f), [{ id: 'Po', x: 300, y: 1100 }, { id: 'Or', x: 1500, y: 1010 }], true);
    const rot = levelRotation({ x: 300, y: 1100 }, { x: 1500, y: 1010 }, false);
    expect([s.orientation.source, s.orientation.rotDeg]).toEqual(['auto-FH', rot]);
    const u = r(s, { type: 'undo' });
    expect([u.points.S.x, u.orientation.source, u.orientation.rotDeg]).toEqual([700, 'auto-FH', rot]);
    const turned = r(dragS(f), { type: 'orient', op: 'rotate', deg: 5 });   // turned by hand: never levelled over it
    expect(arrive(turned, [{ id: 'Po', x: 300, y: 1100 }, { id: 'Or', x: 1500, y: 1010 }], true).orientation).toEqual(turned.orientation);
    expect(arrive(dragS(f), [{ id: 'Po', x: 300, y: 1100 }, { id: 'Or', x: 1500, y: 1010 }], false).orientation.source).toBe('none');
  });
});

// Stage A task 7: flagged points are left out of both bulk accepts. SYNTHETIC points only.
describe('Stage A: flagged points are left out of bulk accepts (spec 14.5 item 7)', () => {
  const flaggedN = () => r(load(), { type: 'setFlagged', ids: ['N'] });
  const kinds = (s: TracingState) => Object.fromEntries(Object.entries(s.points).map(([k, p]) => [k, p.verified ? p.acceptKind ?? null : 'open']));
  /** Fails if acceptRemaining ignores `flagged` (the plan's positive control: it then verifies N too). */
  it('acceptRemaining verifies every point but the flagged one', () => {
    const s = r(flaggedN(), { type: 'acceptRemaining' });
    expect(kinds(s)).toEqual({ Po: 'bulk', Or: 'bulk', S: 'bulk', N: 'open' });
    expect(remaining(s)).toEqual(['N']);
    expect(s.past).toHaveLength(1);
  });
  /** Fails if a bulk accept over picked points does not skip the flagged one. */
  it('"Accept Positions" over N (flagged) and B-like S verifies only S', () => {
    let s = r(r(flaggedN(), { type: 'togglePick', id: 'N' }), { type: 'togglePick', id: 'S' });
    s = r(s, { type: 'acceptMany', ids: ['N', 'S'] });
    expect(kinds(s)).toEqual({ Po: 'open', Or: 'open', S: 'bulk', N: 'open' });
  });
  /** Fails if nothing but flagged points is picked and a bulk accept still writes an undo step or changes anything. */
  it('a bulk accept of only flagged points changes nothing and is not an undo step', () => {
    const s = flaggedN();
    expect(r(s, { type: 'acceptMany', ids: ['N'] })).toBe(s);
  });
  /** Fails if a double-click (a look at that point alone) is also held back by `flagged`. */
  it('a double-click on the flagged point verifies it, as double-click', () => {
    const s = r(flaggedN(), { type: 'acceptMany', ids: ['N'], kind: 'double-click' });
    expect(s.points.N).toMatchObject({ verified: true, acceptKind: 'double-click' });
  });
  /** Fails if a single Accept is held back. */
  it('a single Accept on the flagged point verifies it, as single', () => {
    const s = r(r(flaggedN(), { type: 'select', id: 'N' }), { type: 'accept' });
    expect(s.points.N).toMatchObject({ verified: true, acceptKind: 'single' });
  });
  /** Fails if setFlagged writes an undo step, touches the points, or is saved with them. */
  it('setFlagged is never an undo step and leaves the points as they were', () => {
    const base = load(), s = r(base, { type: 'setFlagged', ids: ['N'] });
    expect([s.flagged, s.past.length, s.points === base.points, s.signOffAsk]).toEqual([['N'], 0, true, 0]);
    expect(r(s, { type: 'setFlagged', ids: ['N'] })).toBe(s);          // same ids: no new state object
  });
  /** Fails if a different film keeps the old film's flags. */
  it('a different case starts with no flagged point', () => {
    const s = r(flaggedN(), { type: 'load', landmarks: [{ id: 'S', x: 1, y: 1 }] });
    expect(s.flagged).toEqual([]);
  });
  /** Edge: a flag at a point that is not placed (S or N missing) leaves only the placed flagged points out. */
  it('a flag at a point that is not on the film leaves nothing out', () => {
    const s = r(r(load(), { type: 'setFlagged', ids: ['B'] }), { type: 'acceptRemaining' });
    expect(remaining(s)).toEqual([]);
  });
  /** Edge: no flags (too few points to check): bulk accepts as before. */
  it('with no flags both bulk accepts are as before', () => {
    expect(remaining(r(load(), { type: 'acceptRemaining' }))).toEqual([]);
    expect(r(load(), { type: 'acceptMany', ids: ['S', 'N'] }).points.N.acceptKind).toBe('bulk');
  });
  /** Undo/redo: ⌘Z after a bulk accept leaves the flags as they are (they are not in the snapshot). */
  it('undo of a bulk accept keeps flagged', () => {
    const s = r(r(flaggedN(), { type: 'acceptRemaining' }), { type: 'undo' });
    expect(s.flagged).toEqual(['N']);
  });
});

// Stage A task 7, fix round 1 (minor 2): bulk accepts wait until the film's check has been read.
describe('Stage A: bulk accepts wait for the check read to settle', () => {
  const pending = () => r(load(), { type: 'setFlagged', ids: [], pending: true });
  /** Fails if a bulk accept runs before the check is read (it would take a point the check is about to flag). */
  it('while the read is pending both bulk accepts do nothing', () => {
    const s = pending();
    expect(s.checkPending).toBe(true);
    expect(r(s, { type: 'acceptRemaining' })).toBe(s);
    expect(r(s, { type: 'acceptMany', ids: ['S', 'N'] })).toBe(s);
  });
  /** Fails if a single Accept or a double-click is held up too (they look at one point on its own). */
  it('a single Accept and a double-click still work', () => {
    const s = r(r(pending(), { type: 'select', id: 'S' }), { type: 'accept' });
    expect(s.points.S.verified).toBe(true);
    expect(r(pending(), { type: 'acceptMany', ids: ['N'], kind: 'double-click' }).points.N.acceptKind).toBe('double-click');
  });
  /** Settled (also when the read failed: no flags): bulk accepts work as before. */
  it('settled with no flags: as before', () => {
    const s = r(pending(), { type: 'setFlagged', ids: [], pending: false });
    expect(s.checkPending).toBe(false);
    expect(remaining(r(s, { type: 'acceptRemaining' }))).toEqual([]);
  });
  it('setFlagged is idempotent in both fields; a new case starts not pending', () => {
    const s = pending();
    expect(r(s, { type: 'setFlagged', ids: [], pending: true })).toBe(s);
    expect(r(s, { type: 'load', landmarks: [{ id: 'S', x: 1, y: 1 }] }).checkPending).toBe(false);
  });
});
