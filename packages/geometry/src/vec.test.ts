import { describe, it, expect } from 'vitest';
import { angleAt, angleBetween, intersect, lineThrough, project, perpendicularThrough, signedDistance, len, sub } from './vec';

const L = (ax: number, ay: number, bx: number, by: number) => lineThrough({ x: ax, y: ay }, { x: bx, y: by })!;

describe('vec', () => {
  it('the x and y axes intersect at the origin', () => {
    const p = intersect(L(-5, 0, 5, 0), L(0, -3, 0, 7))!;
    expect(p.x).toBeCloseTo(0, 12); expect(p.y).toBeCloseTo(0, 12);
  });
  it('parallel lines do not intersect', () => { expect(intersect(L(0, 0, 1, 1), L(0, 1, 1, 2))).toBeNull(); });
  it('coincident points make no line', () => { expect(lineThrough({ x: 3, y: 4 }, { x: 3, y: 4 })).toBeNull(); });
  it('a right angle is 90°', () => { expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 })).toBeCloseTo(90, 12); });
  it('angleBetween is stable near 0° and 180°', () => {
    expect(angleBetween({ x: 1, y: 0 }, { x: 1, y: 1e-9 })).toBeCloseTo(0, 6);
    expect(angleBetween({ x: 1, y: 0 }, { x: -1, y: 1e-9 })).toBeCloseTo(180, 6);
  });
  it('3-4-5 distances', () => { expect(len(sub({ x: 3, y: 4 }, { x: 0, y: 0 }))).toBe(5); });
  it('projection is the foot of the perpendicular', () => {
    const f = project({ x: 2, y: 5 }, L(0, 0, 10, 0));
    expect(f).toEqual({ x: 2, y: 0 });
    const perp = perpendicularThrough({ x: 2, y: 5 }, L(0, 0, 10, 0));
    expect(angleBetween(perp.d, { x: 1, y: 0 })).toBeCloseTo(90, 12);
  });
  it('signedDistance flips sign with `positive`', () => {
    const l = L(0, 0, 0, 10);                                 // the y axis
    expect(signedDistance({ x: 4, y: 3 }, l, { x: 1, y: 0 })).toBeCloseTo(4, 12);
    expect(signedDistance({ x: 4, y: 3 }, l, { x: -1, y: 0 })).toBeCloseTo(-4, 12);
    expect(signedDistance({ x: 0, y: 3 }, l, { x: 1, y: 0 })).toBe(0);
  });
  // FACING-1: stored landmarks are raw image px (y down); a film may face left or right.
  // "Down" must mean down the film (+y) whichever way the reference line runs.
  it('perpendicularThrough points down the film (+y) for a right-pointing line', () => {
    const perp = perpendicularThrough({ x: 0, y: 0 }, L(0, 0, 10, 0));
    expect(perp.d.y).toBeGreaterThan(0);
  });
  it('perpendicularThrough points down the film (+y) for a left-pointing line (left-facing film)', () => {
    const perp = perpendicularThrough({ x: 0, y: 0 }, L(0, 0, -10, 1));   // FH on a left-facing film: Po right, Or left
    expect(perp.d.y).toBeGreaterThan(0);
    expect(angleBetween(perp.d, { x: -10, y: 1 })).toBeCloseTo(90, 12);
  });
  it('perpendicularThrough of a perfectly vertical line keeps the +90° rotation (documented tie)', () => {
    expect(perpendicularThrough({ x: 0, y: 0 }, L(0, 0, 0, 10)).d).toEqual({ x: -10, y: 0 });
    expect(perpendicularThrough({ x: 0, y: 0 }, L(0, 10, 0, 0)).d).toEqual({ x: 10, y: 0 });
  });
});
