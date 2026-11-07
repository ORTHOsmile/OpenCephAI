import { describe, it, expect } from 'vitest';
import { validateSet } from './validate';
import { POPULATIONS } from './load';
import type { NormSet, NormEntry } from './types';
import { resolveNorm, zScore, band, resolveAcross, populationsOffered, donorHomePopulation, shortCitation, type NormQuery, type UserNorm, type Resolved } from './resolve';

// ---- SYNTHETIC fixtures (no real paper values). Every set must pass validateSet, so the fixtures
// cannot drift from the norm-set format.
const POP_IDS = POPULATIONS.map((p) => p.id);
// P34 (Task 6 fix round 1): the validator now refuses a band-less row beside banded rows of the same
// measurement and sex. The resolver still handles that shape defensively, and the few fixtures that
// test that path opt out of that ONE check (`bandlessBesideBands: true`); every other check still runs.
const P34 = /a band-less row is unreachable when the patient's age is known/;
function mkSet(s: Partial<NormSet> & { id: string; entries: NormEntry[] }, opts: { bandlessBesideBands?: boolean } = {}): NormSet {
  const set: NormSet = {
    kind: 'population', status: 'verified',
    citation: { authors: 'Synthetic A', title: 'Synthetic norms', year: 2020, openAccess: true },
    population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] },
    sample: { n: 50 }, selection: 'class-I', modality: 'digital', scale: { kind: 'not-stated' }, headPosition: 'FH',
    curation: { extractedBy: ['a', 'b'], comparedOn: '2026-10-07', date: '2026-10-07' }, caveats: [],
    ...s,
  } as NormSet;
  const problems = validateSet(set, { populations: POP_IDS }).filter((p) => !(opts.bandlessBesideBands && P34.test(p)));
  if (problems.length) throw new Error(`synthetic fixture invalid: ${problems.join('; ')}`);
  return set;
}
const deg = (measurement: string, sex: 'M' | 'F' | 'pooled', mean: number, extra: Partial<NormEntry> = {}): NormEntry =>
  ({ measurement, sex, mean, sd: 4, unit: 'deg', source: 'Table 2', definitionMatch: 'same', ...extra });

// One population set with M/F/pooled rows and age bands 7–10, 11–14 and adult.
const WU = mkSet({
  id: 'wu-synthetic', selection: 'class-I-balanced', sample: { n: 200 },
  citation: { authors: 'Wu J, Other B', title: 'Synthetic Hong Kong norms', year: 2007, openAccess: true },
  population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'], region: 'Hong Kong' },
  entries: [
    deg('m01_SNA', 'M', 80, { ageBand: [7, 10] }),
    deg('m01_SNA', 'M', 82, { ageBand: [11, 14], n: 100 }),
    deg('m01_SNA', 'M', 83, { ageBand: [18, 40] }),
    deg('m01_SNA', 'F', 81.5, { ageBand: [11, 14] }),
    deg('m01_SNA', 'pooled', 79, { ageBand: [7, 10] }),
    deg('m01_SNA', 'pooled', 81, { ageBand: [11, 14] }),
    deg('m02_SNB', 'M', 78, { ageBand: [11, 14] }), // boys only: never for a girl
  ],
});
// A second set in the same population with a smaller n (and no age bands).
const CHEN = mkSet({
  id: 'chen-synthetic', selection: 'class-I', sample: { n: 80 },
  citation: { authors: 'Chen C', title: 'Synthetic', year: 2015, openAccess: true },
  entries: [
    deg('m01_SNA', 'pooled', 83.3),
    deg('m02_SNB', 'pooled', 79.9),
    { measurement: 'm46_U1NAmm', sex: 'pooled', mean: 5, sd: 2, unit: 'mm', source: 'Table 4', definitionMatch: 'close', definitionNote: 'paper measured from the labial surface' },
  ],
});
// Single-extracted (unverified) set, with a 'different' entry. Filed under 'jordanian' (was 'malay'): since the owner
// ruling of 7 Nov 2026 a Malay patient uses the Chinese norms, so 'malay' can no longer stand for an arbitrary population.
const MALAY = mkSet({
  id: 'malay-synthetic', status: 'single-extracted',
  population: { id: 'jordanian', label: 'Malay', ethnicity: ['Malay'] },
  citation: { authors: 'Malay M', title: 'Synthetic', year: 2019, openAccess: true },
  entries: [
    deg('m01_SNA', 'pooled', 84),
    deg('m03_ANB', 'pooled', 3, { definitionMatch: 'different', definitionNote: 'measured to a different point' }),
  ],
});
// Pending set: never used.
const SAUDI_PENDING = mkSet({
  id: 'saudi-pending', status: 'pending',
  population: { id: 'saudi', label: 'Saudi', ethnicity: ['Saudi'] },
  entries: [deg('m01_SNA', 'pooled', 99), deg('m02_SNB', 'pooled', 99), deg('m03_ANB', 'pooled', 9)],
});
// A research set that only supplies an SD.
const KIM_RESEARCH = mkSet({
  id: 'kim-research', kind: 'research-sd',
  population: { id: 'caucasian', label: 'Caucasian', ethnicity: ['European'] },
  citation: { authors: 'Kim K, Lee L', title: 'Synthetic SDs', year: 2025, openAccess: true },
  entries: [deg('m02_SNB', 'pooled', 78, { sd: 3.4, source: 'Table 3' })],
});
// Steiner's own norm: an ideal with no SD, an SD taken from the research set, a range.
const STEINER_OWN = mkSet({
  id: 'steiner-own', kind: 'analysis-own', analyses: ['steiner'],
  population: { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] },
  citation: { authors: 'Steiner C', title: 'Synthetic ideals', year: 1953, openAccess: false },
  sample: {}, selection: 'ideal-aesthetic',
  entries: [
    { measurement: 'm01_SNA', sex: 'pooled', mean: 82, unit: 'deg', source: 'p. 731', definitionMatch: 'same' },
    { measurement: 'm02_SNB', sex: 'pooled', mean: 80, sdSource: { set: 'kim-research', source: 'Table 3' }, unit: 'deg', source: 'p. 731', definitionMatch: 'same' },
    { measurement: 'm03_ANB', sex: 'pooled', range: { low: 0, high: 4 }, unit: 'deg', source: 'p. 732', definitionMatch: 'same' },
  ],
});
// A website set for Steiner (with an SD on the website: still never coloured).
const STEINER_WEB = mkSet({
  id: 'steiner-website', kind: 'analysis-own', analyses: ['steiner'], status: 'website',
  population: { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] },
  citation: { authors: 'Some Website', title: 'Steiner page', year: 2024, openAccess: true, url: 'https://example.invalid' },
  sample: {}, selection: 'unknown',
  entries: [deg('m20_SNGoGn', 'pooled', 32, { sd: 4, source: 'web page' }), deg('m01_SNA', 'pooled', 70, { source: 'web page' })],
});
// A second-hand own norm (Björk–Jarabak quoted via another paper).
const JARABAK_VIA = mkSet({
  id: 'jarabak-via-synthetic', kind: 'analysis-own', analyses: ['bjork-jarabak'],
  population: { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] },
  citation: { authors: 'Jarabak J', title: 'Synthetic', year: 1972, openAccess: false },
  secondHand: { via: 'Quoter 2022 Table 3' }, selection: 'unknown',
  entries: [deg('m34_Saddle', 'pooled', 123, { sd: 5 })],
});

// Task 4b: film scale. An mm entry (true-size and ratio/percent for rule 12), plus a degree entry,
// in sets of each scale kind.
const SCALE_ENLARGED = mkSet({
  id: 'scale-enlarged-synthetic', scale: { kind: 'enlarged', percent: 8, source: 'p. 100' },
  entries: [
    { measurement: 'm46_U1NAmm', sex: 'pooled', mean: 80, sd: 3.0, range: { low: 75, high: 85 }, unit: 'mm', source: 'Table 1', definitionMatch: 'same' },
    deg('m01_SNA', 'pooled', 82),
    { measurement: 'm29_LAFHpct', sex: 'pooled', mean: 60, sd: 4, unit: '%', source: 'Table 1', definitionMatch: 'same' },
    { measurement: 'm43_SNtoGoMe', sex: 'pooled', mean: 1.2, sd: 0.2, unit: '', source: 'Table 1', definitionMatch: 'same' },
  ],
});
// A range-only mm entry (no mean) in an enlarged set.
const SCALE_ENLARGED_RANGE_ONLY = mkSet({
  id: 'scale-enlarged-range-only-synthetic', scale: { kind: 'enlarged', percent: 10, source: 'p. 50' },
  entries: [{ measurement: 'm46_U1NAmm', sex: 'pooled', range: { low: 55, high: 66 }, unit: 'mm', source: 'Table 2', definitionMatch: 'same' }],
});
const SCALE_NOT_STATED = mkSet({
  id: 'scale-not-stated-synthetic', // mkSet default scale is already not-stated
  entries: [
    { measurement: 'm46_U1NAmm', sex: 'pooled', mean: 50, sd: 2, unit: 'mm', source: 'Table 3', definitionMatch: 'same' },
    deg('m01_SNA', 'pooled', 81),
  ],
});
const SCALE_TRUE_SIZE = mkSet({
  id: 'scale-true-size-synthetic', scale: { kind: 'true-size', source: 'owner ruling' },
  entries: [{ measurement: 'm46_U1NAmm', sex: 'pooled', mean: 50, sd: 2, unit: 'mm', source: 'Table 4', definitionMatch: 'same' }],
});

const SETS = [WU, CHEN, MALAY, SAUDI_PENDING, KIM_RESEARCH, STEINER_OWN, STEINER_WEB, JARABAK_VIA];
// Task 4c: the same sets without any population set, so an SD-less own norm finds no SD donor
// (rules 13-17) — for the older tests whose subject is not borrowing.
const NO_DONORS = SETS.filter((s) => s.kind !== 'population');
const USER: UserNorm[] = [
  { setName: 'Zeta', measurement: 'm13_Wits', mean: 1, sd: 2, sourceNote: 'clinic sample 2024' },
  { setName: 'Alpha', measurement: 'm13_Wits', mean: 0, sd: 2, sourceNote: 'my thesis' },
];

const q = (o: Partial<NormQuery>): NormQuery => ({
  measurement: 'm01_SNA', analysisId: 'steiner', population: null, clinicDefault: null,
  sex: null, ageYears: null, sets: SETS, userNorms: USER, ...o,
});
const norm = (r: Resolved) => {
  if (r.kind !== 'norm') throw new Error(`expected a norm, got none: ${r.reason}`);
  return r;
};

