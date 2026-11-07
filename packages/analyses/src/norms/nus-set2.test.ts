import { describe, it, expect } from 'vitest';
import { loadSets, loadSetsFrom } from './load';
import { normChoices, resolveNorm, type NormQuery } from './resolve';
import { validateSet } from './validate';
import { POPULATIONS } from './load';
import { byId } from '../catalogue';
import { ALL_ANALYSES } from '../analyses';

// Owner, 7 Nov 2026: the NUS sheet's two column sets. Set 1 (Chinese and Malay patients) is the existing `ndc-sheet`,
// whose numbers equal the owner's set 1; set 2 (Caucasian and Indian patients) is `nus-set2`. Owner rulings of 7 Nov
// 2026 (in session): switch set 2 on; the NUS analysis picks set 1 or set 2 by the patient's population; fill L1 to
// APo by pooling the adult Caucasian rows; borrow the four missing SDs from set 1; every row reads "Data on file (NUS
// norms)". Record: docs/norms/evidence/2026-11-07-nus-record.md.
const SET2: [string, number, number | null][] = [
  ['m01_SNA', 82.0, 3.0], ['m02_SNB', 79.0, 3.0], ['m03_ANB', 3.0, 1.0], ['m23_FHGoMe', 25.0, 5.0], ['m25_MMPA', 27.0, 5.0],
  ['m26_SNMxP', 8.0, 3.0], ['m13_Wits', 0.0, 3.9], ['m29_LAFHpct', 55.0, 2.1], ['m54_U1SN', 102, 2], ['m55_U1MxP', 108.0, 5.0],
  ['m57_IMPAgome', 92.0, 5.0], ['m53_Interincisal', 133.0, 10.0], ['m64_L1APog', 2.42, 1.68], ['m68_Overjet', 3.0, 1.7], ['m69_Overbite', 3.0, 1.8],
  ['m71_ULE', 0.0, null], ['m72_LLE', -2.0, null],
];
const SET1: [string, number, number][] = [
  ['m01_SNA', 83.4, 3.5], ['m02_SNB', 80.1, 3.7], ['m03_ANB', 3.4, 2.5], ['m23_FHGoMe', 25, 5], ['m25_MMPA', 26.2, 5.1], ['m26_SNMxP', 7.5, 3.5],
  ['m13_Wits', -4.7, 3.9], ['m29_LAFHpct', 53.9, 2.1], ['m54_U1SN', 110.8, 7.4], ['m55_U1MxP', 118, 6.4], ['m57_IMPAgome', 99.7, 7],
  ['m53_Interincisal', 116.2, 9.2], ['m64_L1APog', 5.1, 2.2], ['m68_Overjet', 3.5, 1.7], ['m69_Overbite', 3, 1.8], ['m71_ULE', 3.2, 2.3], ['m72_LLE', 3.7, 2.5],
];
const sets = loadSets();
const set1 = () => sets.find((s) => s.id === 'ndc-sheet')!;
const set2 = () => sets.find((s) => s.id === 'nus-set2')!;
const q = (o: Partial<NormQuery>): NormQuery => ({ measurement: 'm01_SNA', analysisId: 'nus', population: null, clinicDefault: null, sex: 'M', ageYears: 30, sets, userNorms: [], ...o });
/** The NUS analysis's own norm for a patient of this population (the "NUS's own norm" entry of the row's choice list). */
const nusOwn = (population: string | null, measurement = 'm01_SNA') => {
  const c = normChoices(q({ population, measurement })).find((x) => x.id === 'analysis-own');
  return c ? c.resolved : null;
};

