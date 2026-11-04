import { describe, expect, it } from 'vitest';
import { CHOOSE_LABELS, type ChooseField } from './choose';
import { CHOOSE_TO_DETAIL, FILM_CHOICES, fresh, importDay, reread, savedChoices, valueFor, visibleChoices,
  type FilmChoice, type FilmDetail, type FilmRow } from './filmTable';

// Synthetic label lines only (no patient data).
const LINES = ['Demo Radiology Northside', 'DEMO, Synthetic', 'M, Y34', 'DOB 07/03/1990 SYNTHETIC', 'PID 5566', 'Se: Feb 07, 2024 01:36 PM', 'Ref: Dr Demo'];
// S7 (preflight rulings): the CaseDoc field is `printedPatientId`, not `patientId` — the drop-down/table value stays `patientId`.
const NOTHING = { patientName: '', dateOfBirth: null, takenOn: null, scanId: null, gender: null, referringPractitioner: null,
  printedPatientId: null, xrayType: null, xraySize: null, radiographyPractice: null };

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
  it('uses the box words everywhere (owner Q12)', () => {
    expect(FILM_CHOICES.map((c) => c.label)).toEqual(['—', 'Full name', 'Last name', 'First name(s)', 'DOB', 'Film date', 'Scan ID',
      'Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice', 'Referring practitioner', 'Gender']);
    for (const [f, d] of Object.entries(CHOOSE_TO_DETAIL)) expect(FILM_CHOICES.find((c) => c.value === d)!.label, f).toBe(CHOOSE_LABELS[f as ChooseField]);
  });
  it('switching Full name off hides exactly the Full name choice', () => {
    const shown = visibleChoices(new Set(['name']), 'none').map((c) => c.label);
    expect(shown).not.toContain('Full name');
    expect(shown).toEqual(expect.arrayContaining(['Last name', 'First name(s)']));
  });
});