describe('resolveNorm', () => {
  it('rule 1: the case population wins over the clinic default; the clinic default applies when the case has none; user norm sets are populations', () => {
    expect(norm(resolveNorm(q({ population: null, clinicDefault: 'chinese', sex: 'M', ageYears: 12 }))).setId).toBe('wu-synthetic');
    expect(norm(resolveNorm(q({ population: 'jordanian', clinicDefault: 'chinese' }))).setId).toBe('malay-synthetic');
    const u = norm(resolveNorm(q({ measurement: 'm13_Wits', analysisId: 'wits', population: 'user:Zeta' })));
    expect(u.setId).toBe('user:Zeta');
    expect(u.mean).toBe(1);
    expect(u.flags).toContain('user-norm');
  });

  it('rule 2: pending sets and "different" entries are never used; single-extracted is used and flagged unverified', () => {
    expect(norm(resolveNorm(q({ population: 'saudi' }))).auto?.step).toBe('analysis-own');   // N-A3: Steiner's own (was 'choose', OWNFALL-1)
    // The malay ANB row is 'different', so Malay has no ANB: Auto, Steiner's own (was 'choose', OWNFALL-1).
    expect(norm(resolveNorm(q({ measurement: 'm03_ANB', population: 'jordanian' }))).auto?.step).toBe('analysis-own');
    const d = norm(resolveNorm(q({ measurement: 'm03_ANB', population: 'jordanian', picks: { jordanian: { m03_ANB: 'analysis-own' } } })));
    expect([d.setId, d.entry.definitionMatch]).toEqual(['steiner-own', 'same']);
    const s = norm(resolveNorm(q({ population: 'jordanian' })));
    expect(s.setId).toBe('malay-synthetic');
    expect(s.flags).toContain('unverified');
    expect(norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12 }))).flags).not.toContain('unverified');
  });

  it("rule 3: the patient's own sex row first, else pooled (flagged when the sex is known); the other sex's row is never used", () => {
    const boy = norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12 })));
    expect([boy.entry.sex, boy.mean]).toEqual(['M', 82]);
    const girl = norm(resolveNorm(q({ population: 'chinese', sex: 'F', ageYears: 12 })));
    expect([girl.entry.sex, girl.mean]).toEqual(['F', 81.5]);
    expect(girl.flags).not.toContain('sex-pooled');
    const unknown = norm(resolveNorm(q({ population: 'chinese', sex: null, ageYears: 12 })));
    expect([unknown.entry.sex, unknown.mean]).toEqual(['pooled', 81]);
    expect(unknown.flags).not.toContain('sex-pooled');
    const girl8 = norm(resolveNorm(q({ population: 'chinese', sex: 'F', ageYears: 8 })));
    expect([girl8.entry.sex, girl8.mean]).toEqual(['pooled', 79]);
    expect(girl8.flags).toContain('sex-pooled');
    // WU holds SNB for boys only: a girl must not get the boys' row (the better-ranked set), she gets CHEN's pooled row.
    const girlSnb = norm(resolveNorm(q({ measurement: 'm02_SNB', population: 'chinese', sex: 'F', ageYears: 12 })));
    expect(girlSnb.entry.sex).not.toBe('M');
    expect([girlSnb.setId, girlSnb.mean]).toEqual(['chen-synthetic', 79.9]);
  });

  it("rule 4 (P12/P13): the band containing the age; a known age outside every band takes the NEAREST band (ties → older), flagged; an unknown age takes the adult row, unflagged", () => {
    const at = (ageYears: number | null, sex: 'M' | 'F' | null = 'M') => norm(resolveNorm(q({ population: 'chinese', sex, ageYears })));
    const mis = (r: { flags: string[] }) => r.flags.includes('age-mismatched');
    expect([at(12).mean, at(12).ageRowUsed, mis(at(12))]).toEqual([82, '11–14 y', false]);
    expect([at(14.99).ageRowUsed, mis(at(14.99))]).toEqual(['11–14 y', false]); // completed years: 14.99 is still 14
    expect([at(10.99).ageRowUsed, at(11).ageRowUsed]).toEqual(['7–10 y', '11–14 y']);
    // Known age outside every band: the nearest band, flagged.
    expect([at(5).ageRowUsed, mis(at(5))]).toEqual(['7–10 y', true]);      // boy 5 → 7–10
    expect([at(15).ageRowUsed, mis(at(15))]).toEqual(['11–14 y', true]);   // boy 15 → 11–14 (1 y away; 18–40 is 3 y away)
    expect([at(17.9).ageRowUsed, mis(at(17.9))]).toEqual(['18–40 y', true]); // 17 completed: 18–40 is 1 y away
    expect([at(16).ageRowUsed, mis(at(16))]).toEqual(['18–40 y', true]);  // tie (2 y each way) → the older band
    expect([at(50).ageRowUsed, mis(at(50))]).toEqual(['18–40 y', true]);
    // Unknown age: the adult row, never flagged.
    expect([at(null).ageRowUsed, mis(at(null))]).toEqual(['18–40 y', false]);
    // Girl: no girls' adult row; 16 → girls' 11–14 (own sex beats pooled for the same band), flagged.
    const girl16 = at(16, 'F');
    expect([girl16.entry.sex, girl16.ageRowUsed, mis(girl16)]).toEqual(['F', '11–14 y', true]);
    // Unknown age with no adult band and no band-less row: the oldest band, flagged and said (Task 7
    // fix round 1, review Important #2 — it is a child's row standing in for an unknown age). Owner AGE-UNK-1
    // (12 Oct): a set with an adult (or band-less) row now ranks first, so with CHEN present a girl of unknown age
    // gets CHEN's band-less pooled row; WU alone still shows the oldest-row stand-in.
    expect(norm(resolveNorm(q({ population: 'chinese', sex: 'F', ageYears: null }))).setId).toBe('chen-synthetic');
    const girlUnknown = norm(resolveNorm(q({ population: 'chinese', sets: [WU], sex: 'F', ageYears: null })));
    // Ruling T4-1 (Task 4 fix round 1): flagged 'age-unknown-oldest-row', not 'age-mismatched' (no age to be near).
    expect([girlUnknown.entry.sex, girlUnknown.ageRowUsed, mis(girlUnknown), girlUnknown.flags.includes('age-unknown-oldest-row')]).toEqual(['F', '11–14 y', false, true]);
    expect(girlUnknown.sourceLine).toContain(' · age unknown; the oldest printed row (11–14 y) was used');
    expect(girlUnknown.sourceLine).not.toContain('no row for the patient');
    // A set with no age bands: no flag even when the age is known, and no age row named.
    const chen = norm(resolveNorm(q({ population: 'chinese', measurement: 'm02_SNB', sex: 'F', ageYears: 30 })));
    expect([chen.ageRowUsed, mis(chen)]).toEqual([null, false]);
  });

  it('rule 4 (P13): a band-less row in a set that also has bands is used only for an unknown age, or when that sex has no bands', () => {
    const mixed = mkSet({ id: 'mixed', entries: [
      deg('m01_SNA', 'M', 80, { ageBand: [11, 14] }),
      deg('m01_SNA', 'M', 85),                        // band-less boys' row
      deg('m01_SNA', 'pooled', 81, { ageBand: [11, 14] }),
      deg('m01_SNA', 'F', 86),                        // girls have no bands at all
    ] }, { bandlessBesideBands: true }); // P34: the validator refuses this shape; the resolver path stays tested
    const r = (sex: 'M' | 'F', ageYears: number | null) => norm(resolveNorm(q({ population: 'chinese', sets: [mixed], sex, ageYears })));
    expect([r('M', 16).mean, r('M', 16).ageRowUsed, r('M', 16).flags]).toEqual([80, '11–14 y', ['age-mismatched']]);
    expect([r('M', null).mean, r('M', null).ageRowUsed, r('M', null).flags]).toEqual([85, null, []]);
    expect([r('F', 16).mean, r('F', 16).flags]).toEqual([86, []]);
    expect(r('F', 12).mean).toBe(81); // age first: the pooled 11–14 row beats the band-less girls' row
  });

  it('rule 5: several qualifying sets — class-I-balanced first, then larger n, then later year', () => {
    const e = [deg('m01_SNA', 'pooled', 80)];
    const a = mkSet({ id: 'a-small-balanced', selection: 'class-I-balanced', sample: { n: 10 }, entries: e });
    const b = mkSet({ id: 'b-big-classI', selection: 'class-I', sample: { n: 500 }, entries: e });
    const c = mkSet({ id: 'c-big-classI-newer', selection: 'class-I', sample: { n: 500 }, citation: { authors: 'C', title: 'T', year: 2021, openAccess: true }, entries: e });
    const d = mkSet({ id: 'd-mid-classI-newest', selection: 'class-I', sample: { n: 100 }, citation: { authors: 'D', title: 'T', year: 2025, openAccess: true }, entries: e });
    const pick = (sets: NormSet[]) => norm(resolveNorm(q({ population: 'chinese', sets }))).setId;
    expect(pick([b, a, c, d])).toBe('a-small-balanced');
    expect(pick([d, b])).toBe('b-big-classI');
    expect(pick([b, c, d])).toBe('c-big-classI-newer');
    expect(pick([c, b, d])).toBe('c-big-classI-newer');
  });

  // Owner AGE-1 (Task 9a-1 fix round 1): "age first, then sample quality". A set whose row (the
  // patient's own sex, else pooled) has an age band containing the patient's age ranks before one
  // that does not; within each group the rule 5 order stands. Age unknown → rule 5 alone.
  describe('AGE-1: age first, then sample quality', () => {
    const adultsBalanced = mkSet({ id: 'adults-balanced', selection: 'class-I-balanced', sample: { n: 100 }, entries: [deg('m11_CoGn', 'pooled', 120, { unit: 'mm', ageBand: [16, 30] })] });
    const childrenRandom = mkSet({
      id: 'children-random', selection: 'random-unselected', sample: { n: 400 },
      entries: [deg('m11_CoGn', 'M', 110, { unit: 'mm', ageBand: [11, 13] }), deg('m11_CoGn', 'F', 109, { unit: 'mm', ageBand: [11, 13] })],
    });
    const girlsOnly = mkSet({ id: 'girls-only-random', selection: 'random-unselected', sample: { n: 400 }, entries: [deg('m11_CoGn', 'F', 108, { unit: 'mm', ageBand: [8, 10] })] });
    const interp = mkSet({
      id: 'interp-random', selection: 'random-unselected', sample: { n: 30 }, ageRows: 'interpolate',
      entries: [deg('m11_CoGn', 'pooled', 100, { unit: 'mm', ageBand: [6, 6] }), deg('m11_CoGn', 'pooled', 105, { unit: 'mm', ageBand: [9, 9] })],
    });
    const pick = (sex: 'M' | 'F' | null, ageYears: number | null, sets: NormSet[]) => {
      const r = norm(resolveNorm(q({ measurement: 'm11_CoGn', analysisId: 'mcnamara', population: 'chinese', sex, ageYears, sets })));
      return [r.setId, r.flags.includes('age-mismatched')];
    };
    it('a boy of 12: the random school sample that covers 11–13 beats the balanced adult sample', () => {
      expect(pick('M', 12, [adultsBalanced, childrenRandom])).toEqual(['children-random', false]);
      expect(pick('M', 12.9, [childrenRandom, adultsBalanced])).toEqual(['children-random', false]);
    });
    it('a man of 20: the balanced sample covers him and wins', () => {
      expect(pick('M', 20, [childrenRandom, adultsBalanced])).toEqual(['adults-balanced', false]);
    });
    it('nobody covers (a boy of 15): rule 5 decides, the chosen row flagged age-mismatched', () => {
      expect(pick('M', 15, [childrenRandom, adultsBalanced])).toEqual(['adults-balanced', true]);
    });
    it('age unknown: rule 5 alone (the balanced sample)', () => {
      // Its 16–30 band does not start at 18; it stands in as the oldest row and, spanning 18, is
      // treated as an adult row (owner AGE-3); only the choice of set is AGE-1's business.
      expect(pick('M', null, [childrenRandom, adultsBalanced])[0]).toBe('adults-balanced');
    });
    it("a girls' band does not cover a boy: a boy of 9 is not taken to the girls-only set", () => {
      expect(pick('M', 9, [girlsOnly, adultsBalanced])).toEqual(['adults-balanced', true]);
      expect(pick('F', 9, [girlsOnly, adultsBalanced])).toEqual(['girls-only-random', false]);
    });
    it('an interpolate set covers its printed-age span: a child of 8 gets it over the balanced adults; a child of 10 is not covered', () => {
      expect(pick('F', 8, [adultsBalanced, interp])).toEqual(['interp-random', false]);
      // Not covered at 10, so flagged; owner AGE-2 (8 Oct) then takes the nearer set (age 9, 1 y away)
      // over the adults (16–30, 6 y away) — before AGE-2 this was the adults by rule 5.
      expect(pick('F', 10, [adultsBalanced, interp])).toEqual(['interp-random', true]);
    });
    it('a website set still ranks after a paper even when only the website covers the age', () => {
      const web = mkSet({ ...childrenRandom, id: 'children-web', status: 'website' });
      expect(pick('M', 12, [web, adultsBalanced])).toEqual(['adults-balanced', true]);
    });
  });

  // Owner AGE-2 (8 Oct, "the nearest age"): when NO set of the population covers the patient's age,
  // the sets are ranked by their nearest band's distance in completed years (yearsOutside, P12),
  // nearest first; then rule 5. The chosen row stays flagged age-mismatched.
  describe('AGE-2: the nearest age when no set covers it', () => {
    const adultsBalanced = mkSet({ id: 'adults-balanced', selection: 'class-I-balanced', sample: { n: 100 }, entries: [deg('m11_CoGn', 'pooled', 120, { unit: 'mm', ageBand: [16, 30] })] });
    const childrenRandom = mkSet({
      id: 'children-random', selection: 'random-unselected', sample: { n: 400 },
      entries: [deg('m11_CoGn', 'M', 110, { unit: 'mm', ageBand: [11, 13] }), deg('m11_CoGn', 'F', 109, { unit: 'mm', ageBand: [11, 13] })],
    });
    const interp = mkSet({
      id: 'interp-random', selection: 'random-unselected', sample: { n: 30 }, ageRows: 'interpolate',
      entries: [deg('m11_CoGn', 'pooled', 100, { unit: 'mm', ageBand: [6, 6] }), deg('m11_CoGn', 'pooled', 105, { unit: 'mm', ageBand: [9, 9] })],
    });
    const pick = (sex: 'M' | 'F' | null, ageYears: number | null, sets: NormSet[]) => {
      const r = norm(resolveNorm(q({ measurement: 'm11_CoGn', analysisId: 'mcnamara', population: 'chinese', sex, ageYears, sets })));
      return [r.setId, r.flags.includes('age-mismatched')];
    };
    it('a boy of 14: the children (11–13, 1 y away) beat the balanced adults (16–30, 2 y away), flagged', () => {
      expect(pick('M', 14, [adultsBalanced, childrenRandom])).toEqual(['children-random', true]);
      expect(pick('M', 14.9, [childrenRandom, adultsBalanced])).toEqual(['children-random', true]); // completed years: 14
    });
    it('a boy of 15: the adults are nearer (1 y vs 2 y), flagged', () => {
      expect(pick('M', 15, [childrenRandom, adultsBalanced])).toEqual(['adults-balanced', true]);
    });
    it('an equal distance falls back to rule 5 (a boy of 14 against 11–13 and a balanced 15–30 band: 1 y each → balanced)', () => {
      const adults15 = mkSet({ ...adultsBalanced, id: 'adults-15', entries: [deg('m11_CoGn', 'pooled', 121, { unit: 'mm', ageBand: [15, 30] })] });
      expect(pick('M', 14, [childrenRandom, adults15])).toEqual(['adults-15', true]);
    });
    it('an interpolate set: its distance is from its nearest printed age (a child of 10: age 9 is 1 y away, the adults 6 y)', () => {
      expect(pick('F', 10, [adultsBalanced, interp])).toEqual(['interp-random', true]);
    });
    it("only usable rows count: a girls' band is no distance for a boy", () => {
      // The girls' 14-y row is 1 y from a boy of 13 but is not his; the set's pooled row (30–40) is 17 y
      // away, so the adults (16–30, 3 y) are nearer. Counting the girls' row would choose this set.
      const girlsNear = mkSet({
        id: 'girls-near', selection: 'random-unselected', sample: { n: 400 },
        entries: [deg('m11_CoGn', 'F', 108, { unit: 'mm', ageBand: [14, 14] }), deg('m11_CoGn', 'pooled', 125, { unit: 'mm', ageBand: [30, 40] })],
      });
      expect(pick('M', 13, [girlsNear, adultsBalanced])).toEqual(['adults-balanced', true]);
      expect(pick('F', 13, [girlsNear, adultsBalanced])).toEqual(['girls-near', true]); // for a girl it is 1 y away
    });
    it('a set that covers the age still beats a nearer-ranked one (AGE-1 unchanged)', () => {
      expect(pick('M', 12, [adultsBalanced, childrenRandom])).toEqual(['children-random', false]);
    });
    it('age unknown: rule 5 alone, unchanged', () => {
      expect(pick('M', null, [childrenRandom, adultsBalanced])[0]).toBe('adults-balanced');
    });
  });

  // Owner AGE-3 (8 Oct, "no warning for those"): age unknown, and the oldest row pickRow falls back to
  // has a band SPANNING 18 (low < 18 < high, e.g. 16–30) → it is an adult row: not flagged, not said.
  // Flag only; the row chosen does not change.
  describe('AGE-3: an adult band spanning 18, age unknown', () => {
    const one = (band: [number, number]) => mkSet({ id: `band-${band.join('-')}`, entries: [deg('m01_SNA', 'pooled', 82, { ageBand: band })] });
    const at = (band: [number, number]) => norm(resolveNorm(q({ population: 'chinese', sets: [one(band)], sex: 'M', ageYears: null })));
    it.each([
      [[16, 30], false], [[15, 30], false], [[17, 19], false],
      [[15, 18], true], [[15, 15], true], [[11, 14], true],
    ] as [[number, number], boolean][])('band %j → age-unknown-oldest-row %s', (band, flagged) => {
      const r = at(band);
      // Ruling T4-1 (Task 4 fix round 1): the stand-in carries its own flag, never 'age-mismatched' (that one says
      // "the nearest age to the patient's", which needs an age).
      expect([r.mean, r.flags.includes('age-unknown-oldest-row'), r.flags.includes('age-mismatched'), r.sourceLine.includes('age unknown; the oldest printed row')]).toEqual([82, flagged, false, flagged]);
    });
  });

  // Task 5 fix round 1: undated sources (the NDC sheet).
  it('review minor 7: an undated name already ending in a bracket gets one bracket, "Data on file (NUS norms, undated)"', () => {
    const base = mkSet({ id: 'undated-synthetic', citation: { authors: 'Synthetic A', title: 'T', undated: true, openAccess: false }, entries: [deg('m01_SNA', 'pooled', 80)] });
    expect(shortCitation({ ...base, citation: { ...base.citation, authors: 'Data on file (NUS norms)' } })).toBe('Data on file (NUS norms, undated)');
    expect(shortCitation(base)).toBe('Synthetic (undated)');
  });
  it('an undated set reads "<name> (undated)" in the source line', () => {
    const u = mkSet({ id: 'undated-synthetic', citation: { authors: 'Synthetic A', title: 'T', undated: true, openAccess: false }, entries: [deg('m01_SNA', 'pooled', 80)] });
    expect(norm(resolveNorm(q({ population: 'chinese', sets: [u] }))).sourceLine).toBe('Synthetic (undated), Chinese, sexes pooled, n = 50, Table 2');
  });

  it('rule 5: an undated set ranks after a dated one on the year tie-break, in either order', () => {
    const e = [deg('m01_SNA', 'pooled', 80)];
    const dated = mkSet({ id: 'dated-old', citation: { authors: 'D', title: 'T', year: 1950, openAccess: true }, entries: e });
    const undated = mkSet({ id: 'undated-x', citation: { authors: 'U', title: 'T', undated: true, openAccess: true }, entries: e });
    const undated2 = mkSet({ id: 'undated-y', citation: { authors: 'V', title: 'T', undated: true, openAccess: true }, entries: e });
    const pick = (sets: NormSet[]) => norm(resolveNorm(q({ population: 'chinese', sets }))).setId;
    expect(pick([undated, dated])).toBe('dated-old');
    expect(pick([dated, undated])).toBe('dated-old');
    expect(pick([undated, undated2])).toBe('undated-x'); // two undated: a tie, the given order stands
  });

  it("rule 6: nothing in the population → the analysis's own norm; nothing there → choose one (owner NORM-PICK-1, never the user norm silently); no population → user norms (first by name); nothing → none with a plain reason", () => {
    // OWNFALL-1/N-A3 (12/19 Oct): before, Steiner's own norm stood in here unflagged; now it's Auto (was 'choose').
    expect(norm(resolveNorm(q({ population: 'saudi' }))).auto?.step).toBe('analysis-own');
    // Choosing the own norms directly is not a fallback.
    expect(norm(resolveNorm(q({ population: 'analysis-own' }))).setId).toBe('steiner-own');
    // The own norm of a different analysis is not used; no Caucasian set in these fixtures, so step 4 (AUTO-Q6): sex and
    // age not entered → the adult row: Chen (band-less, sample 80) and Malay (band-less, 50) have one, Wu has none → Chen.
    const notMine = norm(resolveNorm(q({ population: 'saudi', analysisId: 'downs' })));
    expect([notMine.setId, notMine.auto?.step]).toEqual(['chen-synthetic', 'anywhere']);
    // AUTO-Q11: only the user norms Zeta and Alpha have Wits (never an Auto candidate) — stays 'choose', as before.
    expect(resolveNorm(q({ measurement: 'm13_Wits', analysisId: 'wits', population: 'saudi' })))
      .toEqual({ kind: 'choose', population: 'saudi', reason: 'no Saudi norm — choose one' });
    const user = norm(resolveNorm(q({ measurement: 'm13_Wits', analysisId: 'wits', population: null })));
    expect([user.setId, user.mean, user.flags]).toEqual(['user:Alpha', 0, ['user-norm']]);
    const none = resolveNorm(q({ measurement: 'm14_APDI', analysisId: 'kim', population: 'saudi' }));
    expect(none).toEqual({ kind: 'none', reason: 'No norm for this measurement in Saudi or Kim or your norms.' });
  });

  it('rule 7: coloured only with an SD (own, sdSource or borrowed) and not a website value; ranges, and SD-less ideals when no donor is found, never', () => {
    expect(norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12 }))).colour).toBe(true);
    const ideal = norm(resolveNorm(q({ population: 'analysis-own', sets: NO_DONORS })));
    expect([ideal.sd, ideal.colour]).toEqual([null, false]);
    const web = norm(resolveNorm(q({ measurement: 'm20_SNGoGn', population: 'analysis-own' })));
    expect([web.setId, web.sd, web.colour]).toEqual(['steiner-website', 4, false]);
    const range = norm(resolveNorm(q({ measurement: 'm03_ANB', population: 'analysis-own' })));
    expect([range.mean, range.range, range.colour]).toEqual([null, { low: 0, high: 4 }, false]);
    const borrowed = norm(resolveNorm(q({ measurement: 'm02_SNB', population: 'analysis-own' })));
    expect([borrowed.mean, borrowed.sd, borrowed.colour]).toEqual([80, 3.4, true]);
    expect(borrowed.flags).toContain('sd-from-other-paper');
  });

  it('rule 8: flags close, second-hand, website and unverified', () => {
    expect(norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'chinese' }))).flags).toContain('close');
    expect(norm(resolveNorm(q({ measurement: 'm34_Saddle', analysisId: 'bjork-jarabak', population: 'analysis-own' }))).flags).toContain('second-hand');
    expect(norm(resolveNorm(q({ measurement: 'm20_SNGoGn', population: 'analysis-own' }))).flags).toContain('website');
    expect(norm(resolveNorm(q({ population: 'jordanian' }))).flags).toContain('unverified');
    expect(norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12 }))).flags).toEqual([]);
  });

  it('rule 9: the source line is plain words built from the set and entry', () => {
    const line = (o: Partial<NormQuery>) => norm(resolveNorm(q(o))).sourceLine;
    expect(line({ population: 'chinese', sex: 'M', ageYears: 12 })).toBe('Wu 2007, Chinese (Hong Kong), 11–14 y, boys, n = 100, Table 2');
    expect(line({ population: 'chinese', sex: 'M', ageYears: 30 })).toBe('Wu 2007, Chinese (Hong Kong), 18–40 y, men, Table 2');
    expect(line({ population: 'chinese', sex: 'F', ageYears: 8 })).toBe('Wu 2007, Chinese (Hong Kong), 7–10 y, boys and girls, Table 2');
    expect(line({ measurement: 'm46_U1NAmm', population: 'chinese' })).toBe(
      'Chen 2015, Chinese, sexes pooled, n = 80, Table 4 · paper measured from the labial surface · film scale not stated in the paper; assumed true size, as modern papers report',
    );
    expect(line({ measurement: 'm20_SNGoGn', population: 'analysis-own' })).toMatch(/ · website value, not from a paper$/);
    expect(line({ measurement: 'm02_SNB', population: 'analysis-own' })).toMatch(/ · SD from Kim 2025 Table 3$/);
    expect(line({ measurement: 'm13_Wits', analysisId: 'wits', population: 'user:Zeta' })).toBe('Zeta · your norm: clinic sample 2024');
    expect(line({ measurement: 'm34_Saddle', analysisId: 'bjork-jarabak', population: 'analysis-own' })).toMatch(/via Quoter 2022 Table 3/);
    // An own norm names no population; a surname of several words and an organisation keep every word.
    expect(line({ population: 'analysis-own', sets: NO_DONORS })).toBe('Steiner 1953, sexes pooled, p. 731 · no SD in this paper and no matching SD to borrow');
    expect(line({ measurement: 'm20_SNGoGn', population: 'analysis-own' })).toBe('Some Website 2024, sexes pooled, web page · website value, not from a paper');
    const alM = mkSet({ id: 'al-m', citation: { authors: 'Al Maaitah E, Other O', title: 'T', year: 2022, openAccess: true }, entries: [deg('m01_SNA', 'pooled', 80)] });
    expect(norm(resolveNorm(q({ population: 'chinese', sets: [alM] }))).sourceLine).toBe('Al Maaitah 2022, Chinese, sexes pooled, n = 50, Table 2');
  });
});

