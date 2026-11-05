import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { models, type ModelProgress, type ModelRow } from '../ipc';

/** The Model Manager's rows, refreshed on mount, on `refresh()`, and when an install ends; plus each model's latest progress.
 *  `onReady`: called with a model's id when its install ends Ready (App: Automatic best's first-open step runs again). */
export function useModels(onReady?: (id: string) => void) {
  const [rows, setRows] = useState<ModelRow[]>([]);
  const ready = useRef(onReady); ready.current = onReady;
  const [progress, setProgress] = useState<Record<string, ModelProgress>>({});
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback((): Promise<void> => models.list().then((r) => { setRows(r ?? []); setError(null); }).catch((e) => setError(String(e))), []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let gone = false, unlisten: (() => void) | undefined;
    listen<ModelProgress>('models://progress', ({ payload }) => {
      setProgress((p) => ({ ...p, [payload.id]: payload }));
      if (payload.stage === 'ready' || payload.stage === 'failed') {
        refresh();
        if (payload.stage === 'ready') ready.current?.(payload.id);
      } else setRows((rs) => rs.map((r) => (r.id === payload.id ? { ...r, status: 'installing', stage: payload.stage } : r)));
    }).then((u) => { if (gone) u(); else unlisten = u; }).catch(() => {});
    return () => { gone = true; unlisten?.(); };
  }, [refresh]);
  return { rows, progress, refresh, error };
}
