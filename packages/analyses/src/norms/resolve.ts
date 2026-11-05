import { byId } from '../catalogue';
import { ALL_ANALYSES } from '../analyses';
import { POPULATIONS } from './load';
import { adultPool, combineGroups, type PoolRow } from './combined';
import type { NormEntry, NormSet, NormSex } from './types';

/** A clinician's own norm (stored in the library, never in git; always labelled "your norm"). */
export interface UserNorm {
  setName: string;
  measurement: string;
  mean: number;
  sd: number | null;
  sourceNote: string;
}

export interface NormQuery {
  measurement: string;
  analysisId: string;
  population: string | null; // the case's population (N6); null = use the clinic default
  clinicDefault: string | null;
  sex: 'M' | 'F' | null;
  ageYears: number | null;
  sets: NormSet[];
  userNorms: UserNorm[];
  /** Owner NORM-PICK-1 (12 Oct): the sources the clinician picked on this case where a population had no norm —
   *  per population id, per measurement, the picked source (a population id, 'analysis-own' or 'user:<set>'). */
  picks?: NormPicks;
  /** Owner FILMDATE-1 (12 Oct): the date of birth is entered but the film date is not, so the age is unknown for that
   *  reason — the adult row is used as for AGE-UNK-1, but the words name the film date. */
  filmDateMissing?: boolean;
}

/** Owner NORM-PICK-1: population id → measurement → picked source id. Saved on the case (desktop `normPicks`). */
export type NormPicks = Record<string, Record<string, string>>;

/** Every flag the resolver can emit — one runtime list, and NormFlag is derived from it (review M-1, Task 4 fix
 *  round 1), so FLAG_WORDS's completeness test compares two real lists instead of parsing this file. */
export const NORM_FLAGS = [
  'website',
  'close',
  'unverified',
  'age-mismatched',
  'sex-pooled',
  'user-norm',
  'second-hand',
  'sd-from-other-paper',
  'converted-to-true-size',
  'scale-assumed',
  'sd-borrowed',
  'ideal',
  'interpolated',
  'other-sex-values',
  'sexes-averaged',
  'age-assumed-adult',
  // Ruling T4-1 (Task 4 fix round 1): one meaning per flag. These were folded into age-mismatched, sex-pooled,
  // converted-to-true-size, close and ideal, whose screen words then described only one of their paths.
  'age-unknown-oldest-row', // no age entered and no usable adult row: the oldest row stood in (was 'age-mismatched')
  'sd-other-age', //           the borrowed (sdSource) SD's row is for another age than the norm's row
  'sd-sexes-pooled', //        the borrowed (sdSource) SD's row is for both sexes; the norm's row is one sex's
  'sd-close', //               the borrowed (sdSource) SD's row measured it a little differently
  'sd-converted', //           the borrowed SD (sdSource or donor) was converted from an enlarged film
  'ideal-uncoloured', //       an ideal with no SD that can be used: not coloured (was 'ideal')
  'film-date-missing', //      owner FILMDATE-1: as 'age-assumed-adult', but the date of birth is entered and the film date is not
  'chosen-by-you', //          owner NORM-PICK-1: the population had no norm; the clinician picked this source for the case
  'auto-fallback', //          owner N-A3 (19 Oct 2026): the population had no norm and no pick; Auto used the analysis's own norm or bestCaucasian
  'combined-adult', //         owner R1/R5 (3 Nov 2026): every adult study combined, weighted by size (spec 2026-11-03)
  'single-study', //           owner NAP-P3 (b): fewer than 2 adult studies have it; that one study's row, marked ◆
] as const;
export type NormFlag = (typeof NORM_FLAGS)[number];

/** Owner AGE-UNK-1 (12 Oct): the words for flag 'age-assumed-adult', defined once (source line here; Task 4's screen). */
export const AGE_NOT_ENTERED_WORDS = 'age not entered — adult norms assumed';
/** Owner FILMDATE-1 (12 Oct): the words for flag 'film-date-missing' — date of birth entered, film date missing. */
export const FILM_DATE_MISSING_WORDS = 'film date missing — adult norms assumed';

/** Owner N-A3/N-A5 (19 Oct 2026): what Auto used, on a result it filled (absent on every other result). */
export interface AutoNote {
  /** The population that had no norm (the case's, else the clinic default) — its id. */
  population: string;
  /** Its words in "no <…> norm" (noNormLabel): "Chinese", "Wits's own", "Mine (your norms)". */
  populationWords: string;
  /** Step 2 ('analysis-own': the analysis's own norm), step 3 ('caucasian': bestCaucasian) or step 4 ('anywhere':
   *  bestStudy over every other population, owner AUTO-Q6). */
  step: 'analysis-own' | 'caucasian' | 'anywhere' | 'single-study';
  /** The population whose study was used, in short words ("Caucasian", "Chinese"); null for step 2. */
  usedPopulation: string | null;
  /** Who, in a few words: "Steiner's own norm", "McNamara 1984 Ann Arbor", "Zheng 2026 Beijing". */
  source: string;
  /** The people in the row compared with (FR-1: both rows' n when the sexes are averaged); null when a row states none. */
  n: number | null;
}

export type Resolved =
  | { kind: 'none'; reason: string }
  /** Owner NORM-PICK-1 (12 Oct): the chosen population has no norm for this measurement, the analysis has no own norm
   *  to stand in, and some other source has one — no value (uncoloured); the clinician chooses (normChoices). */
  | { kind: 'choose'; population: string; reason: string }
  | {
      kind: 'norm';
      setId: string;
      entry: NormEntry;
      mean: number | null;
      sd: number | null;
      range: { low: number; high: number } | null;
      /** The stored (paper-printed) mean/sd/range when a film-scale conversion happened
       *  (rule 10), else null. Never set for angular/%/ratio units or for 'true-size'/
       *  'not-stated' scales (rules 11-12), and never for a user norm. */
      printed: { mean: number | null; sd: number | null; range: { low: number; high: number } | null } | null;
      colour: boolean;
      flags: NormFlag[];
      sourceLine: string;
      ageRowUsed: string | null;
      /** Rules 13-17 (Task 4c, owner B-1): the paper whose SD this norm borrowed because its own
       *  paper printed none; null when nothing was borrowed (own SD, sdSource, or no donor). */
      sdDonor: SdDonor | null;
      /** Owner N-A3 (19 Oct 2026): set only when Auto filled this result; absent otherwise. */
      auto?: AutoNote;
    };

export interface SdDonor {
  setId: string;
  source: string;
  sex: NormSex;
  ageRowUsed: string | null;
  n: number | null;
}

const USER_PREFIX = 'user:';

/** Resolves the norm for one measurement of one patient (Part C rules 1–9):
 *  population (case, else clinic default) → the best set there → the patient's sex row (else pooled)
 *  → the age row (N2; age not entered → an adult is assumed, owner AGE-UNK-1) → else (population chosen) the
 *  clinician's pick (NORM-PICK-1), else Auto — the analysis's own norm, else bestCaucasian, else the best study anywhere
 *  (owner N-A3, AUTO-Q6, 19 Oct 2026), else (only your own norms have it, AUTO-Q11) "choose one" → (no population)
 *  the analysis's own norm, else the clinician's own norms → else none.
 *  Rules 10–12: film scale (applyFilmScale). Rules 13–17 (Task 4c, owner B-1/B-2): a chosen entry
 *  with no SD of its own and no sdSource, in a set that is not a website set, borrows the SD of the
 *  closest matching paper (findSdDonor), flagged 'sd-borrowed' and named in the source line; an
 *  entry with centre 'ideal' is flagged 'ideal' and its line says "ideal value (<authors>)".
 *  Rule 3a (owner SEX-AVG-1, 12 Oct): sex not recorded, men's and women's rows only at the age → the two averaged. */
export function resolveNorm(q: NormQuery): Resolved {
  const popId = q.population ?? q.clinicDefault;

  // 1. The chosen population.
  if (popId !== null) {
    const hit = fromSource(q, popId);
    // Owner NAP-P3 (b), 3 Nov 2026: a combined adult norm from a single study is Auto's ◆ answer, so a source the
    // clinician picked for the row comes first, as for every other Auto row; every other hit is returned at once.
    const singleStudy = hit?.flags.includes('single-study') ? hit : null;
    if (hit && !singleStudy) return hit;
    // NORM-PICK-1: the population has nothing; the source the clinician picked for it on this case, if it still has one.
    // Review M-3 (fix round 1): the `picked !== AUTO_CHOICE_ID` and `picked !== popId` guards are defensive, not
    // observable today — `fromSource(q, picked)` already returns null for both ('auto' names no population or user
    // set; `picked === popId` means `fromSource(q, popId)` already returned null above, so it would too) — so removing
    // either leaves every test green (confirmed, mutation). Kept as defence against a future `fromSource` change; the
    // outcome itself ("a stored 'auto' falls to Auto") is pinned by auto.test.ts, not by this line.
    const picked = q.picks?.[popId]?.[q.measurement];
    const chosen = picked !== undefined && picked !== popId && picked !== AUTO_CHOICE_ID ? fromSource(q, picked) : null;
    if (chosen) {
      chosen.flags.push('chosen-by-you');
      chosen.sourceLine += ` · chosen by you (no ${noNormLabel(popId, q.analysisId)} norm)`;
      return chosen;
    }
    if (singleStudy) return singleStudy;
    // Owner N-A3 (19 Oct 2026), superseding the default of NORM-PICK-1 and OWNFALL-1 (the choice list itself stays): Auto.
    const auto = autoFallback(q, popId);
    if (auto) return auto;
    // 6b. AUTO-Q11: only the clinician's own norm sets have it (never an Auto candidate): "choose one", as before.
    if (normChoices(q).length > 0) return { kind: 'choose', population: popId, reason: `no ${noNormLabel(popId, q.analysisId)} norm — choose one` };
  } else {
    // No population chosen at all (N6 a): the analysis's own norm — the default then, not a fallback — else the
    // clinician's own norms, first set by name (unchanged).
    const own = fromSets(q, ownSets(q));
    if (own) return own;
    const user = fromUserNorms(q, q.userNorms);
    if (user) return user;
    // Owner decision 6 (29 Oct 2026), superseding the 19 Oct spec's edge case "no population: Auto adds nothing": the
    // owner's own words that day were "falls back for every value". The clinician's pick for the row (stored under the
    // own-norms key, pickPopulation), else Auto as if the analyses' own norms had been chosen (steps 3-4; step 2 is
    // this same source).
    const picked = q.picks?.[OWN_POPULATION]?.[q.measurement];
    const chosen = picked !== undefined && picked !== OWN_POPULATION && picked !== AUTO_CHOICE_ID ? fromSource(q, picked) : null;
    if (chosen) {
      chosen.flags.push('chosen-by-you');
      chosen.sourceLine += ` · chosen by you (no ${noNormLabel(OWN_POPULATION, q.analysisId)} norm)`;
      return chosen;
    }
    const auto = autoFallback(q, OWN_POPULATION);
    if (auto) return auto;
  }
  // 6c. Nothing.
  const places = [popId !== null ? populationLabel(popId) : null, analysisName(q.analysisId), 'your norms'].filter(Boolean);
  return { kind: 'none', reason: `No norm for this measurement in ${places.join(' or ')}.` };
}

