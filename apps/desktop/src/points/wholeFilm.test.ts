import { describe, it, expect } from 'vitest';
import { noteLines, WHOLE_WORDS, REGION_WORDS, shownFor, wholeFilmCell, wholeFilmRegionCell, wholeFilmLooks, looksLine, wholeStatus, WHOLE_EXPORT_WORDS } from './wholeFilm';
import type { WholeFilmView } from '../ipc';
import type { WholeCheckView, WholeReasonView } from '../ipc';

// SC-1 Part 1 task 8. SYNTHETIC values only.
const chk = (over: Partial<WholeCheckView> = {}): WholeCheckView => ({ id: 1, subject: 'run', modelId: 'SYNTHETIC-m', outcome: 'flagged', shapeLook: 'judged',
  regionLook: 'judged', present: 19, reasons: [], resolved: null, sizeLook: 'judged', cbLook: 'judged', cbPresent: 5, ...over });
const rs = (reason: WholeReasonView['reason'], over: Partial<WholeReasonView> = {}): WholeReasonView => ({ reason, region: null, ids: [], named: [], factor: null, ...over });
const region = (key: string, ids: string[]) => rs('region', { region: key, ids });

describe('the owner\'s words, verbatim', () => {
  /** Fails if any word in the table drifts from the plan's Global Constraints. */
  it('every line is exactly the plan\'s text', () => {
    expect(WHOLE_WORDS.region('mandible', 'Me, Gn')).toBe('Whole-film check: the mandible points do not sit on the mandible this film shows (Me, Gn).');
    expect(WHOLE_WORDS.regions('maxilla, mandible')).toBe("Whole-film check: the tracing's points do not sit where this film's regions are (it may be at the wrong size, or belong to another film): maxilla, mandible.");
    expect(WHOLE_WORDS.mirrored).toBe('Whole-film check: this tracing looks mirrored: it faces the other way from the film.');
    expect(WHOLE_WORDS.facing).toBe("Whole-film check: the face on this film seems to point the other way from the film's recorded facing. Check the film's facing and Re-detect.");
    expect(WHOLE_WORDS.shape('SNB, ANB')).toBe("Whole-film check: this tracing's overall shape is unlike the expert tracings (furthest out: SNB, ANB). Look at the whole tracing.");
    expect(WHOLE_WORDS.noCeph).toBe('Whole-film check: the region finder found no skull on this film.');
    expect(WHOLE_WORDS.tooFew(9)).toBe('Whole-film check not run: only 9 of 19 points found.');
    expect(WHOLE_WORDS.notSetUp).toBe('Whole-film check not set up.');
    expect(WHOLE_WORDS.regionsOff['no-region-model']).toBe('Whole-film check: regions not checked (not set up: download the check model in Models…).');
    expect(WHOLE_WORDS.regionsOff['not-set-up']).toBe('Whole-film check: regions not checked (the region finder is not set up).');
    expect(WHOLE_WORDS.regionsOff['film-too-small']).toBe('Whole-film check: regions not checked (the film is too small).');
    expect(WHOLE_WORDS.hover).toBe('A note, not a verdict. It checks the tracing against the film in boxes; it does not judge errors under about 10 mm.');
    expect(WHOLE_WORDS.checked).toBe('Checked');
    expect(Object.values(WHOLE_WORDS.reasons)).toEqual(['Tracing is right', 'Expected variant (cleft, syndrome, surgery)', 'I corrected the tracing']);
    expect(WHOLE_WORDS.resolvedAs('corrected-tracing')).toBe('Checked: I corrected the tracing');
    expect(Object.values(REGION_WORDS)).toEqual(['cranial base', 'maxilla', 'mandible', 'incisors', 'soft-tissue profile']);
  });
});

