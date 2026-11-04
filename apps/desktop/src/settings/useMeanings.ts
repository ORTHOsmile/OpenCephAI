import { useCallback, useEffect, useRef, useState } from 'react';
import { operators, settings } from '../ipc';
import { clinicianSteps, readOverrides, settleClinicianSteps, wordsFor, type Overrides, type SeqGuard } from './meanings';

/** Fired whenever the current clinician changes (the top-bar picker, or Library ▸ Settings), so the meanings follow. */
export const CLINICIAN_EVENT = 'opencephai:clinician';
export const announceClinician = () => window.dispatchEvent(new Event(CLINICIAN_EVENT));

/** MEANING-PER-CLINICIAN + NOCLIN-2 (ruling, 17 Oct 2026, item 34): whose words are USED in the
 *  measurement lines, and whose words Settings › Meanings EDITS, are no longer always the same clinician.
 *  `referrer` is the open film's Referring practitioner (or null — no film open, or the field is blank); pass
 *  `kase.doc?.referringPractitioner ?? null` and this re-resolves whenever the open film changes.
 *  - `clinician`/`overrides`: the top-bar-or-login identity (NOCLIN-1) — what Settings › Meanings always edits,
 *    never the referrer's, so nobody edits another person's words by accident.
 *  - `words`/`referrerNote`: the full NOCLIN-2 order (top bar, else a worded referrer, else the login name) — what
 *    the measurement lines actually show, and the one-line note Settings › Meanings shows when the two differ.
 *  `refresh` re-reads after Settings › Meanings saves. */
export function useMeanings(referrer: string | null = null) {
  const [clinician, setClinician] = useState('');
  const [overrides, setOverrides] = useState<Overrides>({});
  const [effective, setEffective] = useState<{ overrides: Overrides; referrerNote: string | null }>({ overrides: {}, referrerNote: null });
  // Review M-2 + fix round 1 I2: only the latest refresh may set the clinician and their words (never a mix) — a
  // slower, earlier resolve (an older film's) must never land after, and overwrite, a later one's. `guard` is the
  // same SeqGuard object `settleClinicianSteps` checks below, not a second copy of the idea.
  const guard = useRef<SeqGuard>({ current: 0 });
  const refresh = useCallback(() => {
    const mine = ++guard.current.current;
    (async () => {
      const [ops, explicit] = await Promise.all([operators.list(), settings.get('operator')]);
      const editWords = await readOverrides(settings, ops.current);
      if (guard.current.current !== mine) return;
      setClinician(ops.current); setOverrides(editWords);
      await settleClinicianSteps(settings, guard.current, mine, clinicianSteps(explicit, ops.current, referrer, ops.names), (r) => {
        setEffective({ overrides: r.overrides, referrerNote: r.fromReferrer ? `This film shows ${r.clinician}'s words (the referring practitioner).` : null });
      });
    })().catch(() => {});
  }, [referrer]);
  useEffect(() => { refresh(); window.addEventListener(CLINICIAN_EVENT, refresh); return () => window.removeEventListener(CLINICIAN_EVENT, refresh); }, [refresh]);
  const words = useCallback((id: string) => wordsFor(id, effective.overrides), [effective.overrides]);
  return { clinician, overrides, words, refresh, referrerNote: effective.referrerNote };
}