/** One source the clinician can choose when the chosen population has no norm (owner NORM-PICK-1): its id (stored as
 *  the pick), its label, and — ruling FR-1 — the ROW the patient would be compared with, never the whole study: `rows`,
 *  who that row is (the source line's sex words) and its n (both rows when the sexes are averaged; n null when the row
 *  states none, or for an interpolated row, which is no single printed row), `ages` the row's own age (the resolver's
 *  `ageRowUsed`; null for a row with no age band), and the resolver's own result for it (value, flags, source line). */
export interface NormChoice { id: string; label: string; rows: { who: string; n: number | null }[]; ages: string | null; resolved: Extract<Resolved, { kind: 'norm' }> }

/** Owner N-A2 (19 Oct 2026): "Auto" first (when Auto has an answer), then every source that has this measurement, other
 *  than the query's own population (case, else clinic default): other populations in the picker's order
 *  (populationsOffered), the analysis's own norm, the clinician's own norm sets. Each is resolved exactly as if it were
 *  the chosen population, with no fallback — so a source listed here really has it. */
export function normChoices(q: NormQuery): NormChoice[] {
  // Owner decision 6 (29 Oct 2026): with no population at all, the choices are those of the analyses' own norms.
  const popId = pickPopulation(q);
  const out: NormChoice[] = [];
  // Owner N-A2 (19 Oct 2026): "Auto" first, whenever Auto has an answer for this population (it ignores any pick).
  // Owner NAP-P3 (b): for the combined adult norm, Auto's answer is the single study when only one has the row.
  const single = popId === COMBINED_ADULT ? fromCombined({ ...q, picks: undefined }) : null;
  const auto = single?.auto ? single : autoFallback(q, popId);
  if (auto?.auto) {
    const a = auto.auto;
    // AUTO-Q9: "Auto · Caucasian — McNamara 1984 Ann Arbor, n = 73 (no Japanese norm)"; the row's n (AUTO-Q1).
    const who = a.usedPopulation ? `${a.usedPopulation} — ${a.source}` : a.source;
    out.push({ id: AUTO_CHOICE_ID, label: `Auto · ${who}${a.n !== null ? `, n = ${a.n}` : ''} (no ${a.populationWords} norm)`,
      rows: rowsUsed(auto, q.sets.find((s) => s.id === auto.setId) ?? null), ages: auto.ageRowUsed, resolved: auto });
  }
  for (const p of populationsOffered(q.sets, q.userNorms)) {
    if (p.id === popId) continue;
    const hit = fromSource({ ...q, picks: undefined }, p.id);
    if (!hit) continue;
    const set = q.sets.find((s) => s.id === hit.setId) ?? null;
    const label = p.id === 'analysis-own' ? `${noNormLabel(p.id, q.analysisId)} norm` : p.label;
    out.push({ id: p.id, label, rows: rowsUsed(hit, set), ages: hit.ageRowUsed, resolved: hit });
  }
  return out;
}

/** Ruling FR-1: who the row used is, and its n (`rowN`). Sexes averaged (SEX-AVG-1): the men's and the women's rows at
 *  that band, each with its own n. An interpolated row is no single printed row, so its n is not stated. */
function rowsUsed(hit: Hit, set: NormSet | null): { who: string; n: number | null }[] {
  const e = hit.entry;
  const interpolated = hit.flags.includes('interpolated');
  if (hit.flags.includes('sexes-averaged') && set) {
    return (['M', 'F'] as const).map((sex) => {
      const row = set.entries.find((x) => x.measurement === e.measurement && x.sex === sex && sameBand(x, e) && x.definitionMatch !== 'different');
      return { who: sexWords({ ...e, sex }), n: !interpolated && row ? rowN(row, set) : null };
    });
  }
  return [{ who: sexWords(e), n: interpolated || !set ? null : rowN(e, set) }];
}

/** A row's n as the source line quotes it: its own; for a row with no age band, the sample's count for its sex. */
function rowN(e: NormEntry, set: NormSet): number | null {
  return e.n ?? (e.ageBand ? undefined : e.sex === 'M' ? set.sample.nMale : e.sex === 'F' ? set.sample.nFemale : set.sample.n) ?? null;
}

/** z = (value − mean) / SD, only when the norm is coloured (an SD exists and it is not a website value). */
export function zScore(value: number, r: Resolved): number | null {
  if (r.kind !== 'norm' || !r.colour || r.mean === null || r.sd === null) return null;
  return (value - r.mean) / r.sd;
}

/** |z| ≤ 1 neutral, ≤ 2 amber, > 2 red (the same thresholds as the desktop's zBand). */
export function band(z: number): 'neutral' | 'amber' | 'red' {
  const a = Math.abs(z);
  return a <= 1 ? 'neutral' : a <= 2 ? 'amber' : 'red';
}

/** One result per population, in the order given — the Compare-populations window (Part D). Ruling AUTO-Q7 (19 Oct
 *  2026): each column is that population's OWN norm (resolved exactly as for a case set to it), else 'none' — never a
 *  pick, never Auto, never "choose one", because filling a Japanese column with another population's value would
 *  misrepresent the comparison the window exists for. */
export function resolveAcross(q: NormQuery, populations: string[]): Resolved[] {
  return populations.map((p) => fromSource({ ...q, population: p, picks: undefined }, p)
    ?? { kind: 'none', reason: `No ${populationLabel(p)} norm for this measurement.` });
}

/** The populations the picker offers: every population holding a usable set (not pending; a
 *  research-SD set alone does not make a population), in the populations.json order, then the
 *  clinician's own norm sets as `user:<setName>`, by name. */
export function populationsOffered(sets: NormSet[], userNorms: UserNorm[]): { id: string; label: string }[] {
  const used = new Set(sets.filter((s) => s.status !== 'pending' && s.kind !== 'research-sd').map((s) => s.population.id));
  const known = POPULATIONS.filter((p) => used.has(p.id)).map((p) => ({ id: p.id, label: p.label }));
  const knownIds = new Set(known.map((p) => p.id));
  const unknown = sets
    .filter((s) => used.has(s.population.id) && !knownIds.has(s.population.id))
    .map((s) => ({ id: s.population.id, label: s.population.label }))
    .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i);
  const userNames = [...new Set(userNorms.map((u) => u.setName))].sort(byName);
  return [...known, ...unknown, ...userNames.map((n) => ({ id: USER_PREFIX + n, label: `${n} (your norms)` }))];
}

/** Owner N-A3 (19 Oct 2026): the population Auto's third step looks in. */
export const AUTO_POPULATION = 'caucasian';

/** Owner N-A1/N-A4 and AUTO-Q1/Q2/Q6 (19 Oct 2026): the set Auto uses, among these populations' usable sets (pending and
 *  research-SD sets never, and — owner ruling Q-T5-1, 24 Oct 2026 fix round 1 — a `kind: 'analysis-own'` set filed under
 *  a population id never: a teaching sheet or author's material with no described sample, such as the real NUS/NDC
 *  sheet, is not "the best study anywhere"; it stays reachable only as its own analysis's own norm, step 2, and as a
 *  manual choice), for this measurement and this patient; null when none has it. Ranked: a paper before a
 *  website value and any sample before a treatment-seeking one (P14a, P37-FIRST, unchanged — AUTO-Q4); then a set with a
 *  row for the patient's sex and age (AGE-1; no age entered → an adult row, AGE-UNK-1; sex not recorded → a pooled row or
 *  a men's and women's pair, SEX-AVG-1); among sets with none, the nearest age (AGE-2 — AUTO-Q2); then the most people in
 *  the row the patient would be compared with (FR-1's n, `rowsUsed`: both rows' n added when the sexes are averaged; a
 *  row stating no n ranks after every row that states one — AUTO-Q1); then the newer paper (undated last); then the
 *  populations' order in populations.json (AUTO-Q12); then each population's usual order (rule 5), so two sets still
 *  tied — McNamara 1984's Ann Arbor and Burlington samples share a year — always resolve the same way (AUTO-Q3). Pure. */
export function bestStudy(q: NormQuery, populations: string[]): NormSet | null {
  const usual = populations.flatMap((p) => orderSets(q, setsOfPopulation(q, p), true)).filter((s) => s.kind !== 'analysis-own');
  const cands = usual.flatMap((set) => {
    const pick = pickForSet(set, q);
    return pick ? [{ set, hit: build(q, set, pick) }] : [];
  });
  const web = (s: NormSet) => (s.status === 'website' ? 1 : 0);
  const treat = (s: NormSet) => (s.selection === 'mixed-occlusion' ? 1 : 0);
  const cover = (s: NormSet) => (coversAge(s, q) ? 0 : 1);
  const dist = (s: NormSet) => (cover(s) === 1 ? nearestBandDistance(s, q) : 0);
  const near = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1); // Infinity-safe
  const people = (c: { set: NormSet; hit: Hit }) => {
    const ns = rowsUsed(c.hit, c.set).map((r) => r.n);
    return ns.some((n) => n === null) ? -1 : ns.reduce((sum: number, n) => sum + (n as number), 0);
  };
  const popRank = (s: NormSet) => {
    const i = POPULATIONS.findIndex((p) => p.id === s.population.id);
    return i < 0 ? POPULATIONS.length : i;
  };
  const rank = (a: (typeof cands)[number], b: (typeof cands)[number]) =>
    web(a.set) - web(b.set) || treat(a.set) - treat(b.set) || cover(a.set) - cover(b.set) || near(dist(a.set), dist(b.set)) ||
    people(b) - people(a) || byYear(a.set, b.set) || popRank(a.set) - popRank(b.set) || usual.indexOf(a.set) - usual.indexOf(b.set);
  return [...cands].sort(rank)[0]?.set ?? null;
}

/** Step 3 (owner N-A3): the best Caucasian set. */
export const bestCaucasian = (q: NormQuery): NormSet | null => bestStudy(q, [AUTO_POPULATION]);

