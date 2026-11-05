// Spec 2026-11-03 combined adult norm §6–§8 (owner rulings R1/R5, NAP-P1 (a), P2 (a), P3 (b), 3 Nov 2026): the
// resolver's answer for the combined adult norm, on the real sets.
import { describe, it, expect } from 'vitest';
import { loadSets } from './load';
import { adultPool, combineGroups } from './combined';
import { AUTO_CHOICE_ID, COMBINED_ADULT, normChoices, resolveNorm, type NormQuery, type Resolved } from './resolve';

const sets = loadSets();
const q = (o: Partial<NormQuery>): NormQuery => ({ measurement: 'm01_SNA', analysisId: 'steiner', population: COMBINED_ADULT, clinicDefault: null,
  sex: 'M', ageYears: 30, sets, userNorms: [], ...o });
const norm = (r: Resolved) => { if (r.kind !== 'norm') throw new Error(`not a norm: ${JSON.stringify(r)}`); return r; };

describe('the combined adult norm in the resolver', () => {
  it('men, SNA: 8 studies, 277 people, 83.1 ± 4.1, named as the combined norm (I1 (a): Zheng 2026 counts 30 men)', () => {
    const r = norm(resolveNorm(q({})));
    expect([r.setId, +r.mean!.toFixed(1), +r.sd!.toFixed(1), r.entry.n, r.entry.sex, r.ageRowUsed, r.colour]).toEqual([COMBINED_ADULT, 83.1, 4.1, 277, 'M', '18 y and over', true]);
    expect(r.flags).toContain('combined-adult');
    expect(r.flags).not.toContain('auto-fallback');
    expect(r.sourceLine).toMatch(/^Combined adult norm, men: 8 studies, 277 people \(/);
    expect(r.sourceLine).toContain('Thilander 2005');
    expect(r.sourceLine).toContain('quoted second-hand: Wei 1968 via Moate & Darendeliler 2002');
  });
  it('the same for every adult age and the age not entered (one adult group, R1)', () => {
    const at = (ageYears: number | null) => norm(resolveNorm(q({ ageYears }))).mean;
    expect(new Set([18, 25, 33, 36, 40, 45, 70, null].map(at)).size).toBe(1);
    const unknown = norm(resolveNorm(q({ ageYears: null })));
    expect(unknown.flags).toContain('age-assumed-adult');
    expect(norm(resolveNorm(q({ ageYears: null, filmDateMissing: true }))).flags).toContain('film-date-missing');
  });
  it('"close" rows enter and mark the norm close, saying how many (R2)', () => {
    const r = norm(resolveNorm(q({ measurement: 'm57_IMPAgome', sex: 'F' })));
    expect([+r.mean!.toFixed(1), +r.sd!.toFixed(1), r.entry.n]).toEqual([95.4, 7.1, 269]);
    expect(r.flags).toContain('close');
    expect(r.sourceLine).toContain('4 of 4 studies measured it a little differently');
  });
  it('millimetres: each study at true size before combining (film enlargement removed)', () => {
    const pool = adultPool(sets, 'm10_CoA', 'M');
    expect(pool.some((p) => p.set.scale.kind === 'enlarged')).toBe(true);
    const at = (p: (typeof pool)[number], x: number) => (p.set.scale.kind === 'enlarged' ? x / (1 + p.set.scale.percent / 100) : x);
    const expected = combineGroups(pool.map((p) => ({ n: p.n, mean: at(p, p.entry.mean!), sd: at(p, p.entry.sd!) })));
    const r = norm(resolveNorm(q({ measurement: 'm10_CoA', analysisId: 'mcnamara' })));
    expect(r.mean).toBeCloseTo(expected.mean, 10);
    expect(r.sd).toBeCloseTo(expected.sd, 10);
    expect(r.flags).toContain('converted-to-true-size');
  });
  it('sex not recorded: the men\'s and the women\'s combined norms averaged (SEX-AVG-1)', () => {
    const m = norm(resolveNorm(q({ sex: 'M' }))), f = norm(resolveNorm(q({ sex: 'F' }))), u = norm(resolveNorm(q({ sex: null })));
    expect(u.mean).toBeCloseTo((m.mean! + f.mean!) / 2, 12);
    expect(u.sd).toBeCloseTo(Math.sqrt((m.sd! ** 2 + f.sd! ** 2) / 2 + ((m.mean! - f.mean!) / 2) ** 2), 12);
    expect(u.flags).toEqual(expect.arrayContaining(['combined-adult', 'sexes-averaged']));
    expect(u.entry.sex).toBe('pooled');
    expect(u.sourceLine).toContain('average of male and female (sex not recorded)');
  });
  it('fewer than 2 studies: that one study, marked ◆ ("single study", NAP-P3 (b))', () => {
    expect(adultPool(sets, 'm26_SNMxP', 'F').map((p) => p.set.id)).toEqual(['thilander2005']);
    const r = norm(resolveNorm(q({ measurement: 'm26_SNMxP', sex: 'F' })));
    expect(r.setId).toBe('thilander2005');
    expect(r.ageRowUsed).toBe('29–32 y');
    expect(r.flags).toContain('single-study');
    expect(r.auto).toMatchObject({ population: COMBINED_ADULT, step: 'single-study', usedPopulation: 'Swedish', n: 19 });
    expect(r.sourceLine).toContain('single study: fewer than 2 adult studies have this');
    // Sex not recorded, one study each side: the average, still marked.
    const u = norm(resolveNorm(q({ measurement: 'm26_SNMxP', sex: null })));
    expect(u.flags).toEqual(expect.arrayContaining(['single-study', 'sexes-averaged']));
    expect(u.auto?.step).toBe('single-study');
  });
  it('a single-study row is Auto\'s answer like any ◆ row: the "Auto" choice is that study, and a source you pick wins', () => {
    const base = q({ measurement: 'm26_SNMxP', sex: 'F', analysisId: 'bjork-jarabak' });
    const choices = normChoices(base);
    expect(choices[0].id).toBe(AUTO_CHOICE_ID);
    expect(choices[0].resolved.setId).toBe('thilander2005');
    expect(choices[0].resolved.flags).toContain('single-study');
    const other = choices.find((c) => c.id !== AUTO_CHOICE_ID && c.resolved.setId !== 'thilander2005');
    expect(other).toBeDefined();
    const picked = norm(resolveNorm({ ...base, picks: { [COMBINED_ADULT]: { m26_SNMxP: other!.id } } }));
    expect(picked.flags).toContain('chosen-by-you');
    expect(picked.setId).toBe(other!.resolved.setId);
  });
  it('two studies of any size combine (NAP-P3 (b)): men\'s IMPA (tangent), 20 people', () => {
    const r = norm(resolveNorm(q({ measurement: 'm56_IMPAt', analysisId: 'tweed' })));
    expect([r.setId, r.entry.n, +r.mean!.toFixed(1), +r.sd!.toFixed(1)]).toEqual([COMBINED_ADULT, 20, 96.5, 9.3]);
    expect(r.flags).not.toContain('single-study');
  });
  it('no adult study: today\'s Auto fall-back, saying there is no combined adult norm (Pog–NB: its only adult rows are both-sexes mm)', () => {
    expect(adultPool(sets, 'm18_PogNB', 'M')).toEqual([]);
    const r = norm(resolveNorm(q({ measurement: 'm18_PogNB' })));
    expect(r.flags).toContain('auto-fallback');
    expect(r.auto?.populationWords).toBe('combined adult');
  });
  it('edge: sex not recorded where only one sex has an adult study (Cheong 2024, women only) — no combined norm, Auto\'s fall-back', () => {
    const only = sets.filter((s) => s.id === 'cheong2024' || s.kind === 'analysis-own');
    expect(adultPool(only, 'm80_HAngle', 'F').length).toBe(1);
    expect(adultPool(only, 'm80_HAngle', 'M')).toEqual([]);
    const women = norm(resolveNorm(q({ sets: only, measurement: 'm80_HAngle', analysisId: 'holdaway', sex: 'F' })));
    expect([women.setId, women.flags.includes('single-study')]).toEqual(['cheong2024', true]);
    const unknown = resolveNorm(q({ sets: only, measurement: 'm80_HAngle', analysisId: 'holdaway', sex: null }));
    expect(unknown.kind === 'norm' && unknown.setId).not.toBe('cheong2024');
    expect(unknown.kind === 'norm' && unknown.flags).toContain('auto-fallback');
  });
  it('final review M1: the source line says how many studies give men and women together', () => {
    const r = norm(resolveNorm(q({ measurement: 'm22_FHMPt', analysisId: 'downs' })));
    expect(r.sourceLine).toContain('2 of 2 studies give men and women together');
    expect(norm(resolveNorm(q({ measurement: 'm25_MMPA', analysisId: 'eastman' }))).sourceLine).not.toContain('men and women together');
  });
  it('final review M2: sex not recorded, single study — the row can be chosen like any ◆ row', () => {
    const u = norm(resolveNorm(q({ measurement: 'm26_SNMxP', sex: null })));
    expect(u.flags).toEqual(expect.arrayContaining(['single-study', 'auto-fallback']));
  });
  it("final review M3: a single study's both-sexes row says the row's own people in the Auto note", () => {
    expect(adultPool(sets, 'm14_APDI', 'M').map((p) => [p.set.id, p.bothSexes])).toEqual([['caballero2019', true]]);
    const r = norm(resolveNorm(q({ measurement: 'm14_APDI', analysisId: 'kim' })));
    expect([r.setId, r.auto?.n]).toEqual(['caballero2019', 50]);
  });
  it('a hand-chosen population is untouched by any of this', () => {
    const r = norm(resolveNorm(q({ population: 'swedish' })));
    expect([r.setId, r.mean]).toEqual(['thilander2005', 82.2]);
  });
});
