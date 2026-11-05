// Age on the film (owner AG1, 19 Oct; spec 2026-10-19 E): read as printed, kept per film. The DOB always wins.
import { ageAt, calendarAge } from '@ceph/analyses';

export interface FilmAge { text: string; years: number }
export const NOT_AN_AGE = "That isn't an age";
export const MAX_AGE_YEARS = 120;
const DAYS_PER_YEAR = 365.2425;                            // the mean Gregorian year, as ageAt
const DICOM_UNIT = { D: 1 / DAYS_PER_YEAR, W: 7 / DAYS_PER_YEAR, M: 1 / 12, Y: 1 } as const;
const LABELLED = /^\s*age\b\s*[:-]?\s*/i;
const DICOM = /^(\d{3})([DWMY])$/i;                        // DICOM Age String: three digits and D, W, M or Y
const WRITTEN = /^(\d{1,3})\s*(?:y|yr|yrs|year|years)\.?(?:\s*,?\s*(\d{1,2})\s*(?:m|mo|mos|mth|mths|month|months)\.?)?$/i;
const BARE = /^(\d{1,3})$/;

/** An age on its own line ("011Y", "11 yrs 3 mths", "Age: 11 y"), its "Age" label dropped, as printed; null when the
 *  line is not an age or the age is 0 or over 120 years. A bare number counts only when typed, or after an "Age"
 *  label (R10). */
export function ageIn(line: string, typed = false): FilmAge | null {
  const labelled = LABELLED.test(line);
  const text = line.replace(LABELLED, '').trim().replace(/[\s,;]+$/, '');
  if (!text) return null;
  let years: number | null = null;
  const d = DICOM.exec(text), w = WRITTEN.exec(text), bare = BARE.exec(text);
  if (d) years = +d[1] * DICOM_UNIT[d[2].toUpperCase() as keyof typeof DICOM_UNIT];
  else if (w) { const months = w[2] === undefined ? 0 : +w[2]; if (months > 11) return null; years = +w[1] + months / 12; }
  else if (bare && (typed || labelled)) years = +bare[1];
  return years !== null && years > 0 && years <= MAX_AGE_YEARS ? { text, years } : null;
}
/** An age in years as the screen shows it: whole years, and whole months when there are any (R11, rounded down). */
export function ageText(years: number): string {
  const all = Math.floor(years * 12 + 1e-9), y = Math.floor(all / 12), m = all % 12;
  return m ? `${y} y ${m} m` : `${y} y`;
}
export interface AgeFacts { dateOfBirth: string | null; takenOn: string | null; ageOnFilm?: string | null; ageOnFilmYears?: number | null }
const calendarText = (c: { years: number; months: number }) => (c.months ? `${c.years} y ${c.months} m` : `${c.years} y`);
/** The age from the DOB to the SCAN date, in calendar months ("17 y 1 m"), and the same in whole months (for sorting);
 *  null without both dates, or with a scan before the birth. The one source of the DOB age: the Patient panel's line
 *  (`ageShown`) and Library ▸ Table's Age column (final review I-1, 29 Oct) both read it. Never the import date. */
export function dobAge(dateOfBirth: string | null, takenOn: string | null): { text: string; months: number; exact: number } | null {
  const c = calendarAge(dateOfBirth, takenOn), exact = ageAt(dateOfBirth, takenOn);
  return c && exact !== null ? { text: calendarText(c), months: c.years * 12 + c.months, exact } : null;
}
/** The age line under the patient details, and its note (owner AG1): from the DOB to the scan date when both exist,
 *  noting a film age more than a year away; else the film's (or typed) age, saying where it came from. */
export function ageShown(d: AgeFacts): { text: string; note: string | null } | null {
  const film = d.ageOnFilmYears ?? null;
  if (d.dateOfBirth) {
    const a = dobAge(d.dateOfBirth, d.takenOn);
    if (a) {
      const note = film !== null && Math.abs(film - a.exact) > 1 ? `The film says ${ageText(film)}; DOB gives ${a.text} at the scan date.` : null;
      return { text: `Age ${a.text} at the scan (from the DOB)`, note };
    }
    if (film === null) return null;
    return { text: `Age ${ageText(film)} (printed on the film)`,
      note: d.takenOn ? 'The scan date is before the DOB, so the DOB cannot give an age.' : 'The DOB cannot be checked against it without the scan date.' };
  }
  return film === null ? null : { text: `Age ${ageText(film)} (printed on the film or typed; no DOB)`, note: null };
}
