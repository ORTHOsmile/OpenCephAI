import { describe, it, expect } from 'vitest';
import type { AnalysisDef, Expr, NodeId } from '@ceph/geometry';
import { compile } from '@ceph/geometry';
import { buildRegistry } from './registry';
import { ALL_ANALYSES, BUILT_INS } from './analyses';
import { LANDMARKS } from './landmarks';
import { SYNTHETIC_SKULLS } from './fixtures';

/** Part A task 8, the before/after proof. Ruling 3: the old BASE/STEINER/DOWNS/MCNAMARA are copied
 *  here as literals — the same `defs/{base,steiner,downs,mcnamara}.ts` content, verbatim — and
 *  compiled into their OWN graph, separately from the new catalogue graph, BEFORE those files are
 *  deleted. This test is the evidence that deleting them changed nothing (bar the one ruled
 *  exception), so it must still work with the files gone. */

// --- OLD_BASE: a literal copy of `defs/base.ts` (itself a verbatim alias of lines.ts' LINES, at
// the point this task started) --------------------------------------------------------------
const lm = (id: string): Expr => ({ kind: 'landmark', id });
const line = (a: NodeId, b: NodeId): Expr => ({ kind: 'line', a, b });
const mid = (a: NodeId, b: NodeId): Expr => ({ kind: 'midpoint', a, b });
const OLD_BASE: Record<NodeId, Expr> = {
  ...Object.fromEntries(Object.keys(LANDMARKS).map((id) => [id, lm(id)])),
  SN: line('S', 'N'), FH: line('Po', 'Or'), FH_post: line('Or', 'Po'), MxP: line('PNS', 'ANS'), PP: line('PNS', 'ANS'),
  GoMe: line('Go', 'Me'), MeGo: line('Me', 'Go'), GoGn: line('Go', 'Gn'), GnGo: line('Gn', 'Go'),
  MPt: line('Tg', 'Me'), MeTg: line('Me', 'Tg'),
  RamusT: line('Ar', 'RT'), GoC: { kind: 'intersection', l1: 'RamusT', l2: 'MPt' },
  GoCMe: line('GoC', 'Me'), MeGoC: line('Me', 'GoC'),
  NPog: line('N', 'Pog'), APog: line('A', 'Pog'), NA: line('N', 'A'), NB: line('N', 'B'), AB: line('A', 'B'), SGn: line('S', 'Gn'),
  Nperp: { kind: 'perpendicular', through: 'N', line: 'FH' },
  Avert: { kind: 'parallelThrough', through: 'A', line: 'Nperp' },
  NBa: line('N', 'Ba'), BaN: line('Ba', 'N'),
  GncR: { kind: 'intersection', l1: 'NPog', l2: 'MPt' },
  GncM: { kind: 'intersection', l1: 'NPog', l2: 'GoMe' },
  FacAxR: line('Pt', 'GncR'),
  PTV: { kind: 'perpendicular', through: 'PR', line: 'FH' },
  Xi: { kind: 'xiPoint', r1: 'R1', r2: 'R2', r3: 'R3', r4: 'R4', ref: 'FH' },
  PmXi: line('Pm', 'Xi'), XiDC: line('Xi', 'DC'),
  M6: mid('U6', 'L6'), MInc: mid('U1T', 'L1T'),
  OPd: line('M6', 'MInc'), OPdRev: line('MInc', 'M6'),
  FOP: line('M6', 'P4'),
  U1ax: line('U1A', 'U1T'), U1axRev: line('U1T', 'U1A'), L1ax: line('L1A', 'L1T'), L1axRev: line('L1T', 'L1A'),
  E: line('Prn', 'PogS'), H: line('PogS', 'UL'), HRev: line('UL', 'PogS'),
  STfac: line('Ns', 'SPogS'), HV: { kind: 'perpendicular', through: 'UL', line: 'FH' },
  PalKimAng: { kind: 'angleLines', l1: 'MxP', l2: 'FH' },
  PalKimPar: { kind: 'parallelThrough', through: 'PNS', line: 'FH' },
  PalKimSgn: { kind: 'signedDistance', p: 'ANS', line: 'PalKimPar', positiveAlong: 'Nperp' },
  PalKim: { kind: 'withSign', value: 'PalKimAng', signFrom: 'PalKimSgn' },
};

