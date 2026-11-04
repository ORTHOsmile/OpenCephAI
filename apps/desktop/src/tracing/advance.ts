import { useEffect, useMemo, useRef, useState } from 'react';
import { nextStep, type Step } from '@ceph/analyses';
import { verifiedSet, type Action, type TracingState } from './state';

/**
 * After a point is released, the Steps highlight and the magnifier stay on it for this long, then move to the next point
 * together (owner, 28 Sep: "one smooth movement and release, pause 2–3 seconds, then move on").
 */
export const ADVANCE_DELAY_MS = 2500;

/** The first unverified landmark of the first step not yet done, or null when every step is done. */
export function nextToPlace(steps: Step[], verified: ReadonlySet<string>): string | null {
  const s = nextStep(steps, verified);
  return s ? s.landmarks.find((l) => !verified.has(l)) ?? null : null;
}

/**
 * What the step highlight does when the verified set changes: `wait` then advance when a point was newly verified and
 * released; `sync` at once when nothing new was verified (undo, remove) or the case was just opened; otherwise `none`.
 */
export function advanceDecision(shown: ReadonlySet<string>, verified: ReadonlySet<string>, o: { dragging: boolean; fresh: boolean }): 'none' | 'sync' | 'wait' {
  const same = shown.size === verified.size && [...verified].every((id) => shown.has(id));
  if (same || o.dragging) return 'none';
  if (o.fresh) return 'sync';
  return [...verified].some((id) => !shown.has(id)) ? 'wait' : 'sync';
}

/**
 * The verified set the Steps list shows. It lags the real one by ADVANCE_DELAY_MS after a release, and when it catches up
 * the next point is selected at the same moment, so the magnifier moves with the highlight. Any further edit restarts
 * the pause; a point the user picks during the pause is never overridden.
 */
export function useStepAdvance(state: TracingState, steps: Step[], dispatch: (a: Action) => void): ReadonlySet<string> {
  const verified = useMemo(() => verifiedSet(state), [state.points]);
  const [shown, setShown] = useState<ReadonlySet<string>>(verified);
  const live = useRef({ steps, active: state.active, shown }); live.current = { steps, active: state.active, shown };
  useEffect(() => {
    const d = advanceDecision(live.current.shown, verified, { dragging: !!state.dragging || state.rotating, fresh: state.past.length === 0 });
    if (d === 'sync') { setShown(verified); return; }
    if (d !== 'wait') return;
    const from = live.current.active;
    const t = setTimeout(() => {
      setShown(verified);
      const next = nextToPlace(live.current.steps, verified);
      if (next && next !== from && live.current.active === from) dispatch({ type: 'select', id: next });
    }, ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [state.points, state.dragging, state.rotating]);   // eslint-disable-line react-hooks/exhaustive-deps
  return shown;
}
