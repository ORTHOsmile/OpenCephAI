import { describe, it, expect } from 'vitest';
import { loadSets } from './load';
import { resolveNorm, type NormQuery } from './resolve';
import type { NormEntry, NormSet } from './types';

// SYNTHETIC sets only, except the last test (the committed Ricketts 1981 set).
const mk = (entries: Partial<NormEntry>[], extra: Partial<NormSet> = {}): NormSet => ({
  id: 'synthetic-sexes', kind: 'population', status: 'verified',
  citation: { authors: 'Synthetic A', title: 'SYNTHETIC', year: 2020, openAccess: true },
  population: { id: 'chinese', label: 'Chinese', ethnicity: [] }, sample: { n: 100, nMale: 50, nFemale: 50 },
  selection: 'unknown', modality: 'film', scale: { kind: 'true-size', source: 'SYNTHETIC' }, headPosition: 'unknown',
  curation: { extractedBy: ['SYNTHETIC'], date: '2026-10-12' }, caveats: [],
  entries: entries.map((e) => ({ measurement: 'm72_LLE', sex: 'pooled', unit: 'mm', source: 'Table 1, p. 1', definitionMatch: 'same', ...e })) as NormEntry[],
  ...extra,
});
const q = (sets: NormSet[], over: Partial<NormQuery> = {}): NormQuery =>
  ({ measurement: 'm72_LLE', analysisId: 'e-line', population: 'chinese', clinicDefault: null, sex: null, ageYears: 30, sets, userNorms: [], ...over });
const adult: [number, number] = [18, 40];
const men = { sex: 'M' as const, ageBand: adult, mean: -4, sd: 2 }, women = { sex: 'F' as const, ageBand: adult, mean: -6, sd: 2 };

describe('SEX-AVG-1: sex not recorded, men\'s and women\'s rows only → averaged', () => {
  it('the owner\'s worked example: −4 ± 2 and −6 ± 2 → −5 ± 2.236', () => {
    const r = resolveNorm(q([mk([men, women])]));
    if (r.kind !== 'norm') throw new Error('no norm');
    expect(r.mean).toBeCloseTo(-5, 10);
    expect(r.sd).toBeCloseTo(Math.sqrt(5), 10);            // √((4 + 4)/2 + 1²) = 2.2360…
    expect(r.flags).toContain('sexes-averaged');
    expect(r.colour).toBe(true);
    expect(r.sourceLine).toMatch(/averaged/);
  });
  it('a row for both sexes at that age wins (not averaged)', () => {
    const r = resolveNorm(q([mk([men, women, { sex: 'pooled', ageBand: adult, mean: -4.5, sd: 2.1 }])]));
    expect(r.kind === 'norm' && [r.mean, r.flags.includes('sexes-averaged')]).toEqual([-4.5, false]);
  });
  it('sex recorded: the patient\'s own row, unchanged', () => {
    const r = resolveNorm(q([mk([men, women])], { sex: 'M' }));
    expect(r.kind === 'norm' && [r.mean, r.sd, r.flags.includes('sexes-averaged')]).toEqual([-4, 2, false]);
  });
  it('sex recorded, rows only at another age: still the patient\'s own row, never averaged', () => {
    const r = resolveNorm(q([mk([{ ...men, ageBand: [10, 12] }, { ...women, ageBand: [10, 12] }])], { sex: 'F' }));
    expect(r.kind === 'norm' && [r.mean, r.flags.includes('sexes-averaged'), r.flags.includes('age-mismatched')]).toEqual([-6, false, true]);
  });
  it('only one sex printed: not averaged (the old path: no usable row for an unknown sex)', () => {
    expect(resolveNorm(q([mk([men])])).kind).toBe('none');
  });
  it('one row without an SD: the average has none, and the borrowed-SD path runs', () => {
    const r = resolveNorm(q([mk([men, { ...women, sd: undefined }])]));
    if (r.kind !== 'norm') throw new Error('no norm');
    expect(r.mean).toBeCloseTo(-5, 10);
    expect(r.sd).toBeNull();                                  // no other set in this query to lend one
    expect(r.sourceLine).toMatch(/no matching SD to borrow/);
  });
  it('ideals average the same way and stay ideals', () => {
    const r = resolveNorm(q([mk([{ ...men, centre: 'ideal' }, { ...women, centre: 'ideal' }])]));
    expect(r.kind === 'norm' && r.flags).toEqual(expect.arrayContaining(['ideal', 'sexes-averaged']));
  });
  it('range-only rows: the ends are averaged', () => {
    const r = resolveNorm(q([mk([{ sex: 'M', ageBand: adult, range: { low: 1, high: 3 } }, { sex: 'F', ageBand: adult, range: { low: 3, high: 5 } }])]));
    expect(r.kind === 'norm' && r.range).toEqual({ low: 2, high: 4 });
  });
  it('interpolation first, then the average (Ricketts-style printed ages)', () => {
    const s = mk([{ sex: 'M', ageBand: [10, 10], mean: 0, sd: 2 }, { sex: 'M', ageBand: [12, 12], mean: 2, sd: 2 },
      { sex: 'F', ageBand: [10, 10], mean: 2, sd: 2 }, { sex: 'F', ageBand: [12, 12], mean: 4, sd: 2 }], { ageRows: 'interpolate' });
    const r = resolveNorm(q([s], { ageYears: 11 }));         // men 1, women 3 → 2; SD √((4+4)/2 + 1) = √5
    expect(r.kind === 'norm' && [r.mean, r.flags.includes('interpolated'), r.flags.includes('sexes-averaged')]).toEqual([2, true, true]);
    expect(r.kind === 'norm' && r.sd).toBeCloseTo(Math.sqrt(5), 10);
  });
  it('both sexes only at another age: averaged, and still flagged "other age"', () => {
    const r = resolveNorm(q([mk([{ ...men, ageBand: [10, 12] }, { ...women, ageBand: [10, 12] }])], { ageYears: 30 }));
    expect(r.kind === 'norm' && r.flags).toEqual(expect.arrayContaining(['sexes-averaged', 'age-mismatched']));
  });
  it('an enlarged film: averaged first, then converted to true size (M-1)', () => {
    const r = resolveNorm(q([mk([men, women], { scale: { kind: 'enlarged', percent: 10, source: 'SYNTHETIC p. 1' } })]));
    expect(r.kind === 'norm' && r.mean).toBeCloseTo(-5 / 1.1, 10);
    expect(r.kind === 'norm' && r.sd).toBeCloseTo(Math.sqrt(5) / 1.1, 10);
  });
});

