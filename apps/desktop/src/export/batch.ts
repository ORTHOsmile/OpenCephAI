import type { AnalysisDef, Compiled } from '@ceph/geometry';
import type { NormPicks } from '@ceph/analyses';
import type { CaseDoc, ModelPoints, PointCheckView, WholeFilmView } from '../ipc';
import { hydrateAction } from '../library/persist';
import { placedByOf, placedViaOf, pointPlacer } from '../measurements';
import type { Decimals } from '../format';
import type { DateFormat } from '../dates';
import { casePopulationChoice, type NormContext } from '../norms/normCell';
import { buildReport, modelsUsed, type ReportModel } from '../report/model';
import { reportPoints } from '../report/points';
import type { ReportWords } from '../report/words';
import type { CsvChoice } from '../report/CsvOptions';
import { clinicianSteps, settleClinicianSteps, wordsFor, type ClinicianResolution } from '../settings/meanings';
import { csvBytes } from './csv';
import { measurementsCsv } from './measurementsCsv';
import { evaluateFilm } from './film';

export type Words = (node: string) => { high: string; low: string } | undefined;
export interface BatchDeps {
  open: (id: string) => Promise<CaseDoc>; readPicks: (id: string) => Promise<NormPicks>; readWords: (id: string) => Promise<ReportWords>;
  defs: AnalysisDef[]; compiled: Compiled; decimals: Decimals; norms: NormContext;
  wordsOf: (doc: CaseDoc) => Promise<Words>; titleOf: (modelId: string) => string; dateFormat: DateFormat; now: Date;
  /** Part F Task 13: list each film's points (the points CSV only). */
  points?: boolean;
  /** Each AI point's model file; a failure leaves model_file blank. */
  pointFiles?: (id: string) => Promise<Record<string, string>>;
  /** The film's latest run per model (`library.ghosts`), which the screen also reads: a film traced before schema 10
   *  has no stored `placedBy`, and its placer is found from these (final review I-2). A failure reads as no runs, as
   *  on the screen. */
  runs?: (id: string) => Promise<ModelPoints[]>;
  /** Stage A: the film's stored point check (`library.pointChecksForCase`, the read the screen uses), for the points CSV's
   *  `point_check` column. A failed read fails the film (left out and counted, like a failed open): a blank cell would read as
   *  "nothing flagged". null = read, never checked (blank); absent dep (other callers): blank. */
  pointChecks?: (id: string) => Promise<PointCheckView | null>;
  /** SC-1 Part 1 task 9: the film's stored whole-film view (`library.wholeFilmCheck`, the read the note uses), for the points CSV's
   *  `whole_film_check` column. Same rule as `pointChecks`: a failed read fails the film; null = no record (blank); absent dep: blank. */
  wholeFilms?: (id: string) => Promise<WholeFilmView | null>;
  /** Research switch (6 Nov 2026): put the whole-film columns in the points CSV. Off/absent: the view is not even read. */
  wholeFilmInReports?: boolean;
}

/** Whose meaning words: `explicit` is the raw `operator` setting (non-empty only when the top bar chose someone),
 *  `login`/`names` are `operators.list()`'s `current`/`names` — read once per export (useMeanings.ts reads the same). */
export interface ClinicianContext { explicit: string | null; login: string; names: readonly string[] }
/** NOCLIN-2 for a film that is not open (preflight-rulings Task 10): the words its own screen and report would show —
 *  the top-bar clinician, else its Referring practitioner if they have saved words, else the login name — through the
 *  same `clinicianSteps`/`settleClinicianSteps` as useMeanings.ts. Each stored word list is read once per export and
 *  each resolved clinician's words made once. A read that fails leaves the film out (the caller counts it) rather than
 *  quietly falling through to someone else's words. */
export function wordsByFilm(s: { get: (key: string) => Promise<string | null> }, c: ClinicianContext): (doc: CaseDoc) => Promise<Words> {
  const reads = new Map<string, Promise<{ ok: boolean; value: string | null; error: unknown }>>();
  const made = new Map<string, Words>();
  return async (doc) => {
    let failed: unknown = null, settled: ClinicianResolution | null = null;
    const get = async (key: string) => {
      let p = reads.get(key);
      if (!p) { p = s.get(key).then((value) => ({ ok: true, value, error: null }), (error: unknown) => ({ ok: false, value: null, error })); reads.set(key, p); }
      const r = await p;
      if (!r.ok) { failed = r.error ?? 'read failed'; throw r.error; }
      return r.value;
    };
    await settleClinicianSteps({ get }, { current: 0 }, 0, clinicianSteps(c.explicit, c.login, doc.referringPractitioner, c.names), (r) => { settled = r; });
    if (failed !== null) throw new Error(`the meaning words could not be read (${failed instanceof Error ? failed.message : String(failed)})`);
    const r = settled as ClinicianResolution | null;
    if (!r) throw new Error('no clinician settled');   // unreachable: the last step always settles
    let w = made.get(r.clinician);
    if (!w) { const o = r.overrides; w = (id) => wordsFor(id, o); made.set(r.clinician, w); }
    return w;
  };
}

