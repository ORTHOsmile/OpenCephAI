import { useCallback, useEffect, useRef, useState } from 'react';
import { library, type CaseDoc, type SeriesFilm, type Stage } from '../ipc';
import { orderSeries } from './series';

/** Which films the Superimposition page opens: `want` — every ticked film but the open one (as before request G) — and
 *  `need` — those plus the reference of a ticked fitted film or of the fitted open film, ticked or not (request G, plan
 *  Task 6): a fit can only place its film when its reference is loaded. */
export function filmsToOpen(list: SeriesFilm[], openId: string): { want: string[]; need: string[] } {
  const want = list.filter((f) => f.inSeries && f.id !== openId).map((f) => f.id);
  const need = new Set(want);
  for (const f of list) if ((f.inSeries || f.id === openId) && f.fitRef && f.fitRef !== openId) need.add(f.fitRef);
  return { want, need: [...need] };
}
/** Pre-flight ruling (Task 6): only a TICKED film that cannot be opened is "failed" (its key line says so); an unticked
 *  reference that fails only leaves its fitted film reading as un-fitted (buildComparison ignores such a fit). */
export const failedOf = (got: readonly (readonly [string, CaseDoc | null])[], want: string[]) =>
  new Set(got.filter(([id, d]) => !d && want.includes(id)).map(([id]) => id));

/** Serial superimposition (spec 2026-09-30): the open film's patient's films, oldest first, and each ticked film's doc
 *  (and, request G, each needed reference's). */
/** `libraryVersion` changes whenever the library list is refreshed, so films imported meanwhile (a batch) join. */
export function useSeries(doc: CaseDoc | null, active: boolean, libraryVersion?: unknown) {
  const [films, setFilms] = useState<SeriesFilm[]>([]);
  const [docs, setDocs] = useState<Record<string, CaseDoc>>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // A stage or tick that couldn't be saved: kept until the next save or another case, never cleared by a reload.
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setActionError(null), [doc?.id]);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const token = ++seq.current;
    if (!doc || !active) { setFilms([]); setDocs({}); setFailed(new Set()); return; }
    try {
      const list = orderSeries(await library.series(doc.id));
      if (token !== seq.current) return;
      setFilms(list); setError(null);
      const { want, need } = filmsToOpen(list, doc.id);
      const got = await Promise.all(need.map((id) => library.open(id).then((d) => [id, d] as const).catch(() => [id, null] as const)));
      if (token !== seq.current) return;
      setDocs(Object.fromEntries(got.filter(([, d]) => d).map(([id, d]) => [id, d!])));
      setFailed(failedOf(got, want));
    } catch (e) { if (token === seq.current) setError(String(e)); }
  }, [doc?.id, doc?.timepoint, doc?.takenOn, doc?.patientKey, doc?.dateOfBirth, active, libraryVersion]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const setStage = useCallback(async (id: string, s: Stage | null) => {
    try { await library.setStage(id, s); setActionError(null); } catch (e) { setActionError(String(e)); } await load();
  }, [load]);
  const setInSeries = useCallback(async (id: string, on: boolean) => {
    try { await library.setInSeries(id, on); setActionError(null); } catch (e) { setActionError(String(e)); } await load();
  }, [load]);
  return { films, docs, failed, error, actionError, setStage, setInSeries, reload: load };
}