/** Owner N-A2 (19 Oct 2026): the id of the "Auto" entry in the choice list. Never stored: choosing it removes the case's
 *  pick (normPicks.withPick). A stored 'auto' is ignored by resolveNorm, so it falls to Auto too. */
export const AUTO_CHOICE_ID = 'auto';
/** The analyses' own norms, as a population id (populations.json). */
export const OWN_POPULATION = 'analysis-own';
/** Owner decision 6 (29 Oct 2026): the key a per-row pick is stored and read under — the case's population, else the
 *  clinic default, else (no population at all) the analyses' own norms. */
export const pickPopulation = (q: NormQuery): string => q.population ?? q.clinicDefault ?? OWN_POPULATION;

/** Owner N-A3 and AUTO-Q6 (19 Oct 2026): Auto, for a chosen population with no norm and no usable pick — step 2, the
 *  analysis's own norm (skipped when the analyses' own norms ARE the chosen population); else step 3, bestCaucasian
 *  (skipped when Caucasian IS the chosen population); else step 4, the best study of every other people population
 *  (otherPopulations: never the clinician's own norm sets, AUTO-Q11). Flagged 'auto-fallback'; the source line names the
 *  population that had none; `auto` says which step, which population and who. null when none has the measurement. */
function autoFallback(q: NormQuery, popId: string): Hit | null {
  const free: NormQuery = { ...q, picks: undefined };
  const own = popId === 'analysis-own' ? null : fromSource(free, 'analysis-own');
  let step: AutoNote['step'] = 'analysis-own';
  let used: NormSet | null = null;
  if (!own && popId !== AUTO_POPULATION) { used = bestCaucasian(free); step = 'caucasian'; }
  if (!own && !used) { used = bestStudy(free, otherPopulations(free, [popId, AUTO_POPULATION])); step = 'anywhere'; }
  const hit = own ?? (used ? fromSets(free, [used], true) : null);
  if (!hit) return null;
  const ns = rowsUsed(hit, q.sets.find((s) => s.id === hit.setId) ?? null).map((r) => r.n);
  const populationWords = noNormLabel(popId, q.analysisId);
  hit.flags.push('auto-fallback');
  hit.sourceLine += ` · Auto (no ${populationWords} norm)`;
  hit.auto = {
    population: popId, populationWords, step,
    usedPopulation: used ? used.population.label.split(' (')[0] : null,
    source: used ? `${shortCitation(used)}${placeWords(used)}` : `${noNormLabel('analysis-own', q.analysisId)} norm`,
    n: ns.some((n) => n === null) ? null : ns.reduce((sum: number, n) => sum + (n as number), 0),
  };
  return hit;
}

/** A set's place in a few words, to tell samples of one paper apart: " Ann Arbor", " Cleveland", " Burlington",
 *  " Beijing" (a region's text up to its first comma or bracket). */
const placeWords = (s: NormSet) => {
  const p = s.population.region ?? s.population.country;
  return p ? ` ${p.split(/[,(]/)[0].trim()}` : '';
};

/** Step 4's candidates (owner AUTO-Q6): every people population holding a usable set, minus `exclude` — never the
 *  analyses' own norms (an analysis's own norm is step 2, and only its own analysis's) and never the clinician's own
 *  norm sets (AUTO-Q11: not studies; NORM-PICK-1 keeps them a deliberate choice). */
export function otherPopulations(q: NormQuery, exclude: string[]): string[] {
  return populationsOffered(q.sets, []).map((p) => p.id).filter((id) => id !== 'analysis-own' && !exclude.includes(id));
}

/** Owner rulings R1/R5 (3 Nov 2026; spec 2026-11-03): the population id Auto gives an adult with no background and no
 *  clinic default. Not a population in populations.json and never stored on a case (the case stores 'auto'). */
export const COMBINED_ADULT = 'combined-adult';
/** Its words: "no combined adult norm", the report's "combined adult norms". */
export const COMBINED_ADULT_LABEL = 'combined adult';

/** One sex's combined norm: the pool at true size, combined (NAP-P1 (a)); null when no adult study has it. */
function combinedForSex(q: NormQuery, sex: 'M' | 'F'): { pool: PoolRow[]; mean: number; sd: number; n: number; flags: NormFlag[] } | null {
  const pool = adultPool(q.sets, q.measurement, sex);
  if (!pool.length) return null;
  const flags: NormFlag[] = [];
  const groups = pool.map((p) => {
    const s = applyFilmScale(p.entry, p.set);
    if (s.flag && !flags.includes(s.flag)) flags.push(s.flag);
    return { n: p.n, mean: s.mean!, sd: s.sd! };
  });
  const g = combineGroups(groups);
  return { pool, ...g, flags };
}

const poolWho = (pool: PoolRow[]) => pool.map((p) => `${shortCitation(p.set)}${placeWords(p.set)}`).join(', ');
const adultWords = (sex: 'M' | 'F') => (sex === 'M' ? 'men' : 'women');

/** Spec 2026-11-03 §5–§8: the combined adult norm for this measurement and patient (rulings R1/R5, NAP-P1 (a), P2 (a),
 *  P3 (b)). Two studies or more for the sex: the combined norm (flag 'combined-adult'). One: that study's own row (flag
 *  'single-study' and an Auto note, so it is marked ◆). None: null — the caller's Auto fall-back. Sex not recorded:
 *  the men's and the women's results averaged as SEX-AVG-1 averages two rows; null unless both sexes have one. */
function fromCombined(q: NormQuery): Hit | null {
  const sexes: ('M' | 'F')[] = q.sex ? [q.sex] : ['M', 'F'];
  const parts = sexes.map((sex) => ({ sex, c: combinedForSex(q, sex) }));
  if (parts.some((p) => !p.c)) return null;
  const all = parts.map((p) => ({ sex: p.sex, ...p.c! }));
  const single = all.some((p) => p.pool.length < 2);
  const adultAssumed = q.ageYears === null;
  const ageFlag: NormFlag = q.filmDateMissing ? 'film-date-missing' : 'age-assumed-adult';
  const ageWords = q.filmDateMissing ? FILM_DATE_MISSING_WORDS : AGE_NOT_ENTERED_WORDS;
  const singleNote = (set: NormSet, n: number | null): AutoNote => ({ population: COMBINED_ADULT, populationWords: COMBINED_ADULT_LABEL, step: 'single-study',
    usedPopulation: set.population.label.split(' (')[0], source: `${shortCitation(set)}${placeWords(set)}`, n });
  const SINGLE_WORDS = ' · single study: fewer than 2 adult studies have this';

  if (q.sex && single) {
    // One study for this sex: its own row, exactly as that study is shown anywhere else.
    const p = all[0].pool[0];
    const hit = build(q, p.set, { entry: p.entry, ageMismatched: false });
    hit.flags.push('single-study', 'auto-fallback');
    hit.sourceLine += SINGLE_WORDS;
    // Final review M3: a both-sexes row's own people (the Auto note quotes the row compared with, FR-1).
    hit.auto = singleNote(p.set, p.bothSexes ? p.entry.n ?? null : p.n);
    return hit;
  }

  const flags: NormFlag[] = ['combined-adult'];
  const flag = (f: NormFlag) => { if (!flags.includes(f)) flags.push(f); };
  const pools = all.flatMap((p) => p.pool);
  const close = (pool: PoolRow[]) => pool.filter((p) => p.entry.definitionMatch === 'close').length;
  if (pools.some((p) => p.entry.definitionMatch === 'close')) flag('close');
  if (pools.some((p) => p.set.secondHand)) flag('second-hand');
  all.forEach((p) => p.flags.forEach(flag));
  let mean: number, sd: number;
  if (all.length === 1) ({ mean, sd } = all[0]);
  else {
    const [m, f] = all;
    mean = (m.mean + f.mean) / 2;
    sd = Math.sqrt((m.sd ** 2 + f.sd ** 2) / 2 + ((m.mean - f.mean) / 2) ** 2);   // SEX-AVG-1, as averageSexes
    flag('sexes-averaged');
  }
  // Final review M2: a single-study row is Auto's ◆ answer, so it can be chosen like any other ◆ row.
  if (single) { flag('single-study'); flag('auto-fallback'); }
  if (adultAssumed) flag(ageFlag);
  const n = all.reduce((a, p) => a + p.n, 0);
  const closeWords = all.map((p) => close(p.pool) ? `${close(p.pool)} of ${p.pool.length} studies${all.length > 1 ? ` (${adultWords(p.sex)})` : ''} measured it a little differently` : null).filter(Boolean);
  const unit = all[0].pool[0].entry.unit;
  const entry: NormEntry = { measurement: q.measurement, sex: q.sex ?? 'pooled', ageBand: [18, 99], mean, sd, n, unit, source: 'combined adult norm',
    definitionMatch: closeWords.length ? 'close' : 'same', ...(closeWords.length ? { definitionNote: closeWords.join('; ') } : {}) };
  const heads = all.map((p) => `${adultWords(p.sex)}: ${p.pool.length} ${p.pool.length === 1 ? 'study' : 'studies'}, ${p.n} people (${poolWho(p.pool)})`);
  let line = `Combined adult norm, ${heads.join('; ')}`;
  if (closeWords.length) line += ` · ${closeWords.join('; ')}`;
  // Final review M1: say when a crowd includes rows printed for men and women together (angles, % and ratios only).
  const bothWords = all.map((p) => { const j = p.pool.filter((r) => r.bothSexes).length; return j ? `${j} of ${p.pool.length} studies${all.length > 1 ? ` (${adultWords(p.sex)})` : ''} give men and women together` : null; }).filter(Boolean);
  if (bothWords.length) line += ` · ${bothWords.join('; ')}`;
  if (flags.includes('converted-to-true-size')) line += ' · mm converted to true size where a paper\'s films were enlarged';
  if (flags.includes('scale-assumed')) line += ' · film scale not stated in the paper; assumed true size, as modern papers report';
  const second = [...new Set(pools.filter((p) => p.set.secondHand).map((p) => `${shortCitation(p.set)} via ${p.set.secondHand!.via}`))];
  if (second.length) line += ` · quoted second-hand: ${second.join('; ')}`;
  if (all.length > 1) line += ' · average of male and female (sex not recorded)';
  if (single) line += SINGLE_WORDS;
  if (adultAssumed) line += ` · ${ageWords}`;
  const hit: Hit = { kind: 'norm', setId: COMBINED_ADULT, entry, mean, sd, range: null, printed: null, colour: true, flags, sourceLine: line,
    ageRowUsed: bandLabel([18, 99]), sdDonor: null };
  if (single) {
    const one = all.find((p) => p.pool.length < 2)!.pool[0];
    hit.auto = singleNote(one.set, null);
  }
  return hit;
}

