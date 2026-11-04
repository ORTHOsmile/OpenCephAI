import { describe, it, expect } from 'vitest';
import { fit, zoomAt, screenToImage, imageToScreen, clampPan, clampPanBox, keepCentre } from './viewport';
describe('viewport', () => {
  it('fit centres the image', () => {
    const v = fit(1935, 2400, 1000, 800);
    expect(v.k).toBeCloseTo(0.95 * 800 / 2400);
    const c = imageToScreen(v, { x: 1935 / 2, y: 1200 });
    expect(c.x).toBeCloseTo(500, 9); expect(c.y).toBeCloseTo(400, 9);
  });
  it('zoomAt keeps the point under the cursor fixed', () => {
    const v = fit(1935, 2400, 1000, 800), c = { x: 321, y: 123 };
    const before = screenToImage(v, c), after = screenToImage(zoomAt(v, c, 3.7), c);
    expect(after.x).toBeCloseTo(before.x, 9); expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe('clampPan', () => {
  const W = 1935, H = 2400, vw = 1000, vh = 800;
  it('keeps at least 80 px of the image inside the view on each axis', () => {
    const v = fit(W, H, vw, vh);
    const far = clampPan({ ...v, tx: 1e6, ty: -1e6 }, W, H, vw, vh);
    expect(far.tx).toBeCloseTo(vw - 80, 9);                     // image's left edge no further right than vw − 80
    expect(far.ty + far.k * H).toBeCloseTo(80, 9);              // image's bottom edge no higher than 80
  });
  it('leaves an ordinary pan alone', () => {
    const v = fit(W, H, vw, vh), moved = { ...v, tx: v.tx + 50, ty: v.ty - 30 };
    expect(clampPan(moved, W, H, vw, vh)).toEqual(moved);
  });
});
describe('clampPanBox', () => {
  it('keeps 80 px of an offset (rotated) content box in view', () => {
    const v = clampPanBox({ k: 1, tx: 5000, ty: 0 }, { x0: -100, y0: -50, x1: 900, y1: 700 }, 1000, 800);
    expect(v.k * -100 + v.tx).toBeCloseTo(1000 - 80, 9);
  });
  it('keepCentre: a resized stage keeps the zoom and the image point at its centre (Week 2 carry-over)', () => {
    const v = { k: 2.5, tx: -300, ty: 40 }, from = { w: 800, h: 600 }, to = { w: 1100, h: 500 };
    const n = keepCentre(v, from, to);
    expect(n.k).toBe(2.5);
    const a = screenToImage(v, { x: from.w / 2, y: from.h / 2 }), b = screenToImage(n, { x: to.w / 2, y: to.h / 2 });
    expect(b.x).toBeCloseTo(a.x, 12); expect(b.y).toBeCloseTo(a.y, 12);
  });
});
