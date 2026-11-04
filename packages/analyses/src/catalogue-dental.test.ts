import { describe, it, expect } from 'vitest';
import { compile } from '@ceph/geometry';
import { LINES } from './lines';
import { SYNTHETIC_SKULLS } from './fixtures';
import { ISBI19 } from './landmarks';
import { DENTAL } from './catalogue/dental';
import { VERTICAL } from './catalogue/vertical';
import { ang, angAt, dist, sdist, sub } from './oracle';

const nodesOf = (entries: { nodes: Record<string, unknown> }[]) => Object.assign({}, ...entries.map((e) => e.nodes));
const registry = { ...LINES, ...nodesOf(DENTAL) };
const g = compile(registry);
// Separate compile that also carries m22_FHMPt (vertical.ts), for the Tweed-triangle check only.
const gTweed = compile({ ...LINES, ...nodesOf(DENTAL), ...nodesOf(VERTICAL) });
const mmPerPx = 0.1;

const sc = (ev: Record<string, unknown>, id: string) => (ev[id] as { v: number }).v;
const live = DENTAL.filter((e) => !e.retired);
const retired = DENTAL.filter((e) => e.retired);

describe('dental catalogue (#45-70, Part A task 6)', () => {
  it('compiles together with LINES, no graph errors', () => {
    expect(() => compile({ ...LINES, ...nodesOf(DENTAL) })).not.toThrow();
  });

  it('every id, no and source mark is present and unique', () => {
    const ids = DENTAL.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of DENTAL) {
      expect(e.id).toMatch(/^m\d{2}[a-z]?_/);
      expect(['P', 'T', 'S', 'W']).toContain(e.source.mark);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it('#45, #48 and #65 are retired: no nodes, no expression, appendix "Not used" text kept', () => {
    expect(retired.map((e) => e.no).sort()).toEqual(['45', '48', '65']);
    for (const e of retired) {
      expect(e.nodes).toEqual({});
      expect(e.label).toMatch(/^Not used: C1/);
      expect(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx)[e.id]).toBeUndefined();
    }
  });

  // --- #46 U1-NA mm ---
  describe('m46_U1NAmm', () => {
    it('oracle: equals sdist(U1T,N,A,Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm46_U1NAmm')).toBeCloseTo(sdist(p.U1T, p.N, p.A, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm46_U1NAmm');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm46_U1NAmm');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without N, U1-NA mm is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m46_U1NAmm).toBeNull();
    });
  });

  // --- #47 U1-NA deg ---
  describe('m47_U1NAdeg', () => {
    it('oracle: equals ang(A-N, U1T-U1A) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm47_U1NAdeg')).toBeCloseTo(ang(sub(p.A, p.N), sub(p.U1T, p.U1A)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm47_U1NAdeg');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm47_U1NAdeg');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without U1A (not in ISBI19), U1-NA deg is null', () => {
      const { U1A: _u1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m47_U1NAdeg).toBeNull();
    });
  });

  // --- #49 L1-NB mm ---
  describe('m49_L1NBmm', () => {
    it('oracle: equals sdist(L1T,N,B,Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm49_L1NBmm')).toBeCloseTo(sdist(p.L1T, p.N, p.B, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm49_L1NBmm');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm49_L1NBmm');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without N, L1-NB mm is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m49_L1NBmm).toBeNull();
    });
  });

  // --- #50 L1-NB deg ---
  describe('m50_L1NBdeg', () => {
    it('oracle: equals ang(B-N, L1A-L1T) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm50_L1NBdeg')).toBeCloseTo(ang(sub(p.B, p.N), sub(p.L1A, p.L1T)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm50_L1NBdeg');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm50_L1NBdeg');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without L1A (not in ISBI19), L1-NB deg is null', () => {
      const { L1A: _l1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m50_L1NBdeg).toBeNull();
    });
  });

  // --- #51 L1-NA mm ---
  describe('m51_L1NAmm', () => {
    it('oracle: equals sdist(L1T,N,A,Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm51_L1NAmm')).toBeCloseTo(sdist(p.L1T, p.N, p.A, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm51_L1NAmm');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm51_L1NAmm');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without N, L1-NA mm is null', () => {
      const { N: _n, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m51_L1NAmm).toBeNull();
    });
  });

  // --- #52 L1-NA deg ---
  describe('m52_L1NAdeg', () => {
    it('oracle: equals ang(A-N, L1A-L1T) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm52_L1NAdeg')).toBeCloseTo(ang(sub(p.A, p.N), sub(p.L1A, p.L1T)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm52_L1NAdeg');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm52_L1NAdeg');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without L1A (not in ISBI19), L1-NA deg is null', () => {
      const { L1A: _l1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m52_L1NAdeg).toBeNull();
    });
  });

  // --- #53 Interincisal angle ---
  describe('m53_Interincisal', () => {
    it('oracle: equals ang(U1A-U1T, L1A-L1T) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm53_Interincisal')).toBeCloseTo(ang(sub(p.U1A, p.U1T), sub(p.L1A, p.L1T)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> smaller', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm53_Interincisal');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm53_Interincisal');
      expect(v5).toBeLessThan(v0);
    });
    it('missing point: without U1A (not in ISBI19), interincisal angle is null', () => {
      const { U1A: _u1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m53_Interincisal).toBeNull();
    });
  });

  // --- #54 U1-SN ---
  describe('m54_U1SN', () => {
    it('oracle: equals ang(U1A-U1T, N-S) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm54_U1SN')).toBeCloseTo(ang(sub(p.U1A, p.U1T), sub(p.N, p.S)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm54_U1SN');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm54_U1SN');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without U1A (not in ISBI19), U1-SN is null', () => {
      const { U1A: _u1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m54_U1SN).toBeNull();
    });
  });

  // --- #55 U1-MxP ---
  describe('m55_U1MxP', () => {
    it('oracle: equals ang(ANS-PNS, U1A-U1T) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm55_U1MxP')).toBeCloseTo(ang(sub(p.ANS, p.PNS), sub(p.U1A, p.U1T)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm55_U1MxP');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm55_U1MxP');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without U1A (not in ISBI19), U1-MxP is null', () => {
      const { U1A: _u1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m55_U1MxP).toBeNull();
    });
  });

  // --- #56 IMPA, tangent ---
  describe('m56_IMPAt', () => {
    it('oracle: equals ang(Tg-Me, L1T-L1A) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm56_IMPAt')).toBeCloseTo(ang(sub(p.Tg, p.Me), sub(p.L1T, p.L1A)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm56_IMPAt');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm56_IMPAt');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without Tg (not in ISBI19), IMPA tangent is null', () => {
      const { Tg: _tg, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m56_IMPAt).toBeNull();
    });
  });

  // --- #57 IMPA, Go-Me ---
  describe('m57_IMPAgome', () => {
    it('oracle: equals ang(Go-Me, L1T-L1A) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm57_IMPAgome')).toBeCloseTo(ang(sub(p.Go, p.Me), sub(p.L1T, p.L1A)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm57_IMPAgome');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm57_IMPAgome');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without L1A (not in ISBI19), IMPA Go-Me is null', () => {
      const { L1A: _l1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m57_IMPAgome).toBeNull();
    });
  });

  // --- #58 FMIA ---
  describe('m58_FMIA', () => {
    it('oracle: equals ang(L1T-L1A, Or-Po) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm58_FMIA')).toBeCloseTo(ang(sub(p.L1T, p.L1A), sub(p.Or, p.Po)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> smaller', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm58_FMIA');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm58_FMIA');
      expect(v5).toBeLessThan(v0);
    });
    it('missing point: without L1A (not in ISBI19), FMIA is null', () => {
      const { L1A: _l1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m58_FMIA).toBeNull();
    });
  });

  // --- Tweed's triangle: #22 + #56 + #58 = 180 ---
  // Ruling, fix round 1: the earlier 5-skull scoping was a fixture defect, not a real
  // exception, and has been fixed at the source (fixtures.ts: 'Tg' now moves with Me/Gn/Pog/B on
  // "SYNTHETIC short face", so the lower-border tangent keeps its real direction there too). The
  // identity now holds on all 6 synthetic skulls.
  it("Tweed's triangle closes: m22_FHMPt + m56_IMPAt + m58_FMIA = 180 on every synthetic skull", () => {
    for (const s of SYNTHETIC_SKULLS) {
      const v = gTweed.evaluate(s.points, mmPerPx);
      const total = sc(v, 'm22_FHMPt') + sc(v, 'm56_IMPAt') + sc(v, 'm58_FMIA');
      expect(total).toBeCloseTo(180, 9);
    }
  });

  // --- #59 L1-GoGn ---
  describe('m59_L1GoGn', () => {
    it('oracle: equals ang(Go-Gn, L1T-L1A) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm59_L1GoGn')).toBeCloseTo(ang(sub(p.Go, p.Gn), sub(p.L1T, p.L1A)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm59_L1GoGn');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm59_L1GoGn');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without L1A (not in ISBI19), L1-GoGn is null', () => {
      const { L1A: _l1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m59_L1GoGn).toBeNull();
    });
  });

  // --- #60 Occlusal plane to SN --- (brief gives no direction; oracle + "changes" check)
  describe('m60_OPSN', () => {
    it('oracle: equals ang(N-S, MInc-M6) (M6=mid(U6,L6), MInc=mid(U1T,L1T)) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const M6 = { x: (p.U6.x + p.L6.x) / 2, y: (p.U6.y + p.L6.y) / 2 };
        const MInc = { x: (p.U1T.x + p.L1T.x) / 2, y: (p.U1T.y + p.L1T.y) / 2 };
        expect(sc(v, 'm60_OPSN')).toBeCloseTo(ang(sub(p.N, p.S), sub(MInc, M6)), 9);
      }
    });
    it('behaviour: U6/L6 +60 px y (occlusal plane steeper) -> changes (oracle only, no stated direction)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm60_OPSN');
      const v1 = sc(g.evaluate({ ...p, U6: { x: p.U6.x, y: p.U6.y + 60 }, L6: { x: p.L6.x, y: p.L6.y + 60 } }, mmPerPx), 'm60_OPSN');
      expect(v1).not.toBeCloseTo(v0, 6);
    });
    it('missing point: without U6 (not in ISBI19), occlusal plane to SN is null', () => {
      const { U6: _u6, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m60_OPSN).toBeNull();
    });
  });

  // --- #61 Cant of occlusal plane ---
  describe('m61_CantOP', () => {
    it('oracle: equals the Downs-signed FH-OPd angle on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const M6 = { x: (p.U6.x + p.L6.x) / 2, y: (p.U6.y + p.L6.y) / 2 };
        const MInc = { x: (p.U1T.x + p.L1T.x) / 2, y: (p.U1T.y + p.L1T.y) / 2 };
        const FHd = sub(p.Or, p.Po);                                   // FH = line(Po,Or): direction Or-Po
        const NperpDir = { x: -FHd.y, y: FHd.x };                       // perpendicularThrough rotates +90
        const par2 = { x: M6.x + FHd.x, y: M6.y + FHd.y };              // m61_par: parallelThrough(M6, FH)
        const sgn = Math.sign(sdist(MInc, M6, par2, NperpDir)) || 1;
        const want = sgn * ang(FHd, sub(MInc, M6));
        expect(sc(v, 'm61_CantOP')).toBeCloseTo(want, 9);
      }
    });
    it('behaviour: MInc (U1T & L1T) moved 80 px down -> positive', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const moved = { ...p, U1T: { x: p.U1T.x, y: p.U1T.y + 80 }, L1T: { x: p.L1T.x, y: p.L1T.y + 80 } };
      const v1 = sc(g.evaluate(moved, mmPerPx), 'm61_CantOP');
      expect(v1).toBeGreaterThan(0);
    });
    it('behaviour: posterior end dropped (U6/L6 +80 px y) -> negative (Downs 1948 p.150)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const moved = { ...p, U6: { x: p.U6.x, y: p.U6.y + 80 }, L6: { x: p.L6.x, y: p.L6.y + 80 } };
      const v1 = sc(g.evaluate(moved, mmPerPx), 'm61_CantOP');
      expect(v1).toBeLessThan(0);
    });
    it('missing point: without U6 (not in ISBI19), cant of occlusal plane is null', () => {
      const { U6: _u6, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m61_CantOP).toBeNull();
    });
  });

  // --- #62 L1 to occlusal plane ---
  describe('m62_L1OPdev', () => {
    it('oracle: equals ang(M6-MInc, L1T-L1A) - 90 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const M6 = { x: (p.U6.x + p.L6.x) / 2, y: (p.U6.y + p.L6.y) / 2 };
        const MInc = { x: (p.U1T.x + p.L1T.x) / 2, y: (p.U1T.y + p.L1T.y) / 2 };
        const want = ang(sub(M6, MInc), sub(p.L1T, p.L1A)) - 90;         // OPdRev = line(MInc,M6): direction M6-MInc
        expect(sc(v, 'm62_L1OPdev')).toBeCloseTo(want, 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm62_L1OPdev');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm62_L1OPdev');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without U6 (not in ISBI19), L1 to occlusal plane is null', () => {
      const { U6: _u6, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m62_L1OPdev).toBeNull();
    });
  });

  // --- #63 U1 to A-Pog (mm) ---
  describe('m63_U1APog', () => {
    it('oracle: equals sdist(U1T,A,Pog,Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm63_U1APog')).toBeCloseTo(sdist(p.U1T, p.A, p.Pog, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm63_U1APog');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm63_U1APog');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without A, U1 to A-Pog is null', () => {
      const { A: _a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m63_U1APog).toBeNull();
    });
  });

  // --- #64 L1 to A-Pog (mm), tip ---
  describe('m64_L1APog', () => {
    it('oracle: equals sdist(L1T,A,Pog,Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm64_L1APog')).toBeCloseTo(sdist(p.L1T, p.A, p.Pog, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm64_L1APog');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm64_L1APog');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without A, L1 to A-Pog is null', () => {
      const { A: _a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m64_L1APog).toBeNull();
    });
  });

  // --- #66 L1 to A-Pog (deg) ---
  describe('m66_L1APogDeg', () => {
    it('oracle: equals ang(Pog-A, L1A-L1T) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm66_L1APogDeg')).toBeCloseTo(ang(sub(p.Pog, p.A), sub(p.L1A, p.L1T)), 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm66_L1APogDeg');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm66_L1APogDeg');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without L1A (not in ISBI19), L1 to A-Pog deg is null', () => {
      const { L1A: _l1a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m66_L1APogDeg).toBeNull();
    });
  });

  // --- #67 U1 to A-vertical (mm) ---
  describe('m67_U1Avert', () => {
    it('oracle: equals the A-vertical signed distance formula on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const toward = sub(p.Or, p.Po);
        const perp90 = (d: typeof toward) => ({ x: -d.y, y: d.x });
        const b2 = { x: p.A.x + perp90(toward).x, y: p.A.y + perp90(toward).y };
        expect(sc(v, 'm67_U1Avert')).toBeCloseTo(sdist(p.U1T, p.A, b2, toward) * 0.1, 9);
      }
    });
    it('behaviour: proclined (skull 5) -> larger', () => {
      const v0 = sc(g.evaluate(SYNTHETIC_SKULLS[0].points, mmPerPx), 'm67_U1Avert');
      const v5 = sc(g.evaluate(SYNTHETIC_SKULLS[5].points, mmPerPx), 'm67_U1Avert');
      expect(v5).toBeGreaterThan(v0);
    });
    it('missing point: without A, U1 to A-vertical is null', () => {
      const { A: _a, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m67_U1Avert).toBeNull();
    });
  });

  // --- #68 Overjet ---
  describe('m68_Overjet', () => {
    // Owner NUS-OP-1 (16 Oct 2026): along the standard occlusal plane (molar overlap -> incisor overlap), not the functional plane (C7).
    it('oracle: matches the OP-perpendicular-through-L1T signed distance formula (standard plane M6 -> MInc) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const M6 = { x: (p.U6.x + p.L6.x) / 2, y: (p.U6.y + p.L6.y) / 2 };
        const MInc = { x: (p.U1T.x + p.L1T.x) / 2, y: (p.U1T.y + p.L1T.y) / 2 };
        const fop = sub(MInc, M6);
        const perp90 = (d: typeof fop) => ({ x: -d.y, y: d.x });
        const b2 = { x: p.L1T.x + perp90(fop).x, y: p.L1T.y + perp90(fop).y };
        expect(sc(v, 'm68_Overjet')).toBeCloseTo(sdist(p.U1T, p.L1T, b2, fop) * 0.1, 9);
      }
    });
    it('behaviour: U1T +20 px x -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm68_Overjet');
      const v1 = sc(g.evaluate({ ...p, U1T: { x: p.U1T.x + 20, y: p.U1T.y } }, mmPerPx), 'm68_Overjet');
      expect(v1).toBeGreaterThan(v0);
    });
    it('behaviour: U1T moved behind L1T -> negative', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v1 = sc(g.evaluate({ ...p, U1T: { x: p.L1T.x - 60, y: p.U1T.y } }, mmPerPx), 'm68_Overjet');
      expect(v1).toBeLessThan(0);
    });
    it('NUS-OP-1: without P4, overjet is still measured (and unchanged)', () => {
      const p = SYNTHETIC_SKULLS[0].points, { P4: _p4, ...rest } = p;
      expect(sc(g.evaluate(rest, mmPerPx), 'm68_Overjet')).toBeCloseTo(sc(g.evaluate(p, mmPerPx), 'm68_Overjet'), 12);
    });
    it('missing point: without U6 (not in ISBI19), overjet is null', () => {
      const { U6: _u6, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m68_Overjet).toBeNull();
    });
  });

  // --- #69 Overbite ---
  describe('m69_Overbite', () => {
    it('oracle: matches the OP-parallel/perpendicular-through-L1T signed distance formula (standard plane M6 -> MInc) on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        const M6 = { x: (p.U6.x + p.L6.x) / 2, y: (p.U6.y + p.L6.y) / 2 };
        const MInc = { x: (p.U1T.x + p.L1T.x) / 2, y: (p.U1T.y + p.L1T.y) / 2 };
        const fop = sub(MInc, M6);
        const perp90 = (d: typeof fop) => ({ x: -d.y, y: d.x });
        const parLine2 = { x: p.L1T.x + fop.x, y: p.L1T.y + fop.y };
        const downDir = perp90(fop);
        expect(sc(v, 'm69_Overbite')).toBeCloseTo(sdist(p.U1T, p.L1T, parLine2, downDir) * 0.1, 9);
      }
    });
    it('behaviour: U1T +20 px y (deeper) -> larger', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm69_Overbite');
      const v1 = sc(g.evaluate({ ...p, U1T: { x: p.U1T.x, y: p.U1T.y + 20 } }, mmPerPx), 'm69_Overbite');
      expect(v1).toBeGreaterThan(v0);
    });
    it('behaviour: open bite (U1T 100 px up, clear of L1T) -> negative', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v1 = sc(g.evaluate({ ...p, U1T: { x: p.U1T.x, y: p.L1T.y - 100 } }, mmPerPx), 'm69_Overbite');
      expect(v1).toBeLessThan(0);
    });
    it('NUS-OP-1: without P4, overbite is still measured (and unchanged)', () => {
      const p = SYNTHETIC_SKULLS[0].points, { P4: _p4, ...rest } = p;
      expect(sc(g.evaluate(rest, mmPerPx), 'm69_Overbite')).toBeCloseTo(sc(g.evaluate(p, mmPerPx), 'm69_Overbite'), 12);
    });
    it('missing point: without U6 (not in ISBI19), overbite is null', () => {
      const { U6: _u6, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m69_Overbite).toBeNull();
    });
  });

  // --- #70a U6-NA (mm) ---
  describe('m70a_U6NA', () => {
    it('oracle: equals sdist(U6,N,A,Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm70a_U6NA')).toBeCloseTo(sdist(p.U6, p.N, p.A, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: U6 +40 px x (more anterior) -> larger (Steiner 1953 p. 750: ahead of NA reads positive)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm70a_U6NA');
      const v1 = sc(g.evaluate({ ...p, U6: { x: p.U6.x + 40, y: p.U6.y } }, mmPerPx), 'm70a_U6NA');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without U6 (not in ISBI19), U6-NA is null', () => {
      const { U6: _u6, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m70a_U6NA).toBeNull();
    });
  });

  // --- #70b L6-NB (mm) ---
  describe('m70b_L6NB', () => {
    it('oracle: equals sdist(L6,N,B,Or-Po) * 0.1 on every synthetic skull', () => {
      for (const s of SYNTHETIC_SKULLS) {
        const p = s.points, v = g.evaluate(p, mmPerPx);
        expect(sc(v, 'm70b_L6NB')).toBeCloseTo(sdist(p.L6, p.N, p.B, sub(p.Or, p.Po)) * 0.1, 9);
      }
    });
    it('behaviour: L6 +40 px x (more anterior) -> larger (Steiner 1953 p. 750: ahead of NA/NB reads positive)', () => {
      const p = SYNTHETIC_SKULLS[0].points;
      const v0 = sc(g.evaluate(p, mmPerPx), 'm70b_L6NB');
      const v1 = sc(g.evaluate({ ...p, L6: { x: p.L6.x + 40, y: p.L6.y } }, mmPerPx), 'm70b_L6NB');
      expect(v1).toBeGreaterThan(v0);
    });
    it('missing point: without L6 (not in ISBI19), L6-NB is null', () => {
      const { L6: _l6, ...rest } = SYNTHETIC_SKULLS[0].points;
      expect(g.evaluate(rest, mmPerPx).m70b_L6NB).toBeNull();
    });
  });

  it('the catalogue covers every landmark it requires', () => {
    const known = [...ISBI19, 'U1A', 'L1A', 'U6', 'L6', 'P4', 'Tg'];
    for (const e of live) for (const l of g.requiredLandmarks(e.id)) {
      expect(known).toContain(l);
    }
  });

  // Plausible-range guard (ruling after Task 5): every angle entry gets a generous
  // clinical band on skull 0. Bands are catalogue-pattern.md's (Tasks 6-7).
  describe('plausible range, skull 0', () => {
    const bands: [string, number, number][] = [
      ['m47_U1NAdeg', 0, 50], ['m50_L1NBdeg', 0, 60], ['m52_L1NAdeg', 0, 60], ['m53_Interincisal', 90, 180],
      ['m54_U1SN', 80, 130], ['m55_U1MxP', 85, 135], ['m56_IMPAt', 70, 120], ['m57_IMPAgome', 70, 120],
      ['m58_FMIA', 30, 90], ['m59_L1GoGn', 70, 120], ['m60_OPSN', 0, 35], ['m61_CantOP', -10, 25],
      ['m62_L1OPdev', -20, 40], ['m66_L1APogDeg', 0, 50],
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
