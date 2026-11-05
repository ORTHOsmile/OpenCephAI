import { describe, it, expect } from 'vitest';
import { compile, type Expr, type NodeId } from '@ceph/geometry';
import { buildRegistry } from './registry';
import { ALL_ANALYSES } from './analyses';
import { exprRefs } from './steps';
import { SYNTHETIC_SKULLS } from './fixtures';

/** Request G, plan 2026-10-18 Task 6, fix round 1 (review M-1). On the Superimposition page a fitted film's column takes
 *  only its **mm** values from the fit's scale and keeps every other value (angles, ratios, %) from its own scale
 *  (`mmFrom`, apps/desktop/src/compare/comparison.ts), so a fit never moves an angle or a ratio — not even in the last bit.
 *  That is right only while no non-mm value depends on mm/px. A value can depend on mm/px only through a point placed a
 *  fixed number of mm away (`offsetPoint`, e.g. m77_A3 "about 3 mm below A") or a constant in mm. This test walks the
 *  whole registry and fails if an angle, ratio or other non-mm value reaches either; a second, numeric check evaluates
 *  every non-mm value at two scales on every SYNTHETIC skull. Instrument checks: each says how many nodes it
 *  checked, refuses a node whose unit it cannot tell, and shows on a known case (m77_BasicUL, an mm distance to the
 *  offset point) that it can see a scale-bound node. */
const reg = buildRegistry(ALL_ANALYSES);
const g = compile(reg);
const ids = Object.keys(reg).filter((id) => g.typeOf(id) === 'scalar');
// The unit of each scalar node, read from its value on the skulls (a node with no value on any skull is refused below).
const unitOf = new Map<NodeId, string>();
for (const s of SYNTHETIC_SKULLS) for (const [id, v] of Object.entries(g.evaluate(s.points, 0.1))) if (v?.t === 'scalar') unitOf.set(id, v.unit);
const memo = new Map<NodeId, boolean>();
const scaleBound = (id: NodeId): boolean => {
  if (memo.has(id)) return memo.get(id)!;
  const e: Expr = reg[id];
  const r = e.kind === 'offsetPoint' || (e.kind === 'constant' && e.unit === 'mm') || exprRefs(e).some(scaleBound);
  memo.set(id, r); return r;
};

describe('no angle or ratio depends on the mm/px scale (request G: a fit changes only mm)', () => {
  it('statically: no non-mm value is built on an mm-offset point or an mm constant', () => {
    expect(ids.filter((id) => !unitOf.has(id))).toEqual([]);            // every scalar's unit is known: nothing skipped unseen
    const nonMm = ids.filter((id) => unitOf.get(id) !== 'mm');
    console.log(`SCALE-FREE (static): ${ids.length} scalar nodes, ${nonMm.length} non-mm checked; scale-bound mm nodes: ${ids.filter((id) => unitOf.get(id) === 'mm' && scaleBound(id)).join(', ')}`);
    expect(nonMm.length).toBeGreaterThan(50);
    expect(scaleBound('m77_BasicUL')).toBe(true);                         // positive control: the walk sees the known case
    expect(nonMm.filter(scaleBound)).toEqual([]);
  });
  it('numerically: every non-mm value is the same (to 1e-9) at 0.1 and 0.131 mm/px on every SYNTHETIC skull', () => {
    let n = 0; const moved: string[] = [];
    for (const s of SYNTHETIC_SKULLS) {
      const a = g.evaluate(s.points, 0.1), b = g.evaluate(s.points, 0.131);
      for (const id of ids) { const x = a[id], y = b[id];
        if (x?.t !== 'scalar' || x.unit === 'mm') continue; n++;
        if (y?.t !== 'scalar' || Math.abs(x.v - y.v) > 1e-9 * Math.max(1, Math.abs(x.v))) moved.push(`${s.name} ${id}`); }
    }
    const bul = (k: number) => { const v = g.evaluate(SYNTHETIC_SKULLS[0].points, k).m77_BasicUL; return v?.t === 'scalar' ? v.v / k : NaN; };
    console.log(`SCALE-FREE (numeric): ${n} non-mm values compared; ${moved.length} moved`);
    expect(n).toBeGreaterThan(300);
    expect(Math.abs(bul(0.1) - bul(0.131))).toBeGreaterThan(1e-3);         // positive control: an offset-point mm value is NOT ∝ scale
    expect(moved).toEqual([]);
  });
});
