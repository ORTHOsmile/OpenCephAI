/** Owner SEVERITY-1/2 (16 Oct 2026): stars and the word for how far a value sits from its norm, in whole SDs, from the
 *  same z the colours use (`zScore`). Exactly 1, 2 or 3 SD stay in the lower band, as `band` does; 'tendency' is from
 *  0.75 SD up to 1 SD (still green, no star). Meaning in plain words: docs/norms/SEVERITY.md. */
export interface Severity {
  stars: '' | '*' | '**' | '***';
  word: 'within normal range' | 'tendency' | 'Mild' | 'Moderate' | 'Severe';
  side: 'above' | 'below';
}
export function severity(z: number | null): Severity | null {
  if (z === null || !Number.isFinite(z)) return null;
  const a = Math.abs(z), side = z < 0 ? 'below' : 'above';
  if (a > 3) return { stars: '***', word: 'Severe', side };
  if (a > 2) return { stars: '**', word: 'Moderate', side };
  if (a > 1) return { stars: '*', word: 'Mild', side };
  if (a >= 0.75) return { stars: '', word: 'tendency', side };
  return { stars: '', word: 'within normal range', side };
}

/** Stage A task 9 (spec §14.4, owner-approved): a measurement 4 SD or more from its norm (either side) carries this note.
 *  It is a note on the MEASUREMENT only: it never moves or flags a point and is separate from the point check (§14.3). */
export const EXTREME_NOTE = 'Extreme value for the norm';
export const EXTREME_SD = 4;
/** Same z as the colours and stars (`zScore`). Inclusive: exactly 4.0 or -4.0 is extreme. No z (no norm, no SD, NaN) is not. */
export function extremeForNorm(z: number | null | undefined): boolean {
  return z !== null && z !== undefined && Number.isFinite(z) && Math.abs(z) >= EXTREME_SD;
}