describe('noteLines', () => {
  /** Fails if a null check (nothing read yet, or shown null) produces any line. */
  it('null: nothing read yet, no lines', () => { expect(noteLines(null)).toEqual([]); });
  /** Fails if one flagged region does not use the one-region words with the stored ids (not the stored key). */
  it('one region: the region line, with the region\'s words and its ids', () => {
    expect(noteLines(chk({ reasons: [region('mandible', ['Me', 'Gn', 'Pog'])] }))).toEqual([WHOLE_WORDS.region('mandible', 'Me, Gn, Pog')]);
    expect(noteLines(chk({ reasons: [region('soft-tissue', ['Sn'])] }))).toEqual([WHOLE_WORDS.region('soft-tissue profile', 'Sn')]);
    expect(noteLines(chk({ reasons: [region('cranial-base', ['S', 'Po'])] }))).toEqual([WHOLE_WORDS.region('cranial base', 'S, Po')]);
  });
  /** Fails if two regions give two lines (or one line per region) instead of the combined line once. */
  it('two or more regions: the combined line, once, naming both', () => {
    const l = noteLines(chk({ reasons: [region('maxilla', ['A']), region('mandible', ['Me'])] }));
    expect(l).toEqual([WHOLE_WORDS.regions('maxilla, mandible')]);
    expect(noteLines(chk({ reasons: [region('maxilla', ['A']), region('mandible', ['Me']), region('incisors', ['U1T'])] }))).toHaveLength(1);
  });
  /** Fails if mirrored and facing are both shown (the facing line is suppressed beside the mirrored one). */
  it('mirrored with facing: the mirrored line only', () => {
    expect(noteLines(chk({ reasons: [rs('mirrored'), rs('facing')] }))).toEqual([WHOLE_WORDS.mirrored]);
    expect(noteLines(chk({ reasons: [rs('facing'), rs('mirrored')] }))).toEqual([WHOLE_WORDS.mirrored]);
  });
  /** Fails if facing alone is not shown. */
  it('facing alone: the facing line', () => { expect(noteLines(chk({ reasons: [rs('facing')] }))).toEqual([WHOLE_WORDS.facing]); });
  /** Fails if the shape line does not name the stored measures. */
  it('shape: names the furthest-out measures', () => {
    expect(noteLines(chk({ reasons: [rs('shape', { named: ['SNB', 'ANB'] })] }))).toEqual([WHOLE_WORDS.shape('SNB, ANB')]);
    expect(noteLines(chk({ reasons: [rs('shape', { named: ['SNB', 'ANB'] })] }))[0]).toContain('(furthest out: SNB, ANB)');
  });
  /** Fails if the no-skull line is missing, or the order is not mirrored, shape, region, no skull. */
  it('no ceph found, and the lines come in the stated order', () => {
    expect(noteLines(chk({ reasons: [rs('no-ceph-found')] }))).toEqual([WHOLE_WORDS.noCeph]);
    const all = noteLines(chk({ reasons: [rs('no-ceph-found'), region('maxilla', ['A']), rs('shape', { named: ['SNA'] }), rs('mirrored')] }));
    expect(all).toEqual([WHOLE_WORDS.mirrored, WHOLE_WORDS.shape('SNA'), WHOLE_WORDS.region('maxilla', 'A'), WHOLE_WORDS.noCeph]);
  });
  /** Fails if a not-run check does not say why: too few points (with the count) or not set up. */
  it('not-run: too few points names the count, else not set up', () => {
    expect(noteLines(chk({ outcome: 'not-run', shapeLook: 'too-few-points', regionLook: 'no-region-model', present: 9 }))).toEqual([WHOLE_WORDS.tooFew(9)]);
    expect(noteLines(chk({ outcome: 'not-run', shapeLook: 'not-set-up', regionLook: 'no-region-model', present: 0 }))).toEqual([WHOLE_WORDS.notSetUp]);
  });
  /** Fix round 1 (M6). Fails if a region key stored twice makes two lines or loses the first ids (dedup keeps the first). */
  it('a region key twice: one line, the first ids kept', () => {
    expect(noteLines(chk({ reasons: [region('maxilla', ['A', 'ANS']), region('maxilla', ['PNS'])] }))).toEqual([WHOLE_WORDS.region('maxilla', 'A, ANS')]);
  });
  /** Fix round 1 (M6). Fails if an unknown region key is dropped or blanked instead of falling back to the raw key. */
  it('an unknown region key falls back to the raw key', () => {
    expect(noteLines(chk({ reasons: [region('zygoma', ['Or'])] }))).toEqual([WHOLE_WORDS.region('zygoma', 'Or')]);
  });
  /** Fix round 1 (M3). Fails if a flagged check with the size check off hides that fact (the reader would think sizes were checked). */
  it('flagged with the regions not checked: the reason lines, then the matching regions-not-checked line', () => {
    expect(noteLines(chk({ regionLook: 'no-region-model', reasons: [rs('shape', { named: ['SNB'] })] }))).toEqual([WHOLE_WORDS.shape('SNB'), WHOLE_WORDS.regionsOff['no-region-model']]);
    expect(noteLines(chk({ regionLook: 'not-set-up', reasons: [rs('mirrored')] }))).toEqual([WHOLE_WORDS.mirrored, WHOLE_WORDS.regionsOff['not-set-up']]);
    expect(noteLines(chk({ regionLook: 'film-too-small', reasons: [rs('facing')] }))).toEqual([WHOLE_WORDS.facing, WHOLE_WORDS.regionsOff['film-too-small']]);
    expect(noteLines(chk({ regionLook: 'judged', reasons: [rs('mirrored')] }))).toEqual([WHOLE_WORDS.mirrored]);
  });
  /** Fix round 1 (M1). Fails if a flagged check with no stored reasons produces words of its own. */
  it('flagged with an empty reasons list: no words', () => { expect(noteLines(chk({ reasons: [] }))).toEqual([]); });
  /** Fix round 1 (Risk 4). Fails if the view read for film A is shown on film B (remove the caseId guard in shownFor). */
  it('shownFor: the view read for film A is not shown on film B, nor with no film open', () => {
    const v: WholeFilmView = { shown: chk({ id: 9 }), checks: [], off: false };
    const landed = { caseId: 'A', view: v };
    expect(shownFor(landed, 'A')?.id).toBe(9);
    expect(shownFor(landed, 'B')).toBeNull();
    expect(shownFor(landed, undefined)).toBeNull();
    expect(shownFor(null, 'A')).toBeNull();
    expect(shownFor({ caseId: 'A', view: null }, 'A')).toBeNull();
  });
  /** Fix round 1 (M3 ruling). Fails if a clean check with no region finder does not say regions were not checked, or a judged clean one says anything. */
  it('clean: only the regions-not-checked line, and nothing when judged', () => {
    expect(noteLines(chk({ outcome: 'clean', regionLook: 'no-region-model' }))).toEqual([WHOLE_WORDS.regionsOff['no-region-model']]);
    expect(noteLines(chk({ outcome: 'clean', regionLook: 'not-set-up' }))).toEqual([WHOLE_WORDS.regionsOff['not-set-up']]);
    expect(noteLines(chk({ outcome: 'clean', regionLook: 'film-too-small' }))).toEqual([WHOLE_WORDS.regionsOff['film-too-small']]);
    expect(noteLines(chk({ outcome: 'clean' }))).toEqual([]);
  });
  /** Fails if any line says the tracing is wrong. */
  it('no line says "is wrong", "wrong tracing" or "error" (the size words "wrong size" are the plan\'s)', () => {
    const lines = [WHOLE_WORDS.mirrored, WHOLE_WORDS.facing, WHOLE_WORDS.shape('SNB'), WHOLE_WORDS.region('maxilla', 'A'), WHOLE_WORDS.noCeph, WHOLE_WORDS.tooFew(3),
      WHOLE_WORDS.notSetUp, ...Object.values(WHOLE_WORDS.regionsOff), WHOLE_WORDS.regions('maxilla, mandible')];
    for (const l of lines) expect(l).not.toMatch(/is wrong|wrong tracing|error/i);
  });
});

