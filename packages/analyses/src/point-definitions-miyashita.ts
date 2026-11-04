import type { LandmarkId } from './landmarks';

/** Owner DEF-MIYA-1 (12 Oct): definitions for the points the catalogue appendix §2 does not define, from the Miyashita
 *  glossary, read twice independently and settled against the page images; written in
 *  our own words (P44-STRICT), with the glossary's printed page. The glossary itself stays out of git. */
export const MIYASHITA_SOURCE = 'Miyashita K, Contemporary Cephalometric Radiography, Glossary of Cephalometric Terms and Definitions';

export const MIYASHITA: Partial<Record<LandmarkId, { text: string; page: number }>> = {
  D: { text: 'Centre of the bony chin (symphysis) seen in profile, chosen by eye in the middle of its cross-section.', page: 254 },
  Cm: { text: 'Front-most point of the skin bridge between the nostrils, below the nose tip and ahead of subnasale.', page: 257 },
  Bo: { text: 'Top of the hollow in the skull base just behind the occipital condyles.', page: 249 },
  G: { text: 'Front-most point of the forehead skin in the midline, at about the height of the brow ridges.', page: 257 },
  GnS: { text: 'Point on the chin skin outline midway between its front-most and its lowest point.', page: 258 },
  MeS: { text: 'Lowest point of the chin skin outline.', page: 258 },
  St: { text: 'Midline point where the upper and lower lips touch when the lips rest together.', page: 258 },
  R1: { text: 'Deepest point of the hollow in the front edge of the ramus, just below the coronoid process.', page: 255 },
  R3: { text: 'Lowest point of the sigmoid notch, the dip in the upper ramus between condyle and coronoid process.', page: 255 },
  Pm: { text: 'Point on the front of the bony chin above pogonion where the outline turns from hollow to bulging.', page: 253 },
};

/** Looked for in the Miyashita glossary, not given its definition: no entry found, or the entry found describes a
 *  different point (owner question, Step 2) — PTM, PR and U6D are the latter, raised to the owner and left here
 *  for now. */
export const MIYASHITA_NOT_DEFINED: readonly LandmarkId[] = [
  'PTM', 'PR', 'Cerv', 'U6D', 'Tg', 'RT', 'R2', 'R4', 'DC', 'ULd', 'SPP', 'UPW', 'TM', 'LPW',
];
