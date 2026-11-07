import { describe, it, expect } from 'vitest';
import { COMBINED_ADULT, COMBINED_ADULT_LABEL, FLAG_WORDS, loadSets, resolveNorm, SEX_NOT_RECORDED_HINT, type NormEntry, type NormQuery, type NormSet, type Resolved } from '@ceph/analyses';
import { CALIBRATE_TO_SHOW, casePopulationChoice, firstHint, normCell, normsErrorMessage, normText, populationMissing, populationNote, queryFor, valueClass, type NormCell } from './normCell';

const sets = loadSets();
const doc = { population: null, gender: null, dateOfBirth: '2010-01-02', takenOn: '2026-01-10' };   // SYNTHETIC
const ctx = { sets, userNorms: [], clinicDefault: null };
const norm = (over: Partial<Extract<Resolved, { kind: 'norm' }>> = {}): Resolved => ({ kind: 'norm', setId: 'x', entry: { measurement: 'm01_SNA', sex: 'pooled', unit: 'deg', source: 'p. 1', definitionMatch: 'same' },
  mean: 82, sd: 2, range: null, printed: null, colour: true, flags: [], sourceLine: 'X 2000, p. 1', ageRowUsed: null, sdDonor: null, ...over });
/** An entry with another unit (review M-3: the unit is the norm entry's own, never passed separately). */
const inUnit = (unit: 'deg' | 'mm' | '%' | '', over: Partial<Extract<Resolved, { kind: 'norm' }>> = {}) => norm({ entry: { ...(norm() as any).entry, unit }, ...over });
/** Ruling T4-4: normCell takes the query the norm was resolved with; only its sex and sets are read. */
const qWith = (sex: 'M' | 'F' | null): NormQuery => ({ measurement: 'm01_SNA', analysisId: 'steiner', population: null, clinicDefault: null, sex, ageYears: 30, sets: [], userNorms: [] });
const QM = qWith('M');

describe('queryFor: the case decides population, sex and age', () => {
  it('age at the film date, the case population, the clinic default', () => {
    const q = queryFor('m01_SNA', 'steiner', { ...doc, population: 'chinese', gender: 'F' }, { ...ctx, clinicDefault: 'malay' });
    expect([q.population, q.clinicDefault, q.sex]).toEqual(['chinese', 'malay', 'F']);
    expect(q.ageYears).toBeGreaterThan(16); expect(q.ageYears).toBeLessThan(16.1);
  });
  it('no population and no clinic default: the analysis\'s own norm (N6 a)', () => {
    const r = resolveNorm(queryFor('m01_SNA', 'steiner', doc, ctx));
    expect(r.kind === 'norm' && r.setId).toBe('steiner1953');
  });
  // Edge case: no date of birth or film date → ageAt returns null, and AGE-UNK-1
  // takes over in the resolver (Task 3); queryFor's job here is only to pass that null through, not hide it.
  it('no date of birth and no film date: ageYears is null (AGE-UNK-1 takes it from there)', () => {
    const q = queryFor('m01_SNA', 'steiner', { ...doc, dateOfBirth: null, takenOn: null }, ctx);
    expect(q.ageYears).toBeNull();
  });
  // Owner FILMDATE-1: which field is missing decides the words (the resolver says "film date missing" only then).
  it('FILMDATE-1: date of birth entered, film date missing → filmDateMissing; neither entered, or both → not', () => {
    expect(queryFor('m01_SNA', 'steiner', { ...doc, takenOn: null }, ctx).filmDateMissing).toBe(true);
    expect(queryFor('m01_SNA', 'steiner', { ...doc, dateOfBirth: null, takenOn: null }, ctx).filmDateMissing).toBe(false);
    expect(queryFor('m01_SNA', 'steiner', { ...doc, dateOfBirth: null }, ctx).filmDateMissing).toBe(false);
    expect(queryFor('m01_SNA', 'steiner', doc, ctx).filmDateMissing).toBe(false);
  });
  it('FILMDATE-1: the Inspector cell reads the owner\'s words for a real committed norm', () => {
    const q = queryFor('m01_SNA', 'steiner', { ...doc, population: 'chinese', takenOn: null }, ctx);
    const c = normCell(82, resolveNorm(q), q, 1);
    expect(c.badges.map((b) => b.tip)).toContain('Film date missing — adult norms assumed. Enter the date the film was taken for the exact norm.');
    expect(c.badges.map((b) => b.flag)).not.toContain('age-assumed-adult');
  });

  // Fix round 1, ruling T11-4: the case's population names a user-norm set the clinician has since
  // deleted (Task 10's "Delete set…" only clears a dangling CLINIC default, not a dangling CASE population) —
  // queryFor must treat this exactly like "no population chosen", never pass the dead id through to the
  // resolver (which would otherwise fall back to the analysis's own norm, silently, under a cell that still
  // looks like it is comparing against that population).
  it('T11-4: a case population naming a deleted user set falls back to the clinic default, not the dead id', () => {
    const live = { setName: 'Alpha', measurement: 'm01_SNA', mean: 70, sd: 2, sourceNote: 'x' };
    const q = queryFor('m01_SNA', 'steiner', { ...doc, population: 'user:Gone' }, { ...ctx, userNorms: [live], clinicDefault: 'malay' });
    expect(q.population).toBeNull();
    expect(q.clinicDefault).toBe('malay');
  });
  it('T11-4: a case population naming a user set that still exists passes through unchanged', () => {
    const live = { setName: 'Alpha', measurement: 'm01_SNA', mean: 70, sd: 2, sourceNote: 'x' };
    const q = queryFor('m01_SNA', 'steiner', { ...doc, population: 'user:Alpha' }, { ...ctx, userNorms: [live] });
    expect(q.population).toBe('user:Alpha');
  });
  it('T11-4: populationMissing itself — null and a live population are not missing; a dead one is', () => {
    expect(populationMissing(null, sets, [])).toBe(false);
    expect(populationMissing('chinese', sets, [])).toBe(false);
    expect(populationMissing('user:Gone', sets, [])).toBe(true);
  });
});

