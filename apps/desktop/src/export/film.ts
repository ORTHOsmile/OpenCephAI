import type { AnalysisDef, Compiled, Vec2 } from '@ceph/geometry';
import { resolveNorm, type NormPicks } from '@ceph/analyses';
import type { CaseDoc } from '../ipc';
import type { Decimals } from '../format';
import { measurementRows, type MeasurementRow } from '../measurements';
import { normCell, queryFor, type NormCell, type NormContext } from '../norms/normCell';
import type { Scale } from '../tracing/spacing';
import { ownPages } from '../compare/fit';
import { fittedValues } from '../compare/comparison';

/** A film's saved points, by landmark id. */
export const docPoints = (doc: CaseDoc): Record<string, Vec2> => Object.fromEntries(doc.landmarks.map((l) => [l.id, { x: l.x, y: l.y }]));

/** A film that is not open (Library ▸ Export CSV…), worked out exactly as the screen works out the open one: the
 *  scale its own pages use (`ownPages`: its ruler; else, with "Use the scale from the fit" on, its fit's; else assumed,
 *  mm hidden, N5), the same rows (`fittedValues`: with the switch on only the mm come from the fit, so angles and
 *  ratios are bit-identical to the switch-off values), and the same norm cells with the sources chosen on it.
 *  R3 (final-review.md, part A): `scale` is returned so the report built from these rows says the same scale. */
export function evaluateFilm(doc: CaseDoc, defs: AnalysisDef[], compiled: Compiled, decimals: Decimals, n: NormContext, picks: NormPicks): { rows: MeasurementRow[]; cells: NormCell[]; scale: Scale } {
  const p = ownPages(doc), pos = docPoints(doc), scale = p.scale;
  const own = compiled.evaluate(pos, p.own.mmPerPx);
  const rows = measurementRows(defs, compiled, fittedValues(own, compiled, pos, scale), new Set(Object.keys(pos)), decimals, scale);
  // feat/my-analysis merged: query on r.normAnalysisId, never r.analysisId — a "my:" row's norm must resolve under
  // its item's original built-in analysis (or '' for none), exactly as App.tsx's normFor and norms/compare.ts's
  // compareCells do, not under the "my:" id itself, which is not a real analysis the resolver knows.
  const cells = rows.map((r) => { const q = queryFor(r.node, r.normAnalysisId, doc, n, picks); return normCell(r.num, resolveNorm(q), q, decimals); });
  return { rows, cells, scale };
}
