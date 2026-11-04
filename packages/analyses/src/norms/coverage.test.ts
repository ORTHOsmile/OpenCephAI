// Coverage of the committed norm sets (Part C Task 11). Prints, and pins, for every analysis how
// many of its measurements have a norm of each kind, and for every population how many sets and
// catalogue measurements it holds. A pinned number moves whenever a set file is added, removed, or
// loses or gains a usable entry, so this table can never drift from the files without failing.
// When a set is added on purpose, update the pinned rows here in the same commit.
//
// What each column means (a measurement is counted once per analysis, in the first column it fits):
//   ownSd     the analysis's own norm (a paper or sheet, not a website) has an SD on at least one row
//   ownNoSd   the analysis's own norm exists but prints no SD (the app borrows one at display, B-1)
//   website   only a website value (onfile / [source removed]) — shown, never coloured (N4)
//   noOwn     no own norm and no website value
// and, independently of those four:
//   pop       at least one population set gives this measurement (definitionMatch not 'different')
//   nothing   no own norm, no website value and no population set: the app shows no norm at all
// A 'different' entry never counts: the resolver never uses it.
import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES } from '../analyses';
import { loadSets } from './load';
import type { NormSet } from './types';

const sets = loadSets();

const usable = (s: NormSet, id: string) =>
  s.entries.filter((e) => e.measurement === id && e.definitionMatch !== 'different');

const ownSets = (analysisId: string) =>
  sets.filter((s) => s.kind === 'analysis-own' && s.status !== 'pending' && (s.analyses ?? []).includes(analysisId));

const populationSets = sets.filter(
  (s) => s.kind === 'population' && (s.status === 'verified' || s.status === 'single-extracted'),
);

type Row = { analysis: string; n: number; ownSd: number; ownNoSd: number; website: number; noOwn: number; pop: number; nothing: number };

function analysisRow(analysisId: string): Row {
  const a = ALL_ANALYSES.find((x) => x.id === analysisId)!;
  const own = ownSets(analysisId);
  const row: Row = { analysis: analysisId, n: 0, ownSd: 0, ownNoSd: 0, website: 0, noOwn: 0, pop: 0, nothing: 0 };
  for (const m of a.measurements) {
    const id = m.node as string;
    row.n++;
    const paper = own.filter((s) => s.status !== 'website').flatMap((s) => usable(s, id));
    const web = own.filter((s) => s.status === 'website').flatMap((s) => usable(s, id));
    const pop = populationSets.some((s) => usable(s, id).length > 0);
    if (paper.some((e) => e.sd != null || e.sdSource != null)) row.ownSd++;
    else if (paper.length > 0) row.ownNoSd++;
    else if (web.length > 0) row.website++;
    else row.noOwn++;
    if (pop) row.pop++;
    if (paper.length === 0 && web.length === 0 && !pop) row.nothing++;
  }
  return row;
}

/** The measurement ids (catalogue order of the analysis) that have no norm of any kind. */
function nothingIds(analysisId: string): string[] {
  const a = ALL_ANALYSES.find((x) => x.id === analysisId)!;
  const own = ownSets(analysisId);
  return a.measurements
    .map((m) => m.node as string)
    .filter((id) => !own.some((s) => usable(s, id).length > 0) && !populationSets.some((s) => usable(s, id).length > 0));
}

type PopRow = { population: string; sets: number; measurements: number; withSd: number };

function populationRow(popId: string): PopRow {
  const mine = populationSets.filter((s) => s.population.id === popId);
  const ids = new Set(mine.flatMap((s) => s.entries.filter((e) => e.definitionMatch !== 'different').map((e) => e.measurement)));
  const withSd = new Set(
    mine.flatMap((s) => s.entries.filter((e) => e.definitionMatch !== 'different' && e.sd != null).map((e) => e.measurement)),
  );
  return { population: popId, sets: mine.length, measurements: ids.size, withSd: withSd.size };
}

const pad = (v: string | number, w: number) => String(v).padStart(w);

