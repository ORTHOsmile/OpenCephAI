// Spec 2026-11-03 combined adult norm §4–§6 (owner rulings R1/R5, NAP-P1 (a), P2 (a), 3 Nov 2026): the combining
// formula and who enters the adult pool, on the real sets.
import { describe, it, expect } from 'vitest';
import { loadSets } from './load';
import { adultPool, combineGroups } from './combined';

const sets = loadSets();
const ids = (m: string, sex: 'M' | 'F') => adultPool(sets, m, sex).map((r) => r.set.id);

/** The plain SD of a list of numbers (n − 1). */
const sdOf = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('combineGroups (Cochrane Handbook 6.5.2.10, Table 6.5.a, k groups)', () => {
  it('equals the mean and SD of the raw numbers merged', () => {
    const groups = [[80, 82, 85, 79, 84, 83], [86, 88, 84, 90], [78, 81, 80, 77, 83, 79, 82, 80]];
    const c = combineGroups(groups.map((g) => ({ n: g.length, mean: meanOf(g), sd: sdOf(g) })));
    const all = groups.flat();
    expect(c.n).toBe(all.length);
    expect(c.mean).toBeCloseTo(meanOf(all), 10);
    expect(c.sd).toBeCloseTo(sdOf(all), 10);
  });
  it('includes the spread between the studies\' means (two studies, same SD, means 4° apart)', () => {
    const c = combineGroups([{ n: 10, mean: 0, sd: 1 }, { n: 10, mean: 4, sd: 1 }]);
    expect(c.mean).toBe(2);
    expect(c.sd).toBeCloseTo(Math.sqrt(98 / 19), 12);   // within-study only would be 1
  });
  it('one group is itself; no groups is refused', () => {
    expect(combineGroups([{ n: 16, mean: 82.5, sd: 3.9 }])).toEqual({ n: 16, mean: 82.5, sd: 3.9 });
    expect(combineGroups([{ n: 1, mean: 82.5, sd: 3.9 }])).toEqual({ n: 1, mean: 82.5, sd: 3.9 });
    expect(() => combineGroups([])).toThrow('nothing to combine');
  });
  it('refuses a group with no real mean or SD, an SD of 0 or less, or fewer than one person (final review M9)', () => {
    const ok = { n: 10, mean: 82, sd: 3 };
    for (const bad of [{ n: 10, mean: NaN, sd: 3 }, { n: 10, mean: 82, sd: NaN }, { n: 10, mean: 82, sd: 0 }, { n: 10, mean: 82, sd: -1 },
      { n: 0, mean: 82, sd: 3 }, { n: NaN, mean: 82, sd: 3 }, { n: 10, mean: Infinity, sd: 3 }]) {
      expect(() => combineGroups([ok, bad]), JSON.stringify(bad)).toThrow('not a usable group');
      expect(() => combineGroups([bad]), JSON.stringify(bad)).toThrow('not a usable group');
    }
  });
});