// Task 9: the `whole_film_check` cell of the report and the points CSV (spec §11). The film's shown check, the same on every row.
describe('wholeFilmCell', () => {
  const view = (shown: WholeCheckView | null): WholeFilmView => ({ shown, checks: shown ? [shown] : [], off: false });
  /** Fails if a view with no record stops reading blank (e.g. the cell says `clean` for "never checked"). */
  it('no record: blank (an older library with no view at all, a null view, a view with nothing shown)', () => {
    expect(wholeFilmCell(null)).toBe('');
    expect(wholeFilmCell(undefined)).toBe('');
    expect(wholeFilmCell(view(null))).toBe('');
  });
  it('clean and not-run', () => {
    expect(wholeFilmCell(view(chk({ outcome: 'clean' })))).toBe('clean');
    expect(wholeFilmCell(view(chk({ outcome: 'not-run', shapeLook: 'too-few-points', present: 9 })))).toBe('not-run');
  });
  /** Fails if a region is written as its words ("mandible") or without the `region-` prefix, or if the reasons are not joined by `+`. */
  it('flagged with one region: flagged:region-<key>', () => {
    expect(wholeFilmCell(view(chk({ reasons: [region('mandible', ['Me', 'Gn'])] })))).toBe('flagged:region-mandible');
  });
  it('flagged with two regions: both, in stored order, joined by +; a repeated region once; the hyphenated keys kept', () => {
    expect(wholeFilmCell(view(chk({ reasons: [region('cranial-base', ['S']), region('soft-tissue', ['UL']), region('cranial-base', ['N'])] })))).toBe('flagged:region-cranial-base+region-soft-tissue');
  });
  /** Fails if the cell borrows the note's rule that mirrored hides facing: the cell lists every stored reason. */
  it('mirrored with facing: both reasons are named', () => {
    expect(wholeFilmCell(view(chk({ reasons: [rs('mirrored'), rs('facing')] })))).toBe('flagged:mirrored+facing');
    expect(wholeFilmCell(view(chk({ reasons: [region('mandible', ['Me']), rs('facing')] })))).toBe('flagged:region-mandible+facing');
  });
  it('shape and no-ceph-found keep their stored keys', () => {
    expect(wholeFilmCell(view(chk({ reasons: [rs('shape', { named: ['SNB'] }), rs('no-ceph-found')] })))).toBe('flagged:shape+no-ceph-found');
  });
  /** Fails if the resolved reason is ignored or its words used instead of the key. */
  it.each(['tracing-right', 'expected-variant', 'corrected-tracing'] as const)('checked with %s', (reason) => {
    const resolved = { reason, operator: 'SYNTHETIC-operator', resolvedAt: '2026-11-03T00:00:00Z' };
    expect(wholeFilmCell(view(chk({ reasons: [region('mandible', ['Me'])], resolved })))).toBe(`checked:${reason}`);
  });
  it('flagged with an empty reasons list: just flagged (never a dangling colon)', () => { expect(wholeFilmCell(view(chk({ reasons: [] })))).toBe('flagged'); });
});

