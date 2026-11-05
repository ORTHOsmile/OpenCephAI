import { describe, expect, it } from 'vitest';
import { CHOOSE_LABELS, type ChooseField } from './choose';
import { CHOOSE_TO_DETAIL, chooserChoices, FILM_CHOICES, fresh, importDay, notesAfterReread, notesAfterRemove, waitingAfterReread, reread, savedChoices, valueFor, visibleChoices,
  type FilmChoice, type FilmDetail, type FilmRow } from './filmTable';
import { docOf } from './fixtures';
import { toEdit } from './persist';
import { initialTracing } from '../tracing/state';

// Synthetic label lines only (no patient data).
const LINES = ['Demo Radiology Northside', 'DEMO, Synthetic', 'M, Y34', 'DOB 07/03/1990 SYNTHETIC', 'PID 5566', 'Se: Feb 07, 2024 01:36 PM', 'Ref: Dr Demo'];
// S7 (preflight rulings): the CaseDoc field is `printedPatientId`, not `patientId` — the drop-down/table value stays `patientId`.
const NOTHING = { patientName: '', dateOfBirth: null, takenOn: null, scanId: null, gender: null, referringPractitioner: null,
  printedPatientId: null, xrayType: null, xraySize: null, radiographyPractice: null, title: null, ageOnFilm: null };

describe('valueFor: what choosing a detail for a line fills', () => {
  it('fills each detail by the same rules as Choose on the film', () => {
    expect(valueFor('name', 'DEMO, Synthetic', 'AU')).toEqual({ value: 'Demo, Synthetic' });
    expect(valueFor('dob', 'DOB 07/03/1990 SYNTHETIC', 'AU')).toEqual({ value: '1990-03-07' });   // SYNTHETIC
    expect(valueFor('date', 'Se: Feb 07, 2024 01:36 PM', 'AU')).toEqual({ value: '2024-02-07' });
    expect(valueFor('scan', 'PID 5566', 'AU')).toEqual({ value: '5566' });
    expect(valueFor('gender', 'M, Y34', 'AU')).toEqual({ value: 'M' });
    expect(valueFor('referrer', 'Ref: Dr Demo', 'AU')).toEqual({ value: 'Dr Demo' });
  });
  it('Film date on the table goes through chosenValue, so it gets the scrap/cut-year fix too (owner 5 Oct)', () => {
    expect(valueFor('date', '024-Jan-12', 'AU')).toEqual({ value: '2024-01-12' });   // SYNTHETIC: was a note before the fix
    expect(valueFor('date', ')24-Jan-12', 'AU')).toEqual({ note: "That line isn't a date" });   // SYNTHETIC: was wrongly 2012-01-24
  });
  it('a line that is not that detail gives a note and no value', () => {
    expect(valueFor('dob', 'Demo Radiology Northside', 'AU')).toEqual({ note: "That line isn't a date" });
    expect(valueFor('name', 'DOB 07/03/1990 SYNTHETIC', 'AU')).toEqual({ note: "That line isn't a name" });   // SYNTHETIC
    expect(valueFor('gender', 'Demo Radiology Northside', 'AU')).toEqual({ note: "That line isn't F or M" });
    expect(valueFor('scan', '   ', 'AU')).toEqual({ note: 'That line is empty' });
  });
});

describe('savedChoices: what each line already is when the film opens', () => {
  it('shows a saved detail on the first line that reads as it, and — elsewhere', () => {
    const doc = { ...NOTHING, patientName: 'Demo Synthetic', dateOfBirth: '1990-03-07', takenOn: null, scanId: '5566', gender: 'M' as const, referringPractitioner: 'Dr Demo' };   // SYNTHETIC
    expect(savedChoices(LINES, doc, 'AU')).toEqual(['none', 'name', 'gender', 'dob', 'scan', 'none', 'referrer']);
  });
  it('nothing saved shows — on every line, and an empty film shows nothing', () => {
    expect(savedChoices(LINES, NOTHING, 'AU')).toEqual(LINES.map(() => 'none'));
    expect(savedChoices([], NOTHING, 'AU')).toEqual([]);
  });
  it('one detail shows on one line only, the first top to bottom', () => {
    expect(savedChoices(['PID 5566', 'PID 5566'], { ...NOTHING, scanId: '5566' }, 'AU')).toEqual(['scan', 'none']);
  });
});

