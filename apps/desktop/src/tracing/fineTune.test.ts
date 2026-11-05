import { describe, it, expect } from 'vitest';
import { fineTuneOf, pressOn } from './fineTune';
import { scaleOf, type Scale } from './spacing';

const R = { p1: { x: 10, y: 10 }, p2: { x: 210, y: 10 }, mm: 20, steps: 0 };
const fit: Scale = { mmPerPx: 0.104, source: 'fit', fit: { ref: 'T1', kind: 'sn', k: 1.04, refAssumed: false } };
const step = () => {};
describe('the − / + beside the scale line (spec 2026-10-19 addendum 3)', () => {
  it('only on a film whose scale is its own ruler: none without one, none on a fit (G) or the assumed scale', () => {
    expect(fineTuneOf(null, scaleOf(0.1), true, step)).toBeNull();          // a calibration whose marks no longer set the scale
    expect(fineTuneOf(R, scaleOf(null), true, step)).toBeNull();
    expect(fineTuneOf(null, fit, true, step)).toBeNull();                   // a fitted film has no ruler
    expect(fineTuneOf(R, fit, true, step)).toBeNull();
    expect(fineTuneOf(R, scaleOf(0.1), true, step)).toEqual({ steps: 0, canDown: true, canUp: true, onStep: step });
  });
  it('at +5 % only − works, at −5 % only +; read-only, the preview open or busy: neither', () => {
    expect(fineTuneOf({ ...R, steps: 10 }, scaleOf(0.105, 10), true, step)).toMatchObject({ steps: 10, canDown: true, canUp: false });
    expect(fineTuneOf({ ...R, steps: -10 }, scaleOf(0.095, -10), true, step)).toMatchObject({ canDown: false, canUp: true });
    expect(fineTuneOf({ ...R, steps: 9 }, scaleOf(0.1045, 9), true, step)).toMatchObject({ canDown: true, canUp: true });
    expect(fineTuneOf(R, scaleOf(0.1), false, step)).toMatchObject({ canDown: false, canUp: false });
  });
});

describe('pressOn (fix round 1, review M-3): a press builds on a pending ruler-mark drop, never the stale marks', () => {
  it('no drop pending: the press builds on the ruler itself, one more or fewer step', () => {
    expect(pressOn(R, null, 1)).toEqual({ ...R, steps: 1 });
    expect(pressOn({ ...R, steps: 3 }, null, -1)).toEqual({ ...R, steps: 2 });
  });
  it('a drop still being stored: the press builds on the PENDING marks, not the stale ruler underneath them', () => {
    const pending = { p1: { x: 50, y: 50 }, p2: { x: 260, y: 10 }, mm: 20, steps: 0 };   // a drop resets steps to 0
    expect(pressOn(R, pending, 1)).toEqual({ ...pending, steps: 1 });   // NOT { ...R, steps: 1 } — that would undo the drop
  });
  it('nothing calibrated: no press to make', () => { expect(pressOn(null, null, 1)).toBeNull(); });
  it('refuses past ±5 %, even mid-drop', () => {
    expect(pressOn({ ...R, steps: 10 }, null, 1)).toBeNull();
    expect(pressOn(R, { ...R, steps: -10 }, -1)).toBeNull();
  });
});
