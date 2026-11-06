import { isAssumed } from '../tracing/spacing';
import { figureFit, profilogramShapes, type FigureInput, type Shape } from './shapes';
import { profilogramBox, type Paper } from './page';
import type { ReportOptions } from './model';

/** The shapes of the report's own profilogram page — one place for the preview (ReportPreview.tsx) and the PDF
 *  (useReport.ts), so they cannot disagree. Empty when the "Profilogram page" box is off, there is no figure, or
 *  there is no profile to draw (then no page is added).
 *
 *  Owner, 5 Nov 2026: with "Grid behind the profilogram" on (the default) the screen's true-size mm grid sits behind
 *  the profile. A film with NO scale of its own (assumed, or fitted to a film that has none) gets no grid and no
 *  note: a grid at a guessed scale would print made-up millimetres. */
export function profilogramPageShapes(f: FigureInput | null, paper: Paper, options: ReportOptions): Shape[] {
  if (!options.profilogramPage || !f) return [];
  const grid = options.profilogramGrid && !isAssumed(f.scale) ? { mmPerPx: f.scale.mmPerPx } : null;
  return profilogramShapes(f.points, f.orientation, f.dims, figureFit(f.orientation, f.dims, profilogramBox(paper)), { registry: f.registry, overlays: f.overlays }, grid);
}
