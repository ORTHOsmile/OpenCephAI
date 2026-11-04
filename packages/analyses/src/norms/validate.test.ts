import { describe, it, expect } from 'vitest';
import { plausibilityErrors, validateSet } from './validate';
const ctx = { populations: ['chinese', 'analysis-own'] };
const good = () => ({
  id: 'synthetic2026', kind: 'population', status: 'verified',
  citation: { authors: 'SYNTHETIC A', title: 'Synthetic norms', year: 2026, openAccess: true },
  population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] },
  sample: { n: 60 }, selection: 'class-I-balanced', modality: 'digital', scale: { kind: 'not-stated' }, headPosition: 'FH',
  curation: { extractedBy: ['a', 'b'], comparedOn: '2026-10-07', date: '2026-10-07' }, caveats: [],
  entries: [{ measurement: 'm01_SNA', sex: 'pooled', mean: 82, sd: 3.5, unit: 'deg', source: 'Table 2, p. 4', definitionMatch: 'same' }],
});
const problems = (mut: (s: any) => void) => { const s = good(); mut(s); return validateSet(s, ctx); };

describe('validateSet', () => {
  it('a well-formed set has no problems', () => expect(validateSet(good(), ctx)).toEqual([]));
  it('an unknown catalogue id is refused', () => expect(problems((s) => { s.entries[0].measurement = 'm99_Nope'; })).toHaveLength(1));
  it('a retired catalogue id is refused', () => expect(problems((s) => { s.entries[0].measurement = 'm45_U1NAmmLabial'; })).toHaveLength(1));
  it('a unit that differs from the catalogue is refused', () => expect(problems((s) => { s.entries[0].unit = 'mm'; })).toHaveLength(1));
  it('sd: null is refused (Task 4c fix round 1, P32): leave sd out when the paper prints none', () => {
    const p = problems((s) => { s.entries[0].sd = null; });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/leave sd out when the paper prints none/);
  });
  it('sd must be > 0', () => { expect(problems((s) => { s.entries[0].sd = 0; })).toHaveLength(1); expect(problems((s) => { s.entries[0].sd = -1; })).toHaveLength(1); });
  it('an entry needs a mean or a range', () => expect(problems((s) => { delete s.entries[0].mean; delete s.entries[0].sd; })).toHaveLength(1));
  it('range low must be below high', () => expect(problems((s) => { s.entries[0].range = { low: 85, high: 80 }; })).toHaveLength(1));
  it('source is mandatory', () => expect(problems((s) => { s.entries[0].source = ''; })).toHaveLength(1));
  it("'close' and 'different' need a definitionNote", () => expect(problems((s) => { s.entries[0].definitionMatch = 'close'; })).toHaveLength(1));
  it('an unknown population id is refused', () => expect(problems((s) => { s.population.id = 'martian'; })).toHaveLength(1));
  it('an analysis-own set must name existing analysis ids', () => {
    expect(problems((s) => { s.kind = 'analysis-own'; s.population.id = 'analysis-own'; s.analyses = ['steiner']; })).toEqual([]);
    expect(problems((s) => { s.kind = 'analysis-own'; s.population.id = 'analysis-own'; s.analyses = ['nope']; })).toHaveLength(1);
  });
  it('implausible values are refused (a slipped decimal point)', () => {
    expect(problems((s) => { s.entries[0].mean = 820; })).toHaveLength(1);        // deg outside [-90, 200]
    expect(problems((s) => { s.entries[0].sd = 35; })).toHaveLength(1);           // deg SD over 20
  });
  // Ruling P15 (Task 8): #39 Björk's sum of angles is ~396°, above the 200° degree guard. It gets its
  // own plausibility window (mean in [300, 450], SD at most 20); every other angle keeps the 200° guard.
  describe('P15: the sum of angles (#39) has its own plausibility window', () => {
    const sum = (mut: (e: any) => void) => problems((s) => { Object.assign(s.entries[0], { measurement: 'm39_SumAngles', mean: 396, sd: 6 }); mut(s.entries[0]); });
    it("Björk's 396° ± 6 is accepted", () => expect(sum(() => {})).toEqual([]));
    it('a mean below 300 is refused', () => expect(sum((e) => { e.mean = 299; })).toEqual(['synthetic2026: entries[0]: mean 299 is implausible for m39_SumAngles']));
    it('a mean above 450 is refused', () => expect(sum((e) => { e.mean = 451; })).toEqual(['synthetic2026: entries[0]: mean 451 is implausible for m39_SumAngles']));
    it('a slipped decimal point (39.6) is refused', () => expect(sum((e) => { e.mean = 39.6; })).toHaveLength(1));
    it('an SD over 20 is refused', () => expect(sum((e) => { e.sd = 21; })).toEqual(['synthetic2026: entries[0]: sd 21 is implausible for m39_SumAngles']));
    it('a range end outside [300, 450] is refused, one inside accepted', () => {
      expect(sum((e) => { delete e.mean; delete e.sd; e.range = { low: 390, high: 402 }; })).toEqual([]);
      expect(sum((e) => { delete e.mean; delete e.sd; e.range = { low: 290, high: 402 }; })).toHaveLength(1);
    });
    it('every other angle keeps the 200° guard: the saddle angle at 396° is refused', () =>
      expect(problems((s) => { Object.assign(s.entries[0], { measurement: 'm34_Saddle', mean: 396, sd: 6 }); })).toEqual(['synthetic2026: entries[0]: mean 396 is implausible for unit "deg"']));
  });
  it('ageBand must be [low, high] with low <= high', () => expect(problems((s) => { s.entries[0].ageBand = [14, 9]; })).toHaveLength(1));
  // Fix round 1 (P40): PLAUSIBLE_OVERRIDES was indexed with a plain object (PLAUSIBLE_OVERRIDES[e.measurement]),
  // so a measurement id that names an Object.prototype property (e.g. "constructor") resolved to that
  // inherited property instead of undefined, and the validator threw instead of reporting a problem.
  it('a measurement id of "constructor" is reported as a problem, not thrown (P40)', () => {
    expect(() => problems((s) => { s.entries[0].measurement = 'constructor'; })).not.toThrow();
    expect(problems((s) => { s.entries[0].measurement = 'constructor'; }).length).toBeGreaterThan(0);
  });
  it('two entries for the same measurement, sex and age band are refused', () =>
    expect(problems((s) => { s.entries.push({ ...s.entries[0] }); })).toHaveLength(1));
  // Ruling P34 (Task 6 fix round 1): the resolver takes a band-less row only for a sex with no age
  // bands, so a band-less row beside banded rows of the same measurement and sex is dead whenever
  // the patient's age is known (the McNamara adult rows).
  it('a band-less row beside age-banded rows of the same measurement and sex is refused (P34)', () => {
    const p = problems((s) => { s.entries.push({ ...s.entries[0], ageBand: [6, 12] }); });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/synthetic2026: entries\[0\]: a band-less row is unreachable when the patient's age is known; give it an age band/);
  });
  it('(P34) band-less rows are fine for another sex or measurement, and all-banded rows are fine', () => {
    expect(problems((s) => { s.entries.push({ ...s.entries[0], sex: 'F', ageBand: [6, 12] }); })).toEqual([]);
    expect(problems((s) => { s.entries.push({ ...s.entries[0], measurement: 'm02_SNB', ageBand: [6, 12] }); })).toEqual([]);
    expect(problems((s) => { s.entries[0].ageBand = [13, 99]; s.entries.push({ ...s.entries[0], ageBand: [6, 12] }); })).toEqual([]);
  });
  it('a website set may omit sd but may not carry sdSource', () => {
    expect(problems((s) => { s.status = 'website'; delete s.entries[0].sd; })).toEqual([]);
    expect(problems((s) => { s.status = 'website'; s.entries[0].sdSource = { set: 'x', source: 'y' }; })).toHaveLength(1);
  });
  it('sdSource must name a set id and a location', () => expect(problems((s) => { delete s.entries[0].sd; s.entries[0].sdSource = { set: '', source: '' }; })).toHaveLength(1));
  it('every problem names the set id and entry index', () => expect(problems((s) => { s.entries[0].sd = 0; })[0]).toMatch(/synthetic2026.*entries\[0\]/));
});

