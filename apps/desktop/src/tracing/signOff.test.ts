import { describe, it, expect } from 'vitest';
import { autoSignAllowed, autoSignNow, autoSignStillAllowed, holdLine, nextHold } from './signOff';
import type { TracingPoint } from './state';

// Synthetic points only.
const pt = (verified: boolean): TracingPoint => ({ x: 1, y: 1, source: 'ai', verified });
const all = { S: pt(true), N: pt(true) }, some = { S: pt(true), N: pt(false) };

describe('when a tracing waits for "Mark tracing verified" (spec 2026-10-19, V2/V3)', () => {
  it('opening a film with every point accepted but not signed off holds it (the cause is not stored)', () => {
    expect(nextHold(null, { kind: 'opened', signed: false, points: all })).toBe('opened');
    expect([nextHold('mm', { kind: 'opened', signed: true, points: all }), nextHold(null, { kind: 'opened', signed: false, points: some }),
      nextHold(null, { kind: 'opened', signed: false, points: {} })]).toEqual([null, null, null]);
  });
  it('V3: a calibration of a signed-off tracing holds it, so a later point action cannot re-sign it', () => {
    const h = nextHold(null, { kind: 'mmChanged', wasSigned: true, points: all });
    expect([h, autoSignAllowed(h)]).toEqual(['mm', false]);
  });
  it('a calibration with every point accepted, or while already held, holds too (and says the mm changed)', () => {
    expect(nextHold(null, { kind: 'mmChanged', wasSigned: false, points: all })).toBe('mm');
    expect(nextHold('reopen', { kind: 'mmChanged', wasSigned: false, points: some })).toBe('mm');
  });
  it('a calibration while points are still left, never signed, holds nothing: accepting the rest signs with the new mm', () => {
    expect(nextHold(null, { kind: 'mmChanged', wasSigned: false, points: some })).toBeNull();
  });
  it('Reopen holds; pressing Mark tracing verified lifts any hold', () => {
    expect(nextHold(null, { kind: 'reopened' })).toBe('reopen');
    expect(['mm', 'reopen', 'opened', null].map((h) => nextHold(h as never, { kind: 'signed' }))).toEqual([null, null, null, null]);
  });
  it('only an un-held tracing signs itself off; only the mm hold has a line', () => {
    expect(['mm', 'reopen', 'opened', null].map((h) => autoSignAllowed(h as never))).toEqual([false, false, false, true]);
    expect(['mm', 'reopen', 'opened', null].map((h) => holdLine(h as never))).toEqual(['The mm changed — check, then mark verified.', null, null, null]);
  });
  it('fix round 1, review M-1: a hold set while an automatic sign-off is in flight must still stop it at the re-check', () => {
    // 'button' never re-checks the hold at this point: the button press itself just set or lifted it.
    expect([autoSignStillAllowed('auto', null), autoSignStillAllowed('auto', 'mm'), autoSignStillAllowed('auto', 'reopen'), autoSignStillAllowed('auto', 'opened'),
      autoSignStillAllowed('button', 'mm')]).toEqual([true, false, false, false, true]);
  });
  it('automatic sign-off waits while points are still to come (spec §3, owner D2)', () => {
    expect([autoSignNow(null, false), autoSignNow(null, true), autoSignNow('mm', false)]).toEqual([true, false, false]);
  });
});
