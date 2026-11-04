import { describe, it, expect } from 'vitest';
import { compile } from '@ceph/geometry';
import type { Vec2 } from '@ceph/geometry';
import { LINES } from './lines';
import { SYNTHETIC_SKULLS } from './fixtures';
import { ISBI19 } from './landmarks';
import { VERTICAL } from './catalogue/vertical';
import { ang, angAt, dist, meet, sub } from './oracle';

const nodesOf = (entries: typeof VERTICAL) => Object.assign({}, ...entries.map((e) => e.nodes));
const registry = { ...LINES, ...nodesOf(VERTICAL) };
const g = compile(registry);
const mmPerPx = 0.1;

const sc = (ev: Record<string, unknown>, id: string) => (ev[id] as { v: number }).v;

/** Kim's palatal-plane-to-FH angle, signed (same oracle as catalogue-ap.test.ts, #27 reuses it). */
const palSigned = (p: Record<string, Vec2>) => {
  const toward = sub(p.Or, p.Po);
  const b2 = { x: p.PNS.x + toward.x, y: p.PNS.y + toward.y };
  const sgn = (n: number) => Math.sign(n) || 1;
  const sdist = (q: Vec2, a: Vec2, b: Vec2, dir: Vec2) => {
    const d = sub(b, a), n = { x: -d.y, y: d.x }, L = Math.hypot(d.x, d.y);
    const s = ((q.x - a.x) * n.x + (q.y - a.y) * n.y) / L;
    const side = Math.sign(n.x * dir.x + n.y * dir.y) || 1;
    return s * side;
  };
  return sgn(sdist(p.ANS, p.PNS, b2, { x: 0, y: 1 })) * ang(sub(p.ANS, p.PNS), toward);
};

const xiOf = (p: Record<string, Vec2>): Vec2 => {
  const d = sub(p.Or, p.Po), L = Math.hypot(d.x, d.y), u = { x: d.x / L, y: d.y / L }, w = { x: -u.y, y: u.x };
  const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
  const a = (dot(p.R1, u) + dot(p.R2, u)) / 2, b = (dot(p.R3, w) + dot(p.R4, w)) / 2;
  return { x: u.x * a + w.x * b, y: u.y * a + w.y * b };
};
const goCOf = (p: Record<string, Vec2>): Vec2 => meet(p.Ar, p.RT, p.Tg, p.Me);