// Task 9 fix round 1 (review I1, M2): the report may carry the whole-film view only while it is the CURRENT one. Mirrors Stage A's checkStatus.
describe('wholeStatus (export fails closed while the view is superseded)', () => {
  const read = (over = {}) => ({ caseId: 'c1', rev: 3, verifiedAt: null as string | null, view: { shown: chk({ outcome: 'clean' }), checks: [], off: false } as WholeFilmView | null, failed: false, ...over });
  /** Fails if the rev tag is not compared (a view read before a run was stored would read as current). */
  it('a view read at an older run revision is pending', () => { expect(wholeStatus('c1', 4, null, false, read())).toBe('pending'); });
  /** Fails if verifiedAt is not compared (a view read before sign-off would be exported after it). */
  it('a view read before sign-off (or before it was reopened) is pending', () => {
    expect(wholeStatus('c1', 3, '2026-11-03T01:00:00Z', false, read())).toBe('pending');
    expect(wholeStatus('c1', 3, null, false, read({ verifiedAt: '2026-11-03T01:00:00Z' }))).toBe('pending');
  });
  /** Fails if `recording` is ignored. */
  it('while a run is being stored it is pending, even for a matching read', () => { expect(wholeStatus('c1', 3, null, true, read())).toBe('pending'); });
  /** Fails if the film is not compared (another film's view would be exported). */
  it('nothing read, or read for another film: pending; no film: none', () => {
    expect(wholeStatus('c1', 3, null, false, null)).toBe('pending');
    expect(wholeStatus('c2', 3, null, false, read())).toBe('pending');
    expect(wholeStatus(null, 3, null, false, null)).toBe('none');
  });
  it('a matching read: read; a matching failed read: failed', () => {
    expect(wholeStatus('c1', 3, null, false, read())).toBe('read');
    expect(wholeStatus('c1', 3, null, false, read({ view: null, failed: true }))).toBe('failed');
  });
  it('the refusal wording is the existing "try again in a moment"', () => { expect(WHOLE_EXPORT_WORDS.pending).toMatch(/try again in a moment/); });
  /** M2: after sign-off the shown check is the FINAL one; the cell carries its value, not the earlier run's. */
  it('after sign-off the cell is the final check\'s value', () => {
    const run = chk({ id: 1, subject: 'run', outcome: 'flagged', reasons: [region('mandible', ['Me'])] });
    const fin = chk({ id: 2, subject: 'final', modelId: null, outcome: 'clean' });
    expect(wholeFilmCell({ shown: fin, checks: [run, fin], off: false })).toBe('clean');
    expect(wholeFilmCell({ shown: run, checks: [run, fin], off: false })).toBe('flagged:region-mandible');
  });
});

