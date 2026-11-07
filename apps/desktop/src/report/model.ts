import type { AnalysisDef, Unit } from '@ceph/geometry';
import { COMBINED_ADULT_LABEL, DEFAULT_MEANINGS, isMine, unavailableLine, type AutoNote, type NormSex, type PopulationChoice } from '@ceph/analyses';
import type { CaseDoc, Gender } from '../ipc';
import type { MeasurementRow } from '../measurements';
import { CALIBRATE_TO_SHOW, type NormCell } from '../norms/normCell';
import { formatDate, type DateFormat } from '../dates';
import { adjustedWords, fitMark, fitNoteLine, machineWords, noRulerSentence, type Scale } from '../tracing/spacing';
import { shownName } from '../library/identity';
import { titledName } from '../library/title';
import { ageShown } from '../library/age';
import { filmAge, filmAgeSource } from '../norms/filmAge';
import { reportMeaning } from './meaning';
import { shownMeaning, wordKey, type ReportWords, type WordEdit } from './words';
import type { ReportPoint } from './points';
import tauriConf from '../../src-tauri/tauri.conf.json';

/** Owner CONTEXT-LINE (16 Oct 2026): in the report only (model.test.ts pins it to docs/norms/SEVERITY.md and checks
 *  no other screen file carries it). */
export const CONTEXT_LINE = "Meanings compare this film with the chosen norm; interpret with the clinical examination and the patient's age, sex, ethnicity and growth stage.";

/** Owner, 29 Oct 2026 (export-report checkboxes): three things OFF by default — a separate profilogram page (never
 *  drawn over the film), the long per-row norm-source paragraph (the new one-sentence summary, model.ts
 *  `normSourceSummary`, is shown regardless and is not one of these), and who placed each point. Remembered per
 *  Mac, the same way `report_paper` already is (App.tsx). */
export interface ReportOptions { profilogramPage: boolean; normSources: boolean; placedBy: boolean;
  /** Owner, 5 Nov 2026: the whole Points section (heading and table) — ON by default, so today's reports are unchanged. */
  pointsTable: boolean;
  /** Owner, 5 Nov 2026: the true-size mm grid behind the profilogram page — ON by default; only has an effect while
   *  `profilogramPage` is on, and only on a calibrated film (profilogramPage.ts). */
  profilogramGrid: boolean }
export const DEFAULT_REPORT_OPTIONS: ReportOptions = { profilogramPage: false, normSources: false, placedBy: false, pointsTable: true, profilogramGrid: true };
/** The settings keys each option is remembered under (App.tsx), the same mechanism as `report_paper`. */
export const REPORT_OPTION_KEYS: Record<keyof ReportOptions, string> = {
  profilogramPage: 'report_profilogram_page', normSources: 'report_norm_sources', placedBy: 'report_placed_by', pointsTable: 'report_points_table', profilogramGrid: 'report_profilogram_grid',
};
export const FOOTER = 'Research tool — not a diagnostic device';
/** One version only, with the Beta label (owner option A, 2 Nov 2026): "OpenCephAI 1.2.1 (Beta)". Also the CSV app_version. */
export const APP = `${tauriConf.productName} ${tauriConf.version} (Beta)`;

