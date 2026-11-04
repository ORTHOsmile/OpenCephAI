import { describe, it, expect } from 'vitest';
import { compile } from '@ceph/geometry';
import { ALL_ANALYSES, SYNTHETIC_SKULLS, buildRegistry, duplicateItems, loadSets, originFor, resolveNorm, toAnalysisDef, type UserNorm } from '@ceph/analyses';
import { measurementRows, type MeasurementRow } from '../measurements';
import { normCell, queryFor } from '../norms/normCell';
import { DEFAULT_DECIMALS } from '../format';

// Master plan §7 acceptance and owner B3, through the rows and norm cells the screens use.
const sets = loadSets();
const userNorms: UserNorm[] = [{ setName: 'Clinic SYNTHETIC', measurement: 'm01_SNA', mean: 82, sd: 3, sourceNote: 'SYNTHETIC' }];
const ctx = { sets, userNorms, clinicDefault: null };
const g = compile(buildRegistry(ALL_ANALYSES));
const POPS = [null, 'chinese', 'caucasian', 'saudi', 'analysis-own', 'user:Clinic SYNTHETIC'];
const DOCS = POPS.flatMap((population) => [
  { population, gender: 'M' as const, dateOfBirth: '1996-01-02', takenOn: '2026-01-10' },   // SYNTHETIC adult man
  { population, gender: 'F' as const, dateOfBirth: '2014-01-02', takenOn: '2026-01-10' },   // SYNTHETIC girl of 12
  { population, gender: null, dateOfBirth: null, takenOn: '2026-01-10' },                    // SYNTHETIC: sex and age not recorded
]);
const rowsOf = (d: Parameters<typeof measurementRows>[0][number], points: Record<string, { x: number; y: number }>) =>
  measurementRows([d], g, g.evaluate(points, 0.1), new Set(Object.keys(points)), DEFAULT_DECIMALS);
const cellOf = (r: MeasurementRow, doc: (typeof DOCS)[number], analysisId = r.normAnalysisId) => {
  const q = queryFor(r.node, analysisId, doc, ctx);
  return normCell(r.num, resolveNorm(q), q, DEFAULT_DECIMALS);
};
const same = (r: MeasurementRow) => ({ node: r.node, label: r.label, unit: r.unit, value: r.value, num: r.num, hidden: r.hidden, needs: r.needs, undefinedReason: r.undefinedReason });

describe('"My analysis" rows and norms equal the original analysis\'s (master plan §7, owner B3)', () => {
  it('every built-in, duplicated: identical rows on every SYNTHETIC skull, Object.is on each number', () => {
    let compared = 0;
    for (const a of ALL_ANALYSES) {
      const d = toAnalysisDef({ id: `my:${a.id}`, name: `${a.name} (copy)`, items: duplicateItems(a) });
      for (const s of SYNTHETIC_SKULLS) {
        const mine = rowsOf(d, s.points), theirs = rowsOf(a, s.points);
        expect(mine.map(same)).toEqual(theirs.map(same));
        mine.forEach((r, i) => { expect(Object.is(r.num, theirs[i].num)).toBe(true); expect(r.normAnalysisId).toBe(a.id); compared++; });
      }
    }
    expect(compared).toBe(ALL_ANALYSES.reduce((n, a) => n + a.measurements.length, 0) * SYNTHETIC_SKULLS.length);
  });
  it('every built-in, duplicated: the same norm cell for every population, sex and age', () => {
    let compared = 0;
    const points = SYNTHETIC_SKULLS[0].points;
    for (const a of ALL_ANALYSES) {
      const mine = rowsOf(toAnalysisDef({ id: `my:${a.id}`, name: `${a.name} (copy)`, items: duplicateItems(a) }), points), theirs = rowsOf(a, points);
      for (const doc of DOCS) mine.forEach((r, i) => { expect(cellOf(r, doc)).toEqual(cellOf(theirs[i], doc)); compared++; });
    }
    expect(compared).toBe(ALL_ANALYSES.reduce((n, a) => n + a.measurements.length, 0) * DOCS.length);
  });
  it("the owner's example, ticked from the list: each cell equals that measurement's in its original analysis", () => {
    const ids = ['m01_SNA', 'm02_SNB', 'm03_ANB', 'm13_Wits', 'm22_FHMPt', 'm54_U1SN', 'm56_IMPAt', 'm53_Interincisal', 'm71_ULE', 'm72_LLE'];
    const points = SYNTHETIC_SKULLS[0].points;
    const mine = rowsOf(toAnalysisDef({ id: 'my:t', name: 'NOS clinic SYNTHETIC', items: ids.map((id) => ({ id, from: originFor(id, sets) })) }), points);
    for (const r of mine) {
      const original = rowsOf(ALL_ANALYSES.find((a) => a.id === originFor(r.node, sets))!, points).find((x) => x.node === r.node)!;
      for (const doc of DOCS) expect(cellOf(r, doc)).toEqual(cellOf(original, doc));
    }
  });
  it('positive control: resolving My rows with the My analysis\'s own id (the defect this task prevents) changes cells', () => {
    const steiner = ALL_ANALYSES.find((a) => a.id === 'steiner')!;
    const mine = rowsOf(toAnalysisDef({ id: 'my:s', name: 'S', items: duplicateItems(steiner) }), SYNTHETIC_SKULLS[0].points);
    const differs = DOCS.flatMap((doc) => mine.map((r) => JSON.stringify(cellOf(r, doc, r.analysisId)) !== JSON.stringify(cellOf(r, doc)))).filter(Boolean).length;
    expect(differs).toBeGreaterThan(0);
  });
  it('a measurement no built-in lists: normAnalysisId "", and no cell names a my: id or "\'s own"', () => {
    const [r] = rowsOf(toAnalysisDef({ id: 'my:n', name: 'N', items: [{ id: 'm86_Nasolabial', from: '' }] }), SYNTHETIC_SKULLS[0].points);
    expect(r.normAnalysisId).toBe('');
    for (const doc of DOCS) { const c = cellOf(r, doc); expect(`${c.text} ${c.sourceLine}`).not.toMatch(/my:|'s own/); }
  });
});
