// Spec 2026-11-03 combined adult norm (owner rulings R1/R5, NAP-P1 (a), P2 (a), 3 Nov 2026): every adult study in the
// app combined into one norm per measurement and sex, each person counting once. Pure; the resolver (resolve.ts) turns
// a pool into a norm (film scale, flags, words).
import type { NormEntry, NormSet } from './types';

/** One group's size, mean and SD. */
export interface Group { n: number; mean: number; sd: number }

/** Owner NAP-P1 (a): the N, mean and SD of k groups taken together — Cochrane Handbook for Systematic Reviews of
 *  Interventions, section 6.5.2.10 "Combining groups", Table 6.5.a, for k groups at once:
 *  mean = Σ nᵢmᵢ / N; SD = √{[Σ(nᵢ−1)sᵢ² + Σ nᵢ(mᵢ−M)²] / (N−1)}. The second sum is the spread BETWEEN the groups'
 *  means: groups that disagree widen the result. One group is returned as it is. */
export function combineGroups(groups: Group[]): Group {
  if (!groups.length) throw new Error('nothing to combine');
  // Final review M9: a group with no real mean or SD, an SD of 0 or less, or fewer than one person is refused here,
  // not passed on as NaN.
  for (const g of groups) {
    if (!Number.isFinite(g.mean) || !Number.isFinite(g.sd) || !(g.sd > 0) || !Number.isFinite(g.n) || g.n < 1) {
      throw new Error(`not a usable group: ${JSON.stringify(g)}`);
    }
  }
  if (groups.length === 1) return { ...groups[0] };
  const n = groups.reduce((a, g) => a + g.n, 0);
  const mean = groups.reduce((a, g) => a + g.n * g.mean, 0) / n;
  const within = groups.reduce((a, g) => a + (g.n - 1) * g.sd ** 2, 0);
  const between = groups.reduce((a, g) => a + g.n * (g.mean - mean) ** 2, 0);
  return { n, mean, sd: Math.sqrt((within + between) / (n - 1)) };
}

/** One study's row in the adult pool: the row, the people it stands for, and whether it is a both-sexes row. */
export interface PoolRow { set: NormSet; entry: NormEntry; n: number; bothSexes: boolean }

/** Spec §4.1.8: the same people reported twice (or probably so); one study per cohort per measurement, the larger n. */
export const SAME_COHORT: readonly (readonly string[])[] = [['alcalde1998', 'alcalde2000'], ['gu2011-caucasian', 'mcnamara1984-annarbor']];

/** Spec §4.1.1: an adult row — its band starts at 18 or later, or it is the study's own adult group (starts at 15 or
 *  later and the middle of its band is 18 or later). A row with no band says nothing about age: never. */
export const isAdultBand = (b: [number, number] | undefined): boolean => !!b && (b[0] >= 18 || (b[0] >= 15 && (b[0] + b[1]) / 2 >= 18));

/** Spec §4.1.7: samples of people only — never an analysis's own norm, a teaching sheet, a research-SD set, a website
 *  or pending set, or a sample marked 'mixed-occlusion' (consecutive patients taken as they came, whatever their bite).
 *  No population set is marked so today; the clause is kept for one that may be, and a test with a synthetic set shows
 *  it acts. It does NOT leave out every clinic sample: Kim 2025, Al Maaitah 2022, Zheng 2026 and Cheong 2024 are
 *  patients selected for a Class I pattern and enter (owner KIMRANK-1, extended to Cheong 2024 on 3 Nov 2026). */
const eligible = (s: NormSet) => s.kind === 'population' && s.status !== 'pending' && s.status !== 'website' && s.selection !== 'mixed-occlusion';
/** Spec §4.1.7: a row that is the sample's own mean and SD: an SD of its own, not borrowed; not an ideal; not another
 *  sex's copy; not measured differently. */
const usable = (e: NormEntry, measurement: string) => e.measurement === measurement && e.definitionMatch !== 'different' && isAdultBand(e.ageBand)
  && e.mean != null && e.sd != null && e.sd > 0 && !e.sdSource && e.centre !== 'ideal' && !e.fromOtherSex;
/** Spec §4.1.2: the oldest adult row (the most fully grown; the same people are never counted at two ages). */
const oldest = (rows: NormEntry[]) => [...rows].sort((a, b) => b.ageBand![0] - a.ageBand![0] || b.ageBand![1] - a.ageBand![1])[0];

/** The adult pool for one measurement and sex (spec §4): one row per study — its own-sex row (n: the row's own; else
 *  the study's count for that sex when every row of the study is adult), else (angles, % and ratios only, NAP-P2 (a))
 *  its both-sexes row, standing for that sex's people in the study; a study whose people cannot be counted is left out.
 *  Then one study per cohort (SAME_COHORT). In set-id order. `mmBothSexes` exists only for the test that shows the mm
 *  rule leaves rows out (its positive control). */
export function adultPool(sets: NormSet[], measurement: string, sex: 'M' | 'F', o: { mmBothSexes?: boolean } = {}): PoolRow[] {
  const out: PoolRow[] = [];
  for (const set of sets.filter(eligible)) {
    const rows = set.entries.filter((e) => usable(e, measurement));
    const sexCount = sex === 'M' ? set.sample.nMale : set.sample.nFemale;
    const own = rows.filter((e) => e.sex === sex);
    if (own.length) {
      const entry = oldest(own);
      const n = entry.n ?? (set.entries.every((e) => isAdultBand(e.ageBand)) ? sexCount : undefined);
      if (n) out.push({ set, entry, n, bothSexes: false });
      continue;
    }
    // Owner I1 (a), 3 Nov 2026 (final review I1): each person counts once. A both-sexes row stands for its OWN men or
    // women: the row's recorded split; else, when every row of the study is adult, the study's count for that sex;
    // else (a study that also holds children, no split recorded) it cannot be counted and is left out.
    const both = rows.filter((e) => e.sex === 'pooled' && (e.unit !== 'mm' || o.mmBothSexes));
    if (both.length) {
      const entry = oldest(both);
      const n = (sex === 'M' ? entry.nMale : entry.nFemale) ?? (set.entries.every((e) => isAdultBand(e.ageBand)) ? sexCount : undefined);
      if (n) out.push({ set, entry, n, bothSexes: true });
    }
  }
  const dropped = new Set<string>();
  for (const cohort of SAME_COHORT) {
    const inPool = out.filter((r) => cohort.includes(r.set.id)).sort((a, b) => b.n - a.n || a.set.id.localeCompare(b.set.id));
    inPool.slice(1).forEach((r) => dropped.add(r.set.id));
  }
  return out.filter((r) => !dropped.has(r.set.id)).sort((a, b) => a.set.id.localeCompare(b.set.id));
}