// Owner AG1 (19 Oct): with no DOB, the film's age chooses the age row. SYNTHETIC sets, as ageunk.test.ts.
// (Task 12. The helpers live inside the describe so they do not clash with this file's module-level `doc`/`ctx`.)
describe('queryFor takes its age from filmAge (owner AG1)', () => {
  const mkSet = (id: string, entries: Partial<NormEntry>[]): NormSet => ({
    id, kind: 'population', status: 'verified', citation: { authors: 'Synthetic A', title: 'SYNTHETIC', year: 2020, openAccess: true },
    population: { id: 'chinese', label: 'Chinese', ethnicity: [] }, sample: { n: 100 }, selection: 'class-I-balanced', modality: 'film',
    scale: { kind: 'true-size', source: 'SYNTHETIC' }, headPosition: 'unknown', curation: { extractedBy: ['SYNTHETIC'], date: '2026-10-19' }, caveats: [],
    entries: entries.map((e) => ({ measurement: 'm01_SNA', sex: 'pooled', unit: '°', source: 'Table 1, p. 1', definitionMatch: 'same', ...e })) as NormEntry[] });
  const ctx = { sets: [mkSet('synthetic-ages', [{ ageBand: [11, 11], mean: 80, sd: 3 }, { ageBand: [18, 40], mean: 82, sd: 3.5 }])], userNorms: [], clinicDefault: null };
  const doc = (over: object) => ({ population: 'chinese', gender: null, dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: null, ...over });
  const meanOf = (d: object, c = ctx) => { const r = resolveNorm(queryFor('m01_SNA', 'steiner', doc(d), c)); if (r.kind !== 'norm') throw new Error(r.kind); return [r.mean, r.flags.includes('age-assumed-adult')]; };

  it('no DOB + "011Y" (11 y) → the 11-year row; no age → the adult row, "age not entered", as before', () => {
    expect(meanOf({ ageOnFilmYears: 11 })).toEqual([80, false]);
    expect(meanOf({})).toEqual([82, true]);
  });
  it('with a DOB the film\'s age changes nothing', () => {
    expect(meanOf({ dateOfBirth: '1996-01-02', ageOnFilmYears: 11 })).toEqual(meanOf({ dateOfBirth: '1996-01-02' }));   // SYNTHETIC adult
    expect(queryFor('m01_SNA', 'steiner', doc({ dateOfBirth: '2014-01-02', takenOn: null, ageOnFilmYears: 11 }), ctx))   // SYNTHETIC
      .toMatchObject({ ageYears: null, filmDateMissing: true });                                                        // R1
  });
  it('edge cases: no DOB + 30 → the adult row without "age not entered"; ageOnFilmYears undefined → as before; a set with no age rows → unchanged', () => {
    expect(meanOf({ ageOnFilmYears: 30 })).toEqual([82, false]);
    expect(meanOf({ ageOnFilmYears: undefined })).toEqual(meanOf({}));
    const { ageOnFilmYears: _gone, ...noField } = doc({});
    expect(queryFor('m01_SNA', 'steiner', noField, ctx).ageYears).toBeNull();
    const flat = { ...ctx, sets: [mkSet('synthetic-flat', [{ mean: 81, sd: 3 }])] };
    expect(meanOf({ ageOnFilmYears: 11 }, flat)[0]).toBe(81);
    expect(meanOf({}, flat)[0]).toBe(81);
  });
});

describe('normText', () => {
  it('mean ± SD with the unit', () => expect(normText(norm(), 1)).toBe('82.0 ± 2.0°'));
  it('a range without SD', () => expect(normText(inUnit('mm', { mean: null, sd: null, range: { low: 1, high: 3 } }), 1)).toBe('1.0–3.0 mm'));
  it('a mean with a range and no SD', () => expect(normText(norm({ sd: null, range: { low: 80, high: 84 } }), 1)).toBe('82.0° (80.0–84.0)'));
  // Edge case: mean alone, no SD and no range (e.g. a user norm with no SD entered).
  it('mean only, no SD and no range', () => expect(normText(norm({ sd: null, range: null }), 1)).toBe('82.0°'));
  // Review M-5: neither a mean nor a range (a norm the resolver could not centre) reads as a dash, never "NaN" or empty.
  it('no mean and no range: a dash', () => expect(normText(norm({ mean: null, sd: null, range: null }), 1)).toBe('—'));
  it('no norm', () => expect(normText({ kind: 'none', reason: 'No norm here.' }, 1)).toBe('No norm'));
});

describe('normCell: colour, badges, source line', () => {
  it('|z| ≤ 1 plain, ≤ 2 amber, > 2 red', () => {
    expect(normCell(83, norm(), QM, 1).band).toBe('neutral');
    expect(normCell(85, norm(), QM, 1).band).toBe('amber');
    expect(normCell(87, norm(), QM, 1).band).toBe('red');
  });
  // Edge case: the band edges themselves — mean 82, sd 2, so z = (value-82)/2.
  // z = 1 exactly (value 84) is still neutral ("≤ 1"); z = 2 exactly (value 86) is still amber ("≤ 2"), not red.
  // Owner SEVERITY-1/2 (16 Oct): the cell carries the same z the colour uses, and its stars.
  it('severity: 86.5 against 82 ± 2 is z 2.25, two stars, red; no value or no SD has none', () => {
    const c = normCell(86.5, norm(), QM, 1);
    expect([c.z, c.severity?.stars, c.severity?.word, c.band]).toEqual([2.25, '**', 'Moderate', 'red']);
    expect([normCell(null, norm(), QM, 1).z, normCell(null, norm(), QM, 1).severity]).toEqual([null, null]);
    expect(normCell(99, norm({ colour: false, flags: ['website'] }), QM, 1).severity).toBeNull();
  });
  it('z exactly 1: still neutral (the boundary is inclusive)', () => expect(normCell(84, norm(), QM, 1).band).toBe('neutral'));
  it('z exactly 2: still amber, not red (the boundary is inclusive)', () => expect(normCell(86, norm(), QM, 1).band).toBe('amber'));
  it('a website value is never coloured (N4)', () => {
    expect(normCell(99, norm({ colour: false, flags: ['website'] }), QM, 1).band).toBeNull();
  });
  it('a hidden value (mm, film not calibrated) is never coloured', () => {
    expect(normCell(null, inUnit('mm'), QM, 1).band).toBeNull();
  });
  it('each flag becomes its tag, in the resolver\'s order — except the ones kept off the screen (C1, N-A5)', () => {
    const c = normCell(82, norm({ flags: ['website', 'sexes-averaged'] }), QM, 1);
    expect(c.badges.map((b) => b.badge)).toEqual(['website value', 'average of male and female']);
  });
  it('the source line is the resolver\'s, unchanged; the clinical target follows it (N1)', () => {
    const c = normCell(82, norm({ entry: { ...(norm() as any).entry, clinicalTarget: 'FMIA 65°' } }), QM, 1);
    expect([c.sourceLine, c.target]).toEqual(['X 2000, p. 1', 'FMIA 65°']);
  });
  it('no norm: the resolver\'s reason is the line', () => {
    expect(normCell(1, { kind: 'none', reason: 'No norm here.' }, QM, 1)).toMatchObject({ text: 'No norm', band: null, sourceLine: 'No norm here.' });
  });
  it('the calibrate-to-show words', () => expect(CALIBRATE_TO_SHOW).toBe('calibrate to show'));
});

