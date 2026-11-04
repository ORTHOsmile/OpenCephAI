import { describe, it, expect } from 'vitest';
import { analysisCoverage, foundBy } from './coverage';
import { ALL_ANALYSES } from './analyses';
import { ISBI19, LANDMARKS, type LandmarkId } from './landmarks';
import scoresTable from '../../../reference/model-scores.json';
const steiner = ALL_ANALYSES.find((a) => a.id === 'steiner')!;
describe('analysisCoverage', () => {
  it('with only the original 19, Steiner is partly automatic and names U1A among the missing points', () => {
    const c = analysisCoverage(steiner, new Set(ISBI19));
    expect(c.automatic).toBe(false);
    expect(c.missing).toContain('U1A');
  });
  it('adding the missing points makes it automatic (the same analysis, no code change)', () => {
    const c0 = analysisCoverage(steiner, new Set(ISBI19));
    expect(analysisCoverage(steiner, new Set([...ISBI19, ...c0.missing])).automatic).toBe(true);
  });
  it('foundBy leaves out tooFar points and keeps notScored ones', () => {
    const f = foundBy([{ points: [{ id: 'U1A', status: { kind: 'tooFar' } }, { id: 'Ba', status: { kind: 'notScored' } }] }]);
    expect([...f]).toEqual(['Ba']);
  });
  it('an empty table finds nothing and every needed point is missing', () => {
    const c = analysisCoverage(steiner, foundBy([]));
    expect(c.automatic).toBe(false);
    expect(c.missing).toContain('S');
  });
  it('missing comes in LANDMARKS order and holds only points the analysis needs', () => {
    const c = analysisCoverage(steiner, new Set());
    const order = Object.keys(LANDMARKS);
    expect(c.missing.map((k) => order.indexOf(k))).toEqual([...c.missing.map((k) => order.indexOf(k))].sort((a, b) => a - b));
    expect(c.missing).not.toContain('SPogS');
  });
  it('a point found by one model and too far for another is found', () => {
    expect([...foundBy([{ points: [{ id: 'U1A', status: { kind: 'tooFar' } }] }, { points: [{ id: 'U1A', status: { kind: 'scored' } }] }])]).toEqual(['U1A']);
  });
});

// Final review M4: the catalogue's "how many analyses run fully automatically" claim, computed rather than asserted
// from memory. The placed new points come from the committed gate table (Aariz test split, MRE ≤ 2.0 mm, R-B2) plus
// SRPose's twelve unscored points (R-B1, placed); the counts are printed for the catalogue and pinned here.
describe('how many analyses are fully automatic (catalogue §2, final review M4)', () => {
  const scored = (modelId: string) => {
    const row = (scoresTable as { split: string; modelId: string; points: Record<string, { mre: number }> }[]).find((r) => r.split === 'test' && r.modelId === modelId)!;
    return Object.entries(row.points).filter(([id, s]) => !ISBI19.includes(id as never) && s.mre <= 2.0).map(([id]) => id as LandmarkId);
  };
  const SRPOSE_UNSCORED: LandmarkId[] = ['D', 'Cm', 'PTM', 'Ba', 'Pt', 'Bo', 'ULs', 'LLs', 'GnS', 'MeS', 'G', 'Cerv'];
  const count = (found: Set<LandmarkId>) => ALL_ANALYSES.filter((a) => analysisCoverage(a, found).automatic).map((a) => a.id);
  it('the original 19; + SRPose\'s placed points; + Aariz\'s scored points', () => {
    expect(scored('srpose-cldet23').sort()).toEqual(['Prn']);
    expect(scored('aariz-cepha29').sort()).toEqual(['L1A', 'L6', 'Ns', 'Prn', 'U1A', 'U6']);
    const i = count(new Set(ISBI19));
    const ii = count(new Set([...ISBI19, ...scored('srpose-cldet23'), ...SRPOSE_UNSCORED]));
    const iii = count(new Set([...ISBI19, ...scored('srpose-cldet23'), ...SRPOSE_UNSCORED, ...scored('aariz-cepha29')]));
    console.log(`COVERAGE of ${ALL_ANALYSES.length} analyses: (i) original 19: ${i.length} [${i}]; (ii) + SRPose placed: ${ii.length} [${ii}]; (iii) + Aariz scored: ${iii.length} [${iii}]`);
    // Owner NUS-OP-1 (16 Oct 2026): Wits, overjet and overbite no longer need P4 (found by no model), so Wits,
    // Nagasaki and NUS become fully automatic with Aariz: 5 -> 8.
    expect([ALL_ANALYSES.length, i.length, ii.length, iii.length]).toEqual([15, 1, 2, 8]);
    expect(iii).toEqual(['steiner', 'bjork-jarabak', 'wits', 'eastman', 'e-line', 'nagasaki', 'radney', 'nus']);
  });
});
