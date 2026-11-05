import type { PopulationChoice } from '@ceph/analyses';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisDef } from '@ceph/geometry';
import type { CaseDoc, PointCheckView } from '../ipc';
import { settings } from '../ipc';
import type { MeasurementRow } from '../measurements';
import type { NormCell } from '../norms/normCell';
import type { DateFormat } from '../dates';
import type { Scale } from '../tracing/spacing';
import type { TracingPoint, Display } from '../tracing/state';
import type { Orientation } from '../canvas/orientation';
import type { Decimals } from '../format';
import { buildReport, DEFAULT_REPORT_OPTIONS, headerLines, modelsUsed, reportTexts, type ReportModel, type ReportOptions } from './model';
import { reportPoints } from './points';
import { useReportWords } from './useReportWords';
import { latin1 } from './pdfText';
import { isCjk, cachedCjkSearch, type SysFont } from './systemFont';
import { loadFonts, type PdfFonts } from './fonts';
import { filmJpeg } from './filmImage';
import { chooseAndSave } from './save';
import { figure, figureFit, profilogramShapes, type FigureInput } from './shapes';
import { pageOneBoxes, profilogramBox, type Paper } from './page';
import { csvBytes } from '../export/csv';
import { measurementsCsv, readSalt } from '../export/measurementsCsv';
import type { ReportWords } from './words';
import type { CsvChoice } from './CsvOptions';

export interface UseReportInput {
  open: boolean; doc: CaseDoc | null; rows: MeasurementRow[]; normFor: ((r: MeasurementRow) => NormCell | null) | null; normsError: string | null;
  words: (node: string) => { high: string; low: string } | undefined; points: Record<string, TracingPoint>;
  placer: (id: string) => string | null; titleOf: (modelId: string) => string; scale: Scale; dateFormat: DateFormat;
  /** R3: App's own `defs` (today `shownDefs(enabledIds, mine.list)`, never `enabledDefs` recomputed in here) — only
   *  used to find each row's My-analysis def (isMine) for `ReportBlock.unavailable`. */
  defs: AnalysisDef[];
  /** Task 9: what Save PDF… needs that the preview did not — the film as the screen currently shows it (for
   *  `filmJpeg`), and the figure's own input (for the page-1 drawing at save time, independent of the preview's). */
  bitmap: ImageBitmap | null; orientation: Orientation; display: Display; decimals: Decimals; figureInput: FigureInput | null;
  /** Part F Task 13: each AI point's model file (`library.pointFiles`); absent (other callers' fixtures) reads as none. */
  pointFiles?: Record<string, string>;
  /** Task 9: Automatic best's own mark per point (`landmarks.placed_via`, format 15), `'auto-best'` when Automatic best
   *  placed it; absent (other callers' fixtures, or a film traced before format 15) reads as none. */
  via?: (id: string) => string | null;
  /** Owner decision 1 (29 Oct 2026): how Auto chose the case's population (casePopulationChoice); null when chosen by hand. */
  populationChoice?: PopulationChoice | null;
  /** Stage A: the open film's stored point check (what the screen shows), for the Points table's last column; absent or null reads as blank. */
  pointCheck?: PointCheckView | null;
  /** Why the report must not be exported yet: the film's point check is unread or its read failed (blank cells would read as
   *  "nothing flagged"). null/absent: fine. */
  pointCheckProblem?: string | null;
}
/** The open film's report: the Measurements tab's own rows and norm cells (R3: the analyses switched on), the
 *  clinician's words (MEANING-PER-CLINICIAN) and this film's changed words (R2) — plus (Task 9) the film image for
 *  the PDF, the PDF's fonts (FONT-1 embedded Noto, FONT-2 this computer's own CJK font) and the two save actions. */
