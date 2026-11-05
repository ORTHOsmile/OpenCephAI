import { describe, it, expect } from 'vitest';
import { extraShownBy, firstShown, landingNow, lateArrivals, levelAgain, waitingFor } from './twoStep';
import type { Placement } from '../ai/placement';
const AZ = 'aariz-cepha29', SR = 'srpose-cldet23';
const lm = (id: string, x: number) => ({ id, x, y: 1, confidence: 0.9 });
const first0: Placement = { landmarks: [lm('S', 1), lm('Go', 2)], source: { S: AZ, Go: AZ }, fallback: ['Go'], via: 'auto-best', wanted: { Go: SR } };
const full: Placement = { landmarks: [lm('S', 1), lm('Go', 3), lm('Ba', 4)], source: { S: AZ, Go: SR, Ba: SR }, fallback: [], via: 'auto-best', wanted: {} };
describe('two steps on screen (spec §3; owner D2, Q6 A)', () => {
  it('the first step holds back every point that waits for another model', () => {
    const f = firstShown(first0);
    expect([f.landmarks.map((l) => l.id), Object.keys(f.source), f.fallback, f.via]).toEqual([['S'], ['S'], [], 'auto-best']);
    expect([...waitingFor(f)]).toEqual([SR]);
  });
  it('late points: what the first step did not show, only where the film is still free', () => {
    const f = firstShown(first0);
    const ai = { x: 9, y: 9, source: 'ai' as const, verified: false };
    expect(lateArrivals(full, f, {}).landmarks.map((l) => l.id)).toEqual(['Go', 'Ba']);
    expect(lateArrivals(full, f, { Go: ai }).landmarks.map((l) => l.id), 'an untouched AI point is replaced').toEqual(['Go', 'Ba']);
    for (const p of [{ ...ai, source: 'ai-adjusted' as const }, { ...ai, verified: true }]) {
      expect(lateArrivals(full, f, { Go: p }).landmarks.map((l) => l.id), `never over ${p.source}/${p.verified}`).toEqual(['Ba']);
    }
    // Final review I1: under a point you placed by hand it still comes, for the ⌘Z history only; it does not land now.
    const yours = { ...ai, source: 'manual' as const, verified: true };
    const under = lateArrivals(full, f, { Go: yours });
    expect([under.landmarks.map((l) => l.id), landingNow(under, { Go: yours }).map((l) => l.id)]).toEqual([['Go', 'Ba'], ['Ba']]);
    const late = lateArrivals(full, f, {});
    expect([late.source, late.via]).toEqual([{ Go: SR, Ba: SR }, 'auto-best']);
  });
  it('nothing waiting: no late point; Po or Or arriving late levels the film again', () => {
    expect(lateArrivals(first0, first0, {}).landmarks).toEqual([]);
    expect(levelAgain([lm('Po', 1)])).toBe(true);
    expect(levelAgain(full.landmarks)).toBe(false);
  });
});

describe('which extra models show a bar and an error line (spec §6, D2; fix round 1)', () => {
  it('until the ghost settings have loaded: none (the screen never flashes a bar you turned off)', () => {
    expect([extraShownBy(null)(SR), extraShownBy(null)(AZ)]).toEqual([false, false]);
  });
  it('once loaded: every model whose ghost is on, none whose ghost is off', () => {
    const shown = extraShownBy(new Set([SR]));
    expect([shown(SR), shown(AZ), extraShownBy(new Set())(SR)]).toEqual([false, true, true]);
  });
});
