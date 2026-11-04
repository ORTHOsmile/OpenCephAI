import { describe, it, expect } from 'vitest';
import { canvasMatrix, displayOf, fitOriented, imageOf, invLinear, levelRotation, toImage, toScreen, NO_ORIENTATION, type Orientation } from './orientation';
import { zoomAt } from './viewport';

const dims = { W: 1935, H: 2400 };
const pts = [{ x: 0, y: 0 }, { x: 1934, y: 2399 }, { x: 812.25, y: 1203.5 }, { x: 17, y: 2200 }];
const all: Orientation[] = [];
for (const mirror of [false, true]) for (let r = -25; r <= 25; r += 2.5) all.push({ mirror, rotDeg: r, source: 'manual' });

describe('orientation D', () => {
  it('D⁻¹(D(p)) = p for every mirror and θ in −25…25°', () => {
    for (const o of all) for (const p of pts) {
      const q = imageOf(o, dims, displayOf(o, dims, p));
      expect(q.x).toBeCloseTo(p.x, 9); expect(q.y).toBeCloseTo(p.y, 9);
    }
  });
  it('identity leaves points alone', () => { expect(displayOf(NO_ORIENTATION, dims, pts[2])).toEqual(pts[2]); });
  it('levelling makes Po→Or horizontal and pointing the face direction', () => {
    const Po = { x: 300, y: 1100 }, Or = { x: 1500, y: 1010 };
    for (const mirror of [false, true]) {
      const o: Orientation = { mirror, rotDeg: levelRotation(Po, Or, mirror), source: 'auto-FH' };
      const a = displayOf(o, dims, Po), b = displayOf(o, dims, Or);
      expect(b.y - a.y).toBeCloseTo(0, 9);
      expect(b.x > a.x).toBe(!mirror);
    }
  });
  it('levelling a left-facing film keeps it upright (smallest rotation), mirrored or not', () => {
    const Po = { x: 1500, y: 1100 }, Or = { x: 300, y: 1010 };             // SYNTHETIC face-left film
    for (const mirror of [false, true]) {
      const r = levelRotation(Po, Or, mirror);
      expect(Math.abs(r)).toBeLessThan(90);
      const o: Orientation = { mirror, rotDeg: r, source: 'auto-FH' };
      const a = displayOf(o, dims, Po), b = displayOf(o, dims, Or);
      expect(b.y - a.y).toBeCloseTo(0, 9);
      expect(b.x > a.x).toBe(mirror);                                       // flipping a face-left film makes it face right
    }
  });
  it('toImage inverts toScreen through zoom and pan', () => {
    for (const o of all) {
      const v = zoomAt(fitOriented(o, dims, 1000, 800), { x: 321, y: 123 }, 2.7);
      for (const p of pts) { const q = toImage(v, o, dims, toScreen(v, o, dims, p)); expect(q.x).toBeCloseTo(p.x, 7); expect(q.y).toBeCloseTo(p.y, 7); }
    }
  });
  it('zoom and pan never change the orientation', () => {
    const o: Orientation = { mirror: true, rotDeg: -3.4, source: 'auto-FH' };
    const before = JSON.stringify(o); zoomAt(fitOriented(o, dims, 1000, 800), { x: 5, y: 5 }, 3); expect(JSON.stringify(o)).toBe(before);
  });
  it('the canvas matrix draws each image pixel where toScreen says', () => {
    const o: Orientation = { mirror: true, rotDeg: 7, source: 'manual' }, v = fitOriented(o, dims, 1000, 800), dpr = 2;
    const [a, b, c, d, e, f] = canvasMatrix(v, o, dims, dpr);
    for (const p of pts) { const s = toScreen(v, o, dims, p);
      expect(a * p.x + c * p.y + e).toBeCloseTo(s.x * dpr, 7); expect(b * p.x + d * p.y + f).toBeCloseTo(s.y * dpr, 7); }
  });
  it('fitOriented keeps the rotated image inside the view', () => {
    const o: Orientation = { mirror: false, rotDeg: 25, source: 'manual' }, v = fitOriented(o, dims, 1000, 800);
    for (const p of [{ x: -0.5, y: -0.5 }, { x: 1934.5, y: -0.5 }, { x: -0.5, y: 2399.5 }, { x: 1934.5, y: 2399.5 }]) {
      const s = toScreen(v, o, dims, p);
      expect(s.x).toBeGreaterThanOrEqual(-1e-6); expect(s.x).toBeLessThanOrEqual(1000 + 1e-6);
      expect(s.y).toBeGreaterThanOrEqual(-1e-6); expect(s.y).toBeLessThanOrEqual(800 + 1e-6);
    }
  });
  it('invLinear maps a screen direction back to an image direction', () => {
    const d = invLinear({ mirror: true, rotDeg: 0, source: 'manual' }, { x: 1, y: 0 });
    expect(d.x).toBeCloseTo(-1, 12); expect(d.y).toBeCloseTo(0, 12);
  });
});
