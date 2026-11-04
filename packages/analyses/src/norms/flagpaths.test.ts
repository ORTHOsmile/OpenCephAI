import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES } from '../analyses';
import { loadSets, POPULATIONS } from './load';
import { resolveNorm, type NormQuery, type Resolved } from './resolve';

// Ruling T4-1 (Task 4 fix round 1): each flag means ONE thing, so its screen words are true on every path
// that raises it. Before this, 'age-mismatched', 'sex-pooled', 'converted-to-true-size' and 'close' were also raised
// when only the BORROWED SD's row differed, the oldest-row stand-in for an unknown age reused 'age-mismatched', and
// 'ideal' said "coloured" on cells that were not. Real committed sets, production resolveNorm. No value changes.

const sets = loadSets();
const q = (o: Partial<NormQuery> & Pick<NormQuery, 'measurement' | 'analysisId'>): NormQuery =>
  ({ population: null, clinicDefault: null, sex: 'M', ageYears: 30, sets, userNorms: [], ...o });
const hit = (r: Resolved) => {
  if (r.kind !== 'norm') throw new Error('expected a norm');
  return r;
};

describe('T4-1: one meaning per flag, on real sets', () => {
  // Owner KIMRANK-1 (13 Oct): these two used African-American SNA (Bailey & Taylor's 8-12 y row standing in for an adult).
  // Kim 2025 now ranks as an ordinary Class I sample, so an adult (or an unknown age) gets Kim's adult row there, and the
  // paths moved to Downs 1948's own norm, whose only rows are 12-17 y.
  it("age not entered and no usable adult row: the oldest row stands in, flagged 'age-unknown-oldest-row', not 'age-mismatched'", () => {
    for (const sex of ['M', 'F', null] as const) {
      const r = hit(resolveNorm(q({ measurement: 'm04_FacialAngle', analysisId: 'downs', sex, ageYears: null })));
      expect([r.setId, r.mean, r.ageRowUsed, r.flags.includes('age-unknown-oldest-row'), r.flags.includes('age-mismatched')]).toEqual(['downs1948', 87.8, '12–17 y', true, false]);
      expect(r.sourceLine).toContain('age unknown; the oldest printed row (12–17 y) was used');
    }
  });
  it("age entered and outside every band: still 'age-mismatched' (the nearest age), never the unknown-age flag", () => {
    const r = hit(resolveNorm(q({ measurement: 'm04_FacialAngle', analysisId: 'downs', ageYears: 30 })));
    expect([r.setId, r.flags.includes('age-mismatched'), r.flags.includes('age-unknown-oldest-row')]).toEqual(['downs1948', true, false]);
  });
  it("only the borrowed SD was on an enlarged film: 'sd-converted', not 'converted-to-true-size' (Ricketts 1960 E-line, a scale-not-stated paper)", () => {
    const r = hit(resolveNorm(q({ measurement: 'm71_ULE', analysisId: 'e-line', ageYears: 6 })));
    expect([r.setId, r.printed, r.flags]).toEqual(['ricketts1960', null, ['scale-assumed', 'sd-converted', 'sd-borrowed']]);
    expect(r.sourceLine).toContain('film scale not stated in the paper');
    expect(r.sourceLine).toMatch(/SD borrowed from .*\(converted from \d+% film enlargement, printed [\d.]+ mm\)/);
  });
  it("the mean AND the borrowed SD were both converted: both flags (McNamara 1984's ideal, SD from Ann Arbor)", () => {
    const r = hit(resolveNorm(q({ measurement: 'm08_ANperp', analysisId: 'mcnamara', ageYears: null })));
    expect([r.setId, r.printed?.mean, r.flags]).toEqual(['mcnamara1984', 1, ['converted-to-true-size', 'ideal', 'sd-converted', 'sd-borrowed', 'age-assumed-adult']]);
  });
  it("an ideal with no SD to borrow is flagged 'ideal-uncoloured' and is not coloured (Steiner's occlusal plane)", () => {
    const r = hit(resolveNorm(q({ measurement: 'm60_OPSN', analysisId: 'steiner' })));
    expect([r.setId, r.colour, r.flags]).toEqual(['steiner1953', false, ['ideal-uncoloured']]);
    expect(r.sourceLine).toContain('no SD in this paper and no matching SD to borrow');
  });
  it("an ideal coloured with a borrowed SD keeps 'ideal' (Steiner's SNA)", () => {
    const r = hit(resolveNorm(q({ measurement: 'm01_SNA', analysisId: 'steiner' })));
    expect([r.setId, r.colour, r.flags]).toEqual(['steiner1953', true, ['ideal', 'sd-borrowed']]);
  });
});

describe('T4-1: what each flag claims holds on every result in the catalogue', () => {
  // Every analysis x measurement x population (none, each, analysis-own) x sex (M, F, unknown) x age (unknown, child, adult).
  const results: { q: NormQuery; r: Extract<Resolved, { kind: 'norm' }> }[] = [];
  for (const a of ALL_ANALYSES) for (const m of a.measurements) for (const population of [null, ...POPULATIONS.map((p) => p.id), 'analysis-own'])
    for (const sex of ['M', 'F', null] as const) for (const ageYears of [null, 9, 30]) {
      const qq = q({ measurement: m.node, analysisId: a.id, population, sex, ageYears });
      const r = resolveNorm(qq);
      if (r.kind === 'norm') results.push({ q: qq, r });
    }
  const where = (f: string) => results.filter(({ r }) => (r.flags as string[]).includes(f));

  it('the catalogue sweep resolved results, and every flag below is raised somewhere in it (so each check below can fail)', () => {
    // OWNFALL-1 (12 Oct): a population with nothing now asks ('choose', not a norm), so fewer norms: 6,384 (was > 10,000).
    expect(results.length).toBeGreaterThan(5000);
    for (const f of ['age-mismatched', 'age-unknown-oldest-row', 'converted-to-true-size', 'sd-converted', 'ideal', 'ideal-uncoloured', 'sex-pooled'])
      expect(where(f).length, f).toBeGreaterThan(0);
  });
  it("'age-mismatched' only with an age entered; 'age-unknown-oldest-row' only without one", () => {
    expect(where('age-mismatched').filter(({ q }) => q.ageYears === null).length).toBe(0);
    expect(where('age-unknown-oldest-row').filter(({ q }) => q.ageYears !== null).length).toBe(0);
  });
  it("'converted-to-true-size' only when the norm's own printed values were converted (printed is kept)", () => {
    expect(where('converted-to-true-size').filter(({ r }) => r.printed === null).length).toBe(0);
  });
  it("'ideal' only on a coloured cell; 'ideal-uncoloured' only on an uncoloured one", () => {
    expect(where('ideal').filter(({ r }) => !r.colour).length).toBe(0);
    expect(where('ideal-uncoloured').filter(({ r }) => r.colour).length).toBe(0);
  });
  it("'sex-pooled' only when the row used is for both sexes and the patient's sex is recorded", () => {
    expect(where('sex-pooled').filter(({ q, r }) => r.entry.sex !== 'pooled' || q.sex === null).length).toBe(0);
  });
});