describe('NUS norms (owner, 7 Nov 2026)', () => {
  it('set 1 is the existing sheet: its 17 means and SDs equal the owner\'s set 1 (no number changed)', () => {
    expect(set1().entries.map((e) => [e.measurement, e.mean, e.sd])).toEqual(SET1);
  });
  it('wording (ruling 5): every row of both sets reads "Data on file (NUS norms)"; set 1 no longer reads "NDC"', () => {
    for (const s of [set1(), set2()]) {
      expect(s.citation.authors).toBe('Data on file (NUS norms)');
      for (const e of s.entries) expect(e.source, `${s.id} ${e.measurement}`).toMatch(/^Data on file \(NUS norms\), set [12][, ]/);
    }
    expect(JSON.stringify({ c: set1().citation, s: set1().entries.map((e) => e.source) })).not.toMatch(/NDC/);   // a caveat may say NDC = NUS
    const r = resolveNorm(q({}));
    expect(r.kind === 'norm' && r.sourceLine.startsWith('Data on file (NUS norms, undated), ') && r.sourceLine.includes('Data on file (NUS norms), set 1,') && !/Chinese|Malay|Caucasian|Indian/.test(r.sourceLine)).toBe(true);
  });
  it('who each set is for (rulings 1-2): set 1 Chinese and Malay (and anyone else), set 2 Caucasian and Indian', () => {
    expect([set1().forPopulations, set1().forOtherPopulations]).toEqual([['chinese', 'malay'], true]);
    expect([set2().forPopulations, set2().forOtherPopulations ?? null]).toEqual([['caucasian', 'indian'], null]);
  });
  it('set 2 is switched on (single reading plus the owner\'s confirmation: not pending, flagged unverified)', () => {
    expect(set2().status).toBe('single-extracted');
    expect(set2().kind).toBe('analysis-own');
    expect(set2().analyses).toEqual(['nus']);
    expect(set2().entries.map((e) => [e.measurement, e.mean, e.sd ?? null])).toEqual(SET2);
  });
  it('the NUS own norm follows the patient\'s population: Caucasian and Indian get set 2; Chinese, Malay, none and any other get set 1', () => {
    for (const p of ['caucasian', 'indian']) expect(nusOwn(p)?.setId, p).toBe('nus-set2');
    for (const p of ['chinese', 'malay', 'japanese', 'singapore-nus']) expect(nusOwn(p)?.setId, String(p)).toBe('ndc-sheet');
    // No population at all: the analysis's own norm is the default (set 1, as before).
    const none = resolveNorm(q({}));
    expect(none.kind === 'norm' && [none.setId, none.mean]).toEqual(['ndc-sheet', 83.4]);
    // The clinic default counts as the patient's population.
    expect(normChoices(q({ population: null, clinicDefault: 'indian' })).find((x) => x.id === 'analysis-own')?.resolved.setId).toBe('nus-set2');
  });
  it('Auto step 2 uses the right set: a Caucasian or Indian man\'s LAFH % (no Caucasian study has it) is set 2\'s 55.0 ± 2.1', () => {
    for (const p of ['caucasian', 'indian']) {
      const r = resolveNorm(q({ population: p, measurement: 'm29_LAFHpct' }));
      expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.auto?.step], p).toEqual(['nus-set2', 55, 2.1, 'analysis-own']);
    }
  });
  it('the Singapore (NUS teaching) population, for any analysis, is still set 1 (unchanged)', () => {
    const r = resolveNorm(q({ analysisId: 'steiner', population: 'singapore-nus' }));
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd]).toEqual(['ndc-sheet', 83.4, 3.5]);
  });
  it('missing SDs (ruling 3): Wits, LAFH %, OJ and OB borrow set 1\'s SD, said as "SD borrowed from NUS Chinese"', () => {
    for (const m of ['m13_Wits', 'm29_LAFHpct', 'm68_Overjet', 'm69_Overbite']) {
      const e = set2().entries.find((x) => x.measurement === m)!;
      expect([e.sd, e.sdSource?.set], m).toEqual([set1().entries.find((x) => x.measurement === m)!.sd, 'ndc-sheet']);
      const r = nusOwn('caucasian', m)!;
      expect(r.sourceLine, m).toContain('SD borrowed from NUS Chinese');
      expect(r.colour, m).toBe(true);
    }
  });
  it('E-line SDs (ruling 3): borrowed by the existing lender rule — from Gu 2011 (Caucasian) for a Caucasian or Indian patient', () => {
    for (const p of ['caucasian', 'indian']) for (const m of ['m71_ULE', 'm72_LLE']) {
      const r = nusOwn(p, m)!;
      expect([r.setId, r.sdDonor?.setId, r.flags.includes('sd-borrowed')], `${p} ${m}`).toEqual(['nus-set2', 'gu2011-caucasian', true]);
    }
  });
  it('L1 to APo (ruling 3): the pooled adult Caucasian rows, 2.42 ± 1.68, N = 201, Bolton children excluded, marked filled', () => {
    const rows = sets.filter((s) => s.id === 'gu2011-caucasian' || s.id === 'mcnamara1984-annarbor')
      .flatMap((s) => s.entries.filter((e) => e.measurement === 'm64_L1APog'));
    expect(rows.map((e) => [e.sex, e.n, e.mean, e.sd])).toEqual([['F', 60, 2.2, 1.3], ['M', 30, 2.3, 1.7], ['F', 73, 2.7, 1.7], ['M', 38, 2.3, 2.1]]);
    const N = rows.reduce((a, e) => a + e.n!, 0);
    const mean = rows.reduce((a, e) => a + e.n! * e.mean!, 0) / N;
    const ss = rows.reduce((a, e) => a + (e.n! - 1) * e.sd! ** 2 + e.n! * (e.mean! - mean) ** 2, 0);
    const sd = Math.sqrt(ss / (N - 1));
    expect([N, +mean.toFixed(2), +sd.toFixed(2)]).toEqual([201, 2.42, 1.68]);
    const e = set2().entries.find((x) => x.measurement === 'm64_L1APog')!;
    expect([e.mean, e.sd, e.n, e.definitionMatch]).toEqual([2.42, 1.68, 201, 'close']);
    expect(e.source).toMatch(/FILLED/);
    expect(e.source).toMatch(/Bolton/);
    expect(set2().entries.filter((x) => /FILLED/.test(x.source)).map((x) => x.measurement)).toEqual(['m54_U1SN', 'm64_L1APog']);
  });
  it('signs (ruling 4): the app\'s own conventions match the owner\'s, so nothing is converted', () => {
    expect(byId('m13_Wits').sign).toMatch(/BO behind AO, a positive reading/);   // so Wits negative = BO ahead of AO
    expect(byId('m29_LAFHpct').nodes.m29_LAFHpct).toEqual({ kind: 'ratio', a: 'm28_LAFH', b: 'm29_NMe', percent: true });
    expect(byId('m29_LAFHpct').nodes.m29_NMe).toEqual({ kind: 'distance', a: 'N', b: 'Me' });
  });
  it('validation: forPopulations names known populations, only on an analysis\'s own norm; one fall-back set per analysis', () => {
    const bad = { ...set2(), forPopulations: ['martian'] };
    expect(validateSet(bad, { populations: POPULATIONS.map((p) => p.id) }).join('\n')).toMatch(/forPopulations/);
    const pop = { ...sets.find((s) => s.id === 'gu2011-caucasian')!, forPopulations: ['caucasian'] };
    expect(validateSet(pop, { populations: POPULATIONS.map((p) => p.id) }).join('\n')).toMatch(/forPopulations/);
    const twoDefaults = { ...set2(), forOtherPopulations: true };
    expect(() => loadSetsFrom({ 'a/ndc-sheet.json': set1(), 'a/nus-set2.json': twoDefaults })).toThrow(/more than one/);
  });
  it('BaSN (ruling 6): last in the NUS analysis (review I-1: no old wide-CSV column moves), and no set in the app holds a Ba-S-N norm, so it has none', () => {
    const nus = ALL_ANALYSES.find((a) => a.id === 'nus')!;
    const ids = nus.measurements.map((m) => m.node);
    expect(ids.indexOf('m93_BaSN')).toBe(ids.length - 1);
    expect(sets.filter((s) => s.entries.some((e) => e.measurement === 'm93_BaSN')).map((s) => s.id)).toEqual([]);
    for (const p of [null, 'chinese', 'malay', 'caucasian', 'indian']) expect(resolveNorm(q({ population: p, measurement: 'm93_BaSN' })).kind, String(p)).toBe('none');
  });
  it('U1 to SN (owner answer A, 7 Nov 2026): filled from the ABO norm already in the app, 102 ± 2°, and it fits set 2\'s own rows', () => {
    const abo = sets.find((x) => x.id === 'onfile-abo')!.entries.find((e) => e.measurement === 'm54_U1SN')!;
    const e = set2().entries.find((x) => x.measurement === 'm54_U1SN')!;
    expect([e.mean, e.sd, e.definitionMatch]).toEqual([abo.mean, abo.sd, abo.definitionMatch]);
    expect(e.source).toMatch(/FILLED from ABO/);
    // The check: set 2's U1 to MxPA minus SN to MxP is the U1 to SN its own geometry implies, 108 − 8 = 100°; within one
    // of the ABO norm's SDs of 102.
    const row = (m: string) => set2().entries.find((x) => x.measurement === m)!.mean!;
    expect(Math.abs(row('m55_U1MxP') - row('m26_SNMxP') - e.mean!)).toBeLessThanOrEqual(e.sd!);
    const r = nusOwn('caucasian', 'm54_U1SN')!;
    expect([r.setId, r.mean, r.sd, r.colour]).toEqual(['nus-set2', 102, 2, true]);
  });
});
