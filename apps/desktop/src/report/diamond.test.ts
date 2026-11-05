import { describe, it, expect, vi } from 'vitest';
import { diamond } from './diamond';

// Ruling I4: jsPDF 4's drawing methods are own properties of each instance, not of jsPDF.prototype, so
// vi.spyOn(jsPDF.prototype, 'triangle') cannot see them. This unit test is the instrument that CAN see the
// diamond's own two triangle() calls, with a fake that only needs the two methods diamond() actually uses.
describe('diamond (N-A5, AUTO-Q10): a filled diamond drawn as two triangles', () => {
  it('fills then draws exactly two triangles meeting at (cx-r, cy) and (cx+r, cy)', () => {
    const doc = { setFillColor: vi.fn(), triangle: vi.fn() };
    diamond(doc, 10, 20, 0.9);
    expect(doc.setFillColor).toHaveBeenCalledWith(20, 20, 20);
    expect(doc.triangle).toHaveBeenCalledTimes(2);
    expect(doc.triangle).toHaveBeenNthCalledWith(1, 9.1, 20, 10, 19.1, 10.9, 20, 'F');
    expect(doc.triangle).toHaveBeenNthCalledWith(2, 9.1, 20, 10, 20.9, 10.9, 20, 'F');
  });
  it('a different centre and radius move every coordinate (positive control: not a fixed shape)', () => {
    const doc = { setFillColor: vi.fn(), triangle: vi.fn() };
    diamond(doc, 0, 0, 2);
    expect(doc.triangle).toHaveBeenNthCalledWith(1, -2, 0, 0, -2, 2, 0, 'F');
    expect(doc.triangle).toHaveBeenNthCalledWith(2, -2, 0, 0, 2, 2, 0, 'F');
  });
});
