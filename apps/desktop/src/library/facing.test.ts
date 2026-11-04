import { describe, it, expect } from 'vitest';
import { facingUnsure } from './facing';
import { detection } from './fixtures';

describe('automatic facing (decision 14)', () => {
  it('is sure when one pass peaks far higher (as measured on a real film: 12.6 vs 4.9)', () => {
    expect(facingUnsure({ ...detection(true), meanPeakRight: 4.9, meanPeakLeft: 12.6 })).toBe(false);
  });
  it('asks only when the two passes are within 10% of each other', () => {
    expect(facingUnsure({ ...detection(true), meanPeakRight: 11.8, meanPeakLeft: 12.6 })).toBe(true);    // 6% apart
    expect(facingUnsure({ ...detection(false), meanPeakRight: 3, meanPeakLeft: 3 })).toBe(true);
  });
  it('never asks when only one facing was run', () => {
    expect(facingUnsure({ ...detection(true), meanPeakRight: null, meanPeakLeft: 5 })).toBe(false);
  });
});
