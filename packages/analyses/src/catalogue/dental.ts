import type { CatalogueEntry } from './types';
import { E } from './entry';

/** Dental: catalogue #45-70 (appendix §4, "Dental"). Task 6 of Part A. Ids, labels and sources are
 *  the appendix rows verbatim; expressions and sign rules are from `task-6-brief.md`, chosen by
 *  their behaviour tests (catalogue-pattern.md). #45, #48 and #65 are retired by ruling C1 (every
 *  incisor-to-line distance uses the incisal tip, never the labial surface): kept as placeholders,
 *  `nodes: {}`, so their numbers are never reused.
 *
 *  #68 and #69 (Overjet, Overbite): the appendix marks their source "?" (a choice for the owner,
 *  C7). Ruling, fix round 1: the NUS/NDC sheet is NUS's own source document (the
 *  analysis's own paper, by the P/T/S/W definitions), and C7 is the owner's own ruling on how it
 *  is measured (6 Oct 2026) — so `mark: 'P'`, `cite: 'NUS/NDC sheet; method per owner ruling C7
 *  (6 Oct 2026)'`. (First pass had marked these `W`; corrected here.) */

const retired = (id: string, no: string, label: string, source: CatalogueEntry['source']): CatalogueEntry =>
  ({ id, no, label, unit: 'mm', source, nodes: {}, retired: true });