// Owner's rule, approved in chat 5 Oct: a line the owner edited is human-entered and is never overwritten by a
// re-read; a re-read only refreshes lines nobody edited. Covers both a full "Read the film again" and a
// Choose-on-the-film spot re-read (lines appended) with the one function.
describe('fresh: the first reading, every row unedited', () => {
  it('one row per line, text equal to original', () => {
    expect(fresh(['a', 'b'])).toEqual([{ original: 'a', text: 'a' }, { original: 'b', text: 'b' }]);
  });
  it('empty lines: no rows', () => {
    expect(fresh([])).toEqual([]);
  });
});

describe('reread: edited lines survive; unedited lines refresh; a gone edit is kept at the end', () => {
  it('no edits: result equals the new reading', () => {
    const prev: FilmRow[] = [{ original: 'a', text: 'a' }, { original: 'b', text: 'b' }];
    expect(reread(prev, ['x', 'y'])).toEqual([{ original: 'x', text: 'x' }, { original: 'y', text: 'y' }]);
  });
  it('an edited line read again with the same original text keeps the edit in place', () => {
    const prev: FilmRow[] = [{ original: 'a', text: 'A edited' }, { original: 'b', text: 'b' }];
    expect(reread(prev, ['a', 'b'])).toEqual([{ original: 'a', text: 'A edited' }, { original: 'b', text: 'b' }]);
  });
  it('an unedited line read differently is refreshed', () => {
    const prev: FilmRow[] = [{ original: 'a', text: 'a' }];
    expect(reread(prev, ['x'])).toEqual([{ original: 'x', text: 'x' }]);
  });
  it('an edited line whose original is gone from the new reading is appended, marked kept', () => {
    const prev: FilmRow[] = [{ original: 'a', text: 'A edited' }, { original: 'b', text: 'b' }];
    expect(reread(prev, ['b', 'c'])).toEqual([
      { original: 'b', text: 'b' }, { original: 'c', text: 'c' }, { original: 'a', text: 'A edited', kept: true },
    ]);
  });
  it('two identical film lines, one edited: the edit stays on the first unclaimed match', () => {
    const prev: FilmRow[] = [{ original: 'a', text: 'a' }, { original: 'a', text: 'A edited' }];
    expect(reread(prev, ['a', 'a'])).toEqual([{ original: 'a', text: 'A edited' }, { original: 'a', text: 'a' }]);
  });
  it('an appended reading (Choose on the film re-reading a spot) keeps edits in place', () => {
    const prev: FilmRow[] = [{ original: 'a', text: 'A edited' }, { original: 'b', text: 'b' }];
    expect(reread(prev, ['a', 'b', 'c'])).toEqual([
      { original: 'a', text: 'A edited' }, { original: 'b', text: 'b' }, { original: 'c', text: 'c' },
    ]);
  });
  it('empty next (a re-read that found nothing) keeps only the edited rows, all kept', () => {
    const prev: FilmRow[] = [{ original: 'a', text: 'A edited' }, { original: 'b', text: 'b' }];
    expect(reread(prev, [])).toEqual([{ original: 'a', text: 'A edited', kept: true }]);
  });
  it('empty prev (nothing read yet): next is used as-is', () => {
    expect(reread([], ['a', 'b'])).toEqual([{ original: 'a', text: 'a' }, { original: 'b', text: 'b' }]);
  });
});

describe('importDay', () => {
  it('is the local calendar day of the import time', () => {
    const t = new Date(2026, 9, 4, 23, 30).toISOString();
    expect(importDay(t)).toBe('2026-10-04');
  });
});