describe('zScore and band', () => {
  const boy = () => norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12 }))); // mean 82, SD 4
  it('z and band at 0.99, 1.0, 1.01, 2.0 and 2.01 SD (both sides)', () => {
    const r = boy();
    const cases: [number, 'neutral' | 'amber' | 'red'][] = [[0.99, 'neutral'], [1.0, 'neutral'], [1.01, 'amber'], [2.0, 'amber'], [2.01, 'red']];
    for (const [k, want] of cases) {
      for (const sign of [1, -1]) {
        const z = zScore(82 + sign * k * 4, r)!;
        expect(z).toBeCloseTo(sign * k, 9);
        expect(band(z)).toBe(want);
      }
    }
  });
  it('zScore is null for a website value, a range, an ideal with no SD and none', () => {
    expect(zScore(40, resolveNorm(q({ measurement: 'm20_SNGoGn', population: 'analysis-own' })))).toBeNull();
    expect(zScore(2, resolveNorm(q({ measurement: 'm03_ANB', population: 'analysis-own' })))).toBeNull();
    expect(zScore(85, resolveNorm(q({ population: 'analysis-own', sets: NO_DONORS })))).toBeNull();
    expect(zScore(1, resolveNorm(q({ measurement: 'm14_APDI', analysisId: 'kim', population: 'saudi' })))).toBeNull();
    expect(zScore(86, boy())).toBe(1);
  });
});

describe('resolveAcross and populationsOffered', () => {
  it('resolveAcross returns one result per population, in the order asked', () => {
    const rs = resolveAcross(q({ sex: 'M', ageYears: 12, clinicDefault: 'jordanian' }), ['jordanian', 'chinese', 'saudi', 'user:Zeta']);
    expect(rs).toHaveLength(4);
    // Ruling AUTO-Q7 (19 Oct 2026): Compare columns are a population's own norm or none (was 'choose', NORM-PICK-1).
    expect(rs.map((r) => (r.kind === 'norm' ? r.setId : r.kind))).toEqual(['malay-synthetic', 'wu-synthetic', 'none', 'none']);
  });
  it('populationsOffered lists set populations (not pending-only or research-only) then user: sets, with labels from POPULATIONS', () => {
    expect(populationsOffered(SETS, USER)).toEqual([
      { id: 'chinese', label: 'Chinese' },
      // Owner rulings 7 Nov 2026: Malay falls back to the Chinese norms, so it is offered when Chinese is.
      { id: 'malay', label: 'Malay' },
      { id: 'jordanian', label: 'Middle-Eastern / Jordanian' },
      { id: 'analysis-own', label: "The analysis's own norms" },
      { id: 'user:Alpha', label: 'Alpha (your norms)' },
      { id: 'user:Zeta', label: 'Zeta (your norms)' },
    ]);
  });
});

describe('fix round 1', () => {
  it('rule 9 (finding 4): a sex row without its own n quotes nMale / nFemale, never the whole sample; a banded row without n quotes none', () => {
    const s = mkSet({ id: 'sexed', sample: { n: 200, nMale: 120, nFemale: 80 }, entries: [
      deg('m01_SNA', 'M', 80), deg('m01_SNA', 'F', 81), deg('m02_SNB', 'pooled', 78), deg('m03_ANB', 'M', 2, { ageBand: [11, 14] }) ] });
    const noSplit = mkSet({ id: 'nosplit', sample: { n: 200 }, entries: [deg('m01_SNA', 'M', 80)] });
    const line = (o: Partial<NormQuery>) => norm(resolveNorm(q({ population: 'chinese', sets: [s], ...o }))).sourceLine;
    expect(line({ sex: 'M' })).toBe('Synthetic 2020, Chinese, male, n = 120, Table 2');
    expect(line({ sex: 'F' })).toBe('Synthetic 2020, Chinese, female, n = 80, Table 2');
    expect(line({ measurement: 'm02_SNB', sex: 'F' })).toBe('Synthetic 2020, Chinese, sexes pooled, n = 200, Table 2');
    expect(line({ measurement: 'm03_ANB', sex: 'M', ageYears: 12 })).toBe('Synthetic 2020, Chinese, 11–14 y, boys, Table 2');
    expect(norm(resolveNorm(q({ population: 'chinese', sets: [noSplit], sex: 'M' }))).sourceLine).toBe('Synthetic 2020, Chinese, male, Table 2');
  });

  it('finding 5: a user norm with an SD of 0 or below has no SD and is not coloured', () => {
    for (const sd of [0, -1]) {
      const r = norm(resolveNorm(q({ measurement: 'm13_Wits', analysisId: 'wits', population: 'user:Bad', userNorms: [{ setName: 'Bad', measurement: 'm13_Wits', mean: 0, sd, sourceNote: 'x' }] })));
      expect([r.sd, r.colour, zScore(5, r)]).toEqual([null, false, null]);
    }
  });

  describe('finding 2: a borrowed SD (sdSource)', () => {
    const OWN_POP = { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] as string[] };
    const own = (e: Partial<NormEntry>) => mkSet({ id: 'own-x', kind: 'analysis-own', analyses: ['steiner'], population: OWN_POP,
      citation: { authors: 'Steiner C', title: 'T', year: 1953, openAccess: false }, sample: {}, selection: 'ideal-aesthetic',
      entries: [{ measurement: 'm02_SNB', sex: 'pooled', mean: 80, unit: 'deg', source: 'p. 731', definitionMatch: 'same', sdSource: { set: 'sdsrc', source: 'Table 3' }, ...e } as NormEntry] });
    const src = (entries: NormEntry[], extra: Partial<NormSet> = {}) => mkSet({ id: 'sdsrc', kind: 'research-sd',
      population: { id: 'caucasian', label: 'Caucasian', ethnicity: [] }, citation: { authors: 'Kim K', title: 'T', year: 2025, openAccess: true }, entries, ...extra });
    const res = (sets: NormSet[], o: Partial<NormQuery> = {}) => norm(resolveNorm(q({ measurement: 'm02_SNB', population: 'analysis-own', sets, ...o })));

    it('a pending source set never supplies an SD (no colour, no flag)', () => {
      const r = res([own({}), src([deg('m02_SNB', 'pooled', 78, { sd: 3.4, source: 'Table 3' })], { status: 'pending' })]);
      expect([r.sd, r.colour, r.flags.includes('sd-from-other-paper')]).toEqual([null, false, false]);
    });
    it("a 'different' source row never supplies an SD", () => {
      const r = res([own({}), src([deg('m02_SNB', 'pooled', 78, { sd: 3.4, definitionMatch: 'different', definitionNote: 'other plane' })])]);
      expect([r.sd, r.colour]).toEqual([null, false]);
    });
    it("an SD row of another sex is never used (pooled entry, boys-only source; even for a boy)", () => {
      const r = res([own({}), src([deg('m02_SNB', 'M', 78, { sd: 3.4 })])], { sex: 'M', ageYears: 12 });
      expect([r.sd, r.colour]).toEqual([null, false]);
      // A girls' entry borrowing from a boys-only source: none either.
      const g = res([own({ sex: 'F' }), src([deg('m02_SNB', 'M', 78, { sd: 3.4 })])], { sex: 'F' });
      expect([g.sd, g.colour]).toEqual([null, false]);
    });
    it("the SD row matches the entry's own sex and band first, whatever the patient's sex and age", () => {
      const rows = [deg('m02_SNB', 'pooled', 78, { sd: 3.0, source: 'Table 3' }), deg('m02_SNB', 'M', 78, { sd: 9.0, ageBand: [11, 14], source: 'Table 4' })];
      const r = res([own({}), src(rows)], { sex: 'M', ageYears: 12 });
      // The own set never splits SNB by sex, so no sex-pooled flag (P16); the SD row itself matches exactly.
      expect([r.sd, r.flags]).toEqual([3.0, ['sd-from-other-paper']]);
      expect(r.sourceLine).toMatch(/ · SD from Kim 2025 Table 3$/);
      const unsexed = res([own({}), src(rows)], { sex: null, ageYears: 12 });
      expect([unsexed.sd, unsexed.flags]).toEqual([3.0, ['sd-from-other-paper']]);
    });
    it('a mismatch on the SD row is flagged and said: pooled SD for a boys\' entry, another age row, a close row; the line cites the row used', () => {
      const pooledSd = res([own({ sex: 'M' }), src([deg('m02_SNB', 'pooled', 78, { sd: 3.4, source: 'Table 5' })])], { sex: 'M' });
      expect(pooledSd.sd).toBe(3.4);
      // Ruling T4-1: only the SD's row differs, so the SD flags say so — never the norm's own 'sex-pooled'/'age-mismatched'/'close'.
      expect(pooledSd.flags).toEqual(['sd-from-other-paper', 'sd-sexes-pooled']);
      expect(pooledSd.sourceLine).toMatch(/ · SD from Kim 2025 Table 5 \(sexes pooled\)$/);
      const otherAge = res([own({ ageBand: [11, 14] }), src([deg('m02_SNB', 'pooled', 78, { sd: 3.4, ageBand: [18, 30] })])], { ageYears: 12 });
      expect(otherAge.sd).toBe(3.4);
      expect(otherAge.flags).toEqual(['sd-from-other-paper', 'sd-other-age']);
      expect(otherAge.sourceLine).toMatch(/SD from Kim 2025 Table 2 \(18–30 y\)$/);
      const close = res([own({}), src([deg('m02_SNB', 'pooled', 78, { sd: 3.4, definitionMatch: 'close', definitionNote: 'paper used Go–Gn' })])]);
      expect(close.flags).toEqual(['sd-from-other-paper', 'sd-close']);
      expect(close.sourceLine).toMatch(/SD from Kim 2025 Table 2 · paper used Go–Gn$/);
    });
  });

  it('P14a: a website set ranks after a paper even when rule 5 alone would prefer it', () => {
    const OWN_POP = { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] as string[] };
    const web = mkSet({ id: 'web', kind: 'analysis-own', analyses: ['steiner'], status: 'website', population: OWN_POP,
      selection: 'class-I-balanced', sample: { n: 1000 }, citation: { authors: 'Web', title: 'T', year: 2025, openAccess: true }, entries: [deg('m01_SNA', 'pooled', 80, { sd: undefined })] });
    const paper = mkSet({ id: 'paper', kind: 'analysis-own', analyses: ['steiner'], population: OWN_POP,
      selection: 'unknown', sample: { n: 5 }, citation: { authors: 'P', title: 'T', year: 1950, openAccess: true }, entries: [deg('m01_SNA', 'pooled', 82)] });
    expect(norm(resolveNorm(q({ population: 'analysis-own', sets: [web, paper] }))).setId).toBe('paper');
  });

  it("P14b: age before sex — a girl of 8 gets the pooled 7–10 row, not the girls' 11–14 row", () => {
    const r = norm(resolveNorm(q({ population: 'chinese', sex: 'F', ageYears: 8 })));
    expect([r.entry.sex, r.ageRowUsed, r.flags]).toEqual(['pooled', '7–10 y', ['sex-pooled']]);
  });

  it('P14c: with no population chosen the own norm is used without the own-norm-fallback flag', () => {
    const r = norm(resolveNorm(q({ population: null, clinicDefault: null })));
    expect([r.setId, (r.flags as string[]).includes('own-norm-fallback')]).toEqual(['steiner-own', false]);
  });

  it('P16: sex-pooled only when the chosen set splits that measurement by sex somewhere and the row used is pooled', () => {
    const pooledOnly = mkSet({ id: 'pooled-only', entries: [deg('m01_SNA', 'pooled', 80)] });
    const boysOnly = mkSet({ id: 'boys-only', entries: [deg('m01_SNA', 'M', 81), deg('m01_SNA', 'pooled', 80)] });
    const r = (sets: NormSet[], sex: 'M' | 'F' | null) => norm(resolveNorm(q({ population: 'chinese', sets, sex })));
    // (a) a set that never splits SNA by sex: no flag even though the patient's sex is known.
    expect(r([pooledOnly], 'F').flags).not.toContain('sex-pooled');
    expect(r([pooledOnly], 'M').flags).not.toContain('sex-pooled');
    // (b) boys' rows exist, the girl gets the pooled row: flagged.
    const girl = r([boysOnly], 'F');
    expect([girl.entry.sex, girl.flags]).toEqual(['pooled', ['sex-pooled']]);
    // The boy gets his own row; an unknown sex is never flagged.
    expect([r([boysOnly], 'M').entry.sex, r([boysOnly], 'M').flags]).toEqual(['M', []]);
    expect(r([boysOnly], null).flags).toEqual([]);
    // Steiner's ideals (pooled only) for a boy: no flag.
    expect(norm(resolveNorm(q({ population: 'analysis-own', sex: 'M', ageYears: 12, sets: NO_DONORS }))).flags).toEqual([]);
  });
});