// Fix round 1 (task review): malformed entries and set-level fields must be checked, not skipped.
describe('validateSet: malformed entries', () => {
  it('a missing entries array is refused, not silently treated as none', () =>
    expect(problems((s) => { delete s.entries; })).toHaveLength(1));
  it('a non-array entries is refused', () => expect(problems((s) => { s.entries = 'nope'; })).toHaveLength(1));
  it('a non-object entry (null) is refused, not thrown', () => {
    expect(() => problems((s) => { s.entries = [null]; })).not.toThrow();
    expect(problems((s) => { s.entries = [null]; })).toHaveLength(1);
  });
});

describe('validateSet: set-level fields', () => {
  it('kind must be one of the three', () => expect(problems((s) => { s.kind = 'nope'; })).toHaveLength(1));
  it('status must be one of the four', () => expect(problems((s) => { s.status = 'nope'; })).toHaveLength(1));
  it('citation is required', () => expect(problems((s) => { delete s.citation; })).toHaveLength(1));
  it('citation.authors must be non-empty', () => expect(problems((s) => { s.citation.authors = ''; })).toHaveLength(1));
  it('citation.title must be non-empty', () => expect(problems((s) => { s.citation.title = ''; })).toHaveLength(1));
  it('citation.year must be an integer in [1900, 2100]', () => {
    expect(problems((s) => { s.citation.year = 1899; })).toHaveLength(1);
    expect(problems((s) => { s.citation.year = 2101; })).toHaveLength(1);
    expect(problems((s) => { s.citation.year = 2020.5; })).toHaveLength(1);
  });
  // Task 5 fix round 1: an undated source (the NDC sheet) carries undated: true instead of a year.
  it('citation.year may be left out when undated: true', () =>
    expect(problems((s) => { delete s.citation.year; s.citation.undated = true; })).toEqual([]));
  it('citation.year is required when the source is not marked undated', () =>
    expect(problems((s) => { delete s.citation.year; })).toHaveLength(1));
  it('an undated source with a year is refused', () => {
    const p = problems((s) => { s.citation.undated = true; });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/an undated source has no year/);
  });
  // Task 4c (owner B-2): an entry's centre says whether its mean is a sample mean or an author's ideal.
  it("centre may be 'sample-mean' or 'ideal', nothing else", () => {
    expect(problems((s) => { s.entries[0].centre = 'ideal'; })).toEqual([]);
    expect(problems((s) => { s.entries[0].centre = 'sample-mean'; })).toEqual([]);
    const p = problems((s) => { s.entries[0].centre = 'target'; });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/centre/);
  });
  it('citation.undated must be true when present', () =>
    expect(problems((s) => { delete s.citation.year; s.citation.undated = false; })).not.toEqual([]));
  it('citation.openAccess must be a boolean', () => expect(problems((s) => { s.citation.openAccess = 'yes'; })).toHaveLength(1));
  it('an optional citation field must be a string when present', () => expect(problems((s) => { s.citation.doi = 123; })).toHaveLength(1));
  it('population.label must be non-empty', () => expect(problems((s) => { s.population.label = ''; })).toHaveLength(1));
  it('population.ethnicity must be an array of strings', () => {
    expect(problems((s) => { s.population.ethnicity = 'Chinese'; })).toHaveLength(1);
    expect(problems((s) => { s.population.ethnicity = [1]; })).toHaveLength(1);
  });
  it('sample numbers must be >= 0 when present', () => expect(problems((s) => { s.sample.n = -1; })).toHaveLength(1));
  it('selection must be from the enum', () => expect(problems((s) => { s.selection = 'nope'; })).toHaveLength(1));
  it('modality must be from the enum', () => expect(problems((s) => { s.modality = 'nope'; })).toHaveLength(1));
  it('headPosition must be from the enum', () => expect(problems((s) => { s.headPosition = 'nope'; })).toHaveLength(1));
  it('scale is required', () => expect(problems((s) => { delete s.scale; })).toHaveLength(1));
  it('scale.kind must be one of the three', () => expect(problems((s) => { s.scale = { kind: 'nope' }; })).toHaveLength(1));
  it('scale.source must be non-empty for true-size', () => expect(problems((s) => { s.scale = { kind: 'true-size', source: '' }; })).toHaveLength(1));
  it('scale.source must be non-empty for enlarged', () => expect(problems((s) => { s.scale = { kind: 'enlarged', percent: 8, source: '' }; })).toHaveLength(1));
  it('scale.percent: 0 is refused, 20 is accepted, 20.01 is refused, NaN is refused', () => {
    expect(problems((s) => { s.scale = { kind: 'enlarged', percent: 0, source: 'p. 1' }; })).toHaveLength(1);
    expect(problems((s) => { s.scale = { kind: 'enlarged', percent: 20, source: 'p. 1' }; })).toEqual([]);
    expect(problems((s) => { s.scale = { kind: 'enlarged', percent: 20.01, source: 'p. 1' }; })).toHaveLength(1);
    expect(problems((s) => { s.scale = { kind: 'enlarged', percent: NaN, source: 'p. 1' }; })).toHaveLength(1);
  });
  it('a leftover magnificationCorrected key is refused ("replaced by scale (Task 4b)")', () => {
    const result = problems((s) => { s.magnificationCorrected = 'unknown'; });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/replaced by scale/);
  });
  // Fix round 1 (review): percent only belongs to an 'enlarged' scale.
  it("percent is refused on a 'true-size' or 'not-stated' scale", () => {
    expect(problems((s) => { s.scale = { kind: 'true-size', source: 'p. 1', percent: 8 }; })).toHaveLength(1);
    expect(problems((s) => { s.scale = { kind: 'not-stated', percent: 8 }; })).toHaveLength(1);
  });
  // Fix round 1 (review): a present-but-non-object scale is a different message from an absent one.
  it('a non-object scale (e.g. a bare string) is refused with its own message; an absent scale keeps "scale is required"', () => {
    const result = problems((s) => { s.scale = 'not-stated'; });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("scale must be an object { kind: 'true-size' | 'enlarged' | 'not-stated' }");
    expect(problems((s) => { delete s.scale; })[0]).toContain('scale is required');
  });
  it('curation.extractedBy must be a non-empty array of strings', () => {
    expect(problems((s) => { s.curation.extractedBy = []; })).toHaveLength(1);
    expect(problems((s) => { s.curation.extractedBy = [1]; })).toHaveLength(1);
  });
  it('curation.date is mandatory', () => expect(problems((s) => { delete s.curation.date; })).toHaveLength(1));
  it('caveats must be an array of strings', () => expect(problems((s) => { s.caveats = 'none'; })).toHaveLength(1));
  it('secondHand.via must be non-empty when secondHand is present', () => expect(problems((s) => { s.secondHand = { via: '' }; })).toHaveLength(1));
  it('analyses is only allowed for kind "analysis-own"', () => expect(problems((s) => { s.analyses = ['steiner']; })).toHaveLength(1));
});

