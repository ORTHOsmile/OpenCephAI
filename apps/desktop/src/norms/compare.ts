import { OWN_NORMS_LABEL, populationsOffered, resolveAcross, type NormPicks, type NormSet, type UserNorm } from '@ceph/analyses';
import type { CaseDoc } from '../ipc';
import type { MeasurementRow } from '../measurements';
import { DEFAULT_DECIMALS, type Decimals } from '../format';
import { normCell, queryFor, type NormCell, type NormContext } from './normCell';

/** The case's "Reference population" picker (case header, ruling P26): the clinic default first, saying
 *  what it actually is (its own label, or `OWN_NORMS_LABEL` when none is set, N6/Task 10), then every population
 *  `populationsOffered` lists (built-in sets and the clinician's own norm sets alike). `value: ''` means "use the
 *  clinic default" — `CaseDoc.population` stays null until the clinician picks one of their own. */
export function populationOptions(sets: NormSet[], userNorms: UserNorm[], clinicDefault: string | null): { value: string; label: string }[] {
  const offered = populationsOffered(sets, userNorms);
  const def = clinicDefault ? offered.find((p) => p.id === clinicDefault)?.label ?? clinicDefault : OWN_NORMS_LABEL;   // P15
  return [{ value: '', label: `Clinic default (${def})` }, ...offered.map((p) => ({ value: p.id, label: p.label }))];
}

export const COMPARE_KEY = 'compare_populations';

/** The stored "compare populations" tick-list: offered populations only (one the clinician has since deleted
 *  drops silently rather than showing a dead tick-box — fix round 1, M4: this is a per-Mac setting, not per
 *  case, so "belongs to another case" never applies here; T11-4 is the case's own *population*, a different
 *  field, handled separately in `queryFor`/`CasePanel`), kept in the order stored, at most 4 (master plan §9:
 *  2–4 side by side). A broken or non-array value reads as no ticks, not an error — the dialog's own "Tick 2 to
 *  4 populations to compare." then takes over, the same empty state as never having ticked anything. */
export function parseCompare(json: string | null, offered: string[]): string[] {
  let v: unknown = null;
  try { v = json ? JSON.parse(json) : null; } catch { v = null; }
  return (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && offered.includes(x)).slice(0, 4);
}

/** The patient's value against 2–4 populations side by side (master plan §9): one resolver result per population,
 *  through the same `NormCell` the Inspector's Measurements tab uses — a hidden mm value (N5) stays hidden and
 *  uncoloured here too (`row.num` is already null for it). Every population's own flags/hints (sex-averaged, age
 *  not entered, website, ideal-uncoloured, …) are present on each returned `NormCell`, never pooled across the
 *  row — fix round 1, ruling T11-1: this function only computes them (it always has); it is
 *  `ComparePopulations.tsx` that renders them per cell, visibly, which this comment wrongly implied before the
 *  fix. `decimals` defaults to the shipped default so the unit test (written against the brief's 4-argument
 *  call) stays exact; the real caller (CasePanel, via App.tsx) passes the operator's own DEC-1 setting. */
export function compareCells(
  rows: MeasurementRow[],
  populations: string[],
  doc: Pick<CaseDoc, 'population' | 'gender' | 'dateOfBirth' | 'takenOn'>,
  n: NormContext,
  decimals: Decimals = DEFAULT_DECIMALS,
  picks: NormPicks = {},
): { row: MeasurementRow; cells: NormCell[] }[] {
  return rows.map((row) => {
    const q = queryFor(row.node, row.normAnalysisId, doc, n, picks);
    // NORM-PICK-1: each cell is described with ITS column's population (the query that column was resolved with), so a
    // "choose one" or "chosen by you" cell names that population, never the case's own.
    return { row, cells: resolveAcross(q, populations).map((r, i) => normCell(row.num, r, { ...q, population: populations[i] }, decimals)) };
  });
}

/** Final review M-10: the stored tick-list, or a sentence when the read fails (never swallowed). */
export async function readCompare(s: { get: (key: string) => Promise<string | null> }, offered: string[]): Promise<{ value: string[]; error: string | null }> {
  try {
    return { value: parseCompare(await s.get(COMPARE_KEY), offered), error: null };
  } catch (e) {
    return { value: [], error: `Your compare choice could not be read (${e instanceof Error ? e.message : String(e)}).` };
  }
}

/** Final review M-10: once the clinician has ticked something, the stored list arriving late never overwrites it. */
export function ticksAfterRead(touched: boolean, current: string[], stored: string[]): string[] {
  return touched ? current : stored;
}
