import type { CatalogueEntry } from './types';
import { E } from './entry';

/** Vertical and jaw shape: catalogue #20-44, #90-92 (appendix §4, "Skeletal: vertical and jaw
 *  shape"). Task 5 of Part A. Ids, labels and sources are the appendix rows verbatim; expressions
 *  and sign rules are from `task-5-brief.md`, chosen by their behaviour tests (catalogue-pattern.md).
 *
 *  Fix round 1 (after review): #26 SN-MxP previously used a `MxPRev` line to force a
 *  "ANS down -> smaller" behaviour test. The ruling: that test was the plan defect, not
 *  the expression: dropping ANS away from PNS genuinely OPENS the SN-palatal-plane angle, and the
 *  supplement `MxPRev` produced (174.3 degrees on the balanced skull) is not the clinical angle
 *  (~5.7 degrees) any textbook would report for SN-MxP. Reverted to plain `MxP`; `MxPRev` removed
 *  from lines.ts (nothing else referenced it). #92 L1-MP ABO was checked the same way in the first
 *  pass and needed no fix: plain `L1ax` already grows with proclination (an earlier hand-check
 *  that said otherwise had MeGoC's direction backwards; recomputed with the real line direction
 *  b-a, confirmed in catalogue-vertical.test.ts).
 */
