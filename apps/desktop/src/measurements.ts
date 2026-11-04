import type { AnalysisDef, Compiled, Unit, Value } from '@ceph/geometry';
import { byId, LANDMARKS, neededLandmarks, normAnalysisOf, UNCONFIRMED_POINTS, type LandmarkId } from '@ceph/analyses';
import type { ModelPointRow, ModelPoints, PointStatus } from './ipc';
import { fmtValue, type Decimals } from './format';
import type { Scale } from './tracing/spacing';
import type { TracingPoint } from './tracing/state';
// `neededLandmarks` lives in @ceph/analyses (Task 7) so "Not placed" and analysis coverage share one walk.

export interface MeasurementRow {
  analysis: string;
  /** The analysis id (`AnalysisDef.id`), not just its display name — the norm resolver's query needs it (Task 5). */
  analysisId: string;
  /** Owner B3 (17 Oct 2026): the built-in analysis whose own norm this row uses — `analysisId` for a built-in; for a
   *  "My analysis" row, its item's original analysis ('' = none). Every `queryFor` call takes this, never `analysisId`. */
  normAnalysisId: string;
  node: string; label: string;
  /** The measurement's unit: the computed value's own when there is one, else the catalogue's (Task 5, N5 — a
   *  hidden or not-yet-computable mm row still needs to know it is mm, to show "calibrate to show" and to stay
   *  uncoloured). */
  unit: Unit;
  value: string | null;
  /** The raw number behind `value` (unformatted), for the norm resolver's z-score; null exactly when `value` is. */
  num: number | null;
  /** N5: an mm value on a film not yet ruler-calibrated is not shown ("calibrate to show" instead). */
  hidden: boolean;
  needs: string[];
  /** Set when every landmark is present but the geometry is undefined (e.g. two points on top of each other). */
  undefinedReason: string | null;
}
// Owner DEC-1 (Task 4 fix round 2): the one shared formatter, at the operator's decimals setting (display only).
const fmt = (v: Value, d: Decimals): string => (v.t !== 'scalar' ? '' : fmtValue(v.v, v.unit, d));

/** `scale` is the open film's own scale (Task 5, N5): omitted (e.g. the Change table's own path, which uses
 *  `hideUncalibrated` instead) or `source: 'calibration'` never hides a value; `source: 'assumed'` hides every mm
 *  value (the cell reads "calibrate to show"), leaving angles, %, and ratios untouched. */
export function measurementRows(defs: AnalysisDef[], g: Compiled, values: Record<string, Value | null>, present: ReadonlySet<string>, decimals: Decimals, scale?: Scale): MeasurementRow[] {
  return defs.flatMap((d) => d.measurements.map((m) => {
    const v = values[m.node], needs = v ? [] : [...g.requiredLandmarks(m.node)].filter((l) => !present.has(l)).sort();
    const unit: Unit = v && v.t === 'scalar' ? v.unit : byId(m.node).unit;
    const hidden = !!v && unit === 'mm' && scale?.source === 'assumed';
    return { analysis: d.name, analysisId: d.id, normAnalysisId: normAnalysisOf(d, m.node), node: m.node, label: m.label, unit,
      value: v && !hidden ? fmt(v, decimals) : null,
      num: v && !hidden && v.t === 'scalar' ? v.v : null,
      hidden, needs,
      undefinedReason: !v && needs.length === 0 ? 'Undefined: points coincide' : null };
  }));
}
/** The Inspector's "Not placed" list (Part A task 9): landmarks that some measurement of `defs`
 *  actually needs (`g.requiredLandmarks`), minus the ones already placed, in `LANDMARKS` order.
 *  A catalogue point no enabled analysis uses (e.g. ULs, Holdaway-only) never appears here — see
 *  `otherLandmarks` for those; a point can still be placed manually via the existing landmark
 *  picker regardless of this list. */
export function unplacedLandmarks(defs: AnalysisDef[], g: Compiled, placed: ReadonlySet<string>): LandmarkId[] {
  const needed = neededLandmarks(defs, g);
  return (Object.keys(LANDMARKS) as LandmarkId[]).filter((k) => needed.has(k) && !placed.has(k));
}
/** Appendix §2: "Needs points no model finds: U1A, L1A. Place them to complete IMPA, FMIA, U1–NA°." The points the
 *  enabled analyses need that no installed model finds and that are not placed on this film, in LANDMARKS order, and
 *  the measurements they would complete (Part D task 7). */