export interface ReportRow {
  key: string; analysisId: string; node: string; label: string; abbr: string;
  /** Mean ± SD as the screen shows it ("82.0 ± 3.5°", "No norm"). */
  norm: string;
  /** The value as the screen shows it, or why there is none ("calibrate to show", "Needs: Pog"). */
  result: string; stars: string;
  /** What prints in the Meaning column; `usual` is the words before any change for this film. */
  meaning: string; usual: string; edited: boolean; stale: WordEdit | null;
  /** Full precision for the CSV; null whenever the screen shows no number. */
  num: number | null; unit: Unit; hidden: boolean;
  /** 'measured', 'calibrate to show', 'Needs: …' or 'Undefined: points coincide'. */
  status: string;
  z: number | null; mean: number | null; sd: number | null; severity: string; side: string; sourceLine: string;
  /** Owner N-A5 (19 Oct 2026): true when Auto filled this row's norm (the row's population had none) — the report's
   *  ◆, drawn (never typed: Noto Sans has no ◆ glyph, AUTO-Q10). */
  auto: boolean;
  /** Owner Q-A (24 Oct 2026): the AutoNote step that filled this row ('analysis-own' | 'caucasian' | 'anywhere'),
   *  for the CSV's `norm_auto` column; null for a row Auto did not fill.
   *  Review I-4 + owner ruling (fix round 1, 25 Oct 2026): also 'chosen' when the clinician picked another
   *  population's source by hand (`resolve.ts`'s `chosen-by-you` path, ~151-156) — that row also compares the
   *  patient with another group's norm, so filtering on `norm_auto` being non-blank must catch it too. Never both
   *  at once: the resolver takes the picked-source path before Auto is ever tried. */
  autoStep: AutoNote['step'] | 'chosen' | null;
}
export interface ReportBlock {
  analysisId: string; name: string; rows: ReportRow[]; sources: string[];
  /** Owner B1-equivalent for the report (final-review.md, merge-second follow-up): a "My analysis" block whose
   *  clinician dropped an item no longer in the catalogue names it here, once, under the heading — never a row.
   *  Null for a built-in block, and for a My-analysis block with nothing missing. */
  unavailable: string | null;
}
export interface FilmFacts {
  id: string; patientName: string; patientKey: string; dateOfBirth: string | null; takenOn: string | null; gender: Gender | null;
  libraryId: string | null; printedPatientId: string | null; scanId: string | null; timepoint: string; verifiedAt: string | null; verifiedBy: string | null; age: number | null;
  /** Ruling R12 (19 Oct): `age` is the age the norms use (`filmAge`: the DOB age, else the film's printed or typed
   *  age); `ageSource` says which ('dob' | 'film'), null when there is no age (the CSV's `age_source`). */
  ageSource: 'dob' | 'film' | null; models: string[]; scale: Scale;
}
/** `age`/`ageSource` are the film facts' (R12). `ageLine`/`ageNote` are the screen's own Age line and its note (`ageShown`,
 *  owner AG1); `headerLines` prints them only where R15 allows (see there). */
export interface ReportHeader { patient: string; libraryId: string; dob: string; age: number | null; ageSource: 'dob' | 'film' | null; ageLine: string | null; ageNote: string | null; filmDate: string; timepoint: string; scale: string; models: string; verified: string; made: string }
/** `fitNote` (R3, final-review.md C1): with "Use the scale from the fit" on, the one line under the tables that says
 *  what the † on each mm value means — the film, the fit, and the owner's G2 sentence. Null for any other scale. */
/** Owner N-A5 (19 Oct 2026): the footnote under the tables naming every row Auto filled, grouped by the population
 *  that had none; null when Auto filled no row. Owner, addendum 2 J (19 Oct 2026): the list of papers that did not
 *  state their X-ray enlargement, each once with its rows; null when there is none. M7: printed in that order, both
 *  before the CONTEXT-LINE, in the PDF, the preview and `reportTexts` alike. */
export interface ReportModel { caseId: string; film: FilmFacts; header: ReportHeader; blocks: ReportBlock[]; contextLine: string; autoNote: string | null; scaleNote: string | null; fitNote: string | null; footer: string; app: string; points: ReportPoint[];
  /** Owner report request (29 Oct 2026): the one-sentence norm summary, shown by default; see `normSourceSummary`. */
  normSummary: string | null }
export interface ReportInput {
  doc: Pick<CaseDoc, 'id' | 'patientName' | 'patientKey' | 'dateOfBirth' | 'takenOn' | 'timepoint' | 'gender' | 'printedPatientId' | 'scanId' | 'verifiedAt' | 'verifiedBy' | 'libraryId' | 'title' | 'ageOnFilm' | 'ageOnFilmYears'>;
  rows: MeasurementRow[]; cells: (NormCell | null)[];
  /** Part F Task 13: the points for the Points table and the points CSV (none: no table). */
  points?: ReportPoint[];
  /** R3: App.tsx's own `defs` (today `shownDefs(enabledIds, mine.list)`) — only used to find each row's My-analysis
   *  def (isMine) for `ReportBlock.unavailable`; never to recompute rows or norms (those are the screen's own). */
  defs: AnalysisDef[];
  words: (node: string) => { high: string; low: string } | undefined;
  edits: ReportWords; scale: Scale; models: string[]; dateFormat: DateFormat; now: Date;
  /** Owner decision 1 (29 Oct 2026): how Auto chose the case's population (casePopulationChoice); null or absent when it
   *  was chosen by hand or the case is on the old "Clinic default". */
  populationChoice?: PopulationChoice | null;
}
export interface ChartRow { abbr: string; z: number | null; mean: number | null; sd: number | null; unit: Unit }

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Owner N-A5 (19 Oct 2026): the footnote under the tables naming every row Auto filled, grouped by the population
 *  that had no norm, e.g. "No Chinese norm for these measurements; Caucasian norm used: McNamara 1984 Ann Arbor
 *  (n = 73) for Upper pharynx." null when Auto filled no row. Words only: the ◆ before it is drawn (Noto Sans has
 *  no ◆ glyph). */
