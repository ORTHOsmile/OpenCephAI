// Owner decision 1 (29 Oct 2026), spec 2026-10-29 norms-auto-population §4.1-§4.2: the Auto population — the
// patient's recorded background, else the clinic default, else (owner R1/R5, 3 Nov 2026) for an adult the combined adult
// norm, for a child the largest study for the patient's sex and age.
import { POPULATIONS } from './load';
import { byYear, COMBINED_ADULT, COMBINED_ADULT_LABEL, populationsOffered, setCoversPatient, setNearestAge, type UserNorm } from './resolve';
import type { NormSet } from './types';

/** Owner decision 3 (29 Oct 2026): the stored case value for Auto (cases.population). Never a population id. */
export const AUTO_CASE_POPULATION = 'auto';
/** The stored background for "Other or mixed" (patients.background): Auto skips to the clinic default. */
export const OTHER_BACKGROUND = 'other';
export type PopulationHow = 'background' | 'clinic-default' | 'combined' | 'best-evidence' | 'none';
/** What Auto chose and why. `label` is the sets' own population label (the report sentence's word for it). */
export interface PopulationChoice { population: string | null; how: PopulationHow; setId: string | null; ageCovered: boolean; label: string | null }
export interface AutoPopulationInput { background: string | null; clinicDefault: string | null; sex: 'M' | 'F' | null; ageYears: number | null; sets: NormSet[]; userNorms: UserNorm[] }

/** Norm sources, not backgrounds (spec §4.1). */
const NOT_BACKGROUNDS = ['analysis-own', 'singapore-nus'];
const shortLabel = (label: string) => label.split(' (')[0];
const labelOf = (sets: NormSet[], id: string) => sets.find((s) => s.population.id === id && s.kind === 'population')?.population.label ?? null;

/** Spec §4.1: the Background choices — people populations with a usable set, populations.json order, short labels. */
export function backgroundOptions(sets: NormSet[]): { id: string; label: string }[] {
  const offered = new Set(populationsOffered(sets, []).map((p) => p.id));
  return POPULATIONS.filter((p) => offered.has(p.id) && !NOT_BACKGROUNDS.includes(p.id)).map((p) => ({ id: p.id, label: shortLabel(p.label) }));
}

/** Owner decision 1, step 3 (spec §4.2; NAP-Q1 (a)): among people samples (never an analysis's own norm, a teaching
 *  sheet, a pending or website set, or treatment-seeking patients), those with a row for this sex and age; the largest
 *  count for the sex (nMale / nFemale, else n; sex not recorded: n); ties to the newer paper, the populations.json
 *  order, the set id. None has a row for the age: the nearest age first (AGE-2), then the same order. */
export function bestEvidenceSet(sets: NormSet[], sex: 'M' | 'F' | null, ageYears: number | null): { set: NormSet; ageCovered: boolean } | null {
  const cands = sets.filter((s) => s.kind === 'population' && s.status !== 'pending' && s.status !== 'website' && s.selection !== 'mixed-occlusion');
  const count = (s: NormSet) => sex === 'M' ? s.sample.nMale ?? s.sample.n ?? 0 : sex === 'F' ? s.sample.nFemale ?? s.sample.n ?? 0
    : s.sample.n ?? (s.sample.nMale ?? 0) + (s.sample.nFemale ?? 0);
  const popRank = (s: NormSet) => { const k = POPULATIONS.findIndex((p) => p.id === s.population.id); return k < 0 ? POPULATIONS.length : k; };
  const order = (a: NormSet, b: NormSet) => count(b) - count(a) || byYear(a, b) || popRank(a) - popRank(b) || a.id.localeCompare(b.id);
  const covered = cands.filter((s) => setCoversPatient(s, sex, ageYears));
  if (covered.length) return { set: [...covered].sort(order)[0], ageCovered: true };
  const dist = new Map(cands.map((s) => [s, setNearestAge(s, sex, ageYears)]));
  const near = cands.filter((s) => Number.isFinite(dist.get(s)!));
  if (!near.length) return null;
  const byDist = (a: NormSet, b: NormSet) => { const x = dist.get(a)!, y = dist.get(b)!; return x === y ? 0 : x < y ? -1 : 1; };
  return { set: [...near].sort((a, b) => byDist(a, b) || order(a, b))[0], ageCovered: false };
}

/** Owner decision 1 (29 Oct 2026): the patient's background, else the clinic default, else bestEvidenceSet. Only
 *  offered populations count (a deleted own-norm set is not). Pure. */
export function autoPopulation(i: AutoPopulationInput): PopulationChoice {
  const offered = new Set(populationsOffered(i.sets, i.userNorms).map((p) => p.id));
  const b = i.background;
  if (b !== null && b !== OTHER_BACKGROUND && !NOT_BACKGROUNDS.includes(b) && offered.has(b)) {
    return { population: b, how: 'background', setId: null, ageCovered: true, label: labelOf(i.sets, b) };
  }
  if (i.clinicDefault !== null && offered.has(i.clinicDefault)) {
    return { population: i.clinicDefault, how: 'clinic-default', setId: null, ageCovered: true, label: labelOf(i.sets, i.clinicDefault) };
  }
  // Owner rulings R1/R5 (3 Nov 2026; spec 2026-11-03): 18 and over, or the age not entered (an adult is assumed,
  // AGE-UNK-1), is one adult group — every adult study combined. Under 18: the largest study for the sex and age.
  if ((i.ageYears === null || i.ageYears >= 18) && i.sets.some((s) => s.kind === 'population')) {
    return { population: COMBINED_ADULT, how: 'combined', setId: null, ageCovered: true, label: COMBINED_ADULT_LABEL };
  }
  const best = bestEvidenceSet(i.sets, i.sex, i.ageYears);
  if (best) return { population: best.set.population.id, how: 'best-evidence', setId: best.set.id, ageCovered: best.ageCovered, label: best.set.population.label };
  return { population: null, how: 'none', setId: null, ageCovered: false, label: null };
}
