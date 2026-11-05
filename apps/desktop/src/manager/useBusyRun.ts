import { useCallback, useRef, useState } from 'react';

/** A Models… row's Install: pressed once it is busy ("Starting…") until the call has ended AND the list has been read
 *  again, so the row has moved on (Installing, Ready or Failed) before the button comes back; a second press (or a
 *  double click) before that starts nothing. The ref closes the gap before React redraws. */
export function useBusyRun(onChanged: () => Promise<unknown>, setErr: (e: string | null) => void) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const start = useCallback((f: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setErr(null);
    f().catch(() => {})                                   // the row shows the failure
      .then(() => onChanged()).catch(() => {})
      .finally(() => { busy.current = false; setPending(false); });
  }, [onChanged, setErr]);
  return { pending, start };
}