export const DENTAL: CatalogueEntry[] = [
  retired('m45_U1NAmmLabial', '45', 'Not used: C1 ruled the tip for all (#46)', { mark: 'P', cite: 'Steiner 1953' }),

  E('m46_U1NAmm', '46', 'U1–NA (mm), tip', 'mm',
    { kind: 'signedDistance', p: 'U1T', line: 'NA', positiveAlong: 'FH' },
    { mark: 'S', cite: 'Data on file (primary source being confirmed)' },
    { sign: '+ when ahead' }),

  E('m47_U1NAdeg', '47', 'U1–NA (°)', 'deg',
    { kind: 'angleLines', l1: 'NA', l2: 'U1ax' },
    { mark: 'P', cite: 'Steiner 1953; Radney' }),

  retired('m48_L1NBmmLabial', '48', 'Not used: C1 ruled the tip for all (#49)', { mark: 'P', cite: 'Steiner 1953' }),

  E('m49_L1NBmm', '49', 'L1–NB (mm), tip', 'mm',
    { kind: 'signedDistance', p: 'L1T', line: 'NB', positiveAlong: 'FH' },
    { mark: 'S', cite: 'Data on file (primary source being confirmed)' },
    { sign: '+ when ahead' }),

  E('m50_L1NBdeg', '50', 'L1–NB (°)', 'deg',
    { kind: 'angleLines', l1: 'NB', l2: 'L1axRev' },
    { mark: 'P', cite: 'Steiner 1953' }),

  E('m51_L1NAmm', '51', 'L1–NA (mm), tip', 'mm',
    { kind: 'signedDistance', p: 'L1T', line: 'NA', positiveAlong: 'FH' },
    { mark: 'S', cite: 'Data on file (primary source being confirmed)' },
    { sign: '+ when ahead' }),

  E('m52_L1NAdeg', '52', 'L1–NA (°)', 'deg',
    { kind: 'angleLines', l1: 'NA', l2: 'L1axRev' },
    { mark: 'S', cite: 'Data on file (primary source being confirmed)' }),

  E('m53_Interincisal', '53', 'Interincisal angle', 'deg',
    { kind: 'angleLines', l1: 'U1axRev', l2: 'L1axRev' },
    { mark: 'P', cite: 'Downs 1948, Steiner 1953' }),

  E('m54_U1SN', '54', 'U1–SN', 'deg',
    { kind: 'angleLines', l1: 'U1axRev', l2: 'SN' },
    { mark: 'S', cite: 'Data on file (primary source being confirmed); Naini' }),

  E('m55_U1MxP', '55', 'U1–MxP', 'deg',
    { kind: 'angleLines', l1: 'MxP', l2: 'U1axRev' },
    { mark: 'T', cite: 'Naini; Data on file (primary source being confirmed)' }),

  E('m56_IMPAt', '56', 'IMPA, tangent', 'deg',
    { kind: 'angleLines', l1: 'MeTg', l2: 'L1ax' },
    { mark: 'P', cite: 'Tweed 1946, Downs 1948' },
    { sign: 'Downs writes it as degrees above or below 90; third angle of Tweed\'s triangle, with the FH–mandibular plane angle (#22) and FMIA (#58)' }),

  E('m57_IMPAgome', '57', 'IMPA, Go–Me', 'deg',
    { kind: 'angleLines', l1: 'MeGo', l2: 'L1ax' },
    { mark: 'T', cite: 'Naini; Data on file (primary source being confirmed)' }),

  E('m58_FMIA', '58', 'FMIA', 'deg',
    { kind: 'angleLines', l1: 'L1ax', l2: 'FH' },
    { mark: 'P', cite: 'Tweed 1954' },
    { sign: "third angle of Tweed's triangle: FH–mandibular plane angle (#22) + IMPA, tangent (#56) + FMIA (#58) = 180" }),

  E('m59_L1GoGn', '59', 'L1–GoGn', 'deg',
    { kind: 'angleLines', l1: 'GnGo', l2: 'L1ax' },
    { mark: 'P', cite: 'Steiner 1953 chart' }),

  E('m60_OPSN', '60', 'Occlusal plane to SN', 'deg',
    { kind: 'angleLines', l1: 'SN', l2: 'OPd' },
    { mark: 'P', cite: 'Steiner 1953' }),

  E('m61_CantOP', '61', 'Cant of occlusal plane', 'deg',
    { kind: 'withSign', value: 'm61_ang', signFrom: 'm61_sgn' },
    { mark: 'P', cite: 'Downs 1948' },
    {
      sign: '− when the back end drops below parallel (Downs 1948 p.150); + when MInc sits below the FH-parallel through M6',
      nodes: {
        m61_ang: { kind: 'angleLines', l1: 'FH', l2: 'OPd' },
        m61_par: { kind: 'parallelThrough', through: 'M6', line: 'FH' },
        m61_sgn: { kind: 'signedDistance', p: 'MInc', line: 'm61_par', positiveAlong: 'Nperp' },
      },
    }),

  E('m62_L1OPdev', '62', 'L1 to occlusal plane', 'deg',
    { kind: 'difference', a: 'm62_raw', b: 'm62_90' },
    { mark: 'P', cite: 'Downs 1948' },
    {
      sign: 'as degrees from 90',
      nodes: {
        m62_raw: { kind: 'angleLines', l1: 'OPdRev', l2: 'L1ax' },
        m62_90: { kind: 'constant', v: 90, unit: 'deg' },
      },
    }),

  E('m63_U1APog', '63', 'U1 to A–Pog (mm)', 'mm',
    { kind: 'signedDistance', p: 'U1T', line: 'APog', positiveAlong: 'FH' },
    { mark: 'P', cite: 'Downs 1948' },
    { sign: '+ when ahead' }),

  E('m64_L1APog', '64', 'L1 to A–Pog (mm), tip', 'mm',
    { kind: 'signedDistance', p: 'L1T', line: 'APog', positiveAlong: 'FH' },
    { mark: 'P', cite: 'Ricketts 1981' },
    { sign: '+ when ahead' }),

  retired('m65_L1APogmmFacial', '65', 'Not used: C1 ruled the tip for all (#64)', { mark: 'P', cite: 'McNamara 1984' }),

  E('m66_L1APogDeg', '66', 'L1 to A–Pog (°)', 'deg',
    { kind: 'angleLines', l1: 'APog', l2: 'L1axRev' },
    { mark: 'P', cite: 'Ricketts 1960' }),

  E('m67_U1Avert', '67', 'U1 to A-vertical (mm)', 'mm',
    { kind: 'signedDistance', p: 'U1T', line: 'Avert', positiveAlong: 'FH' },
    { mark: 'P', cite: 'McNamara 1984' },
    { sign: '+ when ahead' }),

  E('m68_Overjet', '68', 'Overjet (mm)', 'mm',
    { kind: 'signedDistance', p: 'U1T', line: 'm68_perp', positiveAlong: 'OPd' },
    { mark: 'P', cite: 'NUS/NDC sheet; measured along the occlusal plane through the molars and incisors (set 16 Oct 2026)' },
    {
      sign: '+ when U1T is ahead of L1T along the standard occlusal plane (NUS-OP-1); − when U1T is behind L1T',
      nodes: { m68_perp: { kind: 'perpendicular', through: 'L1T', line: 'OPd' } },
    }),

  E('m69_Overbite', '69', 'Overbite (mm)', 'mm',
    { kind: 'signedDistance', p: 'U1T', line: 'm69_par', positiveAlong: 'm69_down' },
    { mark: 'P', cite: 'NUS/NDC sheet; measured at right angles to the occlusal plane through the molars and incisors (set 16 Oct 2026)' },
    {
      sign: '+ when U1T is deeper (more inferior) than L1T, at right angles to the standard occlusal plane (NUS-OP-1); − for an open bite',
      nodes: {
        m69_par: { kind: 'parallelThrough', through: 'L1T', line: 'OPd' },
        m69_down: { kind: 'perpendicular', through: 'L1T', line: 'OPd' },
      },
    }),

  E('m70a_U6NA', '70', 'U6–NA (mm)', 'mm',
    { kind: 'signedDistance', p: 'U6', line: 'NA', positiveAlong: 'FH' },
    { mark: 'P', cite: 'Steiner 1953' },
    {
      sign: '+ when the molar is ahead of the line; a molar behind it reads negative (Steiner 1953 p. 750: '
        + '"27 mm back of the line NA" = −27). The app measures from the molar cusp point (U6); Steiner '
        + 'measured from "the most mesial point on its crown" (p. 736) and set no standard.',
    }),

  E('m70b_L6NB', '70', 'L6–NB (mm)', 'mm',
    { kind: 'signedDistance', p: 'L6', line: 'NB', positiveAlong: 'FH' },
    { mark: 'P', cite: 'Steiner 1953' },
    {
      sign: '+ when the molar is ahead of the line; a molar behind it reads negative (Steiner 1953 p. 750: '
        + '"27 mm back of the line NA" = −27, same convention applied to NB). The app measures from the molar '
        + 'cusp point (L6); Steiner measured from "the most mesial point on its crown" (p. 736) and set no standard.',
    }),
];
