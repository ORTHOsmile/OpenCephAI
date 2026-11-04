import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { compile, type Value, type Vec2 } from '@ceph/geometry';
import { ALL_ANALYSES, buildRegistry, foundBy, resolveNorm, type MyAnalysis } from '@ceph/analyses';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { library, models, modelStatus, setModelDir, settings, type CaseSummary, type ModelPointRow, type ModelStatus, type SeriesFilm, type Stage } from './ipc';
import { CephCanvas } from './canvas/CephCanvas';
import { Sidebar } from './layout/Sidebar';
import { Inspector } from './layout/Inspector';
import { Toolbar } from './layout/Toolbar';
import { CalibrateDialog } from './layout/CalibrateDialog';
import { LibraryView } from './library/LibraryView';
import { useCase } from './library/useCase';
import { useChoose } from './library/useChoose';
import { upgradeNotice } from './library/upgradeNotice';
import { DATE_FORMAT_KEY, parseDateFormat, type DateFormat } from './dates';
import { useSeries } from './compare/useSeries';
import { SeriesKey } from './layout/SeriesKey';
import { ModelManager } from './manager/ModelManager';
import { useModels } from './manager/useModels';
import { ghostsFrom, mainSuggestions, readyOtherIds, upgradeHidden, visibleGhosts } from './ghosts/ghosts';
import { alignOnSN } from './compare/align';
import { autoStage, filmLabel, hideUncalibrated, looks, pairLabels, pickPair, seriesRows, stageOf, usable } from './compare/series';
import { parseOverlays } from './library/persist';
import { CEPH_EXTENSIONS, pickDroppedCephs, refusedMessage } from './importFile';
import { initialTracing, positions, superimpositionView, tracingReducer } from './tracing/state';
import { scaleOf } from './tracing/spacing';
import { useSharpened } from './canvas/sharpen';
import { applies, commandFor } from './input/keymap';
import { nudgeVector } from './canvas/dragMath';
import { fitOriented } from './canvas/orientation';
import { zoomAt, type Viewport } from './canvas/viewport';
import { shownName } from './library/identity';
import { DECIMALS_KEY, DEFAULT_DECIMALS, readDecimals, type Decimals } from './format';
import { SettingsWindow } from './settings/SettingsWindow';
import { useNorms } from './norms/useNorms';
import { normCell, normsErrorMessage, queryFor } from './norms/normCell';
import { measurementRows, placerOf, unconfirmedAiPoints, type MeasurementRow } from './measurements';
import { type MainPointSource } from './ai/placement';
import { isFallback, placedByLine } from './ai/placedBy';
import { useNormPicks } from './norms/useNormPicks';
import { DEFAULT_ENABLED, ENABLED_KEY, enableNew, forgetEnabled, mergeEnabled, parseEnabled, shownDefs, visibleEnabled } from './analyses/enabled';
import { ChooseAnalyses } from './analyses/ChooseAnalyses';
import { announceClinician, useMeanings } from './settings/useMeanings';
import { useMyAnalyses } from './settings/useMyAnalyses';
import { useFilmDetailsOff } from './settings/useFilmDetails';
import { FilmDetailsOff } from './settings/filmDetails';

type Page = 'library' | 'tracing' | 'superimposition';