export function autoFootnote(rows: MeasurementRow[], cells: (NormCell | null)[]): string | null {
  const byPop = new Map<string, { words: string; uses: Map<string, string[]> }>();
  rows.forEach((r, i) => {
    const a = cells[i]?.auto;
    if (!a) return;
    const g = byPop.get(a.population) ?? { words: a.populationWords, uses: new Map<string, string[]>() };
    const use = a.usedPopulation ? `${a.usedPopulation} norm used: ${a.source}${a.n !== null ? ` (n = ${a.n})` : ''}` : `${a.source} used`;
    // Review M-1 (fix round 1, 25 Oct 2026): dedup per use — two rows can share one label under the same source
    // (e.g. two analyses using the same measurement), and a bare ", " cannot be told apart from a label that itself
    // holds a comma ("U1–NA (mm), tip").
    const labels = g.uses.get(use) ?? [];
    if (!labels.includes(r.label)) labels.push(r.label);
    g.uses.set(use, labels);
    byPop.set(a.population, g);
  });
  if (byPop.size === 0) return null;
  return [...byPop.values()].map((g) => `No ${g.words} norm for these measurements; ${[...g.uses].map(([use, labels]) => `${use} for ${labels.join(' · ')}`).join('; ')}.`).join(' ');
}

const sexWord = (s: NormSex): string => (s === 'M' ? 'male' : s === 'F' ? 'female' : 'pooled');

/** Owner report request (29 Oct 2026): "adults" / "children" / "children aged N years", from the age ROW the
 *  resolver actually used (`NormCell.normAgeRowUsed`, resolve.ts's own `bandLabel`/interpolated wording) — never a
 *  separately computed age. null (no age band at all: the norm holds for every age) and a band whose low end is an
 *  adult age ("18 y and over") both read as "adults". A single-value row ("8 y", or an interpolated "8.2 y
 *  (interpolated 7–9 y)") under 18 names the age; a RANGE under 18 ("6–12 y") has no single age to name, so reads
 *  as the plain "children". */
export function ageRowWords(ageRowUsed: string | null): string {
  if (ageRowUsed === null || ageRowUsed.includes('and over')) return 'adults';
  const n0 = Number(ageRowUsed.match(/^(\d+(?:\.\d+)?)/)?.[1] ?? NaN);
  if (!Number.isNaN(n0) && n0 >= 18) return 'adults';
  // A RANGE band ("6–12 y", resolve.ts's bandLabel) has the dash right after the first number, with no single age
  // to name; an interpolated row ("8.2 y (interpolated 7–9 y)") also contains a dash, but only inside the
  // parenthetical aside — its own age (8.2) IS a single value, so it must not be mistaken for a range.
  if (/^\d+(?:\.\d+)?\s*–/.test(ageRowUsed)) return 'children';
  return Number.isNaN(n0) ? 'children' : `children aged ${Math.round(n0)} years`;
}

/** Owner report request (29 Oct 2026): one plain sentence naming which norms were used, shown by default (the long
 *  per-row source paragraph, `unavailable`-style, stays off by default behind its own "Norm sources" tick-box —
 *  see pdf.ts/ReportPreview.tsx). Built from the norm rows ACTUALLY used (`NormCell.normSex`/`normPopulation`/
 *  `normAgeRowUsed`, filled straight off `resolveNorm`'s own result by normCell.ts — never recomputed here): the
 *  population most of the used rows share, its sex and age words, and — when some row used a DIFFERENT population
 *  (an Auto ◆ fallback, or a hand-chosen source) — one short added clause. null when no row used a norm at all. */
