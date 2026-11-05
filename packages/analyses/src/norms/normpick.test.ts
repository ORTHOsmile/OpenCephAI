import { describe, it, expect } from 'vitest';
import { validateSet } from './validate';
import { POPULATIONS } from './load';
import type { NormEntry, NormSet } from './types';
import { normChoices, resolveAcross, resolveNorm, type NormQuery, type Resolved } from './resolve';
import { FLAG_WORDS, choiceFacts } from './flags';
import { loadSets } from './load';

// Owner NORM-PICK-1 (12 Oct), replacing the silent user-norm fallback (final review I-1): when the chosen population
// has no norm for a measurement, the resolver says so ("no <population> norm — choose one", no value, uncoloured)
// instead of quietly showing the clinician's own norm; it lists every source that has the measurement; and a pick
// saved on the case for that population resolves to the picked source, flagged 'chosen-by-you'. SYNTHETIC sets only.
const POP_IDS = POPULATIONS.map((p) => p.id);
function mkSet(s: Partial<NormSet> & { id: string; entries: NormEntry[] }): NormSet {
  const set = {
    kind: 'population', status: 'verified',
    citation: { authors: 'Synthetic A', title: 'Synthetic norms', year: 2020, openAccess: true },
    population: { id: 'caucasian', label: 'Caucasian', ethnicity: ['European'] },
    sample: { n: 40, ageMin: 18, ageMax: 30 }, selection: 'class-I', modality: 'digital', scale: { kind: 'true-size', source: 'SYNTHETIC' },
    headPosition: 'FH', curation: { extractedBy: ['a', 'b'], comparedOn: '2026-10-12', date: '2026-10-12' }, caveats: [], ...s,
  } as NormSet;
  const problems = validateSet(set, { populations: POP_IDS });
  if (problems.length) throw new Error(`synthetic fixture invalid: ${problems.join('; ')}`);
  return set;
}
const row = (measurement: string, mean: number, extra: Partial<NormEntry> = {}): NormEntry =>
  ({ measurement, sex: 'pooled', mean, sd: 3, unit: 'deg', source: 'Table 1', definitionMatch: 'same', ...extra }) as NormEntry;

// SNA: Chinese and Caucasian. Wits (mm): Caucasian only; no analysis's own norm for it in 'wits'. FH–MP: nowhere.
const CN = mkSet({ id: 'cn-synthetic', population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] }, sample: { n: 60, ageMin: 11, ageMax: 14 },
  entries: [row('m01_SNA', 81)] });
const CA = mkSet({ id: 'ca-synthetic', entries: [row('m01_SNA', 82), row('m13_Wits', -1, { unit: 'mm' })] });
const OWN = mkSet({ id: 'steiner-own-synthetic', kind: 'analysis-own', analyses: ['steiner'], sample: {},
  population: { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] }, entries: [row('m01_SNA', 82.5)] });
const SETS = [CN, CA, OWN];
const MINE = [{ setName: 'Mine', measurement: 'm13_Wits', mean: 0, sd: 2, sourceNote: 'SYNTHETIC clinic sample' }];
const q = (o: Partial<NormQuery>): NormQuery => ({
  measurement: 'm13_Wits', analysisId: 'wits', population: 'chinese', clinicDefault: null, sex: null, ageYears: null,
  sets: SETS, userNorms: MINE, ...o,
});
const norm = (r: Resolved) => {
  if (r.kind !== 'norm') throw new Error(`expected a norm, got ${r.kind}`);
  return r;
};

