import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgeRow } from './AgeRow';

const row = (d: { dateOfBirth: string | null; takenOn: string | null; ageOnFilm: string | null; ageOnFilmYears: number | null }, locked = false) =>
  renderToStaticMarkup(<AgeRow doc={{ id: 'c1', ...d }} locked={locked} onSave={() => {}} onError={() => {}} />);

describe('AgeRow (owner AG1)', () => {
  it('with a DOB: no box; the age from the DOB at the scan; the note when the film says otherwise', () => {
    const h = row({ dateOfBirth: '2014-01-02', takenOn: '2026-01-02', ageOnFilm: '010Y', ageOnFilmYears: 10 });   // SYNTHETIC
    expect(h).not.toContain('<input');
    expect(h).toContain('Age 12 y at the scan (from the DOB)');
    expect(h).toContain('The film says 10 y; DOB gives 12 y at the scan date.');
  });
  it('no DOB: a box with the film\'s age, and where it came from', () => {
    const h = row({ dateOfBirth: null, takenOn: '2026-01-02', ageOnFilm: '011Y', ageOnFilmYears: 11 });
    expect(h).toContain('value="011Y"');
    expect(h).toContain('Age 11 y (printed on the film or typed; no DOB)');
  });
  it('no DOB and no age: an empty box to type into, nothing else', () => {
    const h = row({ dateOfBirth: null, takenOn: null, ageOnFilm: null, ageOnFilmYears: null });
    expect(h).toContain('placeholder="e.g. 11 y 3 m"');
    expect(h).not.toContain('age-line');
  });
  it('locked: the box is disabled', () => {
    expect(row({ dateOfBirth: null, takenOn: null, ageOnFilm: null, ageOnFilmYears: null }, true)).toContain('disabled=""');
  });
});