export function useReport(i: UseReportInput) {
  const words = useReportWords(i.open ? i.doc?.id ?? null : null);
  const make = (edits: ReportWords, now: Date): ReportModel => {
    const normFor = i.normFor!, cells = i.rows.map((r) => normFor(r));
    const models = modelsUsed(Object.entries(i.points).map(([id, p]) => ({ source: p.source, placer: i.placer(id) })), i.titleOf);
    const points = reportPoints(i.points, i.placer, i.titleOf, i.pointFiles ?? {}, i.via, i.pointCheck ?? null);
    return buildReport({ doc: i.doc!, rows: i.rows, cells, defs: i.defs, words: i.words, edits, scale: i.scale, models, dateFormat: i.dateFormat, now, points, populationChoice: i.populationChoice ?? null });
  };
  const model = useMemo<ReportModel | null>(() => (i.open && i.doc && i.normFor ? make(words.words, new Date()) : null),
    [i.open, i.doc, i.rows, i.normFor, i.defs, i.words, i.points, i.placer, i.titleOf, i.scale.mmPerPx, i.scale.source, i.dateFormat, words.words, i.pointFiles, i.via, i.populationChoice, i.pointCheck]);   // eslint-disable-line react-hooks/exhaustive-deps
  const problem = !i.open || model ? null : i.normsError ? `Norms couldn't be loaded, so the report can't be made: ${i.normsError}` : 'Open a film to make its report.';

  // The film for the PDF, made when the preview opens (and again if the view of the film changes).
  const [film, setFilm] = useState<string | null | 'loading'>(null);
  useEffect(() => {
    if (!i.open || !i.bitmap) { setFilm(null); return; }
    let gone = false;
    setFilm('loading');
    filmJpeg(i.bitmap, i.orientation, i.display).then((j) => { if (!gone) setFilm(j); }).catch(() => { if (!gone) setFilm(null); });
    return () => { gone = true; };
  }, [i.open, i.bitmap, i.orientation, i.display]);

  // The PDF's embedded font (FONT-1), loaded once when the preview first opens.
  const [fonts, setFonts] = useState<PdfFonts | null>(null), [fontError, setFontError] = useState<string | null>(null);
  useEffect(() => {
    if (!i.open || fonts) return;
    loadFonts().then(setFonts).catch((e) => setFontError(e instanceof Error ? e.message : String(e)));
  }, [i.open, fonts]);

  // FONT-2 (preflight-rulings Task 9 wiring): the CJK code points this report actually needs — computed ONCE PER
  // REPORT MODEL (carry-over (b): not recomputed on every render or every save) — then searched for on this
  // computer, at most once per distinct set for the life of the session (`cachedCjkSearch`, its own test file).
  const need = useMemo(() => (model ? [...new Set(reportTexts(model).flatMap((t) => [...t]).map((c) => c.codePointAt(0)!).filter(isCjk))] : []), [model]);
  const cjkCache = useRef(new Map<string, Promise<SysFont>>());
  const [cjk, setCjk] = useState<SysFont>(null), [searching, setSearching] = useState(false);
  useEffect(() => {
    if (need.length === 0) { setSearching(false); return; }
    let gone = false;
    setSearching(true);
    cachedCjkSearch(cjkCache.current, need).then((sys) => { if (!gone) setCjk(sys); }).finally(() => { if (!gone) setSearching(false); });
    return () => { gone = true; };
  }, [need]);

  const savePdf = async (paper: Paper, withFilm: boolean, options: ReportOptions = DEFAULT_REPORT_OPTIONS): Promise<boolean> => {
    if (!i.figureInput || !i.doc || !i.normFor) return false;
    if (i.pointCheckProblem) throw new Error(i.pointCheckProblem);
    if (!fonts) throw new Error(fontError ?? 'the PDF font is still loading; try again in a moment');
    if (searching) throw new Error("Still looking for this computer's font for Chinese, Japanese or Korean letters; try again in a moment.");
    const now = new Date();   // preflight-rulings Task 9 Minor: one `now` for make() AND buildPdf, so they never straddle midnight.
    const m = make(await words.flush(), now);
    // Same guard as ReportPreview.tsx's own `onFilm` (both found wanting by a Task 9 positive control): an empty
    // string must count as "no film", not "has a film", or a broken `filmJpeg` would silently embed garbage.
    const onFilm = withFilm && typeof film === 'string' && film !== 'loading' && film.length > 0;
    const headerCount = headerLines(m.header).length;
    const fig = figure(i.figureInput, pageOneBoxes(paper, headerCount).film, onFilm);
    // Owner, 29 Oct 2026 (item 1): the profilogram, on its own page, never over the film — built only when the
    // tick-box is on, so a report with it off never pays for the extra work and prints the same bytes as before
    // this feature existed.
    const profilogram = options.profilogramPage
      ? profilogramShapes(i.figureInput.points, i.figureInput.orientation, i.figureInput.dims, figureFit(i.figureInput.orientation, i.figureInput.dims, profilogramBox(paper)), { registry: i.figureInput.registry, overlays: i.figureInput.overlays })
      : null;
    const { buildPdf } = await import('./pdf');
    const bytes = buildPdf({ model: m, paper, decimals: i.decimals, fonts: { ...fonts, cjk }, options,
      figure: { shapes: fig.shapes, film: onFilm ? { jpeg: film as string, ...fig.img } : null }, profilogram }, now);
    return chooseAndSave('pdf', `OpenCephAI report ${m.header.patient} ${m.film.timepoint} ${m.film.takenOn ?? ''}`, bytes, i.doc.id);
  };
  const saveCsv = async (c: CsvChoice): Promise<boolean> => {
    if (!i.doc || !i.normFor) return false;
    if (i.pointCheckProblem) throw new Error(i.pointCheckProblem);
    const now = new Date();
    const m = make(await words.flush(), now), at = now.toISOString();
    const salt = c.anonymise ? await readSalt(settings) : '';
    const csv = measurementsCsv([m], { ...c, salt, exportedAt: at, decimals: i.decimals });
    return chooseAndSave('csv', c.anonymise ? `OpenCephAI measurements ${at.slice(0, 10)}` : `OpenCephAI measurements ${m.header.patient} ${m.film.timepoint}`, csvBytes(csv));
  };
  return {
    model, problem, words, film, savePdf, saveCsv,
    print: { noto: fonts?.has ?? latin1, cjk: cjk ? { has: cjk.has, name: cjk.name } : null, searching },
  };
}