describe('the adult pool (spec §4)', () => {
  it("Thilander 2005's people are counted once: its oldest adult row only (29–32 y; 11 men, 19 women)", () => {
    for (const [sex, n] of [['M', 11], ['F', 19]] as const) {
      const t = adultPool(sets, 'm01_SNA', sex).filter((r) => r.set.id === 'thilander2005');
      expect(t.length).toBe(1);
      expect(t[0].entry.ageBand).toEqual([29, 32]);
      expect(t[0].n).toBe(n);
    }
  });
  // Owner I1 (a), 3 Nov 2026 (final review I1): each person counts once — a both-sexes row stands for ITS OWN men or
  // women. Zheng 2026's adult row holds 60 people (30 men, 30 women; its other 60 are adolescents).
  it('a both-sexes row enters an angle\'s pool with that row\'s own count for the sex (P2 (a), I1 (a))', () => {
    for (const sex of ['M', 'F'] as const) {
      const z = adultPool(sets, 'm01_SNA', sex).find((r) => r.set.id === 'zheng2026')!;
      expect([z.entry.sex, z.n, z.bothSexes]).toEqual(['pooled', 30, true]);
    }
    expect(adultPool(sets, 'm01_SNA', 'F').find((r) => r.set.id === 'kim2025')?.n).toBe(25);   // an all-adult study: its own count
  });
  it('a both-sexes adult row of a study that also holds children, with no split recorded, is left out (I1 (a))', () => {
    const zheng = sets.find((s) => s.id === 'zheng2026')!;
    const noSplit = { ...zheng, id: 'synthetic-nosplit', entries: zheng.entries.map(({ nMale: _m, nFemale: _f, ...e }) => e) };
    expect(adultPool([noSplit], 'm01_SNA', 'M')).toEqual([]);
    expect(adultPool([zheng], 'm01_SNA', 'M').map((r) => r.n)).toEqual([30]);   // control: with the split, it enters
  });
  it('eligibility: pending, website, analysis-own and unselected treatment-seeking (mixed-occlusion) sets are left out (final review M5)', () => {
    const base = sets.find((s) => s.id === 'mohammad2011')!;
    expect(adultPool([base], 'm01_SNA', 'M').length).toBe(1);   // control: the plain set enters
    for (const change of [{ status: 'pending' }, { status: 'website' }, { kind: 'analysis-own' }, { kind: 'research-sd' }, { selection: 'mixed-occlusion' }] as const) {
      expect(adultPool([{ ...base, ...change } as typeof base], 'm01_SNA', 'M'), JSON.stringify(change)).toEqual([]);
    }
  });
  it('millimetre rows never use a both-sexes row (P2 (a)), and that rule really leaves rows out', () => {
    const mm = [...new Set(sets.flatMap((s) => s.entries.filter((e) => e.unit === 'mm').map((e) => e.measurement)))];
    let excluded = 0;
    for (const m of mm) for (const sex of ['M', 'F'] as const) {
      const pool = adultPool(sets, m, sex);
      expect(pool.filter((r) => r.entry.sex === 'pooled' || r.bothSexes)).toEqual([]);
      // Positive control: an eligible study with only a both-sexes adult row for this mm measurement exists.
      excluded += adultPool(sets, m, sex, { mmBothSexes: true }).filter((r) => r.bothSexes).length;
    }
    expect(excluded).toBeGreaterThan(0);
  });
  it('one study per cohort, the larger n (Ann Arbor over Gu 2011 Michigan for SNA; Gu where Ann Arbor has none)', () => {
    expect(ids('m01_SNA', 'F')).toContain('mcnamara1984-annarbor');
    expect(ids('m01_SNA', 'F')).not.toContain('gu2011-caucasian');
    expect(ids('m02_SNB', 'F')).toContain('gu2011-caucasian');
  });
  it('never in the pool: rows with no n for adults, no sex split, children only, treatment-seekers, analyses\' own norms', () => {
    const everyone = new Set(['M', 'F'].flatMap((sex) => [...new Set(sets.flatMap((s) => s.entries.map((e) => e.measurement)))]
      .flatMap((m) => ids(m, sex as 'M' | 'F'))));
    for (const id of ['moate2002-fu1975', 'moate2002-miao1995', 'moate2002-chan1972', 'moate2002-cheng1986', 'moate2002-lew1992', 'wu2007', 'obamiyi2019', 'steiner1953', 'ndc-sheet']) {
      expect(everyone.has(id), id).toBe(false);
    }
    expect(everyone.has('moate2002-wei1968')).toBe(true);   // R4: beauty-selected, second-hand with its own n
    for (const s of sets.filter((x) => x.selection === 'mixed-occlusion' || x.kind !== 'population')) expect(everyone.has(s.id), s.id).toBe(false);
  });
  // Re-measured after owner I1 (a), 3 Nov 2026 (Zheng 2026 counts its 30 adult men and 30 adult women, not 60 each).
  it('the spec §10 preview, men: SNA 83.1 ± 4.1 [8, 277], U1–SN 110.4 ± 7.6 [5, 124]; women: IMPA (Go–Me) 95.4 ± 7.1 [4, 269]', () => {
    const c = (m: string, sex: 'M' | 'F') => { const p = adultPool(sets, m, sex); return { k: p.length, ...combineGroups(p.map((r) => ({ n: r.n, mean: r.entry.mean!, sd: r.entry.sd! }))) }; };
    const sna = c('m01_SNA', 'M'), u1 = c('m54_U1SN', 'M'), impa = c('m57_IMPAgome', 'F');
    expect([sna.k, sna.n, +sna.mean.toFixed(1), +sna.sd.toFixed(1)]).toEqual([8, 277, 83.1, 4.1]);
    expect([u1.k, u1.n, +u1.mean.toFixed(1), +u1.sd.toFixed(1)]).toEqual([5, 124, 110.4, 7.6]);
    expect([impa.k, impa.n, +impa.mean.toFixed(1), +impa.sd.toFixed(1)]).toEqual([4, 269, 95.4, 7.1]);
  });
  it('edges: a measurement no adult study has is an empty pool', () => {
    // U6–PTV is measured, but only in children's rows: the adult rule leaves it empty (final review M4).
    expect(sets.some((s) => s.kind === 'population' && s.entries.some((e) => e.measurement === 'm19_U6PTV'))).toBe(true);
    expect(adultPool(sets, 'm19_U6PTV', 'M')).toEqual([]);
    expect(adultPool(sets, 'no-such-measurement', 'F')).toEqual([]);
    expect(adultPool([], 'm01_SNA', 'F')).toEqual([]);
  });
});
