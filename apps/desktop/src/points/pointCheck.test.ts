import { describe, it, expect } from 'vitest';
import { CHECK_WORDS, cardPlace, expectedWords, filmFlags, filmHoldsSignOff, filmNoteLine, flagAt, hoverText, notRunLines, pointCheckCell, checkExportProblem, CHECK_EXPORT_WORDS,
  checkStatus, shownView, signHoldLine, type CheckRead } from './pointCheck';
import type { PointCheckFlag, PointCheckView } from '../ipc';

// Stage A task 6. SYNTHETIC numbers only.
const flag = (over: Partial<PointCheckFlag> = {}): PointCheckFlag => ({
  id: 1, modelId: 'aariz-cepha29', landmarkId: 'N', action: 'flagged', points: null, offPx: 142, expectedX: 500, expectedY: 358,
  ring: { cx: 500, cy: 358, rx: 90, ry: 40, angleDeg: 12 }, resolved: null, ...over });
// The mark at (500, 500); the rest of the face expected it 142 px straight up (y smaller = higher on the film).
const AT = { x: 500, y: 500 };
const view = (flags: PointCheckFlag[]): PointCheckView => ({ runs: [], flags });

describe('the words (owner-fixed, verbatim)', () => {
  it('are exactly the spec words', () => {
    expect(CHECK_WORDS.mark).toBe('Check: far outside the usual position');
    expect(CHECK_WORDS.notSetUp).toBe('Point check not set up.');
    expect(CHECK_WORDS.tooFew(9)).toBe('Point check not run: only 9 of 19 points found.');
    expect(CHECK_WORDS.film(4, 'N, S, B, Me')).toBe('This film looks unusual overall: 4 points out of keeping (N, S, B, Me).');
    expect(CHECK_WORDS.checked).toBe('Checked');
  });
  it('never carry the withdrawn "1 in 5,000"', () => {
    const all = [CHECK_WORDS.mark, CHECK_WORDS.notSetUp, CHECK_WORDS.tooFew(9), CHECK_WORDS.film(4, 'N'), CHECK_WORDS.checked,
      hoverText(flag(), 0.1, false, AT, false), hoverText(flag(), 0.1, true, AT, true)].join('\n');
    expect(all).not.toMatch(/5,000|5000/);
  });
  it('never call the film list "the wrong points"', () => {
    expect(CHECK_WORDS.film(4, 'N, S')).not.toMatch(/wrong|incorrect|error/i);
  });
});

describe('hoverText and expectedWords', () => {
  it('142 px up at 0.1 mm/px: the full hover, verbatim', () => {
    expect(hoverText(flag(), 0.1, false, AT, false)).toBe(
      "Far outside where this point usually sits on faces like this one (the rest of the face expected it about 14.2 mm higher). On Ceph-400's expert tracings, about 1 correct point in 700 sits this far out. A flag, not a verdict.");
  });
  it('an assumed scale says it is an estimate', () => {
    expect(expectedWords(flag(), 0.1, true, AT, false)).toBe('about 14.2 mm (an estimate) higher');
    expect(hoverText(flag(), 0.1, true, AT, false)).toContain('about 14.2 mm (an estimate) higher');
  });
  it('names the larger axis: lower, further right, further left', () => {
    expect(expectedWords(flag({ expectedY: 642 }), 0.1, false, AT, false)).toBe('about 14.2 mm lower');
    expect(expectedWords(flag({ expectedX: 642, expectedY: 500 }), 0.1, false, AT, false)).toBe('about 14.2 mm further right');
    expect(expectedWords(flag({ expectedX: 358, expectedY: 500 }), 0.1, false, AT, false)).toBe('about 14.2 mm further left');
  });
  it('neither axis more than twice the other names both', () => {
    expect(expectedWords(flag({ expectedX: 400, expectedY: 400 }), 0.1, false, AT, false)).toBe('about 14.2 mm higher and further left');
    expect(expectedWords(flag({ expectedX: 600, expectedY: 600 }), 0.1, false, AT, false)).toBe('about 14.2 mm lower and further right');
    // 2.5 : 1 is more than twice: only the larger axis is named
    expect(expectedWords(flag({ expectedX: 450, expectedY: 375 }), 0.1, false, AT, false)).toBe('about 14.2 mm higher');
  });
  it('a mirrored film swaps left and right (they follow the screen); up and down do not change', () => {
    const toLeft = flag({ expectedX: 358, expectedY: 500 });
    expect(expectedWords(toLeft, 0.1, false, AT, false)).toContain('further left');
    expect(expectedWords(toLeft, 0.1, false, AT, true)).toContain('further right');
    expect(expectedWords(flag({ expectedX: 400, expectedY: 400 }), 0.1, false, AT, true)).toBe('about 14.2 mm higher and further right');
    expect(expectedWords(flag(), 0.1, false, AT, true)).toBe('about 14.2 mm higher');
  });
});

