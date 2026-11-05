import { useEffect, useState } from 'react';
import { library, type SeriesFilm } from '../ipc';
/** The open film's series for the tracing page's advice (owner G1); null until read, so no reason shows before it is known. */
export function useSeriesList(caseId: string | null, enabled: boolean, version?: unknown): SeriesFilm[] | null {
  const [films, setFilms] = useState<SeriesFilm[] | null>(null);
  useEffect(() => {
    let live = true; setFilms(null);
    if (!caseId || !enabled) return;
    library.series(caseId).then((f) => { if (live) setFilms(f); }).catch(() => { if (live) setFilms([]); });
    return () => { live = false; };
  }, [caseId, enabled, version]);
  return films;
}
