import type { CatalogueEntry } from './types';
import { E } from './entry';

/** Skeletal, front-to-back: catalogue #1-19 (appendix §4, "Skeletal: front-to-back").
 *  Task 4 of Part A. Ids, labels and sources are the appendix rows verbatim; expressions and sign
 *  rules are from `task-4-brief.md`, chosen by their behaviour tests (catalogue-pattern.md). */
export const SKELETAL_AP: CatalogueEntry[] = [
  E('m01_SNA', '1', 'SNA', 'deg',
    { kind: 'angle3', a: 'S', vertex: 'N', b: 'A' },
    { mark: 'P', cite: 'Steiner 1953' }),

  E('m02_SNB', '2', 'SNB', 'deg',
    { kind: 'angle3', a: 'S', vertex: 'N', b: 'B' },
    { mark: 'P', cite: 'Steiner 1953' }),

  E('m03_ANB', '3', 'ANB', 'deg',
    { kind: 'difference', a: 'm01_SNA', b: 'm02_SNB' },
    { mark: 'P', cite: 'Steiner 1953' },
    { sign: '+ when A is ahead of B' }),

  E('m04_FacialAngle', '4', 'Facial angle', 'deg',
    { kind: 'angleLines', l1: 'FH_post', l2: 'NPog' },
    { mark: 'P', cite: 'Downs 1948; Ricketts 1981' }),

  E('m05_Convexity', '5', 'Angle of convexity', 'deg',
    { kind: 'supplementSigned', angle: 'm05_NAPog', signFrom: 'm05_sgn' },
    { mark: 'P', cite: 'Downs 1948' },
    {
      sign: '+ when A is ahead of N-Pog',
      nodes: {
        m05_NAPog: { kind: 'angle3', a: 'N', vertex: 'A', b: 'Pog' },
        m05_sgn: { kind: 'signedDistance', p: 'A', line: 'NPog', positiveAlong: 'FH' },
      },
    }),

  E('m06_ABPlane', '6', 'A–B plane angle', 'deg',
    { kind: 'withSign', value: 'm06_ang', signFrom: 'm06_sgn' },
    { mark: 'P', cite: 'Downs 1948' },
    {
      sign: '− when B is behind A',
      nodes: {
        m06_ang: { kind: 'angleLines', l1: 'AB', l2: 'NPog' },
        m06_par: { kind: 'parallelThrough', through: 'A', line: 'NPog' },
        m06_sgn: { kind: 'signedDistance', p: 'B', line: 'm06_par', positiveAlong: 'FH' },
      },
    }),

  E('m07_ANPog', '7', 'Convexity, A to N–Pog (mm)', 'mm',
    { kind: 'signedDistance', p: 'A', line: 'NPog', positiveAlong: 'FH' },
    { mark: 'P', cite: 'Ricketts 1960, 1981; S Holdaway' },
    { sign: '+ when A is ahead' }),

  E('m08_ANperp', '8', 'A to N-perpendicular (mm)', 'mm',
    { kind: 'signedDistance', p: 'A', line: 'Nperp', positiveAlong: 'FH' },
    { mark: 'P', cite: 'McNamara 1984' },
    { sign: '+ when A is ahead of the line' }),

  E('m09_PogNperp', '9', 'Pog to N-perpendicular (mm)', 'mm',
    { kind: 'signedDistance', p: 'Pog', line: 'Nperp', positiveAlong: 'FH' },
    { mark: 'P', cite: 'McNamara 1984' },
    { sign: '+ when Pog is ahead of the line' }),

  E('m10_CoA', '10', 'Co–A (mm)', 'mm',
    { kind: 'distance', a: 'Co', b: 'A' },
    { mark: 'P', cite: 'McNamara 1984' }),

  E('m11_CoGn', '11', 'Co–Gn (mm)', 'mm',
    { kind: 'distance', a: 'Co', b: 'Gn' },
    { mark: 'P', cite: 'McNamara 1984' }),

  E('m12_MaxMandDiff', '12', 'Maxillomandibular difference (mm)', 'mm',
    { kind: 'difference', a: 'm11_CoGn', b: 'm10_CoA' },
    { mark: 'P', cite: 'McNamara 1984' }),

  // Owner NUS-OP-1 (16 Oct 2026): every Wits on the standard occlusal plane (molar overlap -> incisor overlap, OPd),
  // not Jacobson's functional plane through the premolars (P4). Norms measured on the functional plane read 'close'.
  E('m13_Wits', '13', 'Wits (mm)', 'mm',
    { kind: 'signedDistance', p: 'm13_AO', line: 'm13_perp', positiveAlong: 'OPd' },
    { mark: 'P', cite: 'Jacobson 1975, p. 474 (sign); measured on the occlusal plane through the molars and incisors (set 16 Oct 2026; Jacobson used the functional plane)' },
    {
      sign: '"BO behind AO, a positive reading" (Jacobson 1975, p. 474), along the standard occlusal plane (NUS-OP-1)',
      nodes: {
        m13_AO: { kind: 'projection', p: 'A', line: 'OPd' },
        m13_BO: { kind: 'projection', p: 'B', line: 'OPd' },
        m13_perp: { kind: 'perpendicular', through: 'm13_BO', line: 'OPd' },
      },
    }),

  E('m14_APDI', '14', 'APDI', 'deg',
    { kind: 'sum', terms: ['m04_FacialAngle', 'm06_ABPlane', 'PalKim'] },
    { mark: 'P', cite: 'Kim & Vietas 1978' },
    { sign: '"facial angle plus or minus the A-B plane angle and again plus or minus the palatal plane angle" (Kim & Vietas 1978); the A-B plane carries Downs\' sign (#6); the palatal angle carries #27\'s sign: "When the palatal plane slopes in an upward and forward fashion, the angle is read as negative. When the plane relates to the Frankfort horizontal plane in a downward and forward fashion, it is read as positive." (Kim & Vietas 1978, p. 622, item 8)' }),

  E('m15_ODI', '15', 'ODI', 'deg',
    { kind: 'sum', terms: ['m15_ABMP', 'PalKim'] },
    { mark: 'P', cite: "Kim 1974 (onfile's version is wrong)", where: 'pp. 589–590' },
    {
      sign: 'A-B plane to mandibular plane, then the palatal angle (#27): "If the latter angle was positive, it was added to the former angle. If it was negative, it was subtracted from the former angle." (Kim 1974, p. 590, item 12); mandibular plane is "menton to the most inferior-posterior border of mandibular body" (Kim 1974, p. 589, item 3), i.e. the Tg→Me tangent',
      nodes: { m15_ABMP: { kind: 'angleLines', l1: 'AB', l2: 'MPt' } },
    }),

  E('m16_CF', '16', 'Combination factor', 'deg',
    { kind: 'sum', terms: ['m15_ODI', 'm14_APDI'] },
    { mark: 'S', cite: 'onfile' }),

  E('m17_ExtrIndex', '17', 'Extraction index', 'deg',
    { kind: 'alias', of: 'm16_CF' },
    { mark: 'S', cite: 'onfile' },
    { bands: [{ max: 149, label: 'Extraction' }, { max: 155.9, label: 'Borderline' }, { max: Infinity, label: 'Non-extraction' }] }),

  E('m18_PogNB', '18', 'Pog to NB (mm)', 'mm',
    { kind: 'signedDistance', p: 'Pog', line: 'NB', positiveAlong: 'FH' },
    { mark: 'S', cite: "onfile (Steiner's later papers)" },
    { sign: '+ when Pog is ahead' }),

  E('m19_U6PTV', '19', 'U6 to PTV (mm)', 'mm',
    { kind: 'signedDistance', p: 'U6D', line: 'PTV', positiveAlong: 'FH' },
    { mark: 'P', cite: 'Ricketts 1981', where: 'p. 136' },
    { sign: '+ when the molar is ahead of PTV; the appendix gives no sign convention of its own here' }),
];