describe('flagAt: the flag from the run of the model that placed the point (spec U2)', () => {
  const a = flag({ id: 1, modelId: 'aariz-cepha29' }), b = flag({ id: 2, modelId: 'other-model', offPx: 99 });
  it('is null for a hand-placed point (no placer)', () => {
    expect(flagAt(view([a]), 'N', null)).toBeNull();
  });
  it('is null for a point placed by a model whose run has no flag there', () => {
    expect(flagAt(view([a]), 'N', 'other-model')).toBeNull();
  });
  it("gives the placing model's flag when two models flagged the same point", () => {
    expect(flagAt(view([a, b]), 'N', 'other-model')).toBe(b);
    expect(flagAt(view([a, b]), 'N', 'aariz-cepha29')).toBe(a);
  });
  it('is null without a view, for another point, and for a film-unusual row', () => {
    expect(flagAt(null, 'N', 'aariz-cepha29')).toBeNull();
    expect(flagAt(view([a]), 'S', 'aariz-cepha29')).toBeNull();
    const film = flag({ id: 3, landmarkId: null, action: 'film-unusual', points: 'N,S,B,Me', offPx: null, expectedX: null, expectedY: null, ring: null });
    for (const id of ['N', 'S', 'B', 'Me']) expect(flagAt(view([film]), id, 'aariz-cepha29')).toBeNull();
  });
});

describe('notRunLines: the lines under the film, for the models whose points are on it', () => {
  const run = (modelId: string, outcome: PointCheckView['runs'][0]['outcome'], notRunReason: string | null = null, present: number | null = null) => ({ modelId, outcome, notRunReason, present });
  it('nothing read yet (no view, or no runs): no line', () => {
    expect(notRunLines(null, ['aariz-cepha29'])).toEqual([]);
    expect(notRunLines({ runs: [], flags: [] }, ['aariz-cepha29'])).toEqual([]);
  });
  it('not set up and too few points use the fixed words', () => {
    expect(notRunLines({ runs: [run('aariz-cepha29', 'not-run', 'not-set-up')], flags: [] }, ['aariz-cepha29'])).toEqual(['Point check not set up.']);
    expect(notRunLines({ runs: [run('aariz-cepha29', 'not-run', 'too-few-points', 9)], flags: [] }, ['aariz-cepha29'])).toEqual(['Point check not run: only 9 of 19 points found.']);
  });
  it('clean, flagged and film-unusual runs give no line here', () => {
    for (const o of ['clean', 'flagged', 'film-unusual'] as const) expect(notRunLines({ runs: [run('aariz-cepha29', o)], flags: [] }, ['aariz-cepha29'])).toEqual([]);
  });
  it('only a model that placed a point on the film speaks; the same words once', () => {
    const v = { runs: [run('a', 'not-run', 'not-set-up'), run('b', 'not-run', 'not-set-up'), run('c', 'not-run', 'too-few-points', 5)], flags: [] };
    expect(notRunLines(v, ['a', 'b'])).toEqual(['Point check not set up.']);
    expect(notRunLines(v, ['c'])).toEqual(['Point check not run: only 5 of 19 points found.']);
    expect(notRunLines(v, [])).toEqual([]);
  });
});