describe('the new details (spec 2026-10-17)', () => {
  it('reads each new choice as printed, and Patient ID like a Scan ID', () => {
    expect(valueFor('last', 'SMITH,', 'AU')).toEqual({ value: 'Smith' });
    expect(valueFor('first', 'john', 'AU')).toEqual({ value: 'John' });
    expect(valueFor('patientId', 'PID 5566', 'AU')).toEqual({ value: '5566' });
    expect(valueFor('xrayType', '  LATERAL   CEPH ', 'AU')).toEqual({ value: 'LATERAL CEPH' });
    expect(valueFor('xraySize', '24 x 30 cm', 'AU')).toEqual({ value: '24 x 30 cm' });
    expect(valueFor('xraySize', '10/12', 'AU')).toEqual({ value: '10/12' });          // never read as a date
    expect(valueFor('practice', 'Demo Radiology Northside', 'AU')).toEqual({ value: 'Demo Radiology Northside' });
  });
  it('gives a note and no value when a line cannot be that detail', () => {
    expect(valueFor('practice', ' - ', 'AU')).toEqual({ note: 'That line has no letters or numbers' });
    expect(valueFor('patientId', 'PID', 'AU')).toEqual({ note: "That line isn't an ID" });
    expect(valueFor('last', 'DOB 07/03/1990 SYNTHETIC', 'AU')).toEqual({ note: "That line isn't a name" });   // SYNTHETIC
    expect(valueFor('xrayType', 'x'.repeat(201), 'AU')).toEqual({ note: 'That line is too long (over 200 characters)' });
    expect(valueFor('xrayType', 'x'.repeat(200), 'AU')).toEqual({ value: 'x'.repeat(200) });
    expect(valueFor('xraySize', '   ', 'AU')).toEqual({ note: 'That line is empty' });
  });
  it('shows saved details against their lines, Last and First from a "Last, First" name', () => {
    const lines = ['Demo Radiology Northside', 'SMITH', 'John', 'PID 5566', 'LATERAL CEPH'];
    // S7: the CaseDoc field is `printedPatientId`; `patientId` is the FilmDetail/drop-down value, unaffected.
    const doc = { ...NOTHING, patientName: 'Smith, John', printedPatientId: '5566', xrayType: 'LATERAL CEPH', radiographyPractice: 'Demo Radiology Northside' };
    expect(savedChoices(lines, doc, 'AU')).toEqual(['practice', 'last', 'first', 'patientId', 'xrayType']);
    expect(savedChoices(lines, { ...doc, patientName: 'John Smith' }, 'AU')).toEqual(['practice', 'none', 'none', 'patientId', 'xrayType']);
    expect(savedChoices(['PID 5566'], { ...doc, scanId: '5566' }, 'AU')).toEqual(['scan']);   // one line, two equal details: the first in the list
  });
  it('hides switched-off choices except the one a line already shows', () => {
    const off = new Set<FilmDetail>(['xraySize', 'gender']);
    const values = (c: FilmChoice) => visibleChoices(off, c).map((x) => x.value);
    expect(values('none')).not.toContain('xraySize');
    expect(values('none')).toContain('none');
    expect(values('xraySize')).toContain('xraySize');
  });
  // Fix round 1 (review M3): the drop-down used to measure the 200 limit on the RAW line, before the "PID" label
  // was stripped, so a label plus a 198-character ID was wrongly refused here while Choose on the film (which
  // always measured the cleaned value) accepted the identical value. Both paths must now agree.
  it('measures the 200 limit on the ID after its label is stripped, like Choose on the film (M3)', () => {
    const id198 = 'x'.repeat(198);
    expect(valueFor('patientId', `PID ${id198}`, 'AU')).toEqual({ value: id198 });
    const id201 = 'x'.repeat(201);
    expect(valueFor('patientId', `PID ${id201}`, 'AU')).toEqual({ note: 'That line is too long (over 200 characters)' });
  });
  // M4: a 2-UTF-16-unit astral letter (U+1D538, "MATHEMATICAL DOUBLE-STRUCK CAPITAL A") counts as ONE code point,
  // not two — the drop-down must agree with Choose on the film (choose.test.ts has the sibling check).
  it('counts an astral letter as one code point, not two UTF-16 units (M4)', () => {
    const astral = '\u{1D538}';
    expect(valueFor('xrayType', astral.repeat(200), 'AU')).toEqual({ value: astral.repeat(200) });
    expect(valueFor('xrayType', astral.repeat(201), 'AU')).toEqual({ note: 'That line is too long (over 200 characters)' });
  });
});

