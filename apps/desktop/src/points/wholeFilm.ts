// SC-1 Part 1 task 8: the whole-film note's words and lines (spec §3.5). A note, not a verdict: nothing here moves, accepts
// or holds anything. The words are the owner's, verbatim (plan Global Constraints); plain, never "the tracing is wrong".
import type { ResolveReason, WholeCheckView, WholeFilmView } from '../ipc';
export type { ResolveReason };

/** The stored region key to the owner's words. */
export const REGION_WORDS: Record<string, string> = {
  'cranial-base': 'cranial base', maxilla: 'maxilla', mandible: 'mandible', incisors: 'incisors', 'soft-tissue': 'soft-tissue profile' };

export const WHOLE_WORDS = {
  region: (r: string, ids: string) => `Whole-film check: the ${r} points do not sit on the ${r} this film shows (${ids}).`,
  regions: (list: string) => `Whole-film check: the tracing's points do not sit where this film's regions are (it may be at the wrong size, or belong to another film): ${list}.`,
  mirrored: 'Whole-film check: this tracing looks mirrored: it faces the other way from the film.',
  facing: "Whole-film check: the face on this film seems to point the other way from the film's recorded facing. Check the film's facing and Re-detect.",
  shape: (named: string) => `Whole-film check: this tracing's overall shape is unlike the expert tracings (furthest out: ${named}). Look at the whole tracing.`,
  /** `f` is the stored factor (exp(q − centre)): ×0.5 half the size, ×2.0 double. One decimal. A missing factor says it without a number. */
  size: (f: number | null | undefined) => f == null
    ? 'Whole-film check: this tracing is a different size from the anatomy on this film. Look at the whole tracing.'
    : `Whole-film check: this tracing is about ×${f.toFixed(1)} the size of the anatomy on this film. Look at the whole tracing.`,
  sizeNotSetUp: 'Whole-film check: size not checked (not set up).',
  /** The size look needs all 19 points; fewer than 3 regions found is the no-skull line instead. */
  sizeTooFew: 'Whole-film check: size not judged: incomplete tracing (all 19 points needed).',
  centreTooFew: 'Whole-film check: cranial-base centre not judged: S, N, Po, Ar and Or all needed.',
  centreNoBox: 'Whole-film check: cranial-base centre not judged: no cranial-base box found on this film.',
  centreNotSetUp: 'Whole-film check: cranial-base centre not checked (not set up).',
  shapeNotSetUp: 'Whole-film check: tracing shape not checked (not set up).',
  noCeph: 'Whole-film check: the region finder found no skull on this film.',
  tooFew: (n: number) => `Whole-film check not run: only ${n} of 19 points found.`,
  notSetUp: 'Whole-film check not set up.',
  regionsOff: {
    'no-region-model': 'Whole-film check: regions not checked (not set up: download the check model in Models…).',
    'not-set-up': 'Whole-film check: regions not checked (the region finder is not set up).',
    'film-too-small': 'Whole-film check: regions not checked (the film is too small).',
  } as Record<string, string>,
  hover: 'A note, not a verdict. It checks the tracing against the film in boxes; it does not judge errors under about 10 mm.',
  checked: 'Checked',
  reasons: { 'tracing-right': 'Tracing is right', 'expected-variant': 'Expected variant (cleft, syndrome, surgery)', 'corrected-tracing': 'I corrected the tracing' } as Record<ResolveReason, string>,
  resolvedAs: (r: ResolveReason) => `Checked: ${WHOLE_WORDS.reasons[r]}`,
} as const;

/** The three reasons, in the order they are offered. */
export const RESOLVE_REASONS: ResolveReason[] = ['tracing-right', 'expected-variant', 'corrected-tracing'];

/** The size look's and the cranial-base centre's own lines when they did not judge (whole-film/2). Only when the regions were
 *  looked at (otherwise the regions-not-checked line already says why). Size: an incomplete tracing (fewer than 19 points) is the
 *  one cause of `too-few` the note can tell from the row; fewer than 3 regions found is the no-skull line. Centre: its own stored
 *  status; `too-few` is a cranial-base point missing (cbPresent below 5: the points wording) or all five traced but no
 *  cranial-base box (the stored count, not the total, decides). */
