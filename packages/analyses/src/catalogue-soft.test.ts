import { describe, it, expect } from 'vitest';
import { compile } from '@ceph/geometry';
import type { Vec2 } from '@ceph/geometry';
import { LINES } from './lines';
import { SYNTHETIC_SKULLS } from './fixtures';
import { ISBI19 } from './landmarks';
import { SOFT } from './catalogue/soft';
import { ang, angAt, dist, meet, sdist, sub } from './oracle';

const nodesOf = (entries: typeof SOFT) => Object.assign({}, ...entries.map((e) => e.nodes));
const registry = { ...LINES, ...nodesOf(SOFT) };
const g = compile(registry);
const mmPerPx = 0.1;

const sc = (ev: Record<string, unknown>, id: string) => (ev[id] as { v: number }).v;

const perp90 = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });
const addV = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const unitV = (a: Vec2): Vec2 => { const L = Math.hypot(a.x, a.y); return { x: a.x / L, y: a.y / L }; };
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** Foot of the perpendicular from p onto line a->b (matches packages/geometry/src/vec.ts's `project`). */
const proj = (p: Vec2, a: Vec2, b: Vec2): Vec2 => {
  const d = sub(b, a), t = dot(sub(p, a), d) / dot(d, d);
  return addV(a, mul(d, t));
};
/** Matches `withSign`'s own sign rule (packages/geometry/src/compile.ts): zero counts as positive. */
const signV = (v: number): number => (v < 0 ? -1 : 1);

/** #77's helper point: A, offset 3 mm down along Nperp (Nperp = perpendicular through N to FH;
 *  "down" per lines.ts's own comment that Nperp points down (inferior)). mm/mmPerPx px along the
 *  unit direction, matching `offsetPoint`'s own formula (packages/geometry/src/compile.ts). */
const a3Of = (p: Record<string, Vec2>): Vec2 => {
  const fh = sub(p.Or, p.Po), nperp = perp90(fh);
  return addV(p.A, mul(unitV(nperp), 3 / mmPerPx));
};

describe('soft tissue and airway catalogue (#71-89, Part A task 7)', () => {
  it('compiles together with LINES, no graph errors', () => {
    expect(() => compile({ ...LINES, ...nodesOf(SOFT) })).not.toThrow();
  });

  it('every id, no and source mark is present and unique', () => {
    const ids = SOFT.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SOFT) {
      expect(e.id).toMatch(/^m\d{2}[a-z]?_/);
      expect(['P', 'T', 'S', 'W']).toContain(e.source.mark);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  // --- #71 Upper lip to E-line ---
  describe('m71_ULE', () => {
    it('oracle: equals sdist(UL, Prn, PogS, Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm71_ULE')).toBeCloseTo(sdist(p.UL, p.Prn, p.PogS, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: UL +20 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm71_ULE');
      const v1 = sc(g.evaluate({ ...p, UL: { x: p.UL.x + 20, y: p.UL.y } }, mmPerPx), 'm71_ULE');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Prn (not in ISBI19), upper lip to E-line is null', () => {
      const { Prn: _prn, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m71_ULE).toBeNull();
    });
  });

  // --- #72 Lower lip to E-line ---
  describe('m72_LLE', () => {
    it('oracle: equals sdist(LL, Prn, PogS, Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm72_LLE')).toBeCloseTo(sdist(p.LL, p.Prn, p.PogS, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: LL +20 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm72_LLE');
      const v1 = sc(g.evaluate({ ...p, LL: { x: p.LL.x + 20, y: p.LL.y } }, mmPerPx), 'm72_LLE');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Prn (not in ISBI19), lower lip to E-line is null', () => {
      const { Prn: _prn, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m72_LLE).toBeNull();
    });
  });

  // --- #73 Soft-tissue facial angle ---
  describe('m73_STFacial', () => {
    it('oracle: equals ang(Po-Or, SPogS-Ns) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm73_STFacial')).toBeCloseTo(ang(sub(p.Po, p.Or), sub(p.SPogS, p.Ns)), 9);
      }
    });
    it('behaviour: SPogS +40 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm73_STFacial');
      const v1 = sc(g.evaluate({ ...p, SPogS: { x: p.SPogS.x + 40, y: p.SPogS.y } }, mmPerPx), 'm73_STFacial');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Ns (not in ISBI19), soft-tissue facial angle is null', () => {
      const { Ns: _ns, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m73_STFacial).toBeNull();
    });
  });

  // --- #74 Nose prominence ---
  describe('m74_NoseProm', () => {
    it('oracle: equals sdist(Prn, UL, UL+perp(Or-Po), Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const fh = sub(p.Or, p.Po), hv2 = addV(p.UL, perp90(fh));
        expect(sc(v, 'm74_NoseProm')).toBeCloseTo(sdist(p.Prn, p.UL, hv2, fh) * 0.1, 9);
      }
    });
    it('behaviour: Prn +20 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm74_NoseProm');
      const v1 = sc(g.evaluate({ ...p, Prn: { x: p.Prn.x + 20, y: p.Prn.y } }, mmPerPx), 'm74_NoseProm');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without Prn (not in ISBI19), nose prominence is null', () => {
      const { Prn: _prn, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m74_NoseProm).toBeNull();
    });
  });

  // --- #75 Superior sulcus depth ---
  describe('m75_SupSulcus', () => {
    it('oracle: equals sdist(ULs, UL, UL+perp(Or-Po), Po-Or) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const fh = sub(p.Or, p.Po), hv2 = addV(p.UL, perp90(fh));
        expect(sc(v, 'm75_SupSulcus')).toBeCloseTo(sdist(p.ULs, p.UL, hv2, sub(p.Po, p.Or)) * 0.1, 9);
      }
    });
    it('behaviour: ULs -20 px x (deeper) -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm75_SupSulcus');
      const v1 = sc(g.evaluate({ ...p, ULs: { x: p.ULs.x - 20, y: p.ULs.y } }, mmPerPx), 'm75_SupSulcus');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without ULs (not in ISBI19), superior sulcus depth is null', () => {
      const { ULs: _uls, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m75_SupSulcus).toBeNull();
    });
  });

  // --- #76 Subnasale to H-line ---
  describe('m76_SnH', () => {
    it('oracle: equals sdist(Sn, PogS, UL, Po-Or) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm76_SnH')).toBeCloseTo(sdist(p.Sn, p.PogS, p.UL, sub(p.Po, p.Or)) * 0.1, 9);
      }
    });
    it('behaviour: Sn -20 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm76_SnH');
      const v1 = sc(g.evaluate({ ...p, Sn: { x: p.Sn.x - 20, y: p.Sn.y } }, mmPerPx), 'm76_SnH');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: Sn is required but already in ISBI19; H/FH_post need only ISBI19 points too, so this entry depends on NO non-ISBI19 point — removing Sn itself still proves "missing point -> null"', () => {
      const { Sn: _sn, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m76_SnH).toBeNull();
    });
  });

  // --- #77 Basic upper lip thickness ---
  describe('m77_BasicUL', () => {
    it('oracle: equals dist(A + unit(perp(Or-Po))*3/mmPerPx, ULd) * mmPerPx on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm77_BasicUL')).toBeCloseTo(dist(a3Of(p), p.ULd) * mmPerPx, 9);
      }
    });
    it('behaviour: A +20 px x -> changes (no stated direction; AlBarakati gives only the construction)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm77_BasicUL');
      const v1 = sc(g.evaluate({ ...p, A: { x: p.A.x + 20, y: p.A.y } }, mmPerPx), 'm77_BasicUL');
      expect(v1).not.toBeCloseTo(v0, 6);
    });
    it('missing point: without ULd (not in ISBI19), basic upper lip thickness is null', () => {
      const { ULd: _uld, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m77_BasicUL).toBeNull();
    });
    it('edge: mmPerPx 0 -> null (offsetPoint cannot place a point at an undefined scale)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(p, 0).m77_BasicUL).toBeNull();
    });
    // Fix round 1 (minor): the distance-level edge test above passes even WITHOUT
    // `offsetPoint`'s own mmPerPx-0 guard, because `distance` already returns null whenever either
    // of its points is null and multiplies by mmPerPx regardless — so a hypothetical bug that let
    // `offsetPoint` return a non-null point at mmPerPx 0 (e.g. by silently treating 0 as 1) would
    // not be caught there. Pin the guard directly on the node it belongs to.
    it('edge: the m77_A3 helper node itself is null at mmPerPx 0 (pins the offsetPoint guard directly, not just at the distance above it)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(p, 0).m77_A3).toBeNull();
    });
  });

  // --- #78 Upper lip thickness ---
  describe('m78_ULThick', () => {
    it('oracle: equals dist(U1L, UL) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm78_ULThick')).toBeCloseTo(dist(p.U1L, p.UL) * 0.1, 9);
      }
    });
    it('behaviour: UL +20 px x -> thicker (larger; the brief states no direction, but U1L sits behind and below UL on every synthetic skull, so moving UL further forward genuinely lengthens U1L-UL)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm78_ULThick');
      const v1 = sc(g.evaluate({ ...p, UL: { x: p.UL.x + 20, y: p.UL.y } }, mmPerPx), 'm78_ULThick');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without U1L (not in ISBI19), upper lip thickness is null', () => {
      const { U1L: _u1l, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m78_ULThick).toBeNull();
    });
  });

  // --- #79 Upper lip strain ---
  describe('m79_ULStrain', () => {
    // Owner LIP-2 (8 Oct): Holdaway's direction — basic thickness (#77) minus the thickness at the
    // vermilion (#78), positive when the lip is strained (thinner at the vermilion). Before 8 Oct the
    // catalogue computed #78 − #77, the opposite sign.
    it('oracle (owner LIP-2): equals m77_BasicUL - m78_ULThick on every synthetic skull (Holdaway: basic minus vermilion)', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const want = dist(a3Of(p), p.ULd) * mmPerPx - dist(p.U1L, p.UL) * 0.1;
        expect(sc(v, 'm79_ULStrain')).toBeCloseTo(want, 9);
      }
    });
    it('behaviour (owner LIP-2): UL +20 px x -> thicker vermilion (m78 up, m77 unchanged) -> LESS strain (smaller)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const moved = { ...p, UL: { x: p.UL.x + 20, y: p.UL.y } };
      const v0 = g.evaluate(p, mmPerPx), v1 = g.evaluate(moved, mmPerPx);
      expect(sc(v1, 'm77_BasicUL')).toBeCloseTo(sc(v0, 'm77_BasicUL'), 9);
      expect(sc(v1, 'm78_ULThick')).toBeGreaterThan(sc(v0, 'm78_ULThick'));
      expect(sc(v1, 'm79_ULStrain')).toBeLessThan(sc(v0, 'm79_ULStrain'));
    });
    it('missing point: without ULd (not in ISBI19), upper lip strain is null', () => {
      const { ULd: _uld, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m79_ULStrain).toBeNull();
    });
  });

  // --- #80 H-angle ---
  // Fix round 1 (ruling): plain `angleLines STfac, HRev` is unsigned (0-180), so a
  // concave Class III profile — where the upper lip sits BEHIND the soft-tissue facial line — read
  // as a small positive angle indistinguishable from a normal convex profile where the lip is
  // slightly ahead. Clinically the H-angle is reported negative in that case. Fixed with
  // `withSign{ value: <the plain angle, now the private node m80_ang>, signFrom: signedDistance UL,
  // STfac, FH }`: + when UL is ahead of the soft-tissue facial line (the normal case, unchanged
  // magnitude), - when behind.
  describe('m80_HAngle', () => {
    it('oracle: equals sign(sdist(UL,Ns,SPogS,Or-Po)) * ang(SPogS-Ns, PogS-UL) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const want = signV(sdist(p.UL, p.Ns, p.SPogS, sub(p.Or, p.Po))) * ang(sub(p.SPogS, p.Ns), sub(p.PogS, p.UL));
        expect(sc(v, 'm80_HAngle')).toBeCloseTo(want, 9);
      }
    });
    it('behaviour: UL +30 px x (further ahead of the facial line) -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm80_HAngle');
      const v1 = sc(g.evaluate({ ...p, UL: { x: p.UL.x + 30, y: p.UL.y } }, mmPerPx), 'm80_HAngle');
      expect(v1).toBeGreaterThan(v0);
    });
    it('behaviour: UL moved 3 mm behind the soft-tissue facial line (Ns-SPogS), at its own level -> negative (concave, Class III)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const foot = proj(p.UL, p.Ns, p.SPogS);
      const fhDir = unitV(sub(p.Or, p.Po));
      const behindUL = { x: foot.x - fhDir.x * (3 / mmPerPx), y: foot.y - fhDir.y * (3 / mmPerPx) };
      const v1 = sc(g.evaluate({ ...p, UL: behindUL }, mmPerPx), 'm80_HAngle');
      expect(v1).toBeLessThan(0);
    });
    it('missing point: without Ns (not in ISBI19), H-angle is null', () => {
      const { Ns: _ns, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m80_HAngle).toBeNull();
    });
  });

  // --- #81 Lower lip to H-line ---
  describe('m81_LLH', () => {
    it('oracle: equals sdist(LL, PogS, UL, Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm81_LLH')).toBeCloseTo(sdist(p.LL, p.PogS, p.UL, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: LL +20 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm81_LLH');
      const v1 = sc(g.evaluate({ ...p, LL: { x: p.LL.x + 20, y: p.LL.y } }, mmPerPx), 'm81_LLH');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: LL is in ISBI19; H/FH need only ISBI19 points too, so removing LL itself still proves "missing point -> null"', () => {
      const { LL: _ll, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m81_LLH).toBeNull();
    });
  });

  // --- #82 Inferior sulcus to H-line ---
  describe('m82_InfSulcusH', () => {
    it('oracle: equals sdist(LLs, PogS, UL, Po-Or) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm82_InfSulcusH')).toBeCloseTo(sdist(p.LLs, p.PogS, p.UL, sub(p.Po, p.Or)) * 0.1, 9);
      }
    });
    it('behaviour: LLs -20 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm82_InfSulcusH');
      const v1 = sc(g.evaluate({ ...p, LLs: { x: p.LLs.x - 20, y: p.LLs.y } }, mmPerPx), 'm82_InfSulcusH');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without LLs (not in ISBI19), inferior sulcus to H-line is null', () => {
      const { LLs: _lls, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m82_InfSulcusH).toBeNull();
    });
  });

  // --- #83 Soft-tissue chin thickness ---
  describe('m83_ChinThick', () => {
    it('oracle: equals dist(meet(SPog,SPog+(Or-Po),N,Pog), meet(SPog,SPog+(Or-Po),Ns,SPogS)) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const fh = sub(p.Or, p.Po), through2 = addV(p.SPog, fh);
        const h = meet(p.SPog, through2, p.N, p.Pog);
        const soft = meet(p.SPog, through2, p.Ns, p.SPogS);
        expect(sc(v, 'm83_ChinThick')).toBeCloseTo(dist(h, soft) * 0.1, 9);
      }
    });
    it('behaviour: SPogS +20 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm83_ChinThick');
      const v1 = sc(g.evaluate({ ...p, SPogS: { x: p.SPogS.x + 20, y: p.SPogS.y } }, mmPerPx), 'm83_ChinThick');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without SPog (not in ISBI19), soft-tissue chin thickness is null', () => {
      const { SPog: _spog, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m83_ChinThick).toBeNull();
    });
  });

  // --- #84 Upper pharynx ---
  describe('m84_UpperPharynx', () => {
    it('oracle: equals dist(SPP, UPW) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm84_UpperPharynx')).toBeCloseTo(dist(p.SPP, p.UPW) * 0.1, 9);
      }
    });
    it('behaviour: UPW +20 px x -> changes (no stated direction)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm84_UpperPharynx');
      const v1 = sc(g.evaluate({ ...p, UPW: { x: p.UPW.x + 20, y: p.UPW.y } }, mmPerPx), 'm84_UpperPharynx');
      expect(v1).not.toBeCloseTo(v0, 6);
    });
    it('missing point: without SPP (not in ISBI19), upper pharynx is null', () => {
      const { SPP: _spp, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m84_UpperPharynx).toBeNull();
    });
  });

  // --- #85 Lower pharynx ---
  describe('m85_LowerPharynx', () => {
    it('oracle: equals dist(TM, LPW) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm85_LowerPharynx')).toBeCloseTo(dist(p.TM, p.LPW) * 0.1, 9);
      }
    });
    it('behaviour: LPW +20 px x -> changes (no stated direction)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm85_LowerPharynx');
      const v1 = sc(g.evaluate({ ...p, LPW: { x: p.LPW.x + 20, y: p.LPW.y } }, mmPerPx), 'm85_LowerPharynx');
      expect(v1).not.toBeCloseTo(v0, 6);
    });
    it('missing point: without TM (not in ISBI19), lower pharynx is null', () => {
      const { TM: _tm, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m85_LowerPharynx).toBeNull();
    });
  });

  // --- #86 Nasolabial angle ---
  describe('m86_Nasolabial', () => {
    it('oracle: equals angAt(Cm, Sn, UL) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm86_Nasolabial')).toBeCloseTo(angAt(p.Cm, p.Sn, p.UL), 9);
      }
    });
    it('behaviour: UL +30 px x -> smaller', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm86_Nasolabial');
      const v1 = sc(g.evaluate({ ...p, UL: { x: p.UL.x + 30, y: p.UL.y } }, mmPerPx), 'm86_Nasolabial');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without Cm (not in ISBI19), nasolabial angle is null', () => {
      const { Cm: _cm, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m86_Nasolabial).toBeNull();
    });
  });

  // --- #87 SND ---
  // The brief's "skull 1 < skull 0" does not hold here: skull 1 ("retrusive mandible") shifts only
  // B, Pog, Gn and Me — D (centre of the symphysis) is NOT among them, so S, N and D are all
  // identical on skull 0 and skull 1 and the angle is exactly unchanged, not "<". Verified: 78.54
  // degrees both times. Same defect class as vertical.ts's #32/#34/#35/#43/#44 (brief names a skull
  // fixture that never touches the entry's own points) — fixed the same way, with a single-point
  // move of D instead. Direction confirmed by hand (D -60 px x, matching the magnitude/direction
  // skull 1 already uses for the rest of the mandible): 78.54 -> 74.58 degrees, i.e. smaller, the
  // same trend the brief intended skull 1 to show for a retrusive mandible.
  describe('m87_SND', () => {
    it('oracle: equals angAt(S, N, D) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm87_SND')).toBeCloseTo(angAt(p.S, p.N, p.D), 9);
      }
    });
    it('behaviour: D -60 px x (retrusive, matching skull 1\'s mandible shift, which does not move D) -> smaller', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm87_SND');
      const v1 = sc(g.evaluate({ ...p, D: { x: p.D.x - 60, y: p.D.y } }, mmPerPx), 'm87_SND');
      expect(v1).toBeLessThan(v0);
    });
    it('missing point: without D (not in ISBI19), SND is null', () => {
      const { D: _d, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m87_SND).toBeNull();
    });
  });

  // --- #88 Soft-tissue convexity G-Sn-Pog' ---
  // Fix round 1 (ruling): plain `angle3 G, Sn, PogS` is unsigned and capped at 180, so a
  // genuinely concave profile (Sn sitting BEHIND the straight line from glabella to soft pogonion —
  // a markedly convex/prognathic chin relative to the upper face) read as a DECREASING angle past
  // the point where G, Sn and PogS are collinear, the same shape backwards: the measurement got
  // smaller as the chin moved further forward, the opposite of what "more convex" should show.
  // Fixed per the agreed construction: `m88_a` (the plain angle3, now a private node),
  // `m88_l` (new private line G->PogS), `m88_s` (signedDistance Sn from m88_l, positive along FH:
  // + when Sn is ahead of G-PogS, i.e. the normal/convex case), `m88_ss = supplementSigned{angle:
  // m88_a, signFrom: m88_s}`, `m88_180` (constant 180), value = `difference(m88_180, m88_ss)`. This
  // gives `a` unchanged when Sn is ahead (convex, the skull-0 case: 174.56 degrees, confirmed by the
  // engine — not 175.2 as mis-stated by hand-arithmetic in the first pass's report), and `360 - a`
  // when Sn is behind (concave) — verified by hand before writing the code: moving PogS +100px x
  // past the G-Sn-PogS collinear point (at +49.43px) gives a~175.17 degrees with Sn now behind
  // G-PogS, so value = 360-175.17 = 184.83 degrees; +150px gives a~170.16, value = 189.84 degrees —
  // greater, and increasing further as PogS moves further forward, as the ruling
  // requires.
  describe('m88_STConvexity', () => {
    const oracleVal = (p: Record<string, Vec2>) => {
      const a = angAt(p.G, p.Sn, p.PogS);
      const s = sdist(p.Sn, p.G, p.PogS, sub(p.Or, p.Po));
      const ss = signV(s) * (180 - a);
      return 180 - ss;
    };
    it('oracle: equals the signed-convexity formula (180 - supplementSigned(angAt(G,Sn,PogS), sdist(Sn,G,PogS,FH))) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm88_STConvexity')).toBeCloseTo(oracleVal(p), 9);
      }
    });
    it('behaviour: PogS -40 px x (more convex, still ahead of G-Pog\' line) -> smaller', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm88_STConvexity');
      const v1 = sc(g.evaluate({ ...p, PogS: { x: p.PogS.x - 40, y: p.PogS.y } }, mmPerPx), 'm88_STConvexity');
      expect(v1).toBeLessThan(v0);
    });
    it('behaviour: PogS moved far enough forward that Sn sits behind G-Pog\' (concave) -> value > 180, and increases as the chin comes further forward', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const far1 = sc(g.evaluate({ ...p, PogS: { x: p.PogS.x + 100, y: p.PogS.y } }, mmPerPx), 'm88_STConvexity');
      const far2 = sc(g.evaluate({ ...p, PogS: { x: p.PogS.x + 150, y: p.PogS.y } }, mmPerPx), 'm88_STConvexity');
      expect(far1).toBeGreaterThan(180);
      expect(far2).toBeGreaterThan(far1);
    });
    it('missing point: without G (not in ISBI19), soft-tissue convexity is null', () => {
      const { G: _g, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m88_STConvexity).toBeNull();
    });
  });

  // --- #89 Upper lip length ---
  describe('m89_ULLength', () => {
    it('oracle: equals dist(Sn, St) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm89_ULLength')).toBeCloseTo(dist(p.Sn, p.St) * 0.1, 9);
      }
    });
    it('behaviour: St +20 px y (further from Sn) -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm89_ULLength');
      const v1 = sc(g.evaluate({ ...p, St: { x: p.St.x, y: p.St.y + 20 } }, mmPerPx), 'm89_ULLength');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without St (not in ISBI19), upper lip length is null', () => {
      const { St: _st, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m89_ULLength).toBeNull();
    });
  });

  it('the catalogue covers every landmark it requires', () => {
    const known = [...ISBI19, 'Prn', 'Ns', 'ULs', 'LLs', 'A', 'N', 'Nperp', 'ULd', 'U1L', 'SPog', 'SPogS',
      'SPP', 'UPW', 'TM', 'LPW', 'Cm', 'D', 'G', 'St'];
    for (const e of SOFT) for (const l of g.requiredLandmarks(e.id)) {
      expect(known).toContain(l);
    }
  });

  // Plausible-range guard (catalogue-pattern.md, ruling after Task 5) on skull 0, one
  // band per angle entry. Bands given in catalogue-pattern.md: STFacial 70-110; Nasolabial 70-140;
  // SND 60-100; STConvexity 140-190. Fix round 1 (ruling): HAngle's band widened from
  // 0-40 to -10..40, now that #80 is signed and a concave profile can read negative; skull 0 itself
  // is unaffected (still the normal convex case, same +7.04 degrees as before the sign fix).
  describe('plausible range, skull 0', () => {
    const bands: [string, number, number][] = [
      ['m73_STFacial', 70, 110], ['m80_HAngle', -10, 40], ['m86_Nasolabial', 70, 140],
      ['m87_SND', 60, 100], ['m88_STConvexity', 140, 190],
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
