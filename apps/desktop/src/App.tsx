import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { compile, type Vec2 } from '@ceph/geometry';
import { ALL_ANALYSES, buildRegistry, foundBy, resolveNorm, type MyAnalysis } from '@ceph/analyses';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { library, models, modelStatus, operators, setModelDir, settings, type CaseSummary, type ModelPointRow, type ModelStatus, type PointCheckFlag, type PointCheckView, type ResolveReason } from './ipc';
import { checkExportProblem, checkStatus, filmFlags, filmHoldsSignOff, flagAt, notRunLines, shownView, signHoldLine, type CheckRead, type CheckStatus } from './points/pointCheck';
import { pressChecked } from './layout/PointCheckNote';
import { shownFor, wholeStatus, WHOLE_EXPORT_WORDS, type WholeRead } from './points/wholeFilm';
import { CephCanvas } from './canvas/CephCanvas';
import { Sidebar } from './layout/Sidebar';
import { Inspector } from './layout/Inspector';
import { Toolbar } from './layout/Toolbar';
import { CalibrateDialog } from './layout/CalibrateDialog';
import { LibraryView } from './library/LibraryView';
import { useCase, type CaseHooks } from './library/useCase';
import { caseHooksOf } from './ai/caseHooks';
import { useRulerMarks } from './tracing/useRulerMarks';
import { fineTuneOf } from './tracing/fineTune';
import { useChoose } from './library/useChoose';
import { upgradeNotice } from './library/upgradeNotice';
import { DATE_FORMAT_KEY, parseDateFormat, type DateFormat } from './dates';
import { BETA_NOTICE_KEY, parseBetaSeen } from './beta';
import { BetaNotice } from './layout/BetaNotice';
import { LIBRARY_VIEW_KEY, TABLE_LAYOUT_KEY, parseLibraryView, parseTableLayout, type LibraryView as LibraryViewMode, type TableLayout } from './library/view';
import { useSeries } from './compare/useSeries';
import { SeriesKey } from './layout/SeriesKey';
import { ModelManager } from './manager/ModelManager';
import { useModels } from './manager/useModels';
import { ghostsFrom, mainSuggestions, readyOtherIds, upgradeHidden, visibleGhosts } from './ghosts/ghosts';
import { autoBestGhost, mergeAutoBestOverlap, withAutoBest } from './ghosts/autoBestGhost';
import { buildComparison, fittedValues } from './compare/comparison';
import { scaleNoteOf } from './norms/ComparePopulations';
import { useFitPanel } from './compare/useFitPanel';
import { FitPanel } from './compare/FitPanel';
import { defaultReference, pickStep, references, toSave } from './compare/fitDraft';
import { adviceFor } from './compare/advice';
import { useSeriesList } from './compare/useSeriesList';
import { FitOwnLine, FitOwnLocked, ScaleAdvice } from './layout/ScaleAdvice';
import { apply, ownPages } from './compare/fit';
import { ALT } from './input/modName';
import { parseOverlays } from './library/persist';
import { CEPH_EXTENSIONS, pickDroppedCephs, refusedMessage } from './importFile';
import { initialTracing, positions, superimpositionView, tracingReducer } from './tracing/state';
import { baseScale, isAssumed } from './tracing/spacing';
import { useSharpened } from './canvas/sharpen';
import { applies, commandFor } from './input/keymap';
import { nudgeVector } from './canvas/dragMath';
import { fitOriented } from './canvas/orientation';
import { zoomAt, type Viewport } from './canvas/viewport';
import { shownName } from './library/identity';
import { DECIMALS_KEY, DEFAULT_DECIMALS, readDecimals, type Decimals } from './format';
import { SettingsWindow, type SettingsTab } from './settings/SettingsWindow';
import { WholeFilmSettings, WHOLE_IN_REPORTS_KEY } from './settings/WholeFilmSettings';
import { AUTO_ADVANCE_KEY } from './settings/SettingsWindow';
import { BEST_TABLE_KEY, BestModelSettings, foldOpen, foldValue } from './settings/BestModelSettings';
import { useNorms } from './norms/useNorms';
import { AutoSwitchNote, clinicDefaultShortLabel } from './norms/AutoSwitchNote';
import { casePopulationChoice, normCell, normsErrorMessage, queryFor } from './norms/normCell';
import { measurementRows, pointPlacer, unconfirmedAiPoints, type MeasurementRow } from './measurements';
import { type MainPointSource } from './ai/placement';
import { modelLine } from './ai/modelLine';
import { pointLabel, pointWhy } from './ai/pointLabel';
import { useAutoBest } from './ai/useAutoBest';
import { AutoBestIntro, AutoBestNotes, AutoBestUnreadableNote, BaseChangeNote } from './ai/AutoBestNotes';
import { useBase } from './ai/useBase';
import { useNormPicks } from './norms/useNormPicks';
import { DEFAULT_ENABLED, ENABLED_KEY, enableNew, forgetEnabled, mergeEnabled, parseEnabled, shownDefs, visibleEnabled } from './analyses/enabled';
import { ChooseAnalyses } from './analyses/ChooseAnalyses';
import { announceClinician, useMeanings } from './settings/useMeanings';
import { useMyAnalyses } from './settings/useMyAnalyses';
import { useFilmDetailsOff } from './settings/useFilmDetails';
import { FilmDetailsOff } from './settings/filmDetails';
import { ReportPreview } from './report/ReportPreview';
import { useReport } from './report/useReport';
import { ReportActions } from './report/ReportActions';
import { DEFAULT_REPORT_OPTIONS, REPORT_OPTION_KEYS, type ReportOptions } from './report/model';
import type { Paper } from './report/page';
import type { CsvChoice } from './report/CsvOptions';
import { chooseAndSave } from './report/save';
import { readWords } from './report/words';
import { readPicks } from './norms/normPicks';
import { readSalt } from './export/measurementsCsv';
import { exportFilmsCsv, wordsByFilm } from './export/batch';
import { CsvDialog } from './export/CsvDialog';
import { leftPage, libraryReplaced } from './library/scaleUndo';

type Page = 'library' | 'tracing' | 'superimposition';

