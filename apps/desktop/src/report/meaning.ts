import { meaningPhrase, type Severity } from '@ceph/analyses';

/** The report's Meaning cell, before any change for this film (spec 2026-10-17 report-exports; SEVERITY-2,
 *  MEANING-APPROVE): the screen's own phrase ("Mild Class II", "Class II tendency"), from the clinician's words or the
 *  approved ones; "Within normal range" within 0.75 SD; for a measurement with no words (or a blank side) the severity
 *  word and its side ("Mild, above the norm"). Empty with no value shown or no usable SD — no stars, no colour. */
export function reportMeaning(sev: Severity | null, words: { high: string; low: string } | undefined): string {
  if (!sev) return '';
  if (sev.word === 'within normal range') return 'Within normal range';
  const phrase = meaningPhrase(sev, words);
  if (phrase) return phrase;
  return `${sev.word === 'tendency' ? 'Tendency' : sev.word}, ${sev.side} the norm`;
}