// ---------------------------------------------------------------------------------------------

type Hit = Extract<Resolved, { kind: 'norm' }>;

const byName = (a: string, b: string) => a.localeCompare(b);

function populationLabel(popId: string): string {
  if (popId === COMBINED_ADULT) return COMBINED_ADULT_LABEL;
  if (popId.startsWith(USER_PREFIX)) return `${popId.slice(USER_PREFIX.length)} (your norms)`;
  return POPULATIONS.find((p) => p.id === popId)?.label ?? popId;
}

/** Owner B3 (17 Oct 2026, "My analysis"): a measurement no built-in analysis lists is resolved with analysisId '' —
 *  it has no analysis's own norm, and the words say so. Words only: no Resolved value changes. */
export const NO_ANALYSIS_LABEL = 'built-in analysis';

/** What a population is called in "no <…> norm": its label; the analysis's own norms by the analysis ("Steiner's own"). */
function noNormLabel(popId: string, analysisId: string): string {
  if (popId !== 'analysis-own') return populationLabel(popId);
  return analysisId ? `${analysisName(analysisId)}'s own` : NO_ANALYSIS_LABEL;
}

/** One source resolved as the chosen population, with no fallback: a user-norm set, the analysis's own norms, or a
 *  population's sets (nearest age on, AGE-2). */
function fromSource(q: NormQuery, popId: string): Hit | null {
  if (popId === COMBINED_ADULT) return fromCombined(q);
  return popId.startsWith(USER_PREFIX)
    ? fromUserNorms(q, q.userNorms.filter((u) => u.setName === popId.slice(USER_PREFIX.length)))
    : fromSets(q, setsOfPopulation(q, popId), popId !== 'analysis-own');
}

function analysisName(id: string): string {
  return ALL_ANALYSES.find((a) => a.id === id)?.name ?? id;
}

/** Rule 2: pending sets never; research-SD sets only lend SDs. The 'analysis-own' population holds
 *  every analysis's own norms, so only this analysis's are taken from it. */
function setsOfPopulation(q: NormQuery, popId: string): NormSet[] {
  if (popId === 'analysis-own') return ownSets(q);
  return q.sets.filter((s) => s.population.id === popId && s.status !== 'pending' && s.kind !== 'research-sd');
}

function ownSets(q: NormQuery): NormSet[] {
  return q.sets.filter((s) => s.kind === 'analysis-own' && s.status !== 'pending' && (s.analyses ?? []).includes(q.analysisId));
}

/** Rule 5 (after demoting website sets, so a paper always beats a website for the same value, and
 *  then mixed-occlusion treatment samples, P37): class-I-balanced first, then the larger sample, then a first-hand
 *  source before a second-hand restatement (owner FIRSTHAND-1, 13 Oct: a set with `secondHand` ranks after one
 *  without; placed before the year), then the later paper.
 *  fromSets applies the website and treatment demotions first (owner P37-FIRST, 12 Oct), then age
 *  coverage (AGE-1) and nearest age (AGE-2), and only then this order within each group. */
function rankSets(a: NormSet, b: NormSet): number {
  const web = (s: NormSet) => (s.status === 'website' ? 1 : 0);
  // P37 (Task 7 fix round 1): consecutive treatment-seeking patients are not a norm — such a sample
  // ranks after every other selection, and is used only when no other set has the measurement
  // (fromSets demotes it before age coverage too, owner P37-FIRST).
  const treat = (s: NormSet) => (s.selection === 'mixed-occlusion' ? 1 : 0);
  const bal = (s: NormSet) => (s.selection === 'class-I-balanced' ? 0 : 1);
  const hand = (s: NormSet) => (s.secondHand ? 1 : 0); // FIRSTHAND-1
  // Review I-3 (24 Oct 2026, no owner ruling needed): without a final key, two sets tied on every
  // rule above returned 0 here, and the stable sort then kept them in whatever order q.sets happened to arrive in
  // (both inside fromSets/orderSets, and — through orderSets — inside bestStudy's usual.indexOf tiebreak). The set
  // id makes the order the same every time, for any input order.
  return web(a) - web(b) || treat(a) - treat(b) || bal(a) - bal(b) || (b.sample.n ?? 0) - (a.sample.n ?? 0) || hand(a) - hand(b) || byYear(a, b) || a.id.localeCompare(b.id);
}

/** Later paper first; an undated source (no year) after every dated one; two undated sets tie. */
export function byYear(a: NormSet, b: NormSet): number {
  const ya = a.citation.undated ? null : a.citation.year ?? null;
  const yb = b.citation.undated ? null : b.citation.year ?? null;
  if (ya === null && yb === null) return 0;
  if (ya === null) return 1;
  if (yb === null) return -1;
  return yb - ya;
}

/** Owner AGE-1 (Task 9a-1 fix round 1): does this set hold a row for the measurement, for the
 *  patient's own sex or pooled (an unknown sex: pooled, or a men's and women's pair at one band — rowsForSex,
 *  SEX-AVG-1), whose age band contains the patient's
 *  age in completed years? For an 'interpolate' set: is the age inside its printed-age span (first to
 *  last printed age), or past an open last row? A band-less row does not "cover" (it does not say
 *  which ages it holds for). Age unknown (owner AGE-UNK-1, 12 Oct: assume an adult) → does the set have an adult
 *  row (hasAdultRow); sets with one rank first, then rule 5 as before. */
function coversAge(set: NormSet, q: NormQuery): boolean {
  if (q.ageYears === null) return hasAdultRow(set, q);
  const rows = rowsForSex(set, q);
  if (rows.length === 0) return false;
  if (set.ageRows === 'interpolate') {
    const starts = rows.map((e) => e.ageBand![0]);
    const first = Math.min(...starts);
    const last = Math.max(...starts);
    const lastOpen = rows.some((e) => e.ageBand![0] === last && e.ageBand![1] >= 99);
    return q.ageYears >= first && (q.ageYears <= last || lastOpen);
  }
  const whole = Math.floor(q.ageYears);
  return rows.some((e) => e.ageBand![0] <= whole && whole <= e.ageBand![1]);
}

/** Owner AGE-UNK-1 (12 Oct): with no age entered, does this set hold an adult row for the measurement — a band
 *  starting at 18 or more, or reaching past 18 (open adult rows, and AGE-3's bands spanning 18; [15, 18] does not), or
 *  a row with no band (it holds for every age) — among the rows this patient can use: own sex or pooled; sex not
 *  recorded, pooled or an age both sexes printed (pairedEntries, SEX-AVG-1/T3-3). */
function hasAdultRow(set: NormSet, q: NormQuery): boolean {
  const rows = q.sex !== null
    ? set.entries.filter((e) => e.measurement === q.measurement && e.definitionMatch !== 'different' && (e.sex === 'pooled' || e.sex === q.sex))
    : pairedEntries(set.entries, q.measurement);
  return rows.some((e) => !e.ageBand || e.ageBand[0] >= 18 || e.ageBand[1] > 18);
}

/** Owner AGE-2 (8 Oct, "the nearest age"): the completed-year distance (P12, yearsOutside) from the
 *  patient's age to this set's nearest usable band for the measurement (own sex or pooled; an unknown
 *  sex, pooled or a men's and women's pair at one band — rowsForSex, SEX-AVG-1; not 'different'). No banded usable row → Infinity (it says nothing about age, so
 *  it ranks after every set that has a band). Age unknown → 0 for every set (rule 5 alone). */
function nearestBandDistance(set: NormSet, q: NormQuery): number {
  if (q.ageYears === null) return 0;
  const whole = Math.floor(q.ageYears);
  const rows = rowsForSex(set, q);
  return rows.length === 0 ? Infinity : Math.min(...rows.map((e) => yearsOutside(e.ageBand!, whole)));
}

/** Owner decision 1 (29 Oct 2026): a minimal query for one measurement of a patient of this sex and age. */
const patientQ = (measurement: string, sex: 'M' | 'F' | null, ageYears: number | null): NormQuery =>
  ({ measurement, analysisId: '', population: null, clinicDefault: null, sex, ageYears, sets: [], userNorms: [] });
/** Owner decision 1 (29 Oct 2026): does the set hold, for ANY measurement, a row this patient can use at their age
 *  (coversAge: AGE-1, AGE-UNK-1, SEX-AVG-1's pairs for an unknown sex)? */
export function setCoversPatient(set: NormSet, sex: 'M' | 'F' | null, ageYears: number | null): boolean {
  return [...new Set(set.entries.map((e) => e.measurement))].some((m) => coversAge(set, patientQ(m, sex, ageYears)));
}
/** The nearest completed-year distance from the patient's age to any usable banded row of the set (AGE-2). */
export function setNearestAge(set: NormSet, sex: 'M' | 'F' | null, ageYears: number | null): number {
  return Math.min(...[...new Set(set.entries.map((e) => e.measurement))].map((m) => nearestBandDistance(set, patientQ(m, sex, ageYears))));
}

/** The order a population's sets are tried in (one wording everywhere, owner P37-FIRST 12 Oct): website sets last (a
 *  paper always beats a website, P14a); treatment-seeking samples last (P37) — BEFORE age coverage, so a treatment
 *  sample is used only when no other set has the measurement; then AGE-1 ("age first, then sample quality"): a set that
 *  covers the patient's age ranks before one that does not; AGE-2 (`nearest`, people's populations only): among the sets
 *  that do not cover it, the nearest band first; rule 5 (rankSets) orders what is left tied. */
function orderSets(q: NormQuery, sets: NormSet[], nearest: boolean): NormSet[] {
  const web = (s: NormSet) => (s.status === 'website' ? 1 : 0);
  const treat = (s: NormSet) => (s.selection === 'mixed-occlusion' ? 1 : 0);
  const cover = new Map(sets.map((s) => [s, coversAge(s, q) ? 0 : 1]));
  const dist = new Map(sets.map((s) => [s, nearest && cover.get(s) === 1 ? nearestBandDistance(s, q) : 0]));
  const byDist = (a: NormSet, b: NormSet) => {
    const da = dist.get(a)!, db = dist.get(b)!;
    return da === db ? 0 : da < db ? -1 : 1; // Infinity − Infinity is NaN, so compare, never subtract
  };
  const order = (a: NormSet, b: NormSet) => web(a) - web(b) || treat(a) - treat(b) || cover.get(a)! - cover.get(b)! || byDist(a, b) || rankSets(a, b);
  return [...sets].sort(order);
}

/** `nearest` (owner AGE-2) is on for a people population, off for the analyses' own norms (not a
 *  population; their order is left as it was). */