// Ruling P36 (Task 7 preliminary): overlapping age bands of one measurement and sex leave the resolver
// unable to tell which applies (it would take whichever sorts first).
describe('validateSet: P36 overlapping age bands', () => {
  it('two age bands of the same measurement and sex that overlap are refused', () => {
    const p = problems((s) => { s.entries[0].ageBand = [3, 44]; s.entries.push({ ...s.entries[0], ageBand: [8, 8] }); });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/synthetic2026: entries\[1\]: age bands of one measurement and sex must not overlap \(entries\[0\]\); the resolver could not tell which applies/);
  });
  it('bands that share only an end year overlap (bands are inclusive)', () =>
    expect(problems((s) => { s.entries[0].ageBand = [6, 12]; s.entries.push({ ...s.entries[0], ageBand: [12, 14] }); })).toHaveLength(1));
  it('adjacent bands, other sexes and other measurements are fine', () => {
    expect(problems((s) => { s.entries[0].ageBand = [6, 12]; s.entries.push({ ...s.entries[0], ageBand: [13, 14] }); })).toEqual([]);
    expect(problems((s) => { s.entries[0].ageBand = [6, 12]; s.entries.push({ ...s.entries[0], sex: 'F', ageBand: [8, 10] }); })).toEqual([]);
    expect(problems((s) => { s.entries[0].ageBand = [6, 12]; s.entries.push({ ...s.entries[0], measurement: 'm02_SNB', ageBand: [8, 10] }); })).toEqual([]);
  });
});

