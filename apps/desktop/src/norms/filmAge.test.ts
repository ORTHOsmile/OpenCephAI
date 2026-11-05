import { describe, it, expect } from 'vitest';
import { ageAt } from '@ceph/analyses';
import { filmAge, filmAgeSource } from './filmAge';

// Owner AG1 (19 Oct): the age the norm's age row is chosen from. SYNTHETIC dates only.
describe('filmAge', () => {
  it('with a DOB: always ageAt(DOB, scan date), whatever the film says', () => {
    expect(filmAge({ dateOfBirth: '2014-01-02', takenOn: '2026-01-10', ageOnFilmYears: 9 })).toBe(ageAt('2014-01-02', '2026-01-10'));   // SYNTHETIC
  });
  it('R1: a DOB but no scan date — null (the adult row, as today), never the film\'s age', () => {
    expect(filmAge({ dateOfBirth: '2014-01-02', takenOn: null, ageOnFilmYears: 11 })).toBeNull();   // SYNTHETIC
  });
  it('no DOB: the film\'s age; none → null; an old doc without the field → null', () => {
    expect(filmAge({ dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: 11.25 })).toBe(11.25);
    expect(filmAge({ dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: null })).toBeNull();
    expect(filmAge({ dateOfBirth: null, takenOn: '2026-01-10' })).toBeNull();
  });
});

describe('filmAgeSource (ruling R12, 19 Oct): where filmAge came from, for the CSV', () => {
  it('dob, film, or null — exactly when filmAge is a DOB age, a film age, or none', () => {
    expect(filmAgeSource({ dateOfBirth: '2014-01-02', takenOn: '2026-01-10', ageOnFilmYears: 9 })).toBe('dob');   // SYNTHETIC
    expect(filmAgeSource({ dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: 11 })).toBe('film');
    expect(filmAgeSource({ dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: null })).toBeNull();
    expect(filmAgeSource({ dateOfBirth: '2014-01-02', takenOn: null, ageOnFilmYears: 11 })).toBeNull();          // SYNTHETIC: R1, no age used
  });
  it('a scan date before the birth: no age, so no source, even with a film age (R1)', () => {
    expect(filmAgeSource({ dateOfBirth: '2014-01-02', takenOn: '2013-01-01', ageOnFilmYears: 11 })).toBeNull();  // SYNTHETIC
  });
});
