import { describe, it, expect } from 'vitest';
import { checkCalibration, clampPanel } from './calibration';

describe('ruler calibration (§2, decision 17)', () => {
  it('spacing = true distance / pixel distance', () => {
    expect(checkCalibration({ x: 10, y: 10 }, { x: 210, y: 10 }, 20)).toEqual({ ok: true, mmPerPx: 0.1, px: 200, warning: null });
  });
  it('Review focus 5: refuses marks too close together, and zero, negative, empty or non-numeric distances', () => {
    expect(checkCalibration({ x: 0, y: 0 }, { x: 15, y: 0 }, 10)).toEqual({ ok: false, error: expect.stringMatching(/15\.0 px apart/) });
    for (const mm of [0, -5, NaN, Infinity]) expect(checkCalibration({ x: 0, y: 0 }, { x: 300, y: 0 }, mm).ok).toBe(false);
  });
  it('warns when the marks are close in millimetres', () => {
    expect(checkCalibration({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)).toMatchObject({ ok: true, warning: expect.stringMatching(/1\.0%/) });
  });
});

describe('the calibration panel can be dragged off the ruler, but never off screen', () => {
  it('keeps the whole panel inside the window', () => {
    const size = { w: 340, h: 200 }, win = { w: 1440, h: 900 };
    expect(clampPanel({ x: 500, y: 300 }, size, win)).toEqual({ x: 500, y: 300 });
    expect(clampPanel({ x: -50, y: -20 }, size, win)).toEqual({ x: 8, y: 8 });
    expect(clampPanel({ x: 1400, y: 880 }, size, win)).toEqual({ x: 1440 - 340 - 8, y: 900 - 200 - 8 });
  });
});
