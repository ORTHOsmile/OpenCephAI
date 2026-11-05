import { useCallback, useRef, useState } from 'react';
import type { Vec2 } from '@ceph/geometry';
import type { RulerMarks } from '../ipc';
import type { Ruler } from '../loupe/Loupe';

export interface MarkDrag { i: 0 | 1; p: Vec2 }
/** The marks with one of them moved (a drag in progress, or a drop waiting for the library). A moved mark is a new
 *  ruler reading, so the fine-tune starts again from 0 (Addendum 3). */
export const withMark = (r: RulerMarks, d: MarkDrag | null): RulerMarks => (!d ? r : d.i === 0 ? { ...r, p1: d.p, steps: 0 } : { ...r, p2: d.p, steps: 0 });

/** Fix round 1, M2: a drop still in flight is the base for the NEXT drag, never the stale ruler underneath it — so
 *  a second mark dropped before the first finishes saving builds on top of it instead of losing it. */
export const baseOf = (ruler: RulerMarks | null, pending: RulerMarks | null): RulerMarks | null => pending ?? ruler;

/** Fix round 1, M3: what a release would drop. No drag (a press that never moved) or nothing calibrated yet: nothing
 *  to drop. Pure, so this is unit-testable without a renderHook library (none exists in apps/desktop). */
export const dropOf = (base: RulerMarks | null, drag: MarkDrag | null): RulerMarks | null => (!base || !drag ? null : withMark(base, drag));

/** Fix round 1, M3: what to draw right now. Disabled (calibrating, read-only, the report preview) or nothing
 *  calibrated: nothing. Otherwise the base with any in-progress drag applied. */
export const shown = (enabled: boolean, base: RulerMarks | null, drag: MarkDrag | null): RulerMarks | null => (!enabled || !base ? null : drag ? withMark(base, drag) : base);

/**
 * The ruler marks left on the film after calibrating (spec 2026-10-19, F): what to draw, a drag in progress (with the
 * magnifier on it), and the drop. The drop recalibrates through `onDrop`; the library's answer decides, and a refused
 * drop puts the mark back. A press that never moves does nothing.
 */
export function useRulerMarks(ruler: RulerMarks | null, enabled: boolean, onDrop: (r: RulerMarks) => Promise<boolean>) {
  const [drag, setDrag] = useState<MarkDrag | null>(null), [pending, setPending] = useState<RulerMarks | null>(null);
  const dragRef = useRef<MarkDrag | null>(null);
  const rulerRef = useRef(ruler); rulerRef.current = ruler;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  // Fix round 1, M1: what this drag started from — the underlying ruler at the first move, and the base (ruler or a
  // still-pending drop) to apply the drag to. If the underlying ruler changes mid-drag (a ⌘Z/⌘⇧Z replay), the drop
  // on release is no longer dragging THESE marks and must not apply.
  const startedFromRulerRef = useRef<RulerMarks | null>(null);
  const startedBaseRef = useRef<RulerMarks | null>(null);
  const onMove = useCallback((i: 0 | 1, p: Vec2) => {
    if (!dragRef.current) { startedFromRulerRef.current = rulerRef.current; startedBaseRef.current = baseOf(rulerRef.current, pendingRef.current); }
    dragRef.current = { i, p }; setDrag({ i, p });
  }, []);
  const onEnd = useCallback(async () => {
    const d = dragRef.current, base = startedBaseRef.current, rulerAtStart = startedFromRulerRef.current;
    dragRef.current = null; setDrag(null); startedBaseRef.current = null; startedFromRulerRef.current = null;
    const next = dropOf(base, d);
    // Fix round 1, M1: hidden mid-drag (k, ⌘Z, the preview opening), or the marks changed under us — never
    // recalibrate on a drag that no longer matches what is on screen.
    if (!next || !enabledRef.current || rulerRef.current !== rulerAtStart) return;
    setPending(next);
    try { await onDrop(next); } finally { setPending(null); }
  }, [onDrop]);
  const marks = shown(enabled, baseOf(ruler, pending), drag);
  const loupe: Ruler | null = marks && drag ? { centre: drag.p, marks: [marks.p1, marks.p2], active: drag.i, onPress: () => {}, onMove: () => {} } : null;
  // Fix round 1, review M-3: exposed so a − / + press can build on the SAME pending drop this hook is still
  // storing, instead of the stale `ruler` prop underneath it (see `fineTune.ts`'s `pressOn`).
  return { marks, loupe, onMove, onEnd, pending };
}
