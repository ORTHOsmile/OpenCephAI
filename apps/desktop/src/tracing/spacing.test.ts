import { describe, it, expect } from 'vitest';
import { ASSUMED_MM_PER_PX, scaleLabel, scaleOf } from './spacing';

describe('scale (§2 I → mm, decisions 17 and 21)', () => {
  it('uses the calibration when there is one, else the labelled assumption', () => {
    expect(scaleOf(0.0875)).toEqual({ mmPerPx: 0.0875, source: 'calibration' });
    for (const bad of [null, undefined, 0, -1, NaN, Infinity]) expect(scaleOf(bad)).toEqual({ mmPerPx: ASSUMED_MM_PER_PX, source: 'assumed' });
  });
  it('always says where the scale came from', () => {
    expect(scaleLabel(scaleOf(0.0875))).toBe('0.0875 mm/px (calibrated)');
    expect(scaleLabel(scaleOf(null))).toBe('0.1 mm/px (assumed: calibrate with K)');
  });
});
