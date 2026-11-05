import { describe, it, expect } from 'vitest';
import { caseStatus, cardMeta, chipLabel, filterCases, patientIdOf, patientLabel, patientsOf, thumbTransform, type LibraryFilter } from './filter';
import type { CaseSummary } from '../ipc';

// SYNTHETIC library rows only.
const c = (o: Partial<CaseSummary>): CaseSummary => ({
  id: 'x', patientName: 'Demo patient 01', timepoint: 'T1', takenOn: null, createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z', thumbPath: '/t.jpg', landmarks: 19, unverified: 19, verifiedAt: null, deletedAt: null, orientation: null,
  patientKey: 'demo patient 01', dateOfBirth: null, identityChecked: true,
  libraryId: null, formerLibraryIds: [], printedPatientId: null, gender: null, aiModelId: null, reportSavedAt: null, ...o,
});
const all: LibraryFilter = { query: '', status: 'all', nav: 'all', patient: null, batch: [] };
const NOW = Date.parse('2026-09-28T12:00:00Z');

describe('library filters', () => {
  it('status: not traced, AI only, to review, verified', () => {
    expect(caseStatus(c({ landmarks: 0, unverified: 0 }))).toBe('none');
    expect(caseStatus(c({}))).toBe('ai');
    expect(caseStatus(c({ unverified: 3 }))).toBe('review');
    expect(caseStatus(c({ unverified: 0 }))).toBe('review');                 // all checked, not yet signed off
    expect(caseStatus(c({ unverified: 0, verifiedAt: '2026-09-21T09:00:00.000Z' }))).toBe('verified');
  });
  it('card meta says what is left to do, dated by the film if known, in the operator’s format', () => {
    expect(cardMeta(c({ unverified: 3 }))).toBe('01/09/2026 · 3 landmarks to review');
    expect(cardMeta(c({ unverified: 1, takenOn: '2026-08-30' }))).toBe('30/08/2026 · 1 landmark to review');
    expect(cardMeta(c({ unverified: 1, takenOn: '2026-08-30' }), 'US')).toBe('08/30/2026 · 1 landmark to review');
    expect(cardMeta(c({ unverified: 0 }))).toBe('01/09/2026 · ready to sign off');
    expect(cardMeta(c({ unverified: 0, verifiedAt: 'x' }))).toBe('01/09/2026 · verified');
    expect(cardMeta(c({}))).toBe('01/09/2026 · AI only');
    expect(cardMeta(c({ landmarks: 0, unverified: 0 }))).toBe('01/09/2026');
  });
  it('filters by status, patient, review queue, recent, batch and search', () => {
    const rows = [
      c({ id: 'a', patientName: 'Demo patient 01', timepoint: 'T1', unverified: 2 }),
      c({ id: 'b', patientName: 'Demo patient 01', timepoint: 'T2', updatedAt: '2026-08-01T00:00:00.000Z' }),
      c({ id: 'c', patientName: 'Demo patient 02', patientKey: 'demo patient 02', unverified: 0, verifiedAt: '2026-09-21T00:00:00.000Z' }),
      c({ id: 'd', patientName: 'Demo patient 03', patientKey: 'demo patient 03', dateOfBirth: '1990-03-07', unverified: 0,
        verifiedAt: '2026-09-21T00:00:00.000Z', identityChecked: false }),
    ];
    const ids = (f: Partial<LibraryFilter>, fmt: 'AU' | 'US' = 'AU') => filterCases(rows, { ...all, ...f }, NOW, fmt).map((x) => x.id);
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ status: 'verified' })).toEqual(['c', 'd']);
    expect(ids({ patient: patientIdOf(rows[0]) })).toEqual(['a', 'b']);
    expect(ids({ nav: 'review' })).toEqual(['a', 'b', 'd']);                   // "Check details" cases are in the queue too
    expect(ids({ nav: 'recent' })).toEqual(['a', 'c', 'd']);
    expect(ids({ nav: 'batch', batch: ['c'] })).toEqual(['c']);
    expect(ids({ query: ' patient 01 t2 ' })).toEqual(['b']);
    expect(ids({ query: 't2 patient' })).toEqual([]);
    expect(ids({ query: '2026-09-01' })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ query: '01/09/2026' })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ query: '07/03/1990' })).toEqual(['d']);                        // date of birth, as the operator writes it
    expect(ids({ query: '03/07/1990' }, 'US')).toEqual(['d']);
  });
  it('patients are one name and date of birth each, alphabetical, shown as "Name · DOB"', () => {
    const rows = [c({ patientName: 'B', patientKey: 'b', dateOfBirth: '1990-03-07' }), c({ patientName: 'a', patientKey: 'a' }),
      c({ patientName: 'B', patientKey: 'b', dateOfBirth: '1990-03-07' }), c({ patientName: 'B', patientKey: 'b', dateOfBirth: '1991-01-01' })];
    expect(patientsOf(rows)).toEqual([
      { id: 'a|', name: 'a', label: 'a', count: 1 },
      { id: 'b|1990-03-07', name: 'B', label: 'B · 07/03/1990', count: 2 },
      { id: 'b|1991-01-01', name: 'B', label: 'B · 01/01/1991', count: 1 }]);
  });
});

