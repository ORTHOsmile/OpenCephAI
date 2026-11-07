import { describe, it, expect } from 'vitest';
import { compile, type Vec2 } from '@ceph/geometry';
import { buildRegistry } from './registry';
import { ALL_ANALYSES } from './analyses';
import { CATALOGUE } from './catalogue';
import { SYNTHETIC_SKULLS } from './fixtures';

/** FACING-1 (owner approved 12 Oct 2026). Stored landmarks are raw image px (y down); the display
 *  orientation is separate (apps/desktop/src/canvas/orientation.ts), so a film whose face points LEFT
 *  reaches the catalogue mirrored. Every measurement is a property of the skull, not of which way the
 *  film was taken, so the value on the mirror image must equal the original.
 *  Instrument checks: it reports how many values it compared and fails if none; and a
 *  positive control in the same test shows the comparison sees a real change (B moved 20 px moves ANB). */
const MIRROR_X = 1000;
const mirror = (pts: Record<string, Vec2>): Record<string, Vec2> =>
  Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, { x: MIRROR_X - v.x, y: v.y }]));
const MM_PER_PX = 0.1;
const TOL = 1e-9;

describe('FACING-1: a left-facing film measures the same as a right-facing one', () => {
  const g = compile(buildRegistry(ALL_ANALYSES));
  const ids = CATALOGUE.map((e) => e.id);
  const scalar = (pts: Record<string, Vec2>, id: string): number | null => {
    const r = g.evaluate(pts, MM_PER_PX)[id];
    return r && r.t === 'scalar' ? r.v : null;
  };
  /** Compares a against b for every catalogue id on one skull; returns [compared, differing ids]. */
  const compare = (a: Record<string, Vec2>, b: Record<string, Vec2>): [number, string[]] => {
    let n = 0; const diff: string[] = [];
    for (const id of ids) {
      const x = scalar(a, id), y = scalar(b, id);
      if (x === null && y === null) continue;                       // not computable on either: nothing to compare
      n++;
      if (x === null || y === null || !(Math.abs(x - y) <= TOL)) diff.push(`${id}: ${x} vs ${y}`);
    }
    return [n, diff];
  };

  it('every catalogue measurement on every SYNTHETIC skull is unchanged by mirroring', () => {
    // Positive control: the comparison must report a change where one is known to exist.
    const base = SYNTHETIC_SKULLS[0].points;
    const movedB = { ...base, B: { x: base.B.x - 20, y: base.B.y } };
    const [, ctrl] = compare(base, movedB);
    expect(ctrl.some((d) => d.startsWith('m03_ANB:'))).toBe(true);

    let compared = 0; const changed: string[] = [];
    for (const s of SYNTHETIC_SKULLS) {
      const [n, diff] = compare(s.points, mirror(s.points));
      compared += n; changed.push(...diff.map((d) => `${s.name} ${d}`));
    }
    console.log(`FACING-1: compared ${compared} values (${SYNTHETIC_SKULLS.length} skulls × ${ids.length} measurements, nulls on both sides skipped); ${changed.length} differ`);
    expect(compared).toBeGreaterThan(0);
    expect(compared).toBe(546);   // 546: #93 BaSN on the 6 skulls (owner ruling 7 Nov 2026; was 540)
    expect(changed).toEqual([]);
  });
});
