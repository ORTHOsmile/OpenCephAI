import { useCallback, useEffect, useRef, useState } from 'react';
import { library, type CaseDoc, type SeriesFilm, type Stage } from '../ipc';
import { orderSeries } from './series';

/** Serial superimposition (spec 2026-09-30): the open film's patient's films, oldest first, and each ticked film's doc. */
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
      const want = list.filter((f) => f.inSeries && f.id !== doc.id);
      const got = await Promise.all(want.map((f) => library.open(f.id).then((d) => [f.id, d] as const).catch(() => [f.id, null] as const)));
      if (token !== seq.current) return;
      setDocs(Object.fromEntries(got.filter(([, d]) => d).map(([id, d]) => [id, d!])));
      setFailed(new Set(got.filter(([, d]) => !d).map(([id]) => id)));
    } catch (e) { if (token === seq.current) setError(String(e)); }
  }, [doc?.id, doc?.timepoint, doc?.takenOn, doc?.patientKey, doc?.dateOfBirth, active, libraryVersion]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const setStage = useCallback(async (id: string, s: Stage | null) => {
    try { await library.setStage(id, s); setActionError(null); } catch (e) { setActionError(String(e)); } await load();
  }, [load]);
  const setInSeries = useCallback(async (id: string, on: boolean) => {
    try { await library.setInSeries(id, on); setActionError(null); } catch (e) { setActionError(String(e)); } await load();
  }, [load]);
  return { films, docs, failed, error, actionError, setStage, setInSeries };
}