function fromSets(q: NormQuery, sets: NormSet[], nearest = false): Hit | null {
  for (const set of orderSets(q, sets, nearest)) {
    const pick = pickForSet(set, q);
    if (pick) return build(q, set, pick);
  }
  return null;
}

interface RowPick {
  entry: NormEntry;
  ageMismatched: boolean;
  /** Review Important #2 (Task 7 fix round 1): age unknown and no adult row — the oldest band stood in. */
  oldestFallback?: boolean;
  /** Owner R-1 (P38): the entry was interpolated at `age` between the printed ages a and b. */
  interpolated?: { age: number; a: number; b: number };
  /** Owner SEX-AVG-1 (12 Oct): sex not recorded; the men's and women's rows at this age were averaged. */
  averaged?: true;
}

/** Owner SEX-AVG-1 (12 Oct): banded rows usable for an unknown sex are pooled rows, plus men's and women's rows where
 *  both sexes have a row with that band (they will be averaged). A known sex: own sex or pooled, as before. */
function rowsForSex(set: NormSet, q: NormQuery): NormEntry[] {
  if (q.sex !== null) {
    return set.entries.filter((e) => e.measurement === q.measurement && e.definitionMatch !== 'different' && e.ageBand && (e.sex === 'pooled' || e.sex === q.sex));
  }
  return pairedEntries(set.entries, q.measurement).filter((e) => e.ageBand);
}

/** Ruling T3-3 (fix round 1): the rows an unknown sex can use — pooled rows, and men's and women's rows only at an
 *  age (band, or no band) where BOTH sexes have a row. A row one sex alone has (Miao 1995 prints interincisal for girls
 *  at 13 but boys only at 9) is never a candidate, so each sex's pick lands on a shared age and the pair can be averaged,
 *  in the same set a man or a woman would get. */
function pairedEntries(entries: NormEntry[], measurement: string): NormEntry[] {
  const all = entries.filter((e) => e.measurement === measurement && e.definitionMatch !== 'different');
  const key = (e: NormEntry) => e.ageBand?.join('-') ?? '';
  const men = new Set(all.filter((e) => e.sex === 'M').map(key)), women = new Set(all.filter((e) => e.sex === 'F').map(key));
  return all.filter((e) => e.sex === 'pooled' || (men.has(key(e)) && women.has(key(e))));
}

/** The row for one set: the patient's own (pickRow / pickInterpolated, unchanged) — except, with the sex not recorded,
 *  when the set has a men's and a women's row at the same age (each sex interpolated first) and no row for both sexes
 *  at that age: then the two are averaged (owner SEX-AVG-1, 12 Oct). */
function pickForSet(set: NormSet, q: NormQuery): RowPick | null {
  const pick = (sex: 'M' | 'F' | null) =>
    set.ageRows === 'interpolate' && q.ageYears !== null ? pickInterpolated(set.entries, q.measurement, sex, q.ageYears) : pickRow(set.entries, q.measurement, sex, q.ageYears);
  const own = pick(q.sex);
  if (q.sex !== null) return own;
  if (own && !own.ageMismatched) return own;                      // P7: a both-sexes row for this age always wins
  // T3-3: each sex picks among the ages both sexes printed (pairedEntries), by the normal rules.
  const paired = pairedEntries(set.entries, q.measurement);
  const pickPaired = (sex: 'M' | 'F') =>
    set.ageRows === 'interpolate' && q.ageYears !== null ? pickInterpolated(paired, q.measurement, sex, q.ageYears) : pickRow(paired, q.measurement, sex, q.ageYears);
  const m = pickPaired('M'), f = pickPaired('F');
  // P7: pickPaired('M')/('F') already take a nearer both-sexes row over a farther own-sex one, so a nearer
  // pooled row shows up here as a non-M/F pick and wins (sexavg.test.ts 'P7: … farther' fails without this line).
  if (!m || !f || m.entry.sex !== 'M' || f.entry.sex !== 'F' || !sameAgeRow(m, f)) return own;
  // P7 / ruling T3-1: never a pair over a both-sexes row at least as near — at equal distance (e.g. pooled, men's
  // and women's rows printed for the same band, the patient outside it) the paper's own both-sexes figure wins.
  if (own && ageDistance(own, q) <= ageDistance(m, q)) return own;
  if (m.entry.fromOtherSex) return m;                             // P9: a copy is not a second sex's data —
  if (f.entry.fromOtherSex) return f;                             //     use it as that sex gets it, flagged other-sex-values
  return averageSexes(m, f);
}

/** Completed years between the patient's age and the row used (0 when the row is for the age); age unknown and
 *  mismatched → Infinity, so an adult pair beats a child stand-in. */
const ageDistance = (p: RowPick, q: NormQuery) =>
  !p.ageMismatched ? 0 : q.ageYears === null || !p.entry.ageBand ? Infinity : yearsOutside(p.entry.ageBand, Math.floor(q.ageYears));

// Final review M-1 (defensive): averageSexes takes the age flags from the men's row, so the two rows must agree on the
// oldest-row stand-in too — not reachable today (both picks run over pairedEntries), guarded so it stays that way.
const sameAgeRow = (a: RowPick, b: RowPick) =>
  a.ageMismatched === b.ageMismatched && !!a.oldestFallback === !!b.oldestFallback &&
  (a.interpolated ? !!b.interpolated && a.interpolated.a === b.interpolated.a && a.interpolated.b === b.interpolated.b : !b.interpolated && sameBand(a.entry, b.entry));

/** Mean = (men + women)/2; SD = √((sd_m² + sd_w²)/2 + ((mean_m − mean_w)/2)²), the spread of an equal-sized mixed group,
 *  only when both rows have mean and SD and neither borrows it from another paper unless both borrow from the same set
 *  (else none: the borrowed-SD path runs, P11/T3-2); range ends averaged; ideals stay ideals. */
function averageSexes(m: RowPick, f: RowPick): RowPick {
  const a = m.entry, b = f.entry;
  const mean = a.mean != null && b.mean != null ? (a.mean + b.mean) / 2 : undefined;
  // P11 / ruling T3-2: an SD either row takes from another paper is mixed in only when BOTH take it from the same
  // set (then the sdSource stays with the average); otherwise the average has no SD and the borrowed-SD path runs.
  const sameLender = !!a.sdSource && !!b.sdSource && a.sdSource.set === b.sdSource.set;
  const sdUsable = sameLender || (!a.sdSource && !b.sdSource);
  const sd = sdUsable && a.sd != null && b.sd != null && a.mean != null && b.mean != null
    ? Math.sqrt((a.sd ** 2 + b.sd ** 2) / 2 + ((a.mean - b.mean) / 2) ** 2) : undefined;
  const range = a.range && b.range ? { low: (a.range.low + b.range.low) / 2, high: (a.range.high + b.range.high) / 2 } : undefined;
  // Review M-4: where the two rows' words differ, both are kept, each named — never the men's alone.
  const both = (x?: string, y?: string) => (x === y ? x : [x ? `men's row: ${x}` : null, y ? `women's row: ${y}` : null].filter(Boolean).join('; ') || undefined);
  const closeNote = both(a.definitionMatch === 'close' ? a.definitionNote : undefined, b.definitionMatch === 'close' ? b.definitionNote : undefined);
  const target = both(a.clinicalTarget, b.clinicalTarget);
  const entry: NormEntry = {
    measurement: a.measurement, sex: 'pooled', ...(a.ageBand ? { ageBand: a.ageBand } : {}),
    ...(mean !== undefined ? { mean } : {}), ...(sd !== undefined ? { sd } : {}), ...(range ? { range } : {}),
    ...(a.n != null && b.n != null ? { n: a.n + b.n } : {}), unit: a.unit,
    source: a.source === b.source ? a.source : `${a.source}; ${b.source}`,
    definitionMatch: a.definitionMatch === 'close' || b.definitionMatch === 'close' ? 'close' : 'same', ...(closeNote ? { definitionNote: closeNote } : {}),
    ...(a.centre === 'ideal' || b.centre === 'ideal' ? { centre: 'ideal' as const } : {}),
    ...(target ? { clinicalTarget: target } : {}),
    // P11: an SD both rows take from the same other paper stays with the average (as pickInterpolated does, M-6).
    ...(sameLender && a.sdSource && b.sdSource
      ? { sdSource: { set: a.sdSource.set, source: a.sdSource.source === b.sdSource.source ? a.sdSource.source : `${a.sdSource.source}; ${b.sdSource.source}` } } : {}),
  };
  return { entry, ageMismatched: m.ageMismatched, ...(m.oldestFallback ? { oldestFallback: true } : {}), ...(m.interpolated ? { interpolated: m.interpolated } : {}), averaged: true };
}

const fmtAge = (age: number) => (Number.isInteger(age) ? `${age}` : `${Math.round(age * 10) / 10}`);

/** Owner R-1 (ruling P38), order corrected by P39 (Task 7 fix round 3): rows of an 'interpolate' set
 *  are printed ages ([a, a]; an open adult row [a, 99] is the point a and holds beyond it). The
 *  patient's series takes, at each printed age, the own-sex row if there is one, else the pooled row
 *  (never the other sex; an unknown sex takes pooled only). The AGE decides first, exactly as pickRow
 *  documents below it: 1. the series covers the age (at or between its first and last point, or past
 *  an OPEN last row) → use it — exactly on a printed age, that row; between two, linear interpolation
 *  of mean, SD and the range ends, each only when BOTH rows have it (an SD on one row only gives no
 *  SD, never a mixed one); 2. else, if the patient's sex has no banded rows of its own and has a
 *  band-less row → that row, unflagged (rule 4/P13, carried into interpolated sets); 3. else the end
 *  row, flagged age-mismatched (no extrapolation). A measurement with no banded rows falls back to
 *  pickRow. */