describe('the box words (owner Q12): FILM_CHOICES, the drop-down and Choose on the film agree', () => {
  it('one list, in the owner\'s order (E, 19 Oct; Title and Age join with format 13)', () => {
    expect(FILM_CHOICES.map((c) => c.label)).toEqual(['—', 'Title', 'Full name', 'Last name', 'First name(s)', 'DOB', 'Age', 'Gender', 'Film date',
      'Scan ID', 'Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice', 'Referring practitioner']);
    for (const [f, d] of Object.entries(CHOOSE_TO_DETAIL)) expect(FILM_CHOICES.find((c) => c.value === d)!.label, f).toBe(CHOOSE_LABELS[f as ChooseField]);
  });
  it('the chooser on the X-ray offers the same list, without "—"', () => {
    expect(chooserChoices(new Set(), null)).toEqual(FILM_CHOICES.filter((c) => c.value !== 'none'));
    expect(chooserChoices(new Set(['gender', 'name']), null).map((c) => c.value)).not.toContain('gender');
    expect(chooserChoices(new Set(['gender', 'name']), null).map((c) => c.value)).not.toContain('name');
    expect(chooserChoices(new Set(FILM_CHOICES.map((c) => c.value).filter((v) => v !== 'none') as FilmDetail[]), null)).toEqual([]);
  });
  it('from a Pick button, only that detail — even when switched off', () => {
    expect(chooserChoices(new Set(), 'dob').map((c) => c.label)).toEqual(['DOB']);
    expect(chooserChoices(new Set(['dob']), 'dob').map((c) => c.label)).toEqual(['DOB']);
  });
  it('switching Full name off hides exactly the Full name choice', () => {
    const shown = visibleChoices(new Set(['name']), 'none').map((c) => c.label);
    expect(shown).not.toContain('Full name');
    expect(shown).toEqual(expect.arrayContaining(['Last name', 'First name(s)']));
  });
});

describe('Title in the one list (owner T1)', () => {
  it('Title comes first after "—"; the list is the owner\'s order so far', () => {
    expect(FILM_CHOICES.slice(0, 3).map((c) => c.label)).toEqual(['—', 'Title', 'Full name']);
  });
  it('reads a title line as printed, refuses anything else with the owner\'s words', () => {
    expect(valueFor('title', 'Mrs.', 'AU')).toEqual({ value: 'Mrs.' });
    expect(valueFor('title', 'Sir', 'AU')).toEqual({ note: "That isn't a title (Mr, Mrs, Ms, Miss, Master, Dr…)" });
  });
  it('a saved title shows on its line; a saved name shows on its line even when the line starts with the title', () => {
    const lines = ['MR JOHN DEMO', 'Mr', 'other'];
    const doc = { ...docOf(toEdit('c1', 'right', initialTracing)), patientName: 'John Demo', title: 'Mr' };
    expect(savedChoices(lines, doc, 'AU')).toEqual(['name', 'title', 'none']);
  });
});

describe('Age in the one list (owner AG1)', () => {
  it('Age comes after DOB', () => {
    const labels = FILM_CHOICES.map((c) => c.label);
    expect(labels.slice(labels.indexOf('DOB'), labels.indexOf('DOB') + 3)).toEqual(['DOB', 'Age', 'Gender']);
    expect(labels).toEqual(['—', 'Title', 'Full name', 'Last name', 'First name(s)', 'DOB', 'Age', 'Gender', 'Film date', 'Scan ID',
      'Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice', 'Referring practitioner']);   // the spec's whole list
  });
  it('reads an age line as printed; refuses "000Y" with the owner\'s words', () => {
    expect(valueFor('age', 'Age: 011Y', 'AU')).toEqual({ value: '011Y' });
    expect(valueFor('age', '000Y', 'AU')).toEqual({ note: "That isn't an age" });
  });
  it('a saved age shows on its line', () => {
    const doc = { ...docOf(toEdit('c1', 'right', initialTracing)), ageOnFilm: '011Y', ageOnFilmYears: 11 };
    expect(savedChoices(['x', 'Age: 011Y'], doc, 'AU')).toEqual(['none', 'age']);
  });
});