function notJudgedLines(c: WholeCheckView): string[] {
  if (c.regionLook !== 'judged') return [];
  const out: string[] = [];
  if (c.sizeLook === 'not-set-up') out.push(WHOLE_WORDS.sizeNotSetUp);
  else if (c.sizeLook === 'too-few' && c.present < 19) out.push(WHOLE_WORDS.sizeTooFew);
  const noSkull = c.reasons.some((r) => r.reason === 'no-ceph-found');   // fewer than 3 regions: the no-skull line says it
  if (c.cbLook === 'not-set-up') out.push(WHOLE_WORDS.centreNotSetUp);
  else if (c.cbLook === 'too-few' && !noSkull) out.push(c.cbPresent < 5 ? WHOLE_WORDS.centreTooFew : WHOLE_WORDS.centreNoBox);
  return out;
}

/** The note's lines for the shown check, in order (M11): mirrored (or facing, never both), shape, one region line or the combined
 *  one, size, no skull; then, for a check that is not flagged, the not-run or regions-not-checked line. `null` (nothing read
 *  yet, or no shown check): no lines. */
export function noteLines(c: WholeCheckView | null): string[] {
  if (!c) return [];
  if (c.outcome === 'not-run') return [c.shapeLook === 'too-few-points' ? WHOLE_WORDS.tooFew(c.present) : WHOLE_WORDS.notSetUp];
  // I3 (final review): a shape look that was not set up says so, so a quiet note is not read as a shape check that ran.
  const shapeOff = c.shapeLook === 'not-set-up' ? [WHOLE_WORDS.shapeNotSetUp] : [];
  if (c.outcome === 'clean') return [...shapeOff, ...(c.regionLook === 'judged' ? notJudgedLines(c) : [WHOLE_WORDS.regionsOff[c.regionLook] ?? WHOLE_WORDS.regionsOff['not-set-up']])];
  const out: string[] = [];
  const has = (k: string) => c.reasons.some((r) => r.reason === k);
  if (has('mirrored')) out.push(WHOLE_WORDS.mirrored);
  else if (has('facing')) out.push(WHOLE_WORDS.facing);
  const shape = c.reasons.find((r) => r.reason === 'shape');
  out.push(...shapeOff);
  if (shape) out.push(WHOLE_WORDS.shape(shape.named.join(', ')));
  const regions: { word: string; ids: string }[] = [];
  for (const r of c.reasons) {
    if (r.reason !== 'region') continue;
    const word = REGION_WORDS[r.region ?? ''] ?? r.region ?? '';
    if (!regions.some((x) => x.word === word)) regions.push({ word, ids: r.ids.join(', ') });
  }
  if (regions.length === 1) out.push(WHOLE_WORDS.region(regions[0].word, regions[0].ids));
  else if (regions.length > 1) out.push(WHOLE_WORDS.regions(regions.map((x) => x.word).join(', ')));
  const size = c.reasons.find((r) => r.reason === 'size');
  if (size) out.push(WHOLE_WORDS.size(size.factor));
  else out.push(...notJudgedLines(c));
  if (has('no-ceph-found')) out.push(WHOLE_WORDS.noCeph);
  // A flagged check whose size check did not run says so after its reasons, so the reader does not assume the size was looked at.
  if (c.regionLook !== 'judged') out.push(WHOLE_WORDS.regionsOff[c.regionLook] ?? WHOLE_WORDS.regionsOff['not-set-up']);
  return out;
}

/** The shown check for the open film: a view read for another film (or with no film open) is never shown on this one. */
export function shownFor(landed: { caseId: string; view: WholeFilmView | null } | null, openId: string | undefined): WholeCheckView | null {
  // The switch off (Settings › Checks): nothing is shown, whatever the view holds.
  return landed && openId && landed.caseId === openId && !landed.view?.off ? landed.view?.shown ?? null : null;
}

/** Task 9 (spec §11): the `whole_film_check` cell of the report's Points table and the points CSV — the film's SHOWN check,
 *  the same on every point row. Blank: no record (a film before format 20, never checked, or no view at all); `clean`;
 *  `not-run`; `off` (the switch in Settings › Checks is off: no check was shown or written); `flagged:<reasons>` (each stored reason once, in stored order, joined by `+`, a region as `region-<key>`;
 *  every reason is named, unlike the note, which hides `facing` behind `mirrored`); `checked:<reason key>` once the clinician
 *  has pressed Checked. A flagged check with no reasons reads plain `flagged`. */