describe('pre-flight P7, P9, P11', () => {
  it('P7: a both-sexes row that covers the age wins, even in a different band from the men\'s and women\'s rows', () => {
    const r = resolveNorm(q([mk([men, women, { sex: 'pooled', ageBand: [25, 35], mean: -4.5, sd: 2.1 }])]));
    expect(r.kind === 'norm' && [r.mean, r.flags.includes('sexes-averaged')]).toEqual([-4.5, false]);
  });
  it('P7: a men\'s/women\'s pair farther from the age never beats a nearer both-sexes row', () => {
    const r = resolveNorm(q([mk([{ ...men, ageBand: [40, 50] }, { ...women, ageBand: [40, 50] }, { sex: 'pooled', ageBand: [20, 25], mean: -4.5, sd: 2.1 }])]));
    expect(r.kind === 'norm' && [r.mean, r.flags.includes('sexes-averaged')]).toEqual([-4.5, false]);   // age 30: pooled 5 y away, pair 10 y away
  });
  it('P9: a women\'s row copied from the men\'s is not averaged; the copy is used, flagged "other sex\'s values"', () => {
    const copy = { ...women, mean: -4, sd: 2, fromOtherSex: 'M' as const, note: 'SYNTHETIC: the author prints adult values for men only' };
    const r = resolveNorm(q([mk([men, copy])]));
    if (r.kind !== 'norm') throw new Error('no norm');
    expect([r.mean, r.flags.includes('other-sex-values'), r.flags.includes('sexes-averaged')]).toEqual([-4, true, false]);
  });
  it('P11: an SD both rows take from the same other paper stays; from two different papers it is dropped', () => {
    const src = (set: string) => ({ sdSource: { set, source: 'Table 9, p. 9' } });
    const same = resolveNorm(q([mk([{ ...men, ...src('donor') }, { ...women, ...src('donor') }])]));
    expect(same.kind === 'norm' && same.flags.includes('sd-from-other-paper')).toBe(true);
    expect(same.kind === 'norm' && same.sd).toBeCloseTo(Math.sqrt(5), 10);
    const diff = resolveNorm(q([mk([{ ...men, ...src('donor') }, { ...women, ...src('other') }])]));
    expect(diff.kind === 'norm' && diff.flags.includes('sd-from-other-paper')).toBe(false);
    // Ruling T3-2: "it" is the SD — an SD mixed from two papers' borrowed SDs is no SD; the borrowed-SD path runs.
    if (diff.kind !== 'norm') throw new Error('no norm');
    expect([diff.mean, diff.sd]).toEqual([-5, null]);
    expect(diff.sourceLine).toMatch(/no matching SD to borrow/);
  });
  it('T3-2: only one row borrows its SD from another paper → the average has no SD of its own (borrowed-SD path)', () => {
    const r = resolveNorm(q([mk([{ ...men, sdSource: { set: 'donor', source: 'Table 9, p. 9' } }, women])]));
    if (r.kind !== 'norm') throw new Error('no norm');
    expect([r.mean, r.sd, r.flags.includes('sd-from-other-paper'), r.flags.includes('sexes-averaged')]).toEqual([-5, null, false, true]);
    expect(r.sourceLine).toMatch(/no matching SD to borrow/);
  });
  it('T3-1: a both-sexes row printed at the same band as the pair wins at equal distance (patient outside the band)', () => {
    const band: [number, number] = [15, 30];
    const r = resolveNorm(q([mk([{ ...men, ageBand: band }, { ...women, ageBand: band }, { sex: 'pooled', ageBand: band, mean: -4.5, sd: 2.1 }])], { ageYears: 45 }));
    expect(r.kind === 'norm' && [r.mean, r.sd, r.flags.includes('sexes-averaged'), r.flags.includes('age-mismatched')]).toEqual([-4.5, 2.1, false, true]);
  });
  it('T3-3: one sex has an extra age row with no partner — the pair at the age both sexes share is used, and the set is the one a man or a woman gets', () => {
    // Set A (larger sample): men 9; women 9 and 13. Set C: a pair at 11. Neither has an adult row, so with no age
    // entered rule 5 picks A for a man and a woman (AGE-UNK-1 cannot lift either set).
    const a = mk([{ ...men, ageBand: [9, 9] }, { ...women, ageBand: [9, 9] }, { ...women, ageBand: [13, 13], mean: -7 }], { id: 'synthetic-a', sample: { n: 200 } });
    const c = mk([{ ...men, ageBand: [11, 11] }, { ...women, ageBand: [11, 11] }], { id: 'synthetic-c', sample: { n: 100 } });
    const forSex = (sets: NormSet[], sex: 'M' | 'F' | null) => resolveNorm(q(sets, { sex, ageYears: null }));
    const [u, m, f] = [forSex([a, c], null), forSex([a, c], 'M'), forSex([a, c], 'F')];
    expect([m.kind === 'norm' && m.setId, f.kind === 'norm' && f.setId]).toEqual(['synthetic-a', 'synthetic-a']);
    if (u.kind !== 'norm') throw new Error('no norm');
    // Ruling T4-1 (Task 4 fix round 1): no age entered and no adult pair → 'age-unknown-oldest-row', not 'age-mismatched'.
    expect([u.setId, u.mean, u.entry.ageBand, u.flags.includes('sexes-averaged'), u.flags.includes('age-unknown-oldest-row'), u.flags.includes('age-mismatched')]).toEqual(['synthetic-a', -5, [9, 9], true, true, false]);
    // Owner AGE-UNK-1 (12 Oct): add a set with an adult pair (B) and, with no age entered, everyone gets B.
    const b = mk([men, women], { id: 'synthetic-b', sample: { n: 50 } });
    expect([null, 'M', 'F'].map((sex) => { const r = forSex([a, b, c], sex as 'M' | 'F' | null); return r.kind === 'norm' && r.setId; })).toEqual(['synthetic-b', 'synthetic-b', 'synthetic-b']);
  });
  it('M-4: men\'s and women\'s rows with different clinical targets or definition notes — both are kept, each named', () => {
    const r = resolveNorm(q([mk([
      { ...men, definitionMatch: 'close', definitionNote: 'SYNTHETIC men note', clinicalTarget: 'SYNTHETIC men target' },
      { ...women, definitionMatch: 'close', definitionNote: 'SYNTHETIC women note', clinicalTarget: 'SYNTHETIC women target' },
    ])]));
    if (r.kind !== 'norm') throw new Error('no norm');
    expect(r.entry.clinicalTarget).toBe("men's row: SYNTHETIC men target; women's row: SYNTHETIC women target");
    expect(r.sourceLine).toContain("men's row: SYNTHETIC men note; women's row: SYNTHETIC women note");
    const same = resolveNorm(q([mk([{ ...men, clinicalTarget: 'SYNTHETIC shared' }, { ...women, clinicalTarget: 'SYNTHETIC shared' }])]));
    expect(same.kind === 'norm' && same.entry.clinicalTarget).toBe('SYNTHETIC shared');
    const one = resolveNorm(q([mk([{ ...men, definitionMatch: 'close', definitionNote: 'SYNTHETIC men only' }, women])]));
    expect(one.kind === 'norm' && one.sourceLine).toContain("men's row: SYNTHETIC men only");
  });
});

