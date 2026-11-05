// SYNTHETIC test data for the report and export tests: made-up names, dates and points only.
import { severity } from '@ceph/analyses';
import { enabledDefs } from '../analyses/enabled';
import type { CaseDoc, FilmFit, LandmarkRow } from '../ipc';
import type { MeasurementRow } from '../measurements';
import type { NormCell } from '../norms/normCell';
import { wordsFor } from '../settings/meanings';
import { buildReport, type ReportInput, type ReportModel } from './model';

export const NOW = new Date('2026-10-18T02:00:00Z');   // 18/10/2026 in Sydney and in UTC

/** The browser smokes' synthetic tracing (e2e12 base + 350, 300). */
export const SYNTH_POINTS: Record<string, { x: number; y: number }> = {
  S: { x: 350, y: 300 }, N: { x: 1050, y: 200 }, A: { x: 1070, y: 600 }, B: { x: 1040, y: 950 }, Pog: { x: 1050, y: 1060 },
  Gn: { x: 1030, y: 1120 }, Me: { x: 990, y: 1150 }, Go: { x: 500, y: 1000 }, Po: { x: 150, y: 400 }, Or: { x: 910, y: 380 },
  ANS: { x: 1090, y: 520 }, PNS: { x: 610, y: 540 }, Ar: { x: 310, y: 500 }, U1T: { x: 1095, y: 820 }, L1T: { x: 1085, y: 830 },
  UL: { x: 1150, y: 740 }, LL: { x: 1140, y: 890 }, Sn: { x: 1140, y: 580 }, PogS: { x: 1120, y: 1100 },
};
const rowsOf = (pts: Record<string, { x: number; y: number }>): LandmarkRow[] => Object.entries(pts).map(([id, p]) =>
  ({ id, x: p.x, y: p.y, source: 'ai', verified: false, aiX: p.x, aiY: p.y, confidence: 0.8, placedBy: 'aariz' }));

export const synthDoc = (over: Partial<CaseDoc> = {}, pts = SYNTH_POINTS): CaseDoc => ({
  id: 'c1', patientName: 'SYNTHETIC Demo', timepoint: 'T1', takenOn: '2024-02-07',
  image: { sha256: 'synthetic', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: '/tmp/SYNTHETIC.png' },
  facing: 'right', orientation: {}, display: {}, spacingMm: 0.1, scaleSteps: 0, verifiedAt: null, verifiedBy: null, landmarks: rowsOf(pts),
  createdAt: '', updatedAt: '', patientKey: 'synthetic demo', dateOfBirth: '2010-03-07', scanId: 'SYNTHETIC-4471',   // SYNTHETIC
  identitySource: 'manual', identityChecked: true, identityIssues: [], takenOnSource: null, learnedFields: [],
  gender: 'F', referringPractitioner: null, population: null, background: null, switchedFromClinicDefault: false, printedPatientId: 'SYNTHETIC-PID-5566', xrayType: null, xraySize: null, radiographyPractice: null,
  libraryId: 'L-00042', patientIdsSeen: [], idMatches: [], libraryTrail: [],   // SYNTHETIC
  title: null, ageOnFilm: null, ageOnFilmYears: null,
  ...over,
});

/** Request G + R3 (final-review.md): a SYNTHETIC saved fit — this film fitted to T1 (ruler 0.1 mm/px) on S–N at ×1.042,
 *  "Use the scale from the fit" on. Pass `refSpacingMm: null` for G3 (the reference had no ruler either). */
export const synthFit = (over: Partial<FilmFit> = {}): FilmFit => ({ refCaseId: 'r1', refKind: 'sn', refPoints: [[0, 0], [100, 0]],
  filmPoints: [[0, 0], [100, 0]], mirror: false, scale: 1.042, rotation: 0, dx: 0, dy: 0, useOwn: true, refTimepoint: 'T1',
  refSpacingMm: 0.1, savedBy: 'SYNTHETIC', savedAt: '2026-10-18T00:00:00Z', ...over });
/** The fitted film: T2, no ruler, with `synthFit`. */
export const synthFittedDoc = (fit: Partial<FilmFit> = {}, over: Partial<CaseDoc> = {}): CaseDoc =>
  synthDoc({ id: 'c2', timepoint: 'T2', spacingMm: null, fit: synthFit(fit), ...over });