describe('norm coverage (Task 11): per analysis, per population — printed and pinned', () => {
  // Pinned 8 Oct 2026 at the end of Part C (47 set files). Re-verified 12 Oct by a separate
  // script reading the JSON files directly; every row matched. Task 10 (13 Oct): 50 files (+kim2025, alassiry2022-eastman,
  // almaaitah2022); the moved rows (ricketts, bjork-jarabak, eastman; african-american, caucasian) re-counted by a separate
  // Python script reading the JSON; planted control: dropping kim2025 #33 and alassiry #1 in a copy moved african-american
  // 41/39 -> 40/38, ricketts pop 10 -> 9 and eastman ownSd 8 -> 7 (deferred-merge-report.md). Owner JORDAN-1 (13 Oct):
  // almaaitah2022 moved from caucasian (5/25/25 -> 4/21/21) to the new jordanian population (1/4/4); per-analysis rows
  // unchanged (a population move does not change whether SOME population gives a measurement).
  const PINNED_ANALYSES: Row[] = [
    { analysis: 'steiner', n: 14, ownSd: 0, ownNoSd: 13, website: 0, noOwn: 1, pop: 12, nothing: 0 },
    { analysis: 'downs', n: 10, ownSd: 0, ownNoSd: 10, website: 0, noOwn: 0, pop: 10, nothing: 0 },
    { analysis: 'mcnamara', n: 12, ownSd: 0, ownNoSd: 10, website: 0, noOwn: 2, pop: 12, nothing: 0 },
    { analysis: 'ricketts', n: 11, ownSd: 10, ownNoSd: 1, website: 0, noOwn: 0, pop: 10, nothing: 0 },
    { analysis: 'tweed', n: 3, ownSd: 0, ownNoSd: 3, website: 0, noOwn: 0, pop: 3, nothing: 0 },
    { analysis: 'bjork-jarabak', n: 11, ownSd: 7, ownNoSd: 0, website: 3, noOwn: 1, pop: 9, nothing: 1 },
    { analysis: 'wits', n: 1, ownSd: 1, ownNoSd: 0, website: 0, noOwn: 0, pop: 1, nothing: 0 },
    { analysis: 'eastman', n: 9, ownSd: 8, ownNoSd: 0, website: 0, noOwn: 1, pop: 9, nothing: 0 },
    { analysis: 'holdaway', n: 12, ownSd: 0, ownNoSd: 10, website: 0, noOwn: 2, pop: 12, nothing: 0 },
    { analysis: 'e-line', n: 2, ownSd: 1, ownNoSd: 1, website: 0, noOwn: 0, pop: 2, nothing: 0 },
    { analysis: 'kim', n: 4, ownSd: 2, ownNoSd: 0, website: 2, noOwn: 0, pop: 2, nothing: 0 },
    { analysis: 'abo', n: 12, ownSd: 0, ownNoSd: 0, website: 10, noOwn: 2, pop: 10, nothing: 0 },
    { analysis: 'nagasaki', n: 8, ownSd: 0, ownNoSd: 0, website: 8, noOwn: 0, pop: 7, nothing: 0 },
    { analysis: 'radney', n: 4, ownSd: 0, ownNoSd: 0, website: 4, noOwn: 0, pop: 2, nothing: 0 },
    { analysis: 'nus', n: 17, ownSd: 17, ownNoSd: 0, website: 0, noOwn: 0, pop: 16, nothing: 0 },
  ];

  const PINNED_POPULATIONS: PopRow[] = [
    { population: 'african-american', sets: 3, measurements: 41, withSd: 39 },
    { population: 'caucasian', sets: 4, measurements: 21, withSd: 21 },
    { population: 'chinese', sets: 14, measurements: 52, withSd: 52 },
    { population: 'japanese', sets: 2, measurements: 25, withSd: 25 },
    { population: 'jordanian', sets: 1, measurements: 4, withSd: 4 },
    { population: 'latin-american', sets: 1, measurements: 2, withSd: 2 },
    { population: 'malay', sets: 3, measurements: 20, withSd: 20 },
    { population: 'saudi', sets: 2, measurements: 18, withSd: 18 },
    { population: 'swedish', sets: 1, measurements: 22, withSd: 22 },
  ];

  const PINNED_NOTHING: Record<string, string[]> = {
    steiner: [], downs: [], mcnamara: [], ricketts: [], tweed: [], 'bjork-jarabak': ['m43_SNtoGoMe'], wits: [],
    eastman: [], holdaway: [], 'e-line': [], kim: [], abo: [], nagasaki: [], radney: [], nus: [],
  };

  const rows = ALL_ANALYSES.map((a) => analysisRow(a.id));
  const popRows = [...new Set(populationSets.map((s) => s.population.id))].sort().map(populationRow);

  it('prints the coverage tables', () => {
    const head = `${'analysis'.padEnd(14)}${pad('n', 4)}${pad('ownSD', 7)}${pad('ownNoSD', 9)}${pad('website', 9)}${pad('noOwn', 7)}${pad('pop', 5)}${pad('nothing', 9)}`;
    const lines = rows.map(
      (r) =>
        `${r.analysis.padEnd(14)}${pad(r.n, 4)}${pad(r.ownSd, 7)}${pad(r.ownNoSd, 9)}${pad(r.website, 9)}${pad(r.noOwn, 7)}${pad(r.pop, 5)}${pad(r.nothing, 9)}`,
    );
    const popHead = `${'population'.padEnd(18)}${pad('sets', 6)}${pad('meas', 6)}${pad('withSD', 8)}`;
    const popLines = popRows.map((p) => `${p.population.padEnd(18)}${pad(p.sets, 6)}${pad(p.measurements, 6)}${pad(p.withSd, 8)}`);
    const nothing = ALL_ANALYSES.map((a) => `${a.id}: ${nothingIds(a.id).join(', ') || '—'}`);
    // eslint-disable-next-line no-console
    console.log(
      [`Norm sets loaded: ${sets.length}`, head, ...lines, '', popHead, ...popLines, '', 'No norm of any kind:', ...nothing].join('\n'),
    );
    expect(lines).toHaveLength(ALL_ANALYSES.length);
  });

  it('the number of committed set files is pinned (a removed or added file fails here first)', () => {
    expect(sets.length).toBe(50);
  });

  it('per-analysis counts are pinned', () => {
    expect(rows).toEqual(PINNED_ANALYSES);
  });

  it('per-population counts are pinned', () => {
    expect(popRows).toEqual(PINNED_POPULATIONS);
  });

  it('the measurements with no norm of any kind are pinned, by id', () => {
    expect(Object.fromEntries(ALL_ANALYSES.map((a) => [a.id, nothingIds(a.id)]))).toEqual(PINNED_NOTHING);
  });

  it('each analysis row adds up: ownSd + ownNoSd + website + noOwn = n, and nothing <= noOwn', () => {
    for (const r of rows) {
      expect(r.ownSd + r.ownNoSd + r.website + r.noOwn).toBe(r.n);
      expect(r.nothing).toBeLessThanOrEqual(r.noOwn);
    }
  });
});
