import { stripScreenMarkup } from './catalogue/screen-words';

export type LandmarkId =
  | 'S' | 'N' | 'Or' | 'Po' | 'A' | 'B' | 'Pog' | 'Me' | 'Gn' | 'Go'
  | 'L1T' | 'U1T' | 'UL' | 'LL' | 'Sn' | 'PogS' | 'PNS' | 'ANS' | 'Ar'
  | 'U1A' | 'L1A' | 'Co' | 'Ba' | 'Pt' | 'U6' | 'L6' | 'Prn' | 'Ns'
  | 'D' | 'Cm' | 'PTM' | 'PR' | 'Bo' | 'G' | 'GnS' | 'MeS' | 'Cerv' | 'ULs' | 'LLs' | 'St' | 'P4' | 'U6D' | 'Tg' | 'RT'
  | 'R1' | 'R2' | 'R3' | 'R4' | 'Pm' | 'DC' | 'SPog' | 'SPogS' | 'ULd' | 'U1L' | 'SPP' | 'UPW' | 'TM' | 'LPW';

type Cat = 'skeletal' | 'dental' | 'soft';
const d = (name: string, category: Cat, source: string, aiDetected = true) => ({ name, category, aiDetected, source });
export const LANDMARKS: Record<LandmarkId, { name: string; category: Cat; aiDetected: boolean; source: string }> = {
  S: d('Sella', 'skeletal', 'Naini Table 7.1; ISBI 2015'), N: d('Nasion', 'skeletal', 'Naini Table 7.1; ISBI 2015'),
  Or: d('Orbitale', 'skeletal', 'Naini Table 7.1; ISBI 2015'), Po: d('Porion', 'skeletal', 'Naini Table 7.1; ISBI 2015'),
  A: d('Subspinale (A)', 'skeletal', 'Naini Table 7.1; ISBI 2015'), B: d('Supramentale (B)', 'skeletal', 'Naini Table 7.1; ISBI 2015'),
  Pog: d('Pogonion', 'skeletal', 'Naini Table 7.1; ISBI 2015'),
  Me: d('Menton', 'skeletal', 'Naini Table 7.1; ISBI 2015'), Gn: d('Gnathion', 'skeletal', 'Naini Table 7.1; ISBI 2015'),
  Go: d('Gonion', 'skeletal', 'Naini Table 7.1; ISBI 2015'),
  L1T: d('Lower incisor tip', 'dental', 'Naini Table 7.1; ISBI 2015'), U1T: d('Upper incisor tip', 'dental', 'Naini Table 7.1; ISBI 2015'),
  UL: d('Upper lip', 'soft', 'Naini Table 7.3; ISBI 2015'), LL: d('Lower lip', 'soft', 'Naini Table 7.3; ISBI 2015'),
  Sn: d('Subnasale', 'soft', 'Naini Table 7.3; ISBI 2015'), PogS: d('Soft-tissue pogonion', 'soft', 'Naini Table 7.3; ISBI 2015; Aariz config.py "Soft Tissue Pogonion"'),
  PNS: d('Posterior nasal spine', 'skeletal', 'Naini Table 7.1; ISBI 2015'), ANS: d('Anterior nasal spine', 'skeletal', 'Naini Table 7.1; ISBI 2015'),
  Ar: d('Articulare', 'skeletal', 'Naini Table 7.1; ISBI 2015'),
  U1A: d('Upper incisor apex', 'dental', 'Naini Table 7.1; Aariz config.py "Upper Incisor Apex"', false), L1A: d('Lower incisor apex', 'dental', 'Naini Table 7.1; Aariz config.py "Lower Incisor Apex"', false),
  Co: d('Condylion', 'skeletal', 'Naini Table 7.1; Aariz config.py "Condylion"', false), Ba: d('Basion', 'skeletal', 'Naini Table 7.1', false),
  Pt: d('Pterygoid point', 'skeletal', 'Naini Table 7.1', false),
  // Aariz config.py (github.com/manwaarkhd/aariz-cephalometric-dataset) gives each point a title only, no written
  // definition; the title is cited beside Naini's definition for every point Aariz finds (final review M6).
  // Decision 20: names only. How each analysis uses them (e.g. which molar point defines the occlusal plane) comes from
  // its Tier 0 paper when that analysis is built (reference/norms/SOURCES.md), never from memory.
  U6: d('Upper first molar', 'dental', 'Naini Table 7.1; Aariz config.py "Upper Molar Cusp Tip" (which cusp: not stated; to confirm on films)', false), L6: d('Lower first molar', 'dental', 'Naini Table 7.1; Aariz config.py "Lower Molar Cusp Tip" (which cusp: not stated; to confirm on films)', false),
  Prn: d('Pronasale', 'soft', 'Naini Table 7.3; Aariz config.py "Pronasale"', false), Ns: d('Soft-tissue nasion', 'soft', 'Naini Table 7.3 (deepest point of nasal root); CL-Detection #35; Aariz config.py "Soft Tissue Nasion"', false),
  D: d('Point D (centre of symphysis)', 'skeletal', 'Steiner via Naini Table 7.1; CL-Detection 2023 Fig 3 #20', false),
  Cm: d('Columella', 'soft', 'CL-Detection 2023 Fig 3 #23', false),
  PTM: d('Pterygomaxillary fissure, top-back point', 'skeletal', 'McNamara 1984 p460; CL-Detection #24', false),
  PR: d('Back of pterygopalatine fossa (PTV point)', 'skeletal', 'Ricketts 1981 p136', false),
  Bo: d('Bolton point', 'skeletal', 'Naini Table 7.1; CL-Detection #29', false),
  G: d('Soft-tissue glabella', 'soft', 'Naini Table 7.3; CL-Detection #34', false),
  GnS: d('Soft-tissue gnathion', 'soft', 'Naini Table 7.3; CL-Detection #32', false),
  MeS: d('Soft-tissue menton', 'soft', 'Naini Table 7.3; CL-Detection #33', false),
  Cerv: d('Cervical point', 'soft', 'Naini Table 7.3; CL-Detection #36', false),
  ULs: d('Upper lip sulcus (soft-tissue A)', 'soft', "Naini Table 7.3 (supralabiale); CL-Detection #30 UL′, to confirm on films (Part B)", false),
  LLs: d('Lower lip sulcus (soft-tissue B)', 'soft', "Naini Table 7.3 (sublabiale); CL-Detection #31 LL′, to confirm on films (Part B)", false),
  St: d('Stomion', 'soft', 'Naini Table 7.3', false),
  P4: d('Premolar cusp overlap', 'dental', 'Jacobson 1975 (functional occlusal plane)', false),
  U6D: d('Upper first molar, distal surface', 'dental', 'Ricketts 1981 p136', false),
  Tg: d('Lower-border tangent point (near the angle)', 'skeletal', 'Downs 1948 p150; Tweed 1946 p187; Kim 1974 p589', false),
  RT: d('Ramus tangent point', 'skeletal', 'ABO 2025 slide 8 (constructed gonion)', false),
  R1: d('Ramus point R1 (deepest point of the anterior ramus border)', 'skeletal', 'Ricketts 1981 p131', false),
  R2: d('Ramus point R2 (posterior ramus border, opposite R1)', 'skeletal', 'Ricketts 1981 p131', false),
  R3: d('Ramus point R3 (deepest point of the sigmoid notch)', 'skeletal', 'Ricketts 1981 p131', false),
  R4: d('Ramus point R4 (lower border, below R3)', 'skeletal', 'Ricketts 1981 p131', false),
  Pm: d('Protuberance menti', 'skeletal', 'Ricketts 1981 p131', false),
  DC: d('Centre of the condyle neck', 'skeletal', 'Ricketts 1981 p130', false),
  SPog: d('Suprapogonion', 'skeletal', 'AlBarakati 2012 (Ricketts 1957)', false),
  SPogS: d('Soft tissue over suprapogonion', 'soft', 'AlBarakati 2012', false),
  ULd: d('Upper lip drape, level with the point 3 mm below A', 'soft', 'AlBarakati 2012', false),
  U1L: d('Most labial point of the U1 crown', 'dental', 'AlBarakati 2012 (upper lip thickness); Steiner 1953', false),
  SPP: d('Back of the soft palate (front half)', 'soft', 'McNamara 1984 p463', false),
  UPW: d('Upper pharyngeal wall point', 'soft', 'McNamara 1984 p463', false),
  TM: d('Tongue × lower border of mandible', 'soft', 'McNamara 1984 p463', false),
  LPW: d('Lower pharyngeal wall point', 'soft', 'McNamara 1984 p463', false),
};
/** Model output channel order (ISBI-2015). */
export const ISBI19: readonly LandmarkId[] = ['S','N','Or','Po','A','B','Pog','Me','Gn','Go','L1T','U1T','UL','LL','Sn','PogS','PNS','ANS','Ar'];
export const MANUAL_ONLY: readonly LandmarkId[] = ['U1A', 'L1A', 'Co', 'Ba', 'Pt', 'U6', 'L6', 'Prn', 'Ns',
  'D', 'Cm', 'PTM', 'PR', 'Bo', 'G', 'GnS', 'MeS', 'Cerv', 'ULs', 'LLs', 'St', 'P4', 'U6D', 'Tg', 'RT',
  'R1', 'R2', 'R3', 'R4', 'Pm', 'DC', 'SPog', 'SPogS', 'ULd', 'U1L', 'SPP', 'UPW', 'TM', 'LPW'];

