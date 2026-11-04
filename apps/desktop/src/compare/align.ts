import type { Vec2 } from '@ceph/geometry';

export type Pts = Readonly<Record<string, Vec2 | undefined>>;

/**
 * Overlay aligned on S–N at S (spec Part 3, option A): the comparison's S lands on the current S and its S→N lies along
 * the current S→N. It is a rotation plus a translation. `ratio` (other mm/px ÷ this mm/px) converts the other film's
 * pixels into this film's, so both are in true mm with no fitting scale. `mirror` flips a comparison that faces the other
 * way before aligning it, so it is never turned upside down. Null when S or N is missing or coincident on either scan.
 */
export function alignOnSN(cur: Pts, other: Pts, ratio: number, mirror: boolean): ((p: Vec2) => Vec2) | null {
  const m = (p: Vec2): Vec2 => (mirror ? { x: -p.x, y: p.y } : p);
  const S1 = cur.S, N1 = cur.N, S2 = other.S && m(other.S), N2 = other.N && m(other.N);
  if (!S1 || !N1 || !S2 || !N2 || !(ratio > 0) || !Number.isFinite(ratio)) return null;
  const u = { x: N1.x - S1.x, y: N1.y - S1.y }, v = { x: N2.x - S2.x, y: N2.y - S2.y };
  if (!Math.hypot(u.x, u.y) || !Math.hypot(v.x, v.y)) return null;
  const t = Math.atan2(u.y, u.x) - Math.atan2(v.y, v.x), c = Math.cos(t) * ratio, s = Math.sin(t) * ratio;
  return (p) => { const q = m(p), dx = q.x - S2.x, dy = q.y - S2.y; return { x: S1.x + c * dx - s * dy, y: S1.y + s * dx + c * dy }; };
}
