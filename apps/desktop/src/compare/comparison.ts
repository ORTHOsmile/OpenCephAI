import type { AnalysisDef, Compiled, NodeId, Value, Vec2 } from '@ceph/geometry';
import type { CaseDoc, FilmFit, FitRefKind, SeriesFilm, Stage } from '../ipc';
import type { DateFormat } from '../dates';
import { baseScale, fitMark, type Scale } from '../tracing/spacing';
import type { CompareTracing, Look } from '../canvas/Overlay';
import type { KeyLine } from '../layout/SeriesKey';
import { alignOnSN, type Pts } from './align';
import { apply, fittedScale, poseOf, toOpen, type Placed, type Pose } from './fit';
import { fitBlock } from './fitDraft';
import { adviceFor } from './advice';
import { autoStage, filmLabel, hideUncalibrated, looks, pairLabels, pickPair, seriesRows, stageOf, usable, type SeriesRow } from './series';

export interface ComparisonInput {
  open: CaseDoc; openPoints: Record<string, Vec2>; openValues: Record<NodeId, Value | null>; openScale: Scale;
  films: SeriesFilm[]; docs: Record<string, CaseDoc>; failed: Set<string>;
  compiled: Compiled; defs: AnalysisDef[]; dateFormat: DateFormat; pairChoice: { from: string; to: string } | null;
  /** Request G panel (Task 7): the fit being adjusted on the open film (its reference), drawn and tabulated live in place
   *  of that film's saved fit; null when no panel is open. */
  draft?: DraftFit | null;
}
/** The placement in the fit panel, before it is saved. */
export interface DraftFit { film: string; pose: Pose; kind: FitRefKind }
export interface ComparisonChange { heads: string[]; ids: string[]; rows: SeriesRow[]; pair: { from: string; to: string };
  labels: Record<string, string>; note: string | null;
  /** Request G (owner G2, G3): one per column — the fit mark, 'assumed scale' (a reference with no ruler that a ticked
   *  film takes its scale from, plan D-b), or null; `fitted`: whether the column's mm come from a fit (the columns whose
   *  mm carry a †; fix round 2: † means exactly "scaled by a fit", so an assumed-scale reference carries none); and one
   *  note per fitted column, naming the film ("T2 scaled to T1 on S–N (×1.042)"). */
  marks: (string | null)[]; fitted: boolean[]; fitNotes: string[] }
export interface Comparison { tracings: CompareTracing[]; own: Look | null; lines: KeyLine[]; change: ComparisonChange | null; hint: string | null }

/** `base` with each mm value taken from `fitted` (the same points at the fitted scale); every other value kept. */
const mmFrom = (base: Record<NodeId, Value | null>, fitted: Record<NodeId, Value | null>): Record<NodeId, Value | null> =>
  Object.fromEntries(Object.entries(base).map(([k, v]) => { const w = fitted[k]; return [k, w?.t === 'scalar' && w.unit === 'mm' ? w : v]; }));
/** Owner G2 (Task 10): a film's own page with "Use the scale from the fit" on — its own-scale values with only the mm
 *  taken from the fit (`mmFrom`, as the Change table's fitted column), so its angles and ratios stay bit-identical to
 *  the switch-off values. Any other scale: the own values, the same object. */
export const fittedValues = (own: Record<NodeId, Value | null>, compiled: Compiled, points: Record<string, Vec2>, scale: Scale): Record<NodeId, Value | null> =>
  (scale.source === 'fit' ? mmFrom(own, compiled.evaluate(points, scale.mmPerPx)) : own);
const pointsOf = (o: CaseDoc) => Object.fromEntries(o.landmarks.map((l) => [l.id, { x: l.x, y: l.y }])) as Record<string, Vec2>;

/** Serial superimposition (spec 2026-09-30 Part 3): the other ticked films aligned on S–N at S onto the open film, the
 *  comparison key's lines and the Change table. Moved here from App.tsx unchanged (plan 2026-10-18 Task 2) so request
 *  G adds its fits in one tested place; e2e15 B0 proves the screen still equals main's. */
