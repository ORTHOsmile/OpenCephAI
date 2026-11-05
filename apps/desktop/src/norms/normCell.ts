import { AUTO_CASE_POPULATION, COMBINED_ADULT, COMBINED_ADULT_LABEL, autoPopulation, band, FLAG_WORDS, pickPopulation, type PopulationChoice, populationsOffered, severity, SEX_NOT_RECORDED_HINT, shortCitation, zScore, type AutoNote, type NormFlag, type NormSex, type Severity, type NormPicks, type NormQuery, type NormSet, type Resolved, type UserNorm } from '@ceph/analyses';
import type { CaseDoc } from '../ipc';
import { filmAge } from './filmAge';
import { fmtNumber, UNIT_SUFFIX, type Decimals } from '../format';

/** N5: an mm value on a film that is not ruler-calibrated is not shown; this is what the cell says instead. */
export const CALIBRATE_TO_SHOW = 'calibrate to show';
/** N1: the norm entry's clinical target, in one wording for the Inspector and the compare window (final review M-10). */
export const clinicalTargetText = (t: string) => `clinical target: ${t}`;

export interface NormCell {
  text: string;
  band: 'neutral' | 'amber' | 'red' | null;
  badges: { flag: NormFlag; badge: string; tip: string }[];
  sourceLine: string;
  target: string | null;
  /** Owner, 12 Oct (SEX-AVG-1 + P9): "Sex not recorded — record it for the exact norm." when the result is
   *  'sexes-averaged' (the resolver only averages when the sex is unrecorded), or when it is a P9 other-sex copy and
   *  the query's sex is null — not for a known patient of that sex, whom the copy correctly describes. Else null. */
  hint: string | null;
  /** Owner NORM-PICK-1 (12 Oct) and N-A2 (19 Oct): the population this cell's choice is for — set when that population
   *  had no norm (the cell reads "no <population> norm — choose one"), when Auto filled the row ('auto-fallback'), or
   *  when the clinician already chose a source for it ("chosen by you"; choosing again changes it). null for every
   *  other cell. */
  choose: { population: string } | null;
  /** Owner SEVERITY-1/2 (16 Oct): the z the colour is computed from, and its stars and word; null whenever there is no
   *  colour (no value shown, no usable SD, a website value). */
  z: number | null;
  severity: Severity | null;
  /** CHART-TAB-1: the norm's mean and SD as numbers, gated by `z` (null whenever there is no z — no value placed,
   *  no usable SD) — for the chart's ticks ONLY. Not for the CSV: see `normMean`/`normSd` below. */
  mean: number | null;
  sd: number | null;
  /** Owner N-A3/N-A5 (19 Oct 2026): what Auto used, when Auto filled this row; null otherwise. For the report's ◆ and
   *  footnote — on screen the mark is only in the row's norm drop-down. */
  auto: AutoNote | null;
  /** Owner decision (20 Oct, report-exports CSV): the resolved norm's own mean/SD, filled whenever `text` shows a
   *  value — independent of `z`/`mean`/`sd` above, so a "Needs: …" row or an SD-less norm still carries its norm
   *  here even with no colour and no chart tick. Null exactly when `text` has no number in it (`kind: 'none'` or
   *  `'choose'`); for an SD-less norm, `normMean` is filled and `normSd` stays null, matching `normText`. */
  normMean: number | null;
  normSd: number | null;
  /** Owner C1 and addendum 2 J (19 Oct 2026): the hover sentences of the tags kept off the row ('ideal',
   *  'ideal-uncoloured', 'sd-borrowed', 'scale-assumed'), in the resolver's order — shown on the source line's hover.
   *  Never the Auto one (N-A5). */
  sourceTips: string[];
  /** Every flag the resolver raised (hidden ones included), for the report (Task 10). [] for none/choose. */
  flags: NormFlag[];
  /** The short citation of the set used ("Ricketts 1960"), for the report's lists; null for none/choose and your own norms. */
  citation: string | null;
  /** Review M-2 (fix round 1, 25 Oct 2026): the short citation of the paper an SD was BORROWED from (`sdDonor`,
   *  rules 13-17), when THAT donor paper's own X-ray enlargement is unstated — separate from `citation` (the mean's
   *  own paper), because the two can differ: a paper that states its own scale can still borrow an SD from one that
   *  does not. null whenever nothing was borrowed, or the donor's own scale was stated. */
  sdDonorCitation: string | null;
  /** Owner report request (29 Oct 2026): the sex, population and age row the resolver actually used for this
   *  result — read straight off `resolveNorm`'s own `Resolved` (`entry.sex`, the matched set's `population.label`,
   *  `ageRowUsed`), never recomputed — so the report's one-sentence norm summary can never disagree with what the
   *  resolver itself did. All three null for 'none'/'choose' (no norm was actually used). */
  normSex: NormSex | null;
  normPopulation: string | null;
  normAgeRowUsed: string | null;
}
export interface NormContext { sets: NormSet[]; userNorms: UserNorm[]; clinicDefault: string | null }

