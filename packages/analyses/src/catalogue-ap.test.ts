import { describe, it, expect } from 'vitest';
import { compile } from '@ceph/geometry';
import type { Vec2 } from '@ceph/geometry';
import { LINES } from './lines';
import { SYNTHETIC_SKULLS } from './fixtures';
import { ISBI19 } from './landmarks';
import { SKELETAL_AP } from './catalogue/skeletal-ap';
import { ang, angAt, dist, sdist, sub } from './oracle';

/** Local plain maths, deliberately independent of @ceph/geometry (same discipline as oracle.ts). */
const perp90 = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });
const addV = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const proj = (p: Vec2, a: Vec2, b: Vec2): Vec2 => {
  const d = sub(b, a), t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (d.x * d.x + d.y * d.y);
  return { x: a.x + t * d.x, y: a.y + t * d.y };
};
const sign = (n: number) => Math.sign(n) || 1;

const nodesOf = (entries: typeof SKELETAL_AP) => Object.assign({}, ...entries.map((e) => e.nodes));
const registry = { ...LINES, ...nodesOf(SKELETAL_AP) };
const g = compile(registry);
const mmPerPx = 0.1;

const sc = (ev: Record<string, unknown>, id: string) => (ev[id] as { v: number }).v;

/** Kim's palatal-plane-to-FH angle, signed per Kim 1974 p.590 ("upward and forward = negative;
 *  downward and forward = positive"), using `down = (0,1)` as the brief's simplified sign oracle. */
const palSigned = (p: Record<string, Vec2>) => {
  const toward = sub(p.Or, p.Po);
  const b2 = addV(p.PNS, toward);
  return sign(sdist(p.ANS, p.PNS, b2, { x: 0, y: 1 })) * ang(sub(p.ANS, p.PNS), toward);
};
/** #4 facial angle oracle, reused by #14. */
const facialAngle = (p: Record<string, Vec2>) => ang(sub(p.Po, p.Or), sub(p.Pog, p.N));
/** #6 A–B plane angle oracle (signed, Downs: − when B is behind A), reused by #14. */
const abPlaneSigned = (p: Record<string, Vec2>) => {
  const toward = sub(p.Or, p.Po);
  const b2 = addV(p.A, sub(p.Pog, p.N));
  return sign(sdist(p.B, p.A, b2, toward)) * ang(sub(p.B, p.A), sub(p.Pog, p.N));
};

