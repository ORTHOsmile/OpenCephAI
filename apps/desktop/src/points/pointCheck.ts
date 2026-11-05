// Stage A point check, the screen's words and rules (spec
// §14.1, §14.5, §14.13 U2). The check only FLAGS. Nothing here moves, accepts or changes a point.
import type { Vec2 } from '@ceph/geometry';
import type { PointCheckFlag, PointCheckView } from '../ipc';

/** The owner's words, verbatim (plan Global Constraints). There is no "1 in 5,000" anywhere: the measured figure on
 *  Ceph-400's expert tracings is about 1 in 700 (spec §14.0, D6). `film` names the points "out of keeping", never "the
 *  wrong points": that list can name a point that was not wrong (spec §14.5, task 2 concern). */
export const CHECK_WORDS = {
  mark: 'Check: far outside the usual position',
  notSetUp: 'Point check not set up.',
  tooFew: (n: number) => `Point check not run: only ${n} of 19 points found.`,
  film: (n: number, ids: string) => `This film looks unusual overall: ${n} points out of keeping (${ids}).`,
  checked: 'Checked',
  /** Owner ruling "Hold sign-off" (2 Nov): while a film note is unresolved, "Mark tracing verified" is held with this line. */
  signHold: 'Press Checked on the film note first.',
  /** Whole-branch review I1/I2: "Mark tracing verified" and both bulk accepts wait while the check of the film's current
   *  run is being read, and hold (fail closed) when it could not be read, with a way to try again. */
  reading: 'Reading the point check…',
  readFailed: 'The point check could not be read.',
  tryAgain: 'Try again',
} as const;

/** The flag drawn at a pin: the one from the run of the model that placed it (spec U2); none for a hand-placed point
 *  (`placer` null). A film-unusual row has no point and is never a flag at a pin. Shown and held out of bulk accepts
 *  while the pin is UNVERIFIED, whether or not the flag was resolved: a resolution is never undone (spec U4), so
 *  ⌘Z after a resolving look puts the model's point back and its mark must come back with it. At a VERIFIED pin
 *  nothing is drawn: you have placed and accepted it, and a new run's flag there (a re-detect keeps verified points)
 *  is about a proposal that is not on the pin (spec §14.5 item 4). */
export function flagAt(view: PointCheckView | null, id: string, placer: string | null, verified = false): PointCheckFlag | null {
  if (!view || !placer || verified) return null;
  return view.flags.find((f) => f.action === 'flagged' && f.landmarkId === id && f.modelId === placer) ?? null;
}

/** The report's and the CSV's `point_check` cell (spec §14.1 item 6): what the check said about this point, from the run
 *  of the model that PLACED it. `film-unusual` for every point that model placed when its run flagged the film overall
 *  (the film note's list is only "points out of keeping", so the cell does not single points out); else `flagged` when
 *  that model flagged this point; else blank. A resolved flag is still a flag that was raised, so it still reads. A
 *  hand-placed point (`placer` null), a film never checked, or no check read: blank. Never the words "wrong points". */
export type PointCheckCell = 'flagged' | 'film-unusual' | '';
export function pointCheckCell(view: PointCheckView | null, id: string, placer: string | null): PointCheckCell {
  if (!view) return '';
  // A hand-placed point has no placing model any more. If it was flagged and you then placed it by hand (the flag was
  // resolved `placed`), that is the flag you acted on most strongly: it still reads flagged (Task 8 review I1).
  if (!placer) return view.flags.some((f) => f.action === 'flagged' && f.landmarkId === id && f.resolved === 'placed') ? 'flagged' : '';
  const mine = view.flags.filter((f) => f.modelId === placer);
  if (mine.some((f) => f.action === 'film-unusual')) return 'film-unusual';
  return mine.some((f) => f.action === 'flagged' && f.landmarkId === id) ? 'flagged' : '';
}
/** The film-unusual rows (one per model whose run looked unusual overall), resolved or not. */
export function filmFlags(view: PointCheckView | null): PointCheckFlag[] {
  return view ? view.flags.filter((f) => f.action === 'film-unusual') : [];
}
/** The words when a report or CSV would carry blank `point_check` cells because the check was not read (Task 8 review I2):
 *  blank reads as "nothing flagged", so nothing is exported until the read has landed. null: fine to export. */
export const CHECK_EXPORT_WORDS = { pending: 'The point check is still being read; try again in a moment.',
  failed: 'The point check could not be read, so the file would show blank point checks. Close and open the film again, then try again.' } as const;
export function checkExportProblem(status: CheckStatus): string | null {
  return status === 'pending' ? CHECK_EXPORT_WORDS.pending : status === 'failed' ? CHECK_EXPORT_WORDS.failed : null;
}

/** One read of a film's stored check, as it landed: the film, the run revision it was issued at (`useCase`'s
 *  `checkRev`, which moves after each run of the open film is stored), and what came back. */