// Stage A task 7 (fix round 1: show and hold out at an UNVERIFIED pin, resolved or not; hide at a verified pin).
describe('which flags are shown: by the pin, not by the resolution (owner/review, fix round 1)', () => {
  /** Fails if a verified pin still gets a flag (a re-detect's new flag at a point you already placed and verified). */
  it('a verified pin shows no flag, resolved or not', () => {
    for (const resolved of [null, 'accepted', 'moved', 'placed']) expect(flagAt(view([flag({ resolved })]), 'N', 'aariz-cepha29', true)).toBeNull();
  });
  /** Fails if a resolved flag at an unverified pin is hidden: ⌘Z after a resolving look brings the model's point back, so the mark must come back. */
  it('an unverified pin shows its flag even when it was resolved (undo after the look); the stored resolution is untouched', () => {
    const f = flag({ resolved: 'moved' });
    expect(flagAt(view([f]), 'N', 'aariz-cepha29', false)).toBe(f);
    expect(f.resolved).toBe('moved');
    expect(flagAt(view([flag({ resolved: null })]), 'N', 'aariz-cepha29', false)).not.toBeNull();
  });
  it("two models flagged the same point: only the placing model's flag is drawn", () => {
    const a = flag({ id: 1, modelId: 'aariz-cepha29', resolved: 'accepted' }), b = flag({ id: 2, modelId: 'other-model' });
    expect(flagAt(view([a, b]), 'N', 'other-model', false)).toBe(b);
    expect(flagAt(view([a, b]), 'N', 'aariz-cepha29', false)).toBe(a);
  });
});

describe('the film note holds the sign-off (owner ruling "Hold sign-off", 2 Nov)', () => {
  const film = (resolved: string | null) => flag({ id: 7, landmarkId: null, action: 'film-unusual', points: 'N,S,Po,Ar', offPx: null, expectedX: null, expectedY: null, ring: null, resolved });
  it('the line is exactly the owner\'s words', () => { expect(CHECK_WORDS.signHold).toBe('Press Checked on the film note first.'); });
  /** Fails if an unresolved film note does not hold, or a Checked one still does. */
  it('held while any film note is unresolved; released when all are Checked; a point flag never holds', () => {
    expect(filmHoldsSignOff([film(null)])).toBe(true);
    expect(filmHoldsSignOff([film('film-checked'), film(null)])).toBe(true);
    expect(filmHoldsSignOff([film('film-checked')])).toBe(false);
    expect(filmHoldsSignOff([])).toBe(false);
    expect(filmHoldsSignOff(filmFlags(view([flag()])))).toBe(false);
  });
});

describe('the film note (ruling F13)', () => {
  const film = (over: Partial<PointCheckFlag> = {}) => flag({ id: 7, landmarkId: null, action: 'film-unusual', points: 'N,S,Po,Ar', offPx: null, expectedX: null, expectedY: null, ring: null, ...over });
  it('filmFlags are the film rows only, resolved or not, never a point row', () => {
    expect(filmFlags(null)).toEqual([]);
    const f = film(), f2 = film({ id: 8, resolved: 'film-checked' });
    expect(filmFlags(view([flag(), f, f2]))).toEqual([f, f2]);
  });
  /** Fails if the line is not the brief's words, or calls the listed points wrong. */
  it("the line is the brief's words with the count and the ids, and never says wrong", () => {
    expect(filmNoteLine(film())).toBe('This film looks unusual overall: 4 points out of keeping (N, S, Po, Ar).');
    expect(filmNoteLine(film())).toBe(CHECK_WORDS.film(4, 'N, S, Po, Ar'));
    expect(filmNoteLine(film({ points: 'N' }))).not.toMatch(/wrong|incorrect|error/i);
  });
});