// Task 7 fix round 1 (owner R-1, R-2; ruling P38).
describe("validateSet: ageRows 'interpolate' and fromOtherSex", () => {
  it("ageRows may only be 'interpolate'", () => {
    expect(problems((s) => { s.ageRows = 'interpolate'; s.entries[0].ageBand = [3, 3]; })).toEqual([]);
    const p = problems((s) => { s.ageRows = 'nearest'; });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/ageRows must be 'interpolate'/);
  });
  it('in an interpolate set every age band is a printed age [a, a] or an open adult row [a, 99]', () => {
    expect(problems((s) => { s.ageRows = 'interpolate'; s.entries[0].ageBand = [18, 99]; })).toEqual([]);
    const p = problems((s) => { s.ageRows = 'interpolate'; s.entries[0].ageBand = [6, 8]; });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/entries\[0\]: in an 'interpolate' set an age band is one printed age \[a, a\] or an open adult row \[a, 99\]/);
  });
  it('an open row must start after the last printed point of its measurement and sex (P36)', () => {
    expect(problems((s) => { s.ageRows = 'interpolate'; s.entries[0].ageBand = [24, 99]; s.entries.push({ ...s.entries[0], ageBand: [18, 18] }); })).toEqual([]);
    expect(problems((s) => { s.ageRows = 'interpolate'; s.entries[0].ageBand = [18, 99]; s.entries.push({ ...s.entries[0], ageBand: [24, 24] }); })).toHaveLength(1);
  });
  it('fromOtherSex: the other sex, on a sexed row, with a note', () => {
    const ok = (e: any) => { e.sex = 'F'; e.fromOtherSex = 'M'; e.note = 'prints adult values for men only'; };
    expect(problems((s) => ok(s.entries[0]))).toEqual([]);
    expect(problems((s) => { ok(s.entries[0]); s.entries[0].fromOtherSex = 'F'; })).toHaveLength(1);       // the row's own sex
    expect(problems((s) => { ok(s.entries[0]); s.entries[0].sex = 'pooled'; })).toHaveLength(1);          // a pooled row
    expect(problems((s) => { ok(s.entries[0]); delete s.entries[0].note; })).toHaveLength(1);             // no note
    expect(problems((s) => { ok(s.entries[0]); s.entries[0].fromOtherSex = 'X'; })).toHaveLength(1);       // not a sex
    expect(problems((s) => { ok(s.entries[0]); s.entries[0].fromOtherSex = 'F'; })[0]).toMatch(/fromOtherSex must name the other sex/);
  });
});

