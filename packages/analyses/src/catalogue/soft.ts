import type { CatalogueEntry } from './types';
import { E } from './entry';

/** Soft tissue and airway: catalogue #71-89 (appendix §4, "Soft tissue and airway"). Task 7 of Part
 *  A. Ids, labels and sources are the appendix rows verbatim; expressions and sign rules are from
 *  `task-7-brief.md`, chosen by their behaviour tests (catalogue-pattern.md).
 *
 *  Holdaway sign convention (AlBarakati 2012, following Holdaway 1983), noted below in `sign` where
 *  a value is signed: superior/inferior sulcus depth (#75, #82) and subnasale-to-H-line (#76) are
 *  DEPTHS, + when the point lies BEHIND the line — hence `FH_post` (the reversed Frankfort line) as
 *  `positiveAlong`. Nose prominence (#74) and the lip-to-line distances (#71, #72, #81) are + when
 *  the point is AHEAD — hence plain `FH`.
 *
 *  Source marks for #86-89: unlike every other row in #1-85, the appendix gives these four no
 *  leading P/T/S/W letter (they are "new" measurements, M2-M5 in the spec, not yet on the appendix's
 *  established list). Ruling (after the first pass's judgment call was raised as a
 *  concern): the mark follows where each measurement's DEFINITION comes from, not just the first
 *  named source. #86 and #89 have no defining paper on file (Moate & Darendeliler 2002 is named but
 *  not held), so `S`; #87's definition is Steiner's SND as Naini's textbook gives it, so `T`; #88's
 *  definition is read directly from its own paper (Zheng 2026, Table 3), so `P`. No longer open for
 *  the owner. */
