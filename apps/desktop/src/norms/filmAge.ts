import { ageAt } from '@ceph/analyses';

/** The age the norm's age row is chosen from (owner AG1, 19 Oct; spec "How age reaches the norms"). With a date of
 *  birth, always the age from the DOB to the film date — null when that cannot be worked out (no film date, or a film
 *  date before the birth: the adult row and its flag, exactly as before; R1). With no DOB, the age printed on (or
 *  typed for) this film. Else null: the adult row (AGE-UNK-1). */
export function filmAge(d: { dateOfBirth: string | null; takenOn: string | null; ageOnFilmYears?: number | null }): number | null {
  if (d.dateOfBirth) return ageAt(d.dateOfBirth, d.takenOn);
  return d.ageOnFilmYears ?? null;
}

/** Where `filmAge` came from (ruling R12, 19 Oct; the CSV's age_source): 'dob' for the DOB age, 'film' for the
 *  film's printed or typed age, null when there is no age (including a DOB with no film date, R1). */
export function filmAgeSource(d: { dateOfBirth: string | null; takenOn: string | null; ageOnFilmYears?: number | null }): 'dob' | 'film' | null {
  if (filmAge(d) === null) return null;
  return d.dateOfBirth ? 'dob' : 'film';
}
