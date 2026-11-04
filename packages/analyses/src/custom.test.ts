import { describe, it, expect } from 'vitest';
import { compile, type Value } from '@ceph/geometry';
import type { NormSet } from './norms/types';
import { ALL_ANALYSES, CATALOGUE, buildRegistry, loadSets } from './index';
import { SYNTHETIC_SKULLS } from './fixtures';
import {
  MY_ANALYSIS_WORDS as W, checkAnalysis, copyName, duplicateItems, isLive, isMine, measurementGroups, moveItem,
  newAnalysisId, normAnalysisOf, normFromWords, originFor, searchGroups, toAnalysisDef, unavailableLine, type MyAnalysis,
} from './custom';

const sets = loadSets();
const mine = (items: MyAnalysis['items'], name = 'NOS clinic SYNTHETIC', id = 'my:t1'): MyAnalysis => ({ id, name, items });
const STEINER = ALL_ANALYSES.find((a) => a.id === 'steiner')!;

/** Bit for bit: the same number by Object.is (NaN equals NaN, +0 differs from −0) and the same unit; missing together. */
const sameBits = (a: Value | null | undefined, b: Value | null | undefined): boolean =>
  a == null || b == null ? (a == null) === (b == null)
    : a.t === 'scalar' && b.t === 'scalar' ? Object.is(a.v, b.v) && a.unit === b.unit : JSON.stringify(a) === JSON.stringify(b);

/** A minimal synthetic "own norm" set for `originFor` (not validated; the resolver is not involved here). */
const own = (analysis: string, measurement: string, extra: Partial<NormSet> = {}, definitionMatch: 'same' | 'different' = 'same'): NormSet => ({
  id: `own-${analysis}-SYNTHETIC`, kind: 'analysis-own', analyses: [analysis], status: 'verified',
  citation: { authors: 'Synthetic A', title: 'Synthetic', year: 2020, openAccess: true },
  population: { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] }, sample: {}, selection: 'unknown',
  modality: 'unknown', scale: { kind: 'not-stated' }, headPosition: 'unknown', curation: { extractedBy: ['a'], date: '2026-10-18' },
  caveats: [], entries: [{ measurement, sex: 'pooled', mean: 130, sd: 5, unit: 'deg', source: 'Table 1', definitionMatch,
    ...(definitionMatch === 'different' ? { definitionNote: 'SYNTHETIC' } : {}) }], ...extra,
});

