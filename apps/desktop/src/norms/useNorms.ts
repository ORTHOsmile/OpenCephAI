import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserNorm } from '@ceph/analyses';
import { library, settings } from '../ipc';
import { readClinicDefault, readUserNorms, safeLoadSets } from './loadNorms';

/** The committed norm sets (loaded once; a set that fails validation stops the load, and `loadError` says why), the
 *  clinician's own norms and the clinic default population (N6). `refresh` re-reads the last two after Settings edits.
 *  Ruling T4-3: a failed read of either is reported in `settingsError` (one message per failed read), never
 *  swallowed — the screen must show it, because a silent failure shows a different norm. */
export function useNorms() {
  const loaded = useMemo(() => safeLoadSets(), []);
  const [userNorms, setUserNorms] = useState<UserNorm[]>([]);
  const [clinicDefault, setDefault] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ userNorms: string | null; clinicDefault: string | null }>({ userNorms: null, clinicDefault: null });
  const refresh = useCallback(() => {
    void readUserNorms(library).then((r) => { setUserNorms(r.value); setErrors((e) => ({ ...e, userNorms: r.error })); });
    void readClinicDefault(settings).then((r) => { setDefault(r.value); setErrors((e) => ({ ...e, clinicDefault: r.error })); });
  }, []);
  useEffect(refresh, [refresh]);
  const setClinicDefault = useCallback(async (p: string | null) => { await settings.setDefaultPopulation(p); setDefault(p); setErrors((e) => ({ ...e, clinicDefault: null })); }, []);
  const settingsError = [errors.clinicDefault, errors.userNorms].filter(Boolean).join(' ') || null;
  // Final review M-8: whether the user norms failed to read, so the case panel never reports a deletion that did not happen.
  return { sets: loaded.sets, loadError: loaded.loadError, settingsError, userNorms, userNormsFailed: errors.userNorms !== null, clinicDefault, refresh, setClinicDefault };
}