/** Each chosen film as the report model its own preview would show: its saved points and scale, its chosen norms
 *  (NORM-PICK-1) and its changed words (R2). A film that cannot be read, or whose chosen norms or words cannot be
 *  read, is left out and counted — never exported with different norms or words than its screen shows. */
export async function filmModels(ids: string[], d: BatchDeps): Promise<{ models: ReportModel[]; failed: string[] }> {
  const models: ReportModel[] = [], failed: string[] = [];
  for (const id of ids) {
    try {
      const doc = await d.open(id);
      const [picks, edits, words] = await Promise.all([d.readPicks(id), d.readWords(id), d.wordsOf(doc)]);
      const { rows, cells, scale } = evaluateFilm(doc, d.defs, d.compiled, d.decimals, d.norms, picks);
      // Final review I-2: the screen's own placer (`pointPlacer`), over the film's points as the screen opens them.
      const pts = hydrateAction(doc).points;
      const placer = pointPlacer(pts, placedByOf(doc), d.runs ? await d.runs(id).catch(() => [] as ModelPoints[]) : []);
      const used = modelsUsed(doc.landmarks.map((l) => ({ source: l.source, placer: placer(l.id) })), d.titleOf);
      const files = d.points && d.pointFiles ? await d.pointFiles(id).catch(() => ({} as Record<string, string>)) : {};
      const via = placedViaOf(doc);
      const check = d.points && d.pointChecks ? await d.pointChecks(id) : null;
      const whole = d.points && d.wholeFilms && d.wholeFilmInReports ? await d.wholeFilms(id) : null;
      const points = d.points ? reportPoints(pts, placer, d.titleOf, files, (id2) => via[id2] ?? null, check, whole, !!d.wholeFilmInReports) : [];
      models.push(buildReport({ doc, rows, cells, defs: d.defs, words, edits, scale, models: used, dateFormat: d.dateFormat, now: d.now, points,
        populationChoice: casePopulationChoice(doc, d.norms) }));
    } catch {
      failed.push(id);
    }
  }
  return { models, failed };
}

export interface ExportDeps extends BatchDeps {
  /** `useNorms().loadError`: with no norms there is no CSV at all, never one with norms missing. */
  normsError: string | null;
  salt: () => Promise<string>;
  /** `chooseAndSave('csv', name, bytes)` (Task 1): false when the clinician cancelled. */
  save: (defaultName: string, bytes: Uint8Array) => Promise<boolean>;
}
/** Library ▸ Select ▸ Export CSV… (spec 2026-10-17): the chosen films in ONE file. Returns the Library's note ("2 films
 *  exported; 1 could not be read and was left out.") once saved, null when the save dialog was cancelled; rejects,
 *  writing nothing, when the norms failed to load or no chosen film could be read. */
export async function exportFilmsCsv(ids: string[], c: CsvChoice, d: ExportDeps): Promise<string | null> {
  if (d.normsError) throw new Error(`norms couldn't be loaded (${d.normsError})`);
  if (!ids.length) throw new Error('no films chosen');
  const { models, failed } = await filmModels(ids, { ...d, points: c.layout === 'points' });
  if (!models.length) throw new Error(`none of the ${ids.length} chosen films could be read`);
  const at = d.now.toISOString(), salt = c.anonymise ? await d.salt() : '';
  const csv = measurementsCsv(models, { ...c, salt, exportedAt: at, decimals: d.decimals, wholeFilm: !!d.wholeFilmInReports });
  if (!(await d.save(`OpenCephAI measurements ${at.slice(0, 10)}`, csvBytes(csv)))) return null;
  const n = models.length, f = failed.length;
  return `${n} ${n === 1 ? 'film' : 'films'} exported${f ? `; ${f} could not be read and ${f === 1 ? 'was' : 'were'} left out` : ''}.`;
}