describe('rules 10-12: film scale (Task 4b, owner M-1/M-2)', () => {
  it('rule 10: an mm entry in an 8% enlarged set is divided to true size; printed holds the stored values; flagged; the z uses converted values', () => {
    const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'chinese', sets: [SCALE_ENLARGED] })));
    expect(r.mean).toBeCloseTo(74.074074, 6);
    expect(r.sd).toBeCloseTo(2.777778, 6);
    expect(r.range!.low).toBeCloseTo(69.444444, 6);
    expect(r.range!.high).toBeCloseTo(78.703704, 6);
    expect(r.printed).toEqual({ mean: 80, sd: 3, range: { low: 75, high: 85 } });
    expect(r.flags).toContain('converted-to-true-size');
    expect(r.sourceLine).toContain('converted from 8% film enlargement (p. 100)');
    expect(r.sourceLine).toContain('printed 80 mm');
    expect(zScore(r.mean!, r)).toBeCloseTo(0, 9);
  });

  it('rule 12: a degree entry in the same enlarged set is never converted or flagged', () => {
    const r = norm(resolveNorm(q({ measurement: 'm01_SNA', population: 'chinese', sets: [SCALE_ENLARGED] })));
    expect(r.mean).toBe(82);
    expect(r.printed).toBeNull();
    expect(r.flags).not.toContain('converted-to-true-size');
    expect(r.flags).not.toContain('scale-assumed');
  });

  it('rule 12: a % entry and a ratio entry in the same enlarged set are untouched', () => {
    const pct = norm(resolveNorm(q({ measurement: 'm29_LAFHpct', population: 'chinese', sets: [SCALE_ENLARGED] })));
    expect([pct.mean, pct.printed, pct.flags]).toEqual([60, null, []]);
    const ratio = norm(resolveNorm(q({ measurement: 'm43_SNtoGoMe', population: 'chinese', sets: [SCALE_ENLARGED] })));
    expect([ratio.mean, ratio.printed, ratio.flags]).toEqual([1.2, null, []]);
  });

  it('rule 10: a range-only mm entry (no mean) in a 10% enlarged set has both ends divided; the source line quotes the printed range', () => {
    const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'chinese', sets: [SCALE_ENLARGED_RANGE_ONLY] })));
    expect(r.mean).toBeNull();
    expect(r.range!.low).toBeCloseTo(50, 9); // 55 / 1.1
    expect(r.range!.high).toBeCloseTo(60, 9); // 66 / 1.1
    expect(r.printed).toEqual({ mean: null, sd: null, range: { low: 55, high: 66 } });
    expect(r.sourceLine).toContain('printed 55–66 mm');
  });

  it("rule 11: a not-stated set's mm entry is unchanged, flagged scale-assumed, with the required wording", () => {
    const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'chinese', sets: [SCALE_NOT_STATED] })));
    expect([r.mean, r.sd, r.printed]).toEqual([50, 2, null]);
    expect(r.flags).toContain('scale-assumed');
    expect(r.sourceLine).toContain('film scale not stated in the paper; assumed true size, as modern papers report');
  });

  it("rule 11/12: the same not-stated set's degree entry is never flagged", () => {
    const r = norm(resolveNorm(q({ measurement: 'm01_SNA', population: 'chinese', sets: [SCALE_NOT_STATED] })));
    expect(r.flags).not.toContain('scale-assumed');
    expect(r.printed).toBeNull();
  });

  it('a true-size mm entry is unchanged and never flagged', () => {
    const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'chinese', sets: [SCALE_TRUE_SIZE] })));
    expect([r.mean, r.sd, r.printed]).toEqual([50, 2, null]);
    expect(r.flags).not.toContain('converted-to-true-size');
    expect(r.flags).not.toContain('scale-assumed');
  });

  it('an sdSource SD borrowed from an enlarged set is converted by that set\'s scale', () => {
    const OWN_POP = { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] as string[] };
    const own = mkSet({
      id: 'own-scale', kind: 'analysis-own', analyses: ['steiner'], population: OWN_POP,
      citation: { authors: 'Steiner C', title: 'T', year: 1953, openAccess: false }, sample: {}, selection: 'ideal-aesthetic',
      entries: [{ measurement: 'm46_U1NAmm', sex: 'pooled', mean: 5, sdSource: { set: 'sd-src-enlarged', source: 'Table 1' }, unit: 'mm', source: 'p. 731', definitionMatch: 'same' }],
    });
    const srcSet = mkSet({
      id: 'sd-src-enlarged', kind: 'research-sd', scale: { kind: 'enlarged', percent: 8, source: 'p. 100' },
      population: { id: 'caucasian', label: 'Caucasian', ethnicity: [] },
      citation: { authors: 'Kim K', title: 'T', year: 2025, openAccess: true },
      entries: [{ measurement: 'm46_U1NAmm', sex: 'pooled', mean: 5, sd: 3.0, unit: 'mm', source: 'Table 1', definitionMatch: 'same' }],
    });
    const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'analysis-own', sets: [own, srcSet] })));
    expect(r.sd).toBeCloseTo(3.0 / 1.08, 9);
    // Fix round 1 (review item 1): the conversion is disclosed, not silent. Ruling T4-1: as the SD's own flag —
    // the mean (a not-stated set) was not converted.
    expect([r.flags.includes('sd-converted'), r.flags.includes('converted-to-true-size')]).toEqual([true, false]);
    expect(r.sourceLine).toContain('converted from 8% film enlargement, printed 3 mm');
  });

  // Fix round 1 (review items 1-3): the SD an entry copies verbatim (its own `sd`, cited via
  // `sdSource`) is the SOURCE paper's printed number, converted by the SOURCE set's own scale —
  // never the borrowing (owning) set's scale, and never left unconverted and uncoloured.
  describe('fix round 1: copied sd + sdSource scale (owner review, ruling P28)', () => {
    const own = (extra: Partial<NormSet> = {}) => mkSet({
      id: 'own-copied-sd', kind: 'analysis-own', analyses: ['steiner'],
      population: { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] },
      citation: { authors: 'Steiner C', title: 'T', year: 1953, openAccess: false }, sample: {}, selection: 'ideal-aesthetic',
      scale: { kind: 'enlarged', percent: 8, source: 'p. 731' },
      entries: [{ measurement: 'm46_U1NAmm', sex: 'pooled', mean: 80, sd: 3.0, sdSource: { set: 'sd-src-copied', source: 'Table 1' }, unit: 'mm', source: 'p. 731', definitionMatch: 'same' }],
      ...extra,
    });

    it('(a) a copied sd with sdSource from an enlarged source set is divided by the SOURCE scale', () => {
      const src = mkSet({
        id: 'sd-src-copied', kind: 'research-sd', scale: { kind: 'enlarged', percent: 10, source: 'p. 100' },
        population: { id: 'caucasian', label: 'Caucasian', ethnicity: [] },
        citation: { authors: 'Kim K', title: 'T', year: 2025, openAccess: true },
        entries: [],
      });
      const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'analysis-own', sets: [own(), src] })));
      expect(r.sd).toBeCloseTo(3.0 / 1.1, 9); // divided by the SOURCE's 10%, not the owning set's 8%
      // Ruling T4-1: the mean (owning set, 8%) and the SD (source set, 10%) were each converted — one flag each.
      expect([r.flags.includes('converted-to-true-size'), r.flags.includes('sd-converted')]).toEqual([true, true]);
      expect(r.sourceLine).toContain('converted from 10% film enlargement, printed 3 mm');
    });

    it('(b) the owning set enlarged but the source set not-stated: sd stays unconverted while mean is converted', () => {
      const src = mkSet({
        id: 'sd-src-copied', kind: 'research-sd',
        population: { id: 'caucasian', label: 'Caucasian', ethnicity: [] },
        citation: { authors: 'Kim K', title: 'T', year: 2025, openAccess: true },
        entries: [],
      });
      const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'analysis-own', sets: [own(), src] })));
      expect(r.sd).toBe(3.0); // unconverted: the source paper never stated a film scale
      expect(r.mean).toBeCloseTo(80 / 1.08, 9); // the owning set's own 8% still applies to the mean
      // The flag and source-line suffix are legitimately present (the MEAN was converted, by the
      // owning set's own 8%); the SD clause itself carries no "converted from ... printed" note.
      expect([r.flags.includes('converted-to-true-size'), r.flags.includes('sd-converted')]).toEqual([true, false]);
      expect(r.sourceLine).not.toMatch(/printed 3 mm/);
    });

    // Task 6 preliminary (Task 4c review): the explicit sdSource path discloses a source that never
    // stated its film scale, as the rule 15 donor path does.
    it('an mm SD via sdSource from a not-stated source set says the source scale was assumed true size', () => {
      const src = mkSet({
        id: 'sd-src-copied', kind: 'research-sd',
        population: { id: 'caucasian', label: 'Caucasian', ethnicity: [] },
        citation: { authors: 'Kim K', title: 'T', year: 2025, openAccess: true },
        entries: [{ measurement: 'm46_U1NAmm', sex: 'pooled', mean: 5, sd: 2.5, unit: 'mm', source: 'Table 1', definitionMatch: 'same' }],
      });
      // copied sd, and a looked-up row (no sd on the entry)
      const copied = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'analysis-own', sets: [own({ scale: { kind: 'not-stated' } }), src] })));
      expect(copied.sourceLine).toContain("Kim 2025 Table 1 (source's film scale not stated; assumed true size)");
      const lookedUp = own({ scale: { kind: 'not-stated' } });
      lookedUp.entries = [{ ...lookedUp.entries[0], sd: undefined }];
      const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'analysis-own', sets: [lookedUp, src] })));
      expect(r.sd).toBe(2.5);
      expect(r.sourceLine).toContain("(source's film scale not stated; assumed true size)");
    });

    it('a degree SD via sdSource from a not-stated source carries no scale clause', () => {
      const src = mkSet({
        id: 'kim-research-deg', kind: 'research-sd',
        population: { id: 'caucasian', label: 'Caucasian', ethnicity: [] },
        citation: { authors: 'Kim K', title: 'T', year: 2025, openAccess: true },
        entries: [deg('m02_SNB', 'pooled', 78, { sd: 3.4, source: 'Table 3' })],
      });
      const o = mkSet({
        id: 'own-deg', kind: 'analysis-own', analyses: ['steiner'],
        population: { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] },
        citation: { authors: 'Steiner C', title: 'T', year: 1953, openAccess: false }, sample: {}, selection: 'ideal-aesthetic',
        entries: [{ measurement: 'm02_SNB', sex: 'pooled', mean: 80, sdSource: { set: 'kim-research-deg', source: 'Table 3' }, unit: 'deg', source: 'p. 731', definitionMatch: 'same' }],
      });
      const r = norm(resolveNorm(q({ measurement: 'm02_SNB', population: 'analysis-own', sets: [o, src] })));
      expect(r.sd).toBe(3.4);
      expect(r.sourceLine).not.toContain('film scale not stated; assumed');
    });

    it('(ruling P28) the owning set is enlarged and the sdSource set is not loaded: the SD is dropped, not coloured, and the line says why', () => {
      const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'analysis-own', sets: [own()] }))); // 'sd-src-copied' absent from sets
      expect(r.sd).toBeNull();
      expect(r.colour).toBe(false);
      expect(r.sourceLine).toContain('SD source sd-src-copied not loaded; not coloured');
      expect(r.flags).not.toContain('sd-from-other-paper');
    });

    it('a missing sdSource set does not drop the SD when the owning set is not enlarged (unchanged Task 3 behaviour)', () => {
      const notEnlarged = own({ scale: { kind: 'not-stated' } });
      const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'analysis-own', sets: [notEnlarged] })));
      expect(r.sd).toBe(3.0);
      expect(r.sourceLine).not.toContain('not loaded');
    });
  });

  it('a user norm in mm is never converted even when the id matches a measurement used elsewhere in an enlarged set', () => {
    const r = norm(resolveNorm(q({
      measurement: 'm46_U1NAmm', analysisId: 'wits', population: 'user:Gamma',
      userNorms: [{ setName: 'Gamma', measurement: 'm46_U1NAmm', mean: 80, sd: 3, sourceNote: 'clinic' }],
    })));
    expect([r.mean, r.sd, r.printed]).toEqual([80, 3, null]);
    expect(r.flags).not.toContain('converted-to-true-size');
  });
});

