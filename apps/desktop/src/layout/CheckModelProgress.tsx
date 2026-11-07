import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { ModelProgress } from '../ipc';
import { CHECK_ID } from '../manager/useCheckModel';

/** Spec §6 (1.2.1): after Download in the one-time question, a small line under the film list follows the install. */
export const FAILED_LINE = 'The check model did not download. Nothing was installed. Try again in Models…';

/** The line for one progress event, or null when there is nothing to say (ready: the line closes). */
export function progressLine(p: Pick<ModelProgress, 'stage' | 'fraction'> | null): string | null {
  if (!p) return null;
  if (p.stage === 'failed') return FAILED_LINE;
  if (p.stage === 'downloading') return p.fraction != null ? `Downloading the check model… ${Math.floor(p.fraction * 100)}%` : 'Downloading the check model…';
  if (p.stage === 'checking') return 'Checking the check model…';
  if (p.stage === 'testing') return 'Testing the check model…';
  return null;
}

/** Follows `models://progress` for the check model's install. Shows nothing until `started` (Download was pressed in the
 *  question) and closes when the install is ready; a failure stays, and says where to retry. `failedNow` is set when the
 *  install command itself was refused before any event. */
export function CheckModelProgress({ started, failedNow }: { started: boolean; failedNow: boolean }) {
  const [p, setP] = useState<ModelProgress | null>(null);
  useEffect(() => {
    let gone = false, unlisten: (() => void) | undefined;
    listen<ModelProgress>('models://progress', ({ payload }) => { if (payload.id === CHECK_ID) setP(payload); })
      .then((u) => { if (gone) u(); else unlisten = u; }).catch(() => {});
    return () => { gone = true; unlisten?.(); };
  }, []);
  const line = !started ? null : failedNow && !p ? FAILED_LINE : progressLine(p);
  return line ? <div className="hint check-model-line" role="status" aria-live="polite" data-testid="check-model-line">{line}</div> : null;
}
