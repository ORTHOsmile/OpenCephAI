import type { Severity } from './severity';

/** SEVERITY-2 + MEANING-APPROVE (16 Oct 2026): the phrase for a value — the severity word with the clinician's (or the
 *  approved default) term for its side of the mean: "Mild Class II", "Moderate …", "Severe …", "Class II tendency".
 *  Within 0.75 SD, with no severity, or with no term: no phrase. */
export function meaningPhrase(sev: Severity | null, words: { high: string; low: string } | undefined): string | null {
  if (!sev || !words || sev.word === 'within normal range') return null;
  const term = (sev.side === 'above' ? words.high : words.low).trim();
  if (!term) return null;
  return sev.word === 'tendency' ? `${term} tendency` : `${sev.word} ${term}`;
}