describe('library thumbnails show the case as it opens: flipped to face right and levelled to FH, in a square', () => {
  it('mirrors, rotates, and zooms just enough to fill the square', () => {
    expect(thumbTransform({})).toBe('none');
    expect(thumbTransform({ mirror: false, rotDeg: 0 })).toBe('none');
    expect(thumbTransform({ mirror: true, rotDeg: 0 })).toBe('rotate(0deg) scaleX(-1) scale(1)');
    const t = thumbTransform({ mirror: false, rotDeg: 30 });
    expect(t).toBe(`rotate(30deg) scale(${(Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6)).toFixed(4)})`);
  });
});

describe('the Library card words (spec 2026-10-19, P2)', () => {
  it('every point accepted but the tracing not signed off: "Ready to sign off"', () => {
    expect(chipLabel(c({ unverified: 0 }))).toBe('Ready to sign off');
  });
  it('keeps "To review" while points are left, and every other word as it was', () => {
    expect([chipLabel(c({ unverified: 3 })), chipLabel(c({})), chipLabel(c({ unverified: 0, verifiedAt: '2026-09-21T09:00:00.000Z' })), chipLabel(c({ landmarks: 0, unverified: 0 }))])
      .toEqual(['To review', 'AI · unverified', 'Verified', 'Not traced']);
  });
  it('a ready film still counts as "to review" for the status filter and the Review queue', () => {
    const ready = c({ id: 'r', unverified: 0 });
    expect(filterCases([ready], { ...all, status: 'review' })).toEqual([ready]);
    expect(filterCases([ready], { ...all, nav: 'review' })).toEqual([ready]);
  });
});

describe('an unnamed patient in the Library', () => {
  it('is listed as "Name needed", with the date of birth when there is one', () => {
    expect(patientLabel('', '1990-03-07', 'AU')).toBe('Name needed · 07/03/1990');   // SYNTHETIC
    expect(patientLabel('', null, 'AU')).toBe('Name needed');
  });
});

describe('the Library search box finds by Library ID and by any Patient ID on a patient\'s X-rays (LIBID-1, preflight 9a/9b)', () => {
  it('finds by the current Library ID, by a former (merged-in) one, and normalises "l-2" and "L 1"', () => {
    const rows = [
      c({ id: 'a', libraryId: 'L-00001' }),
      c({ id: 'b', libraryId: 'L-00003', formerLibraryIds: ['L-00002'] }),
    ];
    const ids = (q: string) => filterCases(rows, { ...all, query: q }).map((x) => x.id);
    expect(ids('L-00001')).toEqual(['a']);
    expect(ids('l-00002')).toEqual(['b']);
    expect(ids('l-2')).toEqual(['b']);
    expect(ids('L 1')).toEqual(['a']);
  });
  it('finds a patient by a Patient ID on ANY of its X-rays, not only the card that carries it (preflight 9b)', () => {
    const rows = [
      c({ id: 'a', patientKey: 'demo', printedPatientId: '5566' }),
      c({ id: 'b', patientKey: 'demo', printedPatientId: null }),
      c({ id: 'z', patientKey: 'other', patientName: 'Other', printedPatientId: null }),
    ];
    const ids = (q: string) => filterCases(rows, { ...all, query: q }).map((x) => x.id);
    expect(ids('5566')).toEqual(['a', 'b']);
  });
});
