import { describe, it, expect } from 'vitest';
import { loadSets, resolveNorm, SEX_NOT_RECORDED_HINT, type NormQuery, type Resolved } from '@ceph/analyses';
import { CALIBRATE_TO_SHOW, firstHint, normCell, normsErrorMessage, normText, populationMissing, populationNote, queryFor, valueClass, type NormCell } from './normCell';

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
  it('each flag becomes its badge, in the resolver\'s order', () => {
    const c = normCell(82, norm({ flags: ['ideal', 'sd-borrowed'] }), QM, 1);
    expect(c.badges.map((b) => b.badge)).toEqual(['ideal', 'SD borrowed']);
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
  it('no value, no colour, no badges; the resolver\'s own words; the population to choose for', () => {
    const q = queryFor('m01_SNA', 'eastman', { ...doc, population: 'saudi' }, { ...ctx, userNorms: [live] });
    const c = normCell(83, resolveNorm(q), q, 1);
    expect([c.text, c.band, c.badges, c.choose, c.sourceLine]).toEqual(['no Saudi norm — choose one', null, [], { population: 'saudi' }, '']);
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
  const cell = (band: NormCell['band']): NormCell => ({ text: '', band, badges: [], sourceLine: '', target: null, hint: null, choose: null, z: null, severity: null, mean: null, sd: null });
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
