import type { Expr, NodeId } from '@ceph/geometry';
import { LANDMARKS } from './landmarks';

const lm = (id: string): Expr => ({ kind: 'landmark', id });
const line = (a: NodeId, b: NodeId): Expr => ({ kind: 'line', a, b });
const mid = (a: NodeId, b: NodeId): Expr => ({ kind: 'midpoint', a, b });

/** Every landmark node, plus the shared lines and constructed points every analysis draws from.
 *  `PP` is kept as an alias of `MxP` (same line, PNS→ANS) because the desktop plane overlay
 *  (apps/desktop/src/canvas/overlayGeometry.ts) still reads node 'PP'. */
export const LINES: Record<NodeId, Expr> = {
  ...Object.fromEntries(Object.keys(LANDMARKS).map((id) => [id, lm(id)])),
  SN: line('S', 'N'), FH: line('Po', 'Or'), FH_post: line('Or', 'Po'), MxP: line('PNS', 'ANS'), PP: line('PNS', 'ANS'),
  GoMe: line('Go', 'Me'), MeGo: line('Me', 'Go'), GoGn: line('Go', 'Gn'), GnGo: line('Gn', 'Go'),
  MPt: line('Tg', 'Me'), MeTg: line('Me', 'Tg'),                                   // lower-border tangent (C2: Downs, Tweed, Ricketts, Kim)
  RamusT: line('Ar', 'RT'), GoC: { kind: 'intersection', l1: 'RamusT', l2: 'MPt' }, // ABO constructed gonion (slide 8)
  GoCMe: line('GoC', 'Me'), MeGoC: line('Me', 'GoC'),
  NPog: line('N', 'Pog'), APog: line('A', 'Pog'), NA: line('N', 'A'), NB: line('N', 'B'), AB: line('A', 'B'), SGn: line('S', 'Gn'),
  Nperp: { kind: 'perpendicular', through: 'N', line: 'FH' },                      // points down (inferior)
  Avert: { kind: 'parallelThrough', through: 'A', line: 'Nperp' },
  NBa: line('N', 'Ba'), BaN: line('Ba', 'N'),
  GncR: { kind: 'intersection', l1: 'NPog', l2: 'MPt' },                          // Ricketts constructed gnathion
  GncM: { kind: 'intersection', l1: 'NPog', l2: 'GoMe' },                         // McNamara constructed gnathion (his MP is Go–Me)
  FacAxR: line('Pt', 'GncR'),
  FacAxM: line('PTM', 'GncM'),                                                    // McNamara facial axis (#31)
  PTV: { kind: 'perpendicular', through: 'PR', line: 'FH' },
  Xi: { kind: 'xiPoint', r1: 'R1', r2: 'R2', r3: 'R3', r4: 'R4', ref: 'FH' },
  PmXi: line('Pm', 'Xi'), XiDC: line('Xi', 'DC'),
  M6: mid('U6', 'L6'), MInc: mid('U1T', 'L1T'),
  OPd: line('M6', 'MInc'), OPdRev: line('MInc', 'M6'),                             // Downs/Steiner occlusal plane, back → front
  FOP: line('M6', 'P4'),                                                          // functional occlusal plane (Jacobson), back → front
  U1ax: line('U1A', 'U1T'), U1axRev: line('U1T', 'U1A'), L1ax: line('L1A', 'L1T'), L1axRev: line('L1T', 'L1A'),
  E: line('Prn', 'PogS'), H: line('PogS', 'UL'), HRev: line('UL', 'PogS'),
  STfac: line('Ns', 'SPogS'), HV: { kind: 'perpendicular', through: 'UL', line: 'FH' },
  // Kim's palatal plane angle, signed: "upward and forward = negative; downward and forward = positive" (Kim 1974 p.590, item 5; Kim & Vietas 1978 p.622).
  // Shared by #14 APDI, #15 ODI and #27, so it lives here (Tasks 4 and 5 both use it).
  PalKimAng: { kind: 'angleLines', l1: 'MxP', l2: 'FH' },
  PalKimPar: { kind: 'parallelThrough', through: 'PNS', line: 'FH' },
  PalKimSgn: { kind: 'signedDistance', p: 'ANS', line: 'PalKimPar', positiveAlong: 'Nperp' },   // + when ANS is below (down)
  PalKim: { kind: 'withSign', value: 'PalKimAng', signFrom: 'PalKimSgn' },
};

