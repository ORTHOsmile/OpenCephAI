import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toAnalysisDef, type MyAnalysis } from '@ceph/analyses';
import { settings } from '../ipc';
import { readMyAnalyses } from './myAnalyses';

/** Owner B2: the current clinician's own analyses (the clinician as `useMeanings` resolves it, passed in). Re-read when
 *  the clinician changes and after Settings saves (`refresh`). Only the latest read may land (as useMeanings, review
 *  M-2), and a list read for another clinician is never shown. */
export function useMyAnalyses(clinician: string) {
  const [state, setState] = useState<{ clinician: string; list: MyAnalysis[]; error: string | null }>({ clinician: '', list: [], error: null });
  const seq = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++seq.current;
    void readMyAnalyses(settings, clinician).then((r) => { if (mine === seq.current) setState({ clinician, ...r }); });
  }, [clinician]);
  useEffect(refresh, [refresh]);
  const current = state.clinician === clinician;
  const list = useMemo(() => (current ? state.list : []), [current, state.list]);
  const defs = useMemo(() => list.map(toAnalysisDef), [list]);
  return { clinician, list, defs, error: current ? state.error : null, refresh };
}