describe('cardPlace: the hover card stays inside the stage on every edge (carried item 6)', () => {
  const W = 360, H = 90;
  /** Fails if the card runs off the right edge. */
  it('right edge', () => { expect(cardPlace(900, 200, W, H, 1000, 800).x).toBe(1000 - W); });
  /** Fails if the card runs off the left edge. */
  it('left edge', () => { expect(cardPlace(-50, 200, W, H, 1000, 800).x).toBe(0); });
  /** Fails if the card runs off the bottom: it goes above the pin instead. */
  it('bottom edge: above the pin when it does not fit below', () => {
    const p = cardPlace(300, 780, W, H, 1000, 800);
    expect(p.y).toBe(780 - 14 - H);
    expect(p.y + H).toBeLessThanOrEqual(800);
  });
  /** Fails if a short stage lets the card go above the top. */
  it('too short either way: clamped to the stage, never negative', () => {
    const p = cardPlace(300, 60, W, H, 1000, 100);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y + H).toBeLessThanOrEqual(Math.max(100, H));
  });
  it('plenty of room: just below and right of the pin; an unmeasured stage (static render) does not clamp', () => {
    expect(cardPlace(300, 200, W, H, 1000, 800)).toEqual({ x: 310, y: 214 });
    expect(cardPlace(300, 200, W, H, Infinity, Infinity)).toEqual({ x: 310, y: 214 });
  });
});

// Stage A task 8: the report's and the CSV's `point_check` cell. SYNTHETIC numbers only.
describe('pointCheckCell (the report and CSV column)', () => {
  const AZ = 'aariz-cepha29', SR = 'srpose-cldet23';
  const filmRow = (modelId: string, over: Partial<PointCheckFlag> = {}) => flag({ id: 9, modelId, landmarkId: null, action: 'film-unusual', points: 'N,S,Po,Ar', ring: null, ...over });
  it('a point the placing model flagged reads "flagged"; any other point reads blank', () => {
    const v = view([flag({ landmarkId: 'N' })]);
    expect([pointCheckCell(v, 'N', AZ), pointCheckCell(v, 'S', AZ)]).toEqual(['flagged', '']);
  });
  it('a flag from a model that did NOT place the point is not that point\'s flag (blank)', () => {
    expect(pointCheckCell(view([flag({ landmarkId: 'N', modelId: SR })]), 'N', AZ)).toBe('');
  });
  it('a resolved flag is still a flag that was raised: flagged', () => {
    expect(pointCheckCell(view([flag({ landmarkId: 'N', resolved: 'accepted' })]), 'N', AZ)).toBe('flagged');
  });
  it('film-unusual: EVERY point the flagged model placed reads film-unusual, resolved or not', () => {
    for (const resolved of [null, 'film-checked']) {
      const v = view([filmRow(AZ, { resolved })]);                     // the store gives a film-unusual run ONE film row and no point rows
      expect(['N', 'S', 'Go'].map((id) => pointCheckCell(v, id, AZ)), String(resolved)).toEqual(['film-unusual', 'film-unusual', 'film-unusual']);
    }
  });
  it('defensive only (the store cannot produce it): a film row beside a point flag of the same model reads film-unusual', () => {
    expect(pointCheckCell(view([filmRow(AZ), flag({ landmarkId: 'N' })]), 'N', AZ)).toBe('film-unusual');
  });
  it('film-unusual belongs to the model whose run looked unusual: a point another model placed is not film-unusual', () => {
    expect(pointCheckCell(view([filmRow(SR)]), 'S', AZ)).toBe('');
  });
  // Review I1: a flagged point you then re-placed by hand has no placing model any more, but it is the flag you acted on
  // most strongly (resolved `placed`): it reads flagged. Fails if a hand-placed point is always blank.
  it('a flagged point re-placed by hand (flag resolved `placed`) reads flagged, whichever model raised the flag', () => {
    expect(pointCheckCell(view([flag({ landmarkId: 'N', resolved: 'placed' })]), 'N', null)).toBe('flagged');
    expect(pointCheckCell(view([flag({ landmarkId: 'N', modelId: SR, resolved: 'placed' })]), 'N', null)).toBe('flagged');
    expect(pointCheckCell(view([flag({ landmarkId: 'N', resolved: 'placed' })]), 'S', null)).toBe('');
  });
  // Control: a hand-placed point whose flag was NOT resolved by placing it (another model's unresolved flag, or one
  // resolved some other way) is not "flagged": the hand placement is not the answer to that flag.
  it('control: a hand-placed point with only another model\'s unresolved (or otherwise resolved) flag reads blank', () => {
    expect(pointCheckCell(view([flag({ landmarkId: 'N', modelId: SR })]), 'N', null)).toBe('');
    expect(pointCheckCell(view([flag({ landmarkId: 'N', resolved: 'accepted' })]), 'N', null)).toBe('');
  });
  it('a hand-placed point on a film-unusual film, no check record, or no check read at all: blank', () => {
    expect(pointCheckCell(view([filmRow(AZ)]), 'N', null)).toBe('');
    expect(pointCheckCell(view([]), 'N', AZ)).toBe('');
    expect(pointCheckCell(null, 'N', AZ)).toBe('');
  });
  it('the film-unusual word is never "wrong"', () => {
    expect(pointCheckCell(view([filmRow(AZ)]), 'N', AZ)).not.toMatch(/wrong/i);
  });
});