/** The plain name of every shared line and built point (Part D, Task 1), named as the catalogue appendix §3 names it.
 *  Both directions of a line share one name. The internal Kim palatal helpers are named for what they are.
 *  definitions.test.ts fails if a LINES key has no name or a name has no LINES key. */
export const LINE_NAMES: Record<string, string> = {
  SN: 'SN (S–N)', FH: 'FH, Frankfort (Po–Or)', FH_post: 'FH, Frankfort (Po–Or)',
  MxP: 'Palatal plane (ANS–PNS)', PP: 'Palatal plane (ANS–PNS)',
  GoMe: 'Mandibular plane Go–Me', MeGo: 'Mandibular plane Go–Me', GoGn: 'Mandibular plane Go–Gn', GnGo: 'Mandibular plane Go–Gn',
  MPt: 'Mandibular plane, lower-border tangent (Tg–Me)', MeTg: 'Mandibular plane, lower-border tangent (Tg–Me)',
  RamusT: 'Ramus tangent (Ar–ramus tangent point)', GoC: 'Constructed gonion (ramus tangent × lower-border tangent)',
  GoCMe: 'Constructed gonion to menton', MeGoC: 'Constructed gonion to menton',
  NPog: 'Facial plane (N–Pog)', APog: 'A–Pog line', NA: 'N–A line', NB: 'N–B line', AB: 'A–B line', SGn: 'Y-axis (S–Gn)',
  Nperp: 'N-perpendicular (through N, at right angles to FH)', Avert: 'A-vertical (through A, parallel to the N-perpendicular)',
  NBa: 'Ba–N line', BaN: 'Ba–N line',
  GncR: "Ricketts' constructed gnathion (facial plane × mandibular plane)", GncM: "McNamara's constructed gnathion (facial plane × Go–Me)",
  FacAxR: "Facial axis, Ricketts (Pt to constructed gnathion)", FacAxM: "Facial axis, McNamara (PTM to constructed gnathion)",
  PTV: 'PTV, pterygoid vertical (through PR, at right angles to FH)', Xi: 'Xi point (centre of the ramus, from R1–R4)',
  PmXi: 'Corpus axis (Pm–Xi)', XiDC: 'Condyle axis (Xi–DC)',
  M6: 'Molar overlap (midpoint of U6 and L6)', MInc: 'Incisor overlap (midpoint of U1T and L1T)',
  OPd: 'Occlusal plane, Downs (molar overlap to incisor overlap)', OPdRev: 'Occlusal plane, Downs (molar overlap to incisor overlap)',
  FOP: 'Functional occlusal plane (molar overlap to premolar overlap)',
  U1ax: 'U1 long axis (apex to tip)', U1axRev: 'U1 long axis (apex to tip)', L1ax: 'L1 long axis (apex to tip)', L1axRev: 'L1 long axis (apex to tip)',
  E: "E-line (Prn–Pog′)", H: "H-line (Pog′–UL)", HRev: "H-line (Pog′–UL)",
  STfac: "Soft-tissue facial line (N′–soft tissue over suprapogonion)", HV: 'Holdaway vertical (through UL, at right angles to FH)',
  // Pre-flight P6: Kim's palatal helpers are named for what each one is.
  PalKimAng: 'Palatal plane to FH, angle without sign (helper)', PalKimPar: 'Line through PNS parallel to FH (helper for the sign)',
  PalKimSgn: 'Height of ANS above or below that line (helper for the sign)', PalKim: "Palatal plane to FH, signed by Kim's rule",
};
