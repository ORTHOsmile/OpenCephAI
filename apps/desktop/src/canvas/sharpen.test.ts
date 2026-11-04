import { describe, it, expect } from 'vitest';
import { unsharp } from './sharpen';

// Grey RGBA test images (SYNTHETIC): each pixel [v, v, v, 255].
const grey = (vals: number[]) => new Uint8ClampedArray(vals.flatMap((v) => [v, v, v, 255]));
const g = (px: Uint8ClampedArray) => Array.from({ length: px.length / 4 }, (_, i) => px[i * 4]);

describe('sharpness (unsharp mask, display only)', () => {
  it('does nothing at 0 and leaves a flat area flat', () => {
    const edge = grey([50, 50, 50, 200, 200, 200]);
    expect(g(unsharp(edge, 6, 1, 0))).toEqual([50, 50, 50, 200, 200, 200]);
    expect(g(unsharp(grey(Array(9).fill(120)), 3, 3, 1.5))).toEqual(Array(9).fill(120));
  });
  it('raises the contrast across an edge, clamped to 0–255, and never touches alpha', () => {
    const out = unsharp(grey([50, 50, 50, 200, 200, 200]), 6, 1, 1);
    const v = g(out);
    expect(v[2]).toBeLessThan(50);                                           // dark side gets darker
    expect(v[3]).toBeGreaterThan(200);                                       // bright side gets brighter
    expect(v.every((x) => x >= 0 && x <= 255)).toBe(true);
    expect(Array.from({ length: 6 }, (_, i) => out[i * 4 + 3])).toEqual(Array(6).fill(255));
    expect(g(unsharp(grey([0, 0, 255, 255]), 4, 1, 2))).toEqual([0, 0, 255, 255]);   // already at the limits: clamped
  });
});
