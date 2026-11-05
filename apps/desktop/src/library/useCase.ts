import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Vec2 } from '@ceph/geometry';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { detectExtras, detectLandmarks, library, models, quitNow, type DetectedLandmark, type ExtraResult, type ModelPoints, type Box, type Conflict, type FilmLine, type Suggestion, type CaseDoc, type CaseMeta, type Facing, type Gender, type LearnedField, type PatientRef, type RulerMarks } from '../ipc';
import type { DetailField } from './choose';
import type { FilmAge } from './age';
import { allAccepted, initialTracing, replacedOnRedetect, sameRuler, tracingReducer, type Action, type TracingState } from '../tracing/state';
import { checkCalibration } from '../tracing/calibration';
import { autoSignAllowed, autoSignNow, autoSignStillAllowed, holdLine, nextHold, type HoldEvent, type SignHold, type SignOff } from '../tracing/signOff';
import { aiEdit, aiRunOf, detectionAction, pointsOf, hydrateAction, identityFields, toEdit, viaOf } from './persist';
import { createSaver, type SaveStatus } from './saver';
import { serial } from './serial';
import { runRulerStore } from './rulerStore';
import { runAutoSignOff } from './autoSign';
import { flushThenQuit } from './quit';
import { FACING_UNSURE_NOTICE, facingUnsure } from './facing';
import { placeOnFilm, type Placement } from '../ai/placement';
import { SIGN_WAITING, signCheckWords } from '../ai/autoBestWords';
import { firstShown, landingNow, lateArrivals, levelAgain, waitingFor } from './twoStep';
import { extraOutcome } from '../ghosts/ghosts';
import { allEnded, EXTRA_EVENT, modelBars, NO_BARS, type BarState } from '../progress/modelBars';
import { baseScale } from '../tracing/spacing';
import { useForMachineFlow } from './scaleUndo';
import { afterMachineRead } from './machineRead';
import { pressOn } from '../tracing/fineTune';
import { placedByOf, placedViaOf } from '../measurements';

const message = (e: unknown) => (String(e) === 'MODEL_NOT_FOUND' ? 'No model installed: use “Locate model…”.' : String(e));
type DetectMode = 'first' | 'keep' | 'overwrite';
/** The other installed models on this film with the main model's facing; a failed call or an odd answer runs none. */
const runExtraModels = (path: string, facingLeft: boolean, run: number | null = null): Promise<ExtraResult[]> =>
  detectExtras(path, facingLeft, run).then((x) => (Array.isArray(x) ? x : [])).catch(() => []);
/** The text on a film read this session (memory only): its lines with word boxes, learned places and disagreements. */
export interface FilmTextState { lines: FilmLine[]; suggestions: Suggestion[]; conflicts: Conflict[] }
/** What the screen tells the open case (Automatic best, spec §3 and §6): `beforePlacing` runs before a film is traced
 *  (it never fails the tracing); `afterSignOff` after a tracing is signed off; `extraShown(modelId)` is false for a
 *  model whose ghost is off, so its loading bar and error line stay hidden unless a held point waits for it (D2). */
export interface CaseHooks { beforePlacing?: () => Promise<void>; afterSignOff?: () => void; extraShown?: (modelId: string) => boolean;
  /** Owner ruling "Hold sign-off" (Stage A): true while a film note is unresolved, or the check of the film's current run is
   *  not read yet or could not be read (fail closed, whole-branch review I1, I2). Nothing signs the film off meanwhile. */
  signHeld?: () => boolean;
  /** Resolves once the check of the open film's current run has been read (or the read failed). A sign-off waits for it,
   *  then reads `signHeld` again, on the state at that moment (whole-branch review I2). */
  checkSettled?: () => Promise<void> }

/**
 * The open case: loading, automatic detection, autosave and case-level edits (§3.2, decision 14). Point edits still go
 * through the tracing reducer; this hook persists them. `seq` lets a newer open or detection win over a slower, older one.
 */
