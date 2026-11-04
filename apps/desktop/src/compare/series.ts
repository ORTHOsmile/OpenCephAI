import type { AnalysisDef, Unit, Value } from '@ceph/geometry';
import type { SeriesFilm, Stage } from '../ipc';
import { formatDate, type DateFormat } from '../dates';

export type Orderable = { timepoint?: string; takenOn: string | null; takenOnSource?: string | null; createdAt: string };
/** A film date that says when the film was taken: an import day (given when none was read) doesn't. */
const realDate = (x: Orderable) => (x.takenOnSource === 'import' ? null : x.takenOn);
const tpNumber = (tp?: string) => { const m = /^T(\d+)$/i.exec(tp?.trim() ?? ''); return m ? +m[1] : null; };
const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** T1 … Tn oldest first (spec 2026-09-30): film dates when every film has a real one, else T-numbers (named timepoints
 *  after), then import time. A key per film, so the order never depends on how the list came in. */
export function orderSeries<T extends Orderable>(films: T[]): T[] {
  const dated = films.every((x) => realDate(x));
  const key = (x: T): (string | number)[] => { const n = tpNumber(x.timepoint);
    return [dated ? realDate(x)! : '', n === null ? 1 : 0, n ?? 0, x.createdAt]; };
  return [...films].sort((a, b) => { const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) { const c = cmp(ka[i], kb[i]); if (c) return c; } return 0; });
}

export const STAGE_LABEL: Record<Stage, string> = { initial: 'Initial', progress: 'Progress', final: 'Final', retention: 'Retention' };
export const autoStage = (i: number, n: number): Stage => (i === 0 ? 'initial' : i === n - 1 ? 'final' : 'progress');
export const stageOf = (f: { stage: Stage | null }, i: number, n: number): Stage => f.stage ?? autoStage(i, n);
const DASHES = [undefined, '8 5', '2 4'] as const;
/** ABO colour per stage; films sharing a stage are solid, dashed, dotted, and round again. */
export function looks(stages: Stage[]): { colour: string; dash?: string }[] {
  const seen: Partial<Record<Stage, number>> = {};
  return stages.map((s) => { const k = seen[s] ?? 0; seen[s] = k + 1; const dash = DASHES[k % 3];
    return dash ? { colour: `var(--stage-${s})`, dash } : { colour: `var(--stage-${s})` }; });
}

export interface SeriesRow { node: string; label: string; unit: Unit; values: (number | null)[]; hidden?: boolean[] }
/** A value per film for every measurement with a value on at least one film, once, in analysis order. */
export function seriesRows(defs: AnalysisDef[], cols: Record<string, Value | null>[]): SeriesRow[] {
  const seen = new Set<string>(), rows: SeriesRow[] = [];
  for (const m of defs.flatMap((d) => d.measurements)) {
    if (seen.has(m.node)) continue;
    const vs = cols.map((c) => { const v = c[m.node]; return v?.t === 'scalar' ? v : null; });
    const first = vs.find((v) => v);
    if (!first) continue;
    seen.add(m.node);
    rows.push({ node: m.node, label: m.label, unit: first.unit, values: vs.map((v) => v?.v ?? null) });
  }
  return rows;
}
/** N5 in the Change table: an mm value from a film that is not ruler-calibrated is not shown (null, marked hidden),
 *  so no change in mm is worked out from it. Angles and ratios are unaffected. Fix round 1 (review Minor 1): a
 *  film with no value at all for this measurement (missing landmarks, or its doc hadn't loaded) is never marked
 *  `hidden` just because it is also uncalibrated — there was nothing to hide, so it reads "—" like any other
 *  missing value, not "calibrate to show". Matches `measurementRows`'s own `!!v` gate for the same decision. */
export function hideUncalibrated(rows: SeriesRow[], uncalibrated: boolean[]): SeriesRow[] {
  return rows.map((r) => r.unit !== 'mm' ? r : {
    ...r,
    values: r.values.map((v, i) => (uncalibrated[i] ? null : v)),
    hidden: r.values.map((v, i) => v !== null && !!uncalibrated[i]),
  });
}
export const changeOf = (r: SeriesRow, from: number, to: number) => {
  const a = r.values[from], b = r.values[to]; return a === null || b === null || a === undefined || b === undefined ? null : b - a;
};
export const pairs = (ids: string[]) => ids.flatMap((from, i) => ids.slice(i + 1).map((to) => ({ from, to })));
/** The Change pair: the one chosen while both films are still ticked (earlier first), else first → last. */
export function pickPair(ids: string[], chosen: { from: string; to: string } | null) {
  if (ids.length < 2) return null;
  if (chosen) { const i = ids.indexOf(chosen.from), j = ids.indexOf(chosen.to); if (i >= 0 && j > i) return chosen; }
  return { from: ids[0], to: ids[ids.length - 1] };
}

/** The films drawn and tabulated: ticked (the open film always), minus any that couldn't be opened (owner, 30 Sep). */
export const usable = <T extends Pick<SeriesFilm, 'id' | 'inSeries'>>(films: T[], openId: string, failed: Set<string>) =>
  films.filter((f) => f.id === openId || (f.inSeries && !failed.has(f.id)));
/** "T2 · 12/09/2026"; a film dated only by the day it was imported says so, so the real date gets typed in (owner, 30 Sep). */
export const filmLabel = (f: Pick<SeriesFilm, 'timepoint' | 'takenOn' | 'takenOnSource'> & { createdAt?: string }, fmt: DateFormat) =>
  `${f.timepoint} · ${f.takenOnSource === 'import' ? 'imported ' : ''}${formatDate(f.takenOn ?? f.createdAt?.slice(0, 10) ?? null, fmt)}`;
/** Names in the Change drop-down: the timepoint, or the full label when a timepoint repeats among the films. */
export function pairLabels(films: (Pick<SeriesFilm, 'id' | 'timepoint' | 'takenOn' | 'takenOnSource'> & { createdAt?: string })[], fmt: DateFormat): Record<string, string> {
  const n = (tp: string) => films.filter((f) => f.timepoint === tp).length;
  return Object.fromEntries(films.map((f) => [f.id, n(f.timepoint) > 1 ? filmLabel(f, fmt) : f.timepoint]));
}
/** Soft tissue is always patterned; each repeat of a stage gets a pattern of its own there too (owner, 30 Sep). */
export const softDash = (dash?: string) => (dash === '8 5' ? '12 4 2 4' : dash === '2 4' ? '1 3' : '4 2.5');