// Owner C1 (19 Oct 2026): "We don't need the word Ideal or SD borrowed in the Measurements section" — the tags leave the
// row; hovering the source still explains them; the source line (which the report prints) keeps the words.
describe('normCell: C1, the "ideal" and "SD borrowed" tags', () => {
  it('ideal + SD borrowed: no tags; both explanations for the source hover, in order; the source line unchanged', () => {
    const c = normCell(82, norm({ flags: ['ideal', 'sd-borrowed'], sourceLine: 'Steiner 1953 · ideal value (Steiner CC); SD borrowed from X' }), QM, 1);
    expect([c.badges, c.sourceTips, c.sourceLine]).toEqual([[], [FLAG_WORDS.ideal.tip, FLAG_WORDS['sd-borrowed'].tip], 'Steiner 1953 · ideal value (Steiner CC); SD borrowed from X']);
  });
  it("an uncoloured ideal ('ideal-uncoloured', its tag also read \"ideal\"): no tag, its explanation on the hover", () => {
    const c = normCell(82, norm({ flags: ['ideal-uncoloured'], colour: false }), QM, 1);
    expect([c.badges, c.sourceTips]).toEqual([[], [FLAG_WORDS['ideal-uncoloured'].tip]]);
  });
  it('every other tag stays, beside hidden ones', () => {
    const c = normCell(82, norm({ flags: ['sd-from-other-paper', 'ideal', 'chosen-by-you', 'auto-fallback'] }), { ...QM, population: 'saudi' }, 1);
    expect([c.badges.map((b) => b.badge), c.sourceTips]).toEqual([['SD from another paper', 'chosen by you'], [FLAG_WORDS.ideal.tip]]);
  });
  it('"No norm" and "choose one" cells: no tips', () => {
    expect(normCell(1, { kind: 'none', reason: 'No norm here.' }, QM, 1).sourceTips).toEqual([]);
    expect(normCell(1, { kind: 'choose', population: 'saudi', reason: 'no Saudi norm — choose one' }, QM, 1).sourceTips).toEqual([]);
  });
});

// Owner, addendum 2 J (19 Oct 2026): the paper-scale tag "assumed scale" leaves the screen like C1 — it read as if the
// FILM's scale were assumed; the hover explains it in words that cannot be read that way. Real committed set.
describe('normCell: J, the "assumed scale" tag (paper side)', () => {
  it("Ricketts 1960's E-line for a boy of 6 (no population): 'scale-assumed', 'sd-converted', 'sd-borrowed' → only 'SD at true size' stays; two tips, the new words first", () => {
    const qq: NormQuery = { measurement: 'm71_ULE', analysisId: 'e-line', population: null, clinicDefault: null, sex: 'M', ageYears: 6, sets, userNorms: [] };
    const r = resolveNorm(qq);
    expect(r.kind === 'norm' && r.flags).toEqual(['scale-assumed', 'sd-converted', 'sd-borrowed']);   // the real path, as flagpaths.test pins
    const c = normCell(-2, r, qq, 1);
    expect([c.badges.map((b) => b.badge), c.sourceTips]).toEqual([['SD at true size'],
      ['The paper did not say whether its X-rays were enlarged; its mm are taken as true size.', FLAG_WORDS['sd-borrowed'].tip]]);
    // Owner ruling Q-B (24 Oct 2026): the source line itself (what the report and the CSV print) is reworded too —
    // the resolver's own words (what `flagpaths.test.ts` and `resolve.test.ts` pin) are untouched, so the probe that
    // proves the resolver itself is untouched stays bit-identical; the reword happens once, at this boundary.
    expect(c.sourceLine).toContain('the paper did not state its X-ray enlargement; mm taken as true size');
    expect(c.sourceLine).not.toContain('film scale not stated in the paper');
  });
});

// For the report (Task 10): every resolver flag (hidden or not) and the paper's short citation travel on the cell.
describe('normCell: flags and citation travel for the report (Task 10)', () => {
  it("the cell carries the resolver's flags and the paper's short citation (Ricketts 1960 E-line, a boy of 6)", () => {
    const qq: NormQuery = { measurement: 'm71_ULE', analysisId: 'e-line', population: null, clinicDefault: null, sex: 'M', ageYears: 6, sets, userNorms: [] };
    const c = normCell(-2, resolveNorm(qq), qq, 1);
    expect([c.flags, c.citation]).toEqual([['scale-assumed', 'sd-converted', 'sd-borrowed'], 'Ricketts 1960']);
    expect([normCell(1, { kind: 'none', reason: 'x' }, QM, 1).flags, normCell(1, { kind: 'none', reason: 'x' }, QM, 1).citation]).toEqual([[], null]);
  });
});