// My analysis (feat/my-analysis merged): a built-in row's normAnalysisId is its own analysisId (measurements.ts,
// normAnalysisOf) — defaulted from the (possibly overridden) analysisId, not a fixed string, so a `row({ analysisId:
// 'downs', ... })` call does not silently keep 'steiner'. Pass `normAnalysisId` explicitly for a "My analysis" row.
const row = (o: Partial<MeasurementRow>): MeasurementRow => ({ analysis: 'Steiner', analysisId: 'steiner', node: 'm01_SNA', label: 'SNA', unit: 'deg',
  value: null, num: null, hidden: false, needs: [], undefinedReason: null, normAnalysisId: o.analysisId ?? 'steiner', ...o });
export const cell = (o: Partial<NormCell>): NormCell => ({ text: '—', band: null, badges: [], sourceLine: '', target: null, hint: null, choose: null,
  z: null, severity: null, mean: null, sd: null, normMean: null, normSd: null, auto: null, sourceTips: [], flags: [], citation: null, sdDonorCitation: null,
  normSex: null, normPopulation: null, normAgeRowUsed: null, ...o });

/** Steiner SNA (tendency), ANB (Moderate **), Downs facial angle waiting on Pog, McNamara Co-A hidden (assumed scale
 *  in some tests), Downs Y-axis with no norm. */
export const synthRows = (): MeasurementRow[] => [
  row({ node: 'm01_SNA', label: 'SNA', value: '84.8°', num: 84.8 }),
  row({ node: 'm03_ANB', label: 'ANB', value: '6.2°', num: 6.2 }),
  row({ analysis: 'Downs', analysisId: 'downs', node: 'm04_FacialAngle', label: 'Facial angle', needs: ['Pog'] }),
  row({ analysis: 'Downs', analysisId: 'downs', node: 'm24_YAxis', label: 'Y-axis', value: '59.0°', num: 59 }),
  row({ analysis: 'McNamara', analysisId: 'mcnamara', node: 'm10_CoA', label: 'Co-A', unit: 'mm', hidden: true }),
];
// Owner decision (20 Oct): normMean/normSd (the CSV's norm_mean/norm_sd) follow the TEXT, not the chart's z-gated
// mean/sd — so the Facial angle row (a Needs row: no z, chart mean/sd null) and the Co-A row (hidden mm: no z
// either) still carry their norm's own mean/SD here, matching their shown "87.8 ± 3.6°" / "91.0 ± 4.0 mm" text.
export const synthCells = (): (NormCell | null)[] => [
  cell({ text: '82.0 ± 3.5°', band: 'neutral', sourceLine: 'Steiner 1953 (SYNTHETIC source line)', z: 0.8, severity: severity(0.8), mean: 82, sd: 3.5, normMean: 82, normSd: 3.5 }),
  cell({ text: '2.0 ± 2.0°', band: 'red', sourceLine: 'Steiner 1953 (SYNTHETIC source line)', z: 2.1, severity: severity(2.1), mean: 2, sd: 2, normMean: 2, normSd: 2 }),
  cell({ text: '87.8 ± 3.6°', sourceLine: 'Downs 1948 (SYNTHETIC)', normMean: 87.8, normSd: 3.6 }),
  cell({ text: 'No norm', sourceLine: 'no norm for this measurement' }),
  cell({ text: '91.0 ± 4.0 mm', sourceLine: 'McNamara 1984 (SYNTHETIC)', normMean: 91, normSd: 4 }),
];

/** The SYNTHETIC report input `synthModel` builds from (Task 14: the R15 guard and the header tests spread it). */
export const synthInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  doc: synthDoc(), rows: synthRows(), cells: synthCells(), defs: enabledDefs(['steiner', 'downs', 'mcnamara']),
  words: (id) => wordsFor(id, {}), edits: {},
  scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 }, models: ['Aariz'], dateFormat: 'AU', now: NOW, ...over,
});
export const synthModel = (over: Partial<ReportInput> = {}): ReportModel => buildReport(synthInput(over));

/** R3 (B): a report on a fit's scale — T2, no ruler, fitted to T1 at ×1.042 (G3 when `refAssumed`): with nothing hidden,
 *  Co-A carries its number. */
export const synthFitModel = (refAssumed = false, over: Partial<ReportInput> = {}): ReportModel => synthModel({
  doc: synthDoc({ id: 'c2', timepoint: 'T2', spacingMm: null }),
  rows: synthRows().map((r) => (r.node === 'm10_CoA' ? { ...r, hidden: false, value: '95.3 mm', num: 95.3 } : r)),
  scale: { mmPerPx: 0.1 * 1.042, source: 'fit', fit: { ref: 'T1', kind: 'sn', k: 1.042, refAssumed } }, ...over });
