import type { Vec2 } from '@ceph/geometry';
import type { Viewport } from './viewport';

/** Display-only orientation (§2 "Orientation", decision 14). Stored landmarks never change. */
export interface Orientation { mirror: boolean; rotDeg: number; source: 'none' | 'auto-FH' | 'manual' | 'restored' }
export const NO_ORIENTATION: Orientation = { mirror: false, rotDeg: 0, source: 'none' };
export interface Dims { W: number; H: number }

// Pixel-centre convention: the image spans [−0.5, W−0.5]; its centre is ((W−1)/2, (H−1)/2).
const centre = (d: Dims): Vec2 => ({ x: (d.W - 1) / 2, y: (d.H - 1) / 2 });

/** 2×2 linear part of D = R(θ)·M, row-major [a b; c d]. θ > 0 turns clockwise on screen (y down). */
export function linearOf(o: Orientation): [number, number, number, number] {
  const t = (o.rotDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), m = o.mirror ? -1 : 1;
  return [c * m, -s, s * m, c];
}
export function invLinear(o: Orientation, v: Vec2): Vec2 {
  const [a, b, c, d] = linearOf(o), det = a * d - b * c;
  return { x: (d * v.x - b * v.y) / det, y: (-c * v.x + a * v.y) / det };
}
/** D: image px → display px (rotation and mirror about the image centre). */
export function displayOf(o: Orientation, dims: Dims, p: Vec2): Vec2 {
  if (!o.mirror && o.rotDeg === 0) return p;
  const [a, b, c, d] = linearOf(o), m = centre(dims), x = p.x - m.x, y = p.y - m.y;
  return { x: a * x + b * y + m.x, y: c * x + d * y + m.y };
}
/** D⁻¹: display px → image px. */
export function imageOf(o: Orientation, dims: Dims, q: Vec2): Vec2 {
  const m = centre(dims), v = invLinear(o, { x: q.x - m.x, y: q.y - m.y });
  return { x: v.x + m.x, y: v.y + m.y };
}
export const toScreen = (v: Viewport, o: Orientation, dims: Dims, p: Vec2): Vec2 => {
  const q = displayOf(o, dims, p); return { x: v.k * q.x + v.tx, y: v.k * q.y + v.ty };
};
export const toImage = (v: Viewport, o: Orientation, dims: Dims, s: Vec2): Vec2 =>
  imageOf(o, dims, { x: (s.x - v.tx) / v.k, y: (s.y - v.ty) / v.k });

/** Axis-aligned bounds of D(image), in display px. */
export function displayBounds(o: Orientation, dims: Dims) {
  const c = [{ x: -0.5, y: -0.5 }, { x: dims.W - 0.5, y: -0.5 }, { x: -0.5, y: dims.H - 0.5 }, { x: dims.W - 0.5, y: dims.H - 0.5 }]
    .map((p) => displayOf(o, dims, p));
  return { x0: Math.min(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), x1: Math.max(...c.map((p) => p.x)), y1: Math.max(...c.map((p) => p.y)) };
}
export function fitOriented(o: Orientation, dims: Dims, vw: number, vh: number, margin = 0.95): Viewport {
  const b = displayBounds(o, dims), w = b.x1 - b.x0, h = b.y1 - b.y0, k = margin * Math.min(vw / w, vh / h);
  return { k, tx: (vw - k * w) / 2 - k * b.x0, ty: (vh - k * h) / 2 - k * b.y0 };
}
/** Smallest rotation (deg) that makes Po→Or horizontal: the film stays upright whichever way the face points. */
export function levelRotation(Po: Vec2, Or: Vec2, mirror: boolean): number {
  const dx = (Or.x - Po.x) * (mirror ? -1 : 1), dy = Or.y - Po.y;
  const a = (Math.atan2(dy, dx) * 180) / Math.PI, target = Math.abs(a) > 90 ? 180 : 0;   // FH points right → 0°, left → 180°
  let r = target - a; while (r > 180) r -= 360; while (r <= -180) r += 360;
  return r;
}
/** ctx.setTransform arguments that draw image pixel p at toScreen(p)·dpr. */
export function canvasMatrix(v: Viewport, o: Orientation, dims: Dims, dpr: number): [number, number, number, number, number, number] {
  const [a, b, c, d] = linearOf(o), m = centre(dims), s = v.k * dpr;
  const ex = m.x - (a * m.x + b * m.y), ey = m.y - (c * m.x + d * m.y);   // D(p) = L·p + (m − L·m)
  return [s * a, s * c, s * b, s * d, s * ex + v.tx * dpr, s * ey + v.ty * dpr];
}
