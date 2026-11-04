import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharedDateCases from '../../../../test-fixtures/label-date-cases.json';
// D11 (preflight rulings): the fields/limit shared with the Rust label reader, as a static import — resolved
// relative to THIS FILE (a module specifier is never resolved against process.cwd()), same as sharedDateCases above.
import detailFields from '../../../../crates/ceph-label/tests/detail_fields.json';
import {
  ALL_CHOOSE_FIELDS, CHOOSE_LABELS, DETAIL_FIELDS, DETAIL_MAX, chosenValue, composeName, dateRefusal, dragSel, extendSel,
  isDetailField, labelMatcher, locate, nameAfterChoosing, selSpans, selText, unsureFields, wordAt,
} from './choose';
import { docOf } from './fixtures';
import type { CaseEdit, FilmLine } from '../ipc';

const EDIT = { id: 'c', facing: 'right', orientation: {}, display: {}, landmarks: [] } as unknown as CaseEdit;

const even = (text: string, bbox: [number, number, number, number]): FilmLine => {
  const n = text.length; let i = 0;
  return { text, bbox, words: text.split(' ').map((w) => { const x = bbox[0] + (bbox[2] * i) / n; i += w.length + 1;
    return { text: w, bbox: [x, bbox[1], (bbox[2] * w.length) / n, bbox[3]] as [number, number, number, number] }; }) };
};
const lines = [even('SMITH, John', [0.02, 0.05, 0.3, 0.02]), even('PID 12345', [0.02, 0.14, 0.12, 0.02])];   // SYNTHETIC

describe('choosing words on the film', () => {
  it('a click selects a word; shift extends along the line; a click on a selected word clears', () => {
    const a = extendSel(null, 0, 0, false);
    expect(a).toEqual({ line: 0, from: 0, to: 0 });
    expect(extendSel(a, 0, 1, true)).toEqual({ line: 0, from: 0, to: 1 });
    expect(extendSel(a, 3, 1, true)).toEqual({ line: 3, from: 1, to: 1 });   // a line further away starts again
    expect(extendSel(a, 0, 0, false)).toBeNull();
  });
  it('the selected words read as one text', () => {
    expect(selText(lines, { line: 0, from: 0, to: 1 })).toBe('SMITH, John');   // SYNTHETIC
  });
  it('values are tidied per field', () => {
    expect(chosenValue('last', 'SMITH,', 'AU')).toBe('Smith');
    expect(chosenValue('full', 'SMITH, John', 'AU')).toBe('Smith, John');   // SYNTHETIC
    expect(chosenValue('film_date', 'Feb 07, 2024', 'AU')).toBe('2024-02-07');
    expect(chosenValue('scan_id', '12345', 'AU')).toBe('12345');
    expect(chosenValue('dob', 'no date', 'AU')).toBeNull();
  });
  it('last and first make "Last, First"', () => {
    expect(composeName('Smith', 'John')).toBe('Smith, John');   // SYNTHETIC
    expect(composeName('Smith', null)).toBe('Smith');
    expect(composeName(null, null)).toBeNull();
  });
  it('finds the word under a point in the film frame', () => {
    expect(wordAt(lines, { x: 0.03, y: 0.06 })).toEqual({ line: 0, word: 0 });
    expect(wordAt(lines, { x: 0.9, y: 0.9 })).toBeNull();
  });
  it('the fields to choose are the blank ones and the learned, unconfirmed ones', () => {
    const doc = { patientName: '', dateOfBirth: null, scanId: '1', takenOnSource: 'label', learnedFields: ['scan_id'] } as never;
    expect(unsureFields(doc)).toEqual(['full', 'dob', 'scan_id']);
  });
});

describe('nameAfterChoosing (final review I5): either part may be chosen first', () => {
  it('waits for the other part, then saves "Last, First"', () => {
    const a = nameAfterChoosing('first', 'John', '', { last: null, first: null });
    expect(a).toEqual({ save: null, pending: { last: null, first: 'John' } });
    expect(nameAfterChoosing('last', 'Smith', '', a.pending)).toEqual({ save: 'Smith, John', pending: { last: null, first: null } });   // SYNTHETIC
    const b = nameAfterChoosing('last', 'Smith', '', { last: null, first: null });
    expect(nameAfterChoosing('first', 'John', '', b.pending).save).toBe('Smith, John');   // SYNTHETIC
  });
  it('replaces one part of a saved "Last, First" name', () => {
    expect(nameAfterChoosing('first', 'Jon', 'Smith, John', { last: null, first: null }).save).toBe('Smith, Jon');   // SYNTHETIC
    expect(nameAfterChoosing('last', 'Smyth', 'Smith, John', { last: null, first: null }).save).toBe('Smyth, John');   // SYNTHETIC
  });
});