/** Flags that never become a tag on screen. Owner N-A5 (19 Oct 2026): 'auto-fallback' — the mark is in the row's norm
 *  drop-down (and the report). Owner C1 (19 Oct 2026): 'ideal', 'ideal-uncoloured' (its tag also reads "ideal") and
 *  'sd-borrowed'; addendum 2 J (19 Oct 2026): 'scale-assumed' (the paper's X-ray enlargement unstated) — their
 *  explanations move to the source hover (`sourceTips`); the source line, which the report prints, keeps its words. */
export const HIDDEN_ON_SCREEN: readonly NormFlag[] = ['auto-fallback', 'ideal', 'ideal-uncoloured', 'sd-borrowed', 'scale-assumed'];

/** Owner ruling Q-B (24 Oct 2026): "film scale not stated in the paper; assumed true size" (and its "source's"/
 *  "donor's" borrowed-SD variants) read as if the PATIENT's film were unscaled — the words are the PAPER's. Reworded
 *  wherever a cell's source line is shown, printed or exported (the hover, the report, the CSV) — never inside the
 *  resolver itself: `resolve.ts`'s own words, which `resolveNorm` returns raw and which `flagpaths.test.ts` /
 *  `resolve.test.ts` / the norms-auto probe (`Resolved.sourceLine` straight off the resolver) all pin, are untouched.
 *  Words only; no number or classification moved. */
export const rewordUnstatedScale = (line: string): string => line
  .replace('film scale not stated in the paper; assumed true size', 'the paper did not state its X-ray enlargement; mm taken as true size')
  .replace("source's film scale not stated; assumed true size", "source's X-ray enlargement not stated; mm taken as true size")
  .replace("donor's film scale not stated; assumed true size", "donor's X-ray enlargement not stated; mm taken as true size");

/** The norm as one short text: mean ± SD; a mean with its range; a range; a mean alone; "—" (neither); or "No norm".
 *  The unit is the norm entry's own (validated equal to the catalogue's). Owner DEC-1: shown at the operator's
 *  decimals setting through the one shared formatter (a plain ratio at least 2); display only. */
export function normText(r: Resolved, decimals: Decimals): string {
  if (r.kind === 'none') return 'No norm';
  if (r.kind === 'choose') return r.reason;
  const unit = r.entry.unit;
  const u = UNIT_SUFFIX[unit];
  const n = (x: number) => fmtNumber(x, unit, decimals);
  if (r.mean !== null && r.sd !== null) return `${n(r.mean)} ± ${n(r.sd)}${u}`;
  if (r.mean !== null && r.range) return `${n(r.mean)}${u} (${n(r.range.low)}–${n(r.range.high)})`;
  if (r.mean !== null) return `${n(r.mean)}${u}`;
  if (r.range) return `${n(r.range.low)}–${n(r.range.high)}${u}`;
  return '—';
}

/** One Inspector norm cell. `value` is null when the value is not shown (not placed, or mm on an uncalibrated film):
 *  then there is no colour. The colour follows the resolver's zScore (null for website values and SD-less norms).
 *  `q` is the query the norm was resolved with (ruling T4-4), so the sex the hint reads is the sex the resolver
 *  used — the two cannot drift. `decimals` is the operator's display setting (DEC-1): it changes the text only — the
 *  colour is computed from the full value, mean and SD. */