// Task 4c, owner rulings B-1/B-2 (8 Oct): a norm with no SD of its own borrows one from a paper that
// measured the same thing in a similar group, and says so; ideals (centre: 'ideal') are marked.
describe('rules 13-17: borrowed SDs (Task 4c, owner B-1/B-2)', () => {
  const CN = { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] };
  const MY = { id: 'jordanian', label: 'Malay', ethnicity: ['Malay'] };   // any unaliased population (was 'malay', see MALAY)
  const JP = { id: 'japanese', label: 'Japanese', ethnicity: ['Japanese'] };
  const OWN_POP = { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] as string[] };
  const bare = (measurement: string, extra: Partial<NormEntry> = {}): NormEntry =>
    ({ measurement, sex: 'pooled', mean: 80, unit: 'deg', source: 'Table 1', definitionMatch: 'same', ...extra }) as NormEntry;
  // The chosen paper: Chinese, SNA with no SD. class-I-balanced, so it outranks every Chinese donor (rule 5).
  // Owner AGE-1 (Task 9a-1 fix round 1): a set whose band covers the patient's age now ranks first, and a
  // band-less row covers no age, so the chosen paper's rows get an open band from 0 (every age) — it
  // must stay the chosen set whatever the patient's age, as these tests are about the donor search.
  const chosen = (entries: NormEntry[] = [bare('m01_SNA')], extra: Partial<NormSet> = {}) => mkSet({
    id: 'chosen-cn', selection: 'class-I-balanced', sample: { n: 30 }, population: CN,
    citation: { authors: 'Lee A, Other B', title: 'T', year: 2010, openAccess: true },
    entries: entries.map((e) => (e.ageBand ? e : { ...e, ageBand: [0, 99] as [number, number] })), ...extra });
  const CHOSEN = chosen();
  const donor = (id: string, population: NormSet['population'], authors: string, year: number | null, entries: NormEntry[], extra: Partial<NormSet> = {}, opts: { bandlessBesideBands?: boolean } = {}) =>
    mkSet({ id, population, sample: { n: 40 }, entries, ...extra,
      citation: year === null ? { authors, title: 'T', undated: true, openAccess: true } : { authors, title: 'T', year, openAccess: true } }, opts);
  const sdRow = (sex: 'M' | 'F' | 'pooled', sd: number, ageBand?: [number, number], extra: Partial<NormEntry> = {}, measurement = 'm01_SNA') =>
    deg(measurement, sex, 80, { sd, source: 'Table 3', ...(ageBand ? { ageBand } : {}), ...extra });
  const res = (sets: NormSet[], o: Partial<NormQuery> = {}) =>
    norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12, sets: [CHOSEN, ...sets], ...o })));
  const own = (entry: NormEntry) => mkSet({ id: 'own-ideal', kind: 'analysis-own', analyses: ['steiner'], population: OWN_POP,
    citation: { authors: 'Steiner C', title: 'T', year: 1953, openAccess: false }, sample: {}, selection: 'ideal-aesthetic',
    entries: [{ ...entry, source: 'p. 731' }] });
  const ownRes = (sets: NormSet[], measurement = 'm01_SNA') => norm(resolveNorm(q({ measurement, population: 'analysis-own', sets })));

  const TAN = donor('tan', CN, 'Tan K', 2015, [sdRow('M', 2.5, [11, 14], { n: 40 })]); // tier 1 for a boy of 12
  const ONG = donor('ong', CN, 'Ong P', 2016, [sdRow('M', 3.5, [18, 30])]); // same population, adult: ANOTHER age for a boy (SDLEND-1a: still before any other population)
  const ALI = donor('ali', MY, 'Ali R', 2018, [sdRow('M', 4.5, [11, 14])]); // another population, a similar age

  it('rule 13: an entry with no SD and no sdSource borrows one; an entry with its own SD never does', () => {
    const r = res([TAN]);
    expect([r.sd, r.colour]).toEqual([2.5, true]);
    expect(r.sdDonor).toEqual({ setId: 'tan', source: 'Table 3', sex: 'M', ageRowUsed: '11–14 y', n: 40 });
    const withSd = norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12, sets: [chosen([bare('m01_SNA', { sd: 3 })]), TAN] })));
    expect([withSd.sd, withSd.sdDonor, withSd.flags.includes('sd-borrowed')]).toEqual([3, null, false]);
  });

  it('rule 13: an explicit sdSource always wins, even when it supplies nothing (no search)', () => {
    const snbDonor = donor('ali-snb', MY, 'Ali R', 2018, [sdRow('pooled', 9, undefined, {}, 'm02_SNB')]);
    const ownSnb = own({ measurement: 'm02_SNB', sex: 'pooled', mean: 80, sdSource: { set: 'kim-research', source: 'Table 3' }, unit: 'deg', source: 'x', definitionMatch: 'same' });
    const r = ownRes([ownSnb, KIM_RESEARCH, snbDonor], 'm02_SNB');
    expect([r.sd, r.sdDonor, r.flags.includes('sd-borrowed')]).toEqual([3.4, null, false]);
    const kimPending = mkSet({ ...KIM_RESEARCH, status: 'pending' });
    const none = ownRes([ownSnb, kimPending, snbDonor], 'm02_SNB');
    expect([none.sd, none.colour, none.sdDonor, none.flags.includes('sd-borrowed')]).toEqual([null, false, null, false]);
    expect(none.sourceLine).not.toMatch(/borrow/);
  });

  it('rule 13: a website entry never borrows (N4: website values are never coloured)', () => {
    const web = mkSet({ id: 'web-cn', status: 'website', population: CN, entries: [bare('m01_SNA')] });
    const r = norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12, sets: [web, ALI] })));
    expect([r.setId, r.sd, r.colour, r.sdDonor, r.flags.includes('sd-borrowed')]).toEqual(['web-cn', null, false, null, false]);
    expect(r.sourceLine).not.toMatch(/borrow|no SD in this paper/);
  });

  it("rule 14: a range-only ideal is centred on its range's midpoint; a range-only sample entry borrows nothing", () => {
    const anbDonor = donor('ali-anb', MY, 'Ali R', 2018, [sdRow('pooled', 2, undefined, {}, 'm03_ANB')]);
    const rangeEntry = { measurement: 'm03_ANB', sex: 'pooled', range: { low: 0, high: 4 }, unit: 'deg', source: 'x', definitionMatch: 'same' } as NormEntry;
    const ideal = ownRes([own({ ...rangeEntry, centre: 'ideal' }), anbDonor], 'm03_ANB');
    expect([ideal.mean, ideal.sd, ideal.colour]).toEqual([2, 2, true]);
    expect(ideal.flags).toEqual(expect.arrayContaining(['ideal', 'sd-borrowed']));
    expect(ideal.sourceLine).toMatch(/ · centre = midpoint of the author's range$/);
    expect(zScore(4, ideal)).toBe(1);
    const sample = ownRes([own(rangeEntry), anbDonor], 'm03_ANB');
    expect([sample.mean, sample.sd, sample.colour, sample.sdDonor, sample.flags.includes('sd-borrowed')]).toEqual([null, null, false, null, false]);
    expect(sample.sourceLine).not.toMatch(/borrow|midpoint/);
  });

  it('rule 15 (P31, SDLEND-1a): same population and a similar age first; then the same population at any age; then another population of a similar age; then anything else', () => {
    expect(res([ALI, ONG, TAN]).sdDonor?.setId).toBe('tan');
    // SDLEND-1a (owner, 13 Oct, fix round 1): the Bailey & Taylor-type case — the same population has only an ADULT
    // lender, another population has a CHILD lender: the same-population adult wins.
    expect(res([ALI, ONG]).sdDonor?.setId).toBe('ong');
    expect(res([ONG]).sdDonor?.setId).toBe('ong');
    expect(res([ALI]).sdDonor?.setId).toBe('ali');
  });

  it("rule 15 (P31): the patient's own sex beats pooled within a population; an unknown sex takes pooled only", () => {
    const LIM = donor('lim', CN, 'Lim S', 2015, [sdRow('pooled', 2.0, [11, 14])]);
    expect(res([LIM, TAN]).sdDonor?.setId).toBe('tan');
    const p = res([LIM]);
    expect([p.sd, p.sdDonor?.sex]).toEqual([2.0, 'pooled']);
    expect(res([LIM, ONG]).sdDonor?.setId).toBe('lim'); // SDLEND-1: a pooled donor of a similar age beats an own-sex adult (was 'ong', P31 (b))
    const both = donor('both', CN, 'Bo B', 2015, [sdRow('pooled', 2.0, [11, 14]), sdRow('M', 2.5, [11, 14])]);
    expect(res([both]).sd).toBe(2.5);
    expect(res([LIM, TAN], { sex: null }).sdDonor?.setId).toBe('lim');
  });

  describe('P31: the five donor tiers in the owner\'s wording (B-1)', () => {
    it('(a) an unbanded same-population own-sex donor never takes tier 1 for a known age: a band containing the age wins, even with a smaller n', () => {
      const unbanded = donor('all-ages', CN, 'Wide W', 2020, [sdRow('M', 3.3, undefined, { n: 900 })]);
      expect(res([unbanded, TAN]).sdDonor?.setId).toBe('tan');
      // Alone, the unbanded row is still a tier-2 donor (it covers every age).
      expect(res([unbanded]).sdDonor?.setId).toBe('all-ages');
    });
    it('(b) tier 2 (own sex, nearest band of a similar age) beats tier 3 (pooled, band containing the age), in the same population', () => {
      const pooledContaining = donor('lim', CN, 'Lim S', 2015, [sdRow('pooled', 2.0, [11, 14], { n: 900 })]);
      const boys7to10 = donor('ong-young', CN, 'Ong P', 2016, [sdRow('M', 3.5, [7, 10])]);
      expect(res([pooledContaining, boys7to10]).sdDonor?.setId).toBe('ong-young');
      // SDLEND-1: an own-sex row of ANOTHER age (adults, for a boy of 12) no longer beats it.
      expect(res([pooledContaining, ONG]).sdDonor?.setId).toBe('lim');
    });
    it('(c) an unknown sex uses only the pooled tiers (3, then 5); own-sex rows are never candidates', () => {
      const pooledOther = donor('ali-p', MY, 'Ali R', 2018, [sdRow('pooled', 4.0, [11, 14])]);
      expect(res([TAN, ONG, pooledOther], { sex: null }).sdDonor?.setId).toBe('ali-p'); // tier 5
      const pooledSame = donor('lim', CN, 'Lim S', 2015, [sdRow('pooled', 2.0, [7, 10])]);
      expect(res([TAN, pooledOther, pooledSame], { sex: null }).sdDonor?.setId).toBe('lim'); // tier 3 before 5, though its band is further
      expect(res([TAN, ONG], { sex: null }).sd).toBeNull();
    });
    it('tier 3: a pooled band containing the age comes first, then an unbanded pooled row, then the nearest pooled band', () => {
      const containing = donor('p-contain', CN, 'Pc P', 2015, [sdRow('pooled', 2.1, [11, 14], { n: 10 })]);
      const unbanded = donor('p-all', CN, 'Pa P', 2015, [sdRow('pooled', 2.2, undefined, { n: 900 })]);
      const near = donor('p-near', CN, 'Pn P', 2015, [sdRow('pooled', 2.3, [15, 17], { n: 900 })]);
      expect(res([near, unbanded, containing]).sdDonor?.setId).toBe('p-contain');
      expect(res([near, unbanded]).sdDonor?.setId).toBe('p-all');
    });
    it('tier 3 (same population, pooled) beats tier 4 (another population, own sex); tier 4 beats tier 5 (another population, pooled) — all of a similar age', () => {
      const pooledSame = donor('lim', CN, 'Lim S', 2015, [sdRow('pooled', 2.0, [7, 10])]);
      expect(res([ALI, pooledSame]).sdDonor?.setId).toBe('lim');
      const pooledOther = donor('ali-p', MY, 'Ali R', 2018, [sdRow('pooled', 4.0, [11, 14], { n: 900 })]);
      const otherBoys = donor('far', JP, 'Far F', 2015, [sdRow('M', 4.2, [15, 17])]);
      expect(res([pooledOther, otherBoys]).sdDonor?.setId).toBe('far');
      // SDLEND-1a: the same population at ANOTHER age (adults, for a boy of 12) still beats another population's child;
      // between two other populations, the similar age first, even pooled over own sex.
      expect(res([ALI, donor('lim-adult', CN, 'Lim S', 2015, [sdRow('pooled', 2.0, [18, 30])])]).sdDonor?.setId).toBe('lim-adult');
      expect(res([pooledOther, donor('far-adult', JP, 'Far F', 2015, [sdRow('M', 4.2, [18, 30])])]).sdDonor?.setId).toBe('ali-p');
    });
  });

  // Owner SDLEND-1 (13 Oct) as settled in fix round 1: SDLEND-1a, the order — (1) same population and a similar age,
  // (2) same population at any age, (3) another population and a similar age, (4) anything else; within each, P31's own
  // sex before pooled. SDLEND-1b, similar age = the same side of 18 as the patient (a child under 18, an adult 18 and
  // over; age not entered = an adult, AGE-UNK-1): a lender row whose band contains the patient's age, has no band (it
  // holds for every age), or lies on the patient's side of 18 (for a child, a band starting under 18; for an adult, a
  // band starting at 18 or more or reaching past 18 — the adult row of AGE-UNK-1).
  describe('SDLEND-1: same population and a similar age first', () => {
    const KIDS_CN = donor('kids-cn', CN, 'Kid K', 2015, [sdRow('M', 2.5, [11, 14], { n: 900 })]);
    const KIDS_MY = donor('kids-my', MY, 'Kid K', 2015, [sdRow('M', 2.5, [11, 14], { n: 900 })]);
    const MEN_CN = donor('men-cn', CN, 'Man M', 2015, [sdRow('M', 4.2, [18, 30])]);
    const MEN_JP = donor('men-jp', JP, 'Man M', 2015, [sdRow('M', 4.2, [18, 30])]);
    it('SDLEND-1a: an adult (30) takes the same population\'s child SD before another population\'s adult SD', () => {
      expect(res([KIDS_CN, MEN_JP], { ageYears: 30 }).sdDonor?.setId).toBe('kids-cn');
      expect(res([KIDS_CN, MEN_CN], { ageYears: 30 }).sdDonor?.setId).toBe('men-cn'); // same population: the similar age first
    });
    it('another population only: an adult (30) takes the adult lender before the child lender', () => {
      expect(res([KIDS_MY, MEN_JP], { ageYears: 30 }).sdDonor?.setId).toBe('men-jp');
      expect(res([KIDS_MY], { ageYears: 30 }).sdDonor?.setId).toBe('kids-my'); // alone, another age still lends
    });
    it('age not entered counts as an adult', () => {
      expect(res([KIDS_MY, MEN_JP], { ageYears: null }).sdDonor?.setId).toBe('men-jp');
      expect(res([KIDS_CN, MEN_CN], { ageYears: null }).sdDonor?.setId).toBe('men-cn');
    });
    it('the line at 18 (SDLEND-1b): at 17.99 a child (the child lender first), at 18 an adult (the adult lender first)', () => {
      expect(res([KIDS_MY, MEN_JP], { ageYears: 17.99 }).sdDonor?.setId).toBe('kids-my');
      expect(res([KIDS_MY, MEN_JP], { ageYears: 18 }).sdDonor?.setId).toBe('men-jp');
      expect(res([KIDS_CN, MEN_CN], { ageYears: 17.99 }).sdDonor?.setId).toBe('kids-cn');
      expect(res([KIDS_CN, MEN_CN], { ageYears: 18 }).sdDonor?.setId).toBe('men-cn');
    });
    it('an unbanded lender holds for every age, so it is a similar-age lender for a child and an adult', () => {
      const allAges = donor('all-my', MY, 'All A', 2015, [sdRow('M', 3.3)]);
      expect(res([allAges, donor('men-my', MY, 'Man M', 2015, [sdRow('M', 4.2, [18, 30], { n: 900 })])]).sdDonor?.setId).toBe('all-my');
      expect(res([allAges, KIDS_MY], { ageYears: 30 }).sdDonor?.setId).toBe('all-my');
    });
    it('a band spanning 18 (15-40) is a similar age for a child of 12 and for an adult', () => {
      const span = donor('span-my', MY, 'Spa S', 2015, [sdRow('M', 3.1, [15, 40])]);
      expect(res([span, MEN_JP]).sdDonor?.setId).toBe('span-my');
      expect(res([span, KIDS_MY], { ageYears: 30 }).sdDonor?.setId).toBe('span-my');
    });
    // Final review I4: each lender is judged by whether it HOLDS a row of a similar age, and lends from that row —
    // not by its nearest row alone. A set with a child row and a nearer adult row is a similar-age lender for a child.
    it('I4: a boy of 17 borrows from the child row of a set that also holds a nearer adult row', () => {
      const both = donor('both', CN, 'Bot B', 2015, [sdRow('M', 2.5, [10, 12]), sdRow('M', 4.5, [18, 25])]);
      const r = res([both], { ageYears: 17 });
      console.log('I4 17 both-rows ->', r.sdDonor?.setId, r.sd, r.sdDonor?.ageRowUsed);
      expect([r.sdDonor?.setId, r.sd, r.sdDonor?.ageRowUsed]).toEqual(['both', 2.5, '10–12 y']);
    });
    it('I4: that set beats another population\'s child set further away (both similar-age, the nearer row wins)', () => {
      const both = donor('both', MY, 'Bot B', 2015, [sdRow('M', 2.5, [10, 12]), sdRow('M', 4.5, [18, 25])]);
      const kidOther = donor('kid-other', MY, 'Kid O', 2014, [sdRow('M', 3.0, [8, 10])]);
      const r = res([both, kidOther], { ageYears: 17 });
      console.log('I4 17 other-population ->', r.sdDonor?.setId, r.sd, r.sdDonor?.ageRowUsed);
      expect([r.sdDonor?.setId, r.sd]).toEqual(['both', 2.5]);
    });
    it('I4: an adult of 18 borrows the adult row, not a nearer child row of the same set', () => {
      const both = donor('both', CN, 'Bot B', 2015, [sdRow('M', 2.5, [15, 17]), sdRow('M', 4.5, [25, 40])]);
      const r = res([both], { ageYears: 18 });
      console.log('I4 18 ->', r.sdDonor?.setId, r.sd, r.sdDonor?.ageRowUsed);
      expect([r.sd, r.sdDonor?.ageRowUsed]).toEqual([4.5, '25–40 y']);
      const a30 = res([both], { ageYears: 30 });
      console.log('I4 30 ->', a30.sdDonor?.setId, a30.sd, a30.sdDonor?.ageRowUsed);
      expect(a30.sd).toBe(4.5);
    });
    it('I4 edges: a child of 12, age not entered, and a set with no similar-age row at all', () => {
      const both = donor('both', CN, 'Bot B', 2015, [sdRow('M', 2.5, [15, 17]), sdRow('M', 4.5, [25, 40])]);
      const kid = res([both], { ageYears: 12 });
      const noAge = res([both], { ageYears: null });
      const onlyKids = res([donor('kids', CN, 'Kid K', 2015, [sdRow('M', 2.5, [10, 12]), sdRow('M', 2.7, [13, 15])])], { ageYears: null });
      console.log('I4 12 ->', kid.sd, kid.sdDonor?.ageRowUsed, '| no age ->', noAge.sd, noAge.sdDonor?.ageRowUsed, '| no age, child rows only ->', onlyKids.sd, onlyKids.sdDonor?.ageRowUsed);
      expect([kid.sd, kid.sdDonor?.ageRowUsed]).toEqual([2.5, '15–17 y']);
      expect([noAge.sd, noAge.sdDonor?.ageRowUsed]).toEqual([4.5, '25–40 y']);
      expect([onlyKids.sd, onlyKids.sdDonor?.ageRowUsed]).toEqual([2.7, '13–15 y']); // another age still lends, the oldest row
    });
    it('an unknown sex: pooled only, the same order', () => {
      const kidsPooled = donor('kids-p', CN, 'Kid K', 2015, [sdRow('pooled', 2.5, [11, 14])]);
      const menPooledJp = donor('men-p', JP, 'Man M', 2015, [sdRow('pooled', 4.2, [18, 30])]);
      const kidsPooledMy = donor('kids-pmy', MY, 'Kid K', 2015, [sdRow('pooled', 2.5, [11, 14])]);
      expect(res([kidsPooled, menPooledJp], { sex: null, ageYears: 30 }).sdDonor?.setId).toBe('kids-p'); // same population first
      expect(res([kidsPooledMy, menPooledJp], { sex: null, ageYears: 30 }).sdDonor?.setId).toBe('men-p');
      expect(res([kidsPooledMy, menPooledJp], { sex: null, ageYears: 12 }).sdDonor?.setId).toBe('kids-pmy');
    });
  });

  it('rule 15: the other sex is never a donor, in any tier', () => {
    const GIRLS = donor('fang', CN, 'Fang L', 2015, [sdRow('F', 1.5, [11, 14])]);
    expect(res([GIRLS, ALI]).sdDonor?.setId).toBe('ali');
    const none = res([GIRLS]);
    expect([none.sd, none.colour, none.sdDonor]).toEqual([null, false, null]);
    expect(none.sourceLine).toMatch(/ · no SD in this paper and no matching SD to borrow$/);
    expect(res([TAN], { sex: null }).sd).toBeNull(); // an unknown sex never borrows a boys' SD
    expect(res([donor('boys', CN, 'Boy B', 2015, [sdRow('M', 1.5, [11, 14])])], { sex: 'F' }).sd).toBeNull();
  });

  it("rule 15: a 'close' donor, a donor whose SD is itself borrowed (sdSource), pending, website, research-SD and own-norm sets, and the chosen set itself never lend", () => {
    const tier1 = (id: string, extraRow: Partial<NormEntry>, extraSet: Partial<NormSet> = {}) =>
      donor(id, CN, 'Kwok K', 2015, [sdRow('M', 1.1, [11, 14], extraRow)], extraSet);
    const blocked = [
      tier1('close-d', { definitionMatch: 'close', definitionNote: 'other plane' }),
      tier1('chain', { sdSource: { set: 'kim-research', source: 'Table 3' } }),
      tier1('pend', {}, { status: 'pending' }),
      tier1('webd', {}, { status: 'website' }),
      tier1('resd', {}, { kind: 'research-sd' }),
      mkSet({ id: 'ownd', kind: 'analysis-own', analyses: ['steiner'], population: OWN_POP, entries: [sdRow('M', 1.1, [11, 14])] }),
    ];
    expect(res([...blocked, ALI]).sdDonor?.setId).toBe('ali');
    // The chosen set's own boys' adult row (with an SD) is never its own donor.
    const selfLender = chosen([bare('m01_SNA'), sdRow('M', 9, [18, 30])]);
    const r = norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12, sets: [selfLender, ALI] })));
    expect([r.entry.sex, r.sdDonor?.setId]).toEqual(['pooled', 'ali']);
    // A single-extracted paper may lend (and is named like any other).
    expect(res([tier1('single', {}, { status: 'single-extracted' }), ALI]).sdDonor?.setId).toBe('single');
  });

  it('rule 15 ties: larger n (entry, else sample), then later year, then set id; an undated donor ranks last on year', () => {
    const t3 = (id: string, authors: string, year: number | null, sd: number, n?: number, extra: Partial<NormSet> = {}) =>
      donor(id, MY, authors, year, [sdRow('M', sd, [11, 14], n !== undefined ? { n } : {})], extra);
    const b = t3('b-set', 'Bee B', 2018, 4.1, 40);
    const a = t3('a-set', 'Ace A', 2018, 4.2, 40);
    expect(res([b, a]).sdDonor?.setId).toBe('a-set'); // equal n, equal year → id
    const c = t3('c-set', 'Cee C', 2020, 4.3, 40);
    expect(res([b, a, c]).sdDonor?.setId).toBe('c-set'); // equal n → later year
    const d = t3('d-set', 'Dee D', 2001, 4.4, 60);
    expect(res([b, a, c, d]).sdDonor?.setId).toBe('d-set'); // larger n first
    const e = t3('e-set', 'Eee E', 2001, 4.5, undefined, { sample: { n: 100 } });
    expect(res([b, a, c, d, e]).sdDonor).toEqual({ setId: 'e-set', source: 'Table 3', sex: 'M', ageRowUsed: '11–14 y', n: 100 });
    const u = t3('u-set', 'NDC', null, 4.6, 40);
    const z = t3('z-set', 'Zed Z', 1960, 4.7, 40);
    expect(res([u, z]).sdDonor?.setId).toBe('z-set'); // undated after every dated donor, though its id is first
  });

  it('rule 15: tiers 2-5 take the nearest age band (P12), before n; an unknown age takes the adult row (band ≥ 18 or no band), else the band nearest 18', () => {
    const near = donor('near', MY, 'Near N', 2015, [sdRow('M', 4.1, [7, 10], { n: 10 })]); // 2 years off
    const far = donor('far', JP, 'Far F', 2015, [sdRow('M', 4.2, [16, 17], { n: 500 })]); // 4 years off
    expect(res([far, near]).sdDonor?.setId).toBe('near');
    const ong2 = donor('ong', CN, 'Ong P', 2016, [sdRow('M', 2.5, [11, 14]), sdRow('M', 3.5, [18, 30])]);
    const u = res([ong2], { ageYears: null });
    expect([u.sd, u.sdDonor?.ageRowUsed]).toEqual([3.5, '18–30 y']);
    const bandless = donor('ong', CN, 'Ong P', 2016, [sdRow('M', 2.5, [11, 14]), sdRow('M', 3.9)], {}, { bandlessBesideBands: true }); // P34 opt-out
    expect([res([bandless], { ageYears: null }).sd, res([bandless], { ageYears: null }).sdDonor?.ageRowUsed]).toEqual([3.9, null]);
    const young = donor('ong', CN, 'Ong P', 2016, [sdRow('M', 2.0, [7, 10]), sdRow('M', 2.5, [11, 14])]);
    expect(res([young], { ageYears: null }).sd).toBe(2.5);
  });

  it('rule 15: a patient exactly on a band boundary takes the band containing that age (completed years)', () => {
    const banded = donor('tan', CN, 'Tan K', 2015, [sdRow('M', 2.5, [11, 14]), sdRow('M', 2.9, [15, 17]), sdRow('M', 3.5, [18, 30])]);
    expect([14, 14.99, 15, 17.99, 18].map((ageYears) => res([banded], { ageYears }).sd)).toEqual([2.5, 2.5, 2.9, 2.9, 3.5]);
  });

  it("rule 16: an mm donor SD is converted by the DONOR set's enlargement; the chosen mean keeps its own scale rule", () => {
    const mmEntry = { measurement: 'm46_U1NAmm', sex: 'pooled', mean: 5, unit: 'mm', source: 'Table 1', definitionMatch: 'same' } as NormEntry;
    const mmDonor = (scale: NormSet['scale']) => donor('enl', MY, 'Enl E', 2015, [{ ...mmEntry, sd: 2.2, source: 'Table 3' }], { scale });
    const notStated = chosen([mmEntry]);
    const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'chinese', sets: [notStated, mmDonor({ kind: 'enlarged', percent: 10, source: 'p. 9' })] })));
    expect(r.mean).toBe(5);
    expect(r.sd).toBeCloseTo(2.0, 9);
    expect(r.printed).toBeNull();
    // Ruling T4-1: only the donor's SD was converted; the mean is the not-stated paper's own, so no 'converted-to-true-size'.
    expect(r.flags).toEqual(expect.arrayContaining(['scale-assumed', 'sd-converted', 'sd-borrowed']));
    expect(r.flags).not.toContain('converted-to-true-size');
    expect(r.sourceLine).toContain('(converted from 10% film enlargement, printed 2.2 mm)');
    // The other way round: the chosen paper is enlarged, the donor not stated — the mean converts, the SD does not.
    const enlarged = chosen([{ ...mmEntry, mean: 5.4 }], { scale: { kind: 'enlarged', percent: 8, source: 'p. 2' } });
    const s = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'chinese', sets: [enlarged, mmDonor({ kind: 'not-stated' })] })));
    expect(s.mean).toBeCloseTo(5, 9);
    expect(s.sd).toBe(2.2);
    expect(s.sourceLine).not.toContain('printed 2.2 mm');
    // Fix round 1 (P32 item 2): a not-stated donor scale for an mm SD is disclosed.
    expect(s.sourceLine).toMatch(/SD borrowed from Enl 2015, Malay, sexes pooled, Table 3 \(donor's film scale not stated; assumed true size\)$/);
    const trueSize = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'chinese', sets: [enlarged, mmDonor({ kind: 'true-size', source: 'p. 1' })] })));
    expect(trueSize.sourceLine).not.toMatch(/assumed true size\)/);
  });

  it('rule 17: sd, colour, flags, sdDonor and the source line; the z uses the borrowed SD', () => {
    const r = res([TAN]);
    expect(r.flags).toEqual(['sd-borrowed']);
    expect(r.sourceLine).toBe('Lee 2010, Chinese, 0 y and over, males and females, Table 1 · SD borrowed from Tan 2015, Chinese, 11–14 y, boys, Table 3' /* AGE-1: the chosen row's open band (fixture note above) */);
    expect(zScore(85, r)).toBe(2);
    expect(band(zScore(85, r)!)).toBe('amber');
  });

  it('rule 17 (B-2): an ideal borrows and says "ideal value (<authors>); SD borrowed from …"; an ideal with its own SD is only marked', () => {
    const lender = donor('ali-p', MY, 'Ali R', 2018, [sdRow('pooled', 3)]);
    const ideal = ownRes([own(bare('m01_SNA', { mean: 82, centre: 'ideal' })), lender]);
    expect([ideal.mean, ideal.sd, ideal.colour]).toEqual([82, 3, true]);
    expect([...ideal.flags].sort()).toEqual(['ideal', 'sd-borrowed']);
    expect(ideal.sourceLine).toBe('Steiner 1953, sexes pooled, p. 731 · ideal value (Steiner C); SD borrowed from Ali 2018, Malay, sexes pooled, Table 3');
    const withSd = ownRes([own(bare('m01_SNA', { mean: 82, sd: 3.5, centre: 'ideal' })), lender]);
    expect([withSd.sd, withSd.sdDonor, withSd.flags]).toEqual([3.5, null, ['ideal']]);
    expect(withSd.sourceLine).toBe('Steiner 1953, sexes pooled, p. 731 · ideal value (Steiner C)');
    const lonely = ownRes([own(bare('m01_SNA', { mean: 82, centre: 'ideal' }))]);
    expect(lonely.sourceLine).toBe('Steiner 1953, sexes pooled, p. 731 · ideal value (Steiner C); no SD in this paper and no matching SD to borrow');
    // Ruling T4-1: an ideal with nothing to colour it with says so in its own flag.
    expect([lonely.sd, lonely.colour, lonely.flags]).toEqual([null, false, ['ideal-uncoloured']]);
  });

  it('rule 17: no donor anywhere → no SD, no colour, the line says so; user norms carry sdDonor null', () => {
    const none = res([]);
    expect([none.sd, none.colour, none.sdDonor, none.flags]).toEqual([null, false, null, []]);
    expect(none.sourceLine).toBe('Lee 2010, Chinese, 0 y and over, males and females, Table 1 · no SD in this paper and no matching SD to borrow');
    expect(norm(resolveNorm(q({ measurement: 'm13_Wits', analysisId: 'wits', population: 'user:Zeta' }))).sdDonor).toBeNull();
  });

  describe('fix round 1 (ruling P32)', () => {
    // Fixtures that bypass the validator (a JSON file could still carry them if validation were skipped).
    const raw = (base: NormSet, entries: unknown[]): NormSet => ({ ...base, entries: entries as NormEntry[] });

    it('item 1a: the validator refuses sd: null ("leave sd out when the paper prints none")', () => {
      const bad = { ...TAN, entries: [{ ...TAN.entries[0], sd: null }] };
      const p = validateSet(bad, { populations: POP_IDS });
      expect(p).toHaveLength(1);
      expect(p[0]).toMatch(/leave sd out when the paper prints none/);
    });
    it('item 1b: a donor row with sd null is skipped; the next real donor is used', () => {
      const nullTier1 = raw(TAN, [{ ...TAN.entries[0], sd: null }]);
      const r = res([nullTier1, ALI]);
      expect([r.sdDonor?.setId, r.sd]).toEqual(['ali', 4.5]);
    });
    it('item 1b: an enlarged mm donor with sd null never yields sd 0 or colour', () => {
      const mmEntry = { measurement: 'm46_U1NAmm', sex: 'pooled', mean: 5, unit: 'mm', source: 'Table 1', definitionMatch: 'same' };
      const base = donor('enl-null', MY, 'Enl E', 2015, [{ ...mmEntry, sd: 2, source: 'Table 3' } as NormEntry], { scale: { kind: 'enlarged', percent: 10, source: 'p. 9' } });
      const r = norm(resolveNorm(q({ measurement: 'm46_U1NAmm', population: 'chinese', sets: [chosen([mmEntry as NormEntry]), raw(base, [{ ...mmEntry, sd: null }])] })));
      expect([r.sd, r.colour, r.sdDonor]).toEqual([null, false, null]);
    });
    it('item 1b: a chosen entry with sd null borrows like an absent SD; a copied sd null with sdSource looks the row up', () => {
      const r = norm(resolveNorm(q({ population: 'chinese', sex: 'M', ageYears: 12, sets: [raw(CHOSEN, [{ ...CHOSEN.entries[0], sd: null }]), TAN] })));
      expect([r.sd, r.sdDonor?.setId, r.colour]).toEqual([2.5, 'tan', true]);
      const ownSnb = own({ measurement: 'm02_SNB', sex: 'pooled', mean: 80, sdSource: { set: 'kim-research', source: 'Table 3' }, unit: 'deg', source: 'x', definitionMatch: 'same' });
      const s = ownRes([raw(ownSnb, [{ ...ownSnb.entries[0], sd: null }]), KIM_RESEARCH], 'm02_SNB');
      expect([s.sd, s.colour]).toEqual([3.4, true]);
    });
    it("item 4: an own-norm set's donors are 'same population' with the PATIENT's population (case, else clinic default); a population set keeps its own", () => {
      const steiner = own(bare('m01_SNA', { mean: 82, centre: 'ideal' }));
      expect(donorHomePopulation(q({ population: 'chinese' }), steiner)).toBe('chinese');
      expect(donorHomePopulation(q({ population: null, clinicDefault: 'jordanian' }), steiner)).toBe('jordanian');
      expect(donorHomePopulation(q({ population: null, clinicDefault: null }), steiner)).toBeNull();
      expect(donorHomePopulation(q({ population: 'analysis-own', clinicDefault: 'jordanian' }), steiner)).toBeNull();
      expect(donorHomePopulation(q({ population: 'user:Zeta' }), steiner)).toBeNull();
      expect(donorHomePopulation(q({ population: 'jordanian' }), CHOSEN)).toBe('chinese');
    });
    it('item 5: printed.mean of a midpoint-centred ideal in an enlarged set is the printed midpoint', () => {
      const rangeIdeal = { measurement: 'm46_U1NAmm', sex: 'pooled', range: { low: 55, high: 66 }, unit: 'mm', source: 'x', definitionMatch: 'same', centre: 'ideal' } as NormEntry;
      const ownMm = mkSet({ ...own(rangeIdeal), scale: { kind: 'enlarged', percent: 10, source: 'p. 2' } });
      const lender = donor('mm-lender', MY, 'Ali R', 2018, [{ measurement: 'm46_U1NAmm', sex: 'pooled', mean: 5, sd: 2, unit: 'mm', source: 'Table 3', definitionMatch: 'same' }], { scale: { kind: 'true-size', source: 'p. 1' } });
      const r = ownRes([ownMm, lender], 'm46_U1NAmm');
      expect(r.mean).toBeCloseTo(55, 9); // (50 + 60) / 2 at true size
      expect(r.printed).toEqual({ mean: 60.5, sd: null, range: { low: 55, high: 66 } });
    });
    it('item 6: an M/F donor row without its own n ranks and reports by the sample\'s nMale/nFemale, else sample.n', () => {
      const big = donor('big-sample', MY, 'Big B', 2018, [sdRow('M', 4.1, [11, 14])], { sample: { n: 300, nMale: 30, nFemale: 270 } });
      const mid = donor('mid-sample', MY, 'Mid M', 2018, [sdRow('M', 4.2, [11, 14], { n: 50 })]);
      expect(res([big, mid]).sdDonor?.setId).toBe('mid-sample');
      expect(res([big]).sdDonor?.n).toBe(30);
      const girls = donor('big-sample', MY, 'Big B', 2018, [sdRow('F', 4.1, [11, 14])], { sample: { n: 300, nMale: 30, nFemale: 270 } });
      expect(res([girls], { sex: 'F' }).sdDonor?.n).toBe(270);
      const noSplit = donor('nosplit', MY, 'No N', 2018, [sdRow('M', 4.1, [11, 14])], { sample: { n: 77 } });
      expect(res([noSplit]).sdDonor?.n).toBe(77);
    });
  });

  it("the shared fixture: Steiner's SD-less SNA now borrows the nearest-to-adult pooled SD, Chen's (bandless, larger n than Malay's)", () => {
    const r = norm(resolveNorm(q({ population: 'analysis-own' })));
    expect([r.sd, r.sdDonor?.setId]).toEqual([4, 'chen-synthetic']);
    expect(r.sourceLine).toBe('Steiner 1953, sexes pooled, p. 731 · SD borrowed from Chen 2015, Chinese, sexes pooled, Table 2');
  });
});

