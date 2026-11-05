import { describe, it, expect } from 'vitest';
import { withMark, baseOf, dropOf, shown } from './useRulerMarks';

const R = { p1: { x: 10, y: 10 }, p2: { x: 210, y: 10 }, mm: 20, steps: 3 };
describe('a ruler mark being moved (spec 2026-10-19, F)', () => {
  it('moves only the mark being dragged, keeps the true distance, and starts the fine-tune again from 0 (addendum 3)', () => {
    expect(withMark(R, { i: 0, p: { x: 5, y: 6 } })).toEqual({ p1: { x: 5, y: 6 }, p2: { x: 210, y: 10 }, mm: 20, steps: 0 });
    expect(withMark(R, { i: 1, p: { x: 260, y: 10 } })).toEqual({ p1: { x: 10, y: 10 }, p2: { x: 260, y: 10 }, mm: 20, steps: 0 });
  });
  it('no drag: the marks as they are (the same object)', () => { expect(withMark(R, null)).toBe(R); });
});

// Fix round 1, M2: a second drop before the first finishes saving must build on top of it, not on the stale ruler.
describe('baseOf (fix round 1, M2)', () => {
  const pending = { p1: { x: 5, y: 5 }, p2: { x: 210, y: 10 }, mm: 20, steps: 0 };
  it('a drop still pending is the base, not the stale ruler', () => { expect(baseOf(R, pending)).toBe(pending); });
  it('no drop pending: the ruler itself', () => { expect(baseOf(R, null)).toBe(R); });
  it('neither: nothing to show', () => { expect(baseOf(null, null)).toBeNull(); });
});

// Fix round 1, M3: the hook's drop and refusal logic, as pure functions (no renderHook library in apps/desktop).
describe('dropOf (fix round 1, M3: a press that never moves does nothing)', () => {
  it('no drag: nothing to drop', () => { expect(dropOf(R, null)).toBeNull(); });
  it('no base (never calibrated): nothing to drop even mid-drag', () => { expect(dropOf(null, { i: 0, p: { x: 1, y: 1 } })).toBeNull(); });
  it('a real drag: the marks it would drop', () => { expect(dropOf(R, { i: 1, p: { x: 260, y: 10 } })).toEqual({ p1: { x: 10, y: 10 }, p2: { x: 260, y: 10 }, mm: 20, steps: 0 }); });
});

describe('shown (fix round 1, M3: enabled=false shows nothing)', () => {
  it('disabled: null even with a ruler and mid-drag', () => { expect(shown(false, R, { i: 0, p: { x: 1, y: 1 } })).toBeNull(); });
  it('disabled with no ruler at all: still null', () => { expect(shown(false, null, null)).toBeNull(); });
  it('enabled, no drag: the base as-is (same object)', () => { expect(shown(true, R, null)).toBe(R); });
  it('enabled, mid-drag: the base with the drag applied', () => { expect(shown(true, R, { i: 0, p: { x: 1, y: 1 } })).toEqual({ ...R, p1: { x: 1, y: 1 }, steps: 0 }); });
  it('enabled, nothing calibrated: null', () => { expect(shown(true, null, null)).toBeNull(); });
});