// SC-1 Part 1b Task D2: the size look's lines, the order of the note (M11), the switch's `off` cell. SYNTHETIC values only.
describe('whole-film/2: the size line and the lines for a look that did not judge', () => {
  const SIZE_HALF = 'Whole-film check: this tracing is about ×0.5 the size of the anatomy on this film. Look at the whole tracing.';
  /** Fails if the size line is not the brief's words, or the factor is not shown to one decimal (×0.5, ×2.0). */
  it('the size line: the brief\'s words, the factor to one decimal', () => {
    expect(WHOLE_WORDS.size(0.5)).toBe(SIZE_HALF);
    expect(WHOLE_WORDS.size(2)).toBe('Whole-film check: this tracing is about ×2.0 the size of the anatomy on this film. Look at the whole tracing.');
    expect(WHOLE_WORDS.size(1.9996)).toContain('×2.0 ');
    expect(WHOLE_WORDS.size(0.4999999)).toContain('×0.5 ');
    expect(noteLines(chk({ reasons: [rs('size', { factor: 0.5 })] }))).toEqual([SIZE_HALF]);
    expect(WHOLE_WORDS.size(null)).toMatch(/different size/);
  });
  /** M11, facing-right order. Fails if size is put before the regions, before shape, or after no-ceph. */
  it('order with mirrored: mirrored, shape, region, size, no skull (and only one of mirrored/facing)', () => {
    const l = noteLines(chk({ reasons: [region('mandible', ['Me']), rs('size', { factor: 2 }), rs('mirrored'), rs('facing'), rs('shape', { named: ['SNB'] }), rs('no-ceph-found')] }));
    expect(l).toEqual([WHOLE_WORDS.mirrored, WHOLE_WORDS.shape('SNB'), WHOLE_WORDS.region('mandible', 'Me'), WHOLE_WORDS.size(2), WHOLE_WORDS.noCeph]);
  });
  /** M11, the other order: facing in place of mirrored. */
  it('order with facing: facing, shape, regions (combined), size, no skull', () => {
    const l = noteLines(chk({ reasons: [region('maxilla', ['A']), region('cranial-base', ['S']), rs('size', { factor: 0.5 }), rs('facing'), rs('shape', { named: ['ANB'] }), rs('no-ceph-found')] }));
    expect(l).toEqual([WHOLE_WORDS.facing, WHOLE_WORDS.shape('ANB'), WHOLE_WORDS.regions('maxilla, cranial base'), WHOLE_WORDS.size(0.5), WHOLE_WORDS.noCeph]);
    expect(l.filter((x) => x === WHOLE_WORDS.size(0.5))).toHaveLength(1);
  });
  /** The size line comes before the regions-not-checked line, which stays last. */
  it('a size flag with the regions not checked: size, then the regions-not-checked line', () => {
    expect(noteLines(chk({ regionLook: 'not-set-up', reasons: [rs('size', { factor: 0.5 })] }))).toEqual([WHOLE_WORDS.size(0.5), WHOLE_WORDS.regionsOff['not-set-up']]);
  });
  /** Fails if a film whose size calibration is missing does not say so, or says it where the regions were not looked at. */
  it('size not set up: its line after the region lines; no line when the regions were not checked at all', () => {
    expect(noteLines(chk({ sizeLook: 'not-set-up', reasons: [region('mandible', ['Me'])] }))).toEqual([WHOLE_WORDS.region('mandible', 'Me'), WHOLE_WORDS.sizeNotSetUp]);
    expect(noteLines(chk({ outcome: 'clean', sizeLook: 'not-set-up' }))).toEqual([WHOLE_WORDS.sizeNotSetUp]);
    expect(noteLines(chk({ outcome: 'clean', sizeLook: 'no-region-model', regionLook: 'no-region-model' }))).toEqual([WHOLE_WORDS.regionsOff['no-region-model']]);
    expect(noteLines(chk({ outcome: 'clean', sizeLook: 'film-too-small', regionLook: 'film-too-small' }))).toEqual([WHOLE_WORDS.regionsOff['film-too-small']]);
    expect(noteLines(chk({ outcome: 'clean', sizeLook: 'judged' }))).toEqual([]);
  });
  /** Fails if a flagged check whose regions were not looked at also says "size not checked" (the regions-not-checked line is the one reason given). */
  it('flagged on the shape alone, regions not checked: no size line, only the regions-not-checked line', () => {
    expect(noteLines(chk({ regionLook: 'no-region-model', sizeLook: 'no-region-model', reasons: [rs('shape', { named: ['SNB'] })] }))).toEqual([WHOLE_WORDS.shape('SNB'), WHOLE_WORDS.regionsOff['no-region-model']]);
    expect(noteLines(chk({ regionLook: 'not-set-up', sizeLook: 'not-set-up', reasons: [rs('shape', { named: ['SNB'] })] }))).toEqual([WHOLE_WORDS.shape('SNB'), WHOLE_WORDS.regionsOff['not-set-up']]);
  });
  /** The wording for an incomplete tracing: the size line, and the centre line when the centre was not judged. */
  it('an incomplete tracing: "not judged: incomplete tracing (all 19 points needed)" and the centre\'s own line', () => {
    expect(WHOLE_WORDS.sizeTooFew).toContain('not judged: incomplete tracing (all 19 points needed)');
    expect(WHOLE_WORDS.centreTooFew).toContain('not judged: S, N, Po, Ar and Or all needed');
    expect(noteLines(chk({ outcome: 'clean', present: 18, sizeLook: 'too-few', cbLook: 'too-few', cbPresent: 4 }))).toEqual([WHOLE_WORDS.sizeTooFew, WHOLE_WORDS.centreTooFew]);
    // the centre WAS judged (the missing point is not one of the five): only the size line
    expect(noteLines(chk({ outcome: 'clean', present: 18, sizeLook: 'too-few', cbLook: 'judged' }))).toEqual([WHOLE_WORDS.sizeTooFew]);
    // flagged: after the region line, before no-ceph
    expect(noteLines(chk({ present: 17, sizeLook: 'too-few', cbLook: 'too-few', cbPresent: 4, reasons: [region('mandible', ['Me'])] })))
      .toEqual([WHOLE_WORDS.region('mandible', 'Me'), WHOLE_WORDS.sizeTooFew, WHOLE_WORDS.centreTooFew]);
  });
  /** Review concern 3 / M3: the centre look's own status is stored, so a full tracing with no cranial-base box says so, and a missing
   *  calibration says so, instead of saying nothing or naming the wrong cause. */
  /** I3 (final review): a clean or flagged check whose shape look was not set up says so; the shape line comes first in a clean
   *  note and before the region lines in a flagged one. Fails if the shape look's not-set-up is left out of the note. */
  it('shape not set up: its own line, first, whatever else the note says', () => {
    expect(WHOLE_WORDS.shapeNotSetUp).toBe('Whole-film check: tracing shape not checked (not set up).');
    expect(noteLines(chk({ outcome: 'clean', shapeLook: 'not-set-up', present: 19, sizeLook: 'judged', cbLook: 'judged' }))).toEqual([WHOLE_WORDS.shapeNotSetUp]);
    expect(noteLines(chk({ outcome: 'clean', shapeLook: 'not-set-up', present: 19, regionLook: 'no-region-model' }))).toEqual([WHOLE_WORDS.shapeNotSetUp, WHOLE_WORDS.regionsOff['no-region-model']]);
    expect(noteLines(chk({ outcome: 'clean', shapeLook: 'judged', present: 19, sizeLook: 'judged', cbLook: 'judged' }))).toEqual([]);
    const flagged = noteLines(chk({ outcome: 'flagged', shapeLook: 'not-set-up', present: 19, reasons: [{ reason: 'mirrored', region: null, ids: [], named: [], factor: null } as never] }));
    expect(flagged[0]).toBe(WHOLE_WORDS.mirrored);
    expect(flagged).toContain(WHOLE_WORDS.shapeNotSetUp);
  });
  it('the centre look\'s own lines: no box on a full tracing, and not set up', () => {
    expect(WHOLE_WORDS.centreNoBox).toBe('Whole-film check: cranial-base centre not judged: no cranial-base box found on this film.');
    expect(WHOLE_WORDS.centreNotSetUp).toBe('Whole-film check: cranial-base centre not checked (not set up).');
    expect(noteLines(chk({ outcome: 'clean', present: 19, cbLook: 'too-few', cbPresent: 5 }))).toEqual([WHOLE_WORDS.centreNoBox]);
    // N2: the cause is the stored count, not the total. 18 points missing a NON-cranial-base point and no box: the box, not the points.
    expect(noteLines(chk({ outcome: 'clean', present: 18, cbLook: 'too-few', cbPresent: 5 }))).toEqual([WHOLE_WORDS.centreNoBox]);
    // a cranial-base point missing (4 of 5): the points wording
    expect(noteLines(chk({ outcome: 'clean', present: 18, cbLook: 'too-few', cbPresent: 4 }))).toEqual([WHOLE_WORDS.centreTooFew]);
    expect(noteLines(chk({ outcome: 'clean', present: 19, cbLook: 'not-set-up' }))).toEqual([WHOLE_WORDS.centreNotSetUp]);
    expect(noteLines(chk({ outcome: 'clean', present: 19, sizeLook: 'not-set-up', cbLook: 'not-set-up' }))).toEqual([WHOLE_WORDS.sizeNotSetUp, WHOLE_WORDS.centreNotSetUp]);
    // an incomplete tracing keeps the points wording; the regions not looked at say nothing of the centre
    expect(noteLines(chk({ outcome: 'clean', present: 18, sizeLook: 'too-few', cbLook: 'too-few', cbPresent: 4 }))).toEqual([WHOLE_WORDS.sizeTooFew, WHOLE_WORDS.centreTooFew]);
    expect(noteLines(chk({ outcome: 'clean', regionLook: 'no-region-model', sizeLook: 'no-region-model', cbLook: 'no-region-model' }))).toEqual([WHOLE_WORDS.regionsOff['no-region-model']]);
  });
  /** Fewer than 3 regions found (all 19 points present): the no-skull line only, never "incomplete tracing". */
  it('too few with all 19 points present is the no-skull case: no incomplete-tracing line', () => {
    expect(noteLines(chk({ present: 19, sizeLook: 'too-few', cbLook: 'too-few', cbPresent: 5, reasons: [rs('no-ceph-found')] }))).toEqual([WHOLE_WORDS.noCeph]);
  });
  /** The size reason in the CSV cell. */
  it('wholeFilmCell: flagged:size, flagged:region-cranial-base+size', () => {
    const view = (shown: WholeCheckView): WholeFilmView => ({ shown, checks: [shown], off: false });
    expect(wholeFilmCell(view(chk({ reasons: [rs('size', { factor: 0.5 })] })))).toBe('flagged:size');
    expect(wholeFilmCell(view(chk({ reasons: [region('cranial-base', ['S', 'N']), rs('size', { factor: 2 })] })))).toBe('flagged:region-cranial-base+size');
  });
  /** The switch off: the cell reads `off` (not blank, which reads "no record"), even if a stale check is in the view. */
  it('wholeFilmCell: off', () => {
    expect(wholeFilmCell({ shown: null, checks: [], off: true })).toBe('off');
    expect(wholeFilmCell({ shown: chk({ outcome: 'clean' }), checks: [], off: true })).toBe('off');
    expect(wholeFilmCell({ shown: null, checks: [], off: false })).toBe('');
  });
  /** The note shows nothing when off: nothing is shown for the open film, even from a stale view. */
  it('shownFor: off shows nothing', () => {
    const v = (off: boolean): WholeFilmView => ({ shown: chk({ id: 4 }), checks: [], off });
    expect(shownFor({ caseId: 'c1', view: v(false) }, 'c1')?.id).toBe(4);
    expect(shownFor({ caseId: 'c1', view: v(true) }, 'c1')).toBeNull();
  });
});