// Review M-2 (fix round 1, 25 Oct 2026): the unstated-enlargement list must also catch a norm whose OWN paper
// stated its scale but whose borrowed SD came from a paper that did not — the two citations can differ.
describe('normCell: sdDonorCitation (review M-2, fix round 1)', () => {
  const statedSet: NormSet = { id: 'mainset', kind: 'population', status: 'verified',
    citation: { authors: 'Smith J', title: 'SYNTHETIC', year: 2000, openAccess: true },
    population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] },
    sample: {}, selection: 'unknown', modality: 'film', scale: { kind: 'enlarged', percent: 8, source: 'SYNTHETIC' },
    headPosition: 'unknown', curation: { extractedBy: [], date: '2020-01-01' }, caveats: [], entries: [] };
  const unstatedDonor: NormSet = { id: 'donorset', kind: 'research-sd', status: 'verified',
    citation: { authors: 'Fu M-K', title: 'SYNTHETIC', year: 1975, openAccess: true },
    population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] },
    sample: {}, selection: 'unknown', modality: 'film', scale: { kind: 'not-stated' },
    headPosition: 'unknown', curation: { extractedBy: [], date: '2020-01-01' }, caveats: [], entries: [] };
  const q: NormQuery = { ...QM, sets: [statedSet, unstatedDonor] };
  const borrowed = (donorSetId: string | null): Resolved => ({
    kind: 'norm', setId: 'mainset', entry: { measurement: 'm01_SNA', sex: 'pooled', unit: 'mm', source: 'p. 1', definitionMatch: 'same' },
    mean: 10, sd: 2, range: null, printed: null, colour: true, flags: ['sd-borrowed'], sourceLine: 'Smith 2000, p. 1 · SD borrowed from Fu 1975',
    ageRowUsed: null, sdDonor: donorSetId ? { setId: donorSetId, source: 'Table 1', sex: 'pooled', ageRowUsed: null, n: 40 } : null,
  });
  it("the mean's own paper states its scale (citation), but the SD's donor paper does not (sdDonorCitation) — the two differ", () => {
    const c = normCell(10, borrowed('donorset'), q, 1);
    expect([c.citation, c.sdDonorCitation]).toEqual(['Smith 2000', 'Fu 1975']);
  });
  it('no donor at all: null', () => expect(normCell(10, borrowed(null), q, 1).sdDonorCitation).toBeNull());
  it("a donor whose own scale IS stated: null (nothing to warn about)", () => {
    const statedDonor: NormSet = { ...unstatedDonor, id: 'statedDonor', scale: { kind: 'true-size', source: 'SYNTHETIC' } };
    const q2: NormQuery = { ...QM, sets: [statedSet, statedDonor] };
    expect(normCell(10, borrowed('statedDonor'), q2, 1).sdDonorCitation).toBeNull();
  });
});

// Owner ruling Q-B (24 Oct 2026): "film scale not stated in the paper; assumed true size" read as if the PATIENT's
// film were unscaled — it is the PAPER's. Reworded everywhere the cell's sourceLine is shown, printed or exported
// (hover, report, CSV); never inside the resolver itself (resolve.ts, and the words `resolveNorm` returns raw, are
// untouched — proved unchanged by the norms-auto probe, which reads `Resolved.sourceLine` directly).
describe('normCell: Q-B (24 Oct 2026), the unstated-scale words reworded on every screen', () => {
  it("the paper's own clause is reworded", () => {
    const c = normCell(82, norm({ sourceLine: 'X 2000, p. 1 · film scale not stated in the paper; assumed true size, as modern papers report' }), QM, 1);
    expect(c.sourceLine).toBe('X 2000, p. 1 · the paper did not state its X-ray enlargement; mm taken as true size, as modern papers report');
  });
  it("the borrowed-SD's \"source's\"/\"donor's\" variants are reworded too", () => {
    const c1 = normCell(82, norm({ sourceLine: "SD borrowed from Kim 2025 Table 1 (source's film scale not stated; assumed true size)" }), QM, 1);
    expect(c1.sourceLine).toBe("SD borrowed from Kim 2025 Table 1 (source's X-ray enlargement not stated; mm taken as true size)");
    const c2 = normCell(82, norm({ sourceLine: "SD borrowed from Enl 2015, Table 3 (donor's film scale not stated; assumed true size)" }), QM, 1);
    expect(c2.sourceLine).toBe("SD borrowed from Enl 2015, Table 3 (donor's X-ray enlargement not stated; mm taken as true size)");
  });
  it('a source line without the phrase is untouched', () => {
    expect(normCell(82, norm(), QM, 1).sourceLine).toBe('X 2000, p. 1');
  });
});

// Owner decision (20 Oct): norm_mean/norm_sd (the CSV, via report/model.ts) must hold the resolved norm whenever
// its TEXT shows a value — independent of whether a z/colour/stars is possible. `mean`/`sd` above stay z-gated
// (the chart's own ticks: CHART-TAB-1); `normMean`/`normSd` are the new, ungated fields.
describe('normCell: normMean/normSd hold the resolved norm whenever its text shows one (owner, 20 Oct)', () => {
  it('no value placed (a Needs row): the chart mean/sd stay blank, normMean/normSd are filled from the norm', () => {
    const c = normCell(null, norm(), QM, 1);
    expect([c.z, c.mean, c.sd]).toEqual([null, null, null]);
    expect([c.normMean, c.normSd]).toEqual([82, 2]);
  });
  it('a usable value but no SD: still no colour/z, but normMean is filled and normSd stays blank', () => {
    const c = normCell(82, norm({ sd: null }), QM, 1);
    expect([c.z, c.severity]).toEqual([null, null]);
    expect([c.normMean, c.normSd]).toEqual([82, null]);
  });
  it('no norm at all: both blank (the text is "No norm", not a number)', () => {
    expect(normCell(1, { kind: 'none', reason: 'No norm here.' }, QM, 1)).toMatchObject({ normMean: null, normSd: null });
  });
  it('"choose one": both blank (the words ARE the cell text, not a number)', () => {
    expect(normCell(1, { kind: 'choose', population: 'chinese', reason: 'no Chinese norm — choose one' }, QM, 1)).toMatchObject({ normMean: null, normSd: null });
  });
});

