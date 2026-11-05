import type { Box } from './shapes';

/** Paper sizes in mm and the page-1 figure's place below the header (shared by the preview and the PDF, without
 *  pulling jsPDF into the screen). */
export type Paper = 'a4' | 'letter';
export const PAGE: Record<Paper, { w: number; h: number }> = { a4: { w: 210, h: 297 }, letter: { w: 215.9, h: 279.4 } };
export const MARGIN = 15;
export const HEADER_TOP = MARGIN + 14, HEADER_STEP = 5, FOOTER_SPACE = 22;
export function figureBox(paper: Paper, headerCount: number): Box {
  const P = PAGE[paper], y = HEADER_TOP + headerCount * HEADER_STEP + 2;
  return { x: MARGIN, y, w: P.w - 2 * MARGIN, h: P.h - y - FOOTER_SPACE };
}

/** Owner, 29 Oct 2026 (the zig-zag plot beside the ceph): page 1 split into the film (scaled down slightly) and a
 *  thin, tall chart running the film's full height beside it — the app's own right-hand Chart column, in print
 *  colours. `CHART_W` is a fixed width so the chart stays a narrow strip rather than growing with the page (it
 *  must stay readable on both A4 and the slightly narrower Letter). */
export const CHART_GAP = 4, CHART_W = 46;
export function pageOneBoxes(paper: Paper, headerCount: number): { film: Box; chart: Box } {
  const full = figureBox(paper, headerCount);
  return { film: { ...full, w: full.w - CHART_W - CHART_GAP }, chart: { x: full.x + full.w - CHART_W, y: full.y, w: CHART_W, h: full.h } };
}

/** Owner, 29 Oct 2026 (item 1): the profilogram's own page — never drawn over the film — given a heading's worth
 *  of room at the top (the figure box logic, with no header rows to skip). */
export function profilogramBox(paper: Paper): Box {
  const P = PAGE[paper], y = MARGIN + 12;
  return { x: MARGIN, y, w: P.w - 2 * MARGIN, h: P.h - y - FOOTER_SPACE };
}

/** Fix round (ruling, 29 Oct 2026): a plain, full-width page for the rows the page-1 chart could not
 *  fit beside the film even at its minimum readable row height (`shapes.ts` `CHART.minRowH`, `layoutChart`) —
 *  same heading-sized top margin as `profilogramBox`. Every continuation page uses this same box (there is no
 *  header to skip past on page 2+), so `layoutChart` only ever needs ONE "later page" height. */
export function chartContinuationBox(paper: Paper): Box {
  const P = PAGE[paper], y = MARGIN + 12;
  return { x: MARGIN, y, w: P.w - 2 * MARGIN, h: P.h - y - FOOTER_SPACE };
}
