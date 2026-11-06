import { useEffect, useMemo, useRef, useState } from 'react';
import { nextStep, type Step } from '@ceph/analyses';
import { verifiedSet, type Action, type TracingState } from './state';

/**
 * After a point is released, the magnifier stays on it for this long, then moves to the next point (owner, 28 Sep:
 * "one smooth movement and release, pause 2–3 seconds, then move on"). The Steps tab it once moved with is gone (owner,
 * 5 Nov 2026); the guided order is still what picks the next point.
 */
export const ADVANCE_DELAY_MS = 2500;

/** The first unverified landmark of the first step not yet done, or null when every step is done. */
export function nextToPlace(steps: Step[], verified: ReadonlySet<string>): string | null {
  const s = nextStep(steps, verified);
  return s ? s.landmarks.find((l) => !verified.has(l)) ?? null : null;
}

/**
 * What the advance does when the verified set changes: `wait` then advance when a point was newly verified and
 * released; `sync` at once when nothing new was verified (undo, remove) or the case was just opened; otherwise `none`.
 */
export function advanceDecision(shown: ReadonlySet<string>, verified: ReadonlySet<string>, o: { dragging: boolean; fresh: boolean; auto?: boolean }): 'none' | 'sync' | 'wait' {
  const same = shown.size === verified.size && [...verified].every((id) => shown.has(id));
  if (same || o.dragging) return 'none';
  if (o.fresh) return 'sync';
  if (o.auto === false) return 'sync';   // owner, 6 Nov 2026: the switch is off, so there is no pause and no move to the next point
  return [...verified].some((id) => !shown.has(id)) ? 'wait' : 'sync';
}

/**
 * The verified set the advance has caught up with. It lags the real one by ADVANCE_DELAY_MS after a release, and when it
 * catches up the next point is selected at the same moment. Any further edit restarts
 * the pause; a point the user picks during the pause is never overridden.
 */
export function useStepAdvance(state: TracingState, steps: Step[], dispatch: (a: Action) => void, auto = true): ReadonlySet<string> {
  const verified = useMemo(() => verifiedSet(state), [state.points]);
  const [shown, setShown] = useState<ReadonlySet<string>>(verified);
  const live = useRef({ steps, active: state.active, shown, picked: state.picked }); live.current = { steps, active: state.active, shown, picked: state.picked };
  useEffect(() => {
    const d = advanceDecision(live.current.shown, verified, { dragging: !!state.dragging || state.rotating, fresh: state.past.length === 0, auto });
    if (d === 'sync') { setShown(verified); return; }
    if (d !== 'wait') return;
    const from = live.current.active;
    const t = setTimeout(() => {
      setShown(verified);
      const next = nextToPlace(live.current.steps, verified);
      if (next && next !== from && live.current.active === from && !live.current.picked.length) dispatch({ type: 'select', id: next });   // spec 2026-10-19: never clear a ⌘-picked set by advancing
    }, ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [state.points, state.dragging, state.rotating, auto]);   // eslint-disable-line react-hooks/exhaustive-deps
  return shown;
}