describe('owner 30 Sep: easier selection and the label\'s own value', () => {
  const three = [...lines, even('DOB 04/03/2012 SYNTHETIC', [0.02, 0.2, 0.25, 0.02])];   // SYNTHETIC
  it('shift-click on the line below carries the selection onto it', () => {
    const a = extendSel(null, 0, 1, false);
    const b = extendSel(a, 1, 0, true);
    expect(b).toEqual({ line: 0, from: 1, to: 1, next: 0 });
    expect(selText(lines, b!)).toBe('John PID');
    expect(selSpans(lines, b!)).toEqual([{ line: 0, from: 1, to: 1 }, { line: 1, from: 0, to: 0 }]);
    expect(extendSel(b, 0, 0, true)).toEqual({ line: 0, from: 0, to: 1 });   // back on the first line: one line again
  });
  it('a drag across words on one line selects them', () => {
    expect(dragSel({ line: 0, word: 1 }, 0, 0)).toEqual({ line: 0, from: 0, to: 1 });
    expect(dragSel({ line: 0, word: 1 }, 2, 0)).toEqual({ line: 0, from: 1, to: 1 });   // off the line: just the start
  });
  it('finds the label\'s own value on the film: dates by meaning, names and IDs by their words', () => {
    expect(locate(three, labelMatcher('dob', '2012-03-04', 'AU'))).toEqual({ line: 2, from: 1, to: 1 });   // SYNTHETIC
    expect(locate(three, labelMatcher('name', 'Smith, John', 'AU'))).toEqual({ line: 0, from: 0, to: 1 });   // SYNTHETIC
    expect(locate(three, labelMatcher('scan_id', '12345', 'AU'))).toEqual({ line: 1, from: 1, to: 1 });
    expect(locate(three, labelMatcher('scan_id', '99999', 'AU'))).toBeNull();
  });
});

describe('final review: a surname wrapped at its hyphen', () => {
  it('joins without a space', () => {
    const w = [even('Name: SMITH-', [0.02, 0.05, 0.2, 0.02]), even('JONES, John', [0.02, 0.08, 0.2, 0.02])];   // SYNTHETIC
    expect(selText(w, { line: 0, from: 1, to: 1, next: 1 })).toBe('SMITH-JONES, John');   // SYNTHETIC
  });
});

describe('owner 2 Oct: a DOB printed year–month–day with the month in letters, and a Scan ID as printed', () => {
  it('reads 1987-Jan-02 and 1987 JAN 02 as dates', () => {
    expect(chosenValue('dob', '1987-Jan-02', 'AU')).toBe('1987-01-02');   // SYNTHETIC
    expect(chosenValue('dob', '1987 JAN 02', 'US')).toBe('1987-01-02');   // SYNTHETIC
  });
  it('completes a birth year that lost its first digit only when one completion is possible', () => {
    expect(chosenValue('dob', '987-Jan-02', 'AU')).toBe('1987-01-02');    // SYNTHETIC: 2987 is in the future
    expect(chosenValue('dob', '012-Mar-04', 'AU')).toBe('2012-03-04');    // SYNTHETIC: 1012 is not a birth year
    // Owner, 5 Oct (film-date/brief.md item 1): Film date now gets the SAME completion as DOB — a cut-off first
    // digit of the year is completed the same way for both fields; see the dedicated describe block below.
    expect(chosenValue('film_date', '987-Jan-02', 'AU')).toBe('1987-01-02');   // SYNTHETIC: was null before the 5 Oct fix
  });
  it('takes a chosen Scan ID as printed, without its label', () => {
    expect(chosenValue('scan_id', 'Scan ID: AB 1234/5', 'AU')).toBe('AB 1234/5');
    expect(chosenValue('scan_id', 'Exam No. CT_2024_0012', 'AU')).toBe('CT_2024_0012');
    expect(chosenValue('scan_id', 'LATCEPH', 'AU')).toBe('LATCEPH');
    expect(chosenValue('scan_id', ' : ', 'AU')).toBeNull();
  });
});