export function wholeFilmCell(view: WholeFilmView | null | undefined): string {
  if (view?.off) return 'off';
  const c = view?.shown;
  if (!c) return '';
  if (c.resolved) return `checked:${c.resolved.reason}`;
  if (c.outcome === 'clean') return 'clean';
  if (c.outcome === 'not-run') return 'not-run';
  const keys: string[] = [];
  for (const r of c.reasons) {
    const k = r.reason === 'region' ? `region-${r.region ?? ''}` : r.reason;
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.length ? `flagged:${keys.join('+')}` : 'flagged';
}

/** Research switch (owner, 6 Nov 2026): the points CSV's `whole_film_region` cell for one landmark, from its region's stored result.
 *  `fine`, `region flagged` or `not checked` (the region look did not judge, too few regions found, or no box for that region);
 *  blank: no record; `off`: the whole-film check is switched off. Nothing here judges anything again. */
export const REGION_CELL_WORDS = { fine: 'fine', flagged: 'region flagged', 'not-checked': 'not checked' } as const;
export function wholeFilmRegionCell(view: WholeFilmView | null | undefined, landmarkId: string): string {
  if (view?.off) return 'off';
  const c = view?.shown;
  if (!c) return '';
  const r = c.landmarkRegions?.find((x) => x.id === landmarkId);
  return r ? REGION_CELL_WORDS[r.result] ?? REGION_CELL_WORDS['not-checked'] : REGION_CELL_WORDS['not-checked'];
}

/** Research switch (owner ruling, 6 Nov 2026): the status of each look, as the report and the points CSV state it, from what the check stored.
 *  `judged`, or `not checked (<why>)`. `mirrored` is the shape look's own test (a tracing facing the wrong way is seen by its shape); `facing`
 *  is judged when the shape look ran or the region finder gave a facing; else `not checked (no facing found)`. Blank on a film with no record; `off`
 *  when the whole-film check is off. These say which looks ran, which the film's `clean` does not. */
export interface WholeFilmLooks { shape: string; regions: string; size: string; centre: string; mirrored: string; facing: string }
export const LOOK_ORDER = ['shape', 'regions', 'size', 'centre', 'mirrored', 'facing'] as const;
const LOOK_WHY: Record<string, string> = { 'too-few-points': 'too few points', 'too-few': 'too few points or regions', 'not-set-up': 'not set up',
  'no-region-model': 'no region finder', 'film-too-small': 'film too small' };
const lookWord = (key: string) => (key === 'judged' ? 'judged' : `not checked (${LOOK_WHY[key] ?? key})`);
export function wholeFilmLooks(view: WholeFilmView | null | undefined): WholeFilmLooks {
  if (view?.off) return { shape: 'off', regions: 'off', size: 'off', centre: 'off', mirrored: 'off', facing: 'off' };
  const c = view?.shown;
  if (!c) return { shape: '', regions: '', size: '', centre: '', mirrored: '', facing: '' };
  const shape = lookWord(c.shapeLook);
  // `judged` only when something actually compared facing: the shape look, or a facing the region finder really gave (stored with its run).
  const facing = c.shapeLook === 'judged' || (c.regionLook === 'judged' && c.regionFacing === true) ? 'judged' : 'not checked (no facing found)';
  return { shape, regions: lookWord(c.regionLook), size: lookWord(c.sizeLook), centre: lookWord(c.cbLook), mirrored: shape, facing };
}
/** One line for the PDF and the preview: "shape judged; regions judged; size not checked (not set up); ...". */
export const looksLine = (l: WholeFilmLooks): string => LOOK_ORDER.map((k) => `${k} ${l[k]}`).join('; ');

/** Task 9: why nothing is exported until the open film's whole-film view has been read (a blank cell would read as "no record"). */
export const WHOLE_EXPORT_WORDS = { pending: 'The whole-film check is still being read; try again in a moment.',
  failed: 'The whole-film check could not be read, so the file would show a blank whole-film check. Close and open the film again, then try again.' } as const;

/** One read of a film's whole-film view, as it landed, tagged with the run revision (`checkRev`) and sign-off (`verifiedAt`) it was
 *  issued at: the final tracing is checked at sign-off, so either moving makes the held view superseded. */
export interface WholeRead { caseId: string; rev: number; verifiedAt: string | null; view: WholeFilmView | null; failed: boolean }
/** Task 9 fix round 1 (review I1): whether the report may carry the held view. `read` only for a read of the open film issued at the
 *  current revision and sign-off state while no run is being stored; `failed` for such a read that failed; otherwise `pending`.
 *  The same rule as Stage A's `checkStatus`. */
export function wholeStatus(openId: string | null, rev: number, verifiedAt: string | null, recording: boolean, landed: WholeRead | null): 'none' | 'pending' | 'failed' | 'read' {
  if (!openId) return 'none';
  if (recording || !landed || landed.caseId !== openId || landed.rev !== rev || landed.verifiedAt !== verifiedAt) return 'pending';
  return landed.failed ? 'failed' : 'read';
}