// Ruling P35 (Task 6 review): the source line read "McNamara JA Jr 1984, 13–99 y, boys and girls" for
// an open adult band. An open band reads "<low> y and over"; the sex words follow the band (children,
// adults, or a band that spans 18 → males/females); a generational suffix goes with the initials.
describe('P35: plain source-line wording for open adult bands and author suffixes', () => {
  const lineFor = (authors: string, sex: 'M' | 'F' | 'pooled', ageBand: [number, number], ageYears: number) => {
    const s = mkSet({ id: 'p35', citation: { authors, title: 'T', year: 1984, openAccess: true }, entries: [deg('m01_SNA', sex, 80, { ageBand })] });
    return norm(resolveNorm(q({ population: 'chinese', sets: [s], sex: sex === 'pooled' ? null : sex, ageYears }))).sourceLine;
  };
  it('an open adult band starting below 18 reads "13 y and over", males and females; Jr is dropped', () =>
    expect(lineFor('McNamara JA Jr', 'pooled', [13, 99], 30)).toBe('McNamara 1984, Chinese, 13 y and over, males and females, Table 2'));
  it('an open band from 18 reads men / women', () => {
    expect(lineFor('Smith AB', 'M', [18, 99], 30)).toBe('Smith 1984, Chinese, 18 y and over, men, Table 2');
    expect(lineFor('Smith AB', 'F', [18, 120], 30)).toBe('Smith 1984, Chinese, 18 y and over, women, Table 2');
  });
  it('a closed band spanning 18 reads males / females', () => {
    expect(lineFor('Smith AB', 'M', [16, 25], 20)).toBe('Smith 1984, Chinese, 16–25 y, males, Table 2');
    expect(lineFor('Smith AB', 'F', [16, 25], 20)).toBe('Smith 1984, Chinese, 16–25 y, females, Table 2');
  });
  it('children stay boys / girls', () => expect(lineFor('Smith AB', 'F', [11, 14], 12)).toBe('Smith 1984, Chinese, 11–14 y, girls, Table 2'));
  it('Jr., Sr, II and III are dropped with the initials', () => {
    expect(lineFor('Smith AB Jr.', 'pooled', [20, 30], 25)).toBe('Smith 1984, Chinese, 20–30 y, men and women, Table 2');
    expect(lineFor('Smith A Sr', 'pooled', [20, 30], 25)).toMatch(/^Smith 1984,/);
    expect(lineFor('Smith A II', 'pooled', [20, 30], 25)).toMatch(/^Smith 1984,/);
    expect(lineFor('Smith A III', 'pooled', [20, 30], 25)).toMatch(/^Smith 1984,/);
  });
});

