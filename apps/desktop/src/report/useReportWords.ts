import { useCallback, useEffect, useRef, useState } from 'react';
import { settings } from '../ipc';
import { readWords, resetWord, saveWord, type ReportWords } from './words';

/** Owner R2: the open film's changed words, read each time the preview opens (`caseId` null while it is closed). The
 *  Meaning boxes wait for the read (`ready`), so a change can never be overwritten by a late read.
 *  `flush` (Task 9): waits for the last save in flight and returns the words AS SAVED, so a word typed and then
 *  Save PDF…/Export CSV… pressed straight away is in the file (the save started on blur races the export).
 *  Task 9 review I3: `latest`/`pending` are plain refs, shared by every film this ONE hook instance is ever asked
 *  about (its caller, `useReport`, keeps a single instance for the app's whole lifetime). Without `activeCase`,
 *  a read or a save that lands for a film which is no longer open would still overwrite `latest.current` — so
 *  `flush()`, called for the film now open, could hand back the PREVIOUS film's words (confirmed by a probe: film
 *  A's save landing after film B's preview had already opened leaked A's words into B's `flush()`). `activeCase`
 *  is updated on every render (not inside an effect, so it is always in sync with the latest `caseId` by the time
 *  any of these async callbacks checks it); a write for a case that is no longer active is dropped, and `flush`
 *  itself fails rather than ever returning a different film's words. */
export function useReportWords(caseId: string | null) {
  const [st, setSt] = useState<{ caseId: string | null; words: ReportWords; ready: boolean; error: string | null }>({ caseId: null, words: {}, ready: false, error: null });
  const latest = useRef<ReportWords>({}), pending = useRef<Promise<unknown>>(Promise.resolve());
  const activeCase = useRef(caseId);
  activeCase.current = caseId;
  // Final review Minor 2: the last save's own failure, if any, for the case it was FOR — not a flag on `st` alone,
  // because `st.error` is cleared the moment a different case's read lands (the effect below), while `flush()`
  // needs to know, for THIS case specifically, whether the words it is about to hand to an export are the ones
  // that actually reached disk.
  const failedFor = useRef<{ caseId: string | null; message: string } | null>(null);
  useEffect(() => {
    setSt({ caseId, words: {}, ready: false, error: null });
    latest.current = {};
    failedFor.current = null;
    if (!caseId) return;
    let gone = false;
    void readWords(settings, caseId).then((r) => {
      if (gone) return;   // a later caseId has already superseded this read — never let a stale read touch `latest`
      latest.current = r.value;
      setSt({ caseId, words: r.value, ready: true, error: r.error });
    });
    return () => { gone = true; };
  }, [caseId]);
  const run = useCallback((p: Promise<ReportWords>) => {
    pending.current = p.then((w) => {
      // Never let a stale case's save pollute `latest`, or clear a failure recorded for the case now open.
      if (activeCase.current === caseId) { latest.current = w; failedFor.current = null; }
      setSt((s) => (s.caseId === caseId ? { ...s, words: w, error: null } : s));
    }).catch((e) => {
      // Final review Minor 2: a failed save for a typed word must not let the export go on to say "saved" while
      // quietly using the OLD (usual) words instead — record the failure against the case it was for, so flush()
      // (below) can refuse rather than hand back words that never reached disk. And never show a stale film's
      // failure on the next film's banner: both the recorded failure and the on-screen error are scoped to the
      // case that was open when the save was started (`caseId`, this closure's own case — the save belongs to it
      // regardless of which case is open NOW), not to whichever case happens to be open when the promise settles.
      const message = `Your words could not be saved (${e instanceof Error ? e.message : String(e)}).`;
      if (activeCase.current === caseId) failedFor.current = { caseId, message };
      setSt((s) => (s.caseId === caseId ? { ...s, error: message } : s));
    });
  }, [caseId]);
  // Resolves to THIS case's words, or fails — never another case's, and never words a failed save never actually
  // wrote. If the open film has moved on by the time the pending save settles, or the last save for this case
  // failed, that is a genuine failure to report (the export did not run for the film it was asked for, or ran on
  // words still only on screen), never a silent wrong-patient or silently-stale result.
  const flush = useCallback(async () => {
    await pending.current;
    if (activeCase.current !== caseId) throw new Error('the open film changed before your words could be saved; try again');
    if (failedFor.current?.caseId === caseId) throw new Error(failedFor.current.message);
    return latest.current;
  }, [caseId]);
  const save = useCallback((key: string, text: string, was: string) => { if (caseId) run(saveWord(settings, caseId, key, text, was)); }, [caseId, run]);
  const reset = useCallback((key: string) => { if (caseId) run(resetWord(settings, caseId, key)); }, [caseId, run]);
  const mine = st.caseId === caseId && caseId !== null;
  return { words: mine ? st.words : {}, ready: mine && st.ready, error: mine ? st.error : null, save, reset, flush };
}