describe('NORM-PICK-1 with Auto (owner N-A3, AUTO-Q6, 19 Oct 2026): no norm in the chosen population → Auto; only your own norm has it → "choose one"', () => {
  // Without the Caucasian set, only the clinician's own norm (user:Mine) has Wits — never an Auto candidate (AUTO-Q11):
  // "choose one", as before.
  const noAuto = { sets: [CN, OWN] };
  it('the population has nothing and the analysis no own norm: Auto takes the Caucasian set, flagged and named; Q11: only your own norm → "choose one"', () => {
    const r = norm(resolveNorm(q({})));
    expect([r.setId, r.mean, r.flags, r.auto?.step]).toEqual(['ca-synthetic', -1, ['auto-fallback'], 'caucasian']);
    expect(r.sourceLine.endsWith(' · Auto (no Chinese norm)')).toBe(true);
    expect(resolveNorm(q(noAuto))).toEqual({ kind: 'choose', population: 'chinese', reason: 'no Chinese norm — choose one' });
  });
  it('the same for the clinic default, and for a user-norm set chosen as the population', () => {
    expect(norm(resolveNorm(q({ population: null, clinicDefault: 'chinese' }))).auto?.population).toBe('chinese');
    const other = [...MINE, { setName: 'Other', measurement: 'm01_SNA', mean: 80, sd: 3, sourceNote: 'SYNTHETIC' }];
    expect(norm(resolveNorm(q({ population: 'user:Other', userNorms: other }))).sourceLine.endsWith(' · Auto (no Other (your norms) norm)')).toBe(true);
    expect(resolveNorm(q({ ...noAuto, population: 'user:Other', userNorms: other }))).toEqual({ kind: 'choose', population: 'user:Other', reason: 'no Other (your norms) norm — choose one' });
  });
  it("the analysis's own norms chosen directly: Auto goes to Caucasian (step 2 is the same source); without it, named by the analysis", () => {
    expect(norm(resolveNorm(q({ population: 'analysis-own' }))).sourceLine.endsWith(" · Auto (no Wits's own norm)")).toBe(true);
    expect(resolveNorm(q({ ...noAuto, population: 'analysis-own' }))).toEqual({ kind: 'choose', population: 'analysis-own', reason: "no Wits's own norm — choose one" });
  });
  it("step 2 first: a population with nothing where the analysis has its own norm uses it (Auto); the own norm can still be picked", () => {
    const r = norm(resolveNorm(q({ measurement: 'm01_SNA', analysisId: 'steiner', population: 'japanese' })));
    expect([r.setId, r.flags, r.auto?.step]).toEqual(['steiner-own-synthetic', ['auto-fallback'], 'analysis-own']);
    expect(normChoices(q({ measurement: 'm01_SNA', analysisId: 'steiner', population: 'japanese' })).map((c) => c.id)).toEqual(['auto', 'chinese', 'caucasian', 'analysis-own']);
    const picked = norm(resolveNorm(q({ measurement: 'm01_SNA', analysisId: 'steiner', population: 'japanese', picks: { japanese: { m01_SNA: 'analysis-own' } } })));
    expect([picked.setId, picked.flags]).toEqual(['steiner-own-synthetic', ['chosen-by-you']]);
  });
  it("unchanged: no population chosen uses the analysis's own norm (not a fallback), else your norms; nothing anywhere is still none", () => {
    const own = norm(resolveNorm(q({ measurement: 'm01_SNA', analysisId: 'steiner', population: null })));
    expect([own.setId, own.flags]).toEqual(['steiner-own-synthetic', []]);
    const noPop = norm(resolveNorm(q({ population: null })));
    expect([noPop.setId, noPop.flags]).toEqual(['user:Mine', ['user-norm']]);
    expect(resolveNorm(q({ measurement: 'm22_FHMPt', analysisId: 'downs' })).kind).toBe('none');
  });

  // Ruling FR-1 (scoped re-review): each choice names the ROW the patient would be compared with — its own age band and
  // n (resolved.entry), never the whole study's. These synthetic rows print no band and no n, so the sample's count for
  // the row's sex stands in (the source line's own rule), and no ages are stated.
  it('the choices: every source holding the measurement, each with the n and ages of the row that would be used', () => {
    const c = normChoices(q({}));
    expect(c.map((x) => [x.id, x.label, x.rows, x.ages])).toEqual([
      ['auto', 'Auto · Caucasian — Synthetic 2020, n = 40 (no Chinese norm)', [{ who: 'sexes pooled', n: 40 }], null],
      ['caucasian', POPULATIONS.find((p) => p.id === 'caucasian')!.label, [{ who: 'sexes pooled', n: 40 }], null],
      ['user:Mine', 'Mine (your norms)', [{ who: 'sexes pooled', n: null }], null],
    ]);
    expect(norm(c[1].resolved).mean).toBe(-1);
    expect(norm(c[2].resolved).flags).toEqual(['user-norm']);
    // The analysis's own norm is a choice when it has the measurement; the chosen (empty) population never is.
    const sna = normChoices(q({ measurement: 'm01_SNA', analysisId: 'steiner', population: 'japanese' }));
    expect(sna.map((x) => x.id)).toEqual(['auto', 'chinese', 'caucasian', 'analysis-own']);
    expect(sna.find((x) => x.id === 'analysis-own')!.label).toBe("Steiner's own norm");
  });

  it('a pick saved for this population resolves to the picked source, labelled "chosen by you"', () => {
    const ca = norm(resolveNorm(q({ picks: { chinese: { m13_Wits: 'caucasian' } } })));
    expect([ca.setId, ca.mean, ca.colour, ca.flags]).toEqual(['ca-synthetic', -1, true, ['chosen-by-you']]);
    expect(ca.sourceLine).toContain(' · chosen by you (no Chinese norm)');
    const mine = norm(resolveNorm(q({ picks: { chinese: { m13_Wits: 'user:Mine' } } })));
    expect([mine.setId, mine.flags]).toEqual(['user:Mine', ['user-norm', 'chosen-by-you']]);
    expect(FLAG_WORDS['chosen-by-you'].badge).toBe('chosen by you');
  });

  it('a pick is per population and per measurement, and never overrides a norm the population has', () => {
    expect(norm(resolveNorm(q({ picks: { japanese: { m13_Wits: 'caucasian' } } }))).flags).toEqual(['auto-fallback']);
    expect(norm(resolveNorm(q({ picks: { chinese: { m01_SNA: 'caucasian' } } }))).flags).toEqual(['auto-fallback']);
    const cn = norm(resolveNorm(q({ measurement: 'm01_SNA', analysisId: 'steiner', picks: { chinese: { m01_SNA: 'caucasian' } } })));
    expect([cn.setId, cn.flags.includes('chosen-by-you')]).toEqual(['cn-synthetic', false]);
  });

  it('a pick whose source no longer has the measurement (a deleted user set) is ignored: Auto (spec edge case)', () => {
    expect(norm(resolveNorm(q({ userNorms: [], picks: { chinese: { m13_Wits: 'user:Mine' } } }))).flags).toEqual(['auto-fallback']);
  });

  it('compare (ruling AUTO-Q7): a column is the population\'s own norm or none — a pick saved for it is not used there', () => {
    const [cn, jp, ca] = resolveAcross(q({ picks: { chinese: { m13_Wits: 'user:Mine' } } }), ['chinese', 'japanese', 'caucasian']);
    expect([cn.kind, jp.kind, norm(ca).setId, norm(ca).flags]).toEqual(['none', 'none', 'ca-synthetic', []]);
    expect(norm(resolveNorm(q({ picks: { chinese: { m13_Wits: 'user:Mine' } } }))).flags).toContain('chosen-by-you');   // the Measurements tab still uses it
  });
});