export function normCell(value: number | null, r: Resolved, q: NormQuery, decimals: Decimals): NormCell {
  if (r.kind === 'none') return { text: normText(r, decimals), band: null, badges: [], sourceLine: r.reason, target: null, hint: null, choose: null, z: null, severity: null, mean: null, sd: null, auto: null, normMean: null, normSd: null, sourceTips: [], flags: [], citation: null, sdDonorCitation: null, normSex: null, normPopulation: null, normAgeRowUsed: null };
  // NORM-PICK-1: the words are the cell's text; the source line stays empty rather than repeating them.
  if (r.kind === 'choose') return { text: r.reason, band: null, badges: [], sourceLine: '', target: null, hint: null, choose: { population: r.population }, z: null, severity: null, mean: null, sd: null, auto: null, normMean: null, normSd: null, sourceTips: [], flags: [], citation: null, sdDonorCitation: null, normSex: null, normPopulation: null, normAgeRowUsed: null };
  const z = value === null ? null : zScore(value, r);
  const badges = r.flags.filter((flag) => !HIDDEN_ON_SCREEN.includes(flag)).map((flag) => {
    const w = FLAG_WORDS[flag];
    // P9 (owner, 12 Oct): the author's copy is named by the sex it was copied FROM, so this clause is always
    // informative — it keeps the screen from reading as if the patient were that other sex when the sex is in fact
    // unrecorded (the resolver's own sourceLine, unchanged, still uses the row's own sex word, e.g. "women").
    if (flag === 'other-sex-values' && r.entry.fromOtherSex) {
      const whoseRow = r.entry.fromOtherSex === 'M' ? "men's" : "women's";
      return { flag, badge: w.badge, tip: `${w.tip} Copied from the ${whoseRow} row.` };
    }
    return { flag, ...w };
  });
  const hint = r.flags.includes('sexes-averaged') || (q.sex === null && r.flags.includes('other-sex-values')) ? SEX_NOT_RECORDED_HINT : null;
  // Owner decision 6 (29 Oct 2026): with no population at all, a pick is stored under the analyses' own norms.
  const choose = r.flags.includes('chosen-by-you') || r.flags.includes('auto-fallback') ? { population: pickPopulation(q) } : null;
  const sourceTips = r.flags.filter((f) => HIDDEN_ON_SCREEN.includes(f) && f !== 'auto-fallback').map((f) => FLAG_WORDS[f].tip);
  const set = q.sets.find((s) => s.id === r.setId);
  const donorSet = r.sdDonor ? q.sets.find((s) => s.id === r.sdDonor!.setId) : undefined;
  const sdDonorCitation = donorSet && donorSet.scale.kind === 'not-stated' ? shortCitation(donorSet) : null;
  return { text: normText(r, decimals), band: z === null ? null : band(z), badges, sourceLine: rewordUnstatedScale(r.sourceLine), target: r.entry.clinicalTarget ?? null, hint, choose, z, severity: severity(z), mean: z === null ? null : r.mean, sd: z === null ? null : r.sd, auto: r.auto ?? null, normMean: r.mean, normSd: r.sd, sourceTips, flags: r.flags, citation: set ? shortCitation(set) : null, sdDonorCitation, normSex: r.entry.sex,
    // Owner report request (29 Oct 2026): "The analysis's own norms" (kind 'analysis-own') and a research-SD-only
    // set are not a demographic population — the summary sentence names a POPULATION ("male Chinese population"),
    // so only a real `kind: 'population'` set counts as "a norm used" for it. Rows resolved from the analysis's
    // own built-in norm still print fine everywhere else; they just never drive (or get counted into "mixed" by)
    // this one sentence.
    // Owner R1/R5 (3 Nov 2026): the combined adult norm is not one set; the sentence names it "combined adult".
    normPopulation: r.setId === COMBINED_ADULT ? COMBINED_ADULT_LABEL : set && set.kind === 'population' ? set.population.label : null, normAgeRowUsed: r.ageRowUsed };
}

/** Task 5: the Inspector's one message for a failed norms read. `useNorms()` reports a failed load of the
 *  committed sets and a failed read of the clinician's own norms/clinic default separately (`loadError`,
 *  `settingsError`) so neither swallows the other; this is the one line the screen shows for both together.
 *  Fix round 1, review Minor 2: `loadError` is a raw `String(e)` (`safeLoadSets`), not a sentence of its own, so
 *  it gets the "Norms couldn't be loaded:" prefix here; `settingsError` (`readUserNorms`/`readClinicDefault`) is
 *  already a complete sentence ("Your own norms could not be read …") and is shown as-is — wrapping it in the
 *  same prefix would misreport a settings-only failure as the committed sets failing to load, when they loaded
 *  fine. */
export function normsErrorMessage(loadError: string | null, settingsError: string | null): string | null {
  return [loadError ? `Norms couldn't be loaded: ${loadError}` : null, settingsError].filter(Boolean).join(' ') || null;
}