// Research switch (owner, 6 Nov 2026): the per-landmark region cell. SYNTHETIC values.
describe('wholeFilmRegionCell', () => {
  const lr = (id: string, result: 'fine' | 'flagged' | 'not-checked') => ({ id, region: 'x', result });
  const view = (landmarkRegions: ReturnType<typeof lr>[], over: Partial<WholeCheckView> = {}): WholeFilmView => ({ shown: chk({ landmarkRegions, ...over }), checks: [], off: false });
  /** Fails if a result is written as its stored key, or the three words change. */
  it('fine, region flagged, not checked', () => {
    const v = view([lr('S', 'fine'), lr('N', 'flagged'), lr('Go', 'not-checked')]);
    expect([wholeFilmRegionCell(v, 'S'), wholeFilmRegionCell(v, 'N'), wholeFilmRegionCell(v, 'Go')]).toEqual(['fine', 'region flagged', 'not checked']);
  });
  /** A landmark the check has no entry for is "not checked", never "fine". */
  it('a landmark with no stored entry reads not checked (an older record never reads fine)', () => {
    expect(wholeFilmRegionCell(view([lr('S', 'fine')]), 'ZZ')).toBe('not checked');
    expect(wholeFilmRegionCell({ shown: chk(), checks: [], off: false }, 'S')).toBe('not checked');
  });
  it('never checked: blank; check off: off', () => {
    expect(wholeFilmRegionCell(null, 'S')).toBe('');
    expect(wholeFilmRegionCell({ shown: null, checks: [], off: false }, 'S')).toBe('');
    expect(wholeFilmRegionCell({ shown: null, checks: [], off: true }, 'S')).toBe('off');
  });
});

