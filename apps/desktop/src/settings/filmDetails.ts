import { createContext } from 'react';
import { FILM_CHOICES, type FilmDetail } from '../library/filmTable';

/** Settings › Text on the film (owner D-FIELDS-1, spec 2026-10-17): the details switched OFF in the "What it is"
 *  drop-down and the Choose-on-the-film buttons (Q2 A). Kept in the library's settings on this Mac. Nothing stored
 *  = all on. Switching off never hides or deletes a saved value. */
export const FILM_DETAILS_KEY = 'film_details_off';
const IDS = FILM_CHOICES.map((c) => c.value).filter((v): v is FilmDetail => v !== 'none');

export function readOff(raw: string | null): Set<FilmDetail> {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is FilmDetail => typeof x === 'string' && (IDS as string[]).includes(x)) : []);
  } catch { return new Set(); }
}
export const writeOff = (off: ReadonlySet<FilmDetail>): string => JSON.stringify(IDS.filter((d) => off.has(d)));
export const FilmDetailsOff = createContext<ReadonlySet<FilmDetail>>(new Set());
