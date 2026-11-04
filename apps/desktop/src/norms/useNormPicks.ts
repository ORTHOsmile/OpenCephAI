import { useCallback, useEffect, useState } from 'react';
import type { NormPicks } from '@ceph/analyses';
import { settings } from '../ipc';
import { readPicks, savePicks, withPick } from './normPicks';

/** Owner NORM-PICK-1: the open case's chosen norm sources (normPicks.ts), read when the case opens. `pick` is null until
 *  the read has come back (so a late read can never overwrite a fresh choice) and with no case open; a failed read or
 *  write is reported in `error`, never swallowed. */
export function useNormPicks(caseId: string | null) {
  const [state, setState] = useState<{ caseId: string | null; picks: NormPicks; ready: boolean; error: string | null }>({ caseId: null, picks: {}, ready: false, error: null });
  useEffect(() => {
    setState({ caseId, picks: {}, ready: false, error: null });
    if (!caseId) return;
    let gone = false;
    void readPicks(settings, caseId).then((r) => { if (!gone) setState({ caseId, picks: r.value, ready: true, error: r.error }); });
    return () => { gone = true; };
  }, [caseId]);
  const ready = state.ready && state.caseId === caseId && caseId !== null;
  const pick = useCallback((population: string, measurement: string, source: string) => {
    if (!caseId) return;
    const next = withPick(state.picks, population, measurement, source);
    setState((s) => ({ ...s, picks: next }));
    void savePicks(settings, caseId, next).then((error) => { if (error) setState((s) => (s.caseId === caseId ? { ...s, error } : s)); });
  }, [caseId, state.picks]);
  return { picks: ready ? state.picks : {}, error: state.error, pick: ready ? pick : null };
}
