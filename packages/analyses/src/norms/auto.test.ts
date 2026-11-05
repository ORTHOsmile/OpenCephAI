import { describe, it, expect } from 'vitest';
import { loadSets, POPULATIONS } from './load';
import { validateSet } from './validate';
import { AUTO_CHOICE_ID, bestCaucasian, bestStudy, normChoices, otherPopulations, pickPopulation, resolveAcross, resolveNorm, type NormQuery } from './resolve';
import { ALL_ANALYSES } from '../analyses';
import type { NormEntry, NormSet } from './types';

// Owner N-A1/N-A4 (19 Oct 2026): Auto's Caucasian step ranks the Caucasian sets FOR THIS MEASUREMENT: a row for the
// patient's sex and age first, then the most people, ties to the newer study. Known answers worked by hand from
// reference/norms/sets/caucasian/*.json (plan 2026-10-19-norms-auto, "The three hand-worked answers").
const sets = loadSets();
const q = (measurement: string, sex: 'M' | 'F' | null, ageYears: number | null, over: Partial<NormQuery> = {}): NormQuery =>
  ({ measurement, analysisId: 'mcnamara', population: 'japanese', clinicDefault: null, sex, ageYears, sets, userNorms: [], ...over });
const best = (qq: NormQuery) => bestCaucasian(qq)?.id ?? null;

describe('bestCaucasian on the four real Caucasian sets', () => {
  it('1. SNA, woman of 30: Ann Arbor (women 18–40 y, n 73) over Gu 2011 (women 18–40 y, n 60) — more people beats the newer paper', () => {
    expect(best(q('m01_SNA', 'F', 30))).toBe('mcnamara1984-annarbor');
  });
  it('2. Co–Gn, girl of 12: Burlington (girls 12 y, n 56) over Bolton (girls 12 y, n 16); the adult sets have no row for 12', () => {
    expect(best(q('m11_CoGn', 'F', 12))).toBe('mcnamara1984-burlington');
  });
  it('3. Co–Gn, man of 20: Ann Arbor (n 38) and Burlington (20 y, n 38) tie on n and year (1984); the usual order (class-I balanced first) decides (AUTO-Q3)', () => {
    expect(best(q('m11_CoGn', 'M', 20))).toBe('mcnamara1984-annarbor');
  });
  it('Q1: sex and age not entered, Co–Gn: Ann Arbor — its adult men\'s and women\'s rows averaged, n 38 + 73 = 111 (Gu 90, Burlington 39, Bolton 32)', () => {
    expect(best(q('m11_CoGn', null, null))).toBe('mcnamara1984-annarbor');
  });
  it('Q2: girl of 13, Co–Gn: no set has a row for 13, so the nearest age first (Bolton and Burlington, 14 y), then n: Burlington (48) — not Ann Arbor\'s adults (73)', () => {
    expect(best(q('m11_CoGn', 'F', 13))).toBe('mcnamara1984-burlington');
  });
  it('SNB, man of 30: Gu 2011, the only Caucasian set with SNB', () => {
    expect(best(q('m02_SNB', 'M', 30))).toBe('gu2011-caucasian');
  });
  it('a measurement no Caucasian set has (SN–MxP): null', () => {
    expect(best(q('m26_SNMxP', 'M', 30))).toBeNull();
  });
  it('the order the sets arrive in does not matter', () => {
    const rev = [...sets].reverse();
    expect([best(q('m01_SNA', 'F', 30, { sets: rev })), best(q('m11_CoGn', 'F', 12, { sets: rev })), best(q('m11_CoGn', 'M', 20, { sets: rev }))])
      .toEqual(['mcnamara1984-annarbor', 'mcnamara1984-burlington', 'mcnamara1984-annarbor']);
  });
  it('contrast (documents N-A4): a case SET TO Caucasian keeps the usual order — the girl of 12 gets Bolton (class-I balanced first)', () => {
    const r = resolveNorm(q('m11_CoGn', 'F', 12, { population: 'caucasian' }));
    expect(r.kind === 'norm' && r.setId).toBe('mcnamara1984-bolton');
  });
});

