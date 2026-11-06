import { describe, it, expect } from 'vitest';
import type { AnalysisDef } from '@ceph/geometry';
import { buildRegistry, guidedSteps } from '@ceph/analyses';
import { advanceDecision, nextToPlace, ADVANCE_DELAY_MS } from './advance';

/** A tiny four-measurement analysis, used only to exercise the advance/next-point logic itself.
 *  It used to borrow the real STEINER for this, back when STEINER had only these four
 *  measurements; Part A task 8 gave STEINER its real 14-item list, so this now builds its own
 *  small fixture from the same catalogue ids (m01_SNA etc.) instead — same shape, same expected
 *  order. */
const TINY: AnalysisDef = {
  id: 'tiny', name: 'Tiny', nodes: {},
  measurements: [
    { node: 'm01_SNA', label: 'SNA' }, { node: 'm02_SNB', label: 'SNB' },
    { node: 'm03_ANB', label: 'ANB' }, { node: 'm20_SNGoGn', label: 'SN–GoGn' },
  ],
};
const steps = guidedSteps([TINY], buildRegistry([TINY]));
const set = (...ids: string[]) => new Set(ids);

// Owner, 6 Nov 2026: the "Move to the next point automatically" switch (ON by default). Off: the magnifier stays where it is.
describe('step advance with the switch off', () => {
  const set = (...ids: string[]) => new Set(ids);
  /** Fails if off still waits (and so still moves on after the pause), or if on stops waiting. */
  it('a point just released: on waits then advances (as always); off syncs at once, with no pause and no move', () => {
    expect(advanceDecision(set('S'), set('S', 'N'), { dragging: false, fresh: false })).toBe('wait');
    expect(advanceDecision(set('S'), set('S', 'N'), { dragging: false, fresh: false, auto: true })).toBe('wait');
    expect(advanceDecision(set('S'), set('S', 'N'), { dragging: false, fresh: false, auto: false })).toBe('sync');
  });
  it('edges: nothing new, or mid-drag: none either way; undo and a fresh film sync either way', () => {
    for (const auto of [true, false]) {
      expect(advanceDecision(set('S'), set('S'), { dragging: false, fresh: false, auto })).toBe('none');
      expect(advanceDecision(set('S'), set('S', 'N'), { dragging: true, fresh: false, auto })).toBe('none');
      expect(advanceDecision(set('S', 'N'), set('S'), { dragging: false, fresh: false, auto })).toBe('sync');
      expect(advanceDecision(set(), set('S', 'N'), { dragging: false, fresh: true, auto })).toBe('sync');
    }
  });
});

describe('step advance: the highlight and the magnifier move together, after a pause', () => {
  it('the next point to place is the first unverified landmark of the next step', () => {
    expect(nextToPlace(steps, set())).toBe('S');
    expect(nextToPlace(steps, set('S', 'N', 'A'))).toBe('B');
    expect(nextToPlace(steps, set('S', 'N', 'A', 'B', 'Go', 'Gn'))).toBeNull();
  });
  it('waits after a point is released, and not at all while it is still being dragged', () => {
    expect(advanceDecision(set('S'), set('S', 'N'), { dragging: false, fresh: false })).toBe('wait');
    expect(advanceDecision(set('S'), set('S', 'N'), { dragging: true, fresh: false })).toBe('none');
    expect(ADVANCE_DELAY_MS).toBeGreaterThanOrEqual(2000);
    expect(ADVANCE_DELAY_MS).toBeLessThanOrEqual(3000);
  });
  it('follows at once when nothing new was verified (undo, remove) or a case was just opened', () => {
    expect(advanceDecision(set('S', 'N'), set('S'), { dragging: false, fresh: false })).toBe('sync');
    expect(advanceDecision(set(), set('S', 'N'), { dragging: false, fresh: true })).toBe('sync');
    expect(advanceDecision(set('S'), set('S'), { dragging: false, fresh: false })).toBe('none');
  });
});