describe('owner 5 Oct: Film date with its first digit(s) cut off by the film edge (brief film-date/brief.md)', () => {
  it('a whole date reads normally for both fields', () => {
    expect(chosenValue('film_date', '2024-Jan-12', 'AU')).toBe('2024-01-12');    // SYNTHETIC
    expect(chosenValue('dob', '2024-Jan-12', 'AU')).toBe('2024-01-12');          // SYNTHETIC
  });
  it('a 3-digit year with its first digit cut is completed for Film date too, not just DOB', () => {
    expect(chosenValue('film_date', '024-Jan-12', 'AU')).toBe('2024-01-12');     // SYNTHETIC: the bug — was null
    expect(chosenValue('dob', '024-Jan-12', 'AU')).toBe('2024-01-12');           // SYNTHETIC: unchanged (completedDob)
  });
  it('a leading scrap separated by a space is ignored before completing', () => {
    expect(chosenValue('film_date', ') 024-Jan-12', 'AU')).toBe('2024-01-12');   // SYNTHETIC: the bug — was null
    expect(chosenValue('dob', ') 024-Jan-12', 'AU')).toBe('2024-01-12');         // SYNTHETIC: the bug — was null
  });
  it('a scrap glued directly onto the first number means the year was cut: unread, not misread as a day', () => {
    expect(chosenValue('film_date', ')24-Jan-12', 'AU')).toBeNull();   // SYNTHETIC: was wrongly 2012-01-24
    expect(chosenValue('dob', ')24-Jan-12', 'AU')).toBeNull();         // SYNTHETIC: was wrongly 2012-01-24
  });
  it('a plain two-digit-year DD-Mon-YY with no leading scrap still reads as a genuine date', () => {
    expect(chosenValue('film_date', '24-Jan-12', 'AU')).toBe('2012-01-24');   // SYNTHETIC: must stay
    expect(chosenValue('dob', '24-Jan-12', 'AU')).toBe('2012-01-24');        // SYNTHETIC: must stay
  });
  it('a letter label glued to the date (not punctuation) is not a "scrap" and keeps working', () => {
    expect(chosenValue('film_date', 'DOB:24-Jan-12', 'AU')).toBe('2012-01-24');   // SYNTHETIC
    expect(chosenValue('film_date', 'Se: Feb 07, 2024', 'AU')).toBe('2024-02-07');
  });
  // M2 (owner 5 Oct): this used to build a year string from the real clock (a time-bomb — see the fake-clock version below).
  it('both completions out of range (neither 1900s nor 2000s) are refused — zero valid completions', () => {
    // "500": 1500 is before 1900, 2500 is after today — neither completion is valid.
    expect(chosenValue('dob', '500-Jan-01', 'AU')).toBeNull();
    expect(chosenValue('film_date', '500-Jan-01', 'AU')).toBeNull();
  });
  it('empty and whitespace stay null for both fields', () => {
    expect(chosenValue('film_date', '', 'AU')).toBeNull();
    expect(chosenValue('film_date', '   ', 'AU')).toBeNull();
    expect(chosenValue('dob', '', 'AU')).toBeNull();
    expect(chosenValue('dob', '   ', 'AU')).toBeNull();
  });
});

describe('owner 5 Oct, I1: the "glued scrap" rule must refuse ONLY a cut-year shape, not any real date', () => {
  it('a 4-digit year survives a scrap glued to the first digit — not a cut-year shape', () => {
    expect(chosenValue('dob', '(07/03/1990)', 'AU')).toBe('1990-03-07');   // SYNTHETIC
    expect(chosenValue('film_date', '(07/03/1990)', 'AU')).toBe('1990-03-07');   // SYNTHETIC
    expect(chosenValue('dob', '(2024-01-12)', 'AU')).toBe('2024-01-12');   // SYNTHETIC
    expect(chosenValue('film_date', '(2024-01-12)', 'AU')).toBe('2024-01-12');
  });
  it('a leading 1-2 digit day that cannot be a cut-year tail survives, with a 4-digit year', () => {
    expect(chosenValue('film_date', '*12/03/2024', 'AU')).toBe('2024-03-12');   // SYNTHETIC
    expect(chosenValue('dob', ')24/01/2012', 'AU')).toBe('2012-01-24');   // SYNTHETIC
  });
  it('the cut-year shape — a scrap glued to a 1-2 digit lead with a 2-digit year — still refuses', () => {
    expect(chosenValue('film_date', ')24-Jan-12', 'AU')).toBeNull();   // SYNTHETIC: unchanged from existing suite
    expect(chosenValue('dob', ')24-Jan-12', 'AU')).toBeNull();
  });
});