export interface CheckRead { caseId: string; rev: number; view: PointCheckView | null; failed: boolean }
/** Whether the screen may act on its copy of the check (whole-branch review I1, M1). `read` only for a read of the open
 *  film issued at the current revision while no run is being stored; `failed` when that read failed (fail closed: the
 *  bulk accepts and the sign-off hold, and nothing is exported); otherwise `pending`. `none`: no film open. */
export type CheckStatus = 'none' | 'pending' | 'failed' | 'read';
export function checkStatus(openId: string | null, rev: number, recording: boolean, landed: CheckRead | null): CheckStatus {
  if (!openId) return 'none';
  if (recording || !landed || landed.caseId !== openId || landed.rev !== rev) return 'pending';
  return landed.failed ? 'failed' : 'read';
}
/** The check drawn on the open film: its own last read only, never another film's (review M1). While a newer run's read
 *  is pending the last read of the same film stays drawn; the bulk accepts and the sign-off wait meanwhile. */
export function shownView(landed: CheckRead | null, openId: string | undefined): PointCheckView | null {
  return landed && openId && landed.caseId === openId ? landed.view : null;
}
/** The line under "Mark tracing verified" while the check holds it: being read, could not be read, or an unresolved film
 *  note (owner ruling "Hold sign-off"). null: the check does not hold it. */
export function signHoldLine(status: CheckStatus, filmHeld: boolean): string | null {
  if (status === 'pending') return CHECK_WORDS.reading;
  if (status === 'failed') return CHECK_WORDS.readFailed;
  return status === 'read' && filmHeld ? CHECK_WORDS.signHold : null;
}
/** Owner ruling "Hold sign-off": any unresolved film note holds the sign-off (automatic and the button) until Checked. */
export const filmHoldsSignOff = (films: readonly PointCheckFlag[]): boolean => films.some((f) => f.resolved == null);
/** The film note's line: the brief's words, with how many points and which. Never "the wrong points". */
export function filmNoteLine(f: PointCheckFlag): string {
  const ids = (f.points ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return CHECK_WORDS.film(ids.length, ids.join(', '));
}

/** Where the hover card goes: just right of and below the pin, kept inside the stage on the right and left edges, and
 *  on the bottom edge it goes above the pin (or is pushed up) so it never runs off. An unmeasured stage (Infinity)
 *  clamps nothing. */
export function cardPlace(sx: number, sy: number, w: number, h: number, stageW: number, stageH: number): { x: number; y: number } {
  const x = Math.max(0, Math.min(sx + 10, stageW - w));
  const below = sy + 14;
  const y = below + h <= stageH ? below : sy - 14 - h >= 0 ? sy - 14 - h : Math.max(0, stageH - h);
  return { x, y };
}

/** "about 14.2 mm higher": direction words from the mark to where the rest of the face expected it, on SCREEN axes.
 *  `at` is the mark's position on the film as stored; `mirror` is the film shown mirrored (left and right follow the screen). */
export function expectedWords(f: PointCheckFlag, mmPerPx: number, assumed: boolean, at: Vec2, mirror: boolean): string {
  const mm = ((f.offPx ?? 0) * mmPerPx).toFixed(1);
  const dx = (f.expectedX ?? at.x) - at.x, dy = (f.expectedY ?? at.y) - at.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const vertical = dy < 0 ? 'higher' : 'lower';
  const right = mirror ? dx < 0 : dx > 0;
  const horizontal = right ? 'further right' : 'further left';
  const dir = ay > ax * 2 ? vertical : ax > ay * 2 ? horizontal : `${vertical} and ${horizontal}`;
  return `about ${mm} mm${assumed ? ' (an estimate)' : ''} ${dir}`;
}

export function hoverText(f: PointCheckFlag, mmPerPx: number, assumed: boolean, at: Vec2, mirror: boolean): string {
  return `Far outside where this point usually sits on faces like this one (the rest of the face expected it ${expectedWords(f, mmPerPx, assumed, at, mirror)}). `
    + `On Ceph-400's expert tracings, about 1 correct point in 700 sits this far out. A flag, not a verdict.`;
}

/** The lines for a check that did not run, for the models whose points are on the film (those that placed a point
 *  there), each distinct line once. No view, no runs, or a run that did run: no line. */
export function notRunLines(view: PointCheckView | null, models: readonly string[]): string[] {
  if (!view) return [];
  const out: string[] = [];
  for (const r of view.runs) {
    if (r.outcome !== 'not-run' || !models.includes(r.modelId)) continue;
    const line = r.notRunReason === 'not-set-up' ? CHECK_WORDS.notSetUp
      : r.notRunReason === 'too-few-points' && r.present != null ? CHECK_WORDS.tooFew(r.present) : null;
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}
