import { AUTO_CASE_POPULATION, COMBINED_ADULT, OWN_NORMS_LABEL, POPULATIONS, normsPopulation, populationsOffered, resolveAcross, type NormSet, type PopulationChoice, type PopulationHow, type UserNorm } from '@ceph/analyses';
import type { CaseDoc } from '../ipc';
import type { MeasurementRow } from '../measurements';
import { DEFAULT_DECIMALS, type Decimals } from '../format';
import { normCell, queryFor, type NormCell, type NormContext } from './normCell';

/** The case's "Reference population" picker (case header, ruling P26): the clinic default first, saying
 *  what it actually is (its own label, or `OWN_NORMS_LABEL` when none is set, N6/Task 10), then every population
 *  `populationsOffered` lists (built-in sets and the clinician's own norm sets alike). `value: ''` means "use the
 *  clinic default" — `CaseDoc.population` stays null until the clinician picks one of their own. */
const AUTO_WHY: Record<PopulationHow, string> = { background: "patient's background", 'clinic-default': 'clinic default',
  combined: 'no background or clinic default', 'best-evidence': 'largest study for this sex and age', none: 'nothing to choose from' };
/** Owner decision 3 (29 Oct 2026; spec 2026-10-29 §4.4): "Auto — <what it chose> (<why>)". A population's short label
 *  (the part before " ("); the analyses' own norms in the app's usual words; one of your norm sets by its whole label. */
export function autoOptionLabel(c: PopulationChoice | null, sets: NormSet[], userNorms: UserNorm[]): string {
  if (!c || c.population === null) return `Auto — ${OWN_NORMS_LABEL} (nothing to choose from)`;
  const label = populationsOffered(sets, userNorms).find((p) => p.id === c.population)?.label ?? c.population;
  // Owner R1/R5 (3 Nov 2026; spec 2026-11-03 §8.2): "Auto — combined adult norm (no background or clinic default)".
  const name = c.population === COMBINED_ADULT ? 'combined adult norm' : c.population === 'analysis-own' ? OWN_NORMS_LABEL : c.population.startsWith('user:') ? label : label.split(' (')[0];
  const why = c.how === 'best-evidence' && !c.ageCovered ? 'largest study for this sex, nearest age' : AUTO_WHY[c.how];
  // Owner answer C (7 Nov 2026): a population the rule sends elsewhere (Indian) is named by the norms it uses.
  const to = c.population.startsWith('user:') ? c.population : normsPopulation(c.population);
  if (to !== c.population) return `Auto — ${(POPULATIONS.find((p) => p.id === to)?.label ?? to).split(' (')[0]} (${why}; population rule)`;
  return `Auto — ${name} (${why})`;
}

/** The case's "Reference population" choices: Auto first (saying what it would choose, `wouldBe`); then, on a case the
 *  format-18 upgrade switched (`switched`, while on Auto), "Clinic default (as before the upgrade)" — the per-case undo
 *  (spec §4.8); on a case still holding NULL, the old "Clinic default (<default>)"; then every population offered. */
export function populationOptions(sets: NormSet[], userNorms: UserNorm[], clinicDefault: string | null, casePopulation: string | null, wouldBe: PopulationChoice | null, switched = false): { value: string; label: string }[] {
  const offered = populationsOffered(sets, userNorms);
  const def = clinicDefault ? offered.find((p) => p.id === clinicDefault)?.label ?? clinicDefault : OWN_NORMS_LABEL;   // P15
  const old = casePopulation === null ? [{ value: '', label: `Clinic default (${def})` }]
    : switched && casePopulation === AUTO_CASE_POPULATION ? [{ value: '', label: 'Clinic default (as before the upgrade)' }] : [];
  return [{ value: AUTO_CASE_POPULATION, label: autoOptionLabel(wouldBe, sets, userNorms) }, ...old, ...offered.map((p) => ({ value: p.id, label: p.label }))];
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

/** Ruling AUTO-Q7 (19 Oct 2026): what a Compare column shows when the population has no norm of its own. */
export const COMPARE_NONE = '—';

/** The patient's value against 2–4 populations side by side (master plan §9): one resolver result per population,
 *  through the same `NormCell` the Inspector's Measurements tab uses — a hidden mm value (N5) stays hidden and
 *  uncoloured here too (`row.num` is already null for it). Every population's own flags/hints (sex-averaged, age
 *  not entered, website, ideal-uncoloured, …) are present on each returned `NormCell`, never pooled across the
 *  row — fix round 1, ruling T11-1: this function only computes them (it always has); it is
 *  `ComparePopulations.tsx` that renders them per cell, visibly, which this comment wrongly implied before the
 *  fix. `decimals` defaults to the shipped default so the unit test (written against the brief's 4-argument
 *  call) stays exact; the real caller (CasePanel, via App.tsx) passes the operator's own DEC-1 setting.
 *  Ruling AUTO-Q7: a population with no norm of its own shows '—'. */
export function compareCells(
  rows: MeasurementRow[],
  populations: string[],
  doc: Pick<CaseDoc, 'population' | 'gender' | 'dateOfBirth' | 'takenOn'>,
  n: NormContext,
  decimals: Decimals = DEFAULT_DECIMALS,
): { row: MeasurementRow; cells: NormCell[] }[] {
  return rows.map((row) => {
    const q = queryFor(row.node, row.normAnalysisId, doc, n);
    // Each cell is described with ITS column's population (the query that column was resolved with).
    return { row, cells: resolveAcross(q, populations).map((r, i) => {
      const c = normCell(row.num, r, { ...q, population: populations[i] }, decimals);
      return r.kind === 'none' ? { ...c, text: COMPARE_NONE } : c;
    }) };
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
