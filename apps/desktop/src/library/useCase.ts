import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Vec2 } from '@ceph/geometry';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { detectExtras, detectLandmarks, library, models, quitNow, type ExtraResult, type ModelPoints, type Box, type Conflict, type FilmLine, type Suggestion, type CaseDoc, type CaseMeta, type Facing, type Gender, type LearnedField, type PatientRef } from '../ipc';
import type { DetailField } from './choose';
import { initialTracing, replacedOnRedetect, tracingReducer, type Action, type TracingState } from '../tracing/state';
import { aiEdit, aiRunOf, detectionAction, pointsOf, hydrateAction, identityFields, toEdit } from './persist';
import { createSaver, type SaveStatus } from './saver';
import { flushThenQuit } from './quit';
import { FACING_UNSURE_NOTICE, facingUnsure } from './facing';
import { placeOnFilm } from '../ai/placement';
import { extraOutcome } from '../ghosts/ghosts';
import { allEnded, EXTRA_EVENT, modelBars, NO_BARS, type BarState } from '../progress/modelBars';

const message = (e: unknown) => (String(e) === 'MODEL_NOT_FOUND' ? 'No model installed: use “Locate model…”.' : String(e));
type DetectMode = 'first' | 'keep' | 'overwrite';
/** The other installed models on this film with the main model's facing; a failed call or an odd answer runs none. */
const runExtraModels = (path: string, facingLeft: boolean, run: number | null = null): Promise<ExtraResult[]> =>
  detectExtras(path, facingLeft, run).then((x) => (Array.isArray(x) ? x : [])).catch(() => []);
/** The text on a film read this session (memory only): its lines with word boxes, learned places and disagreements. */
export interface FilmTextState { lines: FilmLine[]; suggestions: Suggestion[]; conflicts: Conflict[] }

/**
 * The open case: loading, automatic detection, autosave and case-level edits (§3.2, decision 14). Point edits still go
 * through the tracing reducer; this hook persists them. `seq` lets a newer open or detection win over a slower, older one.
 */