export default function App() {
  const [page, setPage] = useState<Page>('library');
  // Final review I4: leaving the Library page unmounts Film layouts, which closes it, so its Undo is discarded.
  const pageWas = useRef<Page>(page);
  useEffect(() => { leftPage(pageWas.current, page); pageWas.current = page; }, [page]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [deleted, setDeleted] = useState<CaseSummary[]>([]);
  const [batch, setBatch] = useState<string[]>([]);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [libNotice, setLibNotice] = useState<string | null>(null);
  const [operator, setOperator] = useState('');
  // Settings › Text on the film (Task 8, D-FIELDS-1): the details switched off, for the drop-down and Choose buttons.
  const filmDetails = useFilmDetailsOff();
  const [dateFormat, setDateFormat] = useState<DateFormat>('AU');
  // Library ▸ Pictures/Table (owner decision 2, 29 Oct 2026): remembered as the clinician's last choice, per Mac.
  const [libraryView, setLibraryView] = useState<LibraryViewMode>('pictures');
  // Owner, 2 Nov 2026: the one-time Beta notice. null = not read yet (nothing shown, so it never flashes up for a clinician who has seen it).
  const [betaSeen, setBetaSeen] = useState<boolean | null>(null);
  // Library ▸ Table ▸ Grouped/Flat (owner, 29 Oct 2026, item B as revised): remembered the same way.
  const [tableLayout, setTableLayout] = useState<TableLayout>('grouped');
  const [dropping, setDropping] = useState(false);
  const [calib, setCalib] = useState<Vec2[] | null>(null);
  const calibRef = useRef(calib); calibRef.current = calib;
  // Owner, 16 Oct (C): where the magnifier looks while calibrating — the pointer while marking, then the mark last moved.
  const [calibHover, setCalibHover] = useState<Vec2 | null>(null), [calibActive, setCalibActive] = useState<number | null>(null);
  useEffect(() => { if (!calib) { setCalibHover(null); setCalibActive(null); } }, [!!calib]);   // eslint-disable-line react-hooks/exhaustive-deps
  const moveMark = useCallback((i: number, p: Vec2) => { if (!calibRef.current) return; setCalib((k) => (k ? k.map((q, j) => (j === i ? p : q)) : k)); setCalibActive(i); }, []);   // review M-1: not after Esc
  const ruler = calib ? { centre: calib.length < 2 ? calibHover ?? calib[calib.length - 1] ?? null : calib[calibActive ?? 1],
    marks: calib, active: calibActive, onPress: (p: Vec2) => setCalib((k) => (k && k.length < 2 ? [...k, p] : k)), onMove: moveMark } : null;
  const [tracing, dispatch] = useReducer(tracingReducer, initialTracing);
  const [view, setView] = useState<Viewport | null>(null);
  const refresh = useCallback(() => {
    Promise.all([library.list(false), library.list(true)])
      .then(([live, gone]) => { setCases(live); setDeleted(gone); return library.upgradeCopy(); })
      .then((dir) => { const n = upgradeNotice(dir); if (n) setLibNotice(n); })
      .catch((e) => setLibError(String(e)));
  }, []);
  // Owner D2: an extra model's loading bar and error line show only when its ghost is on (or a held point waits for
  // it, which useCase knows). Read through a ref, so the hook sees the ticks as they are now, not as they were; null
  // until the ghost settings have loaded, which shows none (fix round 1).
  const hiddenGhostsRef = useRef<ReadonlySet<string> | null>(null);
  // Automatic best (spec §6a): the check before each tracing and after each sign-off. `useCase` is declared before
  // `useAutoBest` (below needs `modelList`, read before `useCase` in this file's own order), so the hooks read it
  // through a ref kept current every render.
  const autoBestRef = useRef<ReturnType<typeof useAutoBest> | null>(null);
  // Owner ruling "Hold sign-off" (2 Nov): while a film note is unresolved, or the check of the film's current run is still
  // being read or could not be read (whole-branch review I1, I2: fail closed), nothing signs the film off, automatically or
  // by the button. `useCase` asks through these refs (set below on every render); a sign-off first waits for the read.
  const signHeldRef = useRef(false);
  const checkPendingRef = useRef(false);
  const checkWaiters = useRef<(() => void)[]>([]);
  const caseHooks = useMemo<CaseHooks>(() => ({ ...caseHooksOf(autoBestRef, hiddenGhostsRef), signHeld: () => signHeldRef.current,
    checkSettled: () => (checkPendingRef.current ? new Promise<void>((r) => { checkWaiters.current.push(r); }) : Promise.resolve()) }), []);
  const kase = useCase(tracing, dispatch, refresh, caseHooks);
  // Owner MEANING-PER-CLINICIAN (16 Oct) + NOCLIN-2 (17 Oct, ruling, item 34): the clinician's wording
  // for the meanings — top bar, else the open film's Referring practitioner (if they have saved words), else the
  // Mac login name. Must follow `kase`: it re-resolves whenever the open film (and so its referrer) changes.
  const meanings = useMeanings(kase.doc?.referringPractitioner ?? null);
  // Leftovers Task 3 (M2): when an install ends Ready, Automatic best's first-open step runs again, so installing the base
  // mid-session switches it on with its note at once (it is off until that step has run on a library with films).
  const onModelReady = useCallback(() => { void autoBestRef.current?.reintro(); }, []);
  const modelList = useModels(onModelReady);   // needed early: the ghosts_hidden upgrade (below) seeds itself from the model catalogue
  // Task 3 (spec 2026-10-13 §5.1 "Shown"): each AI point's source line. The source table is embedded in the app, so it is
  // read once; the fallback note is derived here, never stored, so it reads the same after closing and reopening.
  const [pointSource, setPointSource] = useState<MainPointSource | null>(null);
  useEffect(() => { models.mainPointSource().then(setPointSource).catch(() => setPointSource(null)); }, []);
  // Automatic best (spec §6a, §6b): re-reads what depends on its map whenever a change lands — the point labels
  // (via `pointSource`), the ghost (via `modelList`), and Models… (via `modelList`).
  const refreshAutoBest = useCallback(() => {
    models.mainPointSource().then(setPointSource).catch(() => setPointSource(null)); modelList.refresh();
  }, [modelList.refresh]);   // eslint-disable-line react-hooks/exhaustive-deps
  const autoBest = useAutoBest(refreshAutoBest);
  autoBestRef.current = autoBest;
  // Spec 2026-10-29 §2: the one base state both drop-downs read (Models… and Settings › Best model). After a change,
  // everything that follows the base is read again: labels, ghost, the model line.
  const base = useBase(useCallback(() => { refreshAutoBest(); modelStatus().then(setModel).catch(() => {}); }, [refreshAutoBest]));
  const autoBestTitle = useCallback((m: string) => modelList.rows.find((r) => r.id === m)?.title ?? m, [modelList.rows]);
  const autoBestNotes = <><AutoBestIntro note={autoBest.intro} titleOf={autoBestTitle} onWayBack={() => void autoBest.wayBack()} onDismiss={autoBest.closeIntro} />
    <AutoBestNotes notes={autoBest.notes} error={autoBest.error} titleOf={autoBestTitle}
      onUndo={(e) => void autoBest.undo(e)} onDismiss={autoBest.dismiss} />
    <BaseChangeNote note={base.note} titleOf={autoBestTitle} onBack={() => { if (base.note) void base.choose(base.note.from); }} onDismiss={base.dismissNote} /></>;
  const chooser = useChoose(kase, dateFormat);
  const chooseRef = useRef(chooser); chooseRef.current = chooser;
  // Part D task 6, owner ANALYSES-1 (12 Oct): which of the 15 analyses this Mac shows, kept here like Enhance.
  // `registry` stays the whole catalogue whichever analyses are chosen (buildRegistry's own nodes are always {} for
  // every catalogue analysis — P3, registry-all.test.ts) — it is evaluated once, so switching which analyses are
  // enabled never moves a computed value.
  const [enabledIds, setEnabledIds] = useState<string[]>(DEFAULT_ENABLED);
  // Fix round 1 (review m6): a toggle made before this read resolves must not be overwritten by it landing late
  // (same race, same fix, as `ghostsSeeded`/`overlaysReady` elsewhere in this file).
  const enabledReady = useRef(false);
  useEffect(() => { settings.get(ENABLED_KEY).then((v) => { if (!enabledReady.current) setEnabledIds(parseEnabled(v)); }).catch(() => {}); }, []);
  // Owner B1/B2 (17 Oct): the current clinician's own analyses, shown beside the built-ins they ticked.
  const mine = useMyAnalyses(meanings.clinician);
  const defs = useMemo(() => shownDefs(enabledIds, mine.list), [enabledIds, mine.list]);
  const shownIds = useMemo(() => visibleEnabled(enabledIds, mine.list), [enabledIds, mine.list]);
  const allAnalyses = useMemo(() => [...ALL_ANALYSES, ...mine.defs], [mine.defs]);
  const enabledRef = useRef(enabledIds); enabledRef.current = enabledIds;
  const mineRef = useRef(mine.list); mineRef.current = mine.list;
  const saveEnabled = useCallback((next: string[]) => {
    enabledReady.current = true; setEnabledIds(next); settings.set(ENABLED_KEY, JSON.stringify(next)).catch(() => {});
  }, []);
  const onChangeAnalyses = useCallback((visible: string[]) => saveEnabled(mergeEnabled(enabledRef.current, visible, mineRef.current)), [saveEnabled]);
  // Owner B1: a new analysis is shown at once; a deleted one leaves the shown list.
  const onMineSaved = useCallback((a: MyAnalysis, isNew: boolean) => {
    if (isNew) saveEnabled(enableNew(enabledRef.current, mineRef.current, a.id));
    mine.refresh();
  }, [mine.refresh, saveEnabled]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onMineDeleted = useCallback((id: string) => { saveEnabled(forgetEnabled(enabledRef.current, id)); mine.refresh(); }, [mine.refresh, saveEnabled]);   // eslint-disable-line react-hooks/exhaustive-deps
  const registry = useMemo(() => buildRegistry(ALL_ANALYSES), []);
  const compiled = useMemo(() => compile(registry), [registry]);
  // Owner G2 (Task 10): the film's own pages take its fit's scale only when it has no ruler, a usable fit, and "Use the
  // scale from the fit" is on (`ownPages`; a ruler always wins). `ownValues` are at its own scale; with the switch on,
  // `values` keep those angles and ratios bit for bit and take only the mm from the fit (`fittedValues`).
  const pages = ownPages({ spacingMm: kase.doc?.spacingMm ?? null, scaleSteps: kase.doc?.scaleSteps ?? 0, fit: kase.doc?.fit, machineScale: kase.doc?.machineScale });
  const scale = pages.scale, ownScale = pages.own;
  const ownValues = useMemo(() => compiled.evaluate(positions(tracing), ownScale.mmPerPx), [compiled, tracing.points, ownScale.mmPerPx]);   // eslint-disable-line react-hooks/exhaustive-deps
  const values = useMemo(() => fittedValues(ownValues, compiled, positions(tracing), scale), [ownValues, scale.mmPerPx, scale.source]);   // eslint-disable-line react-hooks/exhaustive-deps
  const patients = useMemo(() => [...new Set(cases.map((c) => c.patientName).filter((n) => n.trim()))].sort((a, b) => a.localeCompare(b)), [cases]);
  const drawn = useSharpened(kase.bitmap, tracing.display.sharpness);   // Enhance › Sharpness: display only

  // Compare with… (spec Part 3): the other scan aligned on S–N at S, and its T1 → T2 change table.
  const sup = page === 'superimposition';
  const ser = useSeries(kase.doc, sup && !!kase.bitmap, cases);
  // Request G (Task 7): the fit panel — the film being fitted, laid over the open film (its reference).
  const fit = useFitPanel({ open: kase.doc, openPoints: positions(tracing), onChanged: ser.reload, orientation: tracing.orientation });
  const [pairChoice, setPairChoice] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => setPairChoice(null), [kase.doc?.id]);
  const series = useMemo(() => {
    const d = kase.doc;
    if (!sup || !d) return null;
    // The comparison always starts from the film's OWN scale and values; it applies fits itself (Task 6).
    const c = buildComparison({ open: d, openPoints: positions(tracing), openValues: ownValues, openScale: ownScale, films: ser.films, docs: ser.docs,
      failed: ser.failed, compiled, defs, dateFormat, pairChoice,
      draft: fit.active && fit.draft ? { film: fit.draft.film, pose: fit.draft.pose, kind: fit.draft.kind } : null });
    return { ...c, change: c.change ? { ...c.change, onPair: setPairChoice } : null };
  }, [sup, kase.doc, ser.films, ser.docs, ser.failed, tracing.points, ownValues, compiled, ownScale.mmPerPx, ownScale.source, dateFormat, pairChoice, defs, fit.active, fit.draft]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Request G: "Adjust fit…" and "Scale now" — the reference becomes the open film, the base the film is laid on. The tick
  // is written first, so the new open film's series already has the film ticked.
  const startFit = useCallback(async (film: string, ref: string) => {
    try { await library.setInSeries(film, true); } catch { /* the fit still works; the film is only not ticked */ }
    fit.begin(film, ref); setPage('superimposition');
    if (kase.doc?.id !== ref) await kase.open(ref); else await ser.reload();
  }, [fit.begin, kase.doc?.id, kase.open, ser.reload]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onFit = useCallback((film: string) => {
    const f = ser.films.find((x) => x.id === film), ref = f?.fitRef ?? defaultReference(ser.films, film)?.id;
    if (ref) void startFit(film, ref);
  }, [ser.films, startFit]);
  useEffect(() => { if (!sup) fit.close(); }, [sup]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Owner G1: the open film's series on the tracing page (null until read), for the advice's reference and reasons.
  const openFilms = useSeriesList(kase.doc?.id ?? null, !sup && !!kase.doc && baseScale(kase.doc).source === 'assumed' && !kase.doc.fit, cases);
  const calibrateNow = useCallback(async (id: string) => {
    fit.close(); setPage('tracing');
    if (kase.doc?.id !== id) await kase.open(id);
    setCalib([]);
  }, [kase.doc?.id, kase.open, fit.close]);   // eslint-disable-line react-hooks/exhaustive-deps
  const scaleNow = useCallback((id: string) => {
    const ref = defaultReference(sup ? ser.films : openFilms ?? [], id);
    if (ref) void startFit(id, ref.id);
  }, [sup, ser.films, openFilms, startFit]);
  const d0 = kase.doc;
  const tracingAdvice = !sup && d0 && openFilms ? adviceFor({ id: d0.id, timepoint: d0.timepoint, spacingMm: d0.spacingMm, fitted: !!d0.fit, machineScale: d0.machineScale }, openFilms, d0.patientKey.startsWith('~')) : null;
  // While fitting, the reference's picture is shown (not the mm grid) and the film is laid over it, at half strength
  // while both are shown.
  const fitting = sup && fit.active && !!fit.draft && !!fit.image && !!fit.sim;
  const fitLayer = useMemo(() => (fitting && fit.draft!.show !== 'ref'
    ? { image: fit.image!, sim: fit.sim!, alpha: fit.draft!.show === 'both' ? 0.5 : 1, base: fit.draft!.show !== 'film' } : null),
  [fitting, fit.draft?.show, fit.image, fit.sim]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Request G (Task 8): while a film is being fitted the pointer adjusts it (drag, ⌥-drag, two points picked).
  const fitInput = fitting ? { picking: !!pickStep(fit.draft!), pivot: { x: fit.draft!.pose.a.x + fit.draft!.pose.dx, y: fit.draft!.pose.a.y + fit.draft!.pose.dy },
    hint: pickStep(fit.draft!) ?? `Drag the film to move it, ${ALT()}-drag to turn it, arrow keys nudge (⇧ 10).`,
    onPick: (p: Vec2) => fit.act({ type: 'pick', at: p }), onMove: (d: Vec2) => fit.act({ type: 'move', d }), onTurn: (rad: number) => fit.act({ type: 'turn', rad }) } : null;
  // Picks 3 and 4 are on the fitted film, so they are drawn where that film is drawn now.
  const fitMarks = fitting && fit.draft!.kind === 'points' ? fit.draft!.picks.map((p, i) => (i < 2 ? p : apply(fit.sim!, p))) : undefined;
  const supState = superimpositionView(tracing);
  const canvasState = !sup ? tracing : fitting ? { ...supState, overlays: { ...supState.overlays, background: 'radiograph' as const } } : supState;
  // Owner D-f: ⌘Z after "Remove fit" puts the removed fit back (read by the one keyboard handler below).
  const fitUndo = useRef<(() => void) | null>(null);
  fitUndo.current = sup && fit.canUndo ? () => void fit.undoRemove() : null;


  const overlaysReady = useRef(false);
  useEffect(() => {
    settings.get('overlays').then((j) => { const o = parseOverlays(j); if (o) dispatch({ type: 'setOverlays', overlays: o }); })
      .catch(() => {}).finally(() => { overlaysReady.current = true; });
  }, []);
  useEffect(() => { if (overlaysReady.current) settings.set('overlays', JSON.stringify(tracing.overlays)).catch(() => {}); }, [tracing.overlays]);
  useEffect(() => { settings.get('operator').then((v) => setOperator(v ?? '')).catch(() => {}); }, []);
  useEffect(() => { settings.get(DATE_FORMAT_KEY).then((v) => setDateFormat(parseDateFormat(v))).catch(() => {}); }, []);
  useEffect(() => { settings.get(BETA_NOTICE_KEY).then((v) => setBetaSeen(parseBetaSeen(v))).catch(() => setBetaSeen(false)); }, []);
  useEffect(() => { settings.get(LIBRARY_VIEW_KEY).then((v) => setLibraryView(parseLibraryView(v))).catch(() => {}); }, []);
  useEffect(() => { settings.get(TABLE_LAYOUT_KEY).then((v) => setTableLayout(parseTableLayout(v))).catch(() => {}); }, []);
  // Owner DEC-1 (12 Oct): decimals shown, kept on this Mac; read with its default. Task 10: the Settings control
  // (`onDecimals`) updates state immediately — the Inspector re-renders with the new setting without reopening the
  // case — and saves it on this Mac; calculation and colour always use the full figures (format.ts).
  const [decimals, setDecimals] = useState<Decimals>(DEFAULT_DECIMALS);
  useEffect(() => { void readDecimals(settings).then(setDecimals); }, []);
  const onDecimals = useCallback((d: Decimals) => { setDecimals(d); void settings.set(DECIMALS_KEY, String(d)); }, []);
  // Task 5: the norm sets, the clinician's own norms and the clinic default (N6); loadError/settingsError are shown
  // in the Inspector, never swallowed.
  const norms = useNorms();
  // Owner NORM-PICK-1: the sources the clinician chose on this case where a population had no norm (saved on the case).
  const normPicks = useNormPicks(kase.doc?.id ?? null);
  // Task 5, N1/N4/N5: one norm cell per Measurements row. Null when there is no case open, or when the committed
  // norm sets failed to load (loadError) — there is nothing sound to resolve against, so the Inspector shows the
  // load error instead of a cell that would read as "No norm" for every row.
  const normFor = useCallback((r: MeasurementRow) => {
    const d = kase.doc;
    if (!d || norms.loadError) return null;
    const q = queryFor(r.node, r.normAnalysisId, d, norms, normPicks.picks);
    return normCell(r.num, resolveNorm(q), q, decimals);
  }, [kase.doc, norms.loadError, norms.sets, norms.userNorms, norms.clinicDefault, decimals, normPicks.picks]);
  // NORM-PICK-1: the query behind a row's norm cell, for the "choose one" list (the same queryFor, never a second one).
  const normQueryFor = useCallback((r: MeasurementRow) => (kase.doc ? queryFor(r.node, r.normAnalysisId, kase.doc, norms, normPicks.picks) : null),
    [kase.doc, norms, normPicks.picks]);
  // Part D task 11: the enabled analyses' measurement rows for the open film, computed once here (not inside
  // Inspector, which this task does not touch) so "Compare populations…" (CasePanel, via Sidebar) sees exactly
  // the same rows the Measurements tab does — the same `defs`/`compiled`/`values`/`scale`/`decimals` Inspector
  // itself uses for its own `measurementRows` call.
  const compareRows = useMemo(() => measurementRows(defs, compiled, values, new Set(Object.keys(tracing.points)), decimals, scale),
    [defs, compiled, values, tracing.points, decimals, scale]);
  // Enhance stays as the clinician left it on this Mac; read once here so it never flashes open as a case opens.
  const [enhanceOpen, setEnhanceOpen] = useState(true);
  useEffect(() => { settings.get('enhance_open').then((v) => setEnhanceOpen(v !== '0')).catch(() => {}); }, []);
  const onEnhance = useCallback(() => setEnhanceOpen((o) => { settings.set('enhance_open', o ? '0' : '1').catch(() => {}); return !o; }), []);
  // Text on the film open or closed, kept on this Mac like Enhance (owner, 2 Oct: "a bigger arrow like Enhance").
  const [filmTextOpen, setFilmTextOpen] = useState(true);
  useEffect(() => { settings.get('film_text_open').then((v) => setFilmTextOpen(v !== '0')).catch(() => {}); }, []);
  const onFilmText = useCallback(() => setFilmTextOpen((o) => { settings.set('film_text_open', o ? '0' : '1').catch(() => {}); return !o; }), []);
  // Owner D1 (19 Oct): the Patient section open or folded, kept on this Mac like Enhance; read once here so it never
  // flashes open as a case opens.
  const [patientOpen, setPatientOpen] = useState(true);
  useEffect(() => { settings.get('patient_open').then((v) => setPatientOpen(v !== '0')).catch(() => {}); }, []);
  const onPatient = useCallback(() => setPatientOpen((o) => { settings.set('patient_open', o ? '0' : '1').catch(() => {}); return !o; }), []);
  // Inspector's "Other points" (Part A task 9, fix round 1): the catalogue points no enabled
  // analysis needs, so they stay out of "Not placed" by default. Collapsed on first use, unlike
  // Enhance/Text on the film (owner ruling: a section nobody needs most of the time starts closed);
  // remembered the same way (settings key, read once so it never flashes open as a case opens).
  const [otherPointsOpen, setOtherPointsOpen] = useState(false);
  useEffect(() => { settings.get('other_points_open').then((v) => setOtherPointsOpen(v === '1')).catch(() => {}); }, []);
  const onOtherPoints = useCallback(() => setOtherPointsOpen((o) => { settings.set('other_points_open', o ? '0' : '1').catch(() => {}); return !o; }), []);
  // The other models' ghost marks (spec 2026-10-01 Part 3; owner 5 Oct: a tick-box per model, not one on/off switch).
  // `hiddenGhosts` holds the hidden models' ids (setting `ghosts_hidden`, a JSON array) remembered on this Mac across
  // cases. Upgrade from the old binary `ghosts_shown` (owner's rule, 5 Oct): once `ghosts_hidden` has never been
  // set, `ghosts_shown === '0'` hides every model known right now; this needs the model catalogue, so it waits for
  // `modelList.rows` and then writes `ghosts_hidden` once so the upgrade never repeats. A model installed later is
  // simply never in `ghosts_hidden`, so it starts shown.
  const [hiddenGhosts, setHiddenGhosts] = useState<Set<string>>(new Set());
  const ghostsSeeded = useRef(false);        // ghosts_hidden has been read, written by the upgrade, or set by a tick
  hiddenGhostsRef.current = ghostsSeeded.current ? hiddenGhosts : null;
  // I3 (owner, 5 Oct): this WAS a useRef. A ref's own change does not re-run an effect — only a dependency changing
  // does — so when `modelList.rows` arrived BEFORE the async settings.get('ghosts_shown') resolved, the upgrade
  // effect below ran once with the flag still undefined, returned early, and never ran again: no further change to
  // `modelList.rows` was coming, so the upgrade silently never happened (and would repeat every launch, since
  // ghostsSeeded.current was never set true either). useState makes the flag's own arrival a dependency the effect
  // reacts to.
  const [ghostsUpgradeFlag, setGhostsUpgradeFlag] = useState<string | null | undefined>(undefined);   // '0'/'1'/null once known, else undefined
  useEffect(() => {
    autoBest.ready.then(() => settings.get('ghosts_hidden')).then((stored) => {
      // Item G (owner, 6 Oct): respect a seed already set by the upgrade effect below (or by a tick) winning this
      // race, rather than overwriting it with the stored value read a tick later.
      if (stored !== null) { if (!ghostsSeeded.current) { setHiddenGhosts(upgradeHidden(stored, null, [])); ghostsSeeded.current = true; } return; }
      settings.get('ghosts_shown').then((flag) => setGhostsUpgradeFlag(flag)).catch(() => setGhostsUpgradeFlag(null));
    }).catch(() => setGhostsUpgradeFlag(null));
  }, []);
  useEffect(() => {
    if (ghostsSeeded.current || ghostsUpgradeFlag === undefined) return;
    // Item G (owner, 6 Oct): wait for the CATALOGUE (modelList.rows itself), not for any model actually being
    // Ready — the old code returned early whenever readyOtherIds was empty, which postponed the upgrade until the
    // FIRST model finished installing and then hid exactly that model (the stale '0' flag still meant "hide
    // everything known now"). Once the catalogue has arrived, zero models Ready right now is a real, final answer:
    // write ghosts_hidden=[] and stop, so a model installed afterwards simply starts shown, like any other.
    if (!modelList.rows.length) return;   // the catalogue itself isn't loaded yet; try again once it is
    // I4 (owner, 5 Oct): only Ready rows — a model still installing or not yet installed has no diamonds to hide.
    const otherIds = readyOtherIds(modelList.rows);
    const hidden = upgradeHidden(null, ghostsUpgradeFlag, otherIds);
    setHiddenGhosts(hidden);
    settings.set('ghosts_hidden', JSON.stringify([...hidden])).catch(() => {});
    ghostsSeeded.current = true;
  }, [modelList.rows, ghostsUpgradeFlag]);
  const onToggleGhostModel = useCallback((modelId: string) => {
    ghostsSeeded.current = true;   // a tick the owner made before the upgrade ran must not be overwritten by it
    setHiddenGhosts((h) => {
      const next = new Set(h);
      if (next.has(modelId)) next.delete(modelId); else next.add(modelId);
      settings.set('ghosts_hidden', JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);
  const onToggleAllGhosts = useCallback((listedIds: string[]) => {
    ghostsSeeded.current = true;   // a tick the owner made before the upgrade ran must not be overwritten by it
    setHiddenGhosts((h) => {
      const allShown = listedIds.every((id) => !h.has(id));
      const next = allShown ? new Set([...h, ...listedIds]) : (() => { const n = new Set(h); for (const id of listedIds) n.delete(id); return n; })();
      settings.set('ghosts_hidden', JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);
  const onDateFormat = useCallback((f: DateFormat) => {
    settings.set(DATE_FORMAT_KEY, f).then(() => setDateFormat(f)).catch((e) => setLibError(String(e)));
  }, []);
  const onLibraryView = useCallback((v: LibraryViewMode) => {
    settings.set(LIBRARY_VIEW_KEY, v).then(() => setLibraryView(v)).catch((e) => setLibError(String(e)));
  }, []);
  const onTableLayout = useCallback((l: TableLayout) => {
    settings.set(TABLE_LAYOUT_KEY, l).then(() => setTableLayout(l)).catch((e) => setLibError(String(e)));
  }, []);
  // Blank means "use the macOS login name" (ceph-store's operator() treats blank as unset).
  const onOperator = useCallback((name: string) => {
    settings.set('operator', name).then(() => { setOperator(name); announceClinician(); setLibNotice(name ? `Edits and sign-offs are now recorded as ${name}.` : 'Edits are recorded under your macOS login name.'); })
      .catch((e) => setLibError(String(e)));
  }, []);
  useEffect(() => { refresh(); modelStatus().then(setModel).catch((e) => setLibError(String(e))); }, [refresh]);
  // Owner NAP-Q3 (b), spec 2026-10-29 §4.8: once, after the format-18 upgrade switched old "Clinic default" cases to
  // Auto, a note says how many and what it means. The library counts them and remembers that it was shown.
  const [switchNote, setSwitchNote] = useState<{ n: number; clinicDefault: string | null } | null>(null);
  useEffect(() => {
    Promise.all([settings.autoSwitchNote(), settings.defaultPopulation()])
      .then(([n, d]) => { if (n) setSwitchNote({ n, clinicDefault: d ?? null }); }).catch(() => {});
  }, []);
  const closeSwitchNote = useCallback(() => {
    setSwitchNote(null);
    // A failed write is shown; the note may then show again at the next launch.
    settings.dismissAutoSwitchNote().catch((e) => setLibError(`The note could not be marked as read (${String(e)}); it may show again next time.`));
  }, []);

  const busyRef = useRef<string | boolean | null>(kase.busy); busyRef.current = kase.busy || kase.batchRunning;
  const importPaths = useCallback(async (paths: string[]) => {
    if (!paths.length || busyRef.current) return;
    setLibNotice(null);
    if (paths.length === 1) setPage('tracing');
    const { ids, traced } = await kase.importFiles(paths);
    if (paths.length > 1) {
      setBatch(ids);
      setLibNotice(`${ids.length} of ${paths.length} films imported, ${traced} traced. They are under Last batch.`);
      // Stay where the clinician is: a case opened during the batch is not closed under them.
    }
    modelStatus().then(setModel).catch(() => {});
  }, [kase.importFiles]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onImport = useCallback(async () => {
    if (busyRef.current) return;
    const picked = await open({ multiple: true, directory: false, filters: [{ name: 'Cephalogram', extensions: CEPH_EXTENSIONS }] });
    if (picked) void importPaths(Array.isArray(picked) ? picked : [picked]);
  }, [importPaths]);

  // Tauri intercepts file drops on the window (the webview never sees HTML5 drop events), so listen to its event.
  useEffect(() => {
    let unlisten: (() => void) | undefined, gone = false;
    getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === 'enter' || payload.type === 'over') setDropping(true);
      else if (payload.type === 'leave') setDropping(false);
      else {
        setDropping(false);
        const { paths, rejected } = pickDroppedCephs(payload.paths);
        setLibError(refusedMessage(rejected));
        void importPaths(paths);
      }
    }).then((u) => { if (gone) u(); else unlisten = u; }).catch((e) => setLibError(String(e)));
    return () => { gone = true; unlisten?.(); };
  }, [importPaths]);

  // Review I1 (owner ruling R-B2): the main model's own points over the 2 mm gate that nothing placed are shown as its
  // ghost suggestion. The table of who finds what is re-read whenever the model rows change; unreadable means none.
  const [pointTable, setPointTable] = useState<ModelPointRow[] | null>(null);
  useEffect(() => { models.points().then((t) => setPointTable(Array.isArray(t) ? t : null)).catch(() => setPointTable(null)); }, [modelList.rows]);
  const mainIds = useMemo(() => mainSuggestions(pointTable, tracing.points), [pointTable, tracing.points]);
  // Task 6: which points some installed model finds, for the analysis picker's "automatic / partly automatic"
  // marking. No models table (unreadable or none installed) reads as foundBy([]) — every point an analysis
  // needs then counts as hand-placed, never silently "automatic".
  const found = useMemo(() => foundBy(pointTable ?? []), [pointTable]);
  // Final review I-2 (ruling): which unconfirmed AI points each measurement uses, computed once here for every screen that
  // shows the value — the Inspector's Measurements tab and the compare window both read this one function.
  // Review T9-1: `?? []` is defence against a malformed reply only (`library_ghosts` returns a Vec; useCase starts at []).
  const aiRuns = useMemo(() => kase.aiPoints ?? [], [kase.aiPoints]);
  const unconfirmedFor = useCallback((node: string) => unconfirmedAiPoints(node, compiled, tracing.points), [compiled, tracing.points]);
  useEffect(() => { models.weightsCheckRun().catch(() => {}); }, []);   // Part F (owner Q4): the weights check, once at launch, in the background
  // Chain spec §5 (Part F Task 8): every placed point's label and the hover that says why. Derived here, never stored,
  // so it reads the same after closing and reopening.
  // Final review I-2: ONE placer (`pointPlacer`) for the screen, the report and both CSV exports.
  const placerFor = useMemo(() => pointPlacer(tracing.points, kase.placedBy, aiRuns), [tracing.points, kase.placedBy, aiRuns]);
  // Stage A: the point check's stored result for the open film. Whole-branch review I1: each read is tagged with the film and
  // the run revision it was issued at (`kase.checkRev` moves after each run of the open film is stored, since the run's check
  // is stored with the run), and the screen acts on it only when it is the open film's read at the current revision with no
  // run being stored (`checkStatus`). Read when a film opens, after each stored run, after each save (a look at a flagged
  // point resolves its flag in that save), and on "Try again". Read only.
  const [landed, setLanded] = useState<CheckRead | null>(null);
  const [checkRetry, setCheckRetry] = useState(0);
  const openIdRef = useRef<string | undefined>(undefined); openIdRef.current = kase.doc?.id;
  const checkRevRef = useRef(kase.checkRev); checkRevRef.current = kase.checkRev;
  // A read lands only on the film it was issued for (M1: a Checked re-read that returns after a switch is dropped).
  const landRead = useCallback((id: string, rev: number, p: Promise<PointCheckView | null>, live: () => boolean = () => true): Promise<void> =>
    p.then((v) => { if (live() && openIdRef.current === id) setLanded({ caseId: id, rev, view: v ?? null, failed: false }); })
      .catch(() => { if (live() && openIdRef.current === id) setLanded({ caseId: id, rev, view: null, failed: true }); }), []);
  useEffect(() => {
    const id = kase.doc?.id;
    if (!id) return;
    let live = true;
    void landRead(id, kase.checkRev, library.pointChecksForCase(id), () => live);
    return () => { live = false; };
  }, [kase.doc?.id, kase.aiPoints, kase.busy, kase.doc?.updatedAt, kase.checkRev, checkRetry]);   // eslint-disable-line react-hooks/exhaustive-deps
  // SC-1 Part 1 task 8: the whole-film note's stored result. Read at the same moments (a film opens, each stored run, each save)
  // and after sign-off (the final tracing is checked then). A note only: it feeds nothing but the note (never `signHeldRef`,
  // `filmHoldsSignOff`, `setFlagged` or `checkWaits`), and a failed read just shows no note.
  const [wholeLanded, setWholeLanded] = useState<WholeRead | null>(null);
  const [wholeBusy, setWholeBusy] = useState(false);   // a Checked is being stored: the view held is about to change
  const [wholeAsking, setWholeAsking] = useState<number | null>(null);
  const verifiedAtRef = useRef<string | null>(null); verifiedAtRef.current = kase.doc?.verifiedAt ?? null;
  const readWhole = useCallback((id: string, live: () => boolean = () => true): Promise<void> => {
    const rev = checkRevRef.current, verifiedAt = verifiedAtRef.current;   // the tags this read is issued at
    return library.wholeFilmCheck(id).then((v) => { if (live() && openIdRef.current === id) setWholeLanded({ caseId: id, rev, verifiedAt, view: v ?? null, failed: false }); })
      .catch(() => { if (live() && openIdRef.current === id) setWholeLanded({ caseId: id, rev, verifiedAt, view: null, failed: true }); });
  }, []);
  useEffect(() => {
    const id = kase.doc?.id;
    setWholeAsking(null);
    if (!id) return;
    let live = true;
    void readWhole(id, () => live);
    return () => { live = false; };
  }, [kase.doc?.id, kase.aiPoints, kase.busy, kase.doc?.updatedAt, kase.doc?.verifiedAt, kase.checkRev]);   // eslint-disable-line react-hooks/exhaustive-deps
  const wholeShown = shownFor(wholeLanded, kase.doc?.id);
  // Task 9: the report's `whole_film_check` cell reads this same view. A view not yet read for the open film, or whose read failed,
  // stops the export (a blank cell would read as "no record"); the note itself just shows nothing then.
  const wholeNow = wholeStatus(kase.doc?.id ?? null, kase.checkRev, kase.doc?.verifiedAt ?? null, kase.checkRecording || wholeBusy, wholeLanded);
  const wholeForReport = wholeNow === 'read' ? wholeLanded : null;
  // Research switch (owner, 6 Nov 2026; Settings › Checks): off by default, remembered per Mac. While it is off the whole-film view is in neither
  // the PDF nor the CSV, so an unread or failed read stops nothing.
  // Owner, 6 Nov 2026: "Move to the next point automatically", ON unless stored '0'; remembered per Mac.
  const [autoAdvance, setAutoAdvance] = useState(true);
  useEffect(() => { settings.get(AUTO_ADVANCE_KEY).then((v) => { if (v === '0') setAutoAdvance(false); }).catch(() => {}); }, []);
  const onAutoAdvance = useCallback((on: boolean) => { setAutoAdvance(on); settings.set(AUTO_ADVANCE_KEY, on ? '1' : '0').catch(() => {}); }, []);
  const [wholeInReports, setWholeInReports] = useState(false);
  useEffect(() => { settings.get(WHOLE_IN_REPORTS_KEY).then((v) => { if (v === '1') setWholeInReports(true); }).catch(() => {}); }, []);
  const onWholeInReports = useCallback((on: boolean) => { setWholeInReports(on); settings.set(WHOLE_IN_REPORTS_KEY, on ? '1' : '0').catch(() => {}); }, []);
  const wholeFilmProblem = !wholeInReports ? null : wholeNow === 'pending' ? WHOLE_EXPORT_WORDS.pending : wholeNow === 'failed' ? WHOLE_EXPORT_WORDS.failed : null;
  const onWholeResolve = useCallback((checkId: number, reason: ResolveReason) => {
    const id = kase.doc?.id;
    if (!id) return;
    void (async () => { setWholeBusy(true); try { await library.wholeFilmCheckResolve(id, checkId, reason); } catch { /* the re-read shows what is stored */ } setWholeAsking(null); await readWhole(id); setWholeBusy(false); })();
  }, [kase.doc?.id, readWhole]);
  const checkNow: CheckStatus = checkStatus(kase.doc?.id ?? null, kase.checkRev, kase.checkRecording, landed);
  const pointCheck = useMemo(() => shownView(landed, kase.doc?.id), [landed, kase.doc?.id]);
  // The flag at each pin: the one from the run of the model that placed it; a hand-placed point has none. Flags only.
  const pointChecks = useMemo(() => {
    const out: Record<string, PointCheckFlag> = {};
    for (const id of Object.keys(tracing.points)) { const f = flagAt(pointCheck, id, placerFor(id), tracing.points[id]?.verified ?? false); if (f) out[id] = f; }
    return out;
  }, [pointCheck, tracing.points, placerFor]);
  // Both bulk accepts leave out the points whose flag is drawn (an unverified pin with the placer's flag, resolved or not),
  // and wait while the check of the current run is unread or could not be read (state.flagged, state.checkPending).
  const flaggedKey = Object.keys(pointChecks).join(',');
  const checkWaits = checkNow === 'pending' || checkNow === 'failed';
  useEffect(() => { dispatch({ type: 'setFlagged', ids: flaggedKey ? flaggedKey.split(',') : [], pending: checkWaits }); }, [flaggedKey, tracing.points, checkWaits, kase.doc?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const filmChecks = useMemo(() => filmFlags(pointCheck), [pointCheck]);
  const filmHeld = filmHoldsSignOff(filmChecks);
  signHeldRef.current = filmHeld || checkWaits;
  checkPendingRef.current = checkNow === 'pending';
  // A sign-off waiting for the read goes on once it has landed (read or failed), and then reads the hold again.
  useEffect(() => { if (checkNow !== 'pending' && checkWaiters.current.length) { const w = checkWaiters.current; checkWaiters.current = []; w.forEach((f) => f()); } });
  const holdWords = signHoldLine(checkNow, filmHeld);
  const signOffShown = useMemo(() => (kase.signOff && holdWords
    ? { ...kase.signOff, filmHeld: true, holdLine: holdWords, retryCheck: checkNow === 'failed' ? () => setCheckRetry((n) => n + 1) : undefined }
    : kase.signOff), [kase.signOff, holdWords, checkNow]);
  // Checked on the film note: the command per film row, then the stored result is read again (the note then shows resolved).
  const onFilmChecked = useCallback((ids: number[]) => {
    const id = kase.doc?.id;
    if (!id) return;
    const rev = checkRevRef.current;
    void pressChecked(id, ids, library.pointCheckFilmChecked, () => landRead(id, rev, library.pointChecksForCase(id)));
  }, [kase.doc?.id, landRead]);
  const checkLines = useMemo(() => notRunLines(pointCheck, Object.keys(tracing.points).map(placerFor).filter((m): m is string => !!m)), [pointCheck, tracing.points, placerFor]);
  const placedFor = useCallback((pid: string) => {
    const p = tracing.points[pid];
    if (!p) return null;
    const mainId = pointTable?.find((r) => r.main)?.modelId ?? null;
    const titleOf = (m: string) => pointTable?.find((r) => r.modelId === m)?.title ?? m;
    const placer = placerFor(pid);
    const via = kase.placedVia?.[pid] ?? null;
    return { label: pointLabel(p.source, placer, titleOf, via), why: pointWhy(pid, p.source, placer, mainId, pointSource, titleOf, dateFormat, via) };
  }, [tracing.points, placerFor, pointTable, pointSource, dateFormat, kase.placedVia]);
  const placedLineFor = useCallback((pid: string) => placedFor(pid)?.label ?? null, [placedFor]);
  const placedWhyFor = useCallback((pid: string) => placedFor(pid)?.why ?? null, [placedFor]);
  // Spec 2026-10-17 report-exports: Export › opens the Report preview for the open film (closed on another film or page).
  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => setReportOpen(false), [kase.doc?.id, page]);
  // Library ▸ Table's Report date (owner, 29 Oct 2026): the film to open straight at its PDF export, once it has loaded
  // (the same moment Export › becomes available). Declared after the line above, so on the render the film arrives
  // the close runs first and this opens it. Cleared by opening any film another way, and by going back to the Library.
  const [reportFor, setReportFor] = useState<string | null>(null);
  useEffect(() => {
    if (reportFor && page === 'tracing' && kase.doc?.id === reportFor && kase.bitmap) { setReportOpen(true); setReportFor(null); }
  }, [reportFor, page, kase.doc?.id, kase.bitmap]);
  // Part F Task 13: the open film's model files, read when its report opens (the CSV's model_file).
  const [pointFiles, setPointFiles] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!reportOpen || !kase.doc) { setPointFiles({}); return; }
    let gone = false;
    library.pointFiles(kase.doc.id).then((f) => { if (!gone) setPointFiles(f); }).catch(() => { if (!gone) setPointFiles({}); });
    return () => { gone = true; };
  }, [reportOpen, kase.doc?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Spec 2026-10-19 (F): the ruler marks left on the film after calibrating. Hidden on a read-only page, while
  // calibrating, and while the Report preview is open (I8: feat/report-exports is merged onto this branch).
  const rulerMarks = useRulerMarks(tracing.ruler, !sup && !calib && !reportOpen, kase.moveRuler);
  const reportPlacer = placerFor;
  const reportTitle = useCallback((m: string) => pointTable?.find((r) => r.modelId === m)?.title ?? m, [pointTable]);
  // review Minor 5 (shapes.ts): FigureInput takes one `scale`, not independent `mmPerPx`/`assumed` fields — the
  // same `scale` App already passes to CephCanvas (`assumedScale={isAssumed(scale)}` at its own call site).
  // Moved above `useReport` (Task 9): `useReport` now takes `figureInput` directly, for Save PDF… at save time.
  const reportFigure = kase.doc ? { points: tracing.points, registry, overlays: tracing.overlays, orientation: tracing.orientation,
    dims: { W: kase.doc.image.width, H: kase.doc.image.height }, scale } : null;
  // Owner decision 1 (29 Oct 2026): how Auto chose this case's population, for the report sentence (the one helper the
  // Library export uses too).
  const populationChoice = useMemo(() => (kase.doc && !norms.loadError ? casePopulationChoice(kase.doc, norms) : null),
    [kase.doc, norms.sets, norms.userNorms, norms.clinicDefault, norms.loadError]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Owner, 29 Oct 2026 / 5 Nov: the export options (Profilogram page, Norm sources, Placed by, Points table), remembered per Mac
  const [reportOptions, setReportOptions] = useState<ReportOptions>(DEFAULT_REPORT_OPTIONS);
  useEffect(() => {
    (Object.keys(REPORT_OPTION_KEYS) as (keyof ReportOptions)[]).forEach((k) => {
      settings.get(REPORT_OPTION_KEYS[k]).then((v) => { if (v !== null) setReportOptions((o) => ({ ...o, [k]: v === '1' })); }).catch(() => {});
    });
  }, []);
  const onReportOptions = useCallback((o: ReportOptions) => {
    setReportOptions(o);
    (Object.keys(REPORT_OPTION_KEYS) as (keyof ReportOptions)[]).forEach((k) => { settings.set(REPORT_OPTION_KEYS[k], o[k] ? '1' : '0').catch(() => {}); });
  }, []);
  const report = useReport({ open: reportOpen, doc: kase.doc, rows: compareRows, defs, normFor: kase.doc && !norms.loadError ? normFor : null,
    normsError: norms.loadError, words: meanings.words, points: tracing.points, placer: reportPlacer, titleOf: reportTitle, scale, dateFormat,
    bitmap: drawn, orientation: tracing.orientation, display: tracing.display, decimals, figureInput: reportFigure, pointFiles,
    via: (id) => kase.placedVia?.[id] ?? null, populationChoice, pointCheck, options: reportOptions,
    pointCheckProblem: checkExportProblem(checkNow), wholeFilm: wholeForReport?.view ?? null, wholeFilmProblem, wholeFilmInReports: wholeInReports });
  // Task 9: Save PDF… offers A4/Letter, remembered across sessions (`report_paper`); Export CSV… offers including
  // the film in the PDF (`withFilm`, defaulting on — the clinician usually wants it, and — owner, 29 Oct 2026 —
  // remembered per Mac the same way, `report_with_film`). Owner, 29 Oct 2026: the three export options
  // (Profilogram page, Norm sources, Placed by), each OFF by default and remembered the same way.
  const [paper, setPaper] = useState<Paper>('a4');
  useEffect(() => { settings.get('report_paper').then((v) => { if (v === 'a4' || v === 'letter') setPaper(v); }).catch(() => {}); }, []);
  const onPaper = useCallback((p: Paper) => { setPaper(p); settings.set('report_paper', p).catch(() => {}); }, []);
  const [withFilm, setWithFilm] = useState(true);
  useEffect(() => { settings.get('report_with_film').then((v) => { if (v !== null) setWithFilm(v !== '0'); }).catch(() => {}); }, []);
  const onWithFilm = useCallback((on: boolean) => { setWithFilm(on); settings.set('report_with_film', on ? '1' : '0').catch(() => {}); }, []);
  // Library ▸ Select ▸ Export CSV… (spec 2026-10-17, Task 10): several films, one CSV, each worked out as if it were
  // open — its own points and scale, its chosen norms, its changed words, and (NOCLIN-2, preflight-rulings Task 10)
  // the meaning words its own screen would show: the top-bar clinician, else its referrer's saved words, else the
  // login name's. The clinician list is read once per export, each film's clinician through `wordsByFilm`.
  const [csvFor, setCsvFor] = useState<string[] | null>(null);
  const exportFilms = useCallback(async (ids: string[], c: CsvChoice): Promise<boolean> => {
    const [ops, explicit] = norms.loadError ? [{ current: '', names: [] }, null] : await Promise.all([operators.list(), settings.get('operator')]);
    const note = await exportFilmsCsv(ids, c, {
      open: library.open,
      readPicks: async (id) => { const r = await readPicks(settings, id); if (r.error) throw new Error(r.error); return r.value; },
      readWords: async (id) => { const r = await readWords(settings, id); if (r.error) throw new Error(r.error); return r.value; },
      wordsOf: wordsByFilm(settings, { explicit, login: ops.current, names: ops.names }),
      defs, compiled, decimals, norms, titleOf: reportTitle, dateFormat, now: new Date(), normsError: norms.loadError,
      pointFiles: (id: string) => library.pointFiles(id), runs: (id: string) => library.ghosts(id), pointChecks: (id: string) => library.pointChecksForCase(id),
      wholeFilms: (id: string) => library.wholeFilmCheck(id), wholeFilmInReports: wholeInReports,
      salt: () => readSalt(settings), save: (name, bytes) => chooseAndSave('csv', name, bytes) });
    if (note) setLibNotice(note);
    return note !== null;
  }, [norms, defs, compiled, decimals, reportTitle, dateFormat, wholeInReports]);
  const fixedMain = modelList.rows.find((r) => r.main)?.id ?? null;
  // Automatic best (spec §2, D1): the model line names it, not the fixed main model, while it is on.
  const line = modelLine(model?.modelId ?? null, pointSource?.autoBest, autoBestTitle);
  const failedIds = useMemo(() => modelList.rows.filter((r) => kase.extraFailed.includes(r.title)).map((r) => r.id), [modelList.rows, kase.extraFailed]);
  const autoGhost = useMemo(() => autoBestGhost(kase.aiPoints.filter((m) => !failedIds.includes(m.modelId)), fixedMain, pointSource?.autoBest ?? null,
    pointTable, pointSource, reportTitle), [kase.aiPoints, failedIds, fixedMain, pointSource, pointTable, reportTitle]);
  const allGhosts = useMemo(() => withAutoBest(ghostsFrom(kase.aiPoints, modelList.rows, kase.extraFailed, mainIds), autoGhost),
    [kase.aiPoints, modelList.rows, kase.extraFailed, mainIds, autoGhost]);
  // Owner, 28 Oct ("one mark, both names"): merged AFTER hidden-filtering, so a model unticked in the ghost key
  // never merges — Automatic best's own point and hover then stand alone at that id (mergeAutoBestOverlap's own
  // contract: it only drops Automatic best's point for an id when that model's OWN ghost is in the list it is given).
  const ghosts = !sup ? mergeAutoBestOverlap(visibleGhosts(allGhosts, hiddenGhosts)) : null;
  const [modelsOpen, setModelsOpen] = useState(false);
  const onModels = useCallback(() => setModelsOpen(true), []);
  const modelManager = modelsOpen && <ModelManager onLocateModel={() => onLocateModel()}
    base={base} onOpenBestModel={() => { setModelsOpen(false); setSettingsTab('bestModel'); setSettingsOpen(true); }}
    onClose={() => { setModelsOpen(false); modelList.refresh(); modelStatus().then(setModel).catch(() => {});
      models.mainPointSource().then(setPointSource).catch(() => setPointSource(null)); }} />;
  const [analysesOpen, setAnalysesOpen] = useState(false);
  const onAnalyses = useCallback(() => setAnalysesOpen(true), []);
  const placedPoints = useMemo(() => new Set(Object.keys(tracing.points)), [tracing.points]);
  const analysesPicker = analysesOpen && <ChooseAnalyses enabled={shownIds} analyses={allAnalyses} found={found} placed={placedPoints} sets={norms.sets}
    onChange={onChangeAnalyses} onClose={() => setAnalysesOpen(false)} />;
  // Task 10: Settings ▸ Analyses (read-only catalogue browser + DEC-1) and ▸ Norms (clinic default, user-norm
  // editor). Reached from the library and from the Sidebar; closing it re-reads the clinician's own norms and the
  // clinic default (a save/delete there must be reflected without reopening the case).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('analyses');
  const onSettings = useCallback(() => { setSettingsTab('analyses'); setSettingsOpen(true); }, []);
  // Settings › Best model's fold (spec 2026-10-29 §2a): remembered in `best_table_open`, read once, as Enhance's is.
  const [bestTableOpen, setBestTableOpen] = useState(true);
  useEffect(() => { settings.get(BEST_TABLE_KEY).then((v) => setBestTableOpen(foldOpen(v))).catch(() => {}); }, []);
  const onBestTable = useCallback(() => setBestTableOpen((o) => { settings.set(BEST_TABLE_KEY, foldValue(!o)).catch(() => {}); return !o; }), []);
  const bestModel = <BestModelSettings base={base} rows={modelList.rows} titleOf={autoBestTitle} tableOpen={bestTableOpen} onTable={onBestTable}
    onAutoBestUndone={autoBest.undone} dateFormat={dateFormat} />;
  const switchNoteWindow = switchNote && <AutoSwitchNote n={switchNote.n} defaultLabel={clinicDefaultShortLabel(switchNote.clinicDefault, norms.sets)} onClose={closeSwitchNote} />;
  // SC-1 Part 1b Task D2: Settings › Checks. A change of the switch makes the open film read its whole-film view again (off: no note, the CSV cell `off`).
  const onWholeSwitch = useCallback(() => { const id = openIdRef.current; if (id) void readWhole(id); }, [readWhole]);
  const wholeFilmSwitch = <WholeFilmSettings onChanged={onWholeSwitch} inReports={wholeInReports} onInReports={onWholeInReports} />;
  const settingsWindow = settingsOpen && <SettingsWindow autoAdvance={autoAdvance} onAutoAdvance={onAutoAdvance} tab={settingsTab} bestModel={bestModel} wholeFilm={wholeFilmSwitch} found={found} norms={norms}
    decimals={decimals} onDecimals={onDecimals} meanings={meanings} filmDetails={filmDetails} mine={mine} onMineSaved={onMineSaved} onMineDeleted={onMineDeleted}
    dateFormat={dateFormat} onClose={() => { setSettingsOpen(false); norms.refresh(); refreshAutoBest(); }} />;
  const onLocateModel = useCallback(async (): Promise<string | null> => {
    const dir = await open({ directory: true, multiple: false, title: 'Folder containing manifest.json and the .onnx model' });
    if (typeof dir !== 'string') return null;
    // The reason (a Models… model is Ready, so the folder isn't used) is shown in Models… itself, not behind it on the Library.
    try { await setModelDir(dir); setLibError(null); setModel(await modelStatus()); return null; } catch (e) { return String(e); }
  }, []);
  const openCase = useCallback((id: string) => { setReportFor(null); setPage('tracing'); void kase.open(id); }, [kase.open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const openReportOf = useCallback((id: string) => { openCase(id); setReportFor(id); }, [openCase]);
  const toLibrary = useCallback(async () => { setReportFor(null); setCalib(null); fit.close(); await kase.close(); setPage('library'); }, [kase.close, fit.close]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onDelete = useCallback(async (c: CaseSummary) => {
    if (!(await ask(`Move ${shownName(c.patientName)} ${c.timepoint} to Recently deleted? You can restore it for 30 days.`, { title: 'Delete case', kind: 'warning' }))) return;
    library.remove(c.id).then(refresh).catch((e) => setLibError(String(e)));
  }, [refresh]);
  const onRestore = useCallback((id: string) => { library.restore(id).then(refresh).catch((e) => setLibError(String(e))); }, [refresh]);
  const onBackup = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false, title: 'Choose where to save the library backup' });
    if (typeof dir !== 'string') return;
    try { setLibNotice(`Backed up to ${await library.backup(dir)}. The backup contains patient data: keep it on encrypted storage.`); } catch (e) { setLibError(String(e)); }
  }, []);
  const onRestoreBackup = useCallback(async () => {
    if (busyRef.current) { setLibError('Wait for the current import to finish before restoring a backup.'); return; }
    const dir = await open({ directory: true, multiple: false, title: 'Choose an “OpenCephAI backup …” folder' });
    if (typeof dir !== 'string') return;
    if (!(await ask('Replace the library with this backup? The current library is kept in a “replaced-…” folder next to it.', { title: 'Restore backup', kind: 'warning' }))) return;
    // Final review I4: a restore replaces the library, so no Undo carries over (whether or not it succeeded).
    try { await library.restoreBackup(dir); setLibNotice('Library restored from the backup.'); refresh(); } catch (e) { setLibError(String(e)); } finally { libraryReplaced(); }
  }, [refresh]);

  // One keyboard handler for every command (§2 controls, decision 18); inert while typing in a field.
  const stateRef = useRef(tracing); stateRef.current = tracing;
  const viewRef = useRef(view); viewRef.current = view;
  const hasCase = page === 'tracing' && !!kase.bitmap;
  // preflight-rulings Task 8: the film must not change behind the Report preview — arrow keys, P, ⌘Z and Esc all
  // read this same ref, so while the preview is open every one of them is inert (Esc still fires App's own
  // `cancel`/close handling via the preview's own listener, not this one).
  const hasCaseRef = useRef(hasCase); hasCaseRef.current = hasCase && !reportOpen;
  // Final review m-1: the keyboard handler (below) and the Toolbar's Undo button both read this synchronously —
  // a ref, like busyRef just above, since the handler's own effect does not re-subscribe on every render.
  const rulerPendingRef = useRef(kase.rulerPending); rulerPendingRef.current = kase.rulerPending;
  const bitmap = kase.bitmap;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const c = commandFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
        targetTag: t?.tagName, targetType: (t as HTMLInputElement | null)?.type, targetEditable: !!t?.isContentEditable });
      const s0 = stateRef.current;
      if (c?.t === 'undo' && fitUndo.current) { e.preventDefault(); fitUndo.current(); return; }
      if (!c || !applies(c, { hasCase: hasCaseRef.current, hasActivePoint: !!(s0.active && s0.points[s0.active]), calibrating: !!calibRef.current, rulerPending: rulerPendingRef.current })) return;
      e.preventDefault();
      const s = stateRef.current, v = viewRef.current, stage = document.querySelector('.stage') as HTMLElement | null;
      switch (c.t) {
        case 'import': onImport(); break;
        case 'calibrate': setCalib((k) => (k ? null : [])); break;
        // Review M-3 (16 Oct): a point waiting to be placed is cancelled first (its hint says "Esc cancels"), then Choose mode.
        case 'cancel': if (s.active && !s.points[s.active] && !calibRef.current) dispatch({ type: 'cancel' }); else if (chooseRef.current.choose) chooseRef.current.cancel(); else if (calibRef.current) setCalib(null); else dispatch({ type: 'cancel' }); break;
        case 'remove': dispatch({ type: 'remove' }); break;
        case 'undo': dispatch({ type: 'undo' }); break;
        case 'redo': dispatch({ type: 'redo' }); break;
        case 'level': dispatch({ type: 'orient', op: 'level' }); break;
        case 'flip': dispatch({ type: 'orient', op: 'flip' }); break;
        case 'restore': dispatch({ type: 'orient', op: 'restore' }); break;
        case 'rotate': dispatch({ type: 'orient', op: 'rotate', deg: c.deg }); break;
        case 'nudge': dispatch({ type: 'nudge', delta: nudgeVector(s.orientation, c.dx, c.dy) }); break;
        case 'togglePlanes': dispatch({ type: 'toggleAllPlanes' }); break;
        case 'toggleProfilogram': dispatch({ type: 'toggleProfilogram' }); break;
        case 'zoom': if (v && stage) setView(zoomAt(v, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, c.factor)); break;
        case 'fit': if (bitmap && stage) setView(fitOriented(s.orientation, { W: bitmap.width, H: bitmap.height }, stage.clientWidth, stage.clientHeight)); break;
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onImport, bitmap]);

  const dropOverlay = dropping && (
    <div className="drop-overlay" aria-hidden="true"><b>Drop to import</b><span>One film opens for tracing · several are traced as a batch · files stay on this Mac</span></div>);
  if (page === 'library') return (
    <FilmDetailsOff.Provider value={filmDetails.off}>
    <div className="app-library">
      <LibraryView cases={cases} deleted={deleted} batch={batch} busy={kase.busy ?? (kase.batchRunning ? kase.notice : null)} error={libError ?? kase.error} notice={libNotice}
        onOpen={openCase} onImport={onImport} onDelete={onDelete} onRestore={onRestore} onBackup={onBackup} onRestoreBackup={onRestoreBackup} operator={operator} onOperator={onOperator} dateFormat={dateFormat} onDateFormat={onDateFormat} onExportCsv={setCsvFor} view={libraryView} onView={onLibraryView}
        layout={tableLayout} onLayout={onTableLayout} onReport={openReportOf}
        modelNote={<>{model?.loaded ? <>Model: <b>{line}</b></> : <>No model installed.</>} <button type="button" onClick={onModels}>Models…</button> <button type="button" className="primary" onClick={onSettings}>Settings…</button> {autoBestNotes}</>} />
      {dropOverlay}
      {modelManager}
      {settingsWindow}
      {betaSeen === false && <BetaNotice onDismiss={() => { setBetaSeen(true); settings.set(BETA_NOTICE_KEY, '1').catch(() => {}); }} />}
      {switchNoteWindow}
      {csvFor && <CsvDialog count={csvFor.length} onSave={(c) => exportFilms(csvFor, c)} onClose={() => setCsvFor(null)} />}
    </div>
    </FilmDetailsOff.Provider>
  );
  const d = kase.doc;
  return (
    <FilmDetailsOff.Provider value={filmDetails.off}>
    <div className="app">
      <Toolbar state={tracing} dispatch={dispatch} canEdit={!!kase.bitmap} page={sup ? 'superimposition' : 'tracing'} rulerPending={kase.rulerPending}
        title={d ? `${shownName(d.patientName)} · ${d.timepoint}` : kase.busy ?? ' '} onLibrary={toLibrary} onPage={setPage}
        onCalibrate={() => setCalib((k) => (k ? null : []))} calibrating={!!calib}
        onExport={() => setReportOpen(true)} canExport={!!kase.bitmap && !!d && !sup} />
      <Sidebar onImport={onImport} onModels={onModels} onAnalyses={onAnalyses} onSettings={onSettings} model={model} kase={kase} chooser={chooser} patients={patients}
        state={tracing} dispatch={dispatch} scale={scale} readOnly={sup} error={libError ?? (sup ? ser.actionError ?? ser.error : null)} dateFormat={dateFormat} enhanceOpen={enhanceOpen} onEnhance={onEnhance} filmTextOpen={filmTextOpen} onFilmText={onFilmText} patientOpen={patientOpen} onPatient={onPatient}
        ghostKey={{ ghosts: allGhosts, hidden: hiddenGhosts, onToggleModel: onToggleGhostModel, onToggleAll: onToggleAllGhosts, errors: kase.extraErrors }}
        modelLine={line}
        autoBest={<>{autoBestNotes}<AutoBestUnreadableNote unreadable={!!kase.doc && kase.unreadableFor === kase.doc.id} base={model?.modelId ?? null} titleOf={autoBestTitle} /></>}
        series={series && <><SeriesKey lines={series.lines} hint={series.hint} onTick={(id, on) => void ser.setInSeries(id, on)} onStage={(id, s) => void ser.setStage(id, s)} onFit={onFit}
          onCalibrateNow={(id) => void calibrateNow(id)} onScaleNow={scaleNow} />
          {fit.active && fit.draft && <FitPanel draft={fit.draft} refs={references(ser.films, fit.draft.film).map((f) => ({ id: f.id, label: f.timepoint }))}
            busy={fit.busy} error={fit.error} notice={fit.notice} canSave={!!toSave(fit.draft)} onRef={(id) => void startFit(fit.draft!.film, id)} act={fit.act}
            onSave={() => void fit.save()} onReset={fit.reset} onRemove={() => void fit.remove()} onCancel={fit.close} />}</>}
        // Part D task 11: the case's reference population picker and "Compare populations…" (CasePanel's Patient
        // section, ruling P26). `norms` is the same NormContext (sets/userNorms/clinicDefault) normFor
        // resolves against; `compareRows` is the open film's measurement rows (see above).
        norms={norms} decimals={decimals} compareRows={compareRows} scaleNote={scaleNoteOf(scale)}
        // NORM-PICK-1 and I-2: the case's chosen sources (choosing is off on the read-only Superimposition page), the
        // per-row unconfirmed-AI-point list, and whether the user norms failed to read (M-8).
        normExtras={{ picks: normPicks.picks, onPick: sup ? null : normPicks.pick, unconfirmedFor, userNormsFailed: norms.userNormsFailed }} />
      <CephCanvas bitmap={kase.bitmap} state={canvasState} fitLayer={fitLayer} fitInput={fitInput} fitMarks={fitMarks} dispatch={dispatch} view={view} setView={setView}
        // Fix round 1 (review I2): a mouse drag is a separate code path from the keyboard commands hasCaseRef
        // already gates (CephCanvas's own onPointerDown/onPointerMove), and was until now stopped only by the
        // modal backdrop's CSS stacking — incidental, not an explicit guard. `readOnly` already disables placing,
        // choosing, point-dragging and alt-drag rotate (every other check in CephCanvas.tsx reads it the same way).
        registry={registry} mmPerPx={scale.mmPerPx} assumedScale={isAssumed(scale)} readOnly={sup || reportOpen} drawn={drawn}
        compare={series?.tracings ?? null} own={series?.own ?? null}
        // Final review Minor 1: chooser is ALSO nulled while the Report preview is open, not just by `readOnly`
        // above (which already keeps ChooseLayer unmounted, so the Enter listener is already gone) — Choose mode
        // must not act behind the preview, by an explicit check here, the same way hasCaseRef explicitly guards
        // the other keys, rather than depending only on CephCanvas's internal render gate to remove the listener.
        calib={calib} onCalibrationClick={(p) => setCalib((k) => (k && k.length < 2 ? [...k, p] : k))} onCalibrationHover={setCalibHover} onCalibrationMove={sup ? undefined : moveMark} chooser={sup || reportOpen ? null : chooser} ghosts={ghosts} caseId={d?.id ?? null} decimals={decimals} bars={sup ? undefined : kase.modelBars}
        rulerMarks={rulerMarks.marks} onRulerMove={rulerMarks.onMove} onRulerEnd={rulerMarks.onEnd} signedOff={!!d?.verifiedAt} checks={pointChecks} checkLines={checkLines}
        filmChecks={filmChecks} canCheck={!sup && !reportOpen && !d?.verifiedAt} onFilmChecked={onFilmChecked}
        wholeCheck={wholeShown} canCheckWhole={!sup && !reportOpen} wholeAsking={wholeShown != null && wholeAsking === wholeShown.id} onWholeAsk={setWholeAsking} onWholeResolve={onWholeResolve} />
      <Inspector autoAdvance={autoAdvance} bitmap={drawn} state={tracing} dispatch={dispatch} defs={defs} registry={registry} compiled={compiled} values={values} scale={scale} change={series?.change ?? null}
        dateFormat={dateFormat}
        otherPointsOpen={otherPointsOpen} onOtherPoints={onOtherPoints} decimals={decimals}
        normFor={normFor} normsError={normsErrorMessage(norms.loadError, [norms.settingsError, normPicks.error].filter(Boolean).join(' ') || null)}
        normQueryFor={normQueryFor} onPickNorm={sup ? null : normPicks.pick} unconfirmedFor={unconfirmedFor} placedLineFor={placedLineFor} placedWhyFor={placedWhyFor} meaningWords={meanings.words} ruler={sup ? null : ruler ?? rulerMarks.loupe} filmTimepoint={d?.timepoint}
        // Fix round 1 (review Minor 5): the Inspector's "calibrate to show" link always OPENS the ruler tool —
        // unlike the toolbar's own Calibrate button, it never toggles an already-active one off. Its purpose is
        // "go calibrate", not "toggle calibrating".
        // I8 (feat/report-exports merged in): the Inspector locks the same way the canvas already does — the status
        // row's Accept position / Accept remaining / Mark tracing verified must not act behind the Report preview.
        onCalibrate={() => setCalib([])} readOnly={sup || reportOpen} found={found}
        // Part D task 9: who finds each point (PointAbout). The unconfirmed-AI-point marks come from `unconfirmedFor` above.
        pointTable={pointTable}
        // Spec 2026-10-19 (V1): the open film's sign-off, shown in the status row beside Accept position.
        signOff={signOffShown}
        // Spec 2026-10-20 (MS6): "Use for this machine" beside a ruler film's scale line.
        machine={kase.doc?.machine ?? null} onUseForMachine={kase.useForMachine}
        // Spec 2026-10-19 Addendum 3: the − / + beside the scale line; disabled (not hidden) on the read-only
        // page, while the report preview is open, while busy, while calibrating, or while a press is in flight.
        fineTune={fineTuneOf(tracing.ruler, scale, !sup && !reportOpen && !kase.busy && !calib && !kase.adjusting, (d) => void kase.adjustScale(d, rulerMarks.pending))}
        // Owner G1 (Task 9): the tracing page's own "not scaled" advice, built the same way as the Superimposition key's.
        // Owner G2 (Task 10): a fitted film with no ruler gets "Use the scale from the fit" instead; a ruler film with a fit
        // is offered no switch, and says why (a ruler always wins).
        advice={!sup && d && pages.offer === 'ruler' ? <FitOwnLocked />
          : !sup && d && pages.offer === 'machine' ? <FitOwnLocked why="machine" />
          : !sup && d && typeof pages.offer === 'object' && pages.offer ? <FitOwnLine timepoint={d.timepoint} note={pages.offer.note} on={pages.offer.on} busy={!!kase.busy} onChange={(on) => void kase.setFitOwn(on)} />
          : tracingAdvice && <ScaleAdvice a={tracingAdvice} onCalibrate={() => void calibrateNow(tracingAdvice.film)} onScale={() => scaleNow(tracingAdvice.film)} />} />
      {calib?.length === 2 && <CalibrateDialog p1={calib[0]} p2={calib[1]} onCancel={() => setCalib(null)}
        onSave={async (mm) => { await kase.calibrate(calib[0], calib[1], mm); setCalib(null); }} />}
      {dropOverlay}
      {modelManager}
      {analysesPicker}
      {settingsWindow}
      {switchNoteWindow}
      {reportOpen && <ReportPreview model={report.model} problem={report.problem} decimals={decimals} figureInput={reportFigure}
        film={report.film} words={report.words} paper={paper} withFilm={withFilm} options={reportOptions} print={report.print} onClose={() => setReportOpen(false)}
        actions={report.model && <ReportActions paper={paper} onPaper={onPaper} withFilm={withFilm} onWithFilm={onWithFilm} options={reportOptions} onOptions={onReportOptions} film={report.film}
          onSavePdf={() => report.savePdf(paper, withFilm, reportOptions)} onSaveCsv={report.saveCsv} />} />}
    </div>
    </FilmDetailsOff.Provider>
  );
}