// Owner AUTO-Q6 (19 Oct 2026): step 4, best evidence anywhere — the same ranking over every other population.
describe('bestStudy, step 4, a man of 30 with Saudi chosen (Saudi and Caucasian excluded)', () => {
  const step4 = (measurement: string) => bestStudy(q(measurement, 'M', 30, { population: 'saudi' }), otherPopulations(q(measurement, 'M', 30), ['saudi', 'caucasian']))?.id ?? null;
  it('4. Pog to NB: Zheng 2026 (Chinese, 18–41 y, n 60) over Kim 2025 (African-American, 18–40 y, n 34); Mohammad 2011 (Malay, 20–24 y) has no row for 30', () => {
    expect(step4('m18_PogNB')).toBe('zheng2026');
  });
  it('5. LAFH %: Norman 2020 (Malay men, 15–30 y, n 50) over Thilander 2005 (Swedish men, 29–32 y, n 11)', () => {
    expect(step4('m29_LAFHpct')).toBe('norman2020');
  });
  it('6. upper lip strain: Lew 1992 (Chinese via Moate 2002, 18–40 y, n 48) — Alcalde 2000 (Japanese, n 211) has no row for 30 (20–28 y): age first (AUTO-Q2)', () => {
    expect(step4('m79_ULStrain')).toBe('moate2002-lew1992');
  });
  it('otherPopulations: people populations only — never the analyses\' own norms, never a user set — minus the excluded ones', () => {
    const ids = otherPopulations(q('m01_SNA', 'M', 30, { userNorms: [{ setName: 'SYNTHETIC Mine', measurement: 'm01_SNA', mean: 80, sd: 2, sourceNote: 'SYNTHETIC' }] }), ['saudi', 'caucasian']);
    expect([ids.includes('analysis-own'), ids.some((i) => i.startsWith('user:')), ids.includes('saudi'), ids.includes('caucasian'), ids.includes('chinese')]).toEqual([false, false, false, false, true]);
  });
});

// SYNTHETIC Caucasian sets for the rules the real four cannot show.
const POP_IDS = POPULATIONS.map((p) => p.id);
function mk(id: string, year: number, extra: Partial<NormSet>, entries: Partial<NormEntry>[]): NormSet {
  const set = {
    id, kind: 'population', status: 'verified', citation: { authors: 'Synthetic A', title: 'SYNTHETIC', year, openAccess: true },
    population: { id: 'caucasian', label: 'Caucasian', ethnicity: ['European'] }, sample: { n: 40 }, selection: 'class-I',
    modality: 'digital', scale: { kind: 'true-size', source: 'SYNTHETIC' }, headPosition: 'FH',
    curation: { extractedBy: ['a', 'b'], comparedOn: '2026-10-19', date: '2026-10-19' }, caveats: [], ...extra,
    entries: entries.map((e) => ({ measurement: 'm13_Wits', sex: 'pooled', mean: -1, sd: 2, unit: 'mm', source: 'Table 1', definitionMatch: 'same', ...e })),
  } as NormSet;
  const problems = validateSet(set, { populations: POP_IDS });
  if (problems.length) throw new Error(`synthetic fixture invalid: ${problems.join('; ')}`);
  return set;
}
const sq = (s: NormSet[]) => q('m13_Wits', 'M', 30, { sets: s });