function pickInterpolated(entries: NormEntry[], measurement: string, sex: 'M' | 'F' | null, age: number): RowPick | null {
  const rows = entries.filter(
    (e) => e.measurement === measurement && e.definitionMatch !== 'different' && (e.sex === 'pooled' || (sex !== null && e.sex === sex)),
  );
  if (!rows.some((e) => e.ageBand)) return pickRow(entries, measurement, sex, age);
  const byAge = new Map<number, NormEntry>();
  for (const e of rows.filter((r) => r.ageBand)) {
    const a = e.ageBand![0];
    const have = byAge.get(a);
    if (!have || (have.sex === 'pooled' && e.sex !== 'pooled')) byAge.set(a, e);
  }
  const series = [...byAge.entries()].sort((x, y) => x[0] - y[0]);
  const open = (e: NormEntry) => e.ageBand![1] >= 99;
  const lastOpen = open(series[series.length - 1][1]);
  const covered = age >= series[0][0] && (age <= series[series.length - 1][0] || lastOpen);
  // Rule 4/P13, carried into interpolated sets (Task 7 fix round 2, order fixed by P39 fix round 3):
  // only when the series does NOT cover the age does a band-less row of a sex that has no age bands
  // of its own (it covers every age; no flag) stand in — the same rule pickRow applies outside
  // 'interpolate' sets. Pooled rows always have bands in these sets, so this only ever stands in for
  // a sex-specific band-less row.
  if (!covered && sex !== null) {
    const ownBanded = rows.some((e) => e.sex === sex && e.ageBand);
    if (!ownBanded) {
      const ownBandless = rows.find((e) => e.sex === sex && !e.ageBand);
      if (ownBandless) return { entry: ownBandless, ageMismatched: false };
    }
  }
  if (age < series[0][0]) return { entry: series[0][1], ageMismatched: true };
  const exact = series.find(([a]) => a === age);
  if (exact) return { entry: exact[1], ageMismatched: false };
  const hiIdx = series.findIndex(([a]) => a > age);
  if (hiIdx === -1) {
    const last = series[series.length - 1][1];
    return { entry: last, ageMismatched: !open(last) };
  }
  const [a, lo] = series[hiIdx - 1];
  const [b, hi] = series[hiIdx];
  const t = (age - a) / (b - a);
  const lerp = (x: number, y: number) => x + t * (y - x);
  const sexed = lo.sex !== 'pooled' ? lo : hi.sex !== 'pooled' ? hi : lo;
  const other = lo.fromOtherSex ? lo : hi.fromOtherSex ? hi : null;
  const close = lo.definitionMatch === 'close' ? lo : hi.definitionMatch === 'close' ? hi : null;
  const entry: NormEntry = {
    measurement,
    sex: sexed.sex,
    ageBand: [a, b],
    unit: lo.unit,
    source: `${lo.source}; ${hi.source}`,
    definitionMatch: close ? 'close' : 'same',
  };
  if (close?.definitionNote) entry.definitionNote = close.definitionNote;
  if (lo.mean != null && hi.mean != null) entry.mean = lerp(lo.mean, hi.mean);
  if (lo.sd != null && hi.sd != null) entry.sd = lerp(lo.sd, hi.sd);
  if (lo.range && hi.range) entry.range = { low: lerp(lo.range.low, hi.range.low), high: lerp(lo.range.high, hi.range.high) };
  if (entry.sd === undefined && (lo.centre === 'ideal' || hi.centre === 'ideal')) entry.centre = 'ideal';
  else if (lo.centre === 'ideal' && hi.centre === 'ideal') entry.centre = 'ideal';
  if (other) {
    entry.fromOtherSex = other.fromOtherSex;
    entry.note = other.note;
  }
  if (lo.clinicalTarget ?? hi.clinicalTarget) entry.clinicalTarget = lo.clinicalTarget ?? hi.clinicalTarget;
  // Final review M-6: an SD taken from another paper (sdSource) stays with the interpolated row when
  // both printed rows name the same lending set; otherwise the row would silently switch to a rule-15 donor.
  if (lo.sdSource && hi.sdSource && lo.sdSource.set === hi.sdSource.set) {
    entry.sdSource = { set: lo.sdSource.set, source: lo.sdSource.source === hi.sdSource.source ? lo.sdSource.source : `${lo.sdSource.source}; ${hi.sdSource.source}` };
  }
  return { entry, ageMismatched: false, interpolated: { age, a, b } };
}

/** P35: an open adult band (high end 99 or more) reads "13 y and over", never "13–99 y". */
const bandLabel = (b: [number, number]) => (b[1] >= 99 ? `${b[0]} y and over` : b[0] === b[1] ? `${b[0]} y` : `${b[0]}–${b[1]} y`);

/** P12: completed years between an age and a band (0 inside it). The one age-distance rule, used by
 *  pickRow's nearest band and by the SD-donor search (rule 15). */
const yearsOutside = (band: [number, number], whole: number) => (whole < band[0] ? band[0] - whole : Math.max(0, whole - band[1]));

/** Rules 2–4 within one set. Rows usable: this measurement, definition not 'different', and the
 *  patient's own sex or pooled (an unknown sex takes pooled only) — the other sex's row is never
 *  a candidate. The age decides first (N2), then own sex beats pooled. Bands are in completed
 *  years: 14.99 is in 11–14.
 *  Age known (P12/P13):
 *    1. a band containing the age;
 *    2. else a band-less row of a sex that has no bands of its own (it covers every age; no flag);
 *    3. else the nearest band by completed-year distance (a tie → the older band), flagged age-mismatched.
 *  Age unknown: the adult row — a band starting at 18 or more or an open adult band, else a band-less row (unflagged), else
 *  the oldest band, flagged age-mismatched and said (Task 7 fix round 1) — unless that band spans 18
 *  (low < 18 < high), which is an adult row, unflagged (owner AGE-3).
 *  A set with no bands for this measurement: the own-sex row, else pooled; never flagged. */
function pickRow(entries: NormEntry[], measurement: string, sex: 'M' | 'F' | null, age: number | null): RowPick | null {
  const rows = entries.filter(
    (e) => e.measurement === measurement && e.definitionMatch !== 'different' && (e.sex === 'pooled' || (sex !== null && e.sex === sex)),
  );
  if (rows.length === 0) return null;
  const sexRank = (e: NormEntry) => (e.sex === 'pooled' ? 1 : 0);
  const best = (rs: NormEntry[], tie: (a: NormEntry, b: NormEntry) => number = () => 0) =>
    rs.length === 0 ? null : [...rs].sort((a, b) => sexRank(a) - sexRank(b) || tie(a, b))[0];
  const older = (a: NormEntry, b: NormEntry) => b.ageBand![1] - a.ageBand![1] || b.ageBand![0] - a.ageBand![0];

  const banded = rows.filter((e) => e.ageBand);
  const bandless = rows.filter((e) => !e.ageBand);
  if (banded.length === 0) return { entry: best(rows)!, ageMismatched: false };

  if (age !== null) {
    const whole = Math.floor(age);
    const contained = best(banded.filter((e) => e.ageBand![0] <= whole && whole <= e.ageBand![1]));
    if (contained) return { entry: contained, ageMismatched: false };
    const bandedSexes = new Set(banded.map((e) => e.sex));
    const free = best(bandless.filter((e) => !bandedSexes.has(e.sex)));
    if (free) return { entry: free, ageMismatched: false };
    const distance = (e: NormEntry) => yearsOutside(e.ageBand!, whole);
    const nearest = [...banded].sort((a, b) => distance(a) - distance(b) || older(a, b) || sexRank(a) - sexRank(b))[0];
    return { entry: nearest, ageMismatched: true };
  }

  // An adult row: a band starting at 18 or more, or an open adult band ("13 y and over", high end >= 99).
  const adult = best(banded.filter((e) => e.ageBand![0] >= 18 || e.ageBand![1] >= 99), (a, b) => a.ageBand![0] - b.ageBand![0]);
  if (adult) return { entry: adult, ageMismatched: false };
  const anyAge = best(bandless);
  if (anyAge) return { entry: anyAge, ageMismatched: false };
  // Review Important #2 (Task 7 fix round 1): a child's row standing in for an unknown age is flagged and said.
  const oldest = [...banded].sort((a, b) => older(a, b) || sexRank(a) - sexRank(b))[0];
  // Owner AGE-3 (8 Oct, "no warning for those"): a band that spans 18 (low < 18 < high, e.g. 16–30)
  // holds adults, so it is the adult row — same row, no flag, nothing said. [15, 18] and [15, 15] do not.
  if (oldest.ageBand![0] < 18 && oldest.ageBand![1] > 18) return { entry: oldest, ageMismatched: false };
  return { entry: oldest, ageMismatched: true, oldestFallback: true };
}

interface BorrowedSd {
  sd: number;
  set: NormSet | null;
  row: NormEntry | null; // the source row used; null when the entry carries the copied SD itself
}

const sameBand = (a: NormEntry, b: NormEntry) => (a.ageBand?.join('-') ?? '') === (b.ageBand?.join('-') ?? '');

/** The SD an entry borrows through sdSource (N3). When the entry carries `sd` itself, that copied
 *  value is used and sdSource only says where it came from. Otherwise the row is looked up in the
 *  source set, which must be neither pending nor a website set. The row must hold an SD, must not be
 *  'different', and must be the entry's own sex or pooled — never another sex, whatever the
 *  patient's sex. The same sex and band as the entry come first. No acceptable row → no SD. */
function borrowedSd(q: NormQuery, e: NormEntry): BorrowedSd | null {
  if (!e.sdSource) return null;
  const src = q.sets.find((s) => s.id === e.sdSource!.set) ?? null;
  if (e.sd != null) return { sd: e.sd, set: src, row: null }; // P32: a stray sd: null is no SD
  if (!src || src.status === 'pending' || src.status === 'website') return null;
  const rows = src.entries.filter(
    (r) => r.measurement === e.measurement && r.definitionMatch !== 'different' && r.sd != null && (r.sex === e.sex || r.sex === 'pooled'),
  );
  const rank = (r: NormEntry) => (sameBand(r, e) ? 0 : 2) + (r.sex === e.sex ? 0 : 1);
  const row = [...rows].sort((a, b) => rank(a) - rank(b))[0];
  return row ? { sd: row.sd!, set: src, row } : null;
}

/** "Wu J, Hägg U" → "Wu 2007"; "Al Maaitah E" → "Al Maaitah 2022"; an organisation keeps its whole name;
 *  an undated source reads "NDC (undated)".
 *  The first author's generational suffix (Jr, Jr., Sr, II, III — P35) and then trailing initials
 *  (one to three capitals, hyphenated or not — review M-4) are dropped: "McNamara JA Jr" → "McNamara", "Fu M-K" → "Fu". */
export function shortCitation(set: NormSet): string {
  const firstAuthor = set.citation.authors.split(',')[0].trim();
  const surname = firstAuthor.replace(/\s+(?:Jr|Sr)\.?$|\s+(?:II|III)$/, '').replace(/\s+[A-Z](?:-?[A-Z]){0,2}\.?$/, '');
  return set.citation.undated ? `${surname} (undated)` : `${surname} ${set.citation.year}`;
}

/** P35: the words follow the band — children (high end under 18) boys/girls; adults (low end 18 or
 *  more) men/women; a band that spans 18, open adult bands from below 18 included, males/females. */