// Changes since the brief (12 Oct): SEX-AVG-1's sex hint, and P9's "copied from the men's row" so an unknown-sex
// patient's cell never reads as if the patient were a woman, even though the resolver's own sourceLine (unchanged,
// per the test above) still names the copied-from sex via its source-line wording.
describe('normCell: the sex hint (owner, 12 Oct) — sexes-averaged, and the P9 other-sex copy', () => {
  it('sexes-averaged always carries the hint: the resolver only averages when the sex is unrecorded, so no extra argument is needed', () => {
    const c = normCell(82, norm({ flags: ['sexes-averaged'] }), QM, 1);
    expect(c.hint).toBe(SEX_NOT_RECORDED_HINT);
  });
  it('P9 copy, sex explicitly not recorded: the hint fires, and the badge says which row it was copied from', () => {
    const r = norm({ flags: ['other-sex-values'], entry: { ...(norm() as any).entry, fromOtherSex: 'M' } });
    const c = normCell(82, r, qWith(null), 1);
    expect(c.hint).toBe(SEX_NOT_RECORDED_HINT);
    const badge = c.badges.find((b) => b.flag === 'other-sex-values')!;
    expect(badge.tip).toContain("Copied from the men's row.");
  });
  it('P9 copy, sex recorded as F: the clarifying clause still shows (it is informative either way), but no hint — "women" is accurate for a known woman', () => {
    const r = norm({ flags: ['other-sex-values'], entry: { ...(norm() as any).entry, fromOtherSex: 'M' } });
    const c = normCell(82, r, qWith('F'), 1);
    expect(c.hint).toBeNull();
    expect(c.badges.find((b) => b.flag === 'other-sex-values')!.tip).toContain("Copied from the men's row.");
  });
  it('no sex-related flags: hint is always null', () => {
    expect(normCell(82, norm(), qWith(null), 1).hint).toBeNull();
  });
});

// Owner ruling DEC-1 (12 Oct, Task 4 fix round 2; replaces T4-2's printed-decimals display): the figures shown follow the
// operator's decimals setting (0–3, default 1; plain ratios at least 2, at most 3); the colour and every calculation
// use the full figures; the paper's printed figure is kept in `printed`. Real committed sets, production resolveNorm.
describe('normText at the operator decimals setting (DEC-1)', () => {
  const real = (o: Partial<NormQuery> & Pick<NormQuery, 'measurement' | 'analysisId'>) =>
    resolveNorm({ population: null, clinicDefault: null, sex: 'M', ageYears: null, sets, userNorms: [], ...o } as NormQuery);
  it("Björk–Jarabak's S–Ar/Ar–Go ratio: 0.80 ± 0.06 at the default (a ratio shows 2 at least), 0.799 ± 0.063 at 3", () => {
    const r = real({ measurement: 'm44_ArStoArGo', analysisId: 'bjork-jarabak' });
    expect([r.kind === 'norm' && r.setId, normText(r, 1), normText(r, 0), normText(r, 3)]).toEqual(['onfile-bjork-jarabak', '0.80 ± 0.06', '0.80 ± 0.06', '0.799 ± 0.063']);
  });
  it('Alshahrani 2018 articular angle (women, 17–22 y): 139.3 ± 7.9° at the default, 139.328 ± 7.916° at 3, 139 ± 8° at 0', () => {
    const r = real({ measurement: 'm35_Articular', analysisId: 'bjork-jarabak', population: 'saudi', sex: 'F', ageYears: 20 });
    expect([r.kind === 'norm' && r.setId, normText(r, 1), normText(r, 3), normText(r, 0)]).toEqual(['alshahrani2018', '139.3 ± 7.9°', '139.328 ± 7.916°', '139 ± 8°']);
  });
  it('a range and a mean with a range follow the setting too', () => {
    expect(normText(norm({ sd: null, range: { low: 80, high: 84.25 } }), 2)).toBe('82.00° (80.00–84.25)');
  });
  it('a small negative mean never shows as "-0.0"', () => {
    expect(normText(norm({ mean: -0.04, sd: 1 }), 1)).toBe('0.0 ± 1.0°');
  });
});

describe('normCell: the colour uses the full figures, never the displayed ones (DEC-1)', () => {
  // Each case is amber on the full figures but red on the figures shown at that setting, so a colour computed from the
  // shown figures fails here. (A first fixture, 86.05 against 82.04 ± 2.04, rounded to amber either way at every
  // setting — the induced failure caught that the test could not fail, and these replaced it.)
  it('1 decimal: 82.04 ± 2.04 shown 82.0 ± 2.0°; 86.09 is z 1.99 (amber), on the shown figures 86.1 → 2.05 (red)', () => {
    const r = norm({ mean: 82.04, sd: 2.04 });
    const c = normCell(86.09, r, QM, 1);
    expect([c.text, c.band]).toEqual(['82.0 ± 2.0°', 'amber']);
    expect((86.1 - 82.0) / 2.0).toBeGreaterThan(2); // what the shown figures would give: red
  });
  it('0 decimals: 82.4 ± 2.4 shown 82 ± 2°; 87.1 is z 1.96 (amber), on the shown figures 87 → 2.5 (red)', () => {
    const c = normCell(87.1, norm({ mean: 82.4, sd: 2.4 }), QM, 0);
    expect([c.text, c.band]).toEqual(['82 ± 2°', 'amber']);
  });
  it('the same value and norm give the same colour at every setting', () => {
    const r = norm({ mean: 82.04, sd: 2.04 });
    expect(([0, 1, 2, 3] as const).map((d) => normCell(86.09, r, QM, d).band)).toEqual(['amber', 'amber', 'amber', 'amber']);
  });
});

// Final review M-2 (ruling: remove it): `NormCell.printed` showed stored numbers raw and no screen read it; the
// resolver's source line already carries a converted value's printed figure ("printed 1 mm"), so the cell keeps none.
describe('normCell: no separate printed figure (final review M-2)', () => {
  it('the cell has no printed field; a converted value\'s printed figure is in the source line (McNamara 1 mm)', () => {
    const q = { measurement: 'm08_ANperp', analysisId: 'mcnamara', population: null, clinicDefault: null, sex: 'M', ageYears: null, sets, userNorms: [] } as NormQuery;
    const c = normCell(null, resolveNorm(q), q, 1);
    expect('printed' in c).toBe(false);
    expect([c.text, c.sourceLine.includes('printed 1 mm')]).toEqual(['0.9 ± 2.5 mm', true]);
  });
});