describe('bestCaucasian: the tie-breaks (SYNTHETIC)', () => {
  it('equal n: the newer paper', () => {
    expect(best(sq([mk('old-SYNTHETIC', 2010, {}, [{}]), mk('new-SYNTHETIC', 2020, {}, [{}])]))).toBe('new-SYNTHETIC');
  });
  it('Q1: a row stating no n ranks after one that states it, however old', () => {
    const noN = mk('non-SYNTHETIC', 2024, { sample: {} }, [{}]);
    expect(best(sq([noN, mk('withn-SYNTHETIC', 1990, { sample: { n: 12 } }, [{}])]))).toBe('withn-SYNTHETIC');
  });
  it('Q12: two populations tied on age, n and year → the populations.json order (Chinese before Malay)', () => {
    const cn = mk('cn-SYNTHETIC', 2020, { population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] } }, [{}]);
    const my = mk('my-SYNTHETIC', 2020, { population: { id: 'malay', label: 'Malay', ethnicity: ['Malay'] } }, [{}]);
    expect(bestStudy(sq([my, cn]), ['malay', 'chinese'])?.id).toBe('cn-SYNTHETIC');
  });
  it('Q4: a website value ranks after a paper, whatever its n', () => {
    const web = mk('web-SYNTHETIC', 2024, { status: 'website', sample: { n: 500 }, citation: { authors: 'Some Site', title: 'SYNTHETIC', year: 2024, openAccess: true, url: 'https://example.invalid' } }, [{}]);
    expect(best(sq([web, mk('paper-SYNTHETIC', 2000, { sample: { n: 20 } }, [{}])]))).toBe('paper-SYNTHETIC');
  });
  // Review I-3 (24 Oct 2026): two sets tied on everything the usual order (orderSets/rankSets) decides
  // resolved, before this fix, by the order of the input list — "aaa" copies of Gu 2011 won when listed first,
  // "zzz" won when listed first. The owner did not need to rule on this (M-3/I-3 is a plain fix, not a ranking
  // choice): add the set id as the final key so two fully tied sets always resolve the same way.
  it('I-3: two sets tied on everything (two SYNTHETIC copies of the same study) resolve by set id, not input order', () => {
    const aaa = mk('aaa-SYNTHETIC', 2020, {}, [{}]);
    const zzz = mk('zzz-SYNTHETIC', 2020, {}, [{}]);
    expect(bestCaucasian(sq([aaa, zzz]))?.id).toBe('aaa-SYNTHETIC');
    expect(bestCaucasian(sq([zzz, aaa]))?.id).toBe('aaa-SYNTHETIC');
  });
});

// Ruling AUTO-Q7 (19 Oct 2026): the Compare window shows each population's OWN norm or nothing — never a pick, never
// Auto, never "choose one". Whole catalogue, real sets: a column equals what a case set to that population shows when
// that is the population's own norm, and is 'none' otherwise.
describe('AUTO-Q7: Compare columns are the population\'s own norm or none', () => {
  it('every analysis row × population × (man 30; sex and age not entered), with a pick stored everywhere', () => {
    let own = 0, none = 0;
    const pops = POPULATIONS.map((p) => p.id);
    for (const a of ALL_ANALYSES) for (const m of a.measurements) for (const [sex, age] of [['M', 30], [null, null]] as const) {
      const base: NormQuery = { measurement: m.node, analysisId: a.id, population: null, clinicDefault: null, sex, ageYears: age, sets, userNorms: [],
        picks: Object.fromEntries(pops.map((p) => [p, { [m.node]: p === 'swedish' ? 'chinese' : 'swedish' }])) };
      const cols = resolveAcross(base, pops);
      pops.forEach((p, i) => {
        const inspector = resolveNorm({ ...base, population: p, picks: undefined });
        const isOwn = inspector.kind === 'norm' && !inspector.flags.includes('chosen-by-you') && !inspector.flags.includes('auto-fallback');
        if (isOwn) { expect(cols[i]).toEqual(inspector); own++; }
        else { expect(cols[i].kind).toBe('none'); none++; }
      });
    }
    // Rows counted against the source: 130 rows × 11 populations × 2 patients = 2,860; both kinds must occur.
    expect([own + none, own > 0, none > 0]).toEqual([2860, true, true]);
  });
});