function sexWords(e: NormEntry): string {
  const band = e.ageBand;
  const group = !band ? null : band[1] < 18 ? 'child' : band[0] >= 18 ? 'adult' : 'span';
  const words = {
    pooled: { child: 'boys and girls', adult: 'men and women', span: 'males and females' },
    M: { child: 'boys', adult: 'men', span: 'males' },
    F: { child: 'girls', adult: 'women', span: 'females' },
  }[e.sex];
  if (group === null) return e.sex === 'pooled' ? 'sexes pooled' : e.sex === 'M' ? 'male' : 'female';
  return words[group];
}

/** Rules 10-12 (owner M-1/M-2, Task 4b): an mm entry in a set whose film scale is 'enlarged' is
 *  reported at true size (divided by 1 + percent/100); 'not-stated' leaves the value unchanged
 *  but flags the assumption; 'true-size', and every non-mm unit, are never touched. Operates on
 *  the entry's own stored mean/sd/range (not a borrowed sdSource SD, handled separately). */
function applyFilmScale(e: NormEntry, set: NormSet): { mean: number | null; sd: number | null; range: { low: number; high: number } | null; printed: Hit['printed']; flag: NormFlag | null; suffix: string } {
  const ownMean = e.mean ?? null;
  const ownSd = e.sd ?? null;
  const ownRange = e.range ?? null;
  if (e.unit !== 'mm' || set.scale.kind === 'true-size') {
    return { mean: ownMean, sd: ownSd, range: ownRange, printed: null, flag: null, suffix: '' };
  }
  if (set.scale.kind === 'not-stated') {
    return { mean: ownMean, sd: ownSd, range: ownRange, printed: null, flag: 'scale-assumed', suffix: ' · film scale not stated in the paper; assumed true size, as modern papers report' };
  }
  const factor = 1 + set.scale.percent / 100;
  const printed = { mean: ownMean, sd: ownSd, range: ownRange };
  const printedStr = ownMean !== null ? `${ownMean} mm` : ownRange ? `${ownRange.low}–${ownRange.high} mm` : '';
  return {
    mean: ownMean !== null ? ownMean / factor : null,
    sd: ownSd !== null ? ownSd / factor : null,
    range: ownRange ? { low: ownRange.low / factor, high: ownRange.high / factor } : null,
    printed,
    flag: 'converted-to-true-size',
    suffix: ` · converted from ${set.scale.percent}% film enlargement (${set.scale.source}); printed ${printedStr}`,
  };
}

/** The one conversion of a borrowed SD (an sdSource SD, or a rule 15 donor's SD): an mm SD is the
 *  lending paper's printed number, so it is divided by the LENDING set's enlargement (never the
 *  borrowing set's); every other case returns it unchanged. `note` discloses a conversion. */
function sdAtTrueSize(sd: number | null, unit: NormEntry['unit'], lender: NormSet): { sd: number | null; converted: boolean; note: string } {
  // P32: a missing SD stays missing — never divided (null / 1.1 would be 0, a coloured nonsense SD).
  if (sd === null || !Number.isFinite(sd) || unit !== 'mm' || lender.scale.kind !== 'enlarged') return { sd, converted: false, note: '' };
  return { sd: sd / (1 + lender.scale.percent / 100), converted: true, note: ` (converted from ${lender.scale.percent}% film enlargement, printed ${sd} mm)` };
}

interface Donor {
  set: NormSet;
  row: NormEntry;
}

/** Rule 15 (ordered per ruling P31, the owner's B-1 wording, and owner SDLEND-1, 13 Oct): the paper an SD-less entry
 *  borrows its SD from. Candidates: rows of the same measurement carrying their own SD (never an sdSource SD — no
 *  chains), definition 'same', in population sets that are verified or single-extracted, other than
 *  the chosen set. Within each set the row is picked by pickRow (P12: the band containing the age,
 *  else the nearest band; age unknown → the adult row, else the band nearest 18) from the set's SIMILAR-AGE rows
 *  first, and only from its other rows when it has none (final review I4: a set holding a child row and a nearer adult
 *  row lends its child row to a child).
 *  Owner SDLEND-1 (13 Oct; settled in fix round 1 as SDLEND-1a/1b): the order is (1) same population and a SIMILAR
 *  age, (2) same population at any age, (3) another population and a similar age, (4) anything else — P31's own sex
 *  before pooled inside each. SDLEND-1b: a lender row is of a SIMILAR AGE (similarAge) when it is on the patient's side
 *  of 18 — the line the source line's boys/men words and the adult rule (AGE-UNK-1) already use: the patient is a child
 *  under 18 or an adult of 18 and over (age not entered → an adult, AGE-UNK-1); the row has no band (it holds for every
 *  age), or its band contains the patient's age, or (child) its band starts under 18, or (adult) its band starts at 18
 *  or more or reaches past 18. Tiers:
 *    1. same population, the patient's sex, an age band CONTAINING the patient's age;
 *    2. same population, the patient's sex, a similar age, the nearest band (an unbanded row sits here, never in
 *       tier 1 when the age is known; age unknown → the adult row first);
 *    3. same population, pooled, a similar age (a band containing the age first, then the nearest);
 *    4. same population, the patient's sex, another age, nearest band;
 *    5. same population, pooled, another age, nearest band;
 *    6. any other population, the patient's sex, a similar age, nearest age;
 *    7. any other population, pooled, a similar age, nearest age;
 *    8. any other population, the patient's sex, another age, nearest age;
 *    9. any other population, pooled, another age, nearest age.
 *  "Same population" is donorHomePopulation: the chosen set's population, or for an analysis's own
 *  norm the patient's population (case, else clinic default; none → tiers 6-9 only).
 *  An unknown sex uses only the pooled tiers (3, 5, 7, 9); the other sex is never a donor. Within a tier:
 *  the nearer age (a containing band, then an unbanded row, then by P12 distance), then the larger n
 *  (donorN: the row's, else the sample's nMale/nFemale for an M/F row, else sample.n), then the later
 *  paper (undated last), then set id. A row whose sd is null (P32) is no SD and never lends. */
/** P32 item 4: the population a donor must share to sit in tiers 1-3. For a population set it is that
 *  set's own population (the patient's, in practice). For an analysis's own norm (which has no real
 *  population) it is the PATIENT's population — the case's, else the clinic default; none (no
 *  population, the own norms chosen directly, or a user norm set) → only tiers 4/5 can apply. */
export function donorHomePopulation(q: NormQuery, chosen: NormSet): string | null {
  if (chosen.kind !== 'analysis-own') return chosen.population.id;
  const pop = q.population ?? q.clinicDefault;
  if (pop === null || pop === 'analysis-own' || pop.startsWith(USER_PREFIX)) return null;
  return pop;
}

/** P32 item 6: a donor row's n — its own, else the sample's count for its sex (nMale / nFemale),
 *  else the whole sample's. */
function donorN(row: NormEntry, set: NormSet): number | null {
  const bySex = row.sex === 'M' ? set.sample.nMale : row.sex === 'F' ? set.sample.nFemale : undefined;
  return row.n ?? bySex ?? set.sample.n ?? null;
}

/** Owner SDLEND-1 (13 Oct): is a lender row of a similar age to the patient — on the patient's side of 18 (a child under
 *  18; an adult 18 and over; age not entered = an adult, AGE-UNK-1)? A row with no band holds for every age; a band
 *  containing the patient's age (completed years) always is; a child takes a band starting under 18; an adult takes a
 *  band starting at 18 or more or reaching past 18 (hasAdultRow's adult row). A band spanning 18 is similar for both. */
function similarAge(band: [number, number] | undefined, ageYears: number | null): boolean {
  if (!band) return true;
  const adult = ageYears === null || Math.floor(ageYears) >= 18;
  if (ageYears !== null && yearsOutside(band, Math.floor(ageYears)) === 0) return true;
  return adult ? band[0] >= 18 || band[1] > 18 : band[0] < 18;
}

function findSdDonor(q: NormQuery, chosen: NormSet, e: NormEntry): Donor | null {
  const sexes: NormSex[] = q.sex !== null ? [q.sex, 'pooled'] : ['pooled'];
  const home = donorHomePopulation(q, chosen);
  const lenders = q.sets.filter(
    (s) => s.id !== chosen.id && s.kind === 'population' && (s.status === 'verified' || s.status === 'single-extracted'),
  );
  const cands: { donor: Donor; tier: number; distance: number; unbanded: number; n: number }[] = [];
  for (const set of lenders) {
    for (const sex of sexes) {
      const rows = set.entries.filter(
        (r) => r.measurement === e.measurement && r.sex === sex && r.sd != null && r.sdSource == null && r.definitionMatch === 'same',
      );
      // Final review I4: a lender is judged by whether it HOLDS a similar-age row, and lends from that row; only a lender
      // with none falls back to its nearest row of another age.
      const sexArg = sex === 'pooled' ? null : sex;
      const pick =
        pickRow(rows.filter((r) => similarAge(r.ageBand, q.ageYears)), e.measurement, sexArg, q.ageYears) ??
        pickRow(rows, e.measurement, sexArg, q.ageYears);
      if (!pick) continue;
      const band = pick.entry.ageBand;
      const distance = !band ? 0 : q.ageYears === null ? (band[0] >= 18 ? 0 : yearsOutside(band, 18)) : yearsOutside(band, Math.floor(q.ageYears));
      const containsAge = q.ageYears !== null && !!band && distance === 0;
      const samePopulation = home !== null && set.population.id === home;
      const ownSex = sex !== 'pooled';
      const similar = similarAge(band, q.ageYears);
      // SDLEND-1a: same population + similar age (1-3), same population any age (4-5), other population + similar age
      // (6-7), anything else (8-9); own sex before pooled in each.
      const tier = samePopulation
        ? similar ? (ownSex ? (containsAge ? 1 : 2) : 3) : ownSex ? 4 : 5
        : similar ? (ownSex ? 6 : 7) : ownSex ? 8 : 9;
      cands.push({ donor: { set, row: pick.entry }, tier, distance, unbanded: band ? 0 : 1, n: donorN(pick.entry, set) ?? 0 });
    }
  }
  cands.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.distance - b.distance ||
      a.unbanded - b.unbanded ||
      b.n - a.n ||
      byYear(a.donor.set, b.donor.set) ||
      byName(a.donor.set.id, b.donor.set.id),
  );
  return cands[0]?.donor ?? null;
}