// ---- Task 7 fix round 1: P37 (treatment samples rank last), owner R-1 (interpolate between printed
// ages, ruling P38), owner R-2 (adult women on the author's men's rows, P38).
// Owner FIRSTHAND-1 (13 Oct): when two sets give the same measurement, a first-hand source beats a second-hand
// restatement (a set with secondHand). The step sits just BEFORE the year in rule 5 — after selection and sample size.
describe('FIRSTHAND-1: a first-hand source beats a second-hand restatement, before the year', () => {
  const OWN_POP = { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] as string[] };
  const ownSet = (id: string, year: number, extra: Partial<NormSet> = {}) => mkSet({ id, kind: 'analysis-own', analyses: ['eastman'], population: OWN_POP,
    citation: { authors: `${id} A`, title: 'T', year, openAccess: true }, sample: {}, selection: 'unknown', entries: [deg('m55_U1MxP', 'pooled', 109, { sd: 6 })], ...extra });
  const ask = (sets: NormSet[], population: string | null = null) => norm(resolveNorm(q({ measurement: 'm55_U1MxP', analysisId: 'eastman', population, sets, userNorms: [] })));
  it('own norms: a first-hand 2011 paper beats a 2022 second-hand restatement of the same value (was the later paper)', () => {
    const first = ownSet('first-2011', 2011);
    const second = ownSet('second-2022', 2022, { secondHand: { via: 'Second 2022, Table 2' } });
    expect(ask([second, first]).setId).toBe('first-2011');
    expect(ask([first, second]).setId).toBe('first-2011');
    expect(ask([second]).setId).toBe('second-2022'); // alone, the restatement is still used
  });
  it('population sets: the same step; two first-hand sets still go by year', () => {
    const pop = (id: string, year: number, extra: Partial<NormSet> = {}) =>
      mkSet({ id, citation: { authors: `${id} A`, title: 'T', year, openAccess: true }, sample: {}, entries: [deg('m01_SNA', 'pooled', 80)], ...extra });
    const r = (sets: NormSet[]) => norm(resolveNorm(q({ population: 'chinese', sets, userNorms: [] }))).setId;
    expect(r([pop('via-2020', 2020, { secondHand: { via: 'Review 2020' } }), pop('own-1990', 1990)])).toBe('own-1990');
    expect(r([pop('own-1990', 1990), pop('own-2000', 2000)])).toBe('own-2000');
  });
  it('only BEFORE the year: a second-hand set with a larger sample, or a better selection, still wins', () => {
    const pop = (id: string, extra: Partial<NormSet>) =>
      mkSet({ id, citation: { authors: `${id} A`, title: 'T', year: 2000, openAccess: true }, entries: [deg('m01_SNA', 'pooled', 80)], ...extra });
    const r = (sets: NormSet[]) => norm(resolveNorm(q({ population: 'chinese', sets, userNorms: [] }))).setId;
    expect(r([pop('via-big', { sample: { n: 500 }, secondHand: { via: 'Review' } }), pop('own-small', { sample: { n: 50 } })])).toBe('via-big');
    expect(r([pop('via-bal', { selection: 'class-I-balanced', secondHand: { via: 'Review' } }), pop('own-ci', { selection: 'class-I' })])).toBe('via-bal');
  });
});