export default function App() {
  const [page, setPage] = useState<Page>('library');
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
  const kase = useCase(tracing, dispatch, refresh);
  // Owner MEANING-PER-CLINICIAN (16 Oct) + NOCLIN-2 (17 Oct, ruling, item 34): the clinician's wording
  // for the meanings — top bar, else the open film's Referring practitioner (if they have saved words), else the
  // Mac login name. Must follow `kase`: it re-resolves whenever the open film (and so its referrer) changes.
  const meanings = useMeanings(kase.doc?.referringPractitioner ?? null);
  const modelList = useModels();   // needed early: the ghosts_hidden upgrade (below) seeds itself from the model catalogue
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
  const scale = scaleOf(kase.doc?.spacingMm);
  const values = useMemo(() => compiled.evaluate(positions(tracing), scale.mmPerPx), [compiled, tracing.points, scale.mmPerPx]);   // eslint-disable-line react-hooks/exhaustive-deps
  const patients = useMemo(() => [...new Set(cases.map((c) => c.patientName).filter((n) => n.trim()))].sort((a, b) => a.localeCompare(b)), [cases]);
  const drawn = useSharpened(kase.bitmap, tracing.display.sharpness);   // Enhance › Sharpness: display only

  // Compare with… (spec Part 3): the other scan aligned on S–N at S, and its T1 → T2 change table.
  const sup = page === 'superimposition';
  const ser = useSeries(kase.doc, sup && !!kase.bitmap, cases);
  const [pairChoice, setPairChoice] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => setPairChoice(null), [kase.doc?.id]);
  const series = useMemo(() => {
    const d = kase.doc;
    if (!sup || !d) return null;
    const ticked = usable(ser.films, d.id, ser.failed);
    const stages = ticked.map((f, i) => stageOf(f as { stage: Stage | null }, i, ticked.length));
    const look = looks(stages);
    const own = look[ticked.findIndex((f) => f.id === d.id)] ?? null;
    const mine = positions(tracing);
    const tracings: { id: string; points: Record<string, Vec2>; colour: string; dash?: string }[] = [];
    const cols: Record<string, Value | null>[] = [];
    // N5: which ticked films (same order as `cols`) are not ruler-calibrated — `hideUncalibrated` uses this to hide
    // their mm values in the Change table, so a change in mm is never worked out from an assumed-scale film.
    const uncalibrated: boolean[] = [];
    let assumed = scale.source === 'assumed';
    ticked.forEach((f, i) => {
      if (f.id === d.id) { cols.push(values); uncalibrated.push(scale.source === 'assumed'); return; }
      const o = ser.docs[f.id];
      if (!o) { cols.push({}); uncalibrated.push(true); return; }
      const pos = Object.fromEntries(o.landmarks.map((l) => [l.id, { x: l.x, y: l.y }])) as Record<string, Vec2>;
      const sc = scaleOf(o.spacingMm); assumed ||= sc.source === 'assumed';
      cols.push(compiled.evaluate(pos, sc.mmPerPx));
      uncalibrated.push(sc.source === 'assumed');
      const al = alignOnSN(mine, pos, sc.mmPerPx / scale.mmPerPx, o.facing !== d.facing);
      if (al) tracings.push({ id: f.id, points: Object.fromEntries(Object.entries(pos).map(([k, p]) => [k, al(p)])), ...look[i] });
    });
    const label = (f: SeriesFilm) => filmLabel(f, dateFormat);
    const ids = ticked.map((f) => f.id), pair = pickPair(ids, pairChoice);
    const lines = ser.films.map((f) => { const i = ticked.indexOf(f), o = ser.docs[f.id];
      const hasSN = f.id === d.id ? !!(tracing.points.S && tracing.points.N) : !!o && ['S', 'N'].every((k) => o.landmarks.some((l) => l.id === k));
      return { id: f.id, label: label(f) + (f.nameOnly ? ' (no DOB)' : ''), ticked: i >= 0, open: f.id === d.id, stage: f.stage as Stage | null,
        auto: i >= 0 ? autoStage(i, ticked.length) : null, look: i >= 0 ? look[i] : null,
        note: ser.failed.has(f.id) ? 'Couldn’t open this film' : i >= 0 && (f.id === d.id || o) && !hasSN ? 'Place S and N to draw it' : null }; });
    // P13 (Task 6): the chosen analyses, not a fixed BUILT_INS.
    const change = pair ? { heads: ticked.map(label), ids, rows: hideUncalibrated(seriesRows(defs, cols), uncalibrated), pair, onPair: setPairChoice,
      labels: pairLabels(ticked, dateFormat),
      note: assumed ? 'mm on a film not yet calibrated are hidden: calibrate each film from its ruler (K). Angles are unaffected.' : null } : null;
    const hint = d.patientKey.startsWith('~') ? 'Name the patient to compare their films' : null;
    return { tracings, own, lines, change, hint };
  }, [sup, kase.doc, ser.films, ser.docs, ser.failed, tracing.points, values, compiled, scale.mmPerPx, scale.source, dateFormat, pairChoice, defs]);   // eslint-disable-line react-hooks/exhaustive-deps


  const overlaysReady = useRef(false);
  useEffect(() => {
    settings.get('overlays').then((j) => { const o = parseOverlays(j); if (o) dispatch({ type: 'setOverlays', overlays: o }); })
      .catch(() => {}).finally(() => { overlaysReady.current = true; });
  }, []);
  useEffect(() => { if (overlaysReady.current) settings.set('overlays', JSON.stringify(tracing.overlays)).catch(() => {}); }, [tracing.overlays]);
  useEffect(() => { settings.get('operator').then((v) => setOperator(v ?? '')).catch(() => {}); }, []);
  useEffect(() => { settings.get(DATE_FORMAT_KEY).then((v) => setDateFormat(parseDateFormat(v))).catch(() => {}); }, []);
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
  // I3 (owner, 5 Oct): this WAS a useRef. A ref's own change does not re-run an effect — only a dependency changing
  // does — so when `modelList.rows` arrived BEFORE the async settings.get('ghosts_shown') resolved, the upgrade
  // effect below ran once with the flag still undefined, returned early, and never ran again: no further change to
  // `modelList.rows` was coming, so the upgrade silently never happened (and would repeat every launch, since
  // ghostsSeeded.current was never set true either). useState makes the flag's own arrival a dependency the effect
  // reacts to.
  const [ghostsUpgradeFlag, setGhostsUpgradeFlag] = useState<string | null | undefined>(undefined);   // '0'/'1'/null once known, else undefined
  useEffect(() => {
    settings.get('ghosts_hidden').then((stored) => {
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
  // Blank means "use the macOS login name" (ceph-store's operator() treats blank as unset).
  const onOperator = useCallback((name: string) => {
    settings.set('operator', name).then(() => { setOperator(name); announceClinician(); setLibNotice(name ? `Edits and sign-offs are now recorded as ${name}.` : 'Edits are recorded under your macOS login name.'); })
      .catch((e) => setLibError(String(e)));
  }, []);
  useEffect(() => { refresh(); modelStatus().then(setModel).catch((e) => setLibError(String(e))); }, [refresh]);

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
  const unconfirmedFor = useCallback((node: string) => unconfirmedAiPoints(node, compiled, tracing.points, pointTable,
    (pid) => placerOf(pid, tracing.points[pid], kase.placedBy, aiRuns)), [compiled, tracing.points, pointTable, kase.placedBy, aiRuns]);
  // Task 3 (spec 2026-10-13 §5.1 "Shown"): each AI point's source line. The source table is embedded in the app, so it is
  // read once; the fallback note is derived here, never stored, so it reads the same after closing and reopening.
  const [pointSource, setPointSource] = useState<MainPointSource | null>(null);
  useEffect(() => { models.mainPointSource().then(setPointSource).catch(() => setPointSource(null)); }, []);
  const placedLineFor = useCallback((pid: string) => {
    if (tracing.points[pid]?.source !== 'ai') return null;
    const mainId = pointTable?.find((r) => r.main)?.modelId ?? null;
    const titleOf = (m: string) => pointTable?.find((r) => r.modelId === m)?.title ?? m;
    const placer = placerOf(pid, tracing.points[pid], kase.placedBy, aiRuns);
    return placedByLine(pid, placer, mainId, isFallback(placer, mainId, pointSource, pid), titleOf, pointSource);
  }, [tracing.points, kase.placedBy, aiRuns, pointTable, pointSource]);
  const allGhosts = useMemo(() => ghostsFrom(kase.aiPoints, modelList.rows, kase.extraFailed, mainIds), [kase.aiPoints, modelList.rows, kase.extraFailed, mainIds]);
  const ghosts = !sup ? visibleGhosts(allGhosts, hiddenGhosts) : null;
  const [modelsOpen, setModelsOpen] = useState(false);
  const onModels = useCallback(() => setModelsOpen(true), []);
  const modelManager = modelsOpen && <ModelManager onLocateModel={() => void onLocateModel()}
    onClose={() => { setModelsOpen(false); modelList.refresh(); modelStatus().then(setModel).catch(() => {}); }} />;
  const [analysesOpen, setAnalysesOpen] = useState(false);
  const onAnalyses = useCallback(() => setAnalysesOpen(true), []);
  const placedPoints = useMemo(() => new Set(Object.keys(tracing.points)), [tracing.points]);
  const analysesPicker = analysesOpen && <ChooseAnalyses enabled={shownIds} analyses={allAnalyses} found={found} placed={placedPoints} sets={norms.sets}
    onChange={onChangeAnalyses} onClose={() => setAnalysesOpen(false)} />;
  // Task 10: Settings ▸ Analyses (read-only catalogue browser + DEC-1) and ▸ Norms (clinic default, user-norm
  // editor). Reached from the library and from the Sidebar; closing it re-reads the clinician's own norms and the
  // clinic default (a save/delete there must be reflected without reopening the case).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const onSettings = useCallback(() => setSettingsOpen(true), []);
  const settingsWindow = settingsOpen && <SettingsWindow tab="analyses" found={found} norms={norms}
    decimals={decimals} onDecimals={onDecimals} meanings={meanings} filmDetails={filmDetails} mine={mine} onMineSaved={onMineSaved} onMineDeleted={onMineDeleted}
    dateFormat={dateFormat} onClose={() => { setSettingsOpen(false); norms.refresh(); }} />;
  const onLocateModel = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false, title: 'Folder containing manifest.json and the .onnx model' });
    if (typeof dir !== 'string') return;
    try { await setModelDir(dir); setLibError(null); setModel(await modelStatus()); } catch (e) { setLibError(String(e)); }
  }, []);
  const openCase = useCallback((id: string) => { setPage('tracing'); void kase.open(id); }, [kase.open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const toLibrary = useCallback(async () => { setCalib(null); await kase.close(); setPage('library'); }, [kase.close]);   // eslint-disable-line react-hooks/exhaustive-deps
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
    try { await library.restoreBackup(dir); setLibNotice('Library restored from the backup.'); refresh(); } catch (e) { setLibError(String(e)); }
  }, [refresh]);

  // One keyboard handler for every command (§2 controls, decision 18); inert while typing in a field.
  const stateRef = useRef(tracing); stateRef.current = tracing;
  const viewRef = useRef(view); viewRef.current = view;
  const hasCase = page === 'tracing' && !!kase.bitmap;
  const hasCaseRef = useRef(hasCase); hasCaseRef.current = hasCase;
  const bitmap = kase.bitmap;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const c = commandFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
        targetTag: t?.tagName, targetType: (t as HTMLInputElement | null)?.type, targetEditable: !!t?.isContentEditable });
      const s0 = stateRef.current;
      if (!c || !applies(c, { hasCase: hasCaseRef.current, hasActivePoint: !!(s0.active && s0.points[s0.active]), calibrating: !!calibRef.current })) return;
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
        onOpen={openCase} onImport={onImport} onDelete={onDelete} onRestore={onRestore} onBackup={onBackup} onRestoreBackup={onRestoreBackup} operator={operator} onOperator={onOperator} dateFormat={dateFormat} onDateFormat={onDateFormat}
        modelNote={<>{model?.loaded ? <>Model: <b>{model.modelId}</b></> : <>No model installed.</>} <button type="button" onClick={onModels}>Models…</button> <button type="button" onClick={onSettings}>Settings…</button></>} />
      {dropOverlay}
      {modelManager}
      {settingsWindow}
    </div>
    </FilmDetailsOff.Provider>
  );
  const d = kase.doc;
  return (
    <FilmDetailsOff.Provider value={filmDetails.off}>
    <div className="app">
      <Toolbar state={tracing} dispatch={dispatch} canEdit={!!kase.bitmap} page={sup ? 'superimposition' : 'tracing'}
        title={d ? `${shownName(d.patientName)} · ${d.timepoint}` : kase.busy ?? ' '} onLibrary={toLibrary} onPage={setPage}
        onCalibrate={() => setCalib((k) => (k ? null : []))} calibrating={!!calib} />
      <Sidebar onImport={onImport} onModels={onModels} onAnalyses={onAnalyses} onSettings={onSettings} model={model} kase={kase} chooser={chooser} patients={patients}
        state={tracing} dispatch={dispatch} scale={scale} readOnly={sup} error={libError ?? (sup ? ser.actionError ?? ser.error : null)} dateFormat={dateFormat} enhanceOpen={enhanceOpen} onEnhance={onEnhance} filmTextOpen={filmTextOpen} onFilmText={onFilmText}
        ghostKey={{ ghosts: allGhosts, hidden: hiddenGhosts, onToggleModel: onToggleGhostModel, onToggleAll: onToggleAllGhosts, errors: kase.extraErrors }}
        series={series && <SeriesKey lines={series.lines} hint={series.hint} onTick={(id, on) => void ser.setInSeries(id, on)} onStage={(id, s) => void ser.setStage(id, s)} />}
        // Part D task 11: the case's reference population picker and "Compare populations…" (CasePanel's Patient
        // section, ruling P26). `norms` is the same NormContext (sets/userNorms/clinicDefault) normFor
        // resolves against; `compareRows` is the open film's measurement rows (see above).
        norms={norms} decimals={decimals} compareRows={compareRows}
        // NORM-PICK-1 and I-2: the case's chosen sources (choosing is off on the read-only Superimposition page), the
        // per-row unconfirmed-AI-point list, and whether the user norms failed to read (M-8).
        normExtras={{ picks: normPicks.picks, onPick: sup ? null : normPicks.pick, unconfirmedFor, userNormsFailed: norms.userNormsFailed }} />
      <CephCanvas bitmap={kase.bitmap} state={sup ? superimpositionView(tracing) : tracing} dispatch={dispatch} view={view} setView={setView}
        registry={registry} mmPerPx={scale.mmPerPx} assumedScale={scale.source === 'assumed'} readOnly={sup} drawn={drawn}
        compare={series?.tracings ?? null} own={series?.own ?? null}
        calib={calib} onCalibrationClick={(p) => setCalib((k) => (k && k.length < 2 ? [...k, p] : k))} onCalibrationHover={setCalibHover} onCalibrationMove={sup ? undefined : moveMark} chooser={sup ? null : chooser} ghosts={ghosts} caseId={d?.id ?? null} decimals={decimals} bars={sup ? undefined : kase.modelBars} />
      <Inspector bitmap={drawn} state={tracing} dispatch={dispatch} defs={defs} registry={registry} compiled={compiled} values={values} scale={scale} change={series?.change ?? null}
        otherPointsOpen={otherPointsOpen} onOtherPoints={onOtherPoints} decimals={decimals}
        normFor={normFor} normsError={normsErrorMessage(norms.loadError, [norms.settingsError, normPicks.error].filter(Boolean).join(' ') || null)}
        normQueryFor={normQueryFor} onPickNorm={sup ? null : normPicks.pick} unconfirmedFor={unconfirmedFor} placedLineFor={placedLineFor} meaningWords={meanings.words} ruler={sup ? null : ruler}
        // Fix round 1 (review Minor 5): the Inspector's "calibrate to show" link always OPENS the ruler tool —
        // unlike the toolbar's own Calibrate button, it never toggles an already-active one off. Its purpose is
        // "go calibrate", not "toggle calibrating".
        onCalibrate={() => setCalib([])} readOnly={sup} found={found}
        // Part D task 9: who finds each point (PointAbout). The unconfirmed-AI-point marks come from `unconfirmedFor` above.
        pointTable={pointTable} />
      {calib?.length === 2 && <CalibrateDialog p1={calib[0]} p2={calib[1]} onCancel={() => setCalib(null)}
        onSave={async (mm) => { await kase.calibrate(calib[0], calib[1], mm); setCalib(null); }} />}
      {dropOverlay}
      {modelManager}
      {analysesPicker}
      {settingsWindow}
    </div>
    </FilmDetailsOff.Provider>
  );
}
