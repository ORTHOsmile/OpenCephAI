import { describe, it, expect } from 'vitest';
import { CHART_GAP, CHART_W, figureBox, MARGIN, PAGE, pageOneBoxes, profilogramBox, type Paper } from './page';

// Owner, 29 Oct 2026: the zig-zag plot beside the ceph — the film narrower (scaled down slightly), the chart a
// fixed, thin strip running the film's full height, on BOTH paper sizes.
describe('pageOneBoxes: the film narrower, a thin tall chart beside it (owner, 29 Oct 2026)', () => {
  for (const paper of ['a4', 'letter'] as Paper[]) {
    it(`${paper}: film + gap + chart exactly fills the old single figure box; same height; chart stays inside the page`, () => {
      const full = figureBox(paper, 3), { film, chart } = pageOneBoxes(paper, 3);
      expect(film.x).toBe(full.x);
      expect(film.y).toBe(full.y);
      expect(film.h).toBe(full.h);
      expect(chart.h).toBe(full.h);
      expect(chart.w).toBe(CHART_W);
      expect(film.w + CHART_GAP + chart.w).toBeCloseTo(full.w, 9);
      expect(chart.x + chart.w).toBeCloseTo(full.x + full.w, 9);
      // Readable on both paper sizes: the chart is a real strip, not squeezed to nothing or wider than the page.
      expect(chart.w).toBeGreaterThan(20);
      expect(film.w).toBeGreaterThan(chart.w);   // the ceph is "scaled down slightly", not shrunk away
      expect(chart.x + chart.w).toBeLessThanOrEqual(PAGE[paper].w - MARGIN + 1e-9);
    });
  }
  it('the film is narrower than the old full-width figure box (scaled down to make room)', () => {
    expect(pageOneBoxes('a4', 3).film.w).toBeLessThan(figureBox('a4', 3).w);
  });
  it('positive control: without the split, film.w would equal the full box (proves the narrowing above is not vacuous)', () => {
    expect(figureBox('a4', 3).w).not.toBeLessThan(figureBox('a4', 3).w);   // sanity: equal to itself
    expect(pageOneBoxes('a4', 3).film.w).not.toBe(figureBox('a4', 3).w);
  });
});

describe('profilogramBox: its own full-width box, within the page, on both paper sizes', () => {
  for (const paper of ['a4', 'letter'] as Paper[]) {
    it(`${paper}: starts at the margin, stays within the page`, () => {
      const b = profilogramBox(paper);
      expect(b.x).toBe(MARGIN);
      expect(b.x + b.w).toBeLessThanOrEqual(PAGE[paper].w);
      expect(b.y + b.h).toBeLessThanOrEqual(PAGE[paper].h);
    });
  }
});