/** Fix round 1, ruling T5-2: the Measurements/Change cell's colour class, as a pure function the
 *  Inspector calls and a unit test can check directly — a positive control for the colour wiring, since a cell
 *  with no band (hidden, no SD, or no case open) is indistinguishable from a cell whose colour code was simply
 *  deleted unless something elsewhere proves amber/red are reachable too (see `e2e10.cjs`'s colour checks). */
export function valueClass(c: NormCell | null): string {
  return c?.band && c.band !== 'neutral' ? `m-value norm-${c.band}` : 'm-value';
}

/** Fix round 1, ruling T5-1: the one sex hint the Inspector shows above the Measurements table —
 *  `NormCell.hint` directly, from whichever row raises it first, never re-derived from a single flag. The old
 *  Inspector code checked only `badges.some((b) => b.flag === 'sexes-averaged')`, which misses the P9 other-sex
 *  copy path (`hint` also fires there when the sex is unrecorded — M-6 above, on real Ricketts 1981 data); today's
 *  BUILT_INS (Steiner/Downs/McNamara) happen not to hit that path, so nothing was visibly wrong yet, but Task 6
 *  enables all 15 analyses, including Ricketts. */
export function firstHint(cells: (NormCell | null)[]): string | null {
  return cells.find((c) => c?.hint)?.hint ?? null;
}

/** The resolver query for one row of one case (N2, N6): the case's population, the clinic default, sex from the record,
 *  and the age from `filmAge` (the DOB to the film date; with no DOB, the film's own age — owner AG1, 19 Oct);
 *  `picks` are the sources the clinician chose on this case where a population had no norm (owner NORM-PICK-1,
 *  `normPicks.ts`). */
type QueryDoc = Pick<CaseDoc, 'population' | 'gender' | 'dateOfBirth' | 'takenOn'> & { background?: string | null; ageOnFilmYears?: number | null };

/** Owner decisions 1 and 3 (29 Oct 2026): for a case on Auto, the population the rule chose and why; null for every
 *  other case (a hand-chosen population, or the old "Clinic default"). One function for the screen, the report and
 *  the CSV. */
export function casePopulationChoice(doc: QueryDoc, n: NormContext): PopulationChoice | null {
  if (doc.population !== AUTO_CASE_POPULATION) return null;
  return autoPopulation({ background: doc.background ?? null, clinicDefault: n.clinicDefault, sex: doc.gender,
    ageYears: filmAge(doc), sets: n.sets, userNorms: n.userNorms });
}

export function queryFor(measurement: string, analysisId: string, doc: QueryDoc, n: NormContext, picks: NormPicks = {}): NormQuery {
  const auto = casePopulationChoice(doc, n);
  // On Auto the rule's population is the case's; the clinic default is already step 2 of the rule, so it is never
  // passed on (a null population then takes the no-population path, never a second look at the default).
  const population = auto ? auto.population : populationMissing(doc.population, n.sets, n.userNorms) ? null : doc.population;
  return { measurement, analysisId, population, clinicDefault: auto ? null : n.clinicDefault, sex: doc.gender,
    ageYears: filmAge(doc), sets: n.sets, userNorms: n.userNorms, picks,
    filmDateMissing: !!doc.dateOfBirth && !doc.takenOn };
}

/** Fix round 1, ruling T11-4: the case's stored population no longer names anything real — its
 *  user-norm set was deleted in Settings ▸ Norms since the case was set to it (Task 10's `onDeleteSet` only
 *  clears a dangling CLINIC default, not a dangling CASE population). `true` exactly when `population` is set
 *  but `populationsOffered` no longer lists it — never a hardcoded `'user:'` prefix, which `resolve.ts` keeps
 *  private; this is the one check both `queryFor` (so the resolver falls back to the clinic default, the same
 *  as "no population chosen", never a silent own-norm fallback under a label that still claims to be the dead
 *  population) and the picker (`CasePanel.tsx`, so it says so in words) use. */
export function populationMissing(population: string | null, sets: NormSet[], userNorms: UserNorm[]): boolean {
  return population !== null && population !== AUTO_CASE_POPULATION && !populationsOffered(sets, userNorms).some((p) => p.id === population);
}

/** Final review M-8: the case panel's note when the case's population is not offered (populationMissing). A failed
 *  read of the clinician's own norms makes every user population look missing, so it is said as what it is — never as
 *  a deletion that did not happen. */
export function populationNote(missing: boolean, userNormsFailed: boolean): string | null {
  if (!missing) return null;
  return userNormsFailed ? 'your norms could not be read — using clinic default' : 'chosen set deleted — using clinic default';
}
