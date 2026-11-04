import { describe, it, expect } from 'vitest';
import { compile } from '@ceph/geometry';
import { buildRegistry } from './registry';
import { SYNTHETIC_SKULLS } from './fixtures';
import { ang, meet, sub } from './oracle';
import { LINES } from './lines';
import { LANDMARKS } from './landmarks';
import { catalogueNodes } from './catalogue';

const skull = SYNTHETIC_SKULLS[0].points;
const g = compile(buildRegistry([]));
const mmPerPx = 0.1;

describe('LINES catalogue (Part A task 3)', () => {
  it('compiles alone: LINES by itself has no graph errors', () => {
    expect(() => compile(buildRegistry([]))).not.toThrow();
  });

  it('GoC equals meet(Ar, RT, Tg, Me)', () => {
    const v = g.evaluate(skull, mmPerPx).GoC as { t: 'point'; v: { x: number; y: number } };
    const want = meet(skull.Ar, skull.RT, skull.Tg, skull.Me);
    expect(v.v.x).toBeCloseTo(want.x, 9);
    expect(v.v.y).toBeCloseTo(want.y, 9);
  });

  it('GncR equals meet(N, Pog, Tg, Me)', () => {
    const v = g.evaluate(skull, mmPerPx).GncR as { t: 'point'; v: { x: number; y: number } };
    const want = meet(skull.N, skull.Pog, skull.Tg, skull.Me);
    expect(v.v.x).toBeCloseTo(want.x, 9);
    expect(v.v.y).toBeCloseTo(want.y, 9);
  });

  it('GncM equals meet(N, Pog, Go, Me)', () => {
    const v = g.evaluate(skull, mmPerPx).GncM as { t: 'point'; v: { x: number; y: number } };
    const want = meet(skull.N, skull.Pog, skull.Go, skull.Me);
    expect(v.v.x).toBeCloseTo(want.x, 9);
    expect(v.v.y).toBeCloseTo(want.y, 9);
  });

  it('Xi matches the hand formula, u = unit(Or − Po)', () => {
    const v = g.evaluate(skull, mmPerPx).Xi as { t: 'point'; v: { x: number; y: number } };
    // Xi (Ricketts 1981 p.131): bisects the vertical height and the horizontal depth of the ramus.
    const d = sub(skull.Or, skull.Po), L = Math.hypot(d.x, d.y);
    const u = { x: d.x / L, y: d.y / L }, w = { x: -u.y, y: u.x };
    const dot = (a: typeof u, b: typeof u) => a.x * b.x + a.y * b.y;
    const a = (dot(skull.R1, u) + dot(skull.R2, u)) / 2;
    const b = (dot(skull.R3, w) + dot(skull.R4, w)) / 2;
    const want = { x: u.x * a + w.x * b, y: u.y * a + w.y * b };
    expect(v.v.x).toBeCloseTo(want.x, 9);
    expect(v.v.y).toBeCloseTo(want.y, 9);
  });

  it('edge: Nperp direction has a positive y — guards the "points down" convention', () => {
    const v = g.evaluate(skull, mmPerPx).Nperp as { t: 'line'; v: { d: { x: number; y: number } } };
    expect(v.v.d.y).toBeGreaterThan(0);
  });

  it('Kim sign: PalKim is positive with ANS moved down, negative with ANS moved up (Kim 1974 p.590); magnitude matches ang(ANS−PNS, Or−Po) in both', () => {
    const down: typeof skull = { ...skull, ANS: { x: skull.ANS.x, y: skull.ANS.y + 40 } };
    const up: typeof skull = { ...skull, ANS: { x: skull.ANS.x, y: skull.ANS.y - 40 } };
    const vDown = g.evaluate(down, mmPerPx).PalKim as { t: 'scalar'; v: number };
    const vUp = g.evaluate(up, mmPerPx).PalKim as { t: 'scalar'; v: number };
    expect(vDown.v).toBeGreaterThan(0);
    expect(vUp.v).toBeLessThan(0);
    const angDown = ang(sub(down.ANS, down.PNS), sub(down.Or, down.Po));
    const angUp = ang(sub(up.ANS, up.PNS), sub(up.Or, up.Po));
    expect(Math.abs(vDown.v)).toBeCloseTo(angDown, 9);
    expect(Math.abs(vUp.v)).toBeCloseTo(angUp, 9);
  });

  // Shadowing guard (final-review item 5): `buildRegistry` spreads `{...LINES, ...catalogueNodes()}`
  // with no duplicate-key check between the two, unlike the check it runs for each analysis's own
  // nodes. A catalogue entry (or a future LINES edit) that reuses a key silently shadows the other
  // definition instead of throwing. These two tests close that gap.
  describe('shadowing guard', () => {
    it('positive control: a planted LINES/landmark collision is caught', () => {
      const plantedLines: Record<string, unknown> = { ...LINES, N: { kind: 'line', a: 'S', b: 'A' } };
      const offenders = Object.keys(LANDMARKS).filter((id) => {
        const node = plantedLines[id] as { kind: string; id?: string } | undefined;
        return !(node && node.kind === 'landmark' && node.id === id);
      });
      expect(offenders).toEqual(['N']);
    });

    it('no LINES key that is also a LANDMARKS id is anything other than that landmark\'s own node', () => {
      const offenders = Object.keys(LANDMARKS).filter((id) => {
        const node = (LINES as Record<string, { kind: string; id?: string }>)[id];
        return !(node && node.kind === 'landmark' && node.id === id);
      });
      expect(offenders).toEqual([]);
    });

    it('positive control: a planted catalogue-node/LINES collision is caught', () => {
      const plantedCatalogueIds = new Set([...Object.keys(catalogueNodes()), 'FH']);
      const offenders = [...plantedCatalogueIds].filter((id) => id in LINES);
      expect(offenders).toEqual(['FH']);
    });

    it('no catalogue node id equals a LINES key', () => {
      const offenders = Object.keys(catalogueNodes()).filter((id) => id in LINES);
      expect(offenders).toEqual([]);
    });
  });
});
