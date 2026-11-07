// Owner rulings, 7 Nov 2026 (in session), and the owner's answers the same day: an Indian patient uses the Caucasian
// norms (the app has no Indian study: a pure alias, `normsOf`); a Malay patient uses the Malay studies wherever they have
// the measurement, and the Chinese norms only where they do not (`fallsBackTo`). The reason: research reports no
// significant norm difference between these pairs. Held once, in populations.json, read through load.ts; every resolver
// follows it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadSets, POPULATIONS, normsPopulation, populationChain, ruleWords } from './load';
import { resolveNorm, resolveAcross, populationsOffered, donorHomePopulation, normChoices, type NormQuery } from './resolve';
import { autoPopulation, backgroundOptions } from './auto-population';
import { ALL_ANALYSES } from '../analyses';
import type { NormSet } from './types';

const sets = loadSets();
const q = (o: Partial<NormQuery> = {}): NormQuery => ({ measurement: 'm01_SNA', analysisId: 'steiner', population: null, clinicDefault: null,
  sex: 'M', ageYears: 30, sets, userNorms: [], ...o });
const numbers = (r: ReturnType<typeof resolveNorm>) => r.kind === 'norm' ? { setId: r.setId, mean: r.mean, sd: r.sd, flags: r.flags, sdDonor: r.sdDonor } : r.kind;
/** Everything but words and the asked-for population's own id (Auto's note names the population that had no norm). */
const same = (r: ReturnType<typeof resolveNorm>) => r.kind === 'norm'
  ? { setId: r.setId, mean: r.mean, sd: r.sd, range: r.range, flags: r.flags, ageRowUsed: r.ageRowUsed, sdDonor: r.sdDonor?.setId ?? null, step: r.auto?.step ?? null, n: r.auto?.n ?? null } : r.kind;
const ROWS = ALL_ANALYSES.flatMap((a) => a.measurements.map((m) => [a.id, m.node] as const));
const CELLS = (['M', 'F', null] as const).flatMap((sex) => [null, 12, 30].map((ageYears) => [sex, ageYears] as const));

/** The oracle for a Malay patient, independent of the rule's code: the Malay studies alone, filed for the test under an
 *  id no rule names, resolved as a population of their own. A direct hit (no Auto) is what the patient must get. */
const MALAY_ONLY = 'malay-studies-SYNTHETIC-ID';
const malayOnly: NormSet[] = sets.filter((s) => s.population.id === 'malay').map((s) => ({ ...s, population: { ...s.population, id: MALAY_ONLY } }));