// Final review I-4 (12 Oct): typos the validator could not see. Each was shown passing with 0 problems
// before this guard (final-review.md, positive controls).
describe('validateSet: enums and unknown keys (final review I-4)', () => {
  it('definitionMatch must be same, close or different', () => {
    const p = problems((s) => { s.entries[0].definitionMatch = 'Different'; s.entries[0].definitionNote = 'x'; });
    expect(p).toEqual(['synthetic2026: entries[0]: definitionMatch must be one of same, close, different']);
    expect(problems((s) => { delete s.entries[0].definitionMatch; })).toHaveLength(1);
  });
  it('sex must be M, F or pooled', () => {
    expect(problems((s) => { s.entries[0].sex = 'male'; })).toEqual(['synthetic2026: entries[0]: sex must be one of M, F, pooled']);
  });
  it('an unknown key on an entry is refused (a misspelt ageBand would make a child row an all-ages row)', () => {
    expect(problems((s) => { s.entries[0].ageband = [10, 17]; })).toEqual(['synthetic2026: entries[0]: unknown key "ageband"']);
  });
  it('an unknown key on the set is refused', () => {
    expect(problems((s) => { s.ageRow = 'interpolate'; })).toEqual(['synthetic2026: unknown key "ageRow"']);
  });
  it('an unknown key inside a set-level object (citation, population, sample, curation, scale, secondHand) is refused', () => {
    expect(problems((s) => { s.citation.yaer = 2020; })).toEqual(['synthetic2026: citation: unknown key "yaer"']);
    expect(problems((s) => { s.population.countryy = 'X'; })).toEqual(['synthetic2026: population: unknown key "countryy"']);
    expect(problems((s) => { s.sample.nmale = 3; })).toEqual(['synthetic2026: sample: unknown key "nmale"']);
    expect(problems((s) => { s.curation.note = 'x'; })).toEqual(['synthetic2026: curation: unknown key "note"']);
    expect(problems((s) => { s.scale.percent2 = 8; })).toEqual(['synthetic2026: scale: unknown key "percent2"']);
    expect(problems((s) => { s.secondHand = { via: 'X 2000', table: 'T1' }; })).toEqual(['synthetic2026: secondHand: unknown key "table"']);
  });
  it('an unknown key inside an entry object (range, sdSource) is refused', () => {
    expect(problems((s) => { s.entries[0].range = { low: 80, hgih: 85 }; })).toContain('synthetic2026: entries[0]: range: unknown key "hgih"');
    expect(problems((s) => { s.entries[0].sdSource = { set: 'x', source: 'T1', page: 3 }; })).toEqual(['synthetic2026: entries[0]: sdSource: unknown key "page"']);
  });
});

