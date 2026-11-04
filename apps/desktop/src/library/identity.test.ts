import { describe, it, expect } from 'vitest';
import { conflictText, filmDateNote, issueText, noteConfirms, sameAsCandidates, showsNote, shownName } from './identity';
import { openConflicts } from './identity';
import type { CaseDoc, IdentityIssue } from '../ipc';
import { docOf } from './fixtures';

// SYNTHETIC names only.
const demo = { name: 'Demo Synthetic', dateOfBirth: '1990-03-07' };
describe('Check patient details', () => {
  it('says why it asks, with dates in the operator’s format', () => {
    const t = (i: IdentityIssue, f: 'AU' | 'US' = 'AU') => issueText(i, f);
    expect(t({ kind: 'nameNotRead' })).toBe('No name could be read from the film label: type it in Patient, or use Text on the film.');
    expect(t({ kind: 'noDateOfBirth' })).toBe('No date of birth was found.');
    expect(t({ kind: 'impossibleDate', field: 'dateOfBirth' })).toBe('The date of birth is in the future or before 1900.');
    expect(t({ kind: 'impossibleDate', field: 'scanDate' })).toBe('The film date is in the future or before 1900.');
    expect(t({ kind: 'birthAfterScan' })).toBe('The date of birth is after the film date.');
    expect(t({ kind: 'sameNameOtherBirth', patient: { name: 'Demo Olden', dateOfBirth: null } })).toBe('Demo Olden is already in the library without a date of birth.');
    expect(t({ kind: 'sameNameOtherBirth', patient: demo })).toBe('Demo Synthetic (born 07/03/1990) is already in the library with another date of birth.');
    expect(t({ kind: 'similarNameSameBirth', patient: demo }, 'US')).toBe('Demo Synthetic (born 03/07/1990) has the same date of birth and a very similar name.');
  });
  it('offers each existing patient it could be, once', () => {
    const other = { name: 'Demo Synthetik', dateOfBirth: '1990-03-07' };
    expect(sameAsCandidates([{ kind: 'noDateOfBirth' }, { kind: 'sameNameOtherBirth', patient: demo }, { kind: 'similarNameSameBirth', patient: other },
      { kind: 'similarNameSameBirth', patient: other }])).toEqual([demo, other]);
    expect(sameAsCandidates([{ kind: 'nameNotRead' }])).toEqual([]);
  });
});

describe('film date note (owner, 29 Sep)', () => {
  it('says where an unconfirmed film date came from', () => {
    expect(filmDateNote('image')).toBe('From the image file');
    expect(filmDateNote('import')).toBe('Import date — please check');
    expect([filmDateNote('label'), filmDateNote('manual'), filmDateNote(null)]).toEqual([null, null, null]);
  });
});

describe('shownName: a blank name shows as a call to enter it (owner, 29 Sep)', () => {
  it('blank or spaces read "Name needed"; a name is shown as it is', () => {
    expect(shownName('')).toBe('Name needed');
    expect(shownName('   ')).toBe('Name needed');
    expect(shownName('Demo Synthetic')).toBe('Demo Synthetic');
  });
});

describe('conflictText: the label and the machine\'s learned default disagree (spec 2026-09-29 Part 3)', () => {
  it('names both values, with dates in the operator\'s format', () => {
    expect(conflictText({ field: 'name', label: 'Demo Synthetic', learned: 'Demo Other' }, 'AU'))
      .toBe('Name: the film’s label says Demo Synthetic; this machine usually has Demo Other there.');
    expect(conflictText({ field: 'dob', label: '1990-03-07', learned: '1991-03-07' }, 'AU'))   // SYNTHETIC
      .toBe('Date of birth: the film’s label says 07/03/1990; this machine usually has 07/03/1991 there.');   // SYNTHETIC
  });
  it('owner Q4 (17 Oct): a Patient ID disagreement names both values plainly, with no date formatting', () => {
    expect(conflictText({ field: 'patient_id', label: '5566', learned: '5567' }, 'AU'))
      .toBe('Patient ID: the film’s label says 5566; this machine usually has 5567 there.');
  });
});

describe('final review: which label/machine disagreements are still open', () => {
  const doc = { patientName: 'Demo Synthetic', dateOfBirth: null, takenOnSource: 'image', scanId: '5566', printedPatientId: '5566' } as const;
  const cs = [{ field: 'dob', label: '1990-03-07', learned: '1991-01-01' }, { field: 'scan_date', label: '2024-01-10', learned: '2024-02-10' },   // SYNTHETIC
    { field: 'scan_id', label: '5566', learned: '7788' }, { field: 'name', label: 'Demo Synthetic', learned: 'Demo Other' }];
  it('lists a blank detail, and a film date only read from the image file or the import day', () => {
    expect(openConflicts(doc, cs).map((c) => c.field)).toEqual(['dob', 'scan_date']);
    expect(openConflicts({ ...doc, takenOnSource: 'label' }, cs).map((c) => c.field)).toEqual(['dob']);
  });
  it('owner Q4 (17 Oct): a Patient ID conflict drops once this X-ray\'s own Patient ID is filled', () => {
    const pidConflict = [{ field: 'patient_id', label: '5566', learned: '5567' }];
    expect(openConflicts({ ...doc, printedPatientId: null }, pidConflict).map((c) => c.field)).toEqual(['patient_id']);
    expect(openConflicts({ ...doc, printedPatientId: '5566' }, pidConflict).map((c) => c.field)).toEqual([]);
  });
});

const doc = (o: Partial<CaseDoc>) => docOf({ id: 'c', facing: 'right', orientation: {} as never, display: {} as never, landmarks: [] }, o);
describe('the patient note (Q9)', () => {
  it('lists what OK confirms, in the box words, only what is filled', () => {
    const d = doc({ identitySource: 'film', identityChecked: true, patientName: 'Smith, John', dateOfBirth: '1990-03-07',   // SYNTHETIC
      takenOnSource: 'label', takenOn: '2024-02-07', scanId: null, gender: 'M', printedPatientId: '5566',
      learnedFields: ['gender', 'patient_id'] });
    expect(noteConfirms(d)).toEqual(['name', 'date of birth', 'Gender', 'Patient ID', 'film date']);
  });
  it('shows when the name came from the film, or when anything on this X-ray was learned', () => {
    expect(showsNote(doc({ identityChecked: true, identitySource: 'film' }))).toBe(true);
    expect(showsNote(doc({ identityChecked: true, identitySource: 'manual', learnedFields: ['xray_type'] }))).toBe(true);
    expect(showsNote(doc({ identityChecked: true, identitySource: 'manual', learnedFields: [] }))).toBe(false);
    expect(showsNote(doc({ identityChecked: false, identitySource: 'film' }))).toBe(false);
  });
});
