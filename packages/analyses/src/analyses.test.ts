import { describe, it, expect } from 'vitest';
import type { AnalysisDef } from '@ceph/geometry';
import { compile } from '@ceph/geometry';
import { ALL_ANALYSES, BUILT_INS, buildRegistry, DOWNS, MCNAMARA, STEINER, analysis } from './index';
import { CATALOGUE, byId } from './catalogue';
import { SYNTHETIC_SKULLS } from './fixtures';
import { LANDMARKS, ISBI19, MANUAL_ONLY } from './landmarks';

const g = compile(buildRegistry(ALL_ANALYSES));
const deg = (a: { x: number; y: number }, v: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.acos(((a.x - v.x) * (b.x - v.x) + (a.y - v.y) * (b.y - v.y)) / (Math.hypot(a.x - v.x, a.y - v.y) * Math.hypot(b.x - v.x, b.y - v.y))) * 180 / Math.PI;

/** Appendix §5 sizes: #70 counts as two ids (Steiner 14). */
const SIZES: Record<string, number> = {
  steiner: 14, downs: 10, mcnamara: 12, ricketts: 11, tweed: 3, 'bjork-jarabak': 11, wits: 1,
  eastman: 9, holdaway: 12, 'e-line': 2, kim: 4, abo: 12, nagasaki: 8, radney: 4, nus: 18,   // NUS 18: BaSN (#93) added, owner ruling 7 Nov 2026
};

/** The ids of every analysis whose measurement count disagrees with the appendix (`SIZES`).
 *  Task 8 review, fix round 1: pulled out of the test itself so the positive control below can
 *  exercise the real comparison on an engineered case, instead of restating the arithmetic
 *  (`16 !== 17`) next to the test that is supposed to be checking it. */
const sizeMismatches = (defs: AnalysisDef[]): string[] => defs.filter((d) => d.measurements.length !== SIZES[d.id]).map((d) => d.id);

describe('the 15 analyses (Part A task 8)', () => {
  it('compile together without graph errors', () => { expect(g.order.length).toBeGreaterThan(30); });

  it('carry no norms (§9: norms only from the verified database)', () => {
    for (const d of ALL_ANALYSES) for (const m of d.measurements) expect(Object.keys(m).sort()).toEqual(['label', 'node']);
  });

  it('every list id exists in the catalogue and is not retired', () => {
    for (const d of ALL_ANALYSES) for (const m of d.measurements) {
      const e = byId(m.node);
      expect(e).toBeDefined();
      expect(e.retired).not.toBe(true);
    }
  });

  it('every measurement node exists and is a scalar', () => {
    for (const d of ALL_ANALYSES) for (const m of d.measurements) expect(g.typeOf(m.node)).toBe('scalar');
  });

  it('every measurement\'s required points are in LANDMARKS', () => {
    for (const d of ALL_ANALYSES) for (const m of d.measurements)
      for (const l of g.requiredLandmarks(m.node)) expect(LANDMARKS[l as keyof typeof LANDMARKS]).toBeDefined();
  });

  it('there are exactly 15 analyses, with the ids from the appendix', () => {
    expect(ALL_ANALYSES.map((a) => a.id).sort()).toEqual(
      ['abo', 'bjork-jarabak', 'downs', 'e-line', 'eastman', 'holdaway', 'kim', 'mcnamara',
        'nagasaki', 'nus', 'radney', 'ricketts', 'steiner', 'tweed', 'wits'].sort(),
    );
  });

  it('analysis sizes match the appendix', () => {
    expect(sizeMismatches(ALL_ANALYSES)).toEqual([]);
  });

  it('positive control: sizeMismatches can fail — drop one id from a copy of NUS and watch it get flagged', () => {
    const nus = ALL_ANALYSES.find((a) => a.id === 'nus')!;
    const shortened: AnalysisDef = { ...nus, measurements: nus.measurements.slice(0, -1) };
    const rest = ALL_ANALYSES.filter((a) => a.id !== 'nus');
    expect(sizeMismatches([...rest, shortened])).toEqual(['nus']);
  });

  it('BUILT_INS is exactly Steiner, Downs, McNamara (the app shows the same three until Part D)', () => {
    expect(BUILT_INS.map((a) => a.id)).toEqual(['steiner', 'downs', 'mcnamara']);
    expect(BUILT_INS).toContain(STEINER); expect(BUILT_INS).toContain(DOWNS); expect(BUILT_INS).toContain(MCNAMARA);
  });

  it('Steiner SNA/SNB/ANB match a hand calculation on every synthetic skull', () => {
    for (const s of SYNTHETIC_SKULLS) {
      const v = g.evaluate(s.points, 0.1), p = s.points;
      const sna = deg(p.S, p.N, p.A), snb = deg(p.S, p.N, p.B);
      expect((v.m01_SNA as { v: number }).v).toBeCloseTo(sna, 9);
      expect((v.m02_SNB as { v: number }).v).toBeCloseTo(snb, 9);
      expect((v.m03_ANB as { v: number }).v).toBeCloseTo(sna - snb, 9);
    }
  });

  it('Co is manual-only: m10_CoA is null until it is placed, and m12_MaxMandDiff needs Co, A and Gn', () => {
    const s = SYNTHETIC_SKULLS[0];
    const { Co: _co, ...withoutCo } = s.points;
    expect(g.evaluate(withoutCo, 0.1).m10_CoA).toBeNull();
    expect([...g.requiredLandmarks('m12_MaxMandDiff')]).toEqual(expect.arrayContaining(['Co', 'A', 'Gn']));
    expect(g.evaluate(s.points, 0.1).m10_CoA).not.toBeNull();
  });

  it('McNamara A–Nperp (m08_ANperp) is positive when A is anterior to the nasion perpendicular', () => {
    const p = { ...SYNTHETIC_SKULLS[0].points };
    const v1 = g.evaluate({ ...p, A: { x: p.N.x + 30, y: p.A.y } }, 0.1).m08_ANperp as { v: number };
    const v2 = g.evaluate({ ...p, A: { x: p.N.x - 30, y: p.A.y } }, 0.1).m08_ANperp as { v: number };
    expect(v1.v).toBeGreaterThan(0); expect(v2.v).toBeLessThan(0);
  });

  it('Downs convexity (m05_Convexity) is 0 when N, A and Pog are collinear', () => {
    const p = { ...SYNTHETIC_SKULLS[0].points };
    const Pog = { x: p.N.x + 2 * (p.A.x - p.N.x), y: p.N.y + 2 * (p.A.y - p.N.y) };
    expect((g.evaluate({ ...p, Pog }, 0.1).m05_Convexity as { v: number }).v).toBeCloseTo(0, 9);
  });

  it('the catalogue covers every landmark the rules use', () => {
    // Every measurement's required points being in LANDMARKS is checked once, above
    // ("every measurement's required points are in LANDMARKS") — not repeated here (Task 8 review,
    // fix round 1: this loop and that one were an exact duplicate).
    for (const id of new Set([...ISBI19, ...MANUAL_ONLY])) expect(LANDMARKS[id]).toBeDefined();
  });

  it('rejects two analyses that define one id differently', () => {
    expect(() => buildRegistry([{ id: 'x', name: 'x', nodes: { m01_SNA: { kind: 'distance', a: 'S', b: 'N' } }, measurements: [] }]))
      .toThrow(/m01_SNA/);
  });

  it('decision 20: molar, pronasale and soft-tissue nasion are placeable by hand', () => {
    expect(MANUAL_ONLY).toEqual(['U1A', 'L1A', 'Co', 'Ba', 'Pt', 'U6', 'L6', 'Prn', 'Ns',
      'D', 'Cm', 'PTM', 'PR', 'Bo', 'G', 'GnS', 'MeS', 'Cerv', 'ULs', 'LLs', 'St', 'P4', 'U6D', 'Tg', 'RT',
      'R1', 'R2', 'R3', 'R4', 'Pm', 'DC', 'SPog', 'SPogS', 'ULd', 'U1L', 'SPP', 'UPW', 'TM', 'LPW']);
    for (const id of MANUAL_ONLY) expect(LANDMARKS[id].aiDetected).toBe(false);
    expect(LANDMARKS.Prn.category).toBe('soft');
  });

  it('analysis(): builds an AnalysisDef with no private nodes, labelled from the catalogue', () => {
    const a = analysis('x', 'X', ['m01_SNA', 'm02_SNB']);
    expect(a).toEqual({
      id: 'x', name: 'X', nodes: {},
      measurements: [{ node: 'm01_SNA', label: byId('m01_SNA').label }, { node: 'm02_SNB', label: byId('m02_SNB').label }],
    });
  });

  it('CATALOGUE has no duplicate ids', () => {
    const ids = CATALOGUE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