describe('owner rulings 7 Nov 2026: Indian uses Caucasian norms; Malay uses the Malay studies, then the Chinese norms', () => {
  it('Indian is a choosable population, Malay exists, and the rule is held once, in populations.json', () => {
    expect(POPULATIONS.map((p) => p.id)).toContain('indian');
    expect(POPULATIONS.map((p) => p.id)).toContain('malay');
    expect([normsPopulation('indian'), normsPopulation('malay'), normsPopulation('chinese'), normsPopulation('user:Mine')]).toEqual(['caucasian', 'malay', 'chinese', 'user:Mine']);
    expect([populationChain('indian'), populationChain('malay'), populationChain('chinese')]).toEqual([['caucasian'], ['malay', 'chinese'], ['chinese']]);
    // Owner answer C, 7 Nov 2026: neutral words, never the recorded background.
    expect(ruleWords('indian', 'caucasian')).toBe('Norms: Caucasian (population rule)');
    expect(ruleWords('malay', 'chinese')).toBe('Norms: Chinese (population rule)');
    expect([ruleWords('malay', 'malay'), ruleWords('caucasian', 'caucasian')]).toEqual([null, null]);
    // No resolver names the two populations itself, in any quote style (review minor 3).
    for (const f of ['resolve.ts', 'auto-population.ts', 'combined.ts', 'sources.ts'])
      expect(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'), f).not.toMatch(/['"`](indian|malay)['"`]/);
  });
  it('the guard sees every quote style (positive control)', () => {
    for (const s of ["x === 'malay'", 'x === "indian"', 'x === `malay`']) expect(s).toMatch(/['"`](indian|malay)['"`]/);
  });
  it('Indian is offered (picker and background) although no set is filed under it', () => {
    expect(populationsOffered(sets, []).map((p) => p.id)).toContain('indian');
    expect(backgroundOptions(sets).map((p) => p.label)).toContain('Indian');
    expect(sets.some((s) => s.population.id === 'indian')).toBe(false);
  });
  it('every analysis row, sex and age: an Indian patient gets exactly the Caucasian numbers (Auto fall-backs too)', () => {
    const bad = ROWS.flatMap(([analysisId, measurement]) => CELLS.filter(([sex, ageYears]) =>
      JSON.stringify(same(resolveNorm(q({ analysisId, measurement, population: 'indian', sex, ageYears }))))
        !== JSON.stringify(same(resolveNorm(q({ analysisId, measurement, population: 'caucasian', sex, ageYears }))))).map((c) => `${analysisId} ${measurement} ${c}`));
    expect(ROWS.length * CELLS.length).toBe(ALL_ANALYSES.reduce((k, a) => k + a.measurements.length, 0) * 9);
    expect(bad).toEqual([]);
  });
  it('every analysis row, sex and age: a Malay patient gets the Malay studies wherever they answer, else exactly the Chinese result', () => {
    let fromMalay = 0, fromChinese = 0;
    const bad: string[] = [];
    for (const [analysisId, measurement] of ROWS) for (const [sex, ageYears] of CELLS) {
      const oracle = resolveNorm(q({ analysisId, measurement, population: MALAY_ONLY, sex, ageYears, sets: [...sets.filter((s) => s.population.id !== 'malay'), ...malayOnly] }));
      const got = resolveNorm(q({ analysisId, measurement, population: 'malay', sex, ageYears }));
      const direct = oracle.kind === 'norm' && !oracle.flags.includes('auto-fallback');
      const want = direct ? same(oracle) : same(resolveNorm(q({ analysisId, measurement, population: 'chinese', sex, ageYears })));
      if (direct) fromMalay++; else fromChinese++;
      if (JSON.stringify(same(got)) !== JSON.stringify(want)) bad.push(`${analysisId} ${measurement} ${sex} ${ageYears}`);
      if (direct && got.kind === 'norm') expect(sets.find((s) => s.id === got.setId)?.population.id).toBe('malay');
    }
    expect(bad).toEqual([]);
    expect(fromMalay).toBeGreaterThan(0);
    expect(fromChinese).toBeGreaterThan(0);
  });
  it('a row the Malay studies lack says the rule was used; a row they hold does not', () => {
    // Wits: no Malay study holds it, Chinese studies do.
    const viaChinese = resolveNorm(q({ measurement: 'm13_Wits', analysisId: 'wits', population: 'malay', sex: 'M', ageYears: 30 }));
    expect(viaChinese.kind === 'norm' && sets.find((s) => s.id === viaChinese.setId)?.population.id).toBe('chinese');
    const own = resolveNorm(q({ measurement: 'm01_SNA', population: 'malay' }));
    expect(own.kind === 'norm' && [sets.find((s) => s.id === own.setId)?.population.id, own.alias ?? null]).toEqual(['malay', null]);
    expect(viaChinese.kind === 'norm' && [viaChinese.alias, viaChinese.sourceLine.includes(ruleWords('malay', 'chinese')!)]).toEqual([ruleWords('malay', 'chinese'), true]);
  });
  it('owner answer C: an Indian patient\'s words never say "Indian"; a Malay row the rule fills never says "Malay"; Auto fall-back rows carry the rule words (review minor 2)', () => {
    let auto = 0;
    for (const [analysisId, measurement] of ROWS) for (const [sex, ageYears] of CELLS) {
      const r = resolveNorm(q({ analysisId, measurement, population: 'indian', sex, ageYears }));
      const words = r.kind === 'norm' ? `${r.sourceLine} ${r.auto?.populationWords ?? ''}` : r.reason;
      expect(words, `${analysisId} ${measurement}`).not.toMatch(/Indian/);
      if (r.kind === 'norm') expect(r.alias, `${analysisId} ${measurement}`).toBe('Norms: Caucasian (population rule)');
      if (r.kind === 'norm' && r.auto) { auto++; expect(r.sourceLine).toContain('Norms: Caucasian (population rule)'); }
      const m = resolveNorm(q({ analysisId, measurement, population: 'malay', sex, ageYears }));
      if (m.kind === 'norm' && m.alias) expect(m.sourceLine, `${analysisId} ${measurement}`).not.toMatch(/Malay/);
    }
    expect(auto).toBeGreaterThan(0);   // the Auto path was exercised
  });
  it('the clinic default follows the rule too', () => {
    expect(numbers(resolveNorm(q({ clinicDefault: 'indian' })))).toEqual(numbers(resolveNorm(q({ clinicDefault: 'caucasian' }))));
    expect(numbers(resolveNorm(q({ clinicDefault: 'malay' })))).toEqual(numbers(resolveNorm(q({ population: 'malay' }))));
  });
  it('the Compare window follows it; Indian is not a separate source in the choice list', () => {
    const [ind, cau] = resolveAcross(q(), ['indian', 'caucasian']);
    expect(numbers(ind)).toEqual(numbers(cau));
    const [my] = resolveAcross(q(), ['malay']);
    expect(my.kind === 'norm' && sets.find((s) => s.id === my.setId)?.population.id).toBe('malay');
    const ids = normChoices(q({ measurement: 'm01_SNA', population: 'japanese' })).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['chinese', 'caucasian', 'malay']));
    expect(ids).not.toContain('indian');
  });
  it('no duplicate in a row\'s source list (review minor 1): a source reached only through the rule is not listed again', () => {
    // A Japanese man's Wits: Malay has no Wits study, so "Malay" would only repeat Chinese.
    const ids = normChoices(q({ measurement: 'm13_Wits', analysisId: 'wits', population: 'japanese' })).map((c) => c.id);
    expect(ids).toContain('chinese');
    expect(ids).not.toContain('malay');
    // An Indian man's list never repeats Caucasian (the source his rows already use); a Malay man's Wits list never
    // repeats Chinese.
    expect(normChoices(q({ measurement: 'm13_Wits', analysisId: 'wits', population: 'indian' })).map((c) => c.id)).not.toContain('caucasian');
    expect(normChoices(q({ measurement: 'm13_Wits', analysisId: 'wits', population: 'malay' })).map((c) => c.id)).not.toContain('chinese');
    // Every list's ids are unique, and no two entries resolve to the same set, row and numbers.
    for (const population of ['indian', 'malay', 'chinese', 'japanese']) for (const [analysisId, measurement] of ROWS.slice(0, 60)) {
      const c = normChoices(q({ analysisId, measurement, population }));
      const keys = c.filter((x) => x.id !== 'auto').map((x) => JSON.stringify(same(x.resolved)));
      expect(new Set(keys).size, `${population} ${analysisId} ${measurement}`).toBe(keys.length);
    }
  });
  it('an SD is lent from the patient\'s own population first: Caucasian for Indian, Malay for Malay', () => {
    const own = sets.find((s) => s.id === 'ricketts1960')!;
    expect(donorHomePopulation(q({ population: 'indian' }), own)).toBe('caucasian');
    expect(donorHomePopulation(q({ population: 'malay' }), own)).toBe('malay');
  });
  it('Auto with an Indian or Malay background chooses that population; Indian is named by the norms it uses', () => {
    const a = autoPopulation({ background: 'indian', clinicDefault: null, sex: 'F', ageYears: 30, sets, userNorms: [] });
    expect(a).toMatchObject({ population: 'indian', how: 'background' });
    expect(a.label).toBe(sets.find((s) => s.population.id === 'caucasian' && s.kind === 'population')!.population.label);
    const m = autoPopulation({ background: 'malay', clinicDefault: null, sex: 'F', ageYears: 30, sets, userNorms: [] });
    expect(m.label).toBe(sets.find((s) => s.population.id === 'malay' && s.kind === 'population')!.population.label);
  });
  it('the Malay studies load', () => {
    expect(sets.filter((s) => s.population.id === 'malay').map((s) => s.id).sort()).toEqual(['cheong2024', 'mohammad2011', 'norman2020']);
  });
});
