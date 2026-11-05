// Owner decision 1 (29 Oct 2026), spec 2026-10-29 norms-auto-population §4.2: the Auto population rule, on the real
// sets. The step-3 answers are the probe of 29 Oct the spec's table reports; the owner reads that table.
import { describe, it, expect } from 'vitest';
import { loadSets, POPULATIONS } from './load';
import { AUTO_CASE_POPULATION, OTHER_BACKGROUND, autoPopulation, backgroundOptions, bestEvidenceSet, type AutoPopulationInput } from './auto-population';
import { COMBINED_ADULT, resolveNorm } from './resolve';

const sets = loadSets();
const i = (o: Partial<AutoPopulationInput> = {}): AutoPopulationInput =>
  ({ background: null, clinicDefault: null, sex: 'F', ageYears: 30, sets, userNorms: [], ...o });

describe('owner decision 1 (29 Oct 2026): the Auto population', () => {
  it('step 1: the recorded background', () => {
    expect(autoPopulation(i({ background: 'chinese', clinicDefault: 'caucasian' }))).toMatchObject({ population: 'chinese', how: 'background', label: 'Chinese' });
  });
  it('step 2: "Other or mixed", or nothing recorded → the clinic default', () => {
    expect(autoPopulation(i({ background: OTHER_BACKGROUND, clinicDefault: 'caucasian' }))).toMatchObject({ population: 'caucasian', how: 'clinic-default' });
    expect(autoPopulation(i({ clinicDefault: 'analysis-own' }))).toMatchObject({ population: 'analysis-own', how: 'clinic-default' });
  });
  it('a background naming a population with no usable set falls to step 2', () => {
    expect(autoPopulation(i({ background: 'no-such-population', clinicDefault: 'caucasian' }))).toMatchObject({ population: 'caucasian', how: 'clinic-default' });
  });
  it('a clinic default that names a deleted own-norm set is skipped', () => {
    expect(autoPopulation(i({ clinicDefault: 'user:Gone' }))).toMatchObject({ how: 'combined' });
    expect(autoPopulation(i({ clinicDefault: 'user:Gone', ageYears: 12 }))).toMatchObject({ how: 'best-evidence' });
  });
  // Owner rulings R1/R5 (3 Nov 2026; spec 2026-11-03): 18 and over, or the age not entered, is one adult group — the
  // combined adult norm. Under 18: the largest study for the sex and age, unchanged.
  it('step 3, adults (18 and over, or the age not entered): the combined adult norm', () => {
    const combined = { population: COMBINED_ADULT, how: 'combined', setId: null, ageCovered: true, label: 'combined adult' };
    expect(autoPopulation(i())).toEqual(combined);
    for (const ageYears of [18, 25, 45, 80, null]) for (const sex of ['M', 'F', null] as const) expect(autoPopulation(i({ ageYears, sex }))).toEqual(combined);
  });
  it('step 3, children (under 18): the largest study with a row for the sex and age, as before (spec 2026-10-29 §4.2)', () => {
    expect(autoPopulation(i({ ageYears: 17.99 }))).toEqual({ population: 'swedish', how: 'best-evidence', setId: 'thilander2005', ageCovered: true, label: 'Swedish' });
    expect(autoPopulation(i({ ageYears: 12, sex: 'M' }))).toMatchObject({ population: 'swedish', how: 'best-evidence', setId: 'thilander2005' });
    expect(autoPopulation(i({ ageYears: 8, sex: null }))).toMatchObject({ how: 'best-evidence', setId: 'thilander2005' });
    expect(bestEvidenceSet(sets, 'M', 8)?.set.id).toBe('thilander2005');
    expect(bestEvidenceSet(sets, 'F', 8)?.set.id).toBe('thilander2005');
    expect(bestEvidenceSet(sets, 'M', 12)?.set.id).toBe('thilander2005');
    expect(bestEvidenceSet(sets, null, 15)?.set.id).toBe('thilander2005');
    expect(bestEvidenceSet(sets, 'M', 30)?.set.id).toBe('thilander2005');
    expect(bestEvidenceSet(sets, null, null)?.set.id).toBe('thilander2005');
  });
  it('step 3, no study has a row for 45: the nearest age (Zheng 2026, adult row to 41 y)', () => {
    expect(bestEvidenceSet(sets, 'M', 45)).toMatchObject({ set: { id: 'zheng2026' }, ageCovered: false });
    expect(bestEvidenceSet(sets, 'F', 45)).toMatchObject({ set: { id: 'zheng2026' }, ageCovered: false });
  });
  // Final review C1 (2 Nov 2026), answered by owner rulings R1/R5 (3 Nov 2026): ages 33 to 40 no longer fall to Fu 1975
  // or Miao 1995 (second-hand compilations). These nine were `it.fails` until the ruling; they now state the new rule.
  for (const age of [33, 36, 40]) for (const sex of ['M', 'F', null] as const) {
    it(`C1 (ruled 3 Nov): ${sex ?? 'sex not recorded'}, ${age}: the combined adult norm, never Fu 1975 or Miao 1995`, () => {
      const c = autoPopulation(i({ sex, ageYears: age }));
      expect([c.population, c.how]).toEqual([COMBINED_ADULT, 'combined']);
      const r = resolveNorm({ measurement: 'm01_SNA', analysisId: 'steiner', population: c.population, clinicDefault: null, sex, ageYears: age, sets, userNorms: [] });
      expect(r.kind === 'norm' && r.flags.includes('combined-adult')).toBe(true);
      expect(r.kind === 'norm' && r.setId).toBe(COMBINED_ADULT);
    });
  }
  it('no sets: none', () => {
    expect(autoPopulation(i({ sets: [] }))).toEqual({ population: null, how: 'none', setId: null, ageCovered: false, label: null });
  });
  it('never a stored id that is also a population', () => {
    expect(POPULATIONS.map((p) => p.id)).not.toContain(AUTO_CASE_POPULATION);
    expect(POPULATIONS.map((p) => p.id)).not.toContain(OTHER_BACKGROUND);
  });
  it('the Background list: people populations with norms, short labels, no norm sources', () => {
    const ids = backgroundOptions(sets).map((o) => o.id);
    expect(ids).not.toContain('analysis-own');
    expect(ids).not.toContain('singapore-nus');
    expect(backgroundOptions(sets).find((o) => o.id === 'caucasian')?.label).toBe('Caucasian');
    expect(ids).toEqual(POPULATIONS.map((p) => p.id).filter((id) => ids.includes(id)));   // populations.json order
    console.log(`Background list: ${backgroundOptions(sets).map((o) => o.label).join(', ')}`);
  });
});