// Fix round (ruling, minor finding 4, 29 Oct 2026): the tie-break. `Array#sort` has been a STABLE
// sort since ES2019 (every engine this app runs on), and `Map` iterates in insertion order — `counts` is filled
// in `used`'s own (the rows'/cells' own) order, so when two populations tie on row count, the sort leaves them
// in that same order and `[0]` is whichever population a row reached FIRST, reading top to bottom through the
// measurements. Deterministic, and reproducible from the rows alone — never "random" — but it is a tie-break on
// ROW ORDER, not on anything about the populations themselves (not alphabetical, not "the case's own chosen
// population" specifically, though that is usually what a row reaches first in practice). Documented and tested
// (`model.test.ts` "normSourceSummary... the majority tie-break") rather than left implicit, per the review.
/** Owner decisions 1 and 4 (29 Oct 2026; spec 2026-10-29 §4.6): the bracket that says how Auto chose the sentence's
 *  population. */
export const AUTO_HOW_REPORT = {
  // Owner R6 (3 Nov 2026): the background is never given away; the same words for the combined adult norm.
  background: "chosen automatically from the patient's demographics",
  combined: "chosen automatically from the patient's demographics",
  'clinic-default': 'chosen automatically: clinic default',
  'best-evidence': 'chosen automatically: no background or clinic default recorded, so the largest study with norms for this sex and age',
  'best-evidence-nearest': 'chosen automatically: no background or clinic default recorded, so the largest study with norms for this sex, at the nearest age',
} as const;

/** `choice` (spec 2026-10-29 §4.6): how Auto chose the case's population; null or absent when it was chosen by hand or
 *  the case is on the old "Clinic default" — the sentence is then exactly as before. The bracket is added only when the
 *  sentence's population is the one Auto chose; otherwise the ◆ footnote already names each row's source. Sex not
 *  recorded (owner NAP-Q4 (b)): an averaged row reads "pooled", like a paper's own pooled row; the row's badge and
 *  source line say "average of male and female". */
export function normSourceSummary(cells: (NormCell | null)[], choice: PopulationChoice | null = null): string | null {
  const used = cells.filter((c): c is NormCell => !!c && c.normPopulation !== null);
  if (used.length === 0) return null;
  // Final review I3 (3 Nov 2026; spec 2026-11-03 §8.2): on the combined adult norm every row is either combined or
  // Auto's ◆ (a single study, or the usual fall-back), so the sentence names the combined norm — never the population
  // of the single-study rows, however many there are — and the ◆ rows as "a single study or other norms".
  if (choice?.how === 'combined') {
    const combined = used.filter((c) => c.normPopulation === COMBINED_ADULT_LABEL && c.auto?.step !== 'single-study');
    const how = AUTO_HOW_REPORT.combined;
    if (!combined.length) return `Fewer than 2 adult studies measured each of these measurements, so each uses a single study or other norms (marked ◆; ${how}).`;
    const s = combined[0].normSex;
    const who = s === 'M' ? 'men' : s === 'F' ? 'women' : 'men and women';
    const rest = cells.some((c) => !!c && (c.auto !== null || (c.normPopulation !== null && !combined.includes(c))));
    return `We used combined adult norms for ${who}, from every adult study in the app weighted by size (${how})${rest ? '; some measurements use a single study or other norms (marked ◆).' : '.'}`;
  }
  const counts = new Map<string, number>();
  for (const c of used) counts.set(c.normPopulation!, (counts.get(c.normPopulation!) ?? 0) + 1);
  const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const main = used.find((c) => c.normPopulation === majority)!;
  const mixed = used.some((c) => c.normPopulation !== majority);
  // Owner R1/R5 (3 Nov 2026; spec 2026-11-03 §8.2): the combined adult norm is no one population.
  const combinedWho = main.normSex === 'M' ? 'men' : main.normSex === 'F' ? 'women' : 'men and women';
  const sentence = main.normPopulation === COMBINED_ADULT_LABEL
    ? `We used combined adult norms for ${combinedWho}, from every adult study in the app weighted by size`
    : `We used the norms for the ${sexWord(main.normSex!)} ${main.normPopulation} population for ${ageRowWords(main.normAgeRowUsed)}`;
  const key = choice?.how === 'best-evidence' && !choice.ageCovered ? 'best-evidence-nearest' : choice?.how;
  const how = choice && key && key !== 'none' && choice.label === majority ? ` (${AUTO_HOW_REPORT[key]})` : '';
  // Owner rulings 7 Nov 2026: say once that the population rule gave rows from another population ("Norms: Caucasian
  // (population rule)", owner answer C: never the recorded background).
  const aliases = [...new Set(used.map((c) => c.aliasNote).filter((w): w is string => !!w))];
  const alias = aliases.length ? ` ${aliases.map((w) => `${w}.`).join(' ')}` : '';
  return (mixed ? `${sentence}${how}; some measurements use other norms (marked ◆).` : `${sentence}${how}.`) + alias;
}