// --- OLD_STEINER / OLD_DOWNS / OLD_MCNAMARA: literal copies of `defs/{steiner,downs,mcnamara}.ts` ---
const OLD_STEINER: AnalysisDef = {
  id: 'steiner', name: 'Steiner',
  nodes: {
    SNA: { kind: 'angle3', a: 'S', vertex: 'N', b: 'A' }, SNB: { kind: 'angle3', a: 'S', vertex: 'N', b: 'B' },
    ANB: { kind: 'difference', a: 'SNA', b: 'SNB' }, SN_GoGn: { kind: 'angleLines', l1: 'SN', l2: 'GoGn' },
  },
  measurements: [
    { node: 'SNA', label: 'SNA' }, { node: 'SNB', label: 'SNB' }, { node: 'ANB', label: 'ANB' }, { node: 'SN_GoGn', label: 'SN–GoGn' },
  ],
};
const OLD_DOWNS: AnalysisDef = {
  id: 'downs', name: 'Downs',
  nodes: {
    FacialAngle: { kind: 'angleLines', l1: 'FH_post', l2: 'NPog' },
    NAPog: { kind: 'angle3', a: 'N', vertex: 'A', b: 'Pog' },
    A_to_NPog: { kind: 'signedDistance', p: 'A', line: 'NPog', positiveAlong: 'FH' },
    Convexity: { kind: 'supplementSigned', angle: 'NAPog', signFrom: 'A_to_NPog' },
    FMPA: { kind: 'angleLines', l1: 'FH', l2: 'GoMe' }, YAxis: { kind: 'angleLines', l1: 'FH', l2: 'SGn' },
  },
  measurements: [
    { node: 'FacialAngle', label: 'Facial angle' }, { node: 'Convexity', label: 'Angle of convexity' },
    { node: 'FMPA', label: 'Mandibular plane (FH)' }, { node: 'YAxis', label: 'Y-axis' },
  ],
};
const OLD_MCNAMARA: AnalysisDef = {
  id: 'mcnamara', name: 'McNamara',
  nodes: {
    A_Nperp: { kind: 'signedDistance', p: 'A', line: 'Nperp', positiveAlong: 'FH' },
    Pog_Nperp: { kind: 'signedDistance', p: 'Pog', line: 'Nperp', positiveAlong: 'FH' },
    LAFH: { kind: 'distance', a: 'ANS', b: 'Me' }, CoA: { kind: 'distance', a: 'Co', b: 'A' }, CoGn: { kind: 'distance', a: 'Co', b: 'Gn' },
    MaxMandDiff: { kind: 'difference', a: 'CoGn', b: 'CoA' },
  },
  measurements: [
    { node: 'A_Nperp', label: 'A to N-perpendicular' }, { node: 'Pog_Nperp', label: 'Pog to N-perpendicular' },
    { node: 'LAFH', label: 'Lower anterior face height (ANS–Me)' }, { node: 'CoA', label: 'Midface length (Co–A)' },
    { node: 'CoGn', label: 'Mandibular length (Co–Gn)' }, { node: 'MaxMandDiff', label: 'Maxillomandibular difference' },
  ],
};

const oldGraph = compile({ ...OLD_BASE, ...OLD_STEINER.nodes, ...OLD_DOWNS.nodes, ...OLD_MCNAMARA.nodes });
// Task 8 review, fix round 1: compile the new side the same way the app does — the production
// call is `buildRegistry(BUILT_INS)` (apps/desktop/src/App.tsx) — rather than `buildRegistry([])`.
// `catalogueNodes()` is still merged unconditionally either way, so this changes nothing the table
// below checks; it just matches the real call.
const newGraph = compile(buildRegistry(BUILT_INS));

const PAIRS: [string, string][] = [
  ['SNA', 'm01_SNA'], ['SNB', 'm02_SNB'], ['ANB', 'm03_ANB'], ['SN_GoGn', 'm20_SNGoGn'],
  ['FacialAngle', 'm04_FacialAngle'], ['Convexity', 'm05_Convexity'], ['YAxis', 'm24_YAxis'],
  ['A_Nperp', 'm08_ANperp'], ['Pog_Nperp', 'm09_PogNperp'], ['LAFH', 'm28_LAFH'],
  ['CoA', 'm10_CoA'], ['CoGn', 'm11_CoGn'], ['MaxMandDiff', 'm12_MaxMandDiff'],
];

describe('before/after: Steiner, Downs and McNamara keep their values (Part A task 8)', () => {
  for (const s of SYNTHETIC_SKULLS) {
    describe(s.name, () => {
      const oldV = oldGraph.evaluate(s.points, 0.1);
      const newV = newGraph.evaluate(s.points, 0.1);
      for (const [oldId, newId] of PAIRS) {
        it(`${oldId} === ${newId}`, () => {
          const o = oldV[oldId] as { t: 'scalar'; v: number } | null;
          const n = newV[newId] as { t: 'scalar'; v: number } | null;
          expect(o).not.toBeNull();
          expect(n).not.toBeNull();
          expect(n!.v).toBeCloseTo(o!.v, 12);
        });
      }
      it('the one ruled change: old Downs FMPA (Go–Me) now lives at m23_FHGoMe, not at Downs’ new #22', () => {
        const oldFMPA = (oldV.FMPA as { t: 'scalar'; v: number }).v;
        const newFHGoMe = (newV.m23_FHGoMe as { t: 'scalar'; v: number }).v;
        expect(newFHGoMe).toBeCloseTo(oldFMPA, 12);
      });
    });
  }

  it('positive control: this node-by-node comparison can detect a real difference — on skull 0, ' +
    'old FMPA (Go–Me) and new m22_FHMPt (the tangent) disagree, as ruling C2 means they must', () => {
    const p = SYNTHETIC_SKULLS[0].points;
    const oldFMPA = (oldGraph.evaluate(p, 0.1).FMPA as { t: 'scalar'; v: number }).v;
    const newFHMPt = (newGraph.evaluate(p, 0.1).m22_FHMPt as { t: 'scalar'; v: number }).v;
    expect(newFHMPt).not.toBeCloseTo(oldFMPA, 5);
  });

  it('Downs’ list uses m22_FHMPt (the tangent, ruling C2), never m23_FHGoMe', () => {
    const downs = ALL_ANALYSES.find((a) => a.id === 'downs')!;
    const nodes = downs.measurements.map((m) => m.node);
    expect(nodes).toContain('m22_FHMPt');
    expect(nodes).not.toContain('m23_FHGoMe');
  });
});