describe('master plan §7 acceptance: "My analysis" values equal the built-ins, bit for bit', () => {
  const plain = compile(buildRegistry(ALL_ANALYSES));
  it('every built-in, duplicated: same measurements, labels and order; same value on every SYNTHETIC skull', () => {
    let compared = 0;
    let numeric = 0;
    for (const a of ALL_ANALYSES) {
      const d = toAnalysisDef(mine(duplicateItems(a), `${a.name} (copy)`, `my:${a.id}`));
      expect(d.measurements).toEqual(a.measurements);
      // A second, independent compile that includes the My analysis: the values are equal because a My analysis has
      // `nodes: {}` and the same node ids as the built-in it duplicates (F1/F2) — the registry-equality assertion
      // below is what proves adding a My analysis adds no node.
      const withMine = compile(buildRegistry([...ALL_ANALYSES, d]));
      expect(buildRegistry([...ALL_ANALYSES, d])).toEqual(buildRegistry(ALL_ANALYSES));
      for (const s of SYNTHETIC_SKULLS) {
        const x = plain.evaluate(s.points, 0.1), y = withMine.evaluate(s.points, 0.1);
        // Zip the My analysis's own measurement list with the built-in's by position (F1): the My analysis's node
        // ids must themselves equal the built-in's node ids in order, so this can actually fail if they diverge.
        d.measurements.forEach((dm, i) => {
          const am = a.measurements[i];
          const yv = y[dm.node], xv = x[am.node];
          expect(sameBits(yv, xv), `${a.id} ${i} ${s.name}`).toBe(true);
          compared++;
          if (xv != null && xv.t === 'scalar') numeric++;
        });
      }
    }
    // Rows compared = every built-in measurement × every skull (say this number in the report).
    expect(compared).toBe(ALL_ANALYSES.reduce((n, a) => n + a.measurements.length, 0) * SYNTHETIC_SKULLS.length);
    // How many of those compared values were actual numbers, not null (F7 — say this number in the report too).
    // Tight on purpose (fix round 1): every compared value here is a duplicated built-in's own measurement on a
    // SYNTHETIC skull, so every one must be a number; `toBeGreaterThan(0)` would miss a future regression where
    // some measurement starts returning null on the synthetic skulls.
    expect(numeric).toBe(compared);
  });
  it("the owner's example, ticked from the list: each value equals that measurement in a built-in that lists it", () => {
    const ids = ['m01_SNA', 'm02_SNB', 'm03_ANB', 'm13_Wits', 'm22_FHMPt', 'm54_U1SN', 'm56_IMPAt', 'm53_Interincisal', 'm71_ULE', 'm72_LLE'];
    const d = toAnalysisDef(mine(ids.map((id) => ({ id, from: originFor(id, sets) }))));
    expect(d.measurements.map((m) => m.node)).toEqual(ids);
    const withMine = compile(buildRegistry([...ALL_ANALYSES, d]));
    // F1(c), also applied here (fix round 1 — this is the mixed, cross-analysis tick-list the acceptance story is
    // actually about, not just the whole-duplicate case): adding a My analysis adds no node to the registry.
    expect(buildRegistry([...ALL_ANALYSES, d])).toEqual(buildRegistry(ALL_ANALYSES));
    for (const s of SYNTHETIC_SKULLS) {
      const x = plain.evaluate(s.points, 0.1), y = withMine.evaluate(s.points, 0.1);
      // Iterate the My analysis's own measurement list (F1), not the raw `ids` array, though here they're the same
      // order — this is what the correction requires so the loop is anchored on `d`, not on the input.
      for (const dm of d.measurements) {
        const id = dm.node;
        const listing = ALL_ANALYSES.find((a) => a.measurements.some((m) => m.node === id))!;
        expect(listing.measurements.find((m) => m.node === id)!.label).toBe(dm.label);
        expect(sameBits(y[id], x[id]), `${id} ${s.name}`).toBe(true);
      }
    }
  });
  it('positive control: the comparison sees one ulp, −0, a missing value, two different skulls and a swapped pair', () => {
    const v = (n: number): Value => ({ t: 'scalar', v: n, unit: 'deg' });
    expect(sameBits(v(84), v(84 + 84 * Number.EPSILON))).toBe(false);
    expect(sameBits(v(0), v(-0))).toBe(false);
    expect(sameBits(v(NaN), v(NaN))).toBe(true);
    expect(sameBits(null, v(1))).toBe(false);
    const [s0, s1] = SYNTHETIC_SKULLS, a = plain.evaluate(s0.points, 0.1), b = plain.evaluate(s1.points, 0.1);
    expect(STEINER.measurements.some((m) => !sameBits(a[m.node], b[m.node]))).toBe(true);
    const swapped = toAnalysisDef(mine([{ id: 'm02_SNB', from: 'steiner' }, { id: 'm01_SNA', from: 'steiner' }]));
    expect(swapped.measurements).not.toEqual(STEINER.measurements.slice(0, 2));
  });
});