// Research switch (owner ruling 6 Nov 2026): each look's status, for the PDF and CSV.
describe('wholeFilmLooks', () => {
  const v = (over: Partial<WholeCheckView>): WholeFilmView => ({ shown: chk(over), checks: [], off: false });
  /** Fails if a look that did not run reads `judged`, or a judged one reads otherwise. */
  it('a full check: every look judged', () => {
    expect(wholeFilmLooks(v({ shapeLook: 'judged', regionLook: 'judged', sizeLook: 'judged', cbLook: 'judged', regionFacing: true }))).toEqual({ shape: 'judged', regions: 'judged', size: 'judged', centre: 'judged', mirrored: 'judged', facing: 'judged' });
  });
  it('a partial tracing: shape too few points, the rest not judged, with the reason in words', () => {
    const l = wholeFilmLooks(v({ outcome: 'not-run', shapeLook: 'too-few-points', regionLook: 'not-set-up', sizeLook: 'too-few', cbLook: 'no-region-model', present: 9 }));
    expect(l.shape).toBe('not checked (too few points)');
    expect(l.regions).toBe('not checked (not set up)');
    expect(l.size).toBe('not checked (too few points or regions)');
    expect(l.centre).toBe('not checked (no region finder)');
    expect(l.mirrored).toBe(l.shape);
    expect(l.facing).toBe('not checked (no facing found)');
  });
  /** Fails if facing reads `judged` when the finder gave no facing (the regions then compared nothing), or stops reading `judged` when it did or the shape ran. */
  it('facing: the shape look, or a facing the finder actually gave; otherwise not checked (no facing found)', () => {
    expect(wholeFilmLooks(v({ shapeLook: 'judged', regionLook: 'judged', regionFacing: false })).facing).toBe('judged');
    expect(wholeFilmLooks(v({ shapeLook: 'not-set-up', regionLook: 'judged', regionFacing: true })).facing).toBe('judged');
    expect(wholeFilmLooks(v({ shapeLook: 'not-set-up', regionLook: 'judged', regionFacing: false })).facing).toBe('not checked (no facing found)');
    expect(wholeFilmLooks(v({ shapeLook: 'not-set-up', regionLook: 'judged' })).facing).toBe('not checked (no facing found)');   // an older view with no such field
    expect(wholeFilmLooks(v({ shapeLook: 'too-few-points', regionLook: 'not-set-up', regionFacing: false })).facing).toBe('not checked (no facing found)');
  });
  it('never checked: blank; check off: off', () => {
    expect(Object.values(wholeFilmLooks(null)).every((x) => x === '')).toBe(true);
    expect(Object.values(wholeFilmLooks({ shown: null, checks: [], off: true })).every((x) => x === 'off')).toBe(true);
  });
  it('the one-line form', () => { expect(looksLine(wholeFilmLooks(v({})))).toBe('shape judged; regions judged; size judged; centre judged; mirrored judged; facing judged'); });
});
