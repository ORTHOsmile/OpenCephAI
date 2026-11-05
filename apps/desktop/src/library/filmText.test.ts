import { describe, expect, it } from 'vitest';
import { usesOf, genderIn, referrerIn } from './filmText';
import genderReferrerLines from '../../../../crates/ceph-label/tests/gender_referrer_lines.json';

// Synthetic label lines only (no patient data).
describe('usesOf: what a line of text on the film can fill', () => {
  it('a SURNAME, Given line fills Patient, in title case', () => {
    expect(usesOf('DEMO, Synthetic', 'AU')).toEqual({ name: 'Demo, Synthetic', date: null, id: null });
  });
  it('a labelled name drops its label', () => {
    expect(usesOf('Patient Name: DEMO SYNTHETIC', 'AU').name).toBe('Demo Synthetic');
  });
  it('mixed-case names are kept as printed, including Mc and apostrophes in capitals', () => {
    expect(usesOf("McDEMO-O'SYNTH, Jo", 'AU').name).toBe("McDemo-O'Synth, Jo");
    expect(usesOf('van Demo, Anna', 'AU').name).toBe('van Demo, Anna');
  });
  it('a line with a date fills a date, day first or month first by the preference', () => {
    expect(usesOf('DOB 07/03/1990', 'AU')).toEqual({ name: null, date: '1990-03-07', id: null });   // SYNTHETIC
    expect(usesOf('DOB 07/03/1990', 'US').date).toBe('1990-07-03');   // SYNTHETIC
  });
  it('the viewer overlay date "Se: Feb 07, 2024 01:36 PM" is 7 Feb 2024 whatever the preference', () => {
    expect(usesOf('Se: Feb 07, 2024 01:36 PM', 'US').date).toBe('2024-02-07');
    expect(usesOf('Se: Feb 07, 2024 01:36 PM', 'AU').date).toBe('2024-02-07');
    expect(usesOf('7 Feb 2024', 'US').date).toBe('2024-02-07');
    expect(usesOf('Taken 2024-02-07', 'US').date).toBe('2024-02-07');
  });
  it('an impossible date is not offered', () => {
    expect(usesOf('31/02/2024', 'AU').date).toBeNull();
  });
  it('a labelled ID fills Scan ID; an accession number too', () => {
    expect(usesOf('PID 12345', 'AU')).toEqual({ name: null, date: null, id: '12345' });
    expect(usesOf('Patient ID: AB-1234.5', 'AU').id).toBe('AB-1234.5');
    expect(usesOf('Acc #98765', 'AU').id).toBe('98765');
    expect(usesOf('MRN 0042', 'AU').id).toBe('0042');
  });
  it('a line that is only a number with no label is offered as Scan ID', () => {
    expect(usesOf('  12345 ', 'AU').id).toBe('12345');
  });
  it('lines with digits are never offered as the patient name', () => {
    expect(usesOf('M, Y26', 'AU').name).toBeNull();
    expect(usesOf('Im: 1/1', 'AU')).toEqual({ name: null, date: null, id: null });
  });
  it('single letters and blank lines fill nothing', () => {
    expect(usesOf('M, F', 'AU')).toEqual({ name: null, date: null, id: null });
    expect(usesOf('   ', 'AU')).toEqual({ name: null, date: null, id: null });
  });
});

describe('two-digit years (owner, 30 Sep: a back-to-front DOB with a two-digit year could not be chosen)', () => {
  it('are 20yy unless that is after this year, then 19yy, like the label reader', () => {
    expect(usesOf('DOB 07/03/90 SYNTHETIC', 'AU').date).toBe('1990-03-07');   // SYNTHETIC
    expect(usesOf('07/03/16', 'AU').date).toBe('2016-03-07');
    expect(usesOf('07/03/16', 'US').date).toBe('2016-07-03');
    expect(usesOf('7 Feb 24', 'AU').date).toBe('2024-02-07');
  });
});

describe('owner 2 Oct: year–month–day with the month in letters', () => {
  it('reads 1987-Jan-02 on a label line', () => {
    expect(usesOf('DOB: 1987-Jan-02', 'AU').date).toBe('1987-01-02');   // SYNTHETIC
    expect(usesOf('DOB 1987 JAN 2', 'US').date).toBe('1987-01-02');     // SYNTHETIC
  });
});

describe('owner 6 Oct, fix round 3: usesOf/dateIn share the SAME cut-year rule as chosenValue (one implementation)', () => {
  it('a cut-year shape fills no date at all, not just no chosen field value', () => {
    expect(usesOf(')24-Jan-12', 'AU').date).toBeNull();
    expect(usesOf(')24-Jan-12 10.02.24', 'AU').date).toBeNull();   // SYNTHETIC: earliest reading is the cut one
  });
  it('a 4-digit year still fills a date even with a scrap glued on', () => {
    expect(usesOf('(2024-01-12)', 'AU').date).toBe('2024-01-12');
  });
});