describe('P37: a mixed-occlusion sample ranks after every other selection', () => {
  it('a class-I set with a small n beats a mixed-occlusion set with a large n; mixed-occlusion is still the fallback', () => {
    const treat = mkSet({ id: 'treat', selection: 'mixed-occlusion', sample: { n: 1000 }, entries: [deg('m01_SNA', 'pooled', 70)] });
    const small = mkSet({ id: 'small', selection: 'unknown', sample: {}, entries: [deg('m01_SNA', 'pooled', 80)] });
    expect(norm(resolveNorm(q({ population: 'chinese', sets: [treat, small] }))).setId).toBe('small');
    expect(norm(resolveNorm(q({ population: 'chinese', sets: [small, treat] }))).setId).toBe('small');
    expect(norm(resolveNorm(q({ population: 'chinese', sets: [treat] }))).setId).toBe('treat');
  });

  // Owner ruling P37-FIRST (12 Oct): the treatment-sample demotion comes BEFORE age coverage (AGE-1),
  // so a treatment sample that covers the patient's age still loses to a normal sample that does not
  // (that one is used at its nearest age, flagged age-mismatched).
  it('P37-FIRST: a class-I set that does not cover the age beats a mixed-occlusion set that does (population and own norms)', () => {
    const treat = mkSet({ id: 'treat', selection: 'mixed-occlusion', sample: { n: 1000 }, entries: [deg('m01_SNA', 'pooled', 70, { ageBand: [19, 44] })] });
    const young = mkSet({ id: 'young', selection: 'class-I', sample: { n: 20 }, entries: [deg('m01_SNA', 'pooled', 80, { ageBand: [18, 23] })] });
    for (const sets of [[treat, young], [young, treat]]) {
      const r = norm(resolveNorm(q({ population: 'chinese', sets, sex: 'M', ageYears: 30 })));
      expect([r.setId, r.mean, r.flags.includes('age-mismatched')]).toEqual(['young', 80, true]);
    }
    const own = (s: NormSet) => ({ ...s, kind: 'analysis-own' as const, analyses: ['steiner'], population: { id: 'analysis-own', label: 'Own', ethnicity: [] } });
    const r = norm(resolveNorm(q({ sets: [own(treat), own(young)], sex: 'M', ageYears: 30 })));
    expect([r.setId, r.flags.includes('age-mismatched')]).toEqual(['young', true]);
    // Still the fallback: alone, the treatment sample is used.
    expect(norm(resolveNorm(q({ population: 'chinese', sets: [treat], sex: 'M', ageYears: 30 }))).setId).toBe('treat');
  });
});

describe("owner R-1 (P38): ageRows 'interpolate' — linear between printed ages", () => {
  const pt = (sex: 'M' | 'F' | 'pooled', age: number, mean: number, extra: Partial<NormEntry> = {}) =>
    deg('m01_SNA', sex, mean, { ageBand: [age, age], sd: 3, source: `Table 1, age ${age} row`, ...extra });
  const RK = mkSet({
    id: 'rk', ageRows: 'interpolate', citation: { authors: 'Rick RM', title: 'T', year: 1981, openAccess: true },
    entries: [pt('pooled', 3, 83), pt('pooled', 6, 84), pt('pooled', 9, 85, { range: { low: 80, high: 90 } }), pt('pooled', 12, 86, { range: { low: 82, high: 92 } }),
      pt('pooled', 15, 87), pt('M', 18, 88), { ...pt('M', 24, 90), ageBand: [24, 99] }],
  } as any);
  const at = (ageYears: number | null, sex: 'M' | 'F' | null = null, sets: NormSet[] = [RK]) => norm(resolveNorm(q({ population: 'chinese', sets, sex, ageYears })));

  it('an 8-year-old: 84 + (2/3)(85 − 84), SD 3, flagged interpolated, said in the line and the age row', () => {
    const r = at(8);
    expect(r.mean).toBeCloseTo(84 + (2 / 3) * (85 - 84), 10);
    expect(r.sd).toBe(3);
    expect(r.colour).toBe(true);
    expect(r.flags).toContain('interpolated');
    expect(r.flags).not.toContain('age-mismatched');
    expect(r.ageRowUsed).toBe('8 y (interpolated 6–9 y)');
    expect(r.sourceLine).toContain("interpolated between Rick 1981's ages 6 and 9");
  });
  it('the range is interpolated when both rows have one', () => {
    const r = at(10);
    expect(r.range!.low).toBeCloseTo(80 + (1 / 3) * 2, 10);
    expect(r.range!.high).toBeCloseTo(90 + (1 / 3) * 2, 10);
    expect(at(7).range).toBeNull(); // the age-6 row has none
  });
  it('a fractional age interpolates on the exact age', () => expect(at(7.5).mean).toBeCloseTo(84.5, 10));
  it('exactly on a printed age: that row, no flag', () => {
    const r = at(9);
    expect([r.mean, r.entry.ageBand, r.flags]).toEqual([85, [9, 9], []]);
  });
  it('below the first printed age: the first row, flagged age-mismatched (no extrapolation)', () => {
    const r = at(2);
    expect([r.mean, r.flags.includes('age-mismatched'), r.flags.includes('interpolated')]).toEqual([83, true, false]);
  });
  it('above the last point row: that row, flagged; an open last row [a, 99] holds beyond a, unflagged', () => {
    const r = at(40, null);
    expect([r.mean, r.flags.includes('age-mismatched')]).toEqual([87, true]);
    const m = at(40, 'M');
    expect([m.mean, m.entry.ageBand, m.flags]).toEqual([90, [24, 99], []]);
    const m21 = at(21, 'M');
    expect(m21.mean).toBeCloseTo(89, 10);
    expect(m21.ageRowUsed).toBe('21 y (interpolated 18–24 y)');
  });
  it("the patient's series runs from pooled child rows into own-sex adult rows (a boy of 16: between 15 and 18)", () => {
    expect(at(16, 'M').mean).toBeCloseTo(87 + (1 / 3), 10);
    // a girl has no adult rows here: 16 is past the last pooled row → that row, flagged
    expect(at(16, 'F').flags).toContain('age-mismatched');
  });
  it('an SD on only one of the two rows: no SD (never mixed)', () => {
    const one = mkSet({ id: 'one', ageRows: 'interpolate', entries: [pt('pooled', 8, 22, { sd: 4.7 }), { ...pt('pooled', 9, 23), sd: undefined, centre: 'ideal' }] } as any);
    const r = at(8.5, null, [one]);
    expect([r.mean, r.sd, r.colour]).toEqual([22.5, null, false]);
    expect(r.flags).toContain('interpolated');
  });
  it('age unknown: the existing adult rule, no interpolation', () => {
    const r = at(null, 'M');
    expect([r.mean, r.flags.includes('interpolated')]).toEqual([88, false]);
  });
  it('a set without ageRows is untouched: the nearest band, flagged, no interpolation', () => {
    const plain = mkSet({ id: 'plain', entries: [pt('pooled', 6, 84), pt('pooled', 9, 85)] });
    const r = at(8, null, [plain]);
    expect([r.mean, r.flags.includes('age-mismatched'), r.flags.includes('interpolated')]).toEqual([85, true, false]);
  });

  // Task 7 fix round 3 (P39): fix round 2's test (below) encoded the wrong order. pickInterpolated
  // must decide the AGE first, exactly as pickRow documents: 1. the series (own-sex row at each
  // printed age, else pooled) covers the age → use it (exact age, or interpolate between); 2. else,
  // if the patient's sex has no banded rows of its own and has a band-less row → that row, unflagged;
  // 3. else the end row, flagged age-mismatched. Fix round 2 returned the band-less row BEFORE
  // checking coverage, so a woman between two covering pooled points got her band-less row instead
  // of the interpolated pooled value.
  it('P39: the age decides before a band-less own-sex row — covered by the series first, then the band-less row, then the end row flagged', () => {
    const withBandlessF = mkSet({
      id: 'rk-bandless-f', ageRows: 'interpolate', citation: { authors: 'Rick RM', title: 'T', year: 1981, openAccess: true },
      entries: [pt('pooled', 6, 6), pt('pooled', 9, 9), deg('m01_SNA', 'F', 100)],
    } as any);
    // A woman aged 7: the pooled series (6–9) covers her age — it wins, interpolated, not her
    // band-less row.
    const woman7 = at(7, 'F', [withBandlessF]);
    expect(woman7.mean).toBeCloseTo(6 + (1 / 3) * (9 - 6), 10);
    expect(woman7.flags).toContain('interpolated');
    expect(woman7.flags).not.toContain('age-mismatched');
    // A woman aged 3: before the first point (6), the series does not cover her age — her band-less
    // F row (100) wins, unflagged.
    const woman3 = at(3, 'F', [withBandlessF]);
    expect(woman3.mean).toBe(100);
    expect(woman3.flags).not.toContain('interpolated');
    expect(woman3.flags).not.toContain('age-mismatched');
    // A woman aged 12: after the last CLOSED point (9, not open), the series does not cover her age
    // either — her band-less F row wins again, unflagged.
    const woman12 = at(12, 'F', [withBandlessF]);
    expect(woman12.mean).toBe(100);
    expect(woman12.flags).not.toContain('interpolated');
    expect(woman12.flags).not.toContain('age-mismatched');
    // A man aged 12: M has no band-less row of its own, so he takes the pooled series; 12 is past the
    // last closed point (9) — the end row is used, flagged age-mismatched (never the F row).
    const man12 = at(12, 'M', [withBandlessF]);
    expect(man12.mean).toBe(9);
    expect(man12.flags).toContain('age-mismatched');
    expect(man12.flags).not.toContain('interpolated');
  });
});

// Final review M-2 and M-6 (12 Oct): an interpolate set's sex-pooled flag and sdSource.
describe("ageRows 'interpolate': sex-pooled only where the printed age splits by sex; sdSource kept", () => {
  const pt = (sex: 'M' | 'F' | 'pooled', age: number, mean: number, extra: Partial<NormEntry> = {}) =>
    deg('m01_SNA', sex, mean, { ageBand: [age, age], sd: 3, source: `Table 1, age ${age} row`, ...extra });
  const RK = mkSet({
    id: 'rk2', ageRows: 'interpolate', citation: { authors: 'Rick RM', title: 'T', year: 1981, openAccess: true },
    entries: [pt('pooled', 8, 84), pt('pooled', 13, 86), pt('pooled', 18, 87), pt('M', 18, 88), pt('M', 23, 90)],
  } as any);
  const at = (ageYears: number, sex: 'M' | 'F' | null, sets: NormSet[] = [RK]) => norm(resolveNorm(q({ population: 'chinese', sets, sex, ageYears })));

  it('M-2: a girl between two pooled-only printed ages (10.5) or on one (13) is not flagged sex-pooled', () => {
    expect(at(10.5, 'F').flags).not.toContain('sex-pooled');
    expect(at(13, 'F').flags).not.toContain('sex-pooled');
  });
  it('M-2 (control): a girl at a printed age where the author split by sex (18: pooled and boys) is still flagged', () => {
    const r = at(18, 'F');
    expect([r.entry.sex, r.flags.includes('sex-pooled')]).toEqual(['pooled', true]);
  });

  it('M-6: an interpolated row keeps the sdSource both printed rows share (no switch to a rule-15 donor)', () => {
    const lender = mkSet({ id: 'lender-sd', kind: 'research-sd', citation: { authors: 'Lend L', title: 'T', year: 2000, openAccess: true },
      entries: [deg('m01_SNA', 'pooled', 80, { sd: 2.5, source: 'Table 3' })] });
    const src = { set: 'lender-sd', source: 'Table 3' };
    const noSd = (age: number, mean: number) => { const e = pt('pooled', age, mean, { sdSource: src }); delete e.sd; return e; };
    const RS = mkSet({ id: 'rs', ageRows: 'interpolate', citation: { authors: 'Rick RM', title: 'T', year: 1981, openAccess: true },
      entries: [noSd(8, 84), noSd(13, 86)] } as any);
    const r = at(10, null, [RS, lender]);
    expect(r.flags).toContain('interpolated');
    expect(r.entry.sdSource).toEqual(src);
    expect([r.sd, r.colour, r.sdDonor]).toEqual([2.5, true, null]);
    expect(r.flags).toContain('sd-from-other-paper');
  });
});

describe('owner R-2 (P38): fromOtherSex — adult women compared with the men\'s rows, flagged', () => {
  const NOTE = 'Ricketts prints adult values for men only; adult women are compared with them (owner ruling 8 Oct)';
  const RK2 = mkSet({
    id: 'rk2', ageRows: 'interpolate', citation: { authors: 'Rick RM', title: 'T', year: 1981, openAccess: true },
    entries: [
      deg('m01_SNA', 'pooled', 86, { ageBand: [12, 12] }), deg('m01_SNA', 'pooled', 87, { ageBand: [15, 15] }),
      deg('m01_SNA', 'M', 90, { ageBand: [24, 99] }),
      deg('m01_SNA', 'F', 90, { ageBand: [24, 99], fromOtherSex: 'M', note: NOTE } as any),
    ],
  } as any);
  const at = (sex: 'M' | 'F' | null, ageYears: number | null) => norm(resolveNorm(q({ population: 'chinese', sets: [RK2], sex, ageYears })));
  it("a woman of 30: the adult value, flagged other-sex-values (not age-mismatched), said in the line", () => {
    const r = at('F', 30);
    expect([r.mean, r.flags.includes('other-sex-values'), r.flags.includes('age-mismatched')]).toEqual([90, true, false]);
    expect(r.sourceLine).toContain(' · Ricketts prints adult values for men only');
  });
  it('a man of 30: the same value, no other-sex-values flag', () => {
    const r = at('M', 30);
    expect([r.mean, r.flags.includes('other-sex-values')]).toEqual([90, false]);
  });
  it('a girl of 13: the pooled child rows, interpolated, no other-sex-values flag', () => {
    const r = at('F', 13);
    expect(r.mean).toBeCloseTo(86 + 1 / 3, 10);
    expect([r.flags.includes('interpolated'), r.flags.includes('other-sex-values')]).toEqual([true, false]);
  });
  it('a girl of 20 between the pooled age-15 row and the women\'s age-24 row: interpolated and flagged other-sex-values', () => {
    const r = at('F', 20);
    expect(r.mean).toBeCloseTo(87 + (5 / 9) * 3, 10);
    expect(r.flags).toEqual(expect.arrayContaining(['interpolated', 'other-sex-values']));
  });
});
