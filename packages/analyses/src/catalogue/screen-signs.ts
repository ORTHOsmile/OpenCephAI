/** Screen words for "which way is plus" and for the private construction behind a measurement (Part D, Task 2 fix
 *  round 1; rulings T2-1 and T2-2, 12 Oct).
 *
 *  Every catalogue entry with a `sign` field is in exactly one of PLUS_IN_WHAT (its plain words, WHAT, already say
 *  which way is plus — chosen by meaning, and the phrase that says it is recorded so a test can check it is there) or
 *  PLUS_WORDS (the sign rule rewritten for the screen from the entry's own `sign` field and expression: the same
 *  meaning, plain clinical English, no new claim, no developer words). definitions.test.ts holds both to the catalogue.
 *  The catalogue `sign` fields are unchanged; they stay the developer record. */

/** Catalogue number → the phrase in WHAT that already says which way is plus. #56, #58, #77 and #83 carry a
 *  `sign` field that is not a direction rule (the value is an unsigned angle or distance); their words already say what
 *  that field says that a reader needs. */
export const PLUS_IN_WHAT: Record<string, string> = {
  '3': '+ when A is ahead of B',
  '5': '+ when A is ahead of N–Pog',
  '6': '− when B is behind A',
  '7': '+ when A is ahead',
  '8': '+ when A is ahead of the line',
  '9': '+ when Pog is ahead of the line',
  '13': '+ when BO is behind AO',
  '18': '+ when Pog is ahead',
  '19': '+ when the molar is ahead of PTV',
  '27': '− when the front tips up, + when it tips down',
  '31': '>90 = deficient vertical growth',
  '46': '+ when ahead',
  '56': 'Downs writes it as degrees above or below 90',
  '58': "third angle of Tweed's triangle",
  '61': '− when the back end drops below parallel',
  '63': '+ when ahead',
  '64': '+ when ahead',
  '71': '+ when the lip is ahead of the line',
  '72': '+ when the lip is ahead of the line',
  '77': 'About 3 mm below A',
  '79': 'basic thickness minus thickness at the vermilion',
  '80': '+ when the upper lip is ahead of the soft-tissue facial line, − when behind',
  '83': 'level with suprapogonion',
  '88': 'Above 180° when the profile is concave',
};

/** Catalogue number → which way is plus, for the screen, when WHAT does not say it. Each is the entry's own `sign`
 *  field in plain words; the citation the field gives is kept. Listed in the Task 2 report for the owner's glance. */
export const PLUS_WORDS: Record<string, string> = {
  '14': "The facial angle, plus the A–B plane angle with its own sign (negative when B is behind A, as in #6), plus the palatal plane angle with its own sign (negative when the front of the palatal plane tips up, positive when it tips down, as in #27) (Kim & Vietas 1978, p. 622)",
  '15': 'The palatal plane angle is added when it is positive (front tips down) and subtracted when it is negative (front tips up) (Kim 1974, p. 590)',
  '30': 'Above 90° means the chin point is up and forward (Ricketts 1981, p. 123)',
  '49': '+ when the lower incisor tip is ahead of N–B',
  '51': '+ when the lower incisor tip is ahead of N–A',
  // #62: owner's words, 12 Oct 2026 (Downs 1948 p. 151) — was an in-words phrase ("as degrees from 90").
  '62': '+ when the lower incisor crown tips forward (labially) of a right angle to the occlusal plane; − when it tips back (Downs 1948, p. 151)',
  '67': '+ when the upper incisor tip is ahead of the A-vertical',
  '68': '+ when the upper incisor tip is ahead of the lower incisor tip, along the occlusal plane (molars to incisors); − when it is behind',
  '69': '+ when the upper incisor tip is lower (deeper) than the lower incisor tip, at right angles to the occlusal plane (molars to incisors); − for an open bite',
  '70': '+ when the molar is ahead of the line, − when it is behind (Steiner 1953, p. 750)',
  '74': '+ when the nose tip is ahead of the Holdaway vertical (Holdaway, per AlBarakati 2012)',
  '75': '+ when the sulcus lies behind the Holdaway vertical, so the value is a depth (AlBarakati 2012, following Holdaway 1983)',
  '76': '+ when subnasale lies behind the H-line, so the value is a depth (AlBarakati 2012, following Holdaway 1983)',
  '81': '+ when the lower lip is ahead of the H-line',
  '82': '+ when the sulcus lies behind the H-line, so the value is a depth (AlBarakati 2012, following Holdaway 1983)',
};

