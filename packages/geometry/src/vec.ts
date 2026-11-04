/** A point or vector in any 2-D space (image px, screen px, mm). */
export interface Vec2 { readonly x: number; readonly y: number }
/** Infinite line p + t·d, with d ≠ 0. Direction matters for angleLines and signedDistance. */
export interface Line { readonly p: Vec2; readonly d: Vec2 }

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const RAD2DEG = 180 / Math.PI;
const EPS = 1e-9;

export function lineThrough(a: Vec2, b: Vec2): Line | null {
  const d = sub(b, a);
  return len(d) < EPS ? null : { p: a, d };
}
/** p1 + t·d1 = p2 + u·d2  →  t = cross(p2 − p1, d2) / cross(d1, d2) */
export function intersect(l1: Line, l2: Line): Vec2 | null {
  const den = cross(l1.d, l2.d);
  if (Math.abs(den) < EPS * len(l1.d) * len(l2.d)) return null;
  return add(l1.p, mul(l1.d, cross(sub(l2.p, l1.p), l2.d) / den));
}
/** Foot of the perpendicular from p: p0 + ((p − p0)·d / d·d) d */
export function project(p: Vec2, l: Line): Vec2 {
  return add(l.p, mul(l.d, dot(sub(p, l.p), l.d) / dot(l.d, l.d)));
}
/** Line through p at right angles to l, directed DOWN THE FILM (image +y, since image y grows downward),
 *  whichever way l runs. Stored landmarks are raw image px and a film may face left or right
 *  (display orientation is separate), so a fixed-handedness rotation would point down on a
 *  right-facing film and UP on a left-facing one (FACING-1). Measurements use this direction as
 *  "down" (Kim's palatal sign, cant of the occlusal plane, overbite, the point 3 mm below A).
 *  Tie: when l is exactly vertical the perpendicular is horizontal, "down" has no meaning, and the
 *  +90° rotation of l.d is kept as it is. No real FH or occlusal plane is vertical. */
export function perpendicularThrough(p: Vec2, l: Line): Line {
  const d = { x: -l.d.y, y: l.d.x };
  return { p, d: d.y < 0 ? { x: -d.x, y: -d.y } : d };
}
export const unit = (a: Vec2): Vec2 => { const l = len(a); return l < EPS ? a : mul(a, 1 / l); };
/** Unsigned angle between two directions, degrees in [0,180]. atan2 form is stable near 0° and 180° (acos is not). */
export const angleBetween = (u: Vec2, v: Vec2): number => Math.atan2(Math.abs(cross(u, v)), dot(u, v)) * RAD2DEG;
/** Angle at vertex v in triangle a-v-b. */
export const angleAt = (a: Vec2, v: Vec2, b: Vec2): number => angleBetween(sub(a, v), sub(b, v));
/** Distance from p to l, signed + when (p − foot) points along `positive`. A point on the line gives 0. */
export function signedDistance(p: Vec2, l: Line, positive: Vec2): number {
  const off = sub(p, project(p, l)), d = len(off);
  if (d < EPS) return 0;
  return Math.sign(dot(off, positive)) >= 0 ? d : -d;
}