describe('live and no longer available', () => {
  it('a live id, a retired id, an unknown id', () => {
    expect(isLive('m01_SNA')).toBe(true);
    expect(isLive('m45_U1NAmmLabial')).toBe(false);   // retired by ruling C1
    expect(isLive('m99_Gone')).toBe(false);
  });
  it('unavailable items are kept, listed, and never computed', () => {
    const d = toAnalysisDef(mine([{ id: 'm01_SNA', from: 'steiner' }, { id: 'm99_Gone', from: '' }, { id: 'm45_U1NAmmLabial', from: 'steiner' }]));
    expect(d.measurements).toEqual([{ node: 'm01_SNA', label: 'SNA' }]);
    expect(d.unavailable).toEqual(['m99_Gone', 'm45_U1NAmmLabial']);
    expect(d.nodes).toEqual({});
    expect(unavailableLine(d)).toBe('NOS clinic SYNTHETIC: 2 measurements no longer available (m99_Gone, m45_U1NAmmLabial).');
    expect(unavailableLine(toAnalysisDef(mine([{ id: 'm99_Gone', from: '' }, { id: 'm01_SNA', from: 'steiner' }]))))
      .toBe('NOS clinic SYNTHETIC: 1 measurement no longer available (m99_Gone).');
    expect(unavailableLine(toAnalysisDef(mine([{ id: 'm01_SNA', from: 'steiner' }])))).toBeNull();
  });
  it('isMine and normAnalysisOf: a built-in uses its own id; a My-analysis row its item\'s `from`', () => {
    const d = toAnalysisDef(mine([{ id: 'm01_SNA', from: 'eastman' }, { id: 'm86_Nasolabial', from: '' }]));
    expect(isMine(d)).toBe(true); expect(isMine(STEINER)).toBe(false);
    expect(normAnalysisOf(STEINER, 'm01_SNA')).toBe('steiner');
    expect(normAnalysisOf(d, 'm01_SNA')).toBe('eastman');
    expect(normAnalysisOf(d, 'm86_Nasolabial')).toBe('');
    expect(normAnalysisOf(d, 'm02_SNB')).toBe('');   // not in it: no analysis's own norm
  });
});

describe('which analysis\'s own norm (owner B3)', () => {
  it('Duplicate keeps the duplicated analysis for every item', () => {
    expect(new Set(duplicateItems(ALL_ANALYSES.find((a) => a.id === 'eastman')!).map((i) => i.from))).toEqual(new Set(['eastman']));
  });
  it('ticked: the first built-in (app order) with its own norm for it; else the first that lists it; else none', () => {
    // #53 is listed by Steiner first, then Downs, Ricketts, …
    expect(originFor('m53_Interincisal', [])).toBe('steiner');
    expect(originFor('m53_Interincisal', [own('downs', 'm53_Interincisal')])).toBe('downs');
    expect(originFor('m53_Interincisal', [own('downs', 'm53_Interincisal', { status: 'pending' })])).toBe('steiner');
    expect(originFor('m53_Interincisal', [own('downs', 'm53_Interincisal', {}, 'different')])).toBe('steiner');
    expect(originFor('m86_Nasolabial', sets)).toBe('');   // no built-in analysis lists it
  });
  it('the words under each chosen measurement', () => {
    expect(normFromWords('steiner', 'm01_SNA', sets)).toBe("Norm: your population's, else Steiner's own");
    expect(normFromWords('', 'm86_Nasolabial', sets)).toBe("Norm: your population's (no built-in analysis lists it)");
  });
  // Final review M1: an analysis is named as the norm's source only when the norm sets really hold its own norm for
  // that measurement. These six are listed by a built-in that has no own norm for them (originFor falls back to the
  // first that lists it); a Duplicate keeps the same `from`, so it says the same.
  it.each([
    ['m10_CoA', 'mcnamara'], ['m18_PogNB', 'steiner'], ['m43_SNtoGoMe', 'bjork-jarabak'],
    ['m79_ULStrain', 'holdaway'], ['m82_InfSulcusH', 'holdaway'], ['m84_UpperPharynx', 'mcnamara'],
  ])('%s: %s lists it but has no own norm for it, so the words never name its own', (node, from) => {
    expect(originFor(node, sets)).toBe(from);
    const name = ALL_ANALYSES.find((a) => a.id === from)!.name;
    expect(normFromWords(from, node, sets)).toBe(`Norm: your population's (${name} lists it but has no norm of its own for it)`);
  });
});