export function useCase(tracing: TracingState, dispatch: (a: Action) => void, onLibraryChanged: () => void, hooks: CaseHooks = {}) {
  const hooksRef = useRef(hooks); hooksRef.current = hooks;
  /** M4 (owner ruling, 2 Nov): the film, if any, whose tracing found Automatic best's choices unreadable. Set only by a read
   *  whose run is still current; cleared when a run starts, a film opens or the film closes, so the screen's note can only
   *  ever describe the film on screen. */
  const [unreadableFor, setUnreadableFor] = useState<string | null>(null);
  const readSourceFor = (filmId: string, current: () => boolean) => async () => {
    const s = await models.mainPointSource();
    if (current()) setUnreadableFor(s.autoBestUnreadable ? filmId : null);
    return s;
  };
  /** Owner D2: the run whose late points are still to come (0: none); a sign-off asked meanwhile; the models a held
   *  point waits for (their bars and error lines show even with their ghost off). */
  const coming = useRef(0), askedWhileComing = useRef(false), waiting = useRef<Set<string>>(new Set());
  /** Final review I2 (owner, 28 Oct: "Save Aariz's mark"): Aariz's marks for the points still waiting for their model on
   *  a film, so a film you leave (another film, the Library, quit) is saved with them rather than with a point missing. */
  const held = useRef<{ caseId: string; run: number; marks: DetectedLandmark[]; by: Record<string, string>; level: boolean } | null>(null);
  /** Follow-up round (owner, 28 Oct): "Mark verified" pressed while points are coming waits for them (`signWaiting`);
   *  `signWait` is the line the status row shows meanwhile, then the request to check what arrived. */
  const signWaiting = useRef(false);
  const [signWait, setSignWait] = useState<string | null>(null);
  const setVerifiedRef = useRef<(v: boolean, how?: 'button' | 'auto') => Promise<void>>(async () => {});
  const [doc, setDoc] = useState<CaseDoc | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Automatic facing was a near tie for this case: only then is the Faces right / left choice offered (owner, 28 Sep). */
  const [facingUnsureNow, setFacingUnsureNow] = useState(false);
  const [save, setSave] = useState<{ status: SaveStatus; error?: string }>({ status: 'saved' });
  /** Spec 2026-10-19 (V3): why the open tracing waits for "Mark tracing verified" (see tracing/signOff.ts). */
  const [hold, setHoldState] = useState<SignHold>(null), holdRef = useRef<SignHold>(null);
  const hold$ = useCallback((e: HoldEvent | 'clear') => { const h = e === 'clear' ? null : nextHold(holdRef.current, e); holdRef.current = h; setHoldState(h); }, []);
  /** The text on each film read this session, for "Text on the film" (owner, 29 Sep). Memory only: never saved or logged. */
  const [filmTexts, setFilmTexts] = useState<Record<string, FilmTextState>>({});
  const [readingText, setReadingText] = useState(false);
  /** Every model's newest points on the open film (for the ghost marks), and the extra models that failed on it. */
  const [aiPoints, setAiPoints] = useState<ModelPoints[]>([]);
  /** Stage A, whole-branch review I1: a run's check is stored with the run (`library_record_ai`). `checkRev` moves when a
   *  detection starts and again after each run is stored, so the screen re-reads the check AFTER the write; while any
   *  run is still being stored (`recordingN` > 0) the screen treats its copy of the check as not read yet. */
  const recordingN = useRef(0);
  const [checkRev, setCheckRev] = useState(0);
  const checkBusy = useCallback((d: 1 | -1) => { recordingN.current = Math.max(0, recordingN.current + d); setCheckRev((r) => r + 1); }, []);
  const [extraErrors, setExtraErrors] = useState<string[]>([]);
  /** The titles of the extra models that gave no points on this film (errored, timed out or busy): no ghosts for them. */
  const [extraFailed, setExtraFailed] = useState<string[]>([]);
  /** Which model placed each point, per case (Task 7): seeded from the stored `placed_by` (schema 10) and saved with every row. */
  const placedBy = useRef<Record<string, Record<string, string>>>({});
  /** 'auto-best' per point Automatic best placed, per case (format 15): seeded from `placed_via` and saved with every row. */
  const placedVia = useRef<Record<string, Record<string, string>>>({});
  /** The marks the library holds for the open case's scale (spec 2026-10-19, F). */
  const rulerOnDisk = useRef<RulerMarks | null>(null);
  const seq = useRef(0), docRef = useRef(doc), tracingRef = useRef(tracing);
  docRef.current = doc; tracingRef.current = tracing;
  /** Fix round 1, review I-1: `holdForMm` is declared after `refreshIdentity` in this hook, and a ref lets
   *  `refreshIdentity` reach it without reordering every function in between. Reassigned every render. */
  const holdForMmRef = useRef<() => void>(() => {});
  const saver = useMemo(() => createSaver(
    async (e) => {
      const r = await library.save(e);
      setDoc((d) => (d && d.id === e.id ? { ...d, updatedAt: r.updatedAt, verifiedAt: r.verifiedAt, verifiedBy: r.verifiedAt ? d.verifiedBy : null } : d));
    },
    (status, err) => setSave({ status, error: err })), []);

  // Autosave: every change to the open case's points, orientation, display or facing.
  useEffect(() => { if (doc) saver.schedule(toEdit(doc.id, doc.facing, tracing, placedBy.current[doc.id] ?? {}, placedVia.current[doc.id] ?? {})); },
    [tracing.points, tracing.orientation, tracing.display, doc?.id, doc?.facing]);            // eslint-disable-line react-hooks/exhaustive-deps
  /** Final review I2 (owner, 28 Oct): the film being left still has points waiting for their model. Leaving overtakes
   *  its run (R2: the late run is neither drawn nor stored), so Aariz's mark for each such point goes into the film's
   *  own last edit instead: unverified, credited to Aariz, no placed_via. Only where the film is free there (a point
   *  you placed is kept), and never on a signed-off tracing (spec §11). Staged into the saver, not written beside it
   *  (follow-up round): the film is written once, with your last edits and these marks together, and a failed write
   *  is reported and retried as one edit, so neither can overwrite the other. Call it before the leave's flush. */
  const stageHeld = useCallback(() => {
    const h = held.current, d = docRef.current; held.current = null;
    if (!h || !d || d.id !== h.caseId || d.verifiedAt) return;
    const now = tracingRef.current.points, free = h.marks.filter((m) => replacedOnRedetect(now[m.id], false));
    if (!free.length) return;
    const s = tracingReducer(tracingRef.current, { type: 'arrive', landmarks: free, level: h.level });
    const by = { ...(placedBy.current[d.id] ?? {}) }, via = { ...(placedVia.current[d.id] ?? {}) };
    for (const m of free) { by[m.id] = h.by[m.id]; delete via[m.id]; }
    placedBy.current[d.id] = by; placedVia.current[d.id] = via;
    saver.schedule(toEdit(d.id, d.facing, s, by, via));
  }, [saver]);

  // ⌘Q or closing the window: Rust holds the exit until the last edit is written (review #2).
  useEffect(() => {
    let unlisten: (() => void) | undefined, gone = false;
    listen('cephtrace://quit-requested', () => { stageHeld(); void flushThenQuit(saver.flush, quitNow); })
      .then((u) => { if (gone) u(); else unlisten = u; }).catch(() => {});
    return () => { gone = true; unlisten?.(); };
  }, [saver, stageHeld]);

  // Each detection takes a number: a re-detect or another case makes an older run stale, and a stale run is neither
  // drawn nor stored (review I1).
  const extrasSeq = useRef(0);
  const batching = useRef(false);
  // Owner, 16 Oct: a loading bar per model while a film is being traced (the main model, then each extra model as the
  // back end announces it); they fade 3 s after the last one ends. Review I-1: an event counts only for the current
  // run (a batch passes no run, so it shows none; a film opened mid-run ignores the earlier film's events).
  const [bars, barDispatch] = useReducer(modelBars, NO_BARS);
  useEffect(() => {
    let unlisten: (() => void) | undefined, gone = false;
    listen<{ modelId: string; title: string; state: BarState; limitMs: number; run: number | null }>(EXTRA_EVENT, ({ payload }) => {
      const { run, ...bar } = payload;
      if (run !== null && run === extrasSeq.current && (hooksRef.current.extraShown?.(bar.modelId) !== false || waiting.current.has(bar.modelId))) barDispatch({ type: 'extra', ...bar });
    }).then((u) => { if (gone) u(); else unlisten = u; }).catch(() => {});
    return () => { gone = true; unlisten?.(); };
  }, []);
  useEffect(() => { if (!allEnded(bars)) return; const t = setTimeout(() => barDispatch({ type: 'clear' }), 3000); return () => clearTimeout(t); }, [bars]);

  /**
   * The main model, then every other installed model, then one placement under the 2 mm gate (owner rulings R-B1, R-B2,
   * R-B4, 7 Oct): the main model places what it finds and passes; the rest fill the points it lacks. Every model's every
   * channel is still stored, so a point nobody passes shows as a ghost suggestion.
   */
  const detect = useCallback(async (d: CaseDoc, facing: Facing | 'auto', mode: DetectMode, token: number) => {
    setBusy('Detecting landmarks…'); setError(null);
    // I1: from now until the main run is stored, the film's check is not current (released once, in `stored` or `finally`).
    let recording = true; checkBusy(1);
    const stored = () => { if (recording) { recording = false; checkBusy(-1); } };
    const mine = ++extrasSeq.current;
    const current = () => mine === extrasSeq.current && token === seq.current;
    setUnreadableFor(null);   // a new run: the last one's note no longer applies (it comes back only if this run finds the choices unreadable)
    barDispatch({ type: 'start' });
    waiting.current = new Set();
    if (coming.current) askedWhileComing.current = false;   // M9: an overtaken run's sign-off request is stale
    try {
      await hooksRef.current.beforePlacing?.().catch(() => {});   // Automatic best's check (spec §6a); it never fails the tracing
      const r = await detectLandmarks(d.image.path, facing).catch((e) => { if (current()) barDispatch({ type: 'main', state: 'failed' }); throw e; });
      if (current()) barDispatch({ type: 'main', state: 'done' });
      if (!current()) return;
      const turned = r.facingLeft !== (d.facing === 'left');
      // Merge, do not replace: a point the re-detect keeps keeps its placer (and `placed_via`); only replaced points
      // get the new one (schema 10, format 15).
      // `underYours` (late points, final review I1): also the mark under a point you placed by hand while it waited, so
      // ⌘Z of your placement gives it back credited to its model (a hand-placed point never saves a placer, toRow).
      const remember = (placed: Placement, overwrite: boolean, underYours = false) => {
        const by = overwrite ? {} : { ...(placedBy.current[d.id] ?? {}) }, via = overwrite ? {} : { ...(placedVia.current[d.id] ?? {}) };
        for (const [id, m] of Object.entries(placed.source)) {
          const cur = tracingRef.current.points[id];
          if (!replacedOnRedetect(cur, overwrite) && !(underYours && cur?.source === 'manual')) continue;
          by[id] = m; if (placed.via) via[id] = placed.via; else delete via[id];
        }
        placedBy.current[d.id] = by; placedVia.current[d.id] = via;
      };
      // Every extra model's run is stored when it arrives, BEFORE its points land on the film (whole-branch review I1: a
      // late point is never on screen before its run's check is stored); the film's check is not current meanwhile. A
      // run overtaken by another film or a Re-detect never gets here (R2).
      const storeRuns = async (extras: ExtraResult[], fresh: string[] = []) => {
        checkBusy(1);
        try {
          for (const x of extras) if (x.detection) await library.recordAi(d.id, aiRunOf({ ...x.detection, facingLeft: r.facingLeft, meanPeakLeft: null, meanPeakRight: null }), pointsOf(x.detection), fresh);
        } catch { /* the main tracing is unaffected */ }
        finally { checkBusy(-1); }
      };
      // Then each extra model's error line shows only if its ghost is on or a held point waited for it (D2).
      const record = async (extras: ExtraResult[]) => {
        try {
          if (!current()) return;
          const shown = (id: string) => hooksRef.current.extraShown?.(id) !== false || waiting.current.has(id);
          setExtraErrors(extraOutcome(extras.filter((x) => shown(x.modelId))).errors); setExtraFailed(extraOutcome(extras).failed);
          const g = await library.ghosts(d.id);
          if (current()) setAiPoints(g ?? []);
        } catch { /* the main tracing is unaffected */ }
      };
      const facingNow = () => setDoc((x) => (x && x.id === d.id ? { ...x, facing: r.facingLeft ? 'left' : 'right' } : x));
      if (mode === 'overwrite') {                         // Replace all waits for every model, as before (spec §3)
        const extras = await runExtraModels(d.image.path, r.facingLeft, mine);
        if (!current()) return;
        const placed = await placeOnFilm(r, extras, models.points, readSourceFor(d.id, current));
        if (!current()) return;
        remember(placed, true);
        facingNow();
        if (held.current?.caseId === d.id) held.current = null;   // Replace all placed every point
        dispatch(detectionAction(mode, placed.landmarks));
        dispatch({ type: 'autoOrient', mirror: r.facingLeft });
        if (facing === 'auto' && facingUnsure(r)) { setNotice(FACING_UNSURE_NOTICE); setFacingUnsureNow(true); }
        // Re-review N1: every pin is fresh now, but the autosave writes them only later; name them, so the store carries
        // no earlier look to a pin nobody has looked at (whatever the save's timing, or if it fails).
        const fresh = placed.landmarks.map((l) => l.id);
        await library.recordAi(d.id, aiRunOf(r), pointsOf(r), fresh);
        stored();
        await storeRuns(extras, fresh);
        await record(extras);
        return;
      }
      // Owner D2 (Q6 A): Aariz's points at once; the other models in the background; a held point arrives with its model.
      const all = await placeOnFilm(r, [], models.points, readSourceFor(d.id, current));
      const first = firstShown(all);
      if (!current()) return;
      held.current = all.fallback.length ? { caseId: d.id, run: mine, marks: all.landmarks.filter((l) => all.fallback.includes(l.id)),
        by: Object.fromEntries(all.fallback.map((id) => [id, all.source[id]])), level: mode === 'first' } : null;
      remember(first, false);
      facingNow();
      dispatch(detectionAction(mode, first.landmarks));
      if (mode !== 'keep' || turned) dispatch({ type: 'autoOrient', mirror: r.facingLeft });   // a plain re-detect keeps the user's view
      if (facing === 'auto' && facingUnsure(r)) { setNotice(FACING_UNSURE_NOTICE); setFacingUnsureNow(true); }
      setBusy(null);
      waiting.current = waitingFor(first);
      coming.current = mine;
      await library.recordAi(d.id, aiRunOf(r), pointsOf(r));
      stored();
      const extras = await runExtraModels(d.image.path, r.facingLeft, mine);
      if (!current()) return;
      const full = await placeOnFilm(r, extras, models.points, readSourceFor(d.id, current));
      if (!current()) return;
      await storeRuns(extras);
      if (!current()) return;
      if (held.current?.run === mine) held.current = null;   // its points arrive now (or the film is signed off)
      // A signed-off tracing gets no new point (its runs are still stored, below).
      const late = docRef.current?.verifiedAt ? { ...full, landmarks: [] } : lateArrivals(full, first, tracingRef.current.points);
      const landing = landingNow(late, tracingRef.current.points);
      if (late.landmarks.length) {
        remember(late, false, true);
        // Part of the placement, not an action of yours: no ⌘Z step of its own (fix round 1, ruling). A point
        // you placed by hand meanwhile stays; the model's mark goes only under it, into the ⌘Z history (I1).
        dispatch({ type: 'arrive', landmarks: late.landmarks, level: mode === 'first' && levelAgain(landing) });
      }
      coming.current = 0;
      if (signWaiting.current) {                          // Mark verified was pressed while they were coming (owner, 28 Oct)
        signWaiting.current = false; askedWhileComing.current = false;
        // Something new is on the film: never sign it unseen; ask for a check. Nothing new: sign, as the press asked.
        if (landing.length) setSignWait(signCheckWords(landing.map((l) => l.id)));
        else { setSignWait(null); void setVerifiedRef.current(true, 'button'); }
      }
      if (askedWhileComing.current) {                     // asked while points were coming, and nothing came: sign now
        askedWhileComing.current = false;
        if (!landing.length && allAccepted(tracingRef.current.points) && autoSignNow(holdRef.current, false)) void setVerifiedRef.current(true, 'auto');
      }
      await record(extras);
    } catch (e) { if (token === seq.current) setError(message(e)); }
    finally {
      stored();                                           // I1: a run that failed or was overtaken holds nothing
      // A run that ended without its late step (it failed): the press it was holding is dropped, never signed, and so
      // is an automatic sign-off asked meanwhile (ruling, Task 4 concern 1: it must never sign a later run).
      if (coming.current === mine) { coming.current = 0; askedWhileComing.current = false; if (signWaiting.current) { signWaiting.current = false; setSignWait(null); } }
      if (token === seq.current) setBusy(null);
    }
  }, [dispatch, checkBusy]);

  const open = useCallback(async (caseId: string) => {
    const token = ++seq.current;
    stageHeld();                                                              // any point still coming on it (I2), in its last edit
    await saver.flush();                                                      // the previous case's last edit goes to that case
    setError(null); setNotice(null); setFacingUnsureNow(false); setUnreadableFor(null); setBusy('Opening…'); setDoc(null); setBitmap(null); dispatch({ type: 'reset' }); hold$('clear');
    setAiPoints([]); setExtraErrors([]); setExtraFailed([]); extrasSeq.current++; barDispatch({ type: 'clear' });
    coming.current = 0; askedWhileComing.current = false; waiting.current = new Set();   // the last film's late points are stale (R2)
    signWaiting.current = false; setSignWait(null);
    try {
      const d = await library.open(caseId);
      const ruler = await library.ruler(caseId).catch(() => null);   // a failed read shows no marks, never fails the open
      const bmp = await createImageBitmap(await (await fetch(convertFileSrc(d.image.path))).blob());
      if (token !== seq.current) return;
      const h = hydrateAction(d);
      placedBy.current[d.id] = placedByOf(d);
      placedVia.current[d.id] = placedViaOf(d);
      saver.prime(toEdit(d.id, d.facing, tracingReducer(initialTracing, h), placedBy.current[d.id], placedVia.current[d.id]));
      setDoc(d); setBitmap(bmp); dispatch(h); hold$({ kind: 'opened', signed: !!d.verifiedAt, points: h.points }); setBusy(null);
      rulerOnDisk.current = ruler; dispatch({ type: 'setRuler', ruler });
      library.ghosts(d.id).then((g) => { if (token === seq.current) setAiPoints(g ?? []); }).catch(() => {});
      if (!d.landmarks.length) await detect(d, 'auto', 'first', token);
    } catch (e) { if (token === seq.current) { setError(message(e)); setBusy(null); } }
  }, [dispatch, detect, saver, hold$, stageHeld]);

  /**
   * One film opens for tracing; several are imported and traced in the background (board 2). A batch never overwrites a
   * case opened meanwhile (the store checks it is still untraced), and a second batch waits for the first (review #3).
   */
  const [batchRunning, setBatchRunning] = useState(false);
  const importFiles = useCallback(async (paths: string[]): Promise<{ ids: string[]; traced: number }> => {
    if (batching.current) { setNotice('A batch is still being traced; import again when it has finished.'); return { ids: [], traced: 0 }; }
    const ids: string[] = [], failed: string[] = [];
    let existing = false, traced = 0;
    // A batch is under way from the first file: reading labels takes a while, so the Library shows progress and a
    // second batch waits (final review, important 3).
    if (paths.length > 1) { batching.current = true; setBatchRunning(true); }
    for (const [i, p] of paths.entries()) {
      try {
        const im = await library.import(p); ids.push(im.caseId); existing ||= !im.created;
        if (im.created) {                                                   // spec Part 1: after the film is stored, before detection
          if (paths.length === 1) setBusy('Reading the label…'); else setNotice(`Reading label ${i + 1} of ${paths.length}…`);
          const r = await library.readLabel(im.caseId).catch(() => null);   // a failed read fills nothing; import carries on
          if (r) setFilmTexts((t) => ({ ...t, [im.caseId]: { lines: r.lines, suggestions: r.suggestions, conflicts: r.conflicts } }));
        }
      } catch (e) { failed.push(message(e)); }
    }
    setBusy(null);
    if (failed.length) setError(failed.join(' '));
    onLibraryChanged();
    if (paths.length === 1) {
      if (ids[0]) { await open(ids[0]); if (existing) setNotice('This film is already in the library, so its case was opened.'); }
      return { ids, traced: ids.length };
    }
    batching.current = true; setBatchRunning(true);
    try {
      await hooksRef.current.beforePlacing?.().catch(() => {});
      for (const [i, id] of ids.entries()) {
        setNotice(`Tracing ${i + 1} of ${ids.length}…`);
        try {
          const d = await library.open(id);
          if (!d.landmarks.length) {
            const r = await detectLandmarks(d.image.path, 'auto');
            // Every installed model runs first; the saved points are placed under the gate (Task 7).
            const extras = await runExtraModels(d.image.path, r.facingLeft);
            const placed = await placeOnFilm(r, extras, models.points, models.mainPointSource);
            if (await library.saveAiIfUntraced(aiEdit(id, { ...r, landmarks: placed.landmarks }, placed.source, viaOf(placed)))) {
              placedBy.current[id] = placed.source;
              placedVia.current[id] = viaOf(placed);
              await library.recordAi(id, aiRunOf(r), pointsOf(r));
              // Every model's every channel is recorded too; nothing is drawn for a batch.
              for (const x of extras) if (x.detection) await library.recordAi(id, aiRunOf({ ...x.detection, facingLeft: r.facingLeft, meanPeakLeft: null, meanPeakRight: null }), pointsOf(x.detection));
            }
          }
          traced++;
        } catch (e) { failed.push(message(e)); setError(failed.join(' ')); }
        onLibraryChanged();
      }
    } finally { batching.current = false; setBatchRunning(false); setNotice(null); }
    return { ids, traced };
  }, [open, onLibraryChanged]);

  /** Re-detect keeps every point the clinician placed, moved or accepted; "Replace all" asks first (⌘Z undoes it). */
  const redetect = useCallback(async ({ facing, overwrite = false }: { facing?: Facing; overwrite?: boolean }) => {
    const d = docRef.current; if (!d) return;
    if (overwrite) {
      const edited = Object.values(tracingRef.current.points).filter((p) => p.source !== 'ai' || p.verified).length;
      if (edited && !(await ask(`Replace every point with new AI points? ${edited} point${edited === 1 ? '' : 's'} you placed, moved or accepted will be replaced. ⌘Z undoes this.`,
        { title: 'Replace all points', kind: 'warning' }))) return;
    }
    await saver.flush();
    await detect(d, facing ?? 'auto', overwrite ? 'overwrite' : 'keep', seq.current);   // re-checks facing too (fixes cases saved facing the wrong way)
  }, [detect, saver]);

  /** Fix round 1, review I-1: a patient-detail edit can move this film off its fit (the store's `fits::prune`, D-e),
   *  clearing a switched-on film's sign-off the same way calibrating does. `was` (read before the awaited open, so
   *  it is the doc as it stood before this refresh) tells whether that happened; if it did, carry the fresh `fit`
   *  across and hold it (V3), so the next point action does not re-sign it at the stale scale. */
  const refreshIdentity = useCallback(async (id: string) => {
    const was = docRef.current;
    const fresh = await library.open(id);
    const moved = !!(was && was.id === id && was.verifiedAt && !fresh.verifiedAt);
    setDoc((x) => (x && x.id === id ? { ...x, ...identityFields(fresh), fit: fresh.fit ?? null } : x));
    if (moved) holdForMmRef.current();
  }, []);

  /** A confirmed value teaches the film's machine where it is printed (spec 2026-09-29 Part 3); best-effort. */
  const learnValue = useCallback((field: string, value: string | null) => {
    const d = docRef.current; if (!d || !value?.trim()) return;
    void library.learnValue(d.id, field, value).catch(() => {});
  }, []);
  const learnFields = useCallback((m: Pick<CaseMeta, 'patientName' | 'dateOfBirth' | 'takenOn' | 'scanId'>) => {
    learnValue('full', m.patientName); learnValue('dob', m.dateOfBirth); learnValue('film_date', m.takenOn); learnValue('scan_id', m.scanId);
  }, [learnValue]);

  /** Saves the case's details. Each changed detail also teaches the machine, unless the caller already did (Choose mode). */
  const setMeta = useCallback(async (m: CaseMeta, opts: { learn?: boolean } = {}) => {
    const d = docRef.current; if (!d) return;
    try {
      await library.setMeta(d.id, m); await refreshIdentity(d.id); onLibraryChanged();
      if (opts.learn !== false) learnFields({ patientName: m.patientName !== d.patientName ? m.patientName : '', dateOfBirth: m.dateOfBirth !== d.dateOfBirth ? m.dateOfBirth : null,
        takenOn: m.takenOn !== d.takenOn ? m.takenOn : null, scanId: m.scanId !== d.scanId ? m.scanId : null });
    } catch (e) { setError(message(e)); }
  }, [onLibraryChanged, refreshIdentity, learnFields]);

  /** Gender, saved on the patient (spec 2026-10-04). A single-field save (final-review fix round, Important 1) so
   *  it never carries a stale Referrer value back over a Referrer edit landing meanwhile. Taught to the machine
   *  since D2 (owner Q6), like every other detail. */
  const setPatientGender = useCallback(async (g: Gender | null) => {
    const d = docRef.current; if (!d) return;
    try { await library.setPatientGender(d.id, g); await refreshIdentity(d.id); onLibraryChanged(); learnValue('gender', g); }
    catch (e) { setError(message(e)); }
  }, [onLibraryChanged, refreshIdentity, learnValue]);
  /** Background (spec 2026-10-29 §4.1), saved on the patient. A single-field save; never teaches the machine. */
  const setPatientBackground = useCallback(async (b: string | null) => {
    const d = docRef.current; if (!d) return;
    try { await library.setPatientBackground(d.id, b); await refreshIdentity(d.id); onLibraryChanged(); }
    catch (e) { setError(message(e)); }
  }, [onLibraryChanged, refreshIdentity]);
  /** Referring practitioner, saved on the patient (spec 2026-10-04). A single-field save (see `setPatientGender`).
   *  Taught to the machine since D2 (owner Q6): see `setPatientGender`. */
  const setPatientReferrer = useCallback(async (r: string | null) => {
    const d = docRef.current; if (!d) return;
    try { await library.setPatientReferrer(d.id, r); await refreshIdentity(d.id); onLibraryChanged(); learnValue('referrer', r); }
    catch (e) { setError(message(e)); }
  }, [onLibraryChanged, refreshIdentity, learnValue]);
  /** Title, saved on the patient (spec 2026-10-19, owner T1): a single-field save, like Gender. Not taught (R3). */
  const setPatientTitle = useCallback(async (t: string | null) => {
    const d = docRef.current; if (!d) return;
    try { await library.setPatientTitle(d.id, t); await refreshIdentity(d.id); onLibraryChanged(); }
    catch (e) { setError(message(e)); }
  }, [onLibraryChanged, refreshIdentity]);
  /** The age on this film (owner AG1): as printed and in years, or null to clear. A single-field save. Not taught (R3). */
  const setFilmAge = useCallback(async (a: FilmAge | null) => {
    const d = docRef.current; if (!d) return;
    try { await library.setFilmAge(d.id, a?.text ?? null, a?.years ?? null); await refreshIdentity(d.id); }
    catch (e) { setError(message(e)); }
  }, [refreshIdentity]);

  /** Patient ID, X-ray type, X-ray dimensions or Radiography practice (format 11, spec 2026-10-17): a single-field
   *  save, like Gender. Then teaches the machine where it is printed (D-LEARN-1), unless the caller already did
   *  (Choose mode passes learn: false after learnSelection). */
  const setDetail = useCallback(async (field: DetailField, value: string | null, opts: { learn?: boolean } = {}) => {
    const d = docRef.current; if (!d) return;
    const v = value?.trim() || null;
    try {
      if (field === 'patient_id') await library.setPatientId(d.id, v); else await library.setFilmDetail(d.id, field, v);
      await refreshIdentity(d.id); onLibraryChanged();
      if (opts.learn !== false) learnValue(field, v);
    } catch (e) { setError(message(e)); }
  }, [onLibraryChanged, refreshIdentity, learnValue]);

  /** The case's reference population (N6); null = the clinic default. Case header (ruling P26,
   *  Part D task 11): a single-field save, like `setPatientGender`/`setPatientReferrer` above — it never touches
   *  any other saved field, so it can never carry a stale edit back over one landing meanwhile. */
  const setCasePopulation = useCallback(async (p: string | null) => {
    const d = docRef.current; if (!d) return;
    try {
      await library.setCasePopulation(d.id, p);
      setDoc((x) => (x && x.id === d.id ? { ...x, population: p } : x));
      // Spec 2026-10-29 §4.8: the undo and Auto-again change whether the undo is offered; the library says which.
      const fresh = await library.open(d.id);
      setDoc((x) => (x && x.id === d.id ? { ...x, switchedFromClinicDefault: !!fresh.switchedFromClinicDefault } : x));
    }
    catch (e) { setError(message(e)); }
  }, []);

  /** OK on "From the image file" / "Import date". */
  const confirmFilmDate = useCallback(async () => {
    const d = docRef.current; if (!d) return;
    try { await library.confirmFilmDate(d.id); await refreshIdentity(d.id); } catch (e) { setError(message(e)); }
  }, [refreshIdentity]);

  /** OK on what was read also teaches the machine the format-11 details (D-LEARN-1) and, since owner Q6, Gender and
   *  Referring practitioner; a blank one teaches nothing. */
  const learnDetails = useCallback((d: CaseDoc) => {
    learnValue('patient_id', d.printedPatientId); learnValue('xray_type', d.xrayType); learnValue('xray_size', d.xraySize); learnValue('practice', d.radiographyPractice);
    learnValue('gender', d.gender); learnValue('referrer', d.referringPractitioner);
  }, [learnValue]);

  /** Owner Q10: the ✓ beside a "Learned for this machine" mark — keeps the value, drops the mark, teaches the machine. */
  const acceptLearned = useCallback(async (field: LearnedField) => {
    const d = docRef.current; if (!d) return;
    const value: Record<LearnedField, string | null> = { patient_id: d.printedPatientId, xray_type: d.xrayType, xray_size: d.xraySize,
      practice: d.radiographyPractice, gender: d.gender, referrer: d.referringPractitioner };
    try { await library.acceptLearned(d.id, field); await refreshIdentity(d.id); learnValue(field, value[field] ?? null); }
    catch (e) { setError(message(e)); }
  }, [refreshIdentity, learnValue]);

  /** "Not the same" on a Patient ID link suggestion (addendum D2, LIBID-1): remembered for this X-ray and that
   *  patient's Library ID only; never takes the suggestion back from the screen. */
  const notSamePatient = useCallback(async (libraryId: string) => {
    const d = docRef.current; if (!d) return;
    try { await library.notSamePatient(d.id, libraryId); await refreshIdentity(d.id); }
    catch (e) { setError(message(e)); }
  }, [refreshIdentity]);

  /** "Check patient details" answered, or OK on "Read from the film". */
  const confirmIdentity = useCallback(async (sameAs: PatientRef | null) => {
    const d = docRef.current; if (!d) return;
    try {
      await library.confirmIdentity(d.id, sameAs); await refreshIdentity(d.id); onLibraryChanged();
      if (!sameAs) { learnFields(d); learnDetails(d); }                 // OK on what was read: every detail teaches the machine
    } catch (e) { setError(message(e)); }
  }, [onLibraryChanged, refreshIdentity, learnFields, learnDetails]);

  /** Words chosen on the film for a field teach the machine where it is printed. */
  /** `text` is the chosen words, so the back end checks it is learning from the line the clinician saw (M4). */
  const learnSelection = useCallback(async (field: string, line: number, from: number, to: number, text: string) => {
    const d = docRef.current; if (!d) return;
    await library.learnSelection(d.id, field, line, from, to, text).catch(() => {});
  }, []);
  /** Re-reads a small area of the film; what it finds joins the film's text (memory only). */
  const readArea = useCallback(async (rect: Box): Promise<FilmLine[]> => {
    const d = docRef.current; if (!d) return [];
    const found = await library.readArea(d.id, rect);
    setFilmTexts((t) => ({ ...t, [d.id]: { lines: [...(t[d.id]?.lines ?? []), ...found], suggestions: t[d.id]?.suggestions ?? [], conflicts: t[d.id]?.conflicts ?? [] } }));
    return found;
  }, []);

  /** "Read the film again" in Text on the film (and Choose's own first read, `useChoose`). The store matches a film
   *  imported before machines were learned to its machine here, which can give it a machine scale and clear its
   *  Tracing verified (MQ12). Final review I3: so the doc is re-read afterwards, and if the film's mm moved or its
   *  sign-off went, the V3 hold is applied (`holdForMm`) and the screen shows the new scale and the cleared sign-off —
   *  nothing re-signs it automatically. `was` is the doc before the read; a film switched meanwhile is left alone. */
  const readFilmText = useCallback(async () => {
    const d = docRef.current; if (!d) return;
    setReadingText(true);
    try {
      const r = await library.labelText(d.id);
      setFilmTexts((t) => ({ ...t, [d.id]: { lines: r.lines, suggestions: r.suggestions, conflicts: t[d.id]?.conflicts ?? [] } }));
    } catch (e) { setError(`The text on the film could not be read: ${message(e)}`); setReadingText(false); return; }
    try {
      const fresh = await library.open(d.id);
      const now = docRef.current; if (!fresh || !now || now.id !== d.id) return;
      const { patch, hold } = afterMachineRead(d, { ...fresh, scaleSteps: fresh.scaleSteps ?? 0 });
      if (hold) holdForMmRef.current();
      setDoc((x) => (x && x.id === d.id ? { ...x, ...patch } : x));
    } catch (e) { setError(message(e)); }
    finally { setReadingText(false); }
  }, []);

  /** Sign off or reopen. `how`: 'button' (a press: lifts or sets the hold) or 'auto' (V2: as the button, by the current
   *  operator, now — the store still refuses if any point is not accepted). */
  const setVerified = useCallback(async (verified: boolean, how: 'button' | 'auto' = 'button') => {
    const d = docRef.current; if (!d) return;
    const held = () => !!hooksRef.current.signHeld?.();
    if (verified) {                                       // Stage A, whole-branch review I1/I2: the check of the CURRENT run, read
      await hooksRef.current.checkSettled?.();
      if (docRef.current?.id !== d.id) return;            // another film opened meanwhile: this press was for the one left
    }
    if (verified && held()) return;   // "Hold sign-off": every path (bulk accept, the last single accept, the button) goes through here
    // Owner, 28 Oct: a press while points are still coming waits for them, then asks you to check what came.
    if (verified && how === 'button' && coming.current) { signWaiting.current = true; setSignWait(SIGN_WAITING); return; }
    if (!verified || how === 'button') { signWaiting.current = false; setSignWait(null); }
    try {
      if (verified && !(await saver.flush())) {                   // never sign off points that differ from what is on disk
        setError('The latest changes are not saved, so the tracing was not signed off. Use Retry, then try again.'); return;
      }
      if (how === 'auto') {                     // V2 only signs a tracing that is NOT signed off (spec "How it is built")
        // Final review m-2: queued through the SAME serial chain as the ruler stores (`rulerRunRef`), so this can
        // never land in the gap between a ruler drop's `calibrate` IPC and the hold it sets once it lands — it now
        // runs strictly after any ruler store already queued for this film.
        const id = d.id;
        const outcome = await rulerRunRef.current!(() => runAutoSignOff(id, verified, () => docRef.current?.id,
          library, () => allAccepted(tracingRef.current.points), () => autoSignStillAllowed(how, holdRef.current) && coming.current === 0 && !held()));
        if (outcome.kind === 'alreadySignedOrNotReady') {
          setDoc((x) => (x && x.id === id ? { ...x, verifiedAt: outcome.verifiedAt, verifiedBy: outcome.verifiedBy } : x)); return;
        }
        if (outcome.kind !== 'signed') return;   // 'stale' or 'held': nothing more to do
        const fresh = await library.open(id);
        setDoc((x) => (x && x.id === id ? { ...x, verifiedAt: fresh.verifiedAt, verifiedBy: fresh.verifiedBy } : x));
        if (fresh.verifiedAt) setSignWait(null);
        onLibraryChanged();
        hooksRef.current.afterSignOff?.();
        return;
      }
      // Fix round 1, review M-1: a hold can land while the awaits above are in flight (a calibration, a fit's own
      // mm change, a Reopen); re-check it right here, not only once before them. The auto path's own check is
      // above (through the serial chain); this guards only the button path now.
      if (!autoSignStillAllowed(how, holdRef.current)) return;
      if (verified && held()) return;                     // I2: and the film-note hold, on the state after the awaits
      await library.setVerified(d.id, verified);
      const fresh = await library.open(d.id);
      setDoc((x) => (x && x.id === d.id ? { ...x, verifiedAt: fresh.verifiedAt, verifiedBy: fresh.verifiedBy } : x));
      hold$(verified ? { kind: 'signed' } : { kind: 'reopened' });
      onLibraryChanged();
      if (verified) hooksRef.current.afterSignOff?.();
    // The store's own refusals for an automatic attempt stay silent: a point not accepted, or a film note not Checked (I2).
    } catch (e) { if (how === 'auto' && /still unverified|Press Checked on the film note first/.test(String(e))) return; setError(message(e)); }
  }, [saver, onLibraryChanged, hold$]);
  setVerifiedRef.current = setVerified;

  // Spec 2026-10-19 (V2): a point action that left every point accepted (the reducer's `signOffAsk` grew) signs the
  // tracing off, unless it is held (V3). This effect is declared after the autosave effect, so that action's save is
  // already pending; setVerified flushes it first. ⌘Z of the last accept saves a point not accepted, which clears the
  // sign-off in the store: undo carries the sign-off with it, and ⌘⇧Z asks again.
  const asked = useRef(tracing.signOffAsk);
  useEffect(() => {
    const grew = tracing.signOffAsk > asked.current; asked.current = tracing.signOffAsk;
    if (!grew || !docRef.current || !autoSignAllowed(holdRef.current)) return;
    if (coming.current) { askedWhileComing.current = true; return; }   // spec §3: wait for the points still to come
    void setVerified(true, 'auto');
  }, [tracing.signOffAsk]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** The open film's mm changed (a calibration; Task 7 adds a ruler drop and its ⌘Z): the store has cleared the
   *  sign-off; hold it (V3) so nothing re-signs it until the clinician presses the button. Also the hook for G's D-c
   *  rule (its fit never changes `spacing_mm`). */
  const holdForMm = useCallback(() => {
    const d = docRef.current; if (!d) return;
    hold$({ kind: 'mmChanged', wasSigned: !!d.verifiedAt, points: tracingRef.current.points });
    setDoc((x) => (x && x.id === d.id ? { ...x, verifiedAt: null, verifiedBy: null } : x));
    onLibraryChanged();
  }, [hold$, onLibraryChanged]);
  holdForMmRef.current = holdForMm;
  /** A ruler calibration (dialog, drop, or its ⌘Z): the new spacing, then the hold. Fix round 1, review M-4: a
   *  calibration also turns the open film's own "Use the scale from the fit" off (`library.calibrate` — a ruler
   *  always wins), so `fit` is re-read too; otherwise the switch would read on, stale, until the film is reopened.
   *  Fix round 1, M6: by the time this runs, `library.calibrate` already succeeded — the new mm is TAKEN, on disk,
   *  whether or not this re-read works. So `spacingMm` is set unconditionally first; a failure to re-read `fit`
   *  afterwards is reported, never rolled back, so the screen never falls back to a stale mm while the disk holds
   *  the new one. */
  /** Final review I-1: `id` is the film this change belongs to, captured by `storeRuler` when it was CALLED, not
   *  read from `docRef` here — by the time this runs the open film may already have switched. Guarded again after
   *  its own await (`library.open`), which can itself outlast a second switch. A mismatch here must touch neither
   *  the doc nor the hold: `holdForMm` reads `docRef.current` too, so it is only safe to call once the id matches. */
  const afterMmChange = useCallback(async (id: string, spacingMm: number, scaleSteps = 0) => {
    if (docRef.current?.id !== id) return;
    holdForMm();
    setDoc((x) => (x && x.id === id ? { ...x, spacingMm, scaleSteps, verifiedAt: null, verifiedBy: null } : x));
    try {
      const fresh = await library.open(id);
      if (docRef.current?.id !== id) return;
      setDoc((x) => (x && x.id === id ? { ...x, fit: fresh.fit ?? null } : x));
    } catch (e) { setError(message(e)); }
  }, [holdForMm]);

  /** Ruler stores run one at a time, in order (a quick ⌘Z ⌘Z must leave the library on the marks on screen). Fix
   *  round 1, M4: the ordering is `serial()` (`library/serial.ts`), proved by a unit test with hand-resolved
   *  deferreds — the e2e17 "burst" smoke (I5) cannot prove it (the fake library resolves synchronously, in call
   *  order, whether or not anything serialises the calls). */
  const rulerRunRef = useRef<ReturnType<typeof serial> | null>(null);
  if (!rulerRunRef.current) rulerRunRef.current = serial();
  /** Final review m-1: how many ruler stores (queued or in flight) have not yet landed. ⌘Z / ⌘⇧Z while this is
   *  true would otherwise commit a snapshot ahead of a store that is about to overwrite it on screen (App's key
   *  handler and Toolbar's Undo button both read it, via `rulerPending`). */
  const rulerPendingRef = useRef(0);
  const [rulerPending, setRulerPending] = useState(false);
  const bumpRulerPending = (by: 1 | -1) => { rulerPendingRef.current += by; setRulerPending(rulerPendingRef.current > 0); };
  /** Final review I-1: the film is captured HERE, when `storeRuler` is called — by a press, a drop, the dialog, or
   *  the ⌘Z/⌘⇧Z replay effect below — never read inside the queued job, where it could already be a different
   *  film by the time the job runs or its IPC call returns. `runRulerStore` (`library/rulerStore.ts`) carries that
   *  id through both checks; this function only decides what id to carry. */
  const storeRuler = useCallback((r: RulerMarks): Promise<boolean> => {
    const id = docRef.current?.id;
    if (!id) return Promise.resolve(false);
    bumpRulerPending(1);
    return rulerRunRef.current!(() => runRulerStore(id, r, () => docRef.current?.id, library, async (spacingMm) => {
      rulerOnDisk.current = r; await afterMmChange(id, spacingMm, r.steps);   // fix round 1, M-1: restores Task 7's M-4/M-6 ordering
    })).finally(() => bumpRulerPending(-1));
  }, [afterMmChange]);
  /** Ruler calibration from the dialog (decision 17): a new baseline for the marks, not an undo step. Throws the
   *  library's reason. */
  const calibrate = useCallback(async (p1: Vec2, p2: Vec2, mm: number) => {
    const r = { p1, p2, mm, steps: 0 };
    if (await storeRuler(r)) dispatch({ type: 'setRuler', ruler: r });
  }, [storeRuler, dispatch]);
  /** A dropped ruler mark (spec 2026-10-19, R1): the same checks as a fresh calibration, recalibrated at once, one ⌘Z
   *  step. A refusal says why (the dialog's own words) and keeps the old calibration; returns whether it was taken. */
  const moveRuler = useCallback(async (r: RulerMarks): Promise<boolean> => {
    const check = checkCalibration(r.p1, r.p2, r.mm);
    if (!check.ok) { setError(check.error); return false; }
    try { if (!(await storeRuler(r))) return false; dispatch({ type: 'moveRuler', ruler: r }); return true; }
    catch (e) { setError(message(e)); return false; }
  }, [storeRuler, dispatch]);
  const [adjusting, setAdjusting] = useState(false), adjustingRef = useRef(false);
  /** Spec 2026-10-19 Addendum 3: one press of − / +: the same marks and mm, one press more or less (±5 % at most),
   *  stored at once as a recalibration (clears the sign-off and holds it, V3), one ⌘Z step. A press while the last is
   *  still being stored is not taken: the buttons are disabled until it lands.
   *  Fix round 1, review M-3: `pending` is `useRulerMarks`'s own in-flight drop, if any — the press builds on THAT
   *  (via `pressOn`), never on the stale `tracing.ruler` underneath it, so a press queued behind a drop cannot land
   *  last and revert it. Returns whether the library took it. */
  const adjustScale = useCallback(async (d: 1 | -1, pending: RulerMarks | null = null): Promise<boolean> => {
    if (adjustingRef.current) return false;
    const next = pressOn(tracingRef.current.ruler, pending, d);
    if (!next) return false;
    adjustingRef.current = true; setAdjusting(true);
    try {
      if (!(await storeRuler(next))) return false;
      dispatch({ type: 'moveRuler', ruler: next });
      return true;
    } catch (e) { setError(message(e)); return false; }
    finally { adjustingRef.current = false; setAdjusting(false); }
  }, [storeRuler, dispatch]);
  // ⌘Z / ⌘⇧Z across a ruler drop puts the marks back on screen; this puts the library's scale back with them.
  // A drop and the dialog store first and set `rulerOnDisk`, so they never come through here.
  useEffect(() => {
    const r = tracing.ruler;
    if (!r || !docRef.current || sameRuler(r, rulerOnDisk.current)) return;
    storeRuler(r).catch((e) => setError(message(e)));
  }, [tracing.ruler]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Owner G2: "Use the scale from the fit" for the open film. A real change clears Tracing verified in the store
   *  (plan D-c, G's `set_fit_own`); hold it (V3) via `holdForMm`, never `afterMmChange` (a fit never touches
   *  `cases.spacing_mm`, so storing its number through `afterMmChange` would read on screen as "calibrated scale").
   *  A ruler always wins: a film with its own ruler is never sent (the library refuses it too), and the screen offers
   *  no switch there. */
  const setFitOwn = useCallback(async (on: boolean) => {
    const d = docRef.current; if (!d) return;
    const b = baseScale(d);
    if (b.source !== 'assumed') { setError(b.source === 'machine' ? "This film has its machine's calibrated scale, so it keeps it." : 'This film has its own ruler, so it keeps its own scale.'); return; }
    try {
      await library.setFitOwn(d.id, on);
      const fresh = await library.open(d.id);
      if (fresh.verifiedAt) { setDoc((x) => (x && x.id === d.id ? { ...x, fit: fresh.fit ?? null, verifiedAt: fresh.verifiedAt, verifiedBy: fresh.verifiedBy } : x)); onLibraryChanged(); }
      else { setDoc((x) => (x && x.id === d.id ? { ...x, fit: fresh.fit ?? null } : x)); holdForMm(); }
    } catch (e) { setError(message(e)); }
  }, [onLibraryChanged, holdForMm]);

  /** Spec 2026-10-20 (MS6): "Use for this machine" — the open film's own ruler and size become its machine's
   *  calibrated scale (MS3's `machine_scale_from_film`), after the same count-first warning as Film layouts'
   *  Enter scale… (MS4), and recorded for Film layouts' Undo like any other scale write (final review I4). Not held
   *  via `holdForMm`: the open film has its own ruler, so its mm never move; other films' Tracing verified is
   *  cleared by the store itself. */
  const useForMachine = useCallback(async () => {
    const d = docRef.current; if (!d) return;
    try {
      if ((await useForMachineFlow(library, ask, d.id)) === 'cancelled') return;
      const fresh = await library.open(d.id);
      setDoc((x) => (x && x.id === d.id ? { ...x, machineScale: fresh.machineScale ?? null } : x));
      onLibraryChanged();
    } catch (e) { setError(message(e)); }
  }, [onLibraryChanged]);

  const close = useCallback(async () => {
    seq.current++; stageHeld(); await saver.flush();   // overtake the run first, so no late point lands while it saves
    signWaiting.current = false; setSignWait(null);
    setUnreadableFor(null); setDoc(null); setBitmap(null); setBusy(null); setError(null); setNotice(null); dispatch({ type: 'reset' }); hold$('clear');
    onLibraryChanged();
  }, [saver, dispatch, onLibraryChanged, hold$, stageHeld]);

  const filmText = doc ? filmTexts[doc.id] ?? null : null;
  /** Spec 2026-10-19 (V1/V3): the sign-off for the status row, with why it is held if it is. */
  const signOff = useMemo<SignOff | null>(() => (doc ? { verifiedAt: doc.verifiedAt, verifiedBy: doc.verifiedBy, holdLine: signWait ?? holdLine(hold), busy: !!busy,
    onSign: () => void setVerified(true), onReopen: () => void setVerified(false) } : null),
    [!!doc, doc?.verifiedAt, doc?.verifiedBy, busy, setVerified, hold, signWait]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { checkRev, checkRecording: recordingN.current > 0, doc, bitmap, unreadableFor, busy, modelBars: bars, error, setError, notice, facingUnsure: facingUnsureNow, save, retrySave: saver.flush, batchRunning, open, importFiles, redetect, setMeta, setPatientGender, setPatientBackground, setPatientReferrer, setPatientTitle, setFilmAge, setDetail, acceptLearned, learnValue, setCasePopulation, setFitOwn, useForMachine, confirmIdentity, notSamePatient, confirmFilmDate, filmText, readingText, readFilmText, learnSelection, readArea, setVerified, calibrate, moveRuler, adjustScale, adjusting, rulerPending, close, aiPoints, extraErrors, extraFailed, signOff,
    /** Which model placed each AI point on the open film this session (memory only; Part D). */
    placedBy: doc ? placedBy.current[doc.id] ?? null : null,
    /** 'auto-best' per point Automatic best placed on the open film this session (memory only; format 15). */
    placedVia: doc ? placedVia.current[doc.id] ?? null : null };
}
export type CaseApi = ReturnType<typeof useCase>;