// Owner NORM-PICK-1 (12 Oct): the chosen population has no norm → the cell says so and offers the choice; uncoloured.
describe('normCell: "no <population> norm — choose one" (NORM-PICK-1)', () => {
  // Eastman has no own norm in the committed sets and Saudi has no SNA, so before NORM-PICK-1 this was 'Mine', silently.
  const live = { setName: 'Mine', measurement: 'm01_SNA', mean: 80, sd: 2, sourceNote: 'SYNTHETIC' };
  it("N-A3: Eastman's SNA under Saudi (no Saudi SNA) shows Eastman's own norm (Auto): a value, graded, the drop-down, no Auto tag", () => {
    const q = queryFor('m01_SNA', 'eastman', { ...doc, population: 'saudi' }, { ...ctx, userNorms: [live] });
    const c = normCell(83, resolveNorm(q), q, 1);
    expect([c.text, c.band, c.badges.map((b) => b.badge), c.choose, c.auto?.step]).toEqual(['81.0 ± 3.0°', 'neutral', ['via'], { population: 'saudi' }, 'analysis-own']);
    expect(c.sourceLine.endsWith(' · Auto (no Saudi norm)')).toBe(true);
  });
  it('AUTO-Q6 step 4: no own norm and no Caucasian paper (Steiner Pog to NB, Saudi, a 16-year-old): the best study anywhere — Zheng 2026, Chinese', () => {
    const q = queryFor('m18_PogNB', 'steiner', { ...doc, population: 'saudi' }, ctx);
    const c = normCell(1, resolveNorm(q), q, 1);
    expect([c.choose, c.auto?.step, c.auto?.usedPopulation, c.auto?.source, c.badges.some((b) => b.flag === 'auto-fallback')]).toEqual([{ population: 'saudi' }, 'anywhere', 'Chinese', 'Zheng 2026 Beijing', false]);
    expect(c.sourceLine.endsWith(' · Auto (no Saudi norm)')).toBe(true);
  });
  it('AUTO-Q11: only the clinician\'s own norm has it → still "choose one", no value, no colour', () => {
    const own = { setName: 'SYNTHETIC Only', measurement: 'm18_PogNB', mean: 1, sd: 1, sourceNote: 'SYNTHETIC' };
    const q = queryFor('m18_PogNB', 'steiner', { ...doc, population: 'saudi' }, { ...ctx, sets: ctx.sets.filter((s) => !s.entries.some((e) => e.measurement === 'm18_PogNB')), userNorms: [own] });
    const c = normCell(1, resolveNorm(q), q, 1);
    expect([c.text, c.band, c.badges, c.choose, c.sourceLine, c.auto]).toEqual(['no Saudi norm — choose one', null, [], { population: 'saudi' }, '', null]);
  });
  it('queryFor carries the case\'s picks; a picked source reads "chosen by you", coloured', () => {
    const q = queryFor('m01_SNA', 'eastman', { ...doc, population: 'saudi' }, { ...ctx, userNorms: [live] }, { saudi: { m01_SNA: 'user:Mine' } });
    const c = normCell(83, resolveNorm(q), q, 1);
    expect([c.text, c.band, c.badges.map((b) => b.badge), c.choose]).toEqual(['80.0 ± 2.0°', 'amber', ['user norm', 'chosen by you'], { population: 'saudi' }]);
  });
  it('an ordinary norm offers no choice', () => {
    expect(normCell(82, norm(), QM, 1).choose).toBeNull();
  });
});

// Review M-6: the P9 sex hint end to end — the real resolver result for an unknown-sex adult on Ricketts 1981's
// facial angle (women's adult rows copy the men's, so the cell must not read as if the patient were a woman).
describe('normCell: the P9 sex hint on a real resolver result (M-6)', () => {
  it("Ricketts 1981 facial angle, sex and age not recorded → other-sex-values, and the hint", () => {
    const q = queryFor('m04_FacialAngle', 'ricketts', { population: null, gender: null, dateOfBirth: null, takenOn: null }, ctx);
    const r = resolveNorm(q);
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('other-sex-values')]).toEqual(['ricketts1981', true]);
    expect(normCell(null, r, q, 1).hint).toBe(SEX_NOT_RECORDED_HINT);
    // The same patient recorded as a woman: the copy is hers as printed, so no hint.
    const qf = queryFor('m04_FacialAngle', 'ricketts', { population: null, gender: 'F', dateOfBirth: null, takenOn: null }, ctx);
    expect(normCell(null, resolveNorm(qf), qf, 1).hint).toBeNull();
  });
});

// Task 5: useNorms().loadError and settingsError must both reach the screen, never one swallowing the other
// (preamble requirement carried into this task). normsErrorMessage is the pure join the Inspector shows verbatim.
// Fix round 1, review Minor 2: `loadError` is a raw `String(e)` (safeLoadSets), not a sentence, so it gets the
// "Norms couldn't be loaded:" prefix; `settingsError` (readUserNorms/readClinicDefault) is already a full sentence
// of its own ("Your own norms could not be read …") — wrapping it too would have misreported a committed-sets
// failure that never happened (a settings-only failure read as "Norms couldn't be loaded", when the norm sets
// loaded fine).
describe('normsErrorMessage: both a failed norm-set load and a failed settings read reach the screen', () => {
  it('neither failed: nothing to show', () => expect(normsErrorMessage(null, null)).toBeNull());
  it('only the norm sets failed to load: gets the "could not be loaded" prefix', () =>
    expect(normsErrorMessage('SYNTHETIC: bad JSON', null)).toBe("Norms couldn't be loaded: SYNTHETIC: bad JSON"));
  it('only a settings read failed: shown as its own sentence, no extra prefix (the sets DID load)', () =>
    expect(normsErrorMessage(null, 'SYNTHETIC: disk error')).toBe('SYNTHETIC: disk error'));
  it('both failed: both messages shown, neither swallowed', () => {
    expect(normsErrorMessage('SYNTHETIC: bad JSON', 'SYNTHETIC: disk error'))
      .toBe("Norms couldn't be loaded: SYNTHETIC: bad JSON SYNTHETIC: disk error");
  });
});