describe('notes follow their rows', () => {
  it('a note under an edited row that stays in place survives a re-read', () => {
    const prev = [{ original: 'NAME SYNTHETIC', text: 'NAME SYNTHETIC X' }, { original: 'DOB 01/01/2000 SYNTHETIC', text: 'DOB 01/01/2000 SYNTHETIC' }];
    const next = reread(prev, ['NAME SYNTHETIC', 'DOB 01/01/2000 SYNTHETIC']);
    expect(notesAfterReread(prev, next, { 0: 'warn' })).toEqual({ 0: 'warn' });
  });
  it('no notes gives no notes', () => {
    const prev = [{ original: 'A', text: 'A2' }];
    expect(notesAfterReread(prev, reread(prev, ['A']), {})).toEqual({});
  });
  it('a note under an unedited row goes', () => {
    const prev = [{ original: 'A', text: 'A' }];
    expect(notesAfterReread(prev, reread(prev, ['A']), { 0: 'warn' })).toEqual({});
  });
  it('a note under an edited row whose line vanished follows it to the end', () => {
    const prev = [{ original: 'A', text: 'A2' }, { original: 'B', text: 'B' }];
    const next = reread(prev, ['B', 'C']);
    expect(notesAfterReread(prev, next, { 0: 'warn' })).toEqual({ 2: 'warn' });
  });
  it('two edited rows with the same original: each note follows its own row', () => {
    const prev = [{ original: 'X', text: 'X1' }, { original: 'X', text: 'X2' }];
    const next = reread(prev, ['Z', 'X', 'X']);
    expect(next.map((r) => r.text)).toEqual(['Z', 'X1', 'X2']);
    expect(notesAfterReread(prev, next, { 0: 'one', 1: 'two' })).toEqual({ 1: 'one', 2: 'two' });
  });
  it('two edited rows with the same original, only one line left: the second goes to the end with its note', () => {
    const prev = [{ original: 'X', text: 'X1' }, { original: 'X', text: 'X2' }];
    const next = reread(prev, ['X']);
    expect(notesAfterReread(prev, next, { 0: 'one', 1: 'two' })).toEqual({ 0: 'one', 1: 'two' });
  });
  it('removing a row moves the notes below it up by one', () => {
    expect(notesAfterRemove({ 1: 'one', 2: 'two', 4: 'four' }, 2)).toEqual({ 1: 'one', 3: 'four' });
  });
  it('removing the last row just drops its note', () => {
    expect(notesAfterRemove({ 0: 'a', 2: 'c' }, 2)).toEqual({ 0: 'a' });
  });
  it('removing a row with no notes changes nothing', () => {
    expect(notesAfterRemove({}, 0)).toEqual({});
  });
});

describe('the row waiting for "Now choose the ..." follows its row', () => {
  const prev = [{ original: 'A', text: 'A2' }, { original: 'B', text: 'B2' }];
  it('a re-read that swaps the two edited rows moves waiting with its row', () => {
    const next = reread(prev, ['B', 'A']);
    expect(waitingAfterReread(prev, next, 1)).toBe(0);
    expect(waitingAfterReread(prev, next, 0)).toBe(1);
  });
  it('nothing waiting stays nothing', () => { expect(waitingAfterReread(prev, reread(prev, ['A', 'B']), null)).toBeNull(); });
  it('a waiting row that was unedited is cleared', () => {
    const p2 = [{ original: 'A', text: 'A' }];
    expect(waitingAfterReread(p2, reread(p2, ['A']), 0)).toBeNull();
  });
  it('a waiting edited row whose line vanished follows it to the end', () => {
    expect(waitingAfterReread(prev, reread(prev, ['B']), 0)).toBe(1);
  });
});
