import { describe, it, expect } from 'vitest';
import { filmFilter, filterOf } from './display';

describe('display-only enhancement', () => {
  it('no change → no filter; otherwise brightness, contrast, invert in that order', () => {
    expect(filterOf({ brightness: 1, contrast: 1, invert: false, sharpness: 0 })).toBe('none');
    expect(filterOf({ brightness: 1.2, contrast: 0.8, invert: true, sharpness: 0 })).toBe('brightness(1.2) contrast(0.8) invert(1)');
  });
});

describe('filmFilter: applied as a CSS filter on the film canvas (WebKit ignores the 2D-context filter)', () => {
  it('filters the radiograph, never the white mm-grid paper', () => {
    const d = { brightness: 1.3, contrast: 1, invert: true, sharpness: 0 };
    expect(filmFilter(d, 'radiograph')).toBe('brightness(1.3) invert(1)');
    expect(filmFilter(d, 'grid')).toBe('none');
  });
});