function build(q: NormQuery, set: NormSet, pick: RowPick): Hit {
  const e = pick.entry;
  const flags: NormFlag[] = [];
  const website = set.status === 'website';
  if (website) flags.push('website');
  if (set.status === 'single-extracted') flags.push('unverified');
  if (e.definitionMatch === 'close') flags.push('close');
  if (set.secondHand) flags.push('second-hand');
  // Ruling T4-1: the oldest-row stand-in for an unknown age is not "the nearest age" — its own flag.
  if (pick.oldestFallback) flags.push('age-unknown-oldest-row');
  else if (pick.ageMismatched) flags.push('age-mismatched');
  // P16: flag a pooled row only when this set splits the measurement by sex somewhere, so a
  // sex-specific comparison existed in principle (Steiner's pooled-only ideals raise no flag).
  // Final review M-2: in an 'interpolate' set, only the printed ages actually used count (a girl
  // between two pooled-only ages is not flagged because the author split by sex at 18).
  const usedAges =
    set.ageRows === 'interpolate' && e.ageBand
      ? new Set(pick.interpolated ? [pick.interpolated.a, pick.interpolated.b] : [e.ageBand[0]])
      : null;
  const setSplitsBySex = set.entries.some(
    (x) => x.measurement === e.measurement && x.sex !== 'pooled' && (usedAges === null || (x.ageBand !== undefined && usedAges.has(x.ageBand[0]))),
  );
  if (e.sex === 'pooled' && q.sex !== null && setSplitsBySex) flags.push('sex-pooled');

  const flag = (f: NormFlag) => {
    if (!flags.includes(f)) flags.push(f);
  };

  const scaled = applyFilmScale(e, set);
  if (scaled.flag) flag(scaled.flag);

  let sd: number | null = scaled.sd;
  let sdFrom: string | null = null;
  let sdScaleMixNote: string | null = null;
  if (e.sdSource) {
    const b = borrowedSd(q, e);
    let bsd = b ? b.sd : null;
    let sdScaleNote = '';
    if (b && e.unit === 'mm' && !b.set && set.scale.kind === 'enlarged') {
      // Ruling P28 (fix round 1): the SD's own film scale cannot be known (its source set isn't
      // loaded) while the owning entry's own scale is 'enlarged' — never mix an unknown scale
      // with a known one, so the SD is dropped rather than coloured on a guess.
      bsd = null;
      sdScaleMixNote = ` · SD source ${e.sdSource.set} not loaded; not coloured`;
    } else if (b && bsd !== null && b.set) {
      // The SD's own film scale is the SOURCE set's scale (it is the source paper's printed
      // number, whether copied verbatim into this entry or borrowed from a row there) — never
      // the owning (borrowing) set's own scale, which may differ or not apply at all.
      const conv = sdAtTrueSize(bsd, e.unit, b.set);
      bsd = conv.sd;
      if (conv.converted) flag('sd-converted');
      sdScaleNote = conv.note;
      // Task 6 preliminary (Task 4c review): disclose an mm SD from a source that never stated its
      // film scale, as the rule 15 donor path does.
      if (e.unit === 'mm' && b.set.scale.kind === 'not-stated') sdScaleNote += " (source's film scale not stated; assumed true size)";
    }
    sd = bsd;
    if (b && bsd !== null) {
      flag('sd-from-other-paper');
      const who = b.set ? shortCitation(b.set) : e.sdSource.set;
      if (!b.row) {
        sdFrom = `${who} ${e.sdSource.source}${sdScaleNote}`;
      } else {
        const r = b.row;
        const differs: string[] = [];
        if (r.sex !== e.sex) {
          // borrowedSd only takes the entry's own sex or pooled, so a differing row is a both-sexes row.
          flag('sd-sexes-pooled');
          differs.push(sexWords(r));
        }
        if (!sameBand(r, e)) {
          flag('sd-other-age');
          differs.push(r.ageBand ? bandLabel(r.ageBand) : 'all ages');
        }
        sdFrom = `${who} ${r.source}${differs.length ? ` (${differs.join(', ')})` : ''}${sdScaleNote}`;
        if (r.definitionMatch === 'close') {
          flag('sd-close');
          if (r.definitionNote) sdFrom += ` · ${r.definitionNote}`;
        }
      }
    }
  }
  // Rules 13-17 (Task 4c, owner B-1/B-2): borrow an SD for an entry whose paper printed none.
  const ideal = e.centre === 'ideal';
  if (ideal) flag('ideal');
  let mean = scaled.mean;
  let printed = scaled.printed;
  let sdDonor: SdDonor | null = null;
  let donorClause: string | null = null;
  let midpointCentre = false;
  // Rule 14: a sample entry needs its own mean; an ideal may be centred on its range's midpoint.
  const hasCentre = mean !== null || (ideal && scaled.range !== null);
  if (!website && e.sd == null && e.sdSource == null && hasCentre) {
    const d = findSdDonor(q, set, e);
    if (d) {
      const conv = sdAtTrueSize(d.row.sd ?? null, e.unit, d.set); // rule 16: by the DONOR set's scale
      if (conv.converted) flag('sd-converted');
      sd = conv.sd;
      flag('sd-borrowed');
      if (mean === null && scaled.range) {
        mean = (scaled.range.low + scaled.range.high) / 2;
        midpointCentre = true;
        // P32 item 5: `printed` describes the mean shown, so it carries the printed midpoint too.
        if (printed?.range) printed = { ...printed, mean: (printed.range.low + printed.range.high) / 2 };
      }
      const donorAge = d.row.ageBand ? bandLabel(d.row.ageBand) : null;
      sdDonor = { setId: d.set.id, source: d.row.source, sex: d.row.sex, ageRowUsed: donorAge, n: donorN(d.row, d.set) };
      const words = [d.set.population.label, donorAge, sexWords(d.row), d.row.source].filter((p): p is string => !!p);
      // P32 item 2: an mm SD from a paper that never stated its film scale is used as printed; say so.
      const assumed = e.unit === 'mm' && d.set.scale.kind === 'not-stated' ? " (donor's film scale not stated; assumed true size)" : '';
      donorClause = `SD borrowed from ${shortCitation(d.set)}, ${words.join(', ')}${conv.note}${assumed}`;
    } else {
      donorClause = 'no SD in this paper and no matching SD to borrow';
    }
  }
  const colour = !website && mean !== null && sd !== null;
  // Ruling T4-1: 'ideal' says the cell is coloured; an ideal that is not (no SD to use) gets its own flag, in place.
  if (ideal && !colour) flags[flags.indexOf('ideal')] = 'ideal-uncoloured';
  const ageRowUsed = pick.interpolated
    ? `${fmtAge(pick.interpolated.age)} y (interpolated ${pick.interpolated.a}–${pick.interpolated.b} y)`
    : e.ageBand
      ? bandLabel(e.ageBand)
      : null;
  if (pick.interpolated) flag('interpolated');
  if (e.fromOtherSex) flag('other-sex-values');
  if (pick.averaged) flag('sexes-averaged');
  // Owner AGE-UNK-1 (12 Oct): no age entered and the row used is an age-banded adult row → it was chosen on the
  // assumption of an adult. Not when no adult row existed (the oldest-row stand-in keeps its own "other age" wording)
  // and not for a row with no age band (it holds for every age; nothing was assumed).
  const adultAssumed = q.ageYears === null && !pick.oldestFallback && e.ageBand !== undefined;
  if (adultAssumed) flag(q.filmDateMissing ? 'film-date-missing' : 'age-assumed-adult');

  const place = set.population.region ?? set.population.country;
  const popWords = place && !set.population.label.includes(place) ? `${set.population.label} (${place})` : set.population.label;
  // n: the row's own n; else, for a row with no age band, the sample's count for that sex (the whole
  // sample only for a pooled row); a banded row without its own n quotes none.
  const n = e.n ?? (e.ageBand ? undefined : e.sex === 'M' ? set.sample.nMale : e.sex === 'F' ? set.sample.nFemale : set.sample.n);
  const parts = [shortCitation(set), set.population.id === 'analysis-own' ? null : popWords, ageRowUsed, sexWords(e), n !== undefined ? `n = ${n}` : null, e.source].filter(
    (p): p is string => !!p,
  );
  let line = parts.join(', ');
  if (e.definitionMatch === 'close' && e.definitionNote) line += ` · ${e.definitionNote}`;
  if (scaled.suffix) line += scaled.suffix;
  if (set.secondHand) line += ` · quoted second-hand via ${set.secondHand.via}`;
  if (pick.oldestFallback) line += ` · age unknown; the oldest printed row (${bandLabel(e.ageBand!)}) was used`;
  else if (pick.ageMismatched) line += ' · no row for the patient’s age';
  if (pick.interpolated) line += ` · interpolated between ${shortCitation(set)}'s ages ${pick.interpolated.a} and ${pick.interpolated.b}`;
  if (e.fromOtherSex && e.note) line += ` · ${e.note.split(';')[0].trim()}`;
  if (pick.averaged) line += ' · average of male and female (sex not recorded)';
  if (adultAssumed) line += ` · ${q.filmDateMissing ? FILM_DATE_MISSING_WORDS : AGE_NOT_ENTERED_WORDS}`;
  if (website) line += ' · website value, not from a paper';
  const sdClauses = [ideal ? `ideal value (${set.citation.authors})` : null, donorClause].filter((p): p is string => !!p);
  if (sdClauses.length) line += ` · ${sdClauses.join('; ')}`;
  if (midpointCentre) line += " · centre = midpoint of the author's range";
  if (sdFrom) line += ` · SD from ${sdFrom}`;
  if (sdScaleMixNote) line += sdScaleMixNote;

  return { kind: 'norm', setId: set.id, entry: e, mean, sd, range: scaled.range, printed, colour, flags, sourceLine: line, ageRowUsed, sdDonor };
}

function fromUserNorms(q: NormQuery, norms: UserNorm[]): Hit | null {
  const u = [...norms].filter((x) => x.measurement === q.measurement).sort((a, b) => byName(a.setName, b.setName))[0];
  if (!u) return null;
  const sd = u.sd !== null && Number.isFinite(u.sd) && u.sd > 0 ? u.sd : null; // an SD of 0 or below is no SD
  let unit: NormEntry['unit'] = '';
  try {
    unit = byId(u.measurement as any).unit as NormEntry['unit'];
  } catch {
    /* an unknown id keeps the empty unit */
  }
  const entry: NormEntry = {
    measurement: u.measurement,
    sex: 'pooled',
    mean: u.mean,
    ...(sd !== null ? { sd } : {}),
    unit,
    source: u.sourceNote,
    definitionMatch: 'same',
  };
  return {
    kind: 'norm',
    setId: USER_PREFIX + u.setName,
    entry,
    mean: u.mean,
    sd,
    range: null,
    printed: null, // user norms are never converted for film scale
    colour: sd !== null && Number.isFinite(u.mean),
    flags: ['user-norm'],
    sourceLine: `${u.setName} · your norm: ${u.sourceNote}`,
    ageRowUsed: null,
    sdDonor: null,
  };
}