describe('SEX-AVG-1 on the committed data', () => {
  const sets = loadSets();
  it('men ≠ women: a Swedish 16-year-old of unknown sex gets Thilander 2005\'s SNA rows averaged', () => {
    const th = sets.find((s) => s.id === 'thilander2005')!;
    const at16 = (sex: 'M' | 'F') => th.entries.find((e) => e.measurement === 'm01_SNA' && e.sex === sex && e.ageBand && e.ageBand[0] <= 16 && 16 <= e.ageBand[1])!;
    const [m, f] = [at16('M'), at16('F')];
    expect(m.mean).not.toBe(f.mean);                          // a real difference, so averaging is visible
    const r = resolveNorm({ measurement: 'm01_SNA', analysisId: 'steiner', population: 'swedish', clinicDefault: null, sex: null, ageYears: 16.5, sets, userNorms: [] });
    if (r.kind !== 'norm') throw new Error('no norm');
    expect(r.setId).toBe('thilander2005');
    expect(r.mean).toBeCloseTo((m.mean! + f.mean!) / 2, 10);
    expect(r.sd).toBeCloseTo(Math.sqrt((m.sd! ** 2 + f.sd! ** 2) / 2 + ((m.mean! - f.mean!) / 2) ** 2), 10);
    expect(r.flags).toContain('sexes-averaged');
  });
  it('T3-3 + AGE-UNK-1: Chinese interincisal, age and sex unknown → Fu 1975\'s adult pair, the paper a man or a woman gets', () => {
    // Owner AGE-UNK-1 (12 Oct) replaced the T3-3 result (Miao 1995's age-9 pair): adult rows rank first, and Fu 1975
    // (class-I balanced, n 144) ranks above Zheng 2026 (class-I balanced, n 120) by rule 5.
    const at = (sex: 'M' | 'F' | null) => resolveNorm({ measurement: 'm53_Interincisal', analysisId: 'steiner', population: 'chinese', clinicDefault: null, sex, ageYears: null, sets, userNorms: [] });
    const [u, m, f] = [at(null), at('M'), at('F')];
    expect([u.kind === 'norm' && u.setId, m.kind === 'norm' && m.setId, f.kind === 'norm' && f.setId]).toEqual(['moate2002-fu1975', 'moate2002-fu1975', 'moate2002-fu1975']);
    expect(u.kind === 'norm' && [u.mean, u.sd, u.entry.ageBand, u.flags.includes('sexes-averaged'), u.flags.includes('age-assumed-adult')]).toEqual([125, 8, [18, 40], true, true]);
  });
  it('P9: E-line lower lip, adult, sex not recorded → Ricketts 1981\'s adult men\'s row, as women get it, flagged "other sex\'s values"', () => {
    const rk = sets.find((s) => s.id === 'ricketts1981')!;
    const oldestMen = rk.entries.filter((e) => e.measurement === 'm72_LLE' && e.sex === 'M').sort((a, b) => b.ageBand![0] - a.ageBand![0])[0];
    const r = resolveNorm({ measurement: 'm72_LLE', analysisId: 'e-line', population: null, clinicDefault: null, sex: null, ageYears: 30, sets, userNorms: [] });
    if (r.kind !== 'norm') throw new Error('no norm');
    expect(r.setId).toBe('ricketts1981');
    expect(r.mean).toBe(oldestMen.mean);
    expect(r.flags).toEqual(expect.arrayContaining(['other-sex-values', 'age-mismatched']));
    expect(r.flags).not.toContain('sexes-averaged');
  });

});