/** What each point is, in the words of the catalogue appendix §2 ("What it is (Naini)"), for the points that table
 *  defines (Part D, Task 1). Rows naming two points (ANS, PNS; U1T, L1T; UL, LL; U1A, L1A; U6, L6; SPog, SPogS)
 *  give both the same words. Points the table does not define show their name and source only.
 *  definitions.test.ts holds this equal to the appendix (net of RAW_POINT_DEFINITIONS -> POINT_DEFINITIONS'
 *  screen-markup stripping below, review fix round 1, Minor 4). */
const RAW_POINT_DEFINITIONS: Partial<Record<LandmarkId, string>> = {
  S: 'Geometric centre of the pituitary fossa',
  N: 'Junction of the internasal and frontonasal sutures',
  Or: 'Lowest point on the inferior orbital rim',
  Po: 'Top of the external auditory meatus (anatomical, not machine)',
  A: 'Deepest point of the maxillary alveolar concavity, ANS to prosthion',
  B: 'Deepest point of the mandibular alveolar concavity',
  Pog: 'Most anterior point of the bony chin',
  Gn: 'Most anterior-inferior point of the bony chin',
  Me: 'Lowest point of the symphysis',
  Go: 'Most inferior-posterior point of the jaw angle (C3)',
  Ar: 'Where the back of the ramus crosses the base of the skull',
  ANS: 'Tips of the anterior and posterior nasal spines',
  PNS: 'Tips of the anterior and posterior nasal spines',
  U1T: 'Incisal tips of the most labial upper and lower central incisor',
  L1T: 'Incisal tips of the most labial upper and lower central incisor',
  UL: 'Most prominent point of the upper and lower lip',
  LL: 'Most prominent point of the upper and lower lip',
  Sn: 'Where the columella meets the upper lip',
  PogS: 'Most anterior point of the soft-tissue chin',
  U1A: 'Root apex of the most anterior upper and lower central incisor',
  L1A: 'Root apex of the most anterior upper and lower central incisor',
  U1L: 'Most labial point of the incisor crown (Steiner 1953)',
  U6: 'Mesiobuccal cusp tips of the first molars (our definition; Aariz\'s own title is only "Upper/Lower Molar Cusp Tip", which cusp unstated — to confirm on films)',
  L6: 'Mesiobuccal cusp tips of the first molars (our definition; Aariz\'s own title is only "Upper/Lower Molar Cusp Tip", which cusp unstated — to confirm on films)',
  P4: 'Where the first premolar cusps overlap',
  Co: 'Most posterior-superior point of the condylar head',
  Ba: 'Lowest point on the anterior margin of the foramen magnum',
  Pt: 'Back of the pterygomaxillary fissure (Ricketts). A second definition, the lower border of the foramen rotundum, is used for Ricketts\' facial axis in §3. CL-Detection 2023\'s "PT" (SRPose point 28) is mapped to this Pt; which of the two it means is **unconfirmed** (eye-check on films)',
  Prn: 'Most prominent point of the nasal tip',
  Ns: 'Deepest point of the nasal root (C5)',
  ULs: 'Deepest point of the upper lip contour, Sn to Ls',
  LLs: 'Deepest point of the mentolabial fold',
  SPog: "Ricketts' point on the chin, and the skin over it",
  SPogS: "Ricketts' point on the chin, and the skin over it",
};
/** Screen-facing version of RAW_POINT_DEFINITIONS, with the appendix's own editorial markup stripped
 *  (`**`, "in §N", ruling codes like "(C3)") — review fix round 1, Minor 4. */
