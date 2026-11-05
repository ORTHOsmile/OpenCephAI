import { useCallback, useEffect, useRef, useState } from 'react';
import { models, type AutoBestEvent, type IntroNote } from '../ipc';

/** Final review I3 (spec §6a): after an Undo at a point (from its note or from Models…), every note at that point is out
 *  of date and goes; an adoption the Undo handed the point to (a second model) is a change like any other: its note.
 *  `on`: whether Automatic best is the main model now; as for sync(), no new note while it is not (follow-up round). */
export function notesAfterUndo(notes: AutoBestEvent[], undone: AutoBestEvent, rows: AutoBestEvent[], on: boolean): AutoBestEvent[] {
  return [...notes.filter((x) => x.landmarkId !== undone.landmarkId), ...(on ? rows.filter((r) => r.kind === 'adopted') : [])];
}

/** The first-open step (spec §6b). If it fails, the screen says so once (spec 2026-10-29 §11, path b: before, only the
 *  console did), and it is tried again at the next open. Never throws. */
export function runIntro(intro: () => Promise<IntroNote | null>, setIntro: (n: IntroNote) => void, setError: (e: string) => void): Promise<void> {
  return intro().then((n) => { if (n) setIntro(n); }).catch((e) => {
    console.warn(`Automatic best's first-open step did not run: ${String(e)}`);
    setError(`Automatic best could not be switched on: ${String(e)}. It will try again the next time you open the app.`);
  });
}

/** Leftovers Task 4 (M1): the check before a tracing, after the first-open step. That step carries the owner's Part F
 *  declines; a film traced in the first second after launch must not let the check record an adoption first. `ready`
 *  never rejects (runIntro catches), so a failed step still lets the check run. No Automatic best yet: nothing to do. */
export function beforePlacingOf(ab: { ready: Promise<void>; sync: () => Promise<void> } | null): Promise<void> {
  return ab ? ab.ready.then(ab.sync) : Promise.resolve();
}

/** Automatic best on screen (spec §6a, §6b): the once-per-library upgrade, the check that records verdict changes, and
 *  the notes with Undo. `onChanged` re-reads what depends on its map (the labels, the ghost, Models…). Never blocks
 *  tracing: a failure is logged or shown, never thrown. */
export function useAutoBest(onChanged: () => void) {
  const [notes, setNotes] = useState<AutoBestEvent[]>([]);
  const [intro, setIntro] = useState<IntroNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(onChanged); changed.current = onChanged;
  const [ready] = useState<Promise<void>>(() => runIntro(models.autoBestIntro, setIntro, setError));
  const sync = useCallback(async () => {
    try {
      const r = await models.autoBestSync();
      const shown = r?.on ? (r.events ?? []).filter((e) => e.kind === 'adopted' || e.kind === 'returned') : [];
      if (shown.length) setNotes((n) => [...n.filter((x) => !shown.some((s) => s.landmarkId === x.landmarkId)), ...shown]);
      if (r?.events?.length) changed.current();
    } catch (e) { console.warn(`Automatic best's check did not run: ${String(e)}`); }
  }, []);
  useEffect(() => { void ready.then(sync).then(() => changed.current()); }, [ready, sync]);
  /** An Undo pressed in Models… (final review I3): the notes here follow it. */
  const undone = useCallback(async (e: AutoBestEvent, rows: AutoBestEvent[]) => {
    const on = await models.autoBest().then((m) => !!m?.on).catch(() => false);   // as sync(): notes only while it is main
    setNotes((n) => notesAfterUndo(n, e, rows, on)); changed.current();
  }, []);
  const undo = useCallback(async (e: AutoBestEvent) => {
    try { const rows = await models.autoBestUndo(e.landmarkId, e.id); setError(null); await undone(e, rows); }
    catch (err) { setError(`That Undo was not saved: ${String(err)}`); }
  }, [undone]);
  const dismiss = useCallback((id: number) => setNotes((n) => n.filter((x) => x.id !== id)), []);
  const wayBack = useCallback(async () => {
    try { await models.autoBestWayBack(); setIntro(null); setError(null); changed.current(); }
    catch (err) { setError(`Going back was not saved: ${String(err)}`); }
  }, []);
  const closeIntro = useCallback(() => setIntro(null), []);
  /** Leftovers Task 3 (M2): the first-open step again, then the check. Called when an install ends Ready, so installing
   *  the base mid-session switches Automatic best on with its note at once (until the step has run on a library with
   *  films, Automatic best is off). Once the step has run this writes nothing and shows no second note. Never throws. */
  const reintro = useCallback(async () => {
    await runIntro(models.autoBestIntro, setIntro, setError);
    await sync();
    changed.current();
  }, [sync]);
  return { notes, intro, error, ready, sync, undo, undone, dismiss, wayBack, closeIntro, reintro };
}