export const VERTICAL: CatalogueEntry[] = [
  E('m20_SNGoGn', '20', 'SN–GoGn', 'deg',
    { kind: 'angleLines', l1: 'SN', l2: 'GoGn' },
    { mark: 'P', cite: 'Steiner 1953' }),

  E('m21_SNGoMe', '21', 'SN–GoMe (SN–MP)', 'deg',
    { kind: 'angleLines', l1: 'SN', l2: 'GoMe' },
    { mark: 'S', cite: 'onfile (ABO, Nagasaki)' }),

  E('m22_FHMPt', '22', 'FH–MP, tangent (FMA, Downs mandibular plane)', 'deg',
    { kind: 'angleLines', l1: 'FH', l2: 'MPt' },
    { mark: 'P', cite: 'Tweed 1946; Downs 1948; Ricketts 1981' }),

  E('m23_FHGoMe', '23', 'FH–GoMe', 'deg',
    { kind: 'angleLines', l1: 'FH', l2: 'GoMe' },
    { mark: 'P', cite: 'McNamara 1984; onfile (ABO FMA)' }),

  E('m24_YAxis', '24', 'Y-axis', 'deg',
    { kind: 'angleLines', l1: 'FH', l2: 'SGn' },
    { mark: 'P', cite: 'Downs 1948' }),

  E('m25_MMPA', '25', 'MMPA', 'deg',
    { kind: 'angleLines', l1: 'MxP', l2: 'GoMe' },
    { mark: 'T', cite: 'Naini; onfile (Eastman)' }),

  E('m26_SNMxP', '26', 'SN–MxP', 'deg',
    { kind: 'angleLines', l1: 'SN', l2: 'MxP' },
    { mark: 'T', cite: 'Naini; onfile (Eastman)' }),

  E('m27_PalFH', '27', 'Palatal plane to FH', 'deg',
    { kind: 'alias', of: 'PalKim' },
    { mark: 'P', cite: 'Ricketts 1981; Kim 1974' },
    { sign: '"When the palatal plane related to the Frankfort horizontal plane in an upward and forward fashion, the measurement was read as a negative angle. When the plane fell downward and forward, the angle was read as a positive measurement." (Kim 1974 p. 590, item 5; same rule in Kim & Vietas 1978 p. 622, item 8)' }),

  E('m28_LAFH', '28', 'LAFH, ANS–Me (mm)', 'mm',
    { kind: 'distance', a: 'ANS', b: 'Me' },
    { mark: 'P', cite: 'McNamara 1984' }),

  E('m29_LAFHpct', '29', 'LAFH %', '%',
    { kind: 'ratio', a: 'm28_LAFH', b: 'm29_NMe', percent: true },
    { mark: 'T', cite: 'Naini ("about 55%")' },
    { nodes: { m29_NMe: { kind: 'distance', a: 'N', b: 'Me' } } }),

  E('m30_FacAxisR', '30', 'Facial axis, Ricketts', 'deg',
    { kind: 'angleLines', l1: 'NBa', l2: 'FacAxR' },
    { mark: 'P', cite: 'Ricketts 1981' },
    { sign: '>90 means the chin point is up and forward (Ricketts 1981 p. 123)' }),

  E('m31_FacAxisM', '31', 'Facial axis, McNamara', 'deg',
    { kind: 'angleLines', l1: 'NBa', l2: 'FacAxM' },
    { mark: 'P', cite: 'McNamara 1984', where: 'p. 460' },
    { sign: 'The angle where the basion–nasion line crosses the facial axis (PTM to constructed gnathion): "A perpendicular relationship of the basion-nasion line and the facial axis is to be expected in a balanced face"; "deficient vertical facial development is indicated by positive values (values greater than 90°)" (McNamara 1984 p. 460). Measured as line against line, not the bracketed corner at PTM (owner ruling, 7 Oct 2026).' }),

  E('m32_OralGnomon', '32', 'Oral gnomon (onfile: "lower facial height")', 'deg',
    { kind: 'angle3', a: 'ANS', vertex: 'Xi', b: 'Pm' },
    { mark: 'P', cite: 'Ricketts 1981' }),

  E('m33_MandBend', '33', 'Mandibular bend', 'deg',
    { kind: 'angleLines', l1: 'PmXi', l2: 'XiDC' },
    { mark: 'P', cite: 'Ricketts 1981' }),

  E('m34_Saddle', '34', 'Saddle angle', 'deg',
    { kind: 'angle3', a: 'N', vertex: 'S', b: 'Ar' },
    { mark: 'S', cite: 'onfile, [source removed]; Naini' }),

  E('m35_Articular', '35', 'Articular angle', 'deg',
    { kind: 'angle3', a: 'S', vertex: 'Ar', b: 'Go' },
    { mark: 'S', cite: 'onfile, [source removed]' }),

  E('m36_Gonial', '36', 'Gonial angle', 'deg',
    { kind: 'angle3', a: 'Ar', vertex: 'Go', b: 'Me' },
    { mark: 'S', cite: 'onfile, [source removed]' }),

  E('m37_UpperGonial', '37', 'Upper gonial angle', 'deg',
    { kind: 'angle3', a: 'Ar', vertex: 'Go', b: 'N' },
    { mark: 'S', cite: 'onfile' }),

  E('m38_LowerGonial', '38', 'Lower gonial angle', 'deg',
    { kind: 'angle3', a: 'N', vertex: 'Go', b: 'Me' },
    { mark: 'S', cite: 'onfile' }),

  E('m39_SumAngles', '39', 'Sum of angles', 'deg',
    { kind: 'sum', terms: ['m34_Saddle', 'm35_Articular', 'm36_Gonial'] },
    { mark: 'S', cite: 'onfile, [source removed]' }),

  E('m40_SGo', '40', 'Posterior face height S–Go (mm)', 'mm',
    { kind: 'distance', a: 'S', b: 'Go' },
    { mark: 'S', cite: 'onfile; Naini' }),

  E('m41_NMe', '41', 'Anterior face height N–Me (mm)', 'mm',
    { kind: 'distance', a: 'N', b: 'Me' },
    { mark: 'S', cite: 'onfile; Naini' }),

  E('m42_Jarabak', '42', 'Jarabak ratio (%)', '%',
    { kind: 'ratio', a: 'm40_SGo', b: 'm41_NMe', percent: true },
    { mark: 'S', cite: 'onfile, [source removed]' }),

  E('m43_SNtoGoMe', '43', 'Cranial base to body', '',
    { kind: 'ratio', a: 'm43_SN', b: 'm43_GoMe', percent: false },
    { mark: 'S', cite: '[source removed]' },
    { nodes: { m43_SN: { kind: 'distance', a: 'S', b: 'N' }, m43_GoMe: { kind: 'distance', a: 'Go', b: 'Me' } } }),

  E('m44_ArStoArGo', '44', 'Posterior cranial base to ramus', '',
    { kind: 'ratio', a: 'm44_ArS', b: 'm44_ArGo', percent: false },
    { mark: 'S', cite: '[source removed]' },
    { nodes: { m44_ArS: { kind: 'distance', a: 'Ar', b: 'S' }, m44_ArGo: { kind: 'distance', a: 'Ar', b: 'Go' } } }),

  E('m90_SNMP_ABO', '90', 'SN–MP, ABO', 'deg',
    { kind: 'angleLines', l1: 'SN', l2: 'GoCMe' },
    { mark: 'P', cite: 'ABO 2025 slides (constructed gonion); menton per onfile' }),

  E('m91_FMA_ABO', '91', 'FMA, ABO', 'deg',
    { kind: 'angleLines', l1: 'FH', l2: 'GoCMe' },
    { mark: 'P', cite: 'ABO 2025 slides' }),

  E('m92_L1MP_ABO', '92', 'L1–MP, ABO', 'deg',
    { kind: 'angleLines', l1: 'MeGoC', l2: 'L1ax' },
    { mark: 'P', cite: 'ABO 2025 slides' }),
];
