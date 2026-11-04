import { describe, it, expect } from 'vitest';
import { loadSets } from './load';
import { resolveNorm, AGE_NOT_ENTERED_WORDS, FILM_DATE_MISSING_WORDS, type NormQuery } from './resolve';
import { FLAG_WORDS } from './flags';
import type { NormEntry, NormSet } from './types';

// Owner AGE-UNK-1 (12 Oct): age not entered → assume an adult. SYNTHETIC sets, except the committed-data block.
const mk = (id: string, n: number, entries: Partial<NormEntry>[], extra: Partial<NormSet> = {}): NormSet => ({
  id, kind: 'population', status: 'verified',
  citation: { authors: 'Synthetic A', title: 'SYNTHETIC', year: 2020, openAccess: true },
  population: { id: 'chinese', label: 'Chinese', ethnicity: [] }, sample: { n },
  selection: 'class-I-balanced', modality: 'film', scale: { kind: 'true-size', source: 'SYNTHETIC' }, headPosition: 'unknown',
  curation: { extractedBy: ['SYNTHETIC'], date: '2026-10-12' }, caveats: [],
  entries: entries.map((e) => ({ measurement: 'm01_SNA', sex: 'pooled', unit: '°', source: 'Table 1, p. 1', definitionMatch: 'same', ...e })) as NormEntry[],
  ...extra,
});
const q = (sets: NormSet[], over: Partial<NormQuery> = {}): NormQuery =>
  ({ measurement: 'm01_SNA', analysisId: 'steiner', population: 'chinese', clinicDefault: null, sex: null, ageYears: null, sets, userNorms: [], ...over });
const norm = (r: ReturnType<typeof resolveNorm>) => { if (r.kind !== 'norm') throw new Error('no norm'); return r; };

const childOnly = mk('synthetic-children', 400, [{ ageBand: [9, 9], mean: 78, sd: 3 }, { ageBand: [12, 12], mean: 79, sd: 3 }]);
const adults = mk('synthetic-adults', 100, [{ ageBand: [18, 40], mean: 82, sd: 3.5 }]);

describe('AGE-UNK-1: age not entered → adult norms assumed', () => {
  it('the words are defined once, for the screen', () => {
    expect(AGE_NOT_ENTERED_WORDS).toBe('age not entered — adult norms assumed');
  });
  it('a set with an adult row ranks before a larger set with child rows only; flagged, said, not "other age"', () => {
    for (const sex of [null, 'M', 'F'] as const) {
      const r = norm(resolveNorm(q([childOnly, adults], { sex })));
      expect([r.setId, r.mean, r.flags.includes('age-assumed-adult'), r.flags.includes('age-mismatched')]).toEqual(['synthetic-adults', 82, true, false]);
      expect(r.sourceLine).toContain(` · ${AGE_NOT_ENTERED_WORDS}`);
    }
  });
  it('an age entered: unchanged — the child set for a 9-year-old, no adult flag', () => {
    const r = norm(resolveNorm(q([childOnly, adults], { ageYears: 9 })));
    expect([r.setId, r.mean, r.flags.includes('age-assumed-adult')]).toEqual(['synthetic-children', 78, false]);
  });
  it('after the adult step, rule 5 as before: the larger adult sample first', () => {
    const big = mk('synthetic-big-adults', 300, [{ ageBand: [20, 50], mean: 83, sd: 3 }]);
    expect(norm(resolveNorm(q([childOnly, adults, big]))).setId).toBe('synthetic-big-adults');
  });
  it('a band spanning 18 counts as adult (AGE-3), unflagged as to age but marked adult assumed', () => {
    const span = mk('synthetic-span', 50, [{ ageBand: [16, 30], mean: 81, sd: 3 }]);
    const r = norm(resolveNorm(q([childOnly, span])));
    expect([r.setId, r.flags.includes('age-mismatched'), r.flags.includes('age-assumed-adult')]).toEqual(['synthetic-span', false, true]);
  });
  it('order (review Minor 2): website-last and the treatment-sample demotion (P37-FIRST) still come BEFORE the adult step', () => {
    // A bigger adult set that is a website, or a sample of treatment-seeking patients, still loses to a smaller
    // child-only paper: the adult step only orders papers within those groups, it never lifts a demoted set.
    const webAdult = mk('synthetic-web-adult', 1000, [{ ageBand: [18, 40], mean: 90, sd: 3 }], { status: 'website' });
    const treatAdult = mk('synthetic-treatment-adult', 1000, [{ ageBand: [18, 40], mean: 91, sd: 3 }], { selection: 'mixed-occlusion' });
    for (const demoted of [webAdult, treatAdult]) {
      const r = norm(resolveNorm(q([demoted, childOnly])));
      // Ruling T4-1 (Task 4 fix round 1): the child row standing in for an unknown age has its own flag.
      expect([r.setId, r.flags.includes('age-unknown-oldest-row'), r.flags.includes('age-mismatched')]).toEqual(['synthetic-children', true, false]);
    }
    // Website still after a treatment sample (P37-FIRST wording): with only the two demoted adult sets, the treatment sample.
    expect(norm(resolveNorm(q([webAdult, treatAdult]))).setId).toBe('synthetic-treatment-adult');
  });
  it('a band that stops at 18 ([15, 18]) is a child row: the set ranks with the child-only sets', () => {
    const teen = mk('synthetic-teen', 500, [{ ageBand: [15, 18], mean: 80, sd: 3 }]);
    expect(norm(resolveNorm(q([teen, adults]))).setId).toBe('synthetic-adults');
  });
  it('the adult band starts above 18: the lowest adult band is used', () => {
    const late = mk('synthetic-late', 100, [{ ageBand: [25, 34], mean: 84, sd: 3 }, { ageBand: [35, 50], mean: 85, sd: 3 }]);
    const r = norm(resolveNorm(q([late])));
    expect([r.entry.ageBand, r.flags.includes('age-assumed-adult'), r.flags.includes('age-mismatched')]).toEqual([[25, 34], true, false]);
  });
  it('no set has an adult row: the oldest child row stands in as before (its own flag, T4-1), never "adult norms assumed"', () => {
    const r = norm(resolveNorm(q([childOnly])));
    expect([r.entry.ageBand, r.flags.includes('age-unknown-oldest-row'), r.flags.includes('age-mismatched'), r.flags.includes('age-assumed-adult')]).toEqual([[12, 12], true, false, false]);
  });
  it('a row with no age band at all: nothing was assumed, no flag', () => {
    const anyAge = mk('synthetic-anyage', 100, [{ mean: 82, sd: 2 }]);
    expect(norm(resolveNorm(q([anyAge]))).flags.includes('age-assumed-adult')).toBe(false);
  });
  it('known sex counts only own-sex or pooled adult rows: a women-only adult row does not lift the set for a man', () => {
    const womenAdult = mk('synthetic-women-adult', 400, [{ sex: 'M', ageBand: [12, 12], mean: 79, sd: 3 }, { sex: 'F', ageBand: [18, 40], mean: 80, sd: 3 }]);
    expect(norm(resolveNorm(q([womenAdult, adults], { sex: 'M' }))).setId).toBe('synthetic-adults');
    expect(norm(resolveNorm(q([womenAdult, adults], { sex: 'F' }))).setId).toBe('synthetic-women-adult');
  });
  it('sex unknown (SEX-AVG-1, T3-3): only an adult age both sexes printed counts; the adult pair is averaged and flagged', () => {
    const pairAdult = mk('synthetic-pair-adult', 400, [{ sex: 'M', ageBand: [18, 40], mean: 80, sd: 2 }, { sex: 'F', ageBand: [18, 40], mean: 82, sd: 2 }]);
    const lone = mk('synthetic-lone', 500, [{ sex: 'M', ageBand: [9, 9], mean: 78, sd: 3 }, { sex: 'F', ageBand: [9, 9], mean: 78, sd: 3 }, { sex: 'F', ageBand: [18, 40], mean: 80, sd: 3 }]);
    const r = norm(resolveNorm(q([lone, pairAdult])));
    expect([r.setId, r.mean, r.flags.includes('sexes-averaged'), r.flags.includes('age-assumed-adult')]).toEqual(['synthetic-pair-adult', 81, true, true]);
  });
});