describe('checking an analysis before it is saved', () => {
  const sna = [{ id: 'm01_SNA', from: 'steiner' }];
  it('needs a name, at most 60 characters, trimmed', () => {
    expect(checkAnalysis({ name: '', items: sna }, [], null)).toEqual({ ok: false, error: W.noName });
    expect(checkAnalysis({ name: '   ', items: sna }, [], null)).toEqual({ ok: false, error: W.noName });
    expect(checkAnalysis({ name: 'x'.repeat(61), items: sna }, [], null)).toEqual({ ok: false, error: W.tooLong });
    expect(checkAnalysis({ name: ` ${'x'.repeat(60)} `, items: sna }, [], null)).toEqual({ ok: true, name: 'x'.repeat(60) });
  });
  it('an empty analysis is not saved, nor one whose every measurement is no longer available', () => {
    expect(checkAnalysis({ name: 'A', items: [] }, [], null)).toEqual({ ok: false, error: W.empty });
    expect(checkAnalysis({ name: 'A', items: [{ id: 'm99_Gone', from: '' }] }, [], null)).toEqual({ ok: false, error: W.empty });
    expect(checkAnalysis({ name: 'A', items: [{ id: 'm99_Gone', from: '' }, ...sna] }, [], null).ok).toBe(true);
  });
  it('the same measurement twice is refused', () => {
    expect(checkAnalysis({ name: 'A', items: [...sna, ...sna] }, [], null)).toEqual({ ok: false, error: W.twice('SNA') });
  });
  it('two analyses with the same name are refused, built-ins included, in any case; editing keeps its own name', () => {
    expect(checkAnalysis({ name: 'steiner ', items: sna }, [], null)).toEqual({ ok: false, error: W.taken('Steiner') });
    const list = [{ id: 'my:a', name: 'NOS clinic' }];
    expect(checkAnalysis({ name: 'nos CLINIC', items: sna }, list, null)).toEqual({ ok: false, error: W.taken('NOS clinic') });
    expect(checkAnalysis({ name: 'NOS clinic', items: sna }, list, 'my:a')).toEqual({ ok: true, name: 'NOS clinic' });
  });
  it('a hidden zero-width character cannot make a name look different from a built-in it would be confused with (m10)', () => {
    expect(checkAnalysis({ name: 'Steiner​', items: sna }, [], null)).toEqual({ ok: false, error: W.taken('Steiner') });
    expect(checkAnalysis({ name: 'Ste​iner', items: sna }, [], null)).toEqual({ ok: false, error: W.taken('Steiner') });
  });
});

describe('names, ids, groups, search, order', () => {
  it('copy names never clash', () => {
    expect(copyName('Steiner', ['Steiner'])).toBe('Steiner (copy)');
    expect(copyName('Steiner', ['Steiner', 'steiner (COPY)'])).toBe('Steiner (copy 2)');
  });
  it('new ids start with my: and are never one already taken', () => {
    const r = [0.5, 0.5, 0.25]; let i = 0;
    const rand = () => r[i++], now = () => 1000;
    const first = newAnalysisId([], () => 0.5, now);
    expect(first.startsWith('my:')).toBe(true);
    expect(newAnalysisId([first], rand, now)).not.toBe(first);
  });
  it('the groups hold every live catalogue measurement exactly once; airway is #84 and #85', () => {
    const ids = measurementGroups().flatMap((g) => g.entries.map((e) => e.id));
    const live = CATALOGUE.filter((e) => !e.retired).map((e) => e.id);
    expect(ids.length).toBe(live.length); expect(new Set(ids)).toEqual(new Set(live));
    expect(measurementGroups().map((g) => g.title)).toEqual(['Skeletal: front-to-back', 'Vertical and jaw shape', 'Dental', 'Soft tissue', 'Airway']);
    expect(measurementGroups()[4].entries.map((e) => e.id)).toEqual(['m84_UpperPharynx', 'm85_LowerPharynx']);
  });
  it('search by name, abbreviation or #number; nothing found is an empty list', () => {
    const flat = (q: string) => searchGroups(q).flatMap((g) => g.entries.map((e) => e.id));
    expect(flat('sna')).toContain('m01_SNA');
    expect(flat('FMA')).toContain('m22_FHMPt');          // the approved abbreviation
    expect(flat('#22')).toEqual(['m22_FHMPt']);           // a number: that number only
    expect(flat('#70')).toEqual(['m70a_U6NA', 'm70b_L6NB']);
    expect(flat('zzz')).toEqual([]); expect(searchGroups('zzz')).toEqual([]);
    expect(searchGroups('  ')).toEqual(measurementGroups());
  });
  it('moving an item; out of range changes nothing', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 0, 3)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], -1, 0)).toEqual(['a', 'b', 'c']);
  });
});