/** NOTE-1 (owner-approved words, 12 Oct 2026): catalogue number → a note shown with the measurement's definition,
 *  for what a reader needs that is neither the plain words nor the sign rule. */
const TWEED = "Tweed's triangle: FMA + IMPA + FMIA = 180.";
export const NOTES: Record<string, string> = {
  '19': "The sign direction is the app's choice; the source gives none.",
  '31': '90° is the balanced reference (McNamara).',
  '56': `Shown as the raw angle; Downs wrote it as degrees above or below 90. ${TWEED}`,
  '58': TWEED,
};

/** Marks a helper the plain words (WHAT) already describe, so the screen adds no note for it. */
export const IN_WORDS = null;

const KIM = "The palatal plane angle takes Kim's sign from where ANS lies against a line through PNS parallel to FH: positive when ANS is below that line (the front tips down), negative when it is above.";
const AB_SIGN = 'The sign comes from where B lies against a line through A parallel to the facial plane (N–Pog).';
const WITS = 'AO and BO are the feet of perpendiculars dropped from A and B onto the occlusal plane (molars to incisors); the distance between them is measured along that plane.';
const CANT = 'The sign comes from whether the incisor overlap lies below (positive) or above (negative) a line through the molar overlap parallel to FH.';
const L1OP = 'The angle is read between the lower incisor axis and the occlusal plane running from the incisors back to the molars, and 90° is taken away.';
const OVERBITE = 'Measured at right angles to the occlusal plane (molars to incisors), from a line through the lower incisor tip parallel to it.';
const CHIN = 'Measured along a line through suprapogonion parallel to FH, from where it crosses the facial plane (N–Pog) to where it crosses the soft-tissue facial line.';
const ST_CONVEX = 'Whether subnasale lies ahead of or behind the line from glabella to soft-tissue pogonion decides whether the angle reads below or above 180°.';

/** Node id → a plain construction note, for every private helper (and the Kim palatal helpers in LINES) a measurement
 *  reaches that is not a named line or built point; IN_WORDS where WHAT already describes it. A note may also sit on an
 *  entry's own id when how it is measured differs from the source (#70). Each note was checked against the expression
 *  it describes (catalogue/*.ts, lines.ts). definitions.test.ts fails if a reached helper is in none of the places. */
export const CONSTRUCTION: Record<string, string | null> = {
  PalKim: KIM, PalKimAng: KIM, PalKimPar: KIM, PalKimSgn: KIM,
  m05_NAPog: IN_WORDS, m05_sgn: IN_WORDS,
  m06_ang: AB_SIGN, m06_par: AB_SIGN, m06_sgn: AB_SIGN,
  m13_AO: WITS, m13_BO: WITS, m13_perp: WITS,
  m15_ABMP: IN_WORDS,
  m29_NMe: IN_WORDS, m43_SN: IN_WORDS, m43_GoMe: IN_WORDS, m44_ArS: IN_WORDS, m44_ArGo: IN_WORDS,
  m61_ang: CANT, m61_par: CANT, m61_sgn: CANT,
  m62_raw: L1OP, m62_90: L1OP,
  m68_perp: 'Measured along the occlusal plane (molars to incisors), from a perpendicular to it through the lower incisor tip.',
  m69_par: OVERBITE, m69_down: OVERBITE,
  m70a_U6NA: 'Measured from the upper molar cusp point; Steiner measured from the most mesial point on its crown (p. 736) and set no standard.',
  m70b_L6NB: 'Measured from the lower molar cusp point; Steiner measured from the most mesial point on its crown (p. 736) and set no standard.',
  m77_A3: 'The point 3 mm below A is placed straight down from A, along the N-perpendicular (at right angles to FH).',
  m80_ang: IN_WORDS, m80_sgn: IN_WORDS,
  m83_l: CHIN, m83_h: CHIN, m83_s: CHIN,
  m88_a: ST_CONVEX, m88_l: ST_CONVEX, m88_s: ST_CONVEX, m88_ss: ST_CONVEX, m88_180: ST_CONVEX,
};
