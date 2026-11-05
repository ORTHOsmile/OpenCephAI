import { describe, it, expect } from 'vitest';
import { adjustPixels } from './filmPixels';

const px = (...v: number[]) => new Uint8ClampedArray(v);
describe('Enhance on the printed film (as the screen\'s CSS filter: brightness, then contrast, then invert)', () => {
  it('nothing changed: the pixels are untouched', () => {
    const p = px(10, 20, 30, 40); adjustPixels(p, { brightness: 1, contrast: 1, invert: false });
    expect([...p]).toEqual([10, 20, 30, 40]);
  });
  it('brightness and contrast, alpha untouched', () => {
    const p = px(200, 100, 0, 77); adjustPixels(p, { brightness: 1.2, contrast: 1, invert: false });
    expect([...p]).toEqual([240, 120, 0, 77]);
    const q = px(100, 100, 100, 255); adjustPixels(q, { brightness: 1, contrast: 1.5, invert: false });
    expect([...q]).toEqual([86, 86, 86, 255]);
  });
  it('brightness is clamped before contrast (as CSS does): 200 × 2 → 255, then contrast 0.5 → 191', () => {
    const p = px(200, 200, 200, 255); adjustPixels(p, { brightness: 2, contrast: 0.5, invert: false });
    expect([...p]).toEqual([191, 191, 191, 255]);
  });
  it('invert last', () => {
    const p = px(30, 0, 255, 9); adjustPixels(p, { brightness: 1, contrast: 1, invert: true });
    expect([...p]).toEqual([225, 255, 0, 9]);
  });
  it('review Minor 1: invert really is last, not commuted with brightness/contrast — 100 at brightness 2 → 55, not 0', () => {
    // brightness-then-contrast-then-invert: clamp(100*2)=200; contrast 1 is a no-op; invert -> 255-200=55.
    // An invert-FIRST implementation would invert 100 to 155, then brighten to a clamped 255: the two orders disagree.
    const p = px(100, 100, 100, 255); adjustPixels(p, { brightness: 2, contrast: 1, invert: true });
    expect([...p]).toEqual([55, 55, 55, 255]);
  });
});