describe('owner 5 Oct, I2: dateRefusal exposes WHY a date choice came back null', () => {
  it('names the cut-year shape, so a caller knows a re-read must not be trusted', () => {
    expect(dateRefusal('film_date', ')24-Jan-12', 'AU')).toBe('cut-year');   // SYNTHETIC
    expect(dateRefusal('dob', ')24-Jan-12', 'AU')).toBe('cut-year');
  });
  it('names anything else null as not-a-date, where a re-read is still worth trying', () => {
    expect(dateRefusal('dob', 'no date here', 'AU')).toBe('not-a-date');
    expect(dateRefusal('film_date', 'garbled OCR text', 'AU')).toBe('not-a-date');
  });
  it('returns null once the words DO read as a date', () => {
    expect(dateRefusal('dob', '24-Jan-12', 'AU')).toBeNull();   // SYNTHETIC: a genuine date, no scrap
    expect(dateRefusal('film_date', '2024-01-12', 'AU')).toBeNull();
  });
  it('is null for fields other than dob/film_date', () => {
    expect(dateRefusal('scan_id', ')24-Jan-12', 'AU')).toBeNull();
  });
});

describe('owner 5 Oct, M1: "today" must be the LOCAL date, not UTC', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Etc/GMT-14');   // local is 14h ahead of UTC: a local morning where UTC is still yesterday
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00Z'));   // UTC date 2024-06-01; local date 2024-06-02
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  it('a completed year landing on LOCAL today is accepted, even though it is after UTC today', () => {
    expect(chosenValue('dob', '024-Jun-02', 'AU')).toBe('2024-06-02');          // SYNTHETIC
    expect(chosenValue('film_date', '024-Jun-02', 'AU')).toBe('2024-06-02');   // SYNTHETIC
  });
});

describe('owner 5 Oct, M2: the "after today" refusal, made date-independent with a fake clock', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2024-06-01T00:00:00')); });
  afterEach(() => vi.useRealTimers());
  it('a completion landing after today is refused, even though it is a calendar-valid date', () => {
    // At the fixed clock, "024" completes only to 2024, and 2024-12-31 is after 2024-06-01 (today) — refused; the
    // 1-prefixed completion (1024) is always before 1900, so neither candidate survives.
    expect(chosenValue('dob', '024-Dec-31', 'AU')).toBeNull();   // SYNTHETIC
    expect(chosenValue('film_date', '024-Dec-31', 'AU')).toBeNull();   // SYNTHETIC
  });
});