// Owner N-A3 + AUTO-Q6 (19 Oct 2026): a chosen population with no norm and no usable pick → Auto: the analysis's own
// norm, else bestCaucasian, else the best study of any other population; flagged 'auto-fallback'; the source line names
// the population that had none. Real committed sets.
const hit = (qq: NormQuery) => {
  const r = resolveNorm(qq);
  if (r.kind !== 'norm') throw new Error(`expected a norm, got ${r.kind}`);
  return r;
};
describe('Auto in the resolver (real sets)', () => {
  it("step 2: Steiner's SNA, Japanese man of 30 (no Japanese SNA) → Steiner's own norm, 82°, flagged and named", () => {
    const r = hit(q('m01_SNA', 'M', 30, { analysisId: 'steiner' }));
    expect([r.setId, r.mean, r.flags.includes('auto-fallback'), r.auto?.step, r.auto?.usedPopulation, r.auto?.source, r.auto?.population]).toEqual(['steiner1953', 82, true, 'analysis-own', null, "Steiner's own norm", 'japanese']);
    expect(r.sourceLine.endsWith(' · Auto (no Japanese norm)')).toBe(true);
  });
  it("step 3: McNamara's upper pharynx, Chinese man of 30 (no Chinese paper, no McNamara own norm) → Ann Arbor men, 17.4 ± 4.3 mm printed, n 38", () => {
    const r = hit(q('m84_UpperPharynx', 'M', 30, { population: 'chinese' }));
    expect([r.setId, r.printed?.mean, r.printed?.sd, r.auto?.step, r.auto?.usedPopulation, r.auto?.source, r.auto?.n]).toEqual(['mcnamara1984-annarbor', 17.4, 4.3, 'caucasian', 'Caucasian', 'McNamara 1984 Ann Arbor', 38]);
    expect(r.mean).toBeCloseTo(17.4 / 1.08, 10);
    expect(r.sourceLine.endsWith(' · Auto (no Chinese norm)')).toBe(true);
  });
  it('step 3, sex and age not entered: the adult rows averaged (SEX-AVG-1, AGE-UNK-1), n 111, each flag kept', () => {
    const r = hit(q('m84_UpperPharynx', null, null, { population: 'chinese' }));
    expect([r.setId, r.auto?.n, ['sexes-averaged', 'age-assumed-adult', 'auto-fallback'].every((f) => r.flags.includes(f as never))]).toEqual(['mcnamara1984-annarbor', 111, true]);
  });
  it('film date missing: its own words on an Auto row too', () => {
    expect(hit(q('m84_UpperPharynx', 'M', null, { population: 'chinese', filmDateMissing: true })).flags).toContain('film-date-missing');
  });
  it('the analyses\' own norms chosen as the population, with nothing: step 2 is the same source, so straight to Caucasian', () => {
    const r = hit(q('m84_UpperPharynx', 'M', 30, { population: 'analysis-own' }));
    expect([r.setId, r.auto?.step]).toEqual(['mcnamara1984-annarbor', 'caucasian']);
    expect(r.sourceLine.endsWith(" · Auto (no McNamara's own norm)")).toBe(true);
  });
  it("Caucasian chosen, with nothing: step 3 is the same population, so step 2 only (Björk–Jarabak's sum of angles → Jarabak's own norm)", () => {
    const r = hit(q('m39_SumAngles', 'M', 30, { analysisId: 'bjork-jarabak', population: 'caucasian' }));
    expect([r.setId, r.mean, r.auto?.step]).toEqual(['jarabak-via-alshahrani2018', 396, 'analysis-own']);
  });
  it('step 4 (owner AUTO-Q6): neither the analysis nor any Caucasian paper has Pog to NB (Steiner, Saudi man of 30) → Zheng 2026 (Chinese, n 60)', () => {
    const qq = q('m18_PogNB', 'M', 30, { analysisId: 'steiner', population: 'saudi' });
    const r = hit(qq);
    expect([r.setId, r.auto?.step, r.auto?.usedPopulation, r.auto?.source, r.auto?.n]).toEqual(['zheng2026', 'anywhere', 'Chinese', 'Zheng 2026 Beijing', 60]);
    expect(r.sourceLine.endsWith(' · Auto (no Saudi norm)')).toBe(true);
    expect(normChoices(qq)[0].label).toBe('Auto · Chinese — Zheng 2026 Beijing, n = 60 (no Saudi norm)');
  });
  it('Caucasian chosen, nothing there and no own norm: step 4 leaves Caucasian out (Holdaway upper lip strain → Lew 1992, Chinese)', () => {
    const r = hit(q('m79_ULStrain', 'M', 30, { analysisId: 'holdaway', population: 'caucasian' }));
    expect([r.setId, r.auto?.step]).toEqual(['moate2002-lew1992', 'anywhere']);
  });
  it('no population chosen: unchanged — the analysis\'s own norm, never flagged Auto', () => {
    const r = hit(q('m01_SNA', 'M', 30, { analysisId: 'steiner', population: null }));
    expect([r.setId, r.flags.includes('auto-fallback'), 'auto' in r]).toEqual(['steiner1953', false, false]);
  });
  it('a stored pick still wins; a stale one, or a stored "auto", falls to Auto', () => {
    const base = q('m01_SNA', 'M', 30, { analysisId: 'steiner' });
    const picked = hit({ ...base, picks: { japanese: { m01_SNA: 'chinese' } } });
    expect([picked.flags.includes('chosen-by-you'), picked.flags.includes('auto-fallback')]).toEqual([true, false]);
    expect(hit({ ...base, picks: { japanese: { m01_SNA: 'user:Gone' } } }).auto?.step).toBe('analysis-own');
    expect(hit({ ...base, picks: { japanese: { m01_SNA: AUTO_CHOICE_ID } } }).auto?.step).toBe('analysis-own');
  });
  it('the choice list: Auto first, named, with the row\'s facts; then the other sources as before', () => {
    const c = normChoices(q('m84_UpperPharynx', 'F', 30, { population: 'chinese' }));
    expect([c[0].id, c[0].label, c[0].rows, c[0].ages]).toEqual([AUTO_CHOICE_ID, 'Auto · Caucasian — McNamara 1984 Ann Arbor, n = 73 (no Chinese norm)', [{ who: 'women', n: 73 }], '18–40 y']);
    expect(c.slice(1).map((x) => x.id)).toContain('caucasian');
    expect(normChoices(q('m01_SNA', 'M', 30, { analysisId: 'steiner' }))[0].label).toBe("Auto · Steiner's own norm (no Japanese norm)");
  });
  it('AUTO-Q7: Auto never reaches the Compare window — the Japanese column stays none', () => {
    const [cn, jp] = resolveAcross(q('m01_SNA', 'M', 30, { analysisId: 'steiner' }), ['chinese', 'japanese']);
    expect([cn.kind === 'norm' && cn.flags.includes('auto-fallback'), jp.kind]).toEqual([false, 'none']);
  });
  it('the methodology note\'s numbers: a man of 30, every analysis row × population choice (1,430): 816 own norm, 19 Caucasian, 47 step 4, none asks', () => {
    const tally = { own: 0, caucasian: 0, anywhere: 0, choose: 0, total: 0 };
    for (const a of ALL_ANALYSES) for (const m of a.measurements) for (const p of POPULATIONS.map((x) => x.id)) {
      const r = resolveNorm({ measurement: m.node, analysisId: a.id, population: p, clinicDefault: null, sex: 'M', ageYears: 30, sets, userNorms: [] });
      tally.total++;
      if (r.kind === 'choose') tally.choose++;
      else if (r.kind === 'norm' && r.auto) tally[r.auto.step === 'analysis-own' ? 'own' : r.auto.step]++;
    }
    expect(tally).toEqual({ own: 816, caucasian: 19, anywhere: 47, choose: 0, total: 1430 });   // docs/norms/SEVERITY.md quotes these
  });
});

