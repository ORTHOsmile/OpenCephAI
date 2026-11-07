import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { checkModel, type CheckRow, type ModelProgress } from '../ipc';

/** The check model's id, as in the back end (`check_model::ID`). */
export const CHECK_ID = 'check-regions';

/** The check model's row: read on mount and when its install ends, its progress followed through `models://progress`.
 *  `null` until the first read (the row says so), and after a failed read (`error`). Closing and reopening Models…
 *  reads it again; an install that is still running comes back as `installing` and its next event carries the percentage. */
export function useCheckModel() {
  const [row, setRow] = useState<CheckRow | null>(null);
  const [progress, setProgress] = useState<Record<string, ModelProgress>>({});
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const refresh = useCallback((): Promise<void> => checkModel.row().then((r) => { if (alive.current) { setRow(r ?? null); setError(null); } }).catch((e) => { if (alive.current) setError(String(e)); }), []);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, [refresh]);
  useEffect(() => {
    let gone = false, unlisten: (() => void) | undefined;
    listen<ModelProgress>('models://progress', ({ payload }) => {
      if (payload.id !== CHECK_ID) return;
      setProgress((p) => ({ ...p, [payload.id]: payload }));
      if (payload.stage === 'ready' || payload.stage === 'failed') void refresh();
      else setRow((r) => (r ? { ...r, status: 'installing', stage: payload.stage } : r));
    }).then((u) => { if (gone) u(); else unlisten = u; }).catch(() => {});
    return () => { gone = true; unlisten?.(); };
  }, [refresh]);
  return { row, progress, refresh, error };
}
