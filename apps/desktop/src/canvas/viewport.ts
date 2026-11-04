import type { Vec2 } from '@ceph/geometry';
export interface Viewport { readonly k: number; readonly tx: number; readonly ty: number }
export const K_MIN = 0.02, K_MAX = 40;
export const imageToScreen = (v: Viewport, p: Vec2): Vec2 => ({ x: v.k * p.x + v.tx, y: v.k * p.y + v.ty });
export const screenToImage = (v: Viewport, s: Vec2): Vec2 => ({ x: (s.x - v.tx) / v.k, y: (s.y - v.ty) / v.k });
export function zoomAt(v: Viewport, c: Vec2, factor: number): Viewport {
  const k = Math.min(K_MAX, Math.max(K_MIN, v.k * factor)), f = k / v.k;
  return { k, tx: c.x - f * (c.x - v.tx), ty: c.y - f * (c.y - v.ty) };
}
export function fit(W: number, H: number, vw: number, vh: number, margin = 0.95): Viewport {
  const k = margin * Math.min(vw / W, vh / H);
  return { k, tx: (vw - k * W) / 2, ty: (vh - k * H) / 2 };
}

/** Pixels of image that must stay inside the view on each axis, so a scroll can never lose the image. */
export const PAN_KEEP = 80;
export function clampPan(v: Viewport, W: number, H: number, vw: number, vh: number, keep = PAN_KEEP): Viewport {
  const w = v.k * W, h = v.k * H, kx = Math.min(keep, w), ky = Math.min(keep, h);
  const tx = Math.min(vw - kx, Math.max(kx - w, v.tx)), ty = Math.min(vh - ky, Math.max(ky - h, v.ty));
  return tx === v.tx && ty === v.ty ? v : { k: v.k, tx, ty };
}

/** clampPan for content whose display-space bounds are an arbitrary box (rotated images). */
export function clampPanBox(v: Viewport, box: { x0: number; y0: number; x1: number; y1: number }, vw: number, vh: number, keep = PAN_KEEP): Viewport {
  const x0 = v.k * box.x0, x1 = v.k * box.x1, y0 = v.k * box.y0, y1 = v.k * box.y1;
  const kx = Math.min(keep, x1 - x0), ky = Math.min(keep, y1 - y0);
  const tx = Math.min(vw - kx - x0, Math.max(kx - x1, v.tx)), ty = Math.min(vh - ky - y0, Math.max(ky - y1, v.ty));
  return tx === v.tx && ty === v.ty ? v : { k: v.k, tx, ty };
}

/** A resized stage keeps the zoom and the image point at its centre (resizing no longer refits). */
export const keepCentre = (v: Viewport, from: { w: number; h: number }, to: { w: number; h: number }): Viewport =>
  ({ k: v.k, tx: v.tx + (to.w - from.w) / 2, ty: v.ty + (to.h - from.h) / 2 });
