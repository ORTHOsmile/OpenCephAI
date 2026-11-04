import { useCallback, useEffect, useRef, useState } from 'react';
import { settings } from '../ipc';
import type { FilmDetail } from '../library/filmTable';
import { FILM_DETAILS_KEY, readOff, writeOff } from './filmDetails';

/** The details switched off in "What it is" (spec 2026-10-17). Writes run one after another (the meanings' review
 *  I-2 lesson), each carrying the whole list, so two quick switches can never undo each other.
 *  D10 (preflight rulings, Task 8; ruling, fix round 1): a tick changed before the stored setting has
 *  loaded is MERGED onto the loaded value, not overwritten by it and not overwriting it. Every toggle made before
 *  the load resolves is recorded in `pending`, in order; when the load resolves, it starts from the loaded set and
 *  re-applies each pending toggle on top, so neither the early tick nor an already-stored switch-off is lost. The
 *  merged result is then written back (it may differ from what any pre-load toggle wrote, which started from an
 *  empty assumed set and so under-counted the stored switch-offs). */
export function useFilmDetailsOff() {
  const [off, setOff] = useState<ReadonlySet<FilmDetail>>(new Set());
  const current = useRef<ReadonlySet<FilmDetail>>(off);
  const loaded = useRef(false);   // true once the stored setting has been read (successfully or not)
  const pending = useRef<[FilmDetail, boolean][]>([]);   // toggles made before the load resolves, in order
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    settings.get(FILM_DETAILS_KEY).then((v) => {
      let merged = readOff(v);
      if (pending.current.length) {
        merged = new Set(merged);
        for (const [d, on] of pending.current) { if (on) merged.delete(d); else merged.add(d); }
      }
      loaded.current = true;
      current.current = merged; setOff(merged);
      if (pending.current.length) {
        const value = writeOff(merged);
        const p = queue.current.then(() => settings.set(FILM_DETAILS_KEY, value));
        queue.current = p.catch(() => {});
      }
    }).catch(() => { loaded.current = true; });
  }, []);
  const toggle = useCallback((d: FilmDetail, on: boolean): Promise<void> => {
    if (!loaded.current) pending.current.push([d, on]);
    const next = new Set(current.current);
    if (on) next.delete(d); else next.add(d);
    current.current = next; setOff(next);
    const value = writeOff(next);
    const p = queue.current.then(() => settings.set(FILM_DETAILS_KEY, value));
    queue.current = p.catch(() => {});
    return p;
  }, []);
  return { off, toggle };
}