describe('owner 6 Oct, fix round 3: the date reader picks the EARLIEST date on the line, not the first pattern match', () => {
  // Verified bug at d1516d2: dateTokenIn tried its five patterns in a fixed PATTERN order and returned
  // on the first one that matched anywhere on the line, not the one that starts earliest. A later, unrelated date
  // shape (a time written with dots or dashes, or a second genuine date) could out-rank the real — and cut — date.
  const blank = [
    ')24-Jan-12 10.02.24',         // SYNTHETIC: old code matched "10.02.24" via the d/m/y pattern → wrongly 2024-02-10
    ')24-Jan-12 Se: 07/02/24',     // SYNTHETIC: old code matched "07/02/24" → wrongly 2024-02-07
    ')24-Jan-12 12-03-45',         // SYNTHETIC: old code matched "12-03-45" via the d-m-y pattern → wrongly 1945-03-12
    ')24-Jan-12',
    ')24-Jan-12 1430',
    ')24-Jan-12 PID 5566',
    '):24-Jan-12',
    '))24-Jan-12',
    'Date: )24-Jan-12',
    '(24-Jan-12)',                 // SYNTHETIC: a scrap glued on both sides is still a cut-year shape
  ];
  it('every cut-year line stays blank for both DOB and Film date, however the scrap sits', () => {
    for (const line of blank) {
      expect(chosenValue('dob', line, 'AU'), line).toBeNull();
      expect(chosenValue('film_date', line, 'AU'), line).toBeNull();
    }
  });

  const read: [string, string][] = [
    ['12-Jan-2024 10.02.24', '2024-01-12'],          // SYNTHETIC: earliest reading wins over the later dotted time
    ['12 Jan 2024 Acc 12-03-45', '2024-01-12'],      // SYNTHETIC: earliest reading wins over the later dashed time
    ['Se: Feb 07, 2024 01:36 PM', '2024-02-07'],     // unchanged
    ['(07/03/1990)', '1990-03-07'],                  // SYNTHETIC: unchanged
    ['(2024-01-12)', '2024-01-12'],                  // unchanged
    ['*12/03/2024', '2024-03-12'],                   // unchanged
    [')24/01/2012', '2012-01-24'],                   // SYNTHETIC: unchanged
    ['_24/01/2012', '2012-01-24'],                   // SYNTHETIC: underscore is a scrap, but the year is 4 digits
    ['_2024-01-12', '2024-01-12'],                   // underscore is a scrap, but the year is 4 digits
    ['024-Jan-12', '2024-01-12'],                    // 3-digit-year completion, unchanged
    [') 024-Jan-12', '2024-01-12'],                  // leading scrap separated by a space, unchanged
    ['24-Jan-12', '2012-01-24'],                     // SYNTHETIC: a genuine 2-digit-year date, no scrap, unchanged
    ['DOB:24-Jan-12', '2012-01-24'],                  // SYNTHETIC: label colon, not a cut, unchanged
    ['987-Jan-02', '1987-01-02'],                    // 3-digit-year completion, unchanged
    ['DOB 07/03/1990 SYNTHETIC', '1990-03-07'],       // SYNTHETIC
  ];
  it('every reading row still reads, for both DOB and Film date', () => {
    for (const [line, want] of read) {
      expect(chosenValue('dob', line, 'AU'), line).toBe(want);
      expect(chosenValue('film_date', line, 'AU'), line).toBe(want);
    }
  });

  it('US day/month order still reads correctly (every existing US test unchanged)', () => {
    expect(chosenValue('film_date', 'Se: 02/07/2024 10:15', 'US')).toBe('2024-02-07');
    expect(chosenValue('dob', 'Se: 02/07/2024 10:15', 'US')).toBe('2024-02-07');   // SYNTHETIC
  });

  // Owner's rule, item 2: a 2-digit "year" directly glued to ':' is really an hour — it must be discarded outright,
  // not merely out-ranked. Here discarding it leaves NO other date reading on the line at all, so the line goes
  // blank; it must never again read as 2012-01-24 (the old bug, matching "Jan 24 12" as D-Mon-YY against the hour).
  it('"Wed Jan 24 12:30:00 2024" never reads as 2012-01-24 (the old bug); either it reads 2024-01-24, or it is blank', () => {
    const line = 'Wed Jan 24 12:30:00 2024';
    for (const field of ['dob', 'film_date'] as const) {
      const got = chosenValue(field, line, 'AU');
      expect(got, line).not.toBe('2012-01-24');
      expect([null, '2024-01-24']).toContain(got);
    }
  });
});

describe('owner 6 Oct, item D: judge the DATE TOKEN, not the start of the text (cutYearShape was defeated)', () => {
  it('extra scraps after the date — a time or a labelled ID with a 4-digit run — must not rescue a cut year', () => {
    // Verified bug at 918663c: a 4-digit run ANYWHERE in the remainder (here "1430", or "5566" in "PID
    // 5566") made the old cutYearShape think the year was not cut, so these wrongly read as 2012-01-24.
    expect(chosenValue('film_date', ')24-Jan-12 1430', 'AU')).toBeNull();        // SYNTHETIC
    expect(chosenValue('dob', ')24-Jan-12 1430', 'AU')).toBeNull();              // SYNTHETIC
    expect(chosenValue('film_date', ')24-Jan-12 PID 5566', 'AU')).toBeNull();    // SYNTHETIC
    expect(chosenValue('dob', ')24-Jan-12 PID 5566', 'AU')).toBeNull();          // SYNTHETIC
  });
  it('a scrap of more than one punctuation character directly before the date still refuses', () => {
    expect(chosenValue('film_date', '):24-Jan-12', 'AU')).toBeNull();   // SYNTHETIC
    expect(chosenValue('dob', '):24-Jan-12', 'AU')).toBeNull();
    expect(chosenValue('film_date', '))24-Jan-12', 'AU')).toBeNull();   // SYNTHETIC
    expect(chosenValue('dob', '))24-Jan-12', 'AU')).toBeNull();
  });
  it('a label before the scrap ("Date: )24-Jan-12") does not turn the scrap into a label separator', () => {
    expect(chosenValue('film_date', 'Date: )24-Jan-12', 'AU')).toBeNull();   // SYNTHETIC
    expect(chosenValue('dob', 'Date: )24-Jan-12', 'AU')).toBeNull();
  });
  it('a scrap glued to a 4-digit-year date at the START of the text still reads normally (unchanged)', () => {
    expect(chosenValue('film_date', '*12/03/2024', 'AU')).toBe('2024-03-12');   // SYNTHETIC
    expect(chosenValue('dob', ')24/01/2012', 'AU')).toBe('2012-01-24');         // SYNTHETIC
  });
  it('dateRefusal names the same extra-scrap cases as cut-year', () => {
    expect(dateRefusal('film_date', ')24-Jan-12 1430', 'AU')).toBe('cut-year');       // SYNTHETIC
    expect(dateRefusal('film_date', ')24-Jan-12 PID 5566', 'AU')).toBe('cut-year');   // SYNTHETIC
    expect(dateRefusal('dob', '):24-Jan-12', 'AU')).toBe('cut-year');
    expect(dateRefusal('dob', '))24-Jan-12', 'AU')).toBe('cut-year');
    expect(dateRefusal('dob', 'Date: )24-Jan-12', 'AU')).toBe('cut-year');
  });
});