describe('AGE-UNK-1 on the committed data', () => {
  const sets = loadSets();
  const at = (measurement: string, analysisId: string, population: string | null, sex: 'M' | 'F' | null) =>
    norm(resolveNorm({ measurement, analysisId, population, clinicDefault: null, sex, ageYears: null, sets, userNorms: [] }));
  it('Chinese interincisal, no age: an adult paper, never Miao 1995\'s 9-year-olds — Fu 1975 (n 144) above Zheng 2026 (n 120) by rule 5', () => {
    for (const sex of [null, 'M', 'F'] as const) {
      const r = at('m53_Interincisal', 'steiner', 'chinese', sex);
      expect([r.setId, r.mean, r.sd]).toEqual(['moate2002-fu1975', 125, 8]);
      expect(r.entry.ageBand![0] >= 18 || r.entry.ageBand![1] > 18).toBe(true);
      expect([r.flags.includes('age-assumed-adult'), r.flags.includes('age-mismatched')]).toEqual([true, false]);
    }
  });
  it('Ricketts, no age: the adult row (18), no interpolation, flagged adult assumed', () => {
    const r = at('m04_FacialAngle', 'ricketts', null, 'M');
    expect([r.mean, r.entry.ageBand, r.flags.includes('interpolated'), r.flags.includes('age-assumed-adult')]).toEqual([88, [18, 18], false, true]);
  });
});

// Owner FILMDATE-1 (12 Oct; final review M-7): the date of birth IS entered but the film date is missing — the same
// adult row (AGE-UNK-1, values unchanged), but the words name the missing field, not "age not entered".
describe('FILMDATE-1: date of birth entered, film date missing', () => {
  it('the words, defined once', () => {
    expect(FILM_DATE_MISSING_WORDS).toBe('film date missing — adult norms assumed');
    expect(FLAG_WORDS['film-date-missing'].tip).toBe('Film date missing — adult norms assumed. Enter the date the film was taken for the exact norm.');
  });
  it('the same row and values as age not entered, flagged and said as the film date', () => {
    const plain = norm(resolveNorm(q([childOnly, adults])));
    const r = norm(resolveNorm(q([childOnly, adults], { filmDateMissing: true })));
    expect([r.setId, r.mean, r.sd]).toEqual([plain.setId, plain.mean, plain.sd]);
    expect([r.flags.includes('film-date-missing'), r.flags.includes('age-assumed-adult')]).toEqual([true, false]);
    expect(r.sourceLine).toContain(` · ${FILM_DATE_MISSING_WORDS}`);
    expect(r.sourceLine).not.toContain(AGE_NOT_ENTERED_WORDS);
  });
  it('an age known (the film date entered after all) raises neither', () => {
    const r = norm(resolveNorm(q([childOnly, adults], { filmDateMissing: true, ageYears: 30 })));
    expect([r.flags.includes('film-date-missing'), r.flags.includes('age-assumed-adult')]).toEqual([false, false]);
  });
});