describe('skeletal, front-to-back catalogue (#1-19, Part A task 4)', () => {
  it('compiles together with LINES, no graph errors', () => {
    expect(() => compile({ ...LINES, ...nodesOf(SKELETAL_AP) })).not.toThrow();
  });

  it('every id, no and source mark is present and unique', () => {
    const ids = SKELETAL_AP.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SKELETAL_AP) {
      expect(e.id).toMatch(/^m\d{2}[a-z]?_/);
      expect(['P', 'T', 'S', 'W']).toContain(e.source.mark);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  // --- #1 SNA ---
  describe('m01_SNA', () => {
    it('oracle: equals angAt(S,N,A) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const v = g.evaluate(s.points, mmPerPx);
        expect(sc(v, 'm01_SNA')).toBeCloseTo(angAt(s.points.S, s.points.N, s.points.A), 9);
      }
    });
    it('behaviour: A +30 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm01_SNA');
      const v1 = sc(g.evaluate({ ...p, A: { x: p.A.x + 30, y: p.A.y } }, mmPerPx), 'm01_SNA');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without N (ISBI19), SNA is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m01_SNA).toBeNull();
    });
  });

  // --- #2 SNB ---
  describe('m02_SNB', () => {
    it('oracle: equals angAt(S,N,B) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const v = g.evaluate(s.points, mmPerPx);
        expect(sc(v, 'm02_SNB')).toBeCloseTo(angAt(s.points.S, s.points.N, s.points.B), 9);
      }
    });
    it('behaviour: skull 1 (retrusive mandible) < skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm02_SNB');
      const v1 = sc(g.evaluate(SYNTHETIC_SKULLS[1].points, mmPerPx), 'm02_SNB');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without N, SNB is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m02_SNB).toBeNull();
    });
  });

  // --- #3 ANB ---
  describe('m03_ANB', () => {
    it('oracle: equals SNA - SNB on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const v = g.evaluate(s.points, mmPerPx);
        const want = angAt(s.points.S, s.points.N, s.points.A) - angAt(s.points.S, s.points.N, s.points.B);
        expect(sc(v, 'm03_ANB')).toBeCloseTo(want, 9);
      }
    });
    it('behaviour: skull 1 (retrusive mandible) > skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm03_ANB');
      const v1 = sc(g.evaluate(SYNTHETIC_SKULLS[1].points, mmPerPx), 'm03_ANB');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without N, ANB is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m03_ANB).toBeNull();
    });
  });

  // --- #4 Facial angle ---
  describe('m04_FacialAngle', () => {
    it('oracle: equals ang(Po-Or, Pog-N) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const v = g.evaluate(s.points, mmPerPx);
        expect(sc(v, 'm04_FacialAngle')).toBeCloseTo(facialAngle(s.points), 9);
      }
    });
    it('behaviour: skull 1 (retrusive mandible) < skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm04_FacialAngle');
      const v1 = sc(g.evaluate(SYNTHETIC_SKULLS[1].points, mmPerPx), 'm04_FacialAngle');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without Po, facial angle is null', () => {
      const { Po: _po, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m04_FacialAngle).toBeNull();
    });
  });

  // --- #5 Angle of convexity ---
  describe('m05_Convexity', () => {
    it('oracle: equals sign(sdist(A,N,Pog,Or-Po)) * (180 - angAt(N,A,Pog)) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const toward = sub(p.Or, p.Po);
        const want = sign(sdist(p.A, p.N, p.Pog, toward)) * (180 - angAt(p.N, p.A, p.Pog));
        expect(sc(v, 'm05_Convexity')).toBeCloseTo(want, 9);
      }
    });
    it('behaviour: N, A, Pog collinear -> 0; A ahead -> +', () => {
      const p = { ...SYNTHETIC_SKULLS[0].points };
      const PogCollinear = { x: p.N.x + 2 * (p.A.x - p.N.x), y: p.N.y + 2 * (p.A.y - p.N.y) };
      expect(sc(g.evaluate({ ...p, Pog: PogCollinear }, mmPerPx), 'm05_Convexity')).toBeCloseTo(0, 9);
      const ahead = sc(g.evaluate({ ...p, A: { x: p.N.x + 200, y: p.A.y } }, mmPerPx), 'm05_Convexity');
      expect(ahead).toBeGreaterThan(0);
    });
    it('missing point: without N, convexity is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m05_Convexity).toBeNull();
    });
  });

  // --- #6 A-B plane angle ---
  describe('m06_ABPlane', () => {
    it('oracle: equals sign(sdist(B,A,A+(Pog-N),Or-Po)) * ang(B-A,Pog-N) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const v = g.evaluate(s.points, mmPerPx);
        expect(sc(v, 'm06_ABPlane')).toBeCloseTo(abPlaneSigned(s.points), 9);
      }
    });
    it('behaviour: skull 1 (B behind) -> negative, and smaller than skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm06_ABPlane');
      const v1 = sc(g.evaluate(SYNTHETIC_SKULLS[1].points, mmPerPx), 'm06_ABPlane');
      expect(v1).toBeLessThan(0);
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without A, A-B plane angle is null', () => {
      const { A: _a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m06_ABPlane).toBeNull();
    });
  });

  // --- #7 Convexity, A to N-Pog (mm) ---
  describe('m07_ANPog', () => {
    it('oracle: equals sdist(A,N,Pog,Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm07_ANPog')).toBeCloseTo(sdist(p.A, p.N, p.Pog, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: A ahead -> +, A behind -> -', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const aheadV = sc(g.evaluate({ ...p, A: { x: p.N.x + 50, y: p.A.y } }, mmPerPx), 'm07_ANPog');
      const behindV = sc(g.evaluate({ ...p, A: { x: p.N.x - 50, y: p.A.y } }, mmPerPx), 'm07_ANPog');
      expect(aheadV).toBeGreaterThan(0);
      expect(behindV).toBeLessThan(0);
    });
    it('missing point: without A, A to N-Pog is null', () => {
      const { A: _a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m07_ANPog).toBeNull();
    });
  });

  // --- #8 A to N-perpendicular (mm) ---
  describe('m08_ANperp', () => {
    it('oracle: equals the N-perpendicular signed distance formula on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const toward = sub(p.Or, p.Po), b2 = addV(p.N, perp90(toward));
        expect(sc(v, 'm08_ANperp')).toBeCloseTo(sdist(p.A, p.N, b2, toward) * 0.1, 9);
      }
    });
    it('behaviour: A ahead of the N-perpendicular -> +, A behind -> - (McNamara)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v1 = sc(g.evaluate({ ...p, A: { x: p.N.x + 30, y: p.A.y } }, mmPerPx), 'm08_ANperp');
      const v2 = sc(g.evaluate({ ...p, A: { x: p.N.x - 30, y: p.A.y } }, mmPerPx), 'm08_ANperp');
      expect(v1).toBeGreaterThan(0);
      expect(v2).toBeLessThan(0);
    });
    it('missing point: without A, A to N-perpendicular is null', () => {
      const { A: _a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m08_ANperp).toBeNull();
    });
  });

  // --- #9 Pog to N-perpendicular (mm) ---
  describe('m09_PogNperp', () => {
    it('oracle: equals the N-perpendicular signed distance formula (Pog) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const toward = sub(p.Or, p.Po), b2 = addV(p.N, perp90(toward));
        expect(sc(v, 'm09_PogNperp')).toBeCloseTo(sdist(p.Pog, p.N, b2, toward) * 0.1, 9);
      }
    });
    it('behaviour: skull 1 (retrusive mandible) is more negative than skull 0', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm09_PogNperp');
      const v1 = sc(g.evaluate(SYNTHETIC_SKULLS[1].points, mmPerPx), 'm09_PogNperp');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without Pog, Pog to N-perpendicular is null', () => {
      const { Pog: _pog, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m09_PogNperp).toBeNull();
    });
  });

  // --- #10 Co-A (mm) ---
  describe('m10_CoA', () => {
    it('oracle: equals dist(Co,A) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm10_CoA')).toBeCloseTo(dist(p.Co, p.A) * 0.1, 9);
      }
    });
    it('behaviour: A +30 px x -> Co-A larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm10_CoA');
      const v1 = sc(g.evaluate({ ...p, A: { x: p.A.x + 30, y: p.A.y } }, mmPerPx), 'm10_CoA');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Co (not in ISBI19), Co-A is null', () => {
      const { Co: _co, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m10_CoA).toBeNull();
    });
  });

  // --- #11 Co-Gn (mm) ---
  describe('m11_CoGn', () => {
    it('oracle: equals dist(Co,Gn) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm11_CoGn')).toBeCloseTo(dist(p.Co, p.Gn) * 0.1, 9);
      }
    });
    it('behaviour: Gn +30 px x -> Co-Gn larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm11_CoGn');
      const v1 = sc(g.evaluate({ ...p, Gn: { x: p.Gn.x + 30, y: p.Gn.y } }, mmPerPx), 'm11_CoGn');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Co (not in ISBI19), Co-Gn is null', () => {
      const { Co: _co, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m11_CoGn).toBeNull();
    });
  });

  // --- #12 Maxillomandibular difference (mm) ---
  describe('m12_MaxMandDiff', () => {
    it('oracle: equals (dist(Co,Gn) - dist(Co,A)) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm12_MaxMandDiff')).toBeCloseTo((dist(p.Co, p.Gn) - dist(p.Co, p.A)) * 0.1, 9);
      }
    });
    it('behaviour: skull 1 (retrusive mandible) smaller', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm12_MaxMandDiff');
      const v1 = sc(g.evaluate(SYNTHETIC_SKULLS[1].points, mmPerPx), 'm12_MaxMandDiff');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without Co (not in ISBI19), maxillomandibular difference is null', () => {
      const { Co: _co, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m12_MaxMandDiff).toBeNull();
    });
  });

  // --- #13 Wits (mm) ---
  describe('m13_Wits', () => {
    // Owner NUS-OP-1 (16 Oct 2026): every Wits on the standard occlusal plane (molar overlap -> incisor overlap), not Jacobson's functional plane.
    it('oracle: matches the AO/BO projection onto the standard occlusal plane (M6 -> MInc) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const M6 = { x: (p.U6.x + p.L6.x) / 2, y: (p.U6.y + p.L6.y) / 2 };
        const MInc = { x: (p.U1T.x + p.L1T.x) / 2, y: (p.U1T.y + p.L1T.y) / 2 };
        const d = sub(MInc, M6);
        const AO = proj(p.A, M6, MInc), BO = proj(p.B, M6, MInc);
        const perp2 = addV(BO, perp90(d));
        expect(sc(v, 'm13_Wits')).toBeCloseTo(sdist(AO, BO, perp2, d) * 0.1, 9);
      }
    });
    it('behaviour: skull 1 (B back) -> more positive (Jacobson p.474: "BO behind AO, a positive reading")', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm13_Wits');
      const v1 = sc(g.evaluate(SYNTHETIC_SKULLS[1].points, mmPerPx), 'm13_Wits');
      expect(v1).toBeGreaterThan(v0);
    });
    it('NUS-OP-1: P4 plays no part — moved 80 px or missing, Wits is unchanged', () => {
      const p = SYNTHETIC_SKULLS[0].points, v0 = sc(g.evaluate(p, mmPerPx), 'm13_Wits');
      const { P4: _p4, ...rest } = p;
      expect(sc(g.evaluate({ ...p, P4: { x: p.P4.x + 80, y: p.P4.y - 80 } }, mmPerPx), 'm13_Wits')).toBeCloseTo(v0, 12);
      expect(sc(g.evaluate(rest, mmPerPx), 'm13_Wits')).toBeCloseTo(v0, 12);
    });
    it('missing point: without U6 (not in ISBI19), Wits is null', () => {
      const { U6: _u6, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m13_Wits).toBeNull();
    });
  });

  // --- #14 APDI ---
  describe('m14_APDI', () => {
    // Geometric identity: facial angle + A-B plane angle + palatal angle = the angle between the A-B line and the
    // palatal plane. Obamiyi et al. 2019 (Angle Orthod 89:897) and Caballero-Purizaga et al. 2019 (Dental Press J
    // Orthod 24(3):46) describe APDI this way, so their norms measure the same quantity as Kim & Vietas 1978.
    it('identity: equals the angle between A->B and ANS->PNS, with the palate tipped either way and B ahead of A', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points;
        for (const q of [p, { ...p, ANS: { x: p.ANS.x, y: p.ANS.y + 60 } }, { ...p, ANS: { x: p.ANS.x, y: p.ANS.y - 60 } },
          { ...p, B: { x: p.B.x + 80, y: p.B.y } }]) {
          expect(sc(g.evaluate(q, mmPerPx), 'm14_APDI')).toBeCloseTo(ang(sub(q.B, q.A), sub(q.PNS, q.ANS)), 9);
        }
      }
    });
    it('oracle: equals facial angle + A-B plane (signed) + palatal plane (Kim-signed) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const want = facialAngle(p) + abPlaneSigned(p) + palSigned(p);
        expect(sc(v, 'm14_APDI')).toBeCloseTo(want, 9);
      }
    });
    it('behaviour: skull 1 -> smaller (Class II side, Kim & Vietas 1978)', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm14_APDI');
      const v1 = sc(g.evaluate(SYNTHETIC_SKULLS[1].points, mmPerPx), 'm14_APDI');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without ANS (ISBI19), APDI is null', () => {
      const { ANS: _ans, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m14_APDI).toBeNull();
    });
  });

  // --- #15 ODI ---
  describe('m15_ODI', () => {
    it('oracle: equals ang(B-A, Me-Tg) + palatal plane (Kim-signed) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const want = ang(sub(p.B, p.A), sub(p.Me, p.Tg)) + palSigned(p);
        expect(sc(v, 'm15_ODI')).toBeCloseTo(want, 9);
      }
    });
    it('behaviour: Me +60 px y (steeper plane, open-bite direction) -> ODI smaller (Kim 1974)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm15_ODI');
      const v1 = sc(g.evaluate({ ...p, Me: { x: p.Me.x, y: p.Me.y + 60 } }, mmPerPx), 'm15_ODI');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without Tg (not in ISBI19), ODI is null', () => {
      const { Tg: _tg, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m15_ODI).toBeNull();
    });
  });

  // --- #16 Combination factor ---
  describe('m16_CF', () => {
    it('oracle: equals ODI + APDI on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const odi = ang(sub(p.B, p.A), sub(p.Me, p.Tg)) + palSigned(p);
        const apdi = facialAngle(p) + abPlaneSigned(p) + palSigned(p);
        expect(sc(v, 'm16_CF')).toBeCloseTo(odi + apdi, 9);
      }
    });
    it('behaviour: moves with its parts (skull 1, a Class II pattern, gives a smaller CF)', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm16_CF');
      const v1 = sc(g.evaluate(SYNTHETIC_SKULLS[1].points, mmPerPx), 'm16_CF');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without Tg (not in ISBI19), combination factor is null', () => {
      const { Tg: _tg, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m16_CF).toBeNull();
    });
  });

  // --- #17 Extraction index ---
  describe('m17_ExtrIndex', () => {
    it('oracle: equals the combination factor (m16_CF) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const v = g.evaluate(s.points, mmPerPx);
        expect(sc(v, 'm17_ExtrIndex')).toBeCloseTo(sc(v, 'm16_CF'), 9);
      }
    });
    it('behaviour: bands are strictly increasing', () => {
      const entry = SKELETAL_AP.find((e) => e.id === 'm17_ExtrIndex')!;
      const maxes = (entry.bands ?? []).map((b) => b.max);
      for (let i = 1; i < maxes.length; i++) expect(maxes[i]).toBeGreaterThan(maxes[i - 1]);
      expect(maxes.length).toBeGreaterThan(1);
    });
    it('missing point: without Tg (not in ISBI19), extraction index is null', () => {
      const { Tg: _tg, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m17_ExtrIndex).toBeNull();
    });
  });

  // --- #18 Pog to NB (mm) ---
  describe('m18_PogNB', () => {
    it('oracle: equals sdist(Pog,N,B,Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm18_PogNB')).toBeCloseTo(sdist(p.Pog, p.N, p.B, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: Pog ahead -> +, Pog behind -> -', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const aheadV = sc(g.evaluate({ ...p, Pog: { x: p.N.x + 80, y: p.Pog.y } }, mmPerPx), 'm18_PogNB');
      const behindV = sc(g.evaluate({ ...p, Pog: { x: p.N.x - 80, y: p.Pog.y } }, mmPerPx), 'm18_PogNB');
      expect(aheadV).toBeGreaterThan(0);
      expect(behindV).toBeLessThan(0);
    });
    it('missing point: without Pog, Pog to NB is null', () => {
      const { Pog: _pog, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m18_PogNB).toBeNull();
    });
  });

  // --- #19 U6 to PTV (mm) ---
  describe('m19_U6PTV', () => {
    it('oracle: equals the PTV signed distance formula on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const toward = sub(p.Or, p.Po), b2 = addV(p.PR, perp90(toward));
        expect(sc(v, 'm19_U6PTV')).toBeCloseTo(sdist(p.U6D, p.PR, b2, toward) * 0.1, 9);
      }
    });
    it('behaviour: U6D +20 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm19_U6PTV');
      const v1 = sc(g.evaluate({ ...p, U6D: { x: p.U6D.x + 20, y: p.U6D.y } }, mmPerPx), 'm19_U6PTV');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without U6D (not in ISBI19), U6 to PTV is null', () => {
      const { U6D: _u6d, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m19_U6PTV).toBeNull();
    });
  });

  it('the catalogue covers every landmark it requires', () => {
    for (const e of SKELETAL_AP) for (const l of g.requiredLandmarks(e.id)) {
      expect([...ISBI19, 'Co', 'Tg', 'U6', 'L6', 'P4', 'U6D', 'PR']).toContain(l);
    }
  });

  // Fix round 1 (after #26's supplement slipped through): a generous plausible-range
  // guard on skull 0 for every angle entry, so a reversed line can never again produce a
  // geometrically real but clinically wrong value (e.g. a supplement) without a test noticing.
  // Bands are deliberately wide (degrees) — this is a sanity net, not a norm.
  describe('plausible range, skull 0 (fix round 1, new guard)', () => {
    const bands: [string, number, number][] = [
      ['m01_SNA', 60, 100], ['m02_SNB', 60, 100], ['m03_ANB', -15, 15], ['m04_FacialAngle', 70, 110],
      ['m05_Convexity', -30, 30], ['m06_ABPlane', -30, 30], ['m14_APDI', 60, 110], ['m15_ODI', 50, 100],
      ['m16_CF', 120, 190], ['m17_ExtrIndex', 120, 190],
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
});