describe('owner 6 Oct, fix round 4: patches P1/P2/P4/P5 (fix4-brief.md), DOB and Film date alike', () => {
  const rows: [string, 'AU' | 'US', string | null][] = [
    // P1: an impossible first reading blanks the line — no fall-through to the later real date.
    ['DOB 01/13/2010 Date 07/02/2024', 'AU', null],         // SYNTHETIC: month 13 (AU) is impossible
    ['DOB: 13/01/2010 Scan: 02/07/2024', 'US', null],       // SYNTHETIC: month 13 (US) is impossible
    ['DOB 31/04/1990 Exam 12/01/2024', 'AU', null],         // SYNTHETIC: April has no 31st
    // P4: a month name must be a whole word, not the start of a longer word.
    ['Marcus 12 34', 'AU', null],
    ['DEMO, Janine 12 05', 'AU', null],                     // SYNTHETIC
    ['Decubitus 12 34', 'AU', null],
    ['Room 1 Marsden 12', 'AU', null],
    // P2: a reading directly after a not-a-date label is skipped; the next reading wins.
    ['ID 99-99-99 12/01/2024', 'AU', '2024-01-12'],
    ['PID 12-03-45 2024-01-12', 'AU', '2024-01-12'],        // SYNTHETIC
    ['Acc 1-2-34 2024-01-12', 'AU', '2024-01-12'],          // SYNTHETIC
    ['Ver 3.10.24 Se: 12/01/2024', 'AU', '2024-01-12'],
    ['Exp 1.2.24 0.8 s 12/01/2024', 'AU', '2024-01-12'],
    ['PID 12-03-45 02/07/2024', 'US', '2024-02-07'],        // SYNTHETIC
    // P3 (the dot-time reading is simply gone; no label involved for this one).
    ['10.02.24 PM 2024-01-12', 'AU', '2024-01-12'],
    // P5: a printed 4-digit year outside 1900..(this year + 1) is not a date — skip it.
    ['1430 Feb 07, 2024', 'AU', '2024-02-07'],
    // A plain labelled number is not a date shape at all; the month-name date after it still reads.
    ['PID 5566 Dec 3 2024', 'AU', '2024-12-03'],
  ];
  it('reads or blanks per the owner\'s rule, for both DOB and Film date', () => {
    for (const [line, f, want] of rows) {
      expect(chosenValue('dob', line, f), line).toBe(want);
      expect(chosenValue('film_date', line, f), line).toBe(want);
    }
  });

  it('P3: never a 2012 date — AM/PM and a 2-digit "year" glued to : ; or . are times, not dates', () => {
    for (const line of ['Wed Jan 24 12.30.00 2024', 'Wed Jan 24 12;30;00 2024', 'Mon, 24 Jan 12.30 2024',
      '24 Jan 12.30 2024', 'Jan 24 12.30 PM 2024']) {
      for (const field of ['dob', 'film_date'] as const) {
        const got = chosenValue(field, line, 'AU');
        expect(got, line).not.toBe('2012-01-24');
        expect([null, '2024-01-24'], line).toContain(got);
      }
    }
  });

  it('known and accepted (fix4-brief.md): a dotted time with no AM/PM reads as the first date-looking thing on the ' +
    'line — this is the owner\'s rule, not a bug, and must not be "fixed"', () => {
    expect(chosenValue('dob', '10.02.24 2024-01-12', 'AU')).toBe('2024-02-10');          // SYNTHETIC
    expect(chosenValue('film_date', '10.02.24 2024-01-12', 'AU')).toBe('2024-02-10');
  });
});

