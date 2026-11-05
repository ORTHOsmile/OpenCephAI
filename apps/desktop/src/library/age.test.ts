import { describe, it, expect } from 'vitest';
import { ageIn, ageShown, ageText, NOT_AN_AGE } from './age';

// Owner AG1 (19 Oct). SYNTHETIC ages and dates only.
const yearsOf = (s: string, typed = false) => ageIn(s, typed)?.years ?? null;
describe('ageIn: an age printed on the film (owner AG1)', () => {
  it('reads the DICOM forms', () => {
    expect(ageIn('011Y')).toEqual({ text: '011Y', years: 11 });
    expect(yearsOf('132M')).toBe(11);
    expect(yearsOf('006W')).toBeCloseTo(42 / 365.2425, 12);
    expect(yearsOf('045D')).toBeCloseTo(45 / 365.2425, 12);
    expect(yearsOf('011y')).toBe(11);
  });
  it('reads the written forms, with or without an "Age" label', () => {
    for (const s of ['11Y', '11 y', '11 yrs', '11 years', 'Age: 11 y', 'AGE 011Y', '11 yrs,']) expect(yearsOf(s), s).toBe(11);
    for (const s of ['11y 3m', '11 yrs 3 mths', '11 years, 3 months', 'Age - 11y 3m']) expect(yearsOf(s), s).toBe(11.25);
    expect(ageIn('Age: 11 yrs 3 mths')!.text).toBe('11 yrs 3 mths');                 // stored as printed, label dropped
  });
  it('a bare number only when typed, or after an "Age" label (R10)', () => {
    expect(yearsOf('11')).toBeNull();
    expect(yearsOf('11', true)).toBe(11);
    expect(yearsOf('Age: 11')).toBe(11);
  });
  it('refuses what is not an age: zero, over 120 years, 12 months or more, two-digit months, other words', () => {
    for (const s of ['000Y', '121Y', '000D', '11y 12m', '11M', 'Age', 'Agent 007', 'M', '', 'eleven', '11 kg', '1990'])
      expect(ageIn(s, true), s).toBeNull();
    expect(yearsOf('120Y')).toBe(120);
    expect(NOT_AN_AGE).toBe("That isn't an age");
  });
});
describe('ageText: shown as "11 y" or "11 y 3 m" (R11: whole months, rounded down)', () => {
  it('whole years and months', () => {
    expect(ageText(11)).toBe('11 y');
    expect(ageText(11.25)).toBe('11 y 3 m');
    expect(ageText(11 + 1 / 12)).toBe('11 y 1 m');
    expect(ageText(45 / 365.2425)).toBe('0 y 1 m');
  });
});
describe('ageShown: the DOB wins; the film\'s age otherwise (owner AG1)', () => {
  const dob = '2014-01-02';   // SYNTHETIC
  it('with a DOB and a scan date: the calendar age at the scan, from the DOB', () => {
    expect(ageShown({ dateOfBirth: dob, takenOn: '2026-07-02', ageOnFilmYears: null })).toEqual({ text: 'Age 12 y 6 m at the scan (from the DOB)', note: null });   // SYNTHETIC
  });
  it('the note only when the film\'s age differs by MORE than a year (0.9 no, 1.0 no, 1.1 yes)', () => {
    const at = (film: number) => ageShown({ dateOfBirth: dob, takenOn: '2026-01-02', ageOnFilmYears: film })!.note;   // SYNTHETIC: DOB gives exactly 12
    expect(at(11.1)).toBeNull();
    expect(at(11)).toBeNull();
    expect(at(10.9)).toBe('The film says 10 y 10 m; DOB gives 12 y at the scan date.');
    expect(at(13.1)).toBe('The film says 13 y 1 m; DOB gives 12 y at the scan date.');
  });
  it('a DOB but no scan date: the film\'s age, and why it cannot be checked', () => {
    expect(ageShown({ dateOfBirth: dob, takenOn: null, ageOnFilmYears: 11 }))   // SYNTHETIC
      .toEqual({ text: 'Age 11 y (printed on the film)', note: 'The DOB cannot be checked against it without the scan date.' });
    expect(ageShown({ dateOfBirth: dob, takenOn: '2013-01-01', ageOnFilmYears: 11 })!.note).toBe('The scan date is before the DOB, so the DOB cannot give an age.');   // SYNTHETIC
    expect(ageShown({ dateOfBirth: dob, takenOn: null, ageOnFilmYears: null })).toBeNull();   // SYNTHETIC
  });
  it('no DOB: the film\'s (or typed) age, said as such (R2); nothing at all → nothing', () => {
    expect(ageShown({ dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: 11 })).toEqual({ text: 'Age 11 y (printed on the film or typed; no DOB)', note: null });
    expect(ageShown({ dateOfBirth: null, takenOn: null })).toBeNull();
  });
});