/** Owner, addendum 2 J (19 Oct 2026): the norms whose papers did not state their X-ray enlargement, each paper once
 *  with its rows — the screen no longer tags them (Task 7), so the report names them. null when there is none
 *  (AUTO-Q14: printed once, under the tables, beside the Auto footnote).
 *  Review M-2 (fix round 1, 25 Oct 2026): also names a paper that supplied only a BORROWED SD with its own scale
 *  unstated (`sdDonorCitation`) — a norm whose own mean's paper states its scale can still borrow an SD from one
 *  that does not, and that donor paper is named here too, separately from the mean's own citation. */
export function unstatedScaleNote(rows: MeasurementRow[], cells: (NormCell | null)[]): string | null {
  const byPaper = new Map<string, string[]>();
  // Review M-1: dedup per paper (a label can repeat across rows that share it, e.g. two analyses' Lower lip to
  // E-line both landing on Ricketts 1981), and join with " · " — a plain ", " cannot be told apart from a comma
  // already inside a label ("U1–NA (mm), tip").
  const add = (paper: string, label: string) => {
    const labels = byPaper.get(paper) ?? [];
    if (!labels.includes(label)) labels.push(label);
    byPaper.set(paper, labels);
  };
  rows.forEach((r, i) => {
    const c = cells[i];
    if (!c) return;
    if (c.flags.includes('scale-assumed') && c.citation) add(c.citation, r.label);
    if (c.sdDonorCitation) add(c.sdDonorCitation, r.label);
  });
  if (byPaper.size === 0) return null;
  return `Norms whose papers did not state their X-ray enlargement (mm taken as true size): ${[...byPaper].map(([paper, labels]) => `${paper} (${labels.join(' · ')})`).join('; ')}.`;
}

/** Spec 2026-10-17 report-exports: the report is the screen's own rows — no value, norm, colour or star is worked out
 *  again here. A hidden mm value (assumed scale, N5) stays hidden: no number, no z, no stars, no meaning. */
