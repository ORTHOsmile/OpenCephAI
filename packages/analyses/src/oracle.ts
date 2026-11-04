/** Independent, plain-maths oracle for catalogue tests. Deliberately does NOT import @ceph/geometry:
 *  a bug shared between the engine and its own oracle would pass unnoticed. */
export type P2 = { x: number; y: number };
export const sub = (a: P2, b: P2) => ({ x: a.x - b.x, y: a.y - b.y });
export const ang = (u: P2, v: P2) => Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))))) * 180 / Math.PI;
export const angAt = (a: P2, v: P2, b: P2) => ang(sub(a, v), sub(b, v));
export const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: P2, b: P2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Signed distance from p to line a→b; + when p lies on the side `toward` points to. */
export const sdist = (p: P2, a: P2, b: P2, toward: P2) => {
  const d = sub(b, a), n = { x: -d.y, y: d.x }, L = Math.hypot(d.x, d.y);
  const s = ((p.x - a.x) * n.x + (p.y - a.y) * n.y) / L;
  const side = Math.sign(n.x * toward.x + n.y * toward.y) || 1;
  return s * side;
};
export const meet = (a1: P2, a2: P2, b1: P2, b2: P2): P2 => {  // line a1a2 × line b1b2
  const d1 = sub(a2, a1), d2 = sub(b2, b1), den = d1.x * d2.y - d1.y * d2.x;
  const t = ((b1.x - a1.x) * d2.y - (b1.y - a1.y) * d2.x) / den; return { x: a1.x + t * d1.x, y: a1.y + t * d1.y };
};