export const SOFT: CatalogueEntry[] = [
  E('m71_ULE', '71', 'Upper lip to E-line (mm)', 'mm',
    { kind: 'signedDistance', p: 'UL', line: 'E', positiveAlong: 'FH' },
    { mark: 'P', cite: 'Ricketts 1960' },
    { sign: '+ when the lip is ahead of the line' }),

  E('m72_LLE', '72', 'Lower lip to E-line (mm)', 'mm',
    { kind: 'signedDistance', p: 'LL', line: 'E', positiveAlong: 'FH' },
    { mark: 'P', cite: 'Ricketts 1960, 1981' },
    { sign: '+ when the lip is ahead of the line' }),

  E('m73_STFacial', '73', 'Soft-tissue facial angle', 'deg',
    { kind: 'angleLines', l1: 'FH_post', l2: 'STfac' },
    { mark: 'S', cite: 'AlBarakati (page 1 of Holdaway seen)' }),

  E('m74_NoseProm', '74', 'Nose prominence (mm)', 'mm',
    { kind: 'signedDistance', p: 'Prn', line: 'HV', positiveAlong: 'FH' },
    { mark: 'S', cite: 'AlBarakati' },
    { sign: '+ when ahead (Holdaway, per AlBarakati 2012)' }),

  E('m75_SupSulcus', '75', 'Superior sulcus depth (mm)', 'mm',
    { kind: 'signedDistance', p: 'ULs', line: 'HV', positiveAlong: 'FH_post' },
    { mark: 'S', cite: 'AlBarakati' },
    { sign: '+ when the sulcus lies behind the line (a depth); AlBarakati 2012, following Holdaway 1983' }),

  E('m76_SnH', '76', 'Subnasale to H-line (mm)', 'mm',
    { kind: 'signedDistance', p: 'Sn', line: 'H', positiveAlong: 'FH_post' },
    { mark: 'S', cite: 'AlBarakati' },
    { sign: '+ when Sn lies behind the line (a depth); AlBarakati 2012, following Holdaway 1983' }),

  E('m77_BasicUL', '77', 'Basic upper lip thickness (mm)', 'mm',
    { kind: 'distance', a: 'm77_A3', b: 'ULd' },
    { mark: 'S', cite: 'AlBarakati' },
    {
      sign: '"a point about 3 mm below point A to the drape of the upper lip" (AlBarakati 2012); below = down, along Nperp',
      nodes: { m77_A3: { kind: 'offsetPoint', p: 'A', along: 'Nperp', mm: 3 } },
    }),

  E('m78_ULThick', '78', 'Upper lip thickness (mm)', 'mm',
    { kind: 'distance', a: 'U1L', b: 'UL' },
    { mark: 'S', cite: 'AlBarakati' }),

  E('m79_ULStrain', '79', 'Upper lip strain (mm)', 'mm',
    { kind: 'difference', a: 'm77_BasicUL', b: 'm78_ULThick' },
    { mark: 'S', cite: 'AlBarakati, Google' },
    // Owner LIP-2 (8 Oct 2026): flipped to Holdaway's direction; before 8 Oct this was #78 − #77.
    { sign: '#77 minus #78 (Holdaway: basic thickness minus thickness at the vermilion; normal about +1 to +2 mm)' }),

  E('m80_HAngle', '80', 'H-angle', 'deg',
    { kind: 'withSign', value: 'm80_ang', signFrom: 'm80_sgn' },
    { mark: 'S', cite: "AlBarakati (onfile's version is wrong)" },
    {
      sign: '+ when the upper lip is ahead of the soft-tissue facial line (Ns-SPogS), - when behind (a lip behind the line reads negative, as reported clinically in concave Class III faces)',
      nodes: {
        m80_ang: { kind: 'angleLines', l1: 'STfac', l2: 'HRev' },
        m80_sgn: { kind: 'signedDistance', p: 'UL', line: 'STfac', positiveAlong: 'FH' },
      },
    }),

  E('m81_LLH', '81', 'Lower lip to H-line (mm)', 'mm',
    { kind: 'signedDistance', p: 'LL', line: 'H', positiveAlong: 'FH' },
    { mark: 'S', cite: 'AlBarakati, onfile' },
    { sign: '+ when ahead' }),

  E('m82_InfSulcusH', '82', 'Inferior sulcus to H-line (mm)', 'mm',
    { kind: 'signedDistance', p: 'LLs', line: 'H', positiveAlong: 'FH_post' },
    { mark: 'S', cite: 'AlBarakati' },
    { sign: '+ when the sulcus lies behind the line (a depth); AlBarakati 2012, following Holdaway 1983' }),

  E('m83_ChinThick', '83', 'Soft-tissue chin thickness (mm)', 'mm',
    { kind: 'distance', a: 'm83_h', b: 'm83_s' },
    { mark: 'S', cite: 'AlBarakati' },
    {
      sign: 'between the hard (N-Pog) and soft (Ns-SPogS) facial lines, level with suprapogonion (a horizontal, FH-parallel, through SPog)',
      nodes: {
        m83_l: { kind: 'parallelThrough', through: 'SPog', line: 'FH' },
        m83_h: { kind: 'intersection', l1: 'm83_l', l2: 'NPog' },
        m83_s: { kind: 'intersection', l1: 'm83_l', l2: 'STfac' },
      },
    }),

  E('m84_UpperPharynx', '84', 'Upper pharynx (mm)', 'mm',
    { kind: 'distance', a: 'SPP', b: 'UPW' },
    { mark: 'P', cite: 'McNamara' }),

  E('m85_LowerPharynx', '85', 'Lower pharynx (mm)', 'mm',
    { kind: 'distance', a: 'TM', b: 'LPW' },
    { mark: 'P', cite: 'McNamara' }),

  E('m86_Nasolabial', '86', 'Nasolabial angle (new, M2)', 'deg',
    { kind: 'angle3', a: 'Cm', vertex: 'Sn', b: 'UL' },
    { mark: 'S', cite: 'Moate & Darendeliler 2002 (Tables IV-VI); Gu 2011; McNamara 1984 cites Scheideman' }),

  E('m87_SND', '87', 'SND (new, M3)', 'deg',
    { kind: 'angle3', a: 'S', vertex: 'N', b: 'D' },
    { mark: 'T', cite: "Naini Ch. 7 (Steiner's SND; also Zheng 2026, Mohammad 2011)" }),

  E('m88_STConvexity', '88', "Soft-tissue convexity G-Sn-Pog' (new, M4)", 'deg',
    { kind: 'difference', a: 'm88_180', b: 'm88_ss' },
    { mark: 'P', cite: 'Zheng 2026', where: 'Table 3' },
    {
      sign: 'value = a (angle3 G,Sn,PogS) when Sn is ahead of the line G-Pog\' (convex, the normal case); 360 - a when Sn is behind it (concave): plain angle3 is unsigned and caps at 180, so it reads a DECREASING value past the point where G, Sn and Pog\' become collinear, the wrong direction for "more convex"',
      nodes: {
        m88_a: { kind: 'angle3', a: 'G', vertex: 'Sn', b: 'PogS' },
        m88_l: { kind: 'line', a: 'G', b: 'PogS' },
        m88_s: { kind: 'signedDistance', p: 'Sn', line: 'm88_l', positiveAlong: 'FH' },
        m88_ss: { kind: 'supplementSigned', angle: 'm88_a', signFrom: 'm88_s' },
        m88_180: { kind: 'constant', v: 180, unit: 'deg' },
      },
    }),

  E('m89_ULLength', '89', 'Upper lip length (new, M5)', 'mm',
    { kind: 'distance', a: 'Sn', b: 'St' },
    { mark: 'S', cite: 'Moate & Darendeliler 2002 (Tables IV-V)' }),
];
