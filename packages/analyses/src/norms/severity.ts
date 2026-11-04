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