describe('owner 6 Oct, fix round 4: impossible dates, labels, times, whole-word months, year range (fix4-brief.md)', () => {
  it('P1: an impossible first reading blanks the line, no fall-through to a later real date', () => {
    expect(usesOf('DOB 01/13/2010 Date 07/02/2024', 'AU').date).toBeNull();     // SYNTHETIC: month 13 (AU) impossible
    expect(usesOf('DOB: 13/01/2010 Scan: 02/07/2024', 'US').date).toBeNull();   // SYNTHETIC: month 13 (US) impossible
    expect(usesOf('DOB 31/04/1990 Exam 12/01/2024', 'AU').date).toBeNull();     // SYNTHETIC: April has no 31st
  });
  it('P4: a month name must be a whole word, not the start of a longer word', () => {
    expect(usesOf('Marcus 12 34', 'AU').date).toBeNull();
    expect(usesOf('DEMO, Janine 12 05', 'AU').date).toBeNull();
    expect(usesOf('Decubitus 12 34', 'AU').date).toBeNull();
    expect(usesOf('Room 1 Marsden 12', 'AU').date).toBeNull();
  });
  it('P2: a reading directly after a not-a-date label is skipped; the next reading wins', () => {
    expect(usesOf('ID 99-99-99 12/01/2024', 'AU').date).toBe('2024-01-12');
    expect(usesOf('PID 12-03-45 2024-01-12', 'AU').date).toBe('2024-01-12');    // SYNTHETIC
    expect(usesOf('Acc 1-2-34 2024-01-12', 'AU').date).toBe('2024-01-12');      // SYNTHETIC
    expect(usesOf('Ver 3.10.24 Se: 12/01/2024', 'AU').date).toBe('2024-01-12');
    expect(usesOf('Exp 1.2.24 0.8 s 12/01/2024', 'AU').date).toBe('2024-01-12');
    expect(usesOf('PID 12-03-45 02/07/2024', 'US').date).toBe('2024-02-07');    // SYNTHETIC
  });
  it('P3: times are not dates — AM/PM (any case/spacing) and a 2-digit "year" glued to : ; or . are discarded', () => {
    expect(usesOf('10.02.24 PM 2024-01-12', 'AU').date).toBe('2024-01-12');
    for (const line of ['Wed Jan 24 12.30.00 2024', 'Wed Jan 24 12;30;00 2024', 'Mon, 24 Jan 12.30 2024',
      '24 Jan 12.30 2024', 'Jan 24 12.30 PM 2024'])
      expect(usesOf(line, 'AU').date, line).not.toBe('2012-01-24');   // never the old bug; this line: blank
  });
  it('P5: a printed 4-digit year outside 1900..(this year + 1) is not a date — skip it, the next reading wins', () => {
    expect(usesOf('1430 Feb 07, 2024', 'AU').date).toBe('2024-02-07');
  });
  it('a plain number after a label ("PID 5566") is not a date shape at all; the month-name date after it still reads', () => {
    expect(usesOf('PID 5566 Dec 3 2024', 'AU').date).toBe('2024-12-03');
  });
  it('known and accepted by the owner\'s rule (fix4-brief.md): a dotted time with no AM/PM is the first date-looking ' +
    'thing on the line and wins by position over a later real date — this is NOT a bug and is not to be "fixed"', () => {
    expect(usesOf('10.02.24 2024-01-12', 'AU').date).toBe('2024-02-10');
  });
});

describe('genderIn: F or M on the film', () => {
  it('reads F or M standing as its own word at the start, with or without a label', () => {
    expect(genderIn('M, Y34')).toBe('M');
    expect(genderIn('Sex: F')).toBe('F');
    expect(genderIn('gender: male')).toBe('M');
    expect(genderIn('Female')).toBe('F');
    expect(genderIn('SEX F')).toBe('F');
  });
  it('refuses anything else (blank beats wrong)', () => {
    for (const l of ['FM', 'Fe', 'Mr Demo', 'Demo Radiology Northside', 'Im: 1/1', '', '   ', 'M. Smith', 'F. Jones', 'M.D. Demo'])
      expect(genderIn(l), l).toBeNull();
  });
  it('reads a lone F or M in brackets, after a label, or "M." alone (owner E, 19 Oct)', () => {
    for (const [l, g] of [['(M)', 'M'], ['[F]', 'F'], ['(Male)', 'M'], ['Sex: (F)', 'F'], ['M.', 'M'], ['gender: [male]', 'M']] as const)
      expect(genderIn(l), l).toBe(g);
  });
  it('refuses two genders on one line, and anything else in brackets (R4: "M F" read M before)', () => {
    for (const l of ['MF', 'M F', '(X)', 'F (M)', 'M/F', 'male female', '(M'])
      expect(genderIn(l), l).toBeNull();
  });
});
describe('referrerIn: who referred the patient', () => {
  it('drops a leading label and keeps "Dr"', () => {
    expect(referrerIn('Ref: Dr Demo')).toBe('Dr Demo');
    expect(referrerIn('Ref. by Dr Demo')).toBe('Dr Demo');
    expect(referrerIn('Referred by: Dr Demo')).toBe('Dr Demo');
    expect(referrerIn('Referring Dr: Dr Demo')).toBe('Dr Demo');
    expect(referrerIn('Referring practitioner: Demo Clinic')).toBe('Demo Clinic');
    expect(referrerIn('Dr Demo')).toBe('Dr Demo');
  });
  it('keeps words that only start like a label', () => {
    expect(referrerIn('Referral Demo Clinic')).toBe('Referral Demo Clinic');
  });
  it('refuses a line with no name left', () => {
    for (const l of ['Ref:', 'Ref: 1234', '', '  '])
      expect(referrerIn(l), l).toBeNull();
  });
});
it('reads Gender and Referring practitioner exactly as the shared fixture says (Q6)', () => {
  for (const [line, want] of genderReferrerLines.gender as [string, string | null][]) expect(genderIn(line), line).toBe(want);
  for (const [line, want] of genderReferrerLines.referrer as [string, string | null][]) expect(referrerIn(line), line).toBe(want);
});
