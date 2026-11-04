import { useState } from 'react';
import { FILM_CHOICES, type FilmDetail } from '../library/filmTable';
import type { useFilmDetailsOff } from './useFilmDetails';

/** Settings › Text on the film (owner D-FIELDS-1): a tick-box per detail in the "What it is" drop-down. */
export function FilmDetailsSettings({ filmDetails }: { filmDetails: ReturnType<typeof useFilmDetailsOff> }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="film-details-settings">
      <p className="hint">Untick a detail to hide it from "What it is" in Text on the film and from the Choose-on-the-film
        buttons. Its box stays, anything saved stays, and the machine still learns it.</p>
      {error && <p className="hint warn" role="status">{error}</p>}
      {FILM_CHOICES.filter((c) => c.value !== 'none').map((c) => (
        <label key={c.value} className="inline">
          <input type="checkbox" aria-label={c.label} checked={!filmDetails.off.has(c.value as FilmDetail)}
            onChange={(e) => filmDetails.toggle(c.value as FilmDetail, e.target.checked).then(() => setError(null))
              .catch((x) => setError(`The switch could not be saved: ${String(x)}`))} />{c.label}</label>))}
    </div>
  );
}