export function buildReport(i: ReportInput): ReportModel {
  const blocks: ReportBlock[] = [];
  // R3 (B): the screen's rule (Inspector.tsx `fitDagger`): an mm value with a number, on a fit's scale, carries a †.
  const dagger = (r: MeasurementRow) => i.scale.source === 'fit' && r.unit === 'mm' && !r.hidden && r.value !== null && r.num !== null;
  i.rows.forEach((r, n) => {
    const c = i.cells[n] ?? null;
    let b = blocks.find((x) => x.analysisId === r.analysisId);
    if (!b) {
      const def = i.defs.find((x) => x.id === r.analysisId);
      b = { analysisId: r.analysisId, name: r.analysis, rows: [], sources: [], unavailable: def && isMine(def) ? unavailableLine(def) : null };
      blocks.push(b);
    }
    const sev = r.hidden ? null : c?.severity ?? null;
    const usual = reportMeaning(sev, i.words(r.node));
    const key = wordKey(r.analysisId, r.node), shown = shownMeaning(usual, i.edits[key]);
    const status = r.hidden ? CALIBRATE_TO_SHOW : r.value !== null ? 'measured' : r.undefinedReason ?? `Needs: ${r.needs.join(', ')}`;
    b.rows.push({
      key, analysisId: r.analysisId, node: r.node, label: r.label, abbr: DEFAULT_MEANINGS[r.node]?.abbr ?? r.label,
      norm: c?.text ?? '—', result: r.hidden ? CALIBRATE_TO_SHOW : dagger(r) ? `${r.value} †` : r.value ?? status, stars: sev?.stars ?? '',
      meaning: shown.text, usual, edited: shown.edited, stale: shown.stale,
      num: r.hidden ? null : r.num, unit: r.unit, hidden: r.hidden, status,
      // ON PURPOSE, updated by owner decision (20 Oct; was final review I2's "blank" rule): `mean`/`sd` here are
      // `c?.normMean`/`c?.normSd` — the resolved norm's own figures, filled whenever the `norm` text column shows
      // a value (an SD-less norm fills mean and leaves sd blank, matching `normText`) — NEVER gated by `r.hidden`
      // or by whether a z/colour/stars is possible. A "Needs: …" row and a hidden mm row both still name their
      // norm in text, so the CSV's norm_mean/norm_sd now agree with it instead of silently dropping those rows
      // from a cohort average. `z` stays gated by `r.hidden` (no grade is possible with no value shown); the
      // chart's OWN mean/sd (CHART-TAB-1, `chartRows` below) stay gated by `z`, so the chart and the PDF table are
      // unchanged — only the CSV's norm_mean/norm_sd columns differ. See docs/norms/SEVERITY.md "In the report
      // and the CSV".
      z: r.hidden ? null : c?.z ?? null, mean: c?.normMean ?? null, sd: c?.normSd ?? null,
      severity: sev?.word ?? '', side: sev && sev.word !== 'within normal range' ? sev.side : '', sourceLine: c?.sourceLine ?? '',
      auto: !!c?.auto, autoStep: c?.auto ? c.auto.step : c?.flags.includes('chosen-by-you') ? 'chosen' : null,
    });
    if (c?.sourceLine && !b.sources.includes(c.sourceLine)) b.sources.push(c.sourceLine);
  });
  // Task 8 (ruling, final-review.md's "known gap"): a "My analysis" whose EVERY measurement is no longer
  // available has no rows at all, so the loop above never makes its block — walk `defs` (Inspector.tsx's own `gone`
  // does the same, by walking defs directly rather than rows) so its heading and unavailableLine still show, with an
  // empty table (no rows, no sources).
  for (const def of i.defs) {
    if (!isMine(def) || blocks.some((x) => x.analysisId === def.id)) continue;
    const line = unavailableLine(def);
    if (line) blocks.push({ analysisId: def.id, name: def.name, rows: [], sources: [], unavailable: line });
  }
  // Fix round 1 (review I1): the loop above (and the per-row loop before it) both just `push`, so a zero-row block
  // always landed last regardless of where it sits on screen. R3 ("the analyses switched on on screen, in their
  // order") governs every block, not only the ones a row happens to create — sort by each block's own position in
  // `i.defs` (Array#sort is stable, so two blocks that somehow share a def, or neither is found, keep their
  // push order rather than being reshuffled).
  blocks.sort((a, b) => {
    const ia = i.defs.findIndex((d) => d.id === a.analysisId), ib = i.defs.findIndex((d) => d.id === b.analysisId);
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
  });
  // Owner AG1 / ruling R12 (Task 14): the age is the one the norms use (`filmAge`: with a DOB exactly `ageAt` as
  // before; with none, the film's printed or typed age), with where it came from.
  const d = i.doc, fmt = i.dateFormat, age = filmAge(d), ageSource = filmAgeSource(d), shown = ageShown(d);
  const fitNote = i.scale.source === 'fit' ? `† ${fitNoteLine(d.timepoint, i.scale.fit)}. ${noRulerSentence(i.scale.fit)}` : null;
  return {
    caseId: d.id, blocks, contextLine: CONTEXT_LINE, autoNote: autoFootnote(i.rows, i.cells), scaleNote: unstatedScaleNote(i.rows, i.cells), fitNote, footer: FOOTER, app: APP,
    points: i.points ?? [], normSummary: normSourceSummary(i.cells, i.populationChoice ?? null),
    film: { id: d.id, patientName: d.patientName, patientKey: d.patientKey, dateOfBirth: d.dateOfBirth, takenOn: d.takenOn, gender: d.gender,
      libraryId: d.libraryId, printedPatientId: d.printedPatientId, scanId: d.scanId, timepoint: d.timepoint, verifiedAt: d.verifiedAt, verifiedBy: d.verifiedBy, age, ageSource, models: i.models, scale: i.scale },
    header: {
      // Owner T1: the title before the name as stored ("Mr Smith, John" is never reordered).
      patient: titledName(d.title ?? null, shownName(d.patientName)),
      // L2 (preflight-rulings Task 11): the library Patient ID, straight after Patient; an unnamed patient has not
      // been matched into the library yet.
      libraryId: d.libraryId ?? 'none yet (name the patient first)',
      dob: d.dateOfBirth ? formatDate(d.dateOfBirth, fmt) : 'not recorded', age, ageSource, ageLine: shown?.text ?? null, ageNote: shown?.note ?? null,
      filmDate: d.takenOn ? formatDate(d.takenOn, fmt) : 'not recorded',
      timepoint: d.timepoint.trim() || '—',
      // R3 (B): a fit's scale at 4 decimals with the screen's own words (`fitMark`) and its †; the calibration and
      // assumed lines are main's, unchanged.
      // Spec 2026-10-20 MS3: a machine's calibrated scale, named, with its source; the other lines are unchanged.
      scale: i.scale.source === 'machine'
        ? `${machineWords(i.scale.machine, (iso) => formatDate(iso, fmt))}, ${i.scale.mmPerPx.toFixed(4)} mm per pixel`
        : i.scale.source === 'calibration'
          ? (i.scale.steps === 0 ? `calibrated from the film's ruler (${i.scale.mmPerPx.toFixed(4)} mm per pixel)`
            : `calibrated scale${adjustedWords(i.scale.steps)} from the film's ruler (${i.scale.mmPerPx.toFixed(4)} mm per pixel)`)
          : i.scale.source === 'fit'
            ? `from a fit: ${i.scale.mmPerPx.toFixed(4)} mm per pixel (${fitMark(i.scale.fit)}) †`
            : `assumed (${i.scale.mmPerPx} mm per pixel): not calibrated, so mm values are not shown`,
      models: i.models.length ? i.models.join(', ') : 'none: every point placed by hand',
      verified: d.verifiedAt ? `All points approved by ${d.verifiedBy?.trim() || 'unknown'} on ${formatDate(d.verifiedAt, fmt)}` : 'Not verified: the tracing has not been signed off',
      // Minor (preflight-rulings Task 4): localDay uses this computer's own time zone, so "Report made" is right for
      // the clinician sitting at it, but holds the test's expected '18/10/2026' only in Sydney and in UTC.
      made: formatDate(localDay(i.now), fmt),
    },
  };
}

