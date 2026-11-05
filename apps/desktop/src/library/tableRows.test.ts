import { describe, it, expect } from 'vitest';
import type { CaseSummary } from '../ipc';
import { aiSummary, flatOrder, groupPatients, localDay, patientKeyAction, timepointOrder, type FilmValue } from './tableRows';

// Library ▸ Table, Grouped and Flat (owner, 29 Oct 2026, item B as revised): one row per PATIENT that expands to its
// films in timepoint order; a column sort orders the PATIENTS (by their first film, or the value their row shows) and
// never splits a patient's films; Flat lists every film on its own. SYNTHETIC rows only.
const c = (o: Partial<CaseSummary>): CaseSummary => ({
  id: 'x', patientName: 'SYNTHETIC Demo', timepoint: 'T1', takenOn: '2026-05-01', createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z', thumbPath: '/t.jpg', landmarks: 0, unverified: 0, verifiedAt: null, deletedAt: null, orientation: null,
  patientKey: 'synthetic demo', dateOfBirth: '2010-02-03', identityChecked: true, libraryId: null, formerLibraryIds: [], printedPatientId: null,
  gender: 'F', aiModelId: null, reportSavedAt: null, ...o,
});
// The film's own sort value, as LibraryTable gives it (name lowercased, dates ISO).
const value: FilmValue = (f, key) => {
  switch (key) {
    case 'name': return f.patientName.toLowerCase();
    case 'dob': return f.dateOfBirth;
    case 'timepoint': return f.timepoint;
    case 'scanDate': return (f.takenOn ?? f.createdAt).slice(0, 10);
    case 'sex': return f.gender;
    case 'age': return f.dateOfBirth ? Number(f.takenOn!.slice(0, 4)) - Number(f.dateOfBirth.slice(0, 4)) : null;
    case 'aiStatus': return f.verifiedAt ? 'verified' : 'not';
    case 'report': return f.reportSavedAt ? localDay(f.reportSavedAt) : null;
  }
};
// Zed: two films imported T2 first; Amy: one film. Zed sorts after Amy by name but has the EARLIER first scan.
const zed2 = c({ id: 'z2', patientName: 'SYNTHETIC Zed', patientKey: 'zed', dateOfBirth: '2009-01-01', gender: 'M', timepoint: 'T2', takenOn: '2026-03-01',
  verifiedAt: '2026-03-02T00:00:00Z', reportSavedAt: '2026-03-03T01:00:00.000Z' });
const zed1 = c({ id: 'z1', patientName: 'SYNTHETIC Zed', patientKey: 'zed', dateOfBirth: '2009-01-01', gender: 'M', timepoint: 'T1', takenOn: '2020-01-01' });
const amy1 = c({ id: 'a1', patientName: 'SYNTHETIC Amy', patientKey: 'amy', dateOfBirth: '2012-01-01', timepoint: 'T1', takenOn: '2025-06-01',
  verifiedAt: '2025-06-02T00:00:00Z' });
const ids = (rows: CaseSummary[]) => rows.map((r) => r.id);
const order = (sort: Parameters<typeof groupPatients>[1]) => groupPatients([zed2, amy1, zed1], sort, value).map((g) => `${g.id.split('|')[0]}:${ids(g.films).join('+')}`);

