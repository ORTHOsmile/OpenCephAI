import { describe, it, expect } from 'vitest';
import { autoBestGhost, mergeAutoBestOverlap, withAutoBest } from './autoBestGhost';
import type { AutoBestMap, ModelPoints, ModelPointRow } from '../ipc';
const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', GU = 'gu2net-isbi19';
const run = (modelId: string, pts: [string, number][]): ModelPoints => ({ modelId, ranAt: 'x', facing: 'right',
  points: pts.map(([id, x], i) => ({ channel: i, landmarkId: id, x, y: 1, peak: 0.9 })) });
const row = (modelId: string, main: boolean): ModelPointRow => ({ modelId, title: modelId, main, points: ['Go', 'S', 'B'].map((id) => ({ id, status: { kind: 'original' } })) });
const map = (o: Partial<AutoBestMap> = {}): AutoBestMap => ({ available: true, on: false, base: AZ, uses: { Go: SR }, notes: {}, kept: {}, latest: [], ...o });
const src = { ruleVersion: 'x', confirmationPending: false, points: { Go: AZ, S: AZ, B: AZ }, ownerChoices: { B: GU } };
const stored = [run(AZ, [['Go', 10], ['S', 20], ['B', 30]]), run(SR, [['Go', 11], ['S', 21], ['B', 31]]), run(GU, [['Go', 12], ['S', 22], ['B', 32]])];
const t = (main: string) => [row(main, true), ...[AZ, SR, GU].filter((m) => m !== main).map((m) => row(m, false))];
describe('the Automatic best ghost (spec §4; Q1, Q2)', () => {
  it('beside Aariz: the evidence at Go, Aariz elsewhere; your Part F switch at B is not used (Q1)', () => {
    const g = autoBestGhost(stored, AZ, map(), t(AZ), src, (m) => m)!;
    expect([g.modelId, g.title, g.points.Go.x, g.points.S.x, g.points.B.x]).toEqual(['auto-best', 'Automatic best', 11, 20, 30]);
    expect([g.titles!.Go, g.titles!.S]).toEqual(['Automatic best · SRPose', 'Automatic best · Aariz']);
  });
  it('beside GU2Net (owner answer 2 of 29 Oct): the evidence at Go, the base (Aariz) elsewhere', () => {
    const g = autoBestGhost(stored, GU, map(), t(GU), src, (m) => m)!;
    expect([g.points.Go.x, g.points.S.x, g.points.B.x, g.titles!.S]).toEqual([11, 20, 30, 'Automatic best · Aariz']);
  });
  it('beside a fixed main model, points without evidence come from the base (owner answer 2)', () => {
    const g = autoBestGhost(stored, AZ, map({ base: GU, uses: {} }), t(AZ), src, (m) => m)!;
    expect([g.points.B.x, g.points.S.x, g.titles!.B]).toEqual([32, 22, 'Automatic best · GU2Net']);
  });
  it('no ghost when the base did not run on this film, or its run has no points', () => {
    expect(autoBestGhost([run(AZ, [['B', 1]])], AZ, map({ base: GU, uses: {} }), t(AZ), src, (m) => m)).toBeNull();
    expect(autoBestGhost([run(AZ, [['B', 1]]), run(GU, [])], AZ, map({ base: GU, uses: {} }), t(AZ), src, (m) => m)).toBeNull();
  });
  it('none while it is main, without Aariz, without the map, without a fixed main, or without the main run', () => {
    for (const g of [autoBestGhost(stored, AZ, map({ on: true }), t(AZ), src, (m) => m), autoBestGhost(stored, AZ, map({ available: false }), t(AZ), src, (m) => m),
      autoBestGhost(stored, AZ, null, t(AZ), src, (m) => m), autoBestGhost(stored, null, map(), t(AZ), src, (m) => m),
      autoBestGhost([run(SR, [['Go', 11]])], AZ, map(), t(AZ), src, (m) => m)]) expect(g).toBeNull();
  });
  it('the favoured model gave no point here: the main model’s mark, titled so', () => {
    const g = autoBestGhost([run(AZ, [['Go', 10]]), run(GU, [['Go', 12]])], AZ, map(), t(AZ), src, (m) => m)!;
    expect([g.points.Go.x, g.titles!.Go]).toEqual([10, 'Automatic best · Aariz']);
  });
  it('listed first, shades alternating; nothing to add leaves the list as it was', () => {
    const others = [{ modelId: SR, title: 'SRPose', shade: 1 as const, points: {} }, { modelId: GU, title: 'GU2Net', shade: 2 as const, points: {} }];
    const g = { modelId: 'auto-best', title: 'Automatic best', shade: 1 as const, points: {} };
    expect(withAutoBest(others, g).map((x) => [x.modelId, x.shade])).toEqual([['auto-best', 1], [SR, 2], [GU, 1]]);
    expect(withAutoBest(others, null)).toBe(others);
  });
});

describe('mergeAutoBestOverlap ("one mark, both names", owner 28 Oct)', () => {
  const auto = { modelId: 'auto-best', title: 'Automatic best', shade: 1 as const,
    points: { Go: { x: 11, y: 1 }, S: { x: 20, y: 1 } }, titles: { Go: 'Automatic best · SRPose', S: 'Automatic best · Aariz' } };
  const srGhost = { modelId: SR, title: 'SRPose', shade: 2 as const, points: { Go: { x: 11, y: 1 }, B: { x: 31, y: 1 } } };
  it('a coinciding point: one mark (Automatic best drops its own; the source ghost carries both names)', () => {
    const out = mergeAutoBestOverlap([auto, srGhost]);
    const a = out.find((g) => g.modelId === 'auto-best')!, sr = out.find((g) => g.modelId === SR)!;
    expect(a.points.Go).toBeUndefined();                       // no second mark at Go
    expect(a.points.S).toEqual({ x: 20, y: 1 });                // the non-coinciding point is untouched
    expect(sr.points.Go).toEqual({ x: 11, y: 1 });               // SRPose's own mark still stands
    expect(sr.titles!.Go).toBe('SRPose (Automatic best uses this)');
    expect(sr.titles!.B).toBeUndefined();                        // B never had a title; merge did not invent one
  });
  it("the source model's ghost hidden (not in the list): Automatic best's own point and title stand alone", () => {
    const out = mergeAutoBestOverlap([auto]);
    const a = out.find((g) => g.modelId === 'auto-best')!;
    expect(a.points.Go).toEqual({ x: 11, y: 1 });
    expect(a.titles!.Go).toBe('Automatic best · SRPose');
  });
  it('no Automatic best ghost in the list: returns the list unchanged (control: nothing to merge)', () => {
    const list = [srGhost];
    expect(mergeAutoBestOverlap(list)).toBe(list);
  });
  it('a model present but NOT at the same pixel: no merge, both marks stand', () => {
    const elsewhere = { modelId: SR, title: 'SRPose', shade: 2 as const, points: { Go: { x: 999, y: 1 } } };
    const out = mergeAutoBestOverlap([auto, elsewhere]);
    const a = out.find((g) => g.modelId === 'auto-best')!, sr = out.find((g) => g.modelId === SR)!;
    expect(a.points.Go).toEqual({ x: 11, y: 1 });
    expect(sr.titles).toBeUndefined();
  });
});
