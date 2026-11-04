import { AGE_NOT_ENTERED_WORDS, FILM_DATE_MISSING_WORDS, type NormFlag } from './resolve';

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What each resolver flag means on screen (Part D): a short badge in the norm cell and a hover sentence. The resolver's
 *  full source line is always shown too. A Record over NormFlag, so a new flag without words fails to compile — and
 *  flags.test.ts compares these keys with resolve.ts's NORM_FLAGS, so a mismatch fails at run time too. */
export const FLAG_WORDS: Record<NormFlag, { badge: string; tip: string }> = {
  website: { badge: 'website value', tip: 'Website value, not from a paper. Shown, never coloured.' },
  close: { badge: 'close', tip: 'The paper measured this a little differently. The difference is in the source line.' },
  unverified: { badge: 'read once', tip: 'Read from the paper once, not yet checked by a second reading.' },
  'age-mismatched': { badge: 'other age', tip: "No row for the patient's age, so the nearest age was used." },
  'sex-pooled': { badge: 'sexes pooled', tip: 'The paper splits this by sex, but the row used is for both sexes together.' },
  'user-norm': { badge: 'user norm', tip: 'Your own norm, entered in Settings ▸ Norms.' },
  'second-hand': { badge: 'via', tip: 'Quoted by a later paper, not read in the original. The source line names it.' },
  'sd-from-other-paper': { badge: 'SD from another paper', tip: "This paper's mean with the SD of a cited paper, named in the source line." },
  'converted-to-true-size': { badge: 'true size', tip: 'Measured on an enlarged film. Shown at true size; the printed value is in the source line.' },
  'scale-assumed': { badge: 'assumed scale', tip: 'The paper does not state its film scale. Assumed true size, as modern papers report. Colours kept.' },
  'sd-borrowed': { badge: 'SD borrowed', tip: 'The paper printed no SD. One is borrowed from the closest matching paper, named in the source line.' },
  // Ruling T4-1 (Task 4 fix round 1): 'ideal' is now raised only on a coloured cell; 'ideal-uncoloured' below.
  ideal: { badge: 'ideal', tip: "The author's ideal value, not a sample average. Coloured using an SD; the source line says whose." },
  interpolated: { badge: 'age-interpolated', tip: "Worked out between the two printed ages either side of the patient's age." },
  'other-sex-values': { badge: "other sex's values", tip: 'The author printed these values for one sex only; they are used for the other too.' },
  'sexes-averaged': { badge: 'sexes averaged', tip: "Men's and women's norms averaged — record sex for the exact norm." },
  /** Owner AGE-UNK-1 (12 Oct): no date of birth or film date, so an adult is assumed. The resolver's own words
   *  (AGE_NOT_ENTERED_WORDS, already in the source line) plus the one thing the clinician can do about it. */
  'age-assumed-adult': { badge: 'age not entered', tip: `${capitalise(AGE_NOT_ENTERED_WORDS)} — enter the age for the exact norm.` },
  // Ruling T4-1 (Task 4 fix round 1): new flags, each raised on one path only. Words for owner approval.
  'age-unknown-oldest-row': {
    badge: 'age not entered, no adult row',
    tip: "Age not entered, and this source has no usable adult row, so its oldest row was used — it may not suit the patient's age. Enter the age for the exact norm.",
  },
  'sd-other-age': { badge: 'SD from another age', tip: "The SD is taken from the cited paper's row for a different age group than the norm's; the source line gives that age." },
  'sd-sexes-pooled': { badge: 'SD from both sexes', tip: "The SD is taken from the cited paper's row for both sexes together, while the norm is for one sex." },
  'sd-close': { badge: 'SD row measured differently', tip: 'The SD is taken from a row the cited paper measured a little differently. The difference is in the source line.' },
  'sd-converted': { badge: 'SD at true size', tip: 'The SD comes from a paper measured on an enlarged film. It is shown at true size; the printed SD is in the source line.' },
  'ideal-uncoloured': { badge: 'ideal',   // owner, 16 Oct: "don't need not coloured"; the tip still says it
    tip: "The author's ideal value, not a sample average. No SD could be used with it, so it is not coloured." },
  // Owner FILMDATE-1 (12 Oct): the owner's own sentence; the badge is ours (owner glance).
  'film-date-missing': { badge: 'film date missing', tip: `${capitalise(FILM_DATE_MISSING_WORDS)}. Enter the date the film was taken for the exact norm.` },
  // Owner NORM-PICK-1 (12 Oct). Words for owner glance.
  'chosen-by-you': { badge: 'chosen by you', tip: "The case's population has no norm for this, so you chose this source for this case. Click to choose another." },
};
/** Owner, 12 Oct (SEX-AVG-1): the one-line hint for an averaged or other-sex-copied result when the patient's sex is
 *  not recorded — shown once above the Measurements table (Tasks 5-6) and offered by normCell's `hint` field. */
export const SEX_NOT_RECORDED_HINT = 'Sex not recorded — record it for the exact norm.';
/** What "no population chosen" means (N6 a): one wording for Settings and the case picker (pre-flight P15). */
export const OWN_NORMS_LABEL = "each analysis's own norms";
/** Owner NORM-PICK-1 (12 Oct), ruling FR-1: the facts beside each source in the "choose one" list — who the row used is,
 *  its n (both rows' when the sexes are averaged) and its ages, from normChoices, in one wording. */
export const choiceFacts = (c: { rows: { who: string; n: number | null }[]; ages: string | null }): string =>
  `${c.rows.map((r) => `${r.who}, ${r.n !== null ? `n = ${r.n}` : 'n not stated'}`).join(' + ')} · ${c.ages ?? 'ages not stated'}`;