/** The header as label/value lines (the preview and page 1 of the PDF). */
/** R15 (owner, 24 Oct; preflight I-8): a film whose DOB gives the age prints the Date of birth line exactly as before,
 *  "(age … at the film)" included, and no Age line. The screen's Age line is added only when the age came from the
 *  film, or the DOB gave none (R1: no scan date, or one before the birth); its note whenever there is one. */
export function headerLines(h: ReportHeader): [string, string][] {
  const age: [string, string][] = [
    ...(h.ageLine !== null && h.ageSource !== 'dob' ? [['Age', h.ageLine] as [string, string]] : []),
    ...(h.ageNote !== null ? [['', h.ageNote] as [string, string]] : []),
  ];
  return [['Patient', h.patient], ['Library ID', h.libraryId], ['Date of birth', h.ageSource !== 'dob' || h.age === null ? h.dob : `${h.dob} (age ${h.age.toFixed(1)} at the film)`],
    ...age, ['Film date', h.filmDate], ['Timepoint', h.timepoint], ['Scale', h.scale], ['AI models', h.models], ['Verification', h.verified], ['Report made', h.made]];
}

/** The models that placed the points now on the film, most points first (a hand-placed point names none). */
export function modelsUsed(points: { source: string; placer: string | null }[], titleOf: (id: string) => string): string[] {
  const count = new Map<string, number>();
  for (const p of points) {
    if (p.source === 'manual') continue;
    const t = p.placer ? titleOf(p.placer) : 'model not recorded';
    count.set(t, (count.get(t) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

// Owner decision (20 Oct): ReportRow.mean/sd now follow the norm TEXT, not z (see buildReport above) — but the
// chart must still show no band/mean/ticks for a row with no z (CHART-TAB-1's own gate, chartShapes.ts: "if
// (r.z === null || r.mean === null || r.sd === null) return"). Re-null mean/sd here, by z, so the chart's own
// numbers stay exactly what they were before that CSV change — the chart and the PDF are unaffected.
// Task 10 decision (task-5-review.md "What Task 10 must do" 4): the spec is silent on whether the PDF polygon
// chart marks an Auto row's label. Followed here: the same as the screen's own Chart tab (`chart/ChartOverlay.tsx`,
// `chart/polygon.ts`) — neither reads `auto`/`auto-fallback` at all, so no row there is marked either. `ChartRow`
// carries no `auto` field on purpose; the ◆ lives only on the table's norm cell and the footnote.
export const chartRows = (b: ReportBlock): ChartRow[] =>
  b.rows.map((r) => ({ abbr: r.abbr, z: r.z, mean: r.z === null ? null : r.mean, sd: r.z === null ? null : r.sd, unit: r.unit }));

/** Owner, 29 Oct 2026 (the zig-zag plot beside the ceph): every switched-on analysis's rows, ONE chart, in the same
 *  order as the tables (and the screen's own Chart tab, which walks the same `rows` the blocks here were built
 *  from — model.test.ts's own order-match test). Reuses `chartRows` per block; never recomputed per row. */
export const allChartRows = (m: ReportModel): ChartRow[] => m.blocks.flatMap(chartRows);

/** A row the screen's Chart tab draws with no dot and no norm band: no z (no value placed, or the measurement
 *  could not be graded), or no usable mean/SD (`ChartOverlay.tsx`'s own `has` gate; `chartShapes` already drew the
 *  band/dot only under this same condition). Owner, 29 Oct 2026: such a row is dropped from the PRINT chart
 *  entirely (not just left dot-less), so the remaining rows sit with no gap and their line joins directly. */
export const isBlankChartRow = (r: ChartRow): boolean => r.z === null || r.mean === null || r.sd === null;
export const visibleChartRows = (rows: ChartRow[]): ChartRow[] => rows.filter((r) => !isBlankChartRow(r));

/** Owner FONT-2 (18 Oct 2026): every string the PDF actually prints — header label/value pairs, each block's name,
 *  every row's label/norm/result (with its stars)/meaning, the block's source lines, the context line, the footer
 *  and the app name. One list, used for the preview's "can't be printed" warning (Task 8), the system font search
 *  (Task 9, which code points need a CJK font) and the PDF itself (`pdf.ts`, here). */
export function reportTexts(m: ReportModel, options: ReportOptions = DEFAULT_REPORT_OPTIONS): string[] {
  const out: string[] = [];
  for (const [k, v] of headerLines(m.header)) out.push(k, v);
  for (const b of m.blocks) {
    out.push(b.name);
    if (b.unavailable) out.push(b.unavailable);
    for (const r of b.rows) out.push(r.label, r.norm, r.stars ? `${r.result} ${r.stars}` : r.result, r.meaning);
    out.push(...b.sources);
  }
  // M7 (preflight-rulings.md): the Auto footnote, then the unstated-enlargement list, then the CONTEXT-LINE, then
  // the fit note — the same order here, in the PDF and in the preview.
  if (m.normSummary) out.push(m.normSummary);
  if (m.autoNote) out.push(m.autoNote);
  if (m.scaleNote) out.push(m.scaleNote);
  out.push(m.contextLine);
  if (m.fitNote) out.push(m.fitNote);
  // Chain spec §5 (Part F Task 13): the Points table, after the fit note and before the footer.
  // Owner, 5 Nov 2026: with the "Points table" option off the section is absent, so its names cannot need a CJK font.
  if (options.pointsTable && m.points.length) { out.push('Points'); for (const p of m.points) out.push(p.id, p.name, p.label); }
  out.push(m.footer, m.app);
  return out;
}
