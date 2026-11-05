import type { RulerMarks } from '../ipc';
import { MAX_SCALE_STEPS, type Scale } from './spacing';

/** What the − / + beside the scale line need (spec 2026-10-19 Addendum 3). */
export interface FineTune { steps: number; canDown: boolean; canUp: boolean; onStep: (d: 1 | -1) => void }
/**
 * The control, or null when there is none: only a film whose scale is its own ruler has one (no calibration, the
 * assumed scale, or a fit's scale (G) has nothing to fine-tune). `editable` is false on the read-only page, while the
 * report preview is open, while busy or calibrating, and while a press is being stored: both buttons then show but
 * are disabled. At ±5 % the button that would pass the limit is disabled.
 */
export function fineTuneOf(ruler: RulerMarks | null, scale: Scale, editable: boolean, onStep: (d: 1 | -1) => void): FineTune | null {
  if (!ruler || scale.source !== 'calibration') return null;
  return { steps: ruler.steps, canDown: editable && ruler.steps > -MAX_SCALE_STEPS, canUp: editable && ruler.steps < MAX_SCALE_STEPS, onStep };
}
/**
 * Fix round 1, review M-3: what a − / + press should build on — a ruler-mark drop that is still being stored
 * (`useRulerMarks`'s `pending`, the same idea as Task 8's M-2 `baseOf`), never the stale marks still sitting in
 * `tracing.ruler` while that drop is in flight. Without this, a press queued behind an in-flight drop would carry
 * the OLD marks and k + d, land last (the serial chain), and silently revert the drop on both disk and screen.
 * Returns null when there is nothing to press, or the limit (±5 %) would be passed.
 */
export function pressOn(ruler: RulerMarks | null, pending: RulerMarks | null, d: 1 | -1): RulerMarks | null {
  const base = pending ?? ruler;
  if (!base || Math.abs(base.steps + d) > MAX_SCALE_STEPS) return null;
  return { ...base, steps: base.steps + d };
}