describe('final review M-1: an averaged pair never mixes ages', () => {
  // Final review M-1 (ruled: not reachable; add a guard): averageSexes takes its age flags from the men's row, which is
  // sound only because both sexes pick among ages BOTH printed (pairedEntries). Case B2: no age, sex not recorded; the
  // only adult row is the women's. A woman gets it; an unknown sex must get the child pair (both sexes printed), flagged
  // as the oldest row standing in — never the men's child row averaged with the women's adult row unflagged.
  it('M-1: the women\'s-only adult row is never paired with the men\'s child row (age and sex unknown)', () => {
    const set = mk([{ sex: 'M', ageBand: [10, 12], mean: -1, sd: 2 }, { sex: 'F', ageBand: [10, 12], mean: -3, sd: 2 }, { sex: 'F', ageBand: [18, 40], mean: -4, sd: 2 }]);
    const r = resolveNorm(q([set], { ageYears: null }));
    if (r.kind !== 'norm') throw new Error(`no norm: ${r.kind}`);
    expect([r.mean, r.entry.ageBand, r.flags.includes('sexes-averaged'), r.flags.includes('age-unknown-oldest-row'), r.flags.includes('age-assumed-adult')])
      .toEqual([-2, [10, 12], true, true, false]);
    const woman = resolveNorm(q([set], { ageYears: null, sex: 'F' }));
    expect(woman.kind === 'norm' && [woman.mean, woman.flags.includes('age-assumed-adult')]).toEqual([-4, true]);
  });
});
