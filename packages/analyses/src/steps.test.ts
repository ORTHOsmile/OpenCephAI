import { describe, it, expect } from 'vitest';
import type { AnalysisDef } from '@ceph/geometry';
import { buildRegistry, BUILT_INS, ISBI19, LANDMARKS, LINE_NAMES } from './index';
import { guidedSteps, nextStep, stepDone } from './steps';

/** A tiny four-measurement analysis, used only to exercise the step-sequencing algorithm itself
 *  (dependency order, "done", "next"). It used to borrow the real STEINER for this, back when
 *  STEINER had only these four measurements; Part A task 8 gave STEINER its real 14-item list, so
 *  this now builds its own small fixture from the same catalogue ids (m01_SNA etc.) instead —
 *  same shape, same expected step order. */
const TINY: AnalysisDef = {
  id: 'tiny', name: 'Tiny', nodes: {},
  measurements: [
    { node: 'm01_SNA', label: 'SNA' }, { node: 'm02_SNB', label: 'SNB' },
    { node: 'm03_ANB', label: 'ANB' }, { node: 'm20_SNGoGn', label: 'SN–GoGn' },
  ],
};
const steps = guidedSteps([TINY], buildRegistry([TINY]));
describe('guided steps', () => {
  // Fix round 1 (Minor 1): SN and Go–Gn both have a LINE_NAMES entry, so their step labels are now the plain
  // names ("SN (S–N)", "Mandibular plane Go–Gn"), never the raw endpoint ids — updated here to match, since the
  // fix applies to every guidedSteps call, not only the found-first path. The dependency ORDER this test guards
  // (place S, N, A before SNA; draw the line only after both its points) is unchanged.
  it('follow the dependency order, placing each landmark once', () => {
    expect(steps.map((s) => s.label)).toEqual([
      'Place S', 'Place N', 'Place A', 'Calculate SNA', 'Place B', 'Calculate SNB', 'Calculate ANB',
      'Draw SN (S–N)', 'Place Go', 'Place Gn', 'Draw Mandibular plane Go–Gn', 'Calculate SN–GoGn',
    ]);
  });
  it('a step is done when every landmark it needs is verified', () => {
    const sna = steps.find((s) => s.label === 'Calculate SNA')!;
    expect(stepDone(sna, new Set(['S', 'N']))).toBe(false);
    expect(stepDone(sna, new Set(['S', 'N', 'A']))).toBe(true);
  });
  it('advances to the first step not yet done', () => {
    expect(nextStep(steps, new Set())!.label).toBe('Place S');
    expect(nextStep(steps, new Set(['S', 'N', 'A']))!.label).toBe('Place B');
    expect(nextStep(steps, new Set(['S', 'N', 'A', 'B', 'Go', 'Gn']))).toBeNull();
  });
});

describe('guided steps on the real BUILT_INS (Task 8 review, fix round 1: TINY above lost this coverage)', () => {
  const realSteps = guidedSteps(BUILT_INS, buildRegistry(BUILT_INS));
  it('builds without throwing, and is not empty', () => {
    expect(realSteps.length).toBeGreaterThan(0);
  });
  it('every "place" step names a real landmark', () => {
    for (const s of realSteps) if (s.kind === 'place') {
      expect(s.landmarks).toHaveLength(1);
      expect(LANDMARKS[s.landmarks[0] as keyof typeof LANDMARKS]).toBeDefined();
    }
  });
});

describe('steps: AI-found points first, one step per line, plain names (a known gap)', () => {
  const ORIGINAL_19: string[] = [...ISBI19];                         // P22: imported from './index', not retyped
  const reg = buildRegistry(BUILT_INS);
  const s = guidedSteps(BUILT_INS, reg, new Set(ORIGINAL_19));
  it('every point a model finds comes before any point placed by hand', () => {
    const places = s.filter((x) => x.kind === 'place').map((x) => x.landmarks[0]);
    const lastFound = Math.max(...places.map((p, i) => (ORIGINAL_19.includes(p) ? i : -1)));
    const firstHand = places.findIndex((p) => !ORIGINAL_19.includes(p));
    expect(lastFound).toBeLessThan(firstHand);
  });
  // Fix round 1, ruling T7-2: the old test compared LABELS, so it only ever saw one of the six reversed pairs
  // BUILT_INS actually draws (the one pair, OPd/OPdRev, that happens to share a LINE_NAMES label) — blind to
  // FH/FH_post, GoGn/GnGo, U1ax/U1axRev, L1ax/L1axRev and MPt/MeTg. This one keys on the line's own sorted
  // endpoints (from the registry), so it cannot be fooled by two different labels for the same line.
  it('a line drawn both ways is one step, by its endpoints not its label (FH: Po–Or / Or–Po were two)', () => {
    const draws = s.filter((x) => x.kind === 'draw');
    const endpointKeys = draws.map((d) => { const e = reg[d.node]; return e.kind === 'line' ? [e.a, e.b].sort().join('|') : d.node; });
    expect(new Set(endpointKeys).size).toBe(endpointKeys.length);
  });
  // Fix round 1, Minor 1: a line with a LINE_NAMES entry always uses it, even when both ends are built points
  // (U1ax used to fall through to "Draw U1A–U1T" instead of "U1 long axis (apex to tip)"). Positive control:
  // the `some(...)` assertion proves this really exercises a named two-landmark line, not a vacuous loop.
  it('every line with a LINE_NAMES entry uses its plain name, never the raw endpoint ids', () => {
    const draws = s.filter((x) => x.kind === 'draw' && reg[x.node].kind === 'line' && LINE_NAMES[x.node]);
    expect(draws.length).toBeGreaterThan(0);                        // positive control: named lines are really drawn
    for (const d of draws) expect(d.label).toBe(`Draw ${LINE_NAMES[d.node]}`);
  });
  it('no internal name in a step ("Draw M6–MInc" reads as the occlusal plane)', () => {
    expect(s.map((x) => x.label).join(' ')).not.toMatch(/\bM6\b|\bMInc\b/);
  });
  it('still in dependency order: a line is drawn after both its points are placed', () => {
    const at = (l: string) => s.findIndex((x) => x.kind === 'place' && x.landmarks[0] === l);
    for (const d of s.filter((x) => x.kind === 'draw')) for (const l of d.landmarks) expect(at(l)).toBeLessThan(s.indexOf(d));
  });
});