describe('vertical and jaw-shape catalogue (#20-44, #90-92, Part A task 5)', () => {
  it('compiles together with LINES, no graph errors', () => {
    expect(() => compile({ ...LINES, ...nodesOf(VERTICAL) })).not.toThrow();
  });

  it('every id, no and source mark is present and unique', () => {
    const ids = VERTICAL.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of VERTICAL) {
      expect(e.id).toMatch(/^m\d{2}[a-z]?_/);
      expect(['P', 'T', 'S', 'W']).toContain(e.source.mark);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  // --- #20 SN-GoGn ---
  describe('m20_SNGoGn', () => {
    it('oracle: equals ang(N-S, Gn-Go) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm20_SNGoGn')).toBeCloseTo(ang(sub(p.N, p.S), sub(p.Gn, p.Go)), 9);
      }
    });
    it('behaviour: skull 3 (long face) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm20_SNGoGn');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm20_SNGoGn');
      expect(v3).toBeGreaterThan(v0);
    });
    it('missing point: without N, SN-GoGn is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m20_SNGoGn).toBeNull();
    });
  });

  // --- #21 SN-GoMe ---
  describe('m21_SNGoMe', () => {
    it('oracle: equals ang(N-S, Me-Go) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm21_SNGoMe')).toBeCloseTo(ang(sub(p.N, p.S), sub(p.Me, p.Go)), 9);
      }
    });
    it('behaviour: skull 3 (long face) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm21_SNGoMe');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm21_SNGoMe');
      expect(v3).toBeGreaterThan(v0);
    });
    it('missing point: without N, SN-GoMe is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m21_SNGoMe).toBeNull();
    });
  });

  // --- #22 FH-MP tangent (FMA) ---
  describe('m22_FHMPt', () => {
    it('oracle: equals ang(Or-Po, Me-Tg) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm22_FHMPt')).toBeCloseTo(ang(sub(p.Or, p.Po), sub(p.Me, p.Tg)), 9);
      }
    });
    it('behaviour: Tg up 80 px -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm22_FHMPt');
      const v1 = sc(g.evaluate({ ...p, Tg: { x: p.Tg.x, y: p.Tg.y - 80 } }, mmPerPx), 'm22_FHMPt');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Tg (not in ISBI19), FH-MP tangent is null', () => {
      const { Tg: _tg, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m22_FHMPt).toBeNull();
    });
  });

  // --- #23 FH-GoMe ---
  describe('m23_FHGoMe', () => {
    it('oracle: equals ang(Or-Po, Me-Go) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm23_FHGoMe')).toBeCloseTo(ang(sub(p.Or, p.Po), sub(p.Me, p.Go)), 9);
      }
    });
    it('behaviour: skull 3 (long face) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm23_FHGoMe');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm23_FHGoMe');
      expect(v3).toBeGreaterThan(v0);
    });
    it('missing point: without Go, FH-GoMe is null', () => {
      const { Go: _go, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m23_FHGoMe).toBeNull();
    });
  });

  // --- #24 Y-axis ---
  describe('m24_YAxis', () => {
    it('oracle: equals ang(Or-Po, Gn-S) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm24_YAxis')).toBeCloseTo(ang(sub(p.Or, p.Po), sub(p.Gn, p.S)), 9);
      }
    });
    it('behaviour: skull 3 (long face) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm24_YAxis');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm24_YAxis');
      expect(v3).toBeGreaterThan(v0);
    });
    it('missing point: without S, Y-axis is null', () => {
      const { S: _s, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m24_YAxis).toBeNull();
    });
  });

  // --- #25 MMPA ---
  describe('m25_MMPA', () => {
    it('oracle: equals ang(ANS-PNS, Me-Go) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm25_MMPA')).toBeCloseTo(ang(sub(p.ANS, p.PNS), sub(p.Me, p.Go)), 9);
      }
    });
    it('behaviour: skull 3 (long face) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm25_MMPA');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm25_MMPA');
      expect(v3).toBeGreaterThan(v0);
    });
    it('missing point: without PNS, MMPA is null', () => {
      const { PNS: _pns, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m25_MMPA).toBeNull();
    });
  });

  // --- #26 SN-MxP ---
  // Fix round 1 (after review): the naive `angleLines SN, MxP` gets LARGER when ANS
  // tips down (5.74 -> 10.5 on the balanced skull, both clinically plausible SN-palatal-plane
  // angles). An earlier pass read the brief's "ANS down -> smaller" literally and reversed MxP to
  // get a supplement (174.3 -> 169.5) that technically shrinks, but 174.3 degrees is not a real
  // SN-MxP angle for any skull — it's the OTHER angle at the SN/palatal-plane crossing. The
  // ruling: the brief's behaviour test was the defect, not the expression. Reverted to
  // plain `MxP` and the test below to the geometrically real direction: ANS down (+y) genuinely
  // opens the SN-to-palatal-plane angle, so it increases.
  describe('m26_SNMxP', () => {
    it('oracle: equals ang(N-S, ANS-PNS) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm26_SNMxP')).toBeCloseTo(ang(sub(p.N, p.S), sub(p.ANS, p.PNS)), 9);
      }
    });
    it('behaviour: ANS +40 px y -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm26_SNMxP');
      const v1 = sc(g.evaluate({ ...p, ANS: { x: p.ANS.x, y: p.ANS.y + 40 } }, mmPerPx), 'm26_SNMxP');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without ANS, SN-MxP is null', () => {
      const { ANS: _ans, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m26_SNMxP).toBeNull();
    });
  });

  // --- #27 Palatal plane to FH (alias PalKim) ---
  describe('m27_PalFH', () => {
    it('oracle: equals PalKim (Kim-signed palatal angle) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm27_PalFH')).toBeCloseTo(palSigned(p), 9);
      }
    });
    it('behaviour: ANS +40 px y (front down) -> positive; ANS -40 px y (up and forward) -> negative (Kim 1974 p.590)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const down = sc(g.evaluate({ ...p, ANS: { x: p.ANS.x, y: p.ANS.y + 40 } }, mmPerPx), 'm27_PalFH');
      const up = sc(g.evaluate({ ...p, ANS: { x: p.ANS.x, y: p.ANS.y - 40 } }, mmPerPx), 'm27_PalFH');
      expect(down).toBeGreaterThan(0);
      expect(up).toBeLessThan(0);
    });
    it('missing point: without PNS, palatal plane to FH is null', () => {
      const { PNS: _pns, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m27_PalFH).toBeNull();
    });
  });

  // --- #28 LAFH ---
  describe('m28_LAFH', () => {
    it('oracle: equals dist(ANS,Me) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm28_LAFH')).toBeCloseTo(dist(p.ANS, p.Me) * 0.1, 9);
      }
    });
    it('behaviour: skull 3 (long face) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm28_LAFH');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm28_LAFH');
      expect(v3).toBeGreaterThan(v0);
    });
    it('missing point: without ANS, LAFH is null', () => {
      const { ANS: _ans, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m28_LAFH).toBeNull();
    });
  });

  // --- #29 LAFH % ---
  describe('m29_LAFHpct', () => {
    it('oracle: equals dist(ANS,Me) / dist(N,Me) * 100 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm29_LAFHpct')).toBeCloseTo((dist(p.ANS, p.Me) / dist(p.N, p.Me)) * 100, 9);
      }
    });
    it('behaviour: skull 3 (long face) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm29_LAFHpct');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm29_LAFHpct');
      expect(v3).toBeGreaterThan(v0);
    });
    it('missing point: without ANS, LAFH % is null', () => {
      const { ANS: _ans, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m29_LAFHpct).toBeNull();
    });
  });

  // --- #30 Facial axis, Ricketts ---
  describe('m30_FacAxisR', () => {
    it('oracle: equals ang(Ba-N, GncR-Pt) (GncR = meet(N,Pog,Tg,Me)) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const GncR = meet(p.N, p.Pog, p.Tg, p.Me);
        expect(sc(v, 'm30_FacAxisR')).toBeCloseTo(ang(sub(p.Ba, p.N), sub(GncR, p.Pt)), 9);
      }
    });
    it('behaviour: Pog/Gn/Me/B +40 px x (chin forward) -> larger (Ricketts 1981 p.123)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm30_FacAxisR');
      const moved = {
        ...p,
        Pog: { x: p.Pog.x + 40, y: p.Pog.y }, Gn: { x: p.Gn.x + 40, y: p.Gn.y },
        Me: { x: p.Me.x + 40, y: p.Me.y }, B: { x: p.B.x + 40, y: p.B.y },
      };
      const v1 = sc(g.evaluate(moved, mmPerPx), 'm30_FacAxisR');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Tg (not in ISBI19), facial axis (Ricketts) is null', () => {
      const { Tg: _tg, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m30_FacAxisR).toBeNull();
    });
  });

  // --- #31 Facial axis, McNamara ---
  describe('m31_FacAxisM', () => {
    // Owner ruling 7 Oct 2026: the angle where the Ba-N line crosses the PTM-GncM facial axis (McNamara 1984
    // p.460: "A perpendicular relationship of the basion-nasion line and the facial axis is to be expected";
    // "the facial axis angle of Ricketts", p.459), not the bracketed corner-at-PTM angle Ba-PTM-Gn.
    it('oracle: equals the angle between rays N->Ba and PTM->GncM (GncM = meet(N,Pog,Go,Me)) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const GncM = meet(p.N, p.Pog, p.Go, p.Me);
        expect(sc(v, 'm31_FacAxisM')).toBeCloseTo(ang(sub(p.Ba, p.N), sub(GncM, p.PTM)), 9);
      }
    });
    it('lines crossing, not a corner at PTM: sliding PTM along the facial axis leaves the value unchanged', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const GncM = meet(p.N, p.Pog, p.Go, p.Me);
      const slid: typeof p = { ...p, PTM: { x: p.PTM.x + 0.3 * (GncM.x - p.PTM.x), y: p.PTM.y + 0.3 * (GncM.y - p.PTM.y) } };
      const v0 = sc(g.evaluate(p, mmPerPx), 'm31_FacAxisM');
      expect(sc(g.evaluate(slid, mmPerPx), 'm31_FacAxisM')).toBeCloseTo(v0, 9);
      // control: the corner-at-PTM angle does move under the same slide, so this test can tell the two apart
      expect(Math.abs(angAt(slid.Ba, slid.PTM, GncM) - angAt(p.Ba, p.PTM, GncM))).toBeGreaterThan(1);
    });
    it('behaviour: short face reads higher, long face lower ("deficient vertical development ... values greater than 90", McNamara 1984 p.460)', () => {
      const at = (name: string) => sc(g.evaluate(SYNTHETIC_SKULLS.find((s) => s.name.includes(name))!.points, mmPerPx), 'm31_FacAxisM');
      expect(at('short face')).toBeGreaterThan(at('balanced'));
      expect(at('long face')).toBeLessThan(at('balanced'));
    });
    it('behaviour: Pog/Gn/Me/B +40 px x (chin forward) -> larger (McNamara 1984 p.460)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm31_FacAxisM');
      const moved = {
        ...p,
        Pog: { x: p.Pog.x + 40, y: p.Pog.y }, Gn: { x: p.Gn.x + 40, y: p.Gn.y },
        Me: { x: p.Me.x + 40, y: p.Me.y }, B: { x: p.B.x + 40, y: p.B.y },
      };
      const v1 = sc(g.evaluate(moved, mmPerPx), 'm31_FacAxisM');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without PTM (not in ISBI19), facial axis (McNamara) is null', () => {
      const { PTM: _ptm, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m31_FacAxisM).toBeNull();
    });
  });

  // --- #32 Oral gnomon ---
  // The brief's "skull 3 > skull 0" does not hold here: skull 3 (long face) only shifts
  // Me/Gn/Pog/B, and none of ANS, Xi (R1-R4, Or, Po) or Pm move, so the value is IDENTICAL on
  // skull 0 and skull 3 (verified: 50.083... both times). A direction fix cannot repair a
  // behaviour test whose chosen fixture never touches the entry's points, so per "Decisions for
  // you" this uses a single-point move instead: Pm (chin point) down 40 px (lower face taller).
  describe('m32_OralGnomon', () => {
    it('oracle: equals angAt(ANS, Xi, Pm) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm32_OralGnomon')).toBeCloseTo(angAt(p.ANS, xiOf(p), p.Pm), 9);
      }
    });
    it('behaviour: Pm +40 px y (lower face taller) -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm32_OralGnomon');
      const v1 = sc(g.evaluate({ ...p, Pm: { x: p.Pm.x, y: p.Pm.y + 40 } }, mmPerPx), 'm32_OralGnomon');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Pm (not in ISBI19), oral gnomon is null', () => {
      const { Pm: _pm, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m32_OralGnomon).toBeNull();
    });
  });

  // --- #33 Mandibular bend ---
  describe('m33_MandBend', () => {
    it('oracle: equals ang(Xi-Pm, DC-Xi) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const xi = xiOf(p);
        expect(sc(v, 'm33_MandBend')).toBeCloseTo(ang(sub(xi, p.Pm), sub(p.DC, xi)), 9);
      }
    });
    it('behaviour: DC +40 px x -> changes (oracle only, no stated direction)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm33_MandBend');
      const v1 = sc(g.evaluate({ ...p, DC: { x: p.DC.x + 40, y: p.DC.y } }, mmPerPx), 'm33_MandBend');
      expect(v1).not.toBeCloseTo(v0, 6);
    });
    it('missing point: without DC (not in ISBI19), mandibular bend is null', () => {
      const { DC: _dc, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m33_MandBend).toBeNull();
    });
  });

  // --- #34 Saddle angle --- (brief gives no direction; single-point move chosen here)
  describe('m34_Saddle', () => {
    it('oracle: equals angAt(N,S,Ar) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm34_Saddle')).toBeCloseTo(angAt(p.N, p.S, p.Ar), 9);
      }
    });
    it('behaviour: Ar 100 px up -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm34_Saddle');
      const v1 = sc(g.evaluate({ ...p, Ar: { x: p.Ar.x, y: p.Ar.y - 100 } }, mmPerPx), 'm34_Saddle');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Ar, saddle angle is null', () => {
      const { Ar: _ar, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m34_Saddle).toBeNull();
    });
  });

  // --- #35 Articular angle --- (brief gives no direction; single-point move chosen here)
  describe('m35_Articular', () => {
    it('oracle: equals angAt(S,Ar,Go) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm35_Articular')).toBeCloseTo(angAt(p.S, p.Ar, p.Go), 9);
      }
    });
    it('behaviour: Go 150 px down -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm35_Articular');
      const v1 = sc(g.evaluate({ ...p, Go: { x: p.Go.x, y: p.Go.y + 150 } }, mmPerPx), 'm35_Articular');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Ar, articular angle is null', () => {
      const { Ar: _ar, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m35_Articular).toBeNull();
    });
  });

  // --- #36 Gonial angle --- (brief gives no direction; single-point move chosen here)
  describe('m36_Gonial', () => {
    it('oracle: equals angAt(Ar,Go,Me) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm36_Gonial')).toBeCloseTo(angAt(p.Ar, p.Go, p.Me), 9);
      }
    });
    it('behaviour: Me 60 px down (steeper mandibular plane) -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm36_Gonial');
      const v1 = sc(g.evaluate({ ...p, Me: { x: p.Me.x, y: p.Me.y + 60 } }, mmPerPx), 'm36_Gonial');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Ar, gonial angle is null', () => {
      const { Ar: _ar, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m36_Gonial).toBeNull();
    });
  });

  // --- #37 Upper gonial angle --- (brief gives no direction; single-point move chosen here)
  describe('m37_UpperGonial', () => {
    it('oracle: equals angAt(Ar,Go,N) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm37_UpperGonial')).toBeCloseTo(angAt(p.Ar, p.Go, p.N), 9);
      }
    });
    it('behaviour: Go 100 px down -> smaller', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm37_UpperGonial');
      const v1 = sc(g.evaluate({ ...p, Go: { x: p.Go.x, y: p.Go.y + 100 } }, mmPerPx), 'm37_UpperGonial');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without Ar, upper gonial angle is null', () => {
      const { Ar: _ar, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m37_UpperGonial).toBeNull();
    });
  });

  // --- #38 Lower gonial angle --- (brief gives no direction; single-point move chosen here)
  describe('m38_LowerGonial', () => {
    it('oracle: equals angAt(N,Go,Me) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm38_LowerGonial')).toBeCloseTo(angAt(p.N, p.Go, p.Me), 9);
      }
    });
    it('behaviour: Me 60 px down (steeper mandibular plane) -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm38_LowerGonial');
      const v1 = sc(g.evaluate({ ...p, Me: { x: p.Me.x, y: p.Me.y + 60 } }, mmPerPx), 'm38_LowerGonial');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Go, lower gonial angle is null', () => {
      const { Go: _go, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m38_LowerGonial).toBeNull();
    });
  });

  // --- m37 + m38 = m36, when N lies inside angle Ar-Go-Me (the "Decisions for you" check) ---
  it('m37_UpperGonial + m38_LowerGonial = m36_Gonial on skull 0, where N lies inside angle Ar-Go-Me', () => {
    const p = SYNTHETIC_SKULLS[0].points;
    // "N inside the angle at Go" <=> angle(Ar,Go,N) + angle(N,Go,Me) == angle(Ar,Go,Me) (not >, which
    // would mean N is outside the wedge and the two sub-angles overshoot the whole).
    const upper = angAt(p.Ar, p.Go, p.N), lower = angAt(p.N, p.Go, p.Me), whole = angAt(p.Ar, p.Go, p.Me);
    expect(upper + lower).toBeCloseTo(whole, 9); // confirms N is inside the angle on this skull
    const v = g.evaluate(p, mmPerPx);
    expect(sc(v, 'm37_UpperGonial') + sc(v, 'm38_LowerGonial')).toBeCloseTo(sc(v, 'm36_Gonial'), 9);
  });

  // --- #39 Sum of angles ---
  describe('m39_SumAngles', () => {
    it('oracle: equals Saddle + Articular + Gonial on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const want = angAt(p.N, p.S, p.Ar) + angAt(p.S, p.Ar, p.Go) + angAt(p.Ar, p.Go, p.Me);
        expect(sc(v, 'm39_SumAngles')).toBeCloseTo(want, 9);
      }
    });
    it('behaviour: moves with its parts (Me 60 px down -> larger, as m36 increases)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm39_SumAngles');
      const v1 = sc(g.evaluate({ ...p, Me: { x: p.Me.x, y: p.Me.y + 60 } }, mmPerPx), 'm39_SumAngles');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Ar, sum of angles is null', () => {
      const { Ar: _ar, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m39_SumAngles).toBeNull();
    });
  });

  // --- #40 Posterior face height S-Go ---
  describe('m40_SGo', () => {
    it('oracle: equals dist(S,Go) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm40_SGo')).toBeCloseTo(dist(p.S, p.Go) * 0.1, 9);
      }
    });
    it('behaviour: Go 60 px right -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm40_SGo');
      const v1 = sc(g.evaluate({ ...p, Go: { x: p.Go.x + 60, y: p.Go.y } }, mmPerPx), 'm40_SGo');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Go, posterior face height is null', () => {
      const { Go: _go, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m40_SGo).toBeNull();
    });
  });

  // --- #41 Anterior face height N-Me ---
  describe('m41_NMe', () => {
    it('oracle: equals dist(N,Me) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm41_NMe')).toBeCloseTo(dist(p.N, p.Me) * 0.1, 9);
      }
    });
    it('behaviour: Me 60 px down -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm41_NMe');
      const v1 = sc(g.evaluate({ ...p, Me: { x: p.Me.x, y: p.Me.y + 60 } }, mmPerPx), 'm41_NMe');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Me, anterior face height is null', () => {
      const { Me: _me, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m41_NMe).toBeNull();
    });
    it('shares geometry with m29_NMe (same distance, separate node)', () => {
      const v = g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx);
      expect(sc(v, 'm41_NMe')).toBeCloseTo(sc(v, 'm29_NMe'), 9);
    });
  });

  // --- #42 Jarabak ratio ---
  describe('m42_Jarabak', () => {
    it('oracle: equals dist(S,Go) / dist(N,Me) * 100 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm42_Jarabak')).toBeCloseTo((dist(p.S, p.Go) / dist(p.N, p.Me)) * 100, 9);
      }
    });
    it('behaviour: skull 3 (long face) < skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm42_Jarabak');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm42_Jarabak');
      expect(v3).toBeLessThan(v0);
    });
    it('missing point: without Go, Jarabak ratio is null', () => {
      const { Go: _go, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m42_Jarabak).toBeNull();
    });
  });

  // --- #43 Cranial base to body --- (brief gives no direction; single-point move chosen here)
  describe('m43_SNtoGoMe', () => {
    it('oracle: equals dist(S,N) / dist(Go,Me) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm43_SNtoGoMe')).toBeCloseTo(dist(p.S, p.N) / dist(p.Go, p.Me), 9);
      }
    });
    it('behaviour: N 60 px right (S-N longer) -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm43_SNtoGoMe');
      const v1 = sc(g.evaluate({ ...p, N: { x: p.N.x + 60, y: p.N.y } }, mmPerPx), 'm43_SNtoGoMe');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without N, cranial base to body is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m43_SNtoGoMe).toBeNull();
    });
  });

  // --- #44 Posterior cranial base to ramus --- (brief gives no direction; single-point move chosen here)
  describe('m44_ArStoArGo', () => {
    it('oracle: equals dist(Ar,S) / dist(Ar,Go) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm44_ArStoArGo')).toBeCloseTo(dist(p.Ar, p.S) / dist(p.Ar, p.Go), 9);
      }
    });
    it('behaviour: Ar 100 px up (Ar-S shorter) -> smaller', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm44_ArStoArGo');
      const v1 = sc(g.evaluate({ ...p, Ar: { x: p.Ar.x, y: p.Ar.y - 100 } }, mmPerPx), 'm44_ArStoArGo');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without Ar, posterior cranial base to ramus is null', () => {
      const { Ar: _ar, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m44_ArStoArGo).toBeNull();
    });
  });

  // --- #90 SN-MP, ABO ---
  describe('m90_SNMP_ABO', () => {
    it('oracle: equals ang(N-S, Me-GoC) (GoC = meet(Ar,RT,Tg,Me)) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const GoC = goCOf(p);
        expect(sc(v, 'm90_SNMP_ABO')).toBeCloseTo(ang(sub(p.N, p.S), sub(p.Me, GoC)), 9);
      }
    });
    it('behaviour: skull 3 (long face) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm90_SNMP_ABO');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm90_SNMP_ABO');
      expect(v3).toBeGreaterThan(v0);
    });
    it('missing point: without RT (not in ISBI19), SN-MP ABO is null', () => {
      const { RT: _rt, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m90_SNMP_ABO).toBeNull();
    });
  });

  // --- #91 FMA, ABO ---
  describe('m91_FMA_ABO', () => {
    it('oracle: equals ang(Or-Po, Me-GoC) (GoC = meet(Ar,RT,Tg,Me)) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const GoC = goCOf(p);
        expect(sc(v, 'm91_FMA_ABO')).toBeCloseTo(ang(sub(p.Or, p.Po), sub(p.Me, GoC)), 9);
      }
    });
    it('behaviour: skull 3 (long face) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm91_FMA_ABO');
      const v3 = sc(g.evaluate(SYNTHETIC_SKULLS[3].points, mmPerPx), 'm91_FMA_ABO');
      expect(v3).toBeGreaterThan(v0);
    });
    it('missing point: without RT (not in ISBI19), FMA ABO is null', () => {
      const { RT: _rt, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m91_FMA_ABO).toBeNull();
    });
  });

  // --- #92 L1-MP, ABO ---
  // Checked for an orientation problem the same way as #26: `angleLines MeGoC, L1ax` already
  // grows on the proclined skull (101.3 -> 108.2, using MeGoC's real direction GoC-Me per
  // `line(a,b)` = b-a), so no fix is needed here — unlike an earlier hand-check that computed
  // MeGoC backwards (Me-GoC) and so saw the opposite, supplementary swing.
  describe('m92_L1MP_ABO', () => {
    it('oracle: equals ang(GoC-Me, L1T-L1A) (GoC = meet(Ar,RT,Tg,Me)) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const GoC = goCOf(p);
        expect(sc(v, 'm92_L1MP_ABO')).toBeCloseTo(ang(sub(GoC, p.Me), sub(p.L1T, p.L1A)), 9);
      }
    });
    it('behaviour: proclined skull (skull 5) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm92_L1MP_ABO');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm92_L1MP_ABO');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without RT (not in ISBI19), L1-MP ABO is null', () => {
      const { RT: _rt, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m92_L1MP_ABO).toBeNull();
    });
  });

  it('the catalogue covers every landmark it requires', () => {
    const known = [...ISBI19, 'Co', 'Tg', 'RT', 'Ba', 'Pt', 'PTM', 'Pm', 'DC', 'R1', 'R2', 'R3', 'R4', 'L1A', 'L1T'];
    for (const e of VERTICAL) for (const l of g.requiredLandmarks(e.id)) {
      expect(known).toContain(l);
    }
  });

  // Fix round 1 (after #26's supplement slipped through): a generous plausible-range
  // guard on skull 0 for every angle entry here, same purpose as catalogue-ap.test.ts's. Bands are
  // deliberately wide (degrees) — this is a sanity net against a reversed line, not a norm.
  describe('plausible range, skull 0 (fix round 1, new guard)', () => {
    const bands: [string, number, number][] = [
      ['m20_SNGoGn', 5, 50], ['m21_SNGoMe', 5, 50], ['m22_FHMPt', 0, 50], ['m23_FHGoMe', 0, 50],
      ['m24_YAxis', 40, 80], ['m25_MMPA', 0, 50], ['m26_SNMxP', 0, 30], ['m27_PalFH', -20, 20],
      ['m30_FacAxisR', 70, 120], ['m31_FacAxisM', 70, 130], ['m32_OralGnomon', 30, 70], ['m33_MandBend', 0, 60],
      ['m34_Saddle', 100, 145], ['m35_Articular', 120, 170], ['m36_Gonial', 100, 150], ['m37_UpperGonial', 30, 70],
      ['m38_LowerGonial', 50, 100], ['m39_SumAngles', 360, 420], ['m90_SNMP_ABO', 5, 50], ['m91_FMA_ABO', 0, 50],
      ['m92_L1MP_ABO', 70, 120],
    ];
    const p = SYNTHETIC_SKULLS[0].points, v = g.evaluate(p, mmPerPx);
    for (const [id, lo, hi] of bands) {
      it(`${id} on skull 0 is within [${lo}, ${hi}]`, () => {
        const val = sc(v, id);
        expect(val).toBeGreaterThanOrEqual(lo);
        expect(val).toBeLessThanOrEqual(hi);
      });
    }
  });

  // #91 FMA (ABO) equals #22 FH-MPt by construction on every skull: the ABO constructed gonion
  // (GoC = ramus tangent x lower-border tangent) lies ON the lower-border tangent MPt, so
  // angleLines(FH, GoCMe) and angleLines(FH, MPt) measure the same angle to FH. Not a bug, but
  // worth asserting so a future change to either line's construction is noticed. (Interpretation
  // note for later: see task-5-report.md "Fix round 1", item 4.)
  it('m91_FMA_ABO equals m22_FHMPt on every synthetic skull (construction: GoC lies on MPt)', () => {
    for (const s of SYNTHETIC_SKULLS) {
      const v = g.evaluate(s.points, mmPerPx);
      expect(sc(v, 'm91_FMA_ABO')).toBeCloseTo(sc(v, 'm22_FHMPt'), 9);
    }
  });
});
