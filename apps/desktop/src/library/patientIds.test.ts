import { describe, it, expect } from 'vitest';
import { differentIdNote, libraryLine, matchText, sameId, trailLines } from './patientIds';
import type { TrailLine } from '../ipc';
// SYNTHETIC names, dates and IDs only.
describe('patient IDs on screen (Q8, LIBID-1)', () => {
  it('matches ignoring case and spaces, never a near miss', () => {
    expect(sameId('zq 7781', 'ZQ7781')).toBe(true);
    expect(sameId('05566', '5566')).toBe(false);
  });
  it('the Library ID line lists every Patient ID on the patient\'s X-rays', () => {
    expect(libraryLine({ libraryId: 'L-00042', patientIdsSeen: ['5566', 'ZQ-7781'] }))
      .toBe('Library ID L-00042 · Patient IDs on this patient\'s X-rays: 5566, ZQ-7781');
    expect(libraryLine({ libraryId: 'L-00042', patientIdsSeen: [] })).toBe('Library ID L-00042');
    expect(libraryLine({ libraryId: null, patientIdsSeen: ['5566'] }))
      .toBe('Library ID: given once the patient has a name · Patient IDs on this patient\'s X-rays: 5566');
  });
  it('notes a different ID on another X-ray of this patient, and only then', () => {
    expect(differentIdNote({ printedPatientId: '5566', patientIdsSeen: ['5566', 'ZQ-7781'] })).toBe(
      'Other X-rays of this patient show Patient ID ZQ-7781. This X-ray may be of a different patient, or taken on another machine or by another radiography company.');
    expect(differentIdNote({ printedPatientId: '5566', patientIdsSeen: ['5566', ' 5566'.trim()] })).toBeNull();
    expect(differentIdNote({ printedPatientId: 'zq 7781', patientIdsSeen: ['zq 7781', 'ZQ7781'] })).toBeNull();
    expect(differentIdNote({ printedPatientId: null, patientIdsSeen: ['5566', 'ZQ-7781'] })).toBeNull();
  });
  it('says which patient carries the same ID', () => {
    expect(matchText({ libraryId: 'L-00007', patient: { name: 'Smith, John', dateOfBirth: '1990-03-07' }, films: 2 }, '5566', 'AU'))   // SYNTHETIC
      .toBe('Patient ID 5566 is also on 2 X-rays of Smith, John · 07/03/1990 (L-00007).');
    expect(matchText({ libraryId: 'L-00007', patient: { name: 'Demo', dateOfBirth: null }, films: 1 }, '5566', 'AU'))
      .toBe('Patient ID 5566 is also on 1 X-ray of Demo (L-00007).');
  });
  it('says where each number went, in plain words, oldest first (owner L9-A)', () => {
    const libraryTrail: TrailLine[] = [
      { kind: 'merged', number: 'L-00003', into: 'L-00002', on: '2026-10-16' },
      { kind: 'merged', number: 'L-00002', into: 'L-00001', on: '2026-10-17' },
      { kind: 'left', number: 'L-00001', on: '2026-10-18', now: 'L-00004', name: 'Smith, John' },   // SYNTHETIC
      { kind: 'left', number: 'L-00002', on: '2026-10-18', now: null, name: '' },
      { kind: 'left', number: 'L-00001', on: '2026-10-18', now: 'L-00005', name: '' },
    ];
    expect(trailLines({ libraryId: 'L-00001', libraryTrail }, 'AU')).toEqual([
      'L-00003 was merged into L-00002 on 16/10/2026.',
      'L-00002 was merged into this patient on 17/10/2026.',
      'An X-ray left this patient on 18/10/2026. It is now L-00004 (Smith, John).',
      'An X-ray left L-00002 on 18/10/2026. It has no name now, so it has no Library ID.',
      'An X-ray left this patient on 18/10/2026. It is now L-00005 (no name yet).',
    ]);
    expect(trailLines({ libraryId: 'L-00001', libraryTrail }, 'US')[1]).toBe('L-00002 was merged into this patient on 10/17/2026.');
    expect(trailLines({ libraryId: 'L-00001', libraryTrail: [] }, 'AU')).toEqual([]);
  });
});