// Owner ruling P44-STRICT (12 Oct; final review I-5): record numbers with table and page, never the
// article's text. A quoted span of 8 or more words in a prose field is refused.
describe('validateSet: no quoted article text (owner P44-STRICT)', () => {
  const long = "'the quick brown fox jumps over the lazy dog'"; // 9 words
  it('a quoted span of 8 or more words in a caveat is refused, naming the field and the count', () => {
    expect(problems((s) => { s.caveats = [`Sample (p. 3): ${long}.`]; })).toEqual([
      'synthetic2026: caveats[0]: quoted span of 9 words; paraphrase it with its page (P44: numbers only, never article text)',
    ]);
  });
  it('every prose field is checked: curation.notes, scale.source, secondHand.via, entry note, definitionNote, source, clinicalTarget', () => {
    const q = `"one two three four five six seven eight"`; // 8 words, double quotes
    expect(problems((s) => { s.curation.notes = `x ${q}`; })).toHaveLength(1);
    expect(problems((s) => { s.scale = { kind: 'true-size', source: `p. 3 ${q}` }; })).toHaveLength(1);
    expect(problems((s) => { s.secondHand = { via: `X 2000 ${q}` }; })).toHaveLength(1);
    for (const k of ['note', 'source', 'clinicalTarget']) expect(problems((s) => { s.entries[0][k] = `p. 3 ${q}`; }), k).toHaveLength(1);
    expect(problems((s) => { s.entries[0].definitionMatch = 'close'; s.entries[0].definitionNote = `p. 3 “${q.slice(1, -1)}”`; })).toHaveLength(1);
  });
  it('short quoted labels (a table row, a column heading) and apostrophes are allowed', () => {
    expect(problems((s) => { s.caveats = ["Table VI row 'Upper lip thickness', Holdaway's 'basic upper lip thickness' (p. 24)", "column 'Jarabak norms Mean ± SD'"]; })).toEqual([]);
    expect(problems((s) => { s.entries[0].note = "Ricketts' men's rows; the author's and the reader's view of the lip's position in adults over twenty"; })).toEqual([]);
    expect(problems((s) => { s.caveats = ["'one two three four five six seven'"]; })).toEqual([]); // 7 words
  });
});

// T10-3 (12 Oct, Task 10 review I3): `plausibilityErrors` is called directly by a published set's own
// `validateEntry` (above, indirectly) AND by `apps/desktop/src/settings/userNorm.ts`'s `checkUserNorm` — this
// is its direct-API contract, so a change to either caller can't silently drift from the other.
describe('plausibilityErrors (shared by validateEntry and the desktop user-norm editor)', () => {
  it('a mean inside the unit’s bounds is not flagged', () => {
    expect(plausibilityErrors({ unit: 'deg', mean: 82, sd: 4 })).toEqual([]);
  });
  it('a mean outside the unit’s bounds is flagged, naming the unit', () => {
    expect(plausibilityErrors({ unit: 'deg', mean: 300 })).toEqual(['mean 300 is implausible for unit "deg"']);
  });
  it('an SD above the unit’s sdMax is flagged', () => {
    expect(plausibilityErrors({ unit: 'deg', mean: 80, sd: 25 })).toEqual(['sd 25 is implausible for unit "deg"']);
  });
  it('a measurement override (m39_SumAngles) takes precedence over the unit’s generic bounds', () => {
    expect(plausibilityErrors({ measurement: 'm39_SumAngles', unit: 'deg', mean: 396 })).toEqual([]);
    expect(plausibilityErrors({ measurement: 'm39_SumAngles', unit: 'deg', mean: 100 })).toEqual(['mean 100 is implausible for m39_SumAngles']);
  });
  it('an unknown unit with no override checks nothing (caught elsewhere)', () => {
    expect(plausibilityErrors({ unit: 'furlongs', mean: 999999 })).toEqual([]);
  });
});
