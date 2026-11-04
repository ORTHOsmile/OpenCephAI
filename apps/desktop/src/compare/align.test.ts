import { describe, it, expect } from 'vitest';
import type { Vec2 } from '@ceph/geometry';
import { alignOnSN } from './align';

// SYNTHETIC landmark sets. "cur" is the open scan; "other" is the same shape moved by a known rotation and translation.
const cur: Record<string, Vec2> = { S: { x: 100, y: 200 }, N: { x: 400, y: 150 }, Me: { x: 250, y: 700 }, Pog: { x: 390, y: 640 } };
function moved(pts: Record<string, Vec2>, theta: number, to: Vec2, shrink = 1, mirror = false): Record<string, Vec2> {
  const S = pts.S, c = Math.cos(theta), s = Math.sin(theta);
  return Object.fromEntries(Object.entries(pts).map(([k, p]) => {
    const dx = (p.x - S.x) / shrink, dy = (p.y - S.y) / shrink, x = to.x + c * dx - s * dy, y = to.y + s * dx + c * dy;
    return [k, { x: mirror ? -x : x, y }];
  }));
}
const close = (a: Vec2, b: Vec2) => { expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); };

describe('overlay aligned on S–N at S (spec Part 3, option A)', () => {
  it('recovers a known rotation and translation to 1e-9', () => {
    const other = moved(cur, -0.3, { x: 900, y: 50 });
    const f = alignOnSN(cur, other, 1, false)!;
    for (const k of Object.keys(cur)) close(f(other[k]), cur[k]);
  });
  it('turns the other film’s pixels into this film’s through each scan’s own scale', () => {
    const other = moved(cur, 0.5, { x: 40, y: 60 }, 2);                    // other film: 0.2 mm/px, this one 0.1 mm/px
    const f = alignOnSN(cur, other, 0.2 / 0.1, false)!;
    for (const k of Object.keys(cur)) close(f(other[k]), cur[k]);
  });
  /** Review focus 5: a comparison facing the other way is mirrored, never turned upside down. */
  it('mirrors a comparison that faces the other way', () => {
    const other = moved(cur, 0.2, { x: 500, y: 300 }, 1, true);
    const f = alignOnSN(cur, other, 1, true)!;
    for (const k of Object.keys(cur)) close(f(other[k]), cur[k]);
    expect(f(other.Me).y).toBeGreaterThan(f(other.N).y);                     // the chin stays below nasion
  });
  it('refuses when S or N is missing or coincident', () => {
    const { N: _n, ...noN } = cur;
    expect(alignOnSN(noN, cur, 1, false)).toBeNull();
    expect(alignOnSN(cur, { ...cur, N: cur.S }, 1, false)).toBeNull();
    expect(alignOnSN(cur, cur, 0, false)).toBeNull();
  });
});