// Ruling FR-1, on the committed sets: Eastman SN–MxP with the case set to Malay (no Malay SN–MxP, no Eastman own norm).
// Thilander 2005 (Swedish) studied 469 people aged 4.2–32.2 y; the row an adult woman is compared with is its women
// 29–32 y, n = 19 — and with the sex not recorded, its men (n = 11) and women (n = 19) at 29–32 y, averaged.
describe('FR-1: the choice list shows the row used, not the whole study', () => {
  const sets = loadSets();
  const real = (sex: 'M' | 'F' | null) => normChoices({ measurement: 'm26_SNMxP', analysisId: 'eastman', population: 'malay', clinicDefault: null, sex, ageYears: 30, sets, userNorms: [] })
    .find((c) => c.id === 'swedish')!;
  it('an adult woman: women 29–32 y, n = 19', () => {
    const c = real('F');
    expect([c.rows, c.ages, choiceFacts(c)]).toEqual([[{ who: 'women', n: 19 }], '29–32 y', 'women, n = 19 · 29–32 y']);
  });
  it('sex not recorded: both rows\' n, men 11 and women 19, at 29–32 y', () => {
    const c = real(null);
    expect([c.rows, c.ages, choiceFacts(c)]).toEqual([[{ who: 'men', n: 11 }, { who: 'women', n: 19 }], '29–32 y', 'men, n = 11 + women, n = 19 · 29–32 y']);
  });
});