// LABEL-1 (owner 13 Oct, rulings LB-1 and LB-2): the import-time label reader and the screen must always
// agree. `test-fixtures/label-date-cases.json` (repo root) is read by BOTH this suite and the Rust label reader —
// one file of {text, order, want}, copied from the describe blocks above, checked here against `chosenValue` and
// on the Rust side through the PRODUCTION paths (`layout::field_value`, and `parse_label` with a DOB label; see
// crates/ceph-label/src/parse.rs's `shared_cases_agree_with_the_ui_through_every_production_path`) as well as
// `date_field_value` (the Rust twin of `dateFieldValue`). See `test-fixtures/NOT-SHARED.md` for what is left out.
describe('shared cut-year/date cases (LB-1): the UI and the label reader must read every one of these the same', () => {
  const cases = sharedDateCases.cases as { text: string; order: 'AU' | 'US'; want: string | null }[];

  it('the shared file itself is non-trivial (a positive control: it can produce both a date and a null)', () => {
    expect(cases.length).toBeGreaterThan(40);
    expect(cases.some((c) => c.want !== null)).toBe(true);
    expect(cases.some((c) => c.want === null)).toBe(true);
  });

  it('chosenValue(\'film_date\'|\'dob\', text, order) matches every case\'s `want`', () => {
    for (const { text, order, want } of cases) {
      expect(chosenValue('film_date', text, order), text).toBe(want);
      expect(chosenValue('dob', text, order), text).toBe(want);
    }
  });
});

describe('the new Choose fields (spec 2026-10-17)', () => {
  it('reads Patient ID like a Scan ID and the film details as printed', () => {
    expect(chosenValue('patient_id', 'Patient ID: ZQ-7781', 'AU')).toBe('ZQ-7781');
    expect(chosenValue('xray_size', '24  x 30 cm,', 'AU')).toBe('24 x 30 cm');
    expect(chosenValue('practice', '—', 'AU')).toBeNull();
    expect(chosenValue('xray_type', 'x'.repeat(201), 'AU')).toBeNull();
  });
  // D7 (preflight rulings): the 200-character limit is for the new details ONLY, Patient ID included — it must
  // never apply to Scan ID, which this app has always left uncapped.
  it('caps Patient ID at 200 characters but leaves Scan ID uncapped (D7)', () => {
    expect(chosenValue('patient_id', 'x'.repeat(200), 'AU')).toBe('x'.repeat(200));
    expect(chosenValue('patient_id', 'x'.repeat(201), 'AU')).toBeNull();
    expect(chosenValue('scan_id', 'x'.repeat(201), 'AU')).toBe('x'.repeat(201));
  });
  // D2 (preflight rulings): a table of known ids → true/false, not `DETAIL_FIELDS.filter(isDetailField)` — that
  // filter is a guard that cannot fail (every element of DETAIL_FIELDS passes isDetailField by construction, so the
  // assertion would hold even if isDetailField were wrong for everything NOT in the list). Fix round 1 (review
  // M2): `isDetailField` is now plainly `DETAIL_FIELDS.includes(f)` — this test is the real guard against a field
  // being wrongly left off (or wrongly added to) that one list; 'constructor' checks a JS-object-prototype id reads
  // false rather than throwing or reading as truthy via prototype lookup.
  it('knows which fields save on their own, and which do not', () => {
    const want: Record<string, boolean> = {
      patient_id: true, xray_type: true, xray_size: true, practice: true,
      scan_id: false, last: false, first: false, full: false, dob: false, film_date: false, constructor: false,
    };
    for (const [id, expected] of Object.entries(want)) expect(isDetailField(id), id).toBe(expected);
    expect(DETAIL_FIELDS).toEqual(['patient_id', 'xray_type', 'xray_size', 'practice']);
  });
  // M1: a Last/First reading that has lost all its casing ("smith") is capitalised on its first letter only; a name
  // that already carries its own mixed casing ("van der Berg", "McDonald") is left exactly as printed — this never
  // re-cases a name the OCR already cased, only one that reads as a single run of lowercase letters.
  it('capitalises an all-lowercase Last/First reading but leaves mixed case alone (M1)', () => {
    expect(chosenValue('last', 'smith', 'AU')).toBe('Smith');
    expect(chosenValue('first', 'smith', 'AU')).toBe('Smith');
    expect(chosenValue('last', 'van der Berg', 'AU')).toBe('van der Berg');
    expect(chosenValue('last', 'McDonald', 'AU')).toBe('McDonald');
  });
  // M4: a 2-UTF-16-unit astral letter (U+1D538) is one Unicode code point — the 200 limit must count code points,
  // not UTF-16 units, or 100 of these would be wrongly refused as 200. Sibling of filmTable.test.ts's drop-down
  // check: both paths share DETAIL_MAX and `[...v].length`, but each is pinned separately so a regression in
  // either path's own code is caught where it happens. `xray_type` (not `patient_id`): Patient ID's "holds a
  // letter or number" check is ASCII-only (`[A-Za-z0-9]`, unchanged pre-existing behaviour, out of this fix
  // round's scope) and would refuse this astral letter regardless of length; `asPrinted`'s check is the
  // Unicode-aware one (`\p{L}\p{N}`) that the brief's astral-letter case is actually about.
  it('counts an astral letter as one code point for the 200 limit (M4)', () => {
    const astral = '\u{1D538}';
    expect(chosenValue('xray_type', astral.repeat(200), 'AU')).toBe(astral.repeat(200));
    expect(chosenValue('xray_type', astral.repeat(201), 'AU')).toBeNull();
  });
  // M3 (live bug, fix round 1): Choose on the film already measured the CLEANED value (label stripped); this pins
  // it directly against `cleanedForLimit` so the drop-down's own test (filmTable.test.ts) can be compared 1:1.
  it('measures the 200 limit on the Patient ID after its label is stripped (M3)', () => {
    const id198 = 'x'.repeat(198);
    expect(chosenValue('patient_id', `PID ${id198}`, 'AU')).toBe(id198);
    const id201 = 'x'.repeat(201);
    expect(chosenValue('patient_id', `PID ${id201}`, 'AU')).toBeNull();
  });
  it('lists all ten Choose buttons, in order', () => {
    expect(ALL_CHOOSE_FIELDS.map((f) => CHOOSE_LABELS[f])).toEqual(['Last name', 'First name(s)', 'Full name', 'DOB', 'Film date', 'Scan ID',
      'Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice']);
  });
  // D3 (preflight rulings): this guard already passes before Task 5's change — the four new ChooseFields are never
  // added to unsureFields, so a blank new detail never forces Choose mode open. See the report for the induced
  // failure proving the guard can fail (break unsureFields to push 'patient_id' when blank, watch this fail, restore).
  it('never opens Choose mode for a blank new detail', () => {
    const doc = docOf(EDIT, { patientName: 'Demo Synthetic', dateOfBirth: '1990-03-07', scanId: '1', takenOnSource: 'label' });   // SYNTHETIC
    expect(unsureFields(doc)).toEqual([]);
  });
});