export function buildComparison(x: ComparisonInput): Comparison {
  const d = x.open, mine = x.openPoints;
  const ticked = usable(x.films, d.id, x.failed);
  const stages = ticked.map((f, i) => stageOf(f as { stage: Stage | null }, i, ticked.length));
  const look = looks(stages);
  const own = look[ticked.findIndex((f) => f.id === d.id)] ?? null;
  const tracings: CompareTracing[] = [];
  const cols: Record<string, Value | null>[] = [];
  // N5: which ticked films (same order as `cols`) are not ruler-calibrated — `hideUncalibrated` hides their mm values in
  // the Change table, so a change in mm is never worked out from an assumed-scale film.
  const uncalibrated: boolean[] = [];
  const marks: (string | null)[] = [], fitted: boolean[] = [];
  // Request G: a film's fit, if it still applies and its reference is here to place it on.
  // The panel's draft (Task 7) wins over the saved fit; only `a`, `b` and the pose are read from a fit here (poseOf).
  const fitOf = (o: CaseDoc): FilmFit | null => {
    if (x.draft && o.id === x.draft.film) { const p = x.draft.pose;
      return { refCaseId: d.id, refKind: x.draft.kind, refPoints: [[p.a.x, p.a.y], [p.a.x, p.a.y]], filmPoints: [[p.b.x, p.b.y], [p.b.x, p.b.y]],
        mirror: p.mirror, scale: p.scale, rotation: p.rotation, dx: p.dx, dy: p.dy, useOwn: false, refTimepoint: d.timepoint,
        refSpacingMm: d.spacingMm, savedBy: '', savedAt: '' }; }
    const f = o.fit ?? null; return f && (f.refCaseId === d.id || x.docs[f.refCaseId]) ? f : null; };
  const refOf = (f: FilmFit) => (f.refCaseId === d.id ? d : x.docs[f.refCaseId]);
  // Owner G2: a ruler wins; else a usable fit gives `reference mm/px × size`; else the film's own (assumed) scale.
  const scaleFor = (o: CaseDoc): Scale => { const f = fitOf(o); return f ? fittedScale(baseScale(o), f, baseScale(refOf(f)), f.refTimepoint) : baseScale(o); };
  const placed = (o: CaseDoc, points: Pts): Placed => { const f = fitOf(o);
    return { id: o.id, points, facing: o.facing, own: baseScale(o), fit: f ? { refId: f.refCaseId, pose: poseOf(f) } : null }; };
  const openPlaced = placed(d, mine);
  const byId = (id: string) => (id === d.id ? openPlaced : x.docs[id] ? placed(x.docs[id], pointsOf(x.docs[id])) : null);
  // G3 (plan D-b): a film with no ruler that a ticked film TAKES ITS SCALE from shows its mm, marked "assumed scale" —
  // both are then on one common assumed scale. Fix round 1 (I-1): a fit that only places a ruler film (D-a) does not
  // count, or the Change table would show a ruler-mm minus assumed-mm difference, the one N5 hides.
  const refsOfTicked = new Set(ticked.map((f) => (f.id === d.id ? d : x.docs[f.id])).filter((o): o is CaseDoc => !!o)
    .filter((o) => scaleFor(o).source === 'fit').map(fitOf).filter((f): f is FilmFit => !!f).map((f) => f.refCaseId));
  let assumed = false;
  ticked.forEach((f, i) => {
    const o = f.id === d.id ? d : x.docs[f.id];
    if (!o) { cols.push({}); uncalibrated.push(true); marks.push(null); fitted.push(false); return; }
    const sc = f.id === d.id && !fitOf(d) ? x.openScale : scaleFor(o);
    const shownAssumed = sc.source === 'assumed' && refsOfTicked.has(o.id), hide = sc.source === 'assumed' && !shownAssumed;
    const pos = f.id === d.id ? mine : pointsOf(o);
    // N5: the open film's values are App's own; every other film is evaluated here at its own scale. A fit (owner G2)
    // replaces only the mm values: angles and ratios stay those of the film's own scale, bit for bit —
    // (a·k)/(b·k) can differ from a/b in the last bit, so a ratio is never recomputed at the fitted scale).
    const base = f.id === d.id ? x.openValues : x.compiled.evaluate(pos, baseScale(o).mmPerPx);
    cols.push(sc.source === 'fit' ? mmFrom(base, x.compiled.evaluate(pos, sc.mmPerPx)) : base);
    uncalibrated.push(hide); assumed ||= hide;
    marks.push(sc.source === 'fit' ? fitMark(sc.fit) : shownAssumed ? 'assumed scale' : null); fitted.push(sc.source === 'fit');
    if (f.id === d.id) return;
    if (!openPlaced.fit && !fitOf(o)) {          // no fit on either side: today's S–N alignment, unchanged (B0)
      const al = alignOnSN(mine, pos, baseScale(o).mmPerPx / x.openScale.mmPerPx, o.facing !== d.facing);
      if (al) tracings.push({ id: f.id, points: Object.fromEntries(Object.entries(pos).map(([k, p]) => [k, al(p)])), ...look[i] });
      return;
    }
    const s = toOpen(placed(o, pos), openPlaced, byId);
    if (s) tracings.push({ id: f.id, points: Object.fromEntries(Object.entries(pos).map(([k, p]) => [k, apply(s, p)])), ...look[i] });
  });
  const label = (f: SeriesFilm) => filmLabel(f, x.dateFormat);
  const ids = ticked.map((f) => f.id), pair = pickPair(ids, x.pairChoice);
  const hint = d.patientKey.startsWith('~') ? 'Name the patient to compare their films' : null;
  const lines: KeyLine[] = x.films.map((f) => { const i = ticked.indexOf(f), o = x.docs[f.id];
    const hasSN = f.id === d.id ? !!(mine.S && mine.N) : !!o && ['S', 'N'].every((k) => o.landmarks.some((l) => l.id === k));
    // Request G: what this film's fit does — its mark, or, for a ruler-calibrated film (D-a), that the fit only places it.
    const fo = f.id === d.id ? fitOf(d) : o ? fitOf(o) : null, fs = fo ? scaleFor(f.id === d.id ? d : o!) : null;
    return { id: f.id, label: label(f) + (f.nameOnly ? ' (no DOB)' : ''), ticked: i >= 0, open: f.id === d.id, stage: f.stage as Stage | null,
      auto: i >= 0 ? autoStage(i, ticked.length) : null, look: i >= 0 ? look[i] : null,
      note: x.failed.has(f.id) ? 'Couldn’t open this film' : i >= 0 && (f.id === d.id || o) && !hasSN ? 'Place S and N to draw it' : null,
      fit: !fo ? null : fs?.source === 'fit' ? fitMark(fs.fit).replace(/^s/, 'S') : `Placed on ${fo.refTimepoint} by hand; its ruler gives its size`,
      // Request G (Task 7): "Adjust fit…" on a ticked film of a named patient that may be fitted (plan D-d).
      canFit: i >= 0 && !hint && fitBlock(x.films, f.id, false) === null,
      // Owner G1 (Task 9): "This film is not scaled" advice, only on ticked films.
      advice: i < 0 ? null : (() => { const doc = f.id === d.id ? d : o;
        return doc ? adviceFor({ id: doc.id, timepoint: doc.timepoint, spacingMm: doc.spacingMm, fitted: !!fitOf(doc), machineScale: doc.machineScale }, x.films, !!hint) : null; })() }; });
  // P13 (Task 6 of Part D): the chosen analyses, not a fixed BUILT_INS.
  const change = pair ? { heads: ticked.map(label), ids, rows: hideUncalibrated(seriesRows(x.defs, cols), uncalibrated), pair,
    labels: pairLabels(ticked, x.dateFormat),
    note: assumed ? 'mm on a film not yet calibrated are hidden: calibrate each film from its ruler (K). Angles are unaffected.' : null,
    // Owner, 19 Oct + fix round 2: the note under the table reads "† T2 scaled to T1 on S–N (×1.042)", one line per fitted film.
    marks, fitted, fitNotes: ticked.flatMap((f, i) => (fitted[i] ? [`${f.timepoint} ${marks[i]}`] : [])) } : null;
  return { tracings, own, lines, change, hint };
}