describe('checkExportProblem (Task 8 review I2)', () => {
  it('unread: wait; failed: say so; read (or no film): nothing in the way', () => {
    expect(checkExportProblem('pending')).toBe(CHECK_EXPORT_WORDS.pending);
    expect(checkExportProblem('failed')).toBe(CHECK_EXPORT_WORDS.failed);
    expect(checkExportProblem('read')).toBeNull();
    expect(checkExportProblem('none')).toBeNull();
    expect(CHECK_EXPORT_WORDS.failed).not.toMatch(/wrong/i);
  });
});

// Whole-branch review I1, I2 and M1: the screen's copy of the check belongs to one film and one run. `rev` moves after
// every run of the open film is recorded (the run's check is stored with it); `recording` is true from the start of a
// detection until its run is recorded. A read counts only when it is of the open film, issued at the current rev, and
// no run is being recorded. Each line below names the failure it guards.
describe('checkStatus: which read the screen may act on (review I1)', () => {
  const v = view([flag()]);
  const read = (over: Partial<CheckRead> = {}): CheckRead => ({ caseId: 'A', rev: 3, view: v, failed: false, ...over });
  it('the read of the open film at the current rev, nothing being recorded: read', () => {
    expect(checkStatus('A', 3, false, read())).toBe('read');
  });
  it('a read that landed BEFORE the run was recorded (an older rev) is not the current check: pending', () => {
    expect(checkStatus('A', 4, false, read({ rev: 3 }))).toBe('pending');
  });
  it('while a run is being recorded, even the newest read is pending (the read can win the race)', () => {
    expect(checkStatus('A', 3, true, read())).toBe('pending');
  });
  it('nothing read yet for this film: pending', () => {
    expect(checkStatus('A', 0, false, null)).toBe('pending');
  });
  it('another film\'s read (M1: a Checked re-read that landed after a switch) is never this film\'s: pending', () => {
    expect(checkStatus('B', 3, false, read())).toBe('pending');
  });
  it('a failed read holds (fail closed): failed, not read', () => {
    expect(checkStatus('A', 3, false, read({ failed: true, view: null }))).toBe('failed');
  });
  it('no film open: none', () => { expect(checkStatus(null, 3, false, read())).toBe('none'); });
});
describe('shownView: only the open film\'s check is drawn (review M1)', () => {
  const r: CheckRead = { caseId: 'A', rev: 1, view: view([flag()]), failed: false };
  it('the open film: its view; another film: nothing', () => {
    expect(shownView(r, 'A')).toBe(r.view);
    expect(shownView(r, 'B')).toBeNull();
    expect(shownView(null, 'A')).toBeNull();
    expect(shownView(r, undefined)).toBeNull();
  });
});
describe('signHoldLine: why "Mark tracing verified" waits (review I1, I2)', () => {
  it('reading, a failed read, an unresolved film note; nothing when read and no note', () => {
    expect(signHoldLine('pending', false)).toBe(CHECK_WORDS.reading);
    expect(signHoldLine('failed', false)).toBe(CHECK_WORDS.readFailed);
    expect(signHoldLine('read', true)).toBe(CHECK_WORDS.signHold);
    expect(signHoldLine('read', false)).toBeNull();
    expect(signHoldLine('none', false)).toBeNull();
    expect(CHECK_WORDS.reading).toBe('Reading the point check…');
    expect(CHECK_WORDS.readFailed).toBe('The point check could not be read.');
    expect(CHECK_WORDS.signHold).toBe('Press Checked on the film note first.');
  });
});