// D11 (preflight rulings): the learnable detail fields and their length limit are pinned, on the Rust side and here,
// to the ONE shared fixture `crates/ceph-label/tests/detail_fields.json` — imported by a relative module specifier,
// which Vite/Node always resolves against THIS FILE's own path, never against process.cwd().
describe('D11: choose.ts pins DETAIL_FIELDS/DETAIL_MAX to the Rust-shared fixture', () => {
  const fixture = detailFields as { fields: string[]; maxChars: number; counts: string };

  it('the fixture itself is non-trivial (a positive control: a real field list and a real limit)', () => {
    expect(fixture.fields.length).toBeGreaterThan(0);
    expect(fixture.maxChars).toBeGreaterThan(0);
    expect(fixture.counts).toBe('code points');
  });
  it('DETAIL_FIELDS equals the fixture\'s field list', () => {
    expect(DETAIL_FIELDS).toEqual(fixture.fields);
  });
  it('DETAIL_MAX equals the fixture\'s limit', () => {
    expect(DETAIL_MAX).toBe(fixture.maxChars);
  });
  it('the limit is counted in Unicode code points, not UTF-16 units: a 200 vs 201 code-point astral string', () => {
    // 𝔸 (U+1D538, MATHEMATICAL DOUBLE-STRUCK CAPITAL A) is one code point but two UTF-16 units, and IS a letter
    // (unlike an emoji), so it clears the "has a letter or number" check and isolates the length check on its own.
    const at200 = '𝔸'.repeat(200);
    const at201 = '𝔸'.repeat(201);
    expect([...at200].length).toBe(200);
    expect(at200.length).toBe(400);               // UTF-16 units — NOT what DETAIL_MAX measures
    expect([...at200].length <= DETAIL_MAX).toBe(true);
    expect([...at201].length <= DETAIL_MAX).toBe(false);
    expect(chosenValue('xray_type', at200, 'AU')).toBe(at200);
    expect(chosenValue('xray_type', at201, 'AU')).toBeNull();
  });
});