// Owner ruling, 24 Oct 2026 fix round 1, Q-T5-1 (review M-4): a teaching sheet with no sample (kind 'analysis-own',
// filed under a population id so it can serve as that population's norm in step 1 — e.g. the real NUS/NDC sheet,
// `singapore-nus/ndc-sheet.json`) must never be "the best study anywhere" in step 3/4. It stays reachable as its
// analysis's own norm (step 2) and as a manual choice (normChoices still lists it); only bestStudy's ranking excludes it.
describe('Q-T5-1: step 4 never picks a teaching sheet filed under a population (owner ruling, 24 Oct 2026, fix round 1)', () => {
  const TEACHING = mk('teaching-SYNTHETIC', 2026, {
    kind: 'analysis-own', analyses: ['steiner'], population: { id: 'malay', label: 'Malay', ethnicity: ['Malay'] }, sample: {},
  }, [{}]);   // m13_Wits, pooled, mean -1, sd 2 (mk's defaults)
  const teachQ = (sets: NormSet[]): NormQuery => q('m13_Wits', 'M', 30, { population: 'saudi', sets });
  it('without the fix this sheet would win step 4 (the scenario, proven directly on bestStudy)', () => {
    // Saudi and Caucasian excluded, as autoFallback does; Malay's only set is the teaching sheet.
    expect(bestStudy(teachQ([TEACHING]), otherPopulations(teachQ([TEACHING]), ['saudi', 'caucasian']))).toBeNull();
  });
  it('resolveNorm: with only the teaching sheet reachable, the row asks ("choose one"), never Auto on the sheet', () => {
    const r = resolveNorm(teachQ([TEACHING]));
    expect(r).toEqual({ kind: 'choose', population: 'saudi', reason: 'no Saudi norm — choose one' });
  });
  it('the sheet is still a manual choice, and still the owning analysis\'s own norm (step 2, unaffected)', () => {
    expect(normChoices(teachQ([TEACHING])).map((c) => c.id)).toContain('malay');
    const r = resolveNorm(q('m13_Wits', 'M', 30, { analysisId: 'steiner', population: 'saudi', sets: [TEACHING] }));
    expect(r.kind === 'norm' && [r.setId, r.auto?.step]).toEqual(['teaching-SYNTHETIC', 'analysis-own']);
  });
  it('a real sample still beats the teaching sheet when both are candidates (unaffected, n 40 > nothing stated)', () => {
    const real = mk('real-SYNTHETIC', 2020, { population: { id: 'malay', label: 'Malay', ethnicity: ['Malay'] } }, [{}]);
    expect(bestStudy(teachQ([TEACHING, real]), otherPopulations(teachQ([TEACHING, real]), ['saudi', 'caucasian']))?.id).toBe('real-SYNTHETIC');
  });
});