export function useCase(tracing: TracingState, dispatch: (a: Action) => void, onLibraryChanged: () => void) {
  const [doc, setDoc] = useState<CaseDoc | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Automatic facing was a near tie for this case: only then is the Faces right / left choice offered (owner, 28 Sep). */
  const [facingUnsureNow, setFacingUnsureNow] = useState(false);
  const [save, setSave] = useState<{ status: SaveStatus; error?: string }>({ status: 'saved' });
  /** The text on each film read this session, for "Text on the film" (owner, 29 Sep). Memory only: never saved or logged. */
  const [filmTexts, setFilmTexts] = useState<Record<string, FilmTextState>>({});
  const [readingText, setReadingText] = useState(false);
  /** Every model's newest points on the open film (for the ghost marks), and the extra models that failed on it. */
  const [aiPoints, setAiPoints] = useState<ModelPoints[]>([]);
  const [extraErrors, setExtraErrors] = useState<string[]>([]);
  /** The titles of the extra models that gave no points on this film (errored, timed out or busy): no ghosts for them. */
  const [extraFailed, setExtraFailed] = useState<string[]>([]);
  /** Which model placed each point, per case (Task 7): seeded from the stored `placed_by` (schema 10) and saved with every row. */
  const placedBy = useRef<Record<string, Record<string, string>>>({});
  const seq = useRef(0), docRef = useRef(doc), tracingRef = useRef(tracing);
  docRef.current = doc; tracingRef.current = tracing;
  const saver = useMemo(() => createSaver(
    async (e) => {
      const r = await library.save(e);
      setDoc((d) => (d && d.id === e.id ? { ...d, updatedAt: r.updatedAt, verifiedAt: r.verifiedAt, verifiedBy: r.verifiedAt ? d.verifiedBy : null } : d));
    },
    (status, err) => setSave({ status, error: err })), []);

  // Autosave: every change to the open case's points, orientation, display or facing.
  useEffect(() => { if (doc) saver.schedule(toEdit(doc.id, doc.facing, tracing, placedBy.current[doc.id] ?? {})); },
    [tracing.points, tracing.orientation, tracing.display, doc?.id, doc?.facing]);            // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘Q or closing the window: Rust holds the exit until the last edit is written (review #2).
  useEffect(() => {
    let unlisten: (() => void) | undefined, gone = false;
    listen('cephtrace://quit-requested', () => { void flushThenQuit(saver.flush, quitNow); })
      .then((u) => { if (gone) u(); else unlisten = u; }).catch(() => {});
    return () => { gone = true; unlisten?.(); };
  }, [saver]);

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
      if (run !== null && run === extrasSeq.current) barDispatch({ type: 'extra', ...bar });
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
    const mine = ++extrasSeq.current;
    const current = () => mine === extrasSeq.current && token === seq.current;
    barDispatch({ type: 'start' });
    try {
      const r = await detectLandmarks(d.image.path, facing).catch((e) => { if (current()) barDispatch({ type: 'main', state: 'failed' }); throw e; });
      if (current()) barDispatch({ type: 'main', state: 'done' });
      if (!current()) return;
      const extras = await runExtraModels(d.image.path, r.facingLeft, mine);
      if (!current()) return;
      const placed = await placeOnFilm(r, extras, models.points, models.mainPointSource);
      if (!current()) return;
      // Merge, do not replace: a point the re-detect keeps keeps its placer; only replaced points get the new one.
      const keep = mode === 'overwrite' ? {} : placedBy.current[d.id] ?? {};
      placedBy.current[d.id] = { ...keep, ...Object.fromEntries(Object.entries(placed.source)
        .filter(([id]) => replacedOnRedetect(tracingRef.current.points[id], mode === 'overwrite'))) };
      const turned = r.facingLeft !== (d.facing === 'left');
      setDoc((x) => (x && x.id === d.id ? { ...x, facing: r.facingLeft ? 'left' : 'right' } : x));
      dispatch(detectionAction(mode, placed.landmarks));
      if (mode !== 'keep' || turned) dispatch({ type: 'autoOrient', mirror: r.facingLeft });   // a plain re-detect keeps the user's view
      if (facing === 'auto' && facingUnsure(r)) { setNotice(FACING_UNSURE_NOTICE); setFacingUnsureNow(true); }
      await library.recordAi(d.id, aiRunOf(r), pointsOf(r));
      try {
        for (const x of extras) if (x.detection) await library.recordAi(d.id, aiRunOf({ ...x.detection, facingLeft: r.facingLeft, meanPeakLeft: null, meanPeakRight: null }), pointsOf(x.detection));
        if (!current()) return;
        const outcome = extraOutcome(extras);
        setExtraErrors(outcome.errors); setExtraFailed(outcome.failed);
        const g = await library.ghosts(d.id);
        if (current()) setAiPoints(g);
      } catch { /* the main tracing is unaffected */ }
    } catch (e) { if (token === seq.current) setError(message(e)); }
    finally { if (token === seq.current) setBusy(null); }
  }, [dispatch]);

  const open = useCallback(async (caseId: string) => {
    const token = ++seq.current;
    await saver.flush();                                                      // the previous case's last edit goes to that case
    setError(null); setNotice(null); setFacingUnsureNow(false); setBusy('Opening…'); setDoc(null); setBitmap(null); dispatch({ type: 'reset' });
    setAiPoints([]); setExtraErrors([]); setExtraFailed([]); extrasSeq.current++; barDispatch({ type: 'clear' });
    try {
      const d = await library.open(caseId);
      const bmp = await createImageBitmap(await (await fetch(convertFileSrc(d.image.path))).blob());
      if (token !== seq.current) return;
      const h = hydrateAction(d);
      placedBy.current[d.id] = Object.fromEntries(d.landmarks.filter((l) => l.placedBy).map((l) => [l.id, l.placedBy!]));
      saver.prime(toEdit(d.id, d.facing, tracingReducer(initialTracing, h), placedBy.current[d.id]));
      setDoc(d); setBitmap(bmp); dispatch(h); setBusy(null);
      library.ghosts(d.id).then((g) => { if (token === seq.current) setAiPoints(g); }).catch(() => {});
      if (!d.landmarks.length) await detect(d, 'auto', 'first', token);
    } catch (e) { if (token === seq.current) { setError(message(e)); setBusy(null); } }
  }, [dispatch, detect, saver]);

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
      for (const [i, id] of ids.entries()) {
        setNotice(`Tracing ${i + 1} of ${ids.length}…`);
        try {
          const d = await library.open(id);
          if (!d.landmarks.length) {
            const r = await detectLandmarks(d.image.path, 'auto');
            // Every installed model runs first; the saved points are placed under the gate (Task 7).
            const extras = await runExtraModels(d.image.path, r.facingLeft);
            const placed = await placeOnFilm(r, extras, models.points, models.mainPointSource);
            if (await library.saveAiIfUntraced(aiEdit(id, { ...r, landmarks: placed.landmarks }, placed.source))) {
              placedBy.current[id] = placed.source;
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

  const refreshIdentity = useCallback(async (id: string) => {
    const fresh = await library.open(id);
    setDoc((x) => (x && x.id === id ? { ...x, ...identityFields(fresh) } : x));
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
  /** Referring practitioner, saved on the patient (spec 2026-10-04). A single-field save (see `setPatientGender`).
   *  Taught to the machine since D2 (owner Q6): see `setPatientGender`. */
  const setPatientReferrer = useCallback(async (r: string | null) => {
    const d = docRef.current; if (!d) return;
    try { await library.setPatientReferrer(d.id, r); await refreshIdentity(d.id); onLibraryChanged(); learnValue('referrer', r); }
    catch (e) { setError(message(e)); }
  }, [onLibraryChanged, refreshIdentity, learnValue]);

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
    try { await library.setCasePopulation(d.id, p); setDoc((x) => (x && x.id === d.id ? { ...x, population: p } : x)); }
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

  /** "Read the film again" in Text on the film. */
  const readFilmText = useCallback(async () => {
    const d = docRef.current; if (!d) return;
    setReadingText(true);
    try { const r = await library.labelText(d.id); setFilmTexts((t) => ({ ...t, [d.id]: { lines: r.lines, suggestions: r.suggestions, conflicts: t[d.id]?.conflicts ?? [] } })); }
    catch (e) { setError(`The text on the film could not be read: ${message(e)}`); }
    finally { setReadingText(false); }
  }, []);

  const setVerified = useCallback(async (verified: boolean) => {
    const d = docRef.current; if (!d) return;
    try {
      if (verified && !(await saver.flush())) {                   // never sign off points that differ from what is on disk
        setError('The latest changes are not saved, so the tracing was not signed off. Use Retry, then try again.'); return;
      }
      await library.setVerified(d.id, verified);
      const fresh = await library.open(d.id);
      setDoc((x) => (x && x.id === d.id ? { ...x, verifiedAt: fresh.verifiedAt, verifiedBy: fresh.verifiedBy } : x));
      onLibraryChanged();
    } catch (e) { setError(message(e)); }
  }, [saver, onLibraryChanged]);

  /** Ruler calibration (decision 17). Throws the library's reason so the dialog can show it. */
  const calibrate = useCallback(async (p1: Vec2, p2: Vec2, mm: number) => {
    const d = docRef.current; if (!d) return;
    const spacingMm = await library.calibrate(d.id, p1, p2, mm);
    setDoc((x) => (x && x.id === d.id ? { ...x, spacingMm, verifiedAt: null, verifiedBy: null } : x));
    onLibraryChanged();
  }, [onLibraryChanged]);

  const close = useCallback(async () => {
    await saver.flush(); seq.current++;
    setDoc(null); setBitmap(null); setBusy(null); setError(null); setNotice(null); dispatch({ type: 'reset' });
    onLibraryChanged();
  }, [saver, dispatch, onLibraryChanged]);

  const filmText = doc ? filmTexts[doc.id] ?? null : null;
  return { doc, bitmap, busy, modelBars: bars, error, setError, notice, facingUnsure: facingUnsureNow, save, retrySave: saver.flush, batchRunning, open, importFiles, redetect, setMeta, setPatientGender, setPatientReferrer, setDetail, acceptLearned, learnValue, setCasePopulation, confirmIdentity, notSamePatient, confirmFilmDate, filmText, readingText, readFilmText, learnSelection, readArea, setVerified, calibrate, close, aiPoints, extraErrors, extraFailed,
    /** Which model placed each AI point on the open film this session (memory only; Part D). */
    placedBy: doc ? placedBy.current[doc.id] ?? null : null };
}
export type CaseApi = ReturnType<typeof useCase>;