// Fix round 1, ruling T5-2: a positive control proving the Measurements cell's colour class actually
// reaches the DOM — without this, the colour-wiring code could be deleted and nothing would catch it (the
// cell's class was only ever checked for the NEUTRAL/hidden case, which is a null result either way).
describe('valueClass: the Measurements/Change cell class a colour band maps to', () => {
  const cell = (band: NormCell['band']): NormCell => ({ text: '', band, badges: [], sourceLine: '', target: null, hint: null, choose: null, z: null, severity: null, mean: null, sd: null, normMean: null, normSd: null, auto: null, sourceTips: [], flags: [], citation: null, sdDonorCitation: null, normSex: null, normPopulation: null, normAgeRowUsed: null });
  it('no cell (no case open, or norms failed to load): plain', () => expect(valueClass(null)).toBe('m-value'));
  it('no band (hidden, or no SD): plain', () => expect(valueClass(cell(null))).toBe('m-value'));
  it('neutral band: plain, no colour class', () => expect(valueClass(cell('neutral'))).toBe('m-value'));
  it('amber band', () => expect(valueClass(cell('amber'))).toBe('m-value norm-amber'));
  it('red band', () => expect(valueClass(cell('red'))).toBe('m-value norm-red'));
});

// Fix round 1, ruling T5-1: the Inspector must render `NormCell.hint` directly, not re-derive it from
// one flag (`sexes-averaged`) — `hint` also fires for a P9 other-sex copy when the sex is unrecorded (M-6 above),
// a path the old `cells.some((c) => c?.badges.some((b) => b.flag === 'sexes-averaged'))` check never saw.
describe('firstHint: the one sex hint the Inspector shows above the Measurements table', () => {
  it('no cells carry a hint: null', () => {
    const c = normCell(82, norm(), QM, 1);
    expect(firstHint([c, null])).toBeNull();
  });
  it('a sexes-averaged cell: its hint', () => {
    const c = normCell(82, norm({ flags: ['sexes-averaged'] }), QM, 1);
    expect(firstHint([null, c])).toBe(SEX_NOT_RECORDED_HINT);
  });
  // The real case the old code missed: a P9 other-sex copy (not sexes-averaged) still carries the hint when the
  // sex is unrecorded, on real committed data (Ricketts 1981 facial angle — M-6's own fixture).
  it('a P9 other-sex copy, sex unrecorded (real Ricketts 1981 data): its hint, even though it is not sexes-averaged', () => {
    const q = queryFor('m04_FacialAngle', 'ricketts', { population: null, gender: null, dateOfBirth: null, takenOn: null }, ctx);
    const r = resolveNorm(q);
    expect(r.kind === 'norm' && r.flags.includes('sexes-averaged')).toBe(false);
    const other = normCell(null, r, q, 1);
    expect(other.hint).toBe(SEX_NOT_RECORDED_HINT);
    expect(firstHint([normCell(82, norm(), QM, 1), other])).toBe(SEX_NOT_RECORDED_HINT);
  });
});


// Final review M-8: when the clinician's own norms failed to READ, every user population looks missing — but nothing was
// deleted, so the case panel must not say so.
describe('populationNote: what the case panel says when the case population is not offered', () => {
  it('a deleted set: "chosen set deleted — using clinic default"', () => expect(populationNote(true, false)).toBe('chosen set deleted — using clinic default'));
  it('your norms failed to read: says that instead, never a deletion that did not happen', () =>
    expect(populationNote(true, true)).toBe('your norms could not be read — using clinic default'));
  it('nothing missing: nothing to say, whatever the read did', () => {
    expect(populationNote(false, false)).toBeNull();
    expect(populationNote(false, true)).toBeNull();
  });
});

// Owner N-A5 (19 Oct 2026): a row Auto filled is marked only in its norm drop-down — never a tag on the row — and its
// norm opens that drop-down (the cell's `choose`), for the population that had no norm. Synthetic resolver results here;
// the resolver raises the flag from Task 5.
describe("normCell: an Auto row ('auto-fallback', N-A5)", () => {
  const AUTO = { population: 'japanese', populationWords: 'Japanese', step: 'analysis-own' as const, usedPopulation: null, source: "Steiner's own norm", n: null };
  const qJp: NormQuery = { ...QM, population: 'japanese' };
  it('no "Auto" tag (other tags stay), the drop-down for the population that had none, the note passed on, graded as usual', () => {
    const c = normCell(84.5, norm({ flags: ['sexes-averaged', 'auto-fallback'], auto: AUTO }), qJp, 1);
    expect([c.badges.map((b) => b.flag), c.choose, c.auto, c.band]).toEqual([['sexes-averaged'], { population: 'japanese' }, AUTO, 'amber']);
  });
  it('the clinic default is the population when the case has none', () => {
    expect(normCell(82, norm({ flags: ['auto-fallback'], auto: AUTO }), { ...QM, clinicDefault: 'japanese' }, 1).choose).toEqual({ population: 'japanese' });
  });
  // Owner decision 6 (29 Oct 2026): Auto now fills rows with no population at all; their picks are stored under the
  // analyses' own norms (pickPopulation). Was: no drop-down (Auto never happened there).
  it('no population at all: the drop-down stores its pick under the analyses\' own norms', () => {
    expect(normCell(82, norm({ flags: ['auto-fallback'], auto: AUTO }), QM, 1).choose).toEqual({ population: 'analysis-own' });
  });
  it('an ordinary norm: no note, no drop-down; "chosen by you" unchanged', () => {
    expect([normCell(82, norm(), QM, 1).auto, normCell(82, norm(), QM, 1).choose]).toEqual([null, null]);
    const picked = normCell(82, norm({ flags: ['chosen-by-you'] }), qJp, 1);
    expect([picked.badges.map((b) => b.badge), picked.choose, picked.auto]).toEqual([['chosen by you'], { population: 'japanese' }, null]);
  });
  it('"No norm" and "choose one" cells carry no note', () => {
    expect(normCell(1, { kind: 'none', reason: 'No norm here.' }, QM, 1).auto).toBeNull();
    expect(normCell(1, { kind: 'choose', population: 'saudi', reason: 'no Saudi norm — choose one' }, QM, 1).auto).toBeNull();
  });
});