export const POINT_DEFINITIONS: Partial<Record<LandmarkId, string>> = Object.fromEntries(
  Object.entries(RAW_POINT_DEFINITIONS).map(([id, text]) => [id, stripScreenMarkup(text as string)]),
) as Partial<Record<LandmarkId, string>>;
/** Matches a point whose meaning is still to be confirmed on films: "to confirm" (U6, L6, ULs, LLs' own appendix
 *  words) or "unconfirmed" (Pt's), but never "confirmed" alone — review fix round 1, Minor 6: the naive /confirm/i
 *  also matched "confirmed", so a point newly confirmed on films (e.g. "confirmed on films, 14 Oct") would have
 *  stayed flagged forever. Exported so definitions.test.ts can check the boundary directly. */
export const UNCONFIRMED_PATTERN = /\bto confirm\b|\bunconfirmed\b/i;
/** Points whose meaning is still to be confirmed on films (owner, 7 Oct): their source or definition says so. Derived
 *  from the words, not listed by hand, so confirming a point (editing its words) takes it off the list. */
export const UNCONFIRMED_POINTS: ReadonlySet<LandmarkId> = new Set(
  (Object.keys(LANDMARKS) as LandmarkId[]).filter((id) =>
    UNCONFIRMED_PATTERN.test(`${LANDMARKS[id].source} ${POINT_DEFINITIONS[id] ?? ''}`),
  ),
);