describe('groupPatients (Grouped view)', () => {
  it('one group per patient, its films in timepoint order (oldest film first), whatever the import order', () => {
    expect(order(null)).toEqual(['amy:a1', 'zed:z1+z2']);
  });
  it('sorting by Name orders the PATIENTS, each patient\'s films staying together in timepoint order, both ways', () => {
    expect(order({ key: 'name', dir: 'asc' })).toEqual(['amy:a1', 'zed:z1+z2']);
    expect(order({ key: 'name', dir: 'desc' })).toEqual(['zed:z1+z2', 'amy:a1']);
  });
  // Positive control for "by the patient's value": by scan date Zed's latest scan (2026) is after Amy's (2025), so Zed
  // comes LAST ascending although his first film (2020) is the earliest of all — a flat sort would split him.
  it('Date of scan sorts patients by their latest scan, the date the patient row shows', () => {
    expect(order({ key: 'scanDate', dir: 'asc' })).toEqual(['amy:a1', 'zed:z1+z2']);
    expect(order({ key: 'scanDate', dir: 'desc' })).toEqual(['zed:z1+z2', 'amy:a1']);
  });
  it('Timepoint sorts by the number of films; AI status by the share verified; Report by the latest report', () => {
    expect(order({ key: 'timepoint', dir: 'asc' })).toEqual(['amy:a1', 'zed:z1+z2']);
    expect(order({ key: 'aiStatus', dir: 'asc' })).toEqual(['zed:z1+z2', 'amy:a1']);   // 1 of 2 before 1 of 1
    expect(order({ key: 'report', dir: 'asc' })).toEqual(['zed:z1+z2', 'amy:a1']);     // Amy has none: last
    expect(order({ key: 'report', dir: 'desc' })).toEqual(['zed:z1+z2', 'amy:a1']);    // still last
  });
  it('M/F, DOB and Age come from the patient\'s first film', () => {
    expect(order({ key: 'sex', dir: 'asc' })).toEqual(['amy:a1', 'zed:z1+z2']);        // F before M
    expect(order({ key: 'dob', dir: 'asc' })).toEqual(['zed:z1+z2', 'amy:a1']);
    expect(order({ key: 'age', dir: 'asc' })).toEqual(['zed:z1+z2', 'amy:a1']);        // Zed 11 at T1, Amy 13
  });
  it('a patient row knows its film count, latest scan, verified count and latest report', () => {
    const zed = groupPatients([zed2, amy1, zed1], null, value)[1];
    expect([zed.films.length, zed.latestScan, zed.verified, zed.latestReport]).toEqual([2, '2026-03-01', 1, '2026-03-03T01:00:00.000Z']);
    expect(aiSummary(zed)).toBe('1 of 2 verified');
    const amy = groupPatients([amy1], null, value)[0];
    expect([amy.latestReport, aiSummary(amy)]).toEqual([null, '1 of 1 verified']);
  });
  it('nothing in, nothing out', () => { expect(groupPatients([], null, value)).toEqual([]); });
});

describe('flatOrder (Flat view)', () => {
  it('every film its own row; a sort runs across all films, splitting patients when the values do', () => {
    expect(ids(flatOrder([zed2, amy1, zed1], { key: 'scanDate', dir: 'asc' }, value))).toEqual(['z1', 'a1', 'z2']);
  });
  it('with no column chosen, patients together, oldest film first', () => {
    expect(ids(flatOrder([zed2, amy1, zed1], null, value))).toEqual(['a1', 'z1', 'z2']);
  });
});

describe('timepointOrder', () => {
  it('by film date, then the timepoint label when two films share a date', () => {
    const t3 = c({ id: 't3', timepoint: 'T3', takenOn: '2026-01-01' }), t2 = c({ id: 't2', timepoint: 'T2', takenOn: '2026-01-01' });
    expect(ids(timepointOrder([t3, zed1, t2]))).toEqual(['z1', 't2', 't3']);
  });
});

describe('patientKeyAction (patient row keyboard; Enter and Space are the button\'s own)', () => {
  it('Right expands a closed row, Left collapses an open one; otherwise nothing', () => {
    expect(patientKeyAction('ArrowRight', false)).toBe('expand');
    expect(patientKeyAction('ArrowLeft', true)).toBe('collapse');
    expect(patientKeyAction('ArrowRight', true)).toBeNull();
    expect(patientKeyAction('ArrowLeft', false)).toBeNull();
    expect(patientKeyAction('Enter', false)).toBeNull();
    expect(patientKeyAction(' ', true)).toBeNull();
  });
});

describe('localDay (the report date as the clinician\'s own calendar day)', () => {
  it('a timestamp becomes the local date it happened on', () => {
    expect(localDay(new Date(2026, 9, 12, 8, 30).toISOString())).toBe('2026-10-12');
    expect(localDay(new Date(2026, 9, 12, 23, 59).toISOString())).toBe('2026-10-12');
  });
  it('anything unreadable comes back as it was', () => { expect(localDay('garbled')).toBe('garbled'); });
});