describe('owner decision 6 (29 Oct 2026): no population at all — Auto fills a row neither the analysis nor your norms have', () => {
  const q = (o: Partial<NormQuery> = {}): NormQuery => ({ measurement: 'm18_PogNB', analysisId: 'steiner', population: null,
    clinicDefault: null, sex: 'M', ageYears: 30, sets, userNorms: [], ...o });
  it("Steiner's Pog–NB, a man of 30: Zheng 2026, 1.7 ± 1.1 mm, step 'anywhere', ◆", () => {
    const r = resolveNorm(q());
    if (r.kind !== 'norm') throw new Error(JSON.stringify(r));
    expect([r.setId, r.mean, r.sd, r.auto?.step, r.auto?.population, r.flags.includes('auto-fallback')])
      .toEqual(['zheng2026', 1.7, 1.1, 'anywhere', 'analysis-own', true]);
    expect(r.sourceLine.endsWith(" · Auto (no Steiner's own norm)")).toBe(true);
  });
  it('unchanged: SNA still uses Steiner 1953, not Auto', () => {
    const r = resolveNorm(q({ measurement: 'm01_SNA' }));
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('auto-fallback')]).toEqual(['steiner1953', false]);
  });
  it('a pick stored under the own-norms key wins, "chosen by you"', () => {
    const r = resolveNorm(q({ picks: { 'analysis-own': { m18_PogNB: 'malay' } } }));
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('chosen-by-you')]).toEqual(['mohammad2011', true]);
  });
  it('pickPopulation: the population, else the clinic default, else the own-norms key', () => {
    expect([pickPopulation(q({ population: 'chinese' })), pickPopulation(q({ clinicDefault: 'malay' })), pickPopulation(q())])
      .toEqual(['chinese', 'malay', 'analysis-own']);
  });
});