export function missingPoints(defs: AnalysisDef[], g: Compiled, found: ReadonlySet<string>, placed: ReadonlySet<string>): { points: LandmarkId[]; completes: string[] } {
  const needed = neededLandmarks(defs, g);
  const points = (Object.keys(LANDMARKS) as LandmarkId[]).filter((k) => needed.has(k) && !found.has(k) && !placed.has(k));
  const miss = new Set<string>(points);
  const completes = [...new Set(defs.flatMap((d) => d.measurements.filter((m) => [...g.requiredLandmarks(m.node)].some((l) => miss.has(l))).map((m) => m.label)))];
  return { points, completes };
}
export const missingText = (m: { points: string[]; completes: string[] }): string | null =>
  m.points.length ? `Needs points no model finds: ${m.points.join(', ')}. Place them to complete ${m.completes.join(', ')}.` : null;
/** The Inspector's "Other points" list (Part A task 9, fix round 1): every catalogue point that is
 *  neither placed nor in `unplacedLandmarks` — i.e. every unplaced point no enabled analysis of
 *  `defs` needs (e.g. SPogS, Holdaway-only, while only Steiner/Downs/McNamara are enabled). The
 *  brief requires manual placement of any catalogue point to stay possible, so these still need a
 *  clickable entry somewhere; the Inspector shows them collapsed, below "Not placed". Exactly
 *  disjoint from, and in union with, `unplacedLandmarks` over every catalogue point. */
export function otherLandmarks(defs: AnalysisDef[], g: Compiled, placed: ReadonlySet<string>): LandmarkId[] {
  const needed = neededLandmarks(defs, g);
  return (Object.keys(LANDMARKS) as LandmarkId[]).filter((k) => !needed.has(k) && !placed.has(k));
}
/** The Inspector's real React row key. `node` alone is not unique across BUILT_INS — Steiner and
 *  Downs both list #53 (m53_Interincisal) — so the key must carry the analysis too (Task 8 review,
 *  fix round 1). */
export const rowKey = (r: MeasurementRow): string => `${r.analysis}:${r.node}`;

/** Which model placed an AI point (pre-flight P16): the placement record kept when the film was detected
 *  (`useCase`'s `placedBy`, the `source` map of placeFromRuns), else — on a reopened case — the recorded run
 *  (`kase.aiPoints`) whose point for this id sits exactly where the AI put it (`p.ai`). Null when neither says. */
export function placerOf(id: string, p: TracingPoint, placedBy: Record<string, string> | null, runs: ModelPoints[]): string | null {
  if (placedBy?.[id]) return placedBy[id];
  if (!p.ai) return null;
  return runs.find((r) => r.points.some((q) => q.landmarkId === id && q.x === p.ai!.x && q.y === p.ai!.y))?.modelId ?? null;
}
/** That model's score for the point. With no record (placer null), the table order is the fallback: the first row
 *  (main model first) not over the gate — the rule placeFromRuns applies when every model ran. */
export function placerStatus(id: string, placer: string | null, table: ModelPointRow[] | null): PointStatus['kind'] | null {
  const rows = placer ? (table ?? []).filter((r) => r.modelId === placer) : table ?? [];
  for (const r of rows) { const q = r.points.find((x) => x.id === id); if (q && (placer || q.status.kind !== 'tooFar')) return q.status.kind; }
  return null;
}
/** Owner, 7 Oct: a measurement that uses an AI-placed, unverified point that is either not scored on any test set or
 *  whose definition is still to be confirmed on films ("uses unconfirmed AI points: Pt, Cm"). Fail-safe (owner
 *  ruling T9-2): when the placing model's status cannot be determined at all — no row for it in the table (e.g.
 *  the model was removed since placement) or the table itself could not be read — the point is marked too; this
 *  warning never clears itself just because the evidence for clearing it went missing. LANDMARKS order. */
export function unconfirmedAiPoints(node: string, g: Compiled, points: Record<string, TracingPoint>, table: ModelPointRow[] | null, placer: (id: string) => string | null): LandmarkId[] {
  const req = g.requiredLandmarks(node);
  return (Object.keys(LANDMARKS) as LandmarkId[]).filter((id) => {
    const p = points[id];
    if (!(req.has(id) && !!p && p.source === 'ai' && !p.verified)) return false;
    if (UNCONFIRMED_POINTS.has(id)) return true;
    const status = placerStatus(id, placer(id), table);
    return status === null || status === 'notScored';
  });
}
