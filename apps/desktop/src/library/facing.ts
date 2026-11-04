import type { DetectResult } from '../ipc';

/** Passes closer than this (relative to the larger mean peak) are too close to call (spec decision 14). */
export const FACING_MARGIN = 0.1;

/** True when automatic facing was a near tie, so the clinician should confirm "Faces right / Faces left". */
export function facingUnsure(r: DetectResult): boolean {
  const a = r.meanPeakRight, b = r.meanPeakLeft;           // mean raw heatmap peaks of the two passes
  if (a === null || b === null) return false;                                 // one facing was chosen by the user
  const top = Math.max(a, b);
  return top <= 0 || Math.abs(a - b) / top < FACING_MARGIN;
}
export const FACING_UNSURE_NOTICE = 'Not sure which way the patient faces. If the points look wrong, choose Faces right or Faces left below.';