// Owner report request (29 Oct 2026): the sex/population/age row the resolver actually used, read straight off
// the Resolved value and the matched set — for the report's one-sentence norm summary (model.ts normSourceSummary).
describe('normCell: normSex/normPopulation/normAgeRowUsed travel for the report summary (owner, 29 Oct 2026)', () => {
  const setX: NormSet = { id: 'x', kind: 'population', status: 'verified', citation: { authors: 'X', title: 'SYNTHETIC', year: 2000, openAccess: true },
    population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] }, sample: {}, selection: 'unknown', modality: 'film',
    scale: { kind: 'true-size', source: 'SYNTHETIC' }, headPosition: 'unknown', curation: { extractedBy: [], date: '2020-01-01' }, caveats: [], entries: [] };
  const qq: NormQuery = { ...QM, sets: [setX] };
  it('a used norm carries the resolver\'s own sex, the matched set\'s population label, and the age row used', () => {
    const c = normCell(82, norm({ entry: { ...(norm() as any).entry, sex: 'F' }, ageRowUsed: '8 y' }), qq, 1);
    expect([c.normSex, c.normPopulation, c.normAgeRowUsed]).toEqual(['F', 'Chinese', '8 y']);
  });
  it('positive control: "No norm" and "choose one" carry none of the three (no norm was actually used)', () => {
    expect([normCell(1, { kind: 'none', reason: 'x' }, qq, 1).normSex, normCell(1, { kind: 'none', reason: 'x' }, qq, 1).normPopulation, normCell(1, { kind: 'none', reason: 'x' }, qq, 1).normAgeRowUsed])
      .toEqual([null, null, null]);
    expect(normCell(1, { kind: 'choose', population: 'saudi', reason: 'x' }, qq, 1).normPopulation).toBeNull();
  });
  it('no matching set in q.sets: normPopulation is null (the sex and age row still come straight off the Resolved value)', () => {
    const c = normCell(82, norm(), QM, 1);   // QM.sets === []
    expect([c.normSex, c.normPopulation]).toEqual(['pooled', null]);
  });
});

describe('owner decisions 1 and 3 (29 Oct 2026): a case on Auto', () => {
  const sets = loadSets();
  const doc = (o: object) => ({ population: 'auto', gender: 'F' as const, dateOfBirth: '1996-01-02', takenOn: '2026-01-10', background: null, ...o });   // SYNTHETIC
  const n = (clinicDefault: string | null = null) => ({ sets, userNorms: [], clinicDefault });
  it('the background decides; the clinic default never leaks into the query', () => {
    const q = queryFor('m01_SNA', 'steiner', doc({ background: 'chinese' }), n('caucasian'));
    expect([q.population, q.clinicDefault]).toEqual(['chinese', null]);
    expect(casePopulationChoice(doc({ background: 'chinese' }), n('caucasian'))).toMatchObject({ how: 'background', population: 'chinese' });
  });
  it('else the clinic default; else (owner R1/R5, 3 Nov 2026) the combined adult norm for an adult, the largest study for a child', () => {
    expect(queryFor('m01_SNA', 'steiner', doc({}), n('caucasian')).population).toBe('caucasian');
    expect(queryFor('m01_SNA', 'steiner', doc({}), n()).population).toBe(COMBINED_ADULT);
    expect(casePopulationChoice(doc({}), n())).toMatchObject({ how: 'combined', population: COMBINED_ADULT });
    const child = doc({ dateOfBirth: '2014-01-02' });   // SYNTHETIC
    expect(casePopulationChoice(child, n())).toMatchObject({ how: 'best-evidence', setId: 'thilander2005' });
  });
  it('a combined row names its population "combined adult" for the report sentence; a single-study row its own', () => {
    const q = queryFor('m01_SNA', 'steiner', doc({}), n());
    const c = normCell(84, resolveNorm(q), q, 1);
    expect([c.normPopulation, c.normSex, c.normAgeRowUsed, c.citation]).toEqual([COMBINED_ADULT_LABEL, 'F', '18 y and over', null]);
    expect(c.badges.map((b) => b.badge)).toContain('combined adults');
    const q1 = queryFor('m26_SNMxP', 'bjork-jarabak', doc({}), n());
    const one = normCell(5, resolveNorm(q1), q1, 1);
    expect([one.normPopulation, one.auto?.step, one.badges.map((b) => b.badge).includes('single study')]).toEqual(['Swedish', 'single-study', true]);
  });
  it('no sets: the no-population path (Auto resolves to none)', () => {
    const q = queryFor('m01_SNA', 'steiner', doc({}), { sets: [], userNorms: [], clinicDefault: null });
    expect([q.population, q.clinicDefault]).toEqual([null, null]);
  });
  it('a hand-chosen population: the same query as before, and no choice', () => {
    const d = doc({ population: 'japanese' });
    expect(casePopulationChoice(d, n('caucasian'))).toBeNull();
    expect(queryFor('m01_SNA', 'steiner', d, n('caucasian'))).toMatchObject({ population: 'japanese', clinicDefault: 'caucasian' });
    expect(casePopulationChoice(doc({ population: null }), n('caucasian'))).toBeNull();
    expect(queryFor('m01_SNA', 'steiner', doc({ population: null }), n('caucasian'))).toMatchObject({ population: null, clinicDefault: 'caucasian' });
  });
  it('"auto" is never a missing population', () => {
    expect(populationMissing('auto', sets, [])).toBe(false);
  });
});

// Owner ruling 7 Nov 2026: an Indian case uses the Caucasian norms (Malay the Chinese); the cell carries the words, the
// screen's source line says them, and the report sentence repeats them once.
describe('the population alias on a cell (owner ruling 7 Nov 2026)', () => {
  const q = (population: string): NormQuery => ({ measurement: 'm01_SNA', analysisId: 'steiner', population, clinicDefault: null, sex: 'M', ageYears: 30, sets, userNorms: [] });
  it('an Indian case: the Caucasian norm, with the words; a Caucasian case: no words', () => {
    const ind = normCell(80, resolveNorm(q('indian')), q('indian'), 1);
    const cau = normCell(80, resolveNorm(q('caucasian')), q('caucasian'), 1);
    expect(ind.aliasNote).toBe('Norms: Caucasian (population rule)');
    expect(ind.sourceLine).toContain('Norms: Caucasian (population rule)');
    expect(ind.sourceLine).not.toMatch(/Indian/);   // owner answer C: never the recorded background
    expect([ind.normMean, ind.normSd, ind.normPopulation]).toEqual([cau.normMean, cau.normSd, cau.normPopulation]);
    expect(cau.aliasNote ?? null).toBeNull();
  });
});
