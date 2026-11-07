// Typed wrappers around the Tauri commands in src-tauri/src/{lib,library}.rs. Shapes mirror ceph-store's serde types.
import { invoke } from '@tauri-apps/api/core';
import type { Vec2 } from '@ceph/geometry';
import type { Orientation } from './canvas/orientation';
import type { AcceptKind, Display, Source } from './tracing/state';
import type { UserNorm } from '@ceph/analyses';
export type { Source };
export type { UserNorm };

/** Automatic best's virtual model id (ceph_store::AUTO_BEST; never a real model, run or catalogue entry). */
export const AUTO_BEST = 'auto-best';
export type Facing = 'right' | 'left';
// cov: the model's heat-map spread around the point, [xx, xy, yy] in film px² (spec 2026-10-13 §6.1). Optional: the
// stubs and runs stored before schema 10 have none; null when the window held no positive weight.
export interface DetectedLandmark { id: string; x: number; y: number; confidence: number; cov?: [number, number, number] | null }
export interface Detection {
  modelId: string; imageWidth: number; imageHeight: number; executionProvider: string;
  timingsMs: { preprocess: number; inference: number; decode: number; total: number };
  landmarks: DetectedLandmark[];                 // canonical image pixels (§2)
  /** Every output channel's point, including channels not mapped to a landmark yet. */
  raw: RawPoint[];
  /** The SHA-256 of the model file that ran (schema 10: stored with the run). */
  modelSha256?: string;
}
export interface RawPoint { channel: number; landmarkId: string | null; x: number; y: number; peak: number; cov?: [number, number, number] | null }
export interface DetectResult extends Detection { facingLeft: boolean; meanPeakRight: number | null; meanPeakLeft: number | null }
export interface ModelStatus { loaded: boolean; modelId: string | null; searched: string[]; error: string | null }

export interface LandmarkRow {
  id: string; x: number; y: number; source: Source; verified: boolean; aiX: number | null; aiY: number | null; confidence: number | null;
  /** The model that placed this AI point (schema 10); null for a hand-placed point and for cases before schema 10. */
  placedBy?: string | null;
  /** 'auto-best' when Automatic best chose the placing model (format 15); null otherwise. */
  placedVia?: string | null;
  /** How the point was accepted (format 14; chain spec answer 7); null when not accepted or before format 14. */
  acceptKind?: AcceptKind | null;
}
export interface ImageInfo { sha256: string; ext: string; width: number; height: number; originalName: string; path: string }
export interface PatientRef { name: string; dateOfBirth: string | null }
/** Why "Check patient details" asks (mirrors ceph-store's IdentityIssue). */
export type IdentityIssue =
  | { kind: 'nameNotRead' } | { kind: 'noDateOfBirth' } | { kind: 'impossibleDate'; field: 'dateOfBirth' | 'scanDate' } | { kind: 'birthAfterScan' }
  | { kind: 'sameNameOtherBirth'; patient: PatientRef } | { kind: 'similarNameSameBirth'; patient: PatientRef };
export interface IdentityOutcome { checked: boolean; issues: IdentityIssue[] }
/** The check after reading a label, with the text on the film (memory only; never saved or logged). */
export type Box = [number, number, number, number];
/** A recognised word and line, boxes as [left, top, width, height], 0–1 of the stored film (memory only). */
export interface FilmWord { text: string; bbox: Box }
export interface FilmLine { text: string; bbox: Box; words: FilmWord[] }
/** A machine's learned place that reads something on this film ("Suggested", or "Learned" when it is the default). */
export interface Suggestion { field: string; line: number; from: number; to: number; value: string; isDefault: boolean }
/** The label and the machine's learned default disagreed: the field was left blank for the clinician to choose. */
export interface Conflict { field: string; label: string; learned: string }
/** Spec 2026-10-20 (MS1-MS4): the X-ray machine a film is recognised as. */
export interface MachineRef { id: string; name: string }
/** A machine's calibrated scale as one film sees it (MS2): `applies` is true only when this film is exactly
 *  `widthPx` × `heightPx` (MQ1, no tolerance, no swapping). `sourceFilmDate` is read live (MQ3): null when the
 *  source film is gone or has no film date. */
export interface MachineScale {
  machineId: string; machineName: string; spacingMm: number; widthPx: number; heightPx: number;
  source: 'film' | 'entered'; sourceCaseId: string | null; sourceFilmDate: string | null; setAt: string; applies: boolean;
}
/** A machine's scale as stored (MS1): `source` "entered" or "film:<case id>"; `setAt` null = now (an undo passes the
 *  old time back, so it restores the value and nothing else). */
export interface MachineScaleRow { spacingMm: number; widthPx: number; heightPx: number; source: string; setAt: string | null }
/** What a scale change does (MS4): live films whose mm change, live films fitted to them with "Use the scale from
 *  the fit" on, and how many more of either are in Recently deleted. */
export interface ScaleChange { films: string[]; fitted: string[]; deleted: number }
export interface MachineSummary {
  id: string; name: string; films: number; learned: string[];
  /** Spec 2026-10-20: this machine's calibrated scale, if any (`applies` unused here: no film in view). */
  scale: MachineScale | null;
  /** Live films with no ruler that this scale applies to, right now. */
  scaleFilms: number;
}
/** A Patient ID link suggestion (addendum D2, LIBID-1): a different, named patient whose X-rays carry the same
 *  Patient ID as the one being viewed, and how many of its X-rays do. */
export interface IdMatch { libraryId: string; patient: PatientRef; films: number }
export interface LabelOutcome extends IdentityOutcome { lines: FilmLine[]; learnedFields: string[]; conflicts: Conflict[]; suggestions: Suggestion[] }
export interface FilmTextOut { lines: FilmLine[]; suggestions: Suggestion[] }
/** A film's ABO stage (spec 2026-09-30); null = Auto. */
export type Stage = 'initial' | 'progress' | 'final' | 'retention';
export interface SeriesFilm {
  id: string; timepoint: string; takenOn: string | null; takenOnSource: 'label' | 'image' | 'import' | 'manual' | null;
  createdAt: string; stage: Stage | null; inSeries: boolean;
  /** Joined on name alone (this film or the open one has no date of birth): the key says "(no DOB)". */
  nameOnly: boolean;
  /** Request G: the film this one is fitted to, if the fit still applies; absent or null = not fitted. */
  fitRef?: string | null;
  /** Request G: whether the film was calibrated from its ruler (absent = not known: read as false). */
  calibrated?: boolean;
}
/** Request G (format 12): which reference points a fit is picked on. */
export type FitRefKind = 'sn' | 'points';
/** Request G (format 12): one fit as the operator saves it (library format 12's `film_fits` row, minus bookkeeping). */
export interface FitSave { refCaseId: string; refKind: FitRefKind; refPoints: [[number, number], [number, number]];
  filmPoints: [[number, number], [number, number]]; mirror: boolean; scale: number; rotation: number; dx: number; dy: number }
/** Request G (format 12): a saved fit as the library reads it back, with who/when and the reference's own spacing. */
export interface FilmFit extends FitSave { useOwn: boolean; refTimepoint: string; refSpacingMm: number | null;
  /** Spec 2026-10-20 (MS2, MS4): the reference's machine scale, when it has no ruler; null = none. A reference's
   *  machine scale counts as calibrated for a fit (not G3 assumed). */
  refMachineSpacingMm?: number | null;
  savedBy: string; savedAt: string }
/** One line of the Library ID trail (owner L9-A, 18 Oct): a number merged into this patient's, or an X-ray that left
 *  one of its numbers. `on` is the local day of the move (YYYY-MM-DD). */
export type TrailLine =
  | { kind: 'merged'; number: string; into: string; on: string }
  | { kind: 'left'; number: string; on: string; now: string | null; name: string };
/** Spec 2026-10-19 (F): the ruler marks behind a case's current scale, in image pixels, and their true distance. */
export interface RulerMarks { p1: Vec2; p2: Vec2; mm: number; /** Addendum 3: fine-tune presses on these marks. */ steps: number }
export interface CaseDoc {
  id: string; patientName: string; timepoint: string; takenOn: string | null; image: ImageInfo; facing: Facing;
  orientation: Partial<Orientation>; display: Partial<Display>; spacingMm: number | null;
  /** Spec 2026-10-19 Addendum 3: fine-tune presses (−10…+10) on the ruler behind spacingMm; 0 = none, or no ruler. */ scaleSteps: number;
  verifiedAt: string | null; verifiedBy: string | null; landmarks: LandmarkRow[]; createdAt: string; updatedAt: string;
  patientKey: string; dateOfBirth: string | null; scanId: string | null; identitySource: 'film' | 'manual'; identityChecked: boolean; identityIssues: IdentityIssue[];
  takenOnSource: 'label' | 'image' | 'import' | 'manual' | null;
  /** Fields filled from the machine's learned default and not yet confirmed: "name", "dob", "scan_date", "scan_id". */
  learnedFields: string[];
  gender: Gender | null;
  referringPractitioner: string | null;
  /** The reference population chosen for this case (Part C, N6): a population id, `auto` (owner decision 3, 29 Oct
   *  2026: the patient's background, else the clinic default, else the largest study — the default for new cases), or
   *  null = the old "Clinic default" (`settings.defaultPopulation`). */
  population: string | null;
  /** The patient's recorded background (spec 2026-10-29 §4.1, format 18): a population id or `other`; null = Not
   *  recorded. On the patient, like Gender; used only by Auto; never exported. */
  background: string | null;
  /** Spec 2026-10-29 §4.8: the format-18 upgrade switched this case from "Clinic default" to Auto and it is still on
   *  Auto (the case panel then offers "Clinic default (as before the upgrade)"). */
  switchedFromClinicDefault: boolean;
  /** Patient ID as printed, saved on this X-ray only (format 11, addendum D2 Q8: each X-ray keeps its own); null = blank. */
  printedPatientId: string | null;
  /** X-ray type, X-ray dimensions (text only, never used for scale) and Radiography practice, on this film (format 11). */
  xrayType: string | null; xraySize: string | null; radiographyPractice: string | null;
  /** The library's own number for this X-ray's patient (addendum D2, LIBID-1); null until the patient has a name. */
  libraryId: string | null;
  /** Every Patient ID on this patient's live X-rays (addendum D2, LIBID-1), oldest X-ray first. */
  patientIdsSeen: string[];
  /** Other, named patients whose X-rays carry this X-ray's own Patient ID (addendum D2, LIBID-1): a link
   *  suggestion, never auto-joined. Empty while this X-ray's own Patient ID is blank. */
  idMatches: IdMatch[];
  /** Where this patient's numbers went (owner L9-A): oldest first; empty when there is nothing to say. */
  libraryTrail: TrailLine[];
  /** Request G (format 12): this film's fit to another film of the same patient; absent or null = none. */
  fit?: FilmFit | null;
  /** Spec 2026-10-20 (MS2): the X-ray machine this film is recognised as, and its calibrated scale (if any), with
   *  whether it applies to this film's exact pixel size (MS4's screen order: ruler, then machine, then fit, then
   *  assumed). Absent or null = not recognised, or the machine has no scale. */
  machine?: MachineRef | null; machineScale?: MachineScale | null;
  /** The patient's title as printed ("Mr", "Dr."; owner T1, format 13); null = blank. */
  title: string | null;
  /** The age printed on (or typed for) this X-ray, as printed ("011Y"), and in years (owner AG1, format 13); null = blank. */
  ageOnFilm: string | null; ageOnFilmYears: number | null;
}
export interface CaseEdit { id: string; facing: Facing; orientation: Orientation; display: Display; landmarks: LandmarkRow[] }
export interface CaseMeta { patientName: string; timepoint: string; takenOn: string | null; dateOfBirth: string | null; scanId: string | null }
/** The patient's gender (schema 8); null = Not recorded. */
export type Gender = 'F' | 'M';
/** The learnable film details beside Patient ID (format 11, spec 2026-10-17). */
export type FilmDetailField = 'xray_type' | 'xray_size' | 'practice';
/** Owner Q10: the fields a "Learned for this machine" mark can sit on, so a typo'd field name is a compile error
 *  here, not only the Rust-side `anyhow` refusal (`details.rs`'s `ACCEPTABLE`). */
export type LearnedField = 'patient_id' | 'xray_type' | 'xray_size' | 'practice' | 'gender' | 'referrer';
export interface CaseSummary {
  id: string; patientName: string; timepoint: string; takenOn: string | null; createdAt: string; updatedAt: string;
  thumbPath: string; landmarks: number; unverified: number; verifiedAt: string | null; deletedAt: string | null;
  orientation: Partial<Orientation> | null;
  dateOfBirth: string | null; patientKey: string; identityChecked: boolean;
  /** The library's own number for this X-ray's patient (addendum D2, LIBID-1); null until the patient has a name. */
  libraryId: string | null;
  /** Every number ever merged into this patient's current one (addendum D2, LIBID-2; the Library search box). */
  formerLibraryIds: string[];
  /** This X-ray's own printed Patient ID (addendum D2, LIBID-1; the Library search box). */
  printedPatientId: string | null;
  /** The patient's gender, for the Library table's M/F column (owner decisions, 29 Oct 2026); null = Not recorded. */
  gender: Gender | null;
  /** Which model placed this film's AI points, for the Library table's AI status column (owner decisions, 29 Oct
   *  2026): `AUTO_BEST` when Automatic best placed any of them, else the model most of them carry, else null on a
   *  film with no AI point. Resolve to a title with the running models list, never shown raw. */
  aiModelId: string | null;
  /** When a PDF report of this film was last saved (format 16; the Library table's Report column, owner 29 Oct 2026),
   *  recorded by `export_write` only after the file was written; null = none saved since format 16. */
  reportSavedAt: string | null;
}
export interface Saved { updatedAt: string; verifiedAt: string | null }
export interface Imported { caseId: string; created: boolean }
export interface AiRun { modelId: string; executionProvider: string; facing: Facing; totalMs: number; modelSha256?: string | null }

export interface Licence { version: string; code: string; weights: string; summary: string; url: string; nonCommercial: boolean }
export type ModelStatusKind = 'not-installed' | 'installing' | 'ready' | 'failed';
/** A Model Manager row (src-tauri/src/models.rs). */
export interface ModelRow {
  id: string; title: string; tier: 'standard' | 'optional'; citation: string; sizeMb: number; licence: Licence; licenceAccepted: boolean;
  status: ModelStatusKind; stage: string | null; error: string | null; main: boolean; msPerFilm: number | null; page: string;
  /** Set when this Ready model's installed point map couldn't pick up the catalogue's latest names; never blocks use. */
  notice: string | null;
  /** Owner O5 (13 Oct): Models… marks this model "recommended", installed or not. */
  recommended: boolean;
}
/** The `models://progress` event. */
export interface ModelProgress { id: string; stage: string; fraction: number | null }
export interface ExtraResult { modelId: string; title: string; detection: Detection | null; error: string | null; timedOut: boolean }
export interface AiPoint { channel: number; landmarkId: string | null; x: number; y: number; peak: number }
/** One model's latest points on a film (for the ghost marks). */
export interface ModelPoints { modelId: string; ranAt: string; facing: Facing; points: AiPoint[]; executionProvider?: string; modelSha256?: string | null }
/** A point's standing against the owner's 2 mm gate (crates/ceph-model/src/scores.rs; rulings R-B1, R-B2, 7 Oct). */
export type PointStatus =
  | { kind: 'original' } | { kind: 'scored'; mre: number; n: number; dataset: string }
  | { kind: 'tooFar'; mre: number; n: number; dataset: string } | { kind: 'notScored' };
/** One Ready model and the points it finds (`models_points`): catalogue order, main first. */
/** Part F: the acceptance behind a switch in force — its date and the films that decided, in words (owner E1). */
export interface ChoiceNote { since: string; basis: string }
/** The per-point source table (`models_main_point_source`; reference/main-point-source.json, owner O6), plus the
 *  owner's accepted Part F switches, point → model, and each one's note (both absent from older back ends). */
export interface MainPointSource { ruleVersion: string; confirmationPending: boolean; points: Record<string, string>;
  ownerChoices?: Record<string, string>; ownerChoiceNotes?: Record<string, ChoiceNote>; autoBest?: AutoBestMap | null;
  /** M4 (2 Nov 2026): Automatic best is the main setting but its choices could not be read: the plain base places every point. */
  autoBestUnreadable?: boolean }
/** Automatic best (spec 2026-10-27): one change of its verdict at a point (format 15's append-only `auto_best_events`). */
export interface AutoBestEvent { id: number; landmarkId: string; kind: 'adopted' | 'returned' | 'undone' | 'redone'; modelId: string;
  fingerprint: string | null; uses: string | null; lastImportedAt: string | null; lastCaseId: string | null; basis: string | null;
  reason: 'file-changed' | 'not-installed' | 'evidence' | null; numbers: unknown; ruleVersion: string; operator: string; at: string }
/** Automatic best's map for Models… and for placement: whether it is available (its base installed) and on, the base
 *  (spec 2026-10-29: the starting model and the yardstick; absent from older back ends, which read as Aariz), which
 *  model it uses at each point, each point's note, the Undo in force at each point (`kept`), and the latest change rows. */
export interface AutoBestMap { available: boolean; on: boolean; base: string; uses: Record<string, string>; notes: Record<string, { since: string | null; basis: string }>;
  kept: Record<string, { modelId: string; since: string }>; latest: AutoBestEvent[] }
/** A change of base (spec 2026-10-29 §4): from, to, and the per-point rows it wrote (cause `base-changed`). */
export interface BaseChanged { from: string; to: string; events: AutoBestEvent[] }
/** Owner D1: the once-per-library upgrade note ("before" the previous main model, or null for a new library). */
export interface IntroNote { before: string | null; keptDeclines: number }
/** Part F, rule best-point/3 (crates/ceph-model/src/best.rs): where a film's scale came from, most accurate first. */
export type Tier = 'ruler' | 'machine' | 'fit' | 'assumed';
export interface TierCounts { ruler: number; machine: number; fit: number; assumed: number }
export interface FilmKey { importedAt: string; caseId: string }
/** One block of 30 films, in mm: the weighted median and weighted share decide; the plain numbers are kept beside them. */
export interface BestBlock { caseIds: string[]; first: FilmKey; last: FilmKey;
  incumbentMedianMm: number; challengerMedianMm: number; incumbentPlainMedianMm: number; challengerPlainMedianMm: number;
  incumbentMeanMm: number; challengerMeanMm: number; incumbentPlainMeanMm: number; challengerPlainMeanMm: number;
  incumbentWithin: number; challengerWithin: number; incumbentWithinShare: number; challengerWithinShare: number;
  acceptedUnmoved: number; passed: boolean }
export type BestVerdict = { kind: 'notEnough'; films: number } | { kind: 'reCheck'; look: BestBlock; films: number }
  | { kind: 'keep'; look: BestBlock; check: BestBlock | null; films: number } | { kind: 'offer'; look: BestBlock; check: BestBlock };
export interface BestPair { modelId: string; basis: Tier | null; films: number; available: TierCounts; acceptedUnmoved: number; leftOutEarlierFile: number; verdict: BestVerdict }
export interface BestPoint { landmarkId: string; current: string; pairs: BestPair[]; offer: string | null; offerBasis: Tier | null;
  filmsByScale: TierCounts; fineTunedRuler: number; leftOutOtherPlacer: number }
export interface PointChoice { id: number; landmarkId: string; modelId: string; action: 'accepted' | 'declined' | 'undone'; ruleVersion: string;
  lastImportedAt: string | null; lastCaseId: string | null; basis: string | null; numbers: unknown; operator: string; at: string }
/** Part F, the weights check (owner Q4; crates/ceph-model/src/regress.rs, weights-check/1). */
export type CheckVerdict = { kind: 'noFilms' } | { kind: 'tooFew' } | { kind: 'noWorse' } | { kind: 'worse'; medianUp: boolean; fewerWithin: boolean };
export interface CheckPoint { landmarkId: string; films: number; noNewPoint: number; oldMedianMm: number | null; newMedianMm: number | null;
  oldWithin: number; newWithin: number; verdict: CheckVerdict }
export interface ModelCheck { modelId: string; fingerprint: string; version: string; filmsChecked: number; filmsDue: number; filmsFailed: number;
  failedDetail: string | null; points: CheckPoint[]; goBack: string[] }
/** `cephtrace://weights-check`: one film done; an empty modelId means the run ended. */
export interface WeightsCheckProgress { modelId: string; done: number; total: number }
export const WEIGHTS_CHECK_EVENT = 'cephtrace://weights-check';
export interface BestPerPoint { ruleVersion: string; points: BestPoint[]; choices: PointChoice[]; checks: ModelCheck[] }
export interface ModelPointRow { modelId: string; title: string; main: boolean; points: { id: string; status: PointStatus }[] }
/** The whole-film check's region finder, as Models… shows it (`check_model_row`). */
export interface CheckRow { title: string; author: string; licence: string; citation: string; page: string; sizeMb: number;
  status: 'not-installed' | 'installing' | 'ready' | 'failed' | 'damaged'; byHand: boolean; stage: string | null; error: string | null }
export const checkModel = {
  row: () => invoke<CheckRow>('check_model_row'),
  install: () => invoke<void>('check_model_install'),
  /** `path` is the folder holding manifest.json and model.onnx. */
  addFiles: (path: string) => invoke<void>('check_model_add_files', { path }),
  remove: () => invoke<void>('check_model_remove'),
  /** Whether to ask the one-time question now. */
  offer: () => invoke<boolean>('check_model_offer'),
  offerAnswered: () => invoke<void>('check_model_offer_answered'),
};
export const models = {
  list: () => invoke<ModelRow[]>('models_list'),
  /** Who finds which point on this Mac, and whether each passes the gate. */
  points: () => invoke<ModelPointRow[]>('models_points'),
  /** Which model places each original point when Aariz is the main model (embedded in the app). */
  mainPointSource: () => invoke<MainPointSource>('models_main_point_source'),
  /** Part F: the rule's verdict per point and every answer given (rule best-point/3). */
  bestPerPoint: () => invoke<BestPerPoint>('models_best_per_point'),
  /** Part F: accept or decline the offer for a point, or undo a switch. Refused unless the rule offers it now. */
  answerPoint: (landmarkId: string, modelId: string, answer: 'accept' | 'decline' | 'undo') => invoke<void>('models_point_choice', { landmarkId, modelId, answer }),
  /** Part F (owner Q4): start the weights check in the background; returns at once. */
  weightsCheckRun: () => invoke<void>('models_weights_check_run'),
  acceptLicence: (id: string) => invoke<void>('models_accept_licence', { id }),
  install: (id: string) => invoke<void>('models_install', { id }),
  addFile: (id: string, path: string) => invoke<void>('models_add_file', { id, path }),
  remove: (id: string) => invoke<void>('models_remove', { id }),
  setMain: (id: string) => invoke<void>('models_set_main', { id }),
  /** Automatic best (spec 2026-10-27): its map for Models… */
  autoBest: () => invoke<AutoBestMap | null>('models_auto_best'),
  /** Records changes of its verdict; returns whether it is the main model and the rows just written (the notes). */
  autoBestSync: () => invoke<{ on: boolean; events: AutoBestEvent[] } | null>('models_auto_best_sync'),
  /** Undo names the change it undoes (the note's row, final review I3): refused if it is no longer the point's latest.
   *  Returns the rows written: the Undo, then any second model's adoption it handed the point to. */
  autoBestUndo: async (landmarkId: string, eventId: number) => (await invoke<AutoBestEvent[] | null>('models_auto_best_undo', { landmarkId, eventId })) ?? [],
  /** "Use … again" names the Undo it takes back (follow-up round): refused if that Undo is no longer the one in force. */
  autoBestRedo: (landmarkId: string, eventId: number) => invoke<void>('models_auto_best_redo', { landmarkId, eventId }),
  /** Once per library (owner D1): the upgrade note, or null. */
  autoBestIntro: () => invoke<IntroNote | null>('models_auto_best_intro'),
  autoBestWayBack: () => invoke<string>('models_auto_best_way_back'),
  /** Changes Automatic best's base (both drop-downs, spec 2026-10-29 §2): refused, changing nothing, for a model not installed. */
  setBase: (id: string) => invoke<BaseChanged>('models_auto_best_set_base', { id }),
};
/** Every Ready model except the main one, on this film with the main model's facing. */
/** `run` (review I-1): this tracing run's number, echoed in each extra model's progress event; none for a batch. */
export const detectExtras = (path: string, facingLeft: boolean, run: number | null = null) => invoke<ExtraResult[]>('detect_extras', { path, facingLeft, run });

export const detectLandmarks = (path: string, facing: Facing | 'auto') =>
  invoke<DetectResult>('detect_landmarks', { path, facing: facing === 'auto' ? null : facing });
export const modelStatus = () => invoke<ModelStatus>('model_status');
export const setModelDir = (dir: string) => invoke<string>('set_model_dir', { dir });
/** The last edit is on disk: let the app quit (review #2). */
export const quitNow = () => invoke<void>('quit_now');

export const library = {
  list: (deleted = false) => invoke<CaseSummary[]>('library_list', { deleted }),
  import: (path: string) => invoke<Imported>('library_import', { path }),
  open: (caseId: string) => invoke<Omit<CaseDoc, 'scaleSteps'> & { scaleSteps?: number }>('library_open', { caseId })
    .then((d): CaseDoc => ({ ...d, scaleSteps: d.scaleSteps ?? 0 })),
  /** Part F: each AI point's model file (fingerprint), for the points CSV. */
  pointFiles: (caseId: string) => invoke<Record<string, string>>('library_point_files', { caseId }),
  save: (edit: CaseEdit) => invoke<Saved>('library_save', { edit }),
  /** Batch tracing: writes only if the case is still untraced (a case opened meanwhile is never overwritten). */
  saveAiIfUntraced: (edit: CaseEdit) => invoke<boolean>('library_save_ai_if_untraced', { edit }),
  /** `fresh`: the pins this run's detection has just replaced (Replace all), so no earlier look is carried to them (re-review N1). */
  recordAi: (caseId: string, run: AiRun, points: AiPoint[], fresh: string[] = []) => invoke<void>('library_record_ai', { caseId, run, points, fresh }),
  /** Each model's latest points on this film. The source guard (Task 10 review, Important #1): a `null` back-end
   *  answer (no runs stored yet) reads as `[]`, never `null`, so every consumer — the screen (`useCase.ts`), the
   *  batch/report export (`export/batch.ts`), and anything written later — is safe by construction. */
  ghosts: (caseId: string) => invoke<ModelPoints[] | null>('library_ghosts', { caseId }).then((r) => r ?? []),
  setMeta: (caseId: string, meta: CaseMeta) => invoke<void>('library_set_meta', { caseId, meta }),
  /** Single-field saves (final-review fix round, Important 1): each writes only its own column, so a Gender save
   *  and a Referrer save landing out of order can never overwrite one another's value. */
  setPatientGender: (caseId: string, gender: Gender | null) => invoke<void>('library_set_patient_gender', { caseId, gender }),
  /** The patient's background (spec 2026-10-29 §4.1); null clears it to Not recorded. */
  setPatientBackground: (caseId: string, background: string | null) => invoke<void>('library_set_patient_background', { caseId, background }),
  setPatientReferrer: (caseId: string, referringPractitioner: string | null) =>
    invoke<void>('library_set_patient_referrer', { caseId, referringPractitioner }),
  /** Format 11 (spec 2026-10-17): single-field saves, like Gender and Referrer. */
  setPatientId: (caseId: string, patientId: string | null) => invoke<void>('library_set_patient_id', { caseId, patientId }),
  setFilmDetail: (caseId: string, field: FilmDetailField, value: string | null) => invoke<void>('library_set_film_detail', { caseId, field, value }),
  /** Spec 2026-10-19 (format 13): Title on the patient; the age on this film, as printed and in years (both or neither). */
  setPatientTitle: (caseId: string, title: string | null) => invoke<void>('library_set_patient_title', { caseId, title }),
  setFilmAge: (caseId: string, printed: string | null, years: number | null) => invoke<void>('library_set_film_age', { caseId, printed, years }),
  /** "Not the same" on a Patient ID link suggestion (addendum D2, LIBID-1): remembered for this X-ray and that
   *  patient's Library ID only. */
  notSamePatient: (caseId: string, libraryId: string) => invoke<void>('library_not_same_patient', { caseId, libraryId }),
  /** The ✓ beside a "Learned for this machine" mark (owner Q10): keeps the value, drops only that mark. */
  acceptLearned: (caseId: string, field: LearnedField) => invoke<void>('library_accept_learned', { caseId, field }),
  /** After import, before detection: read the film's label and fill the case (asks when unsure). */
  readLabel: (caseId: string) => invoke<LabelOutcome>('library_read_label', { caseId }),
  /** "Read the film again": the text on the film only; nothing is filled or saved. */
  labelText: (caseId: string) => invoke<FilmTextOut>('library_label_text', { caseId }),
  /** Re-reads a small area ([x, y, w, h], 0–1 of the film) enlarged, both ways round. */
  readArea: (caseId: string, rect: Box) => invoke<FilmLine[]>('library_read_area', { caseId, rect }),
  /** Words chosen on the film for a field: teaches the film's machine where it is printed. */
  learnSelection: (caseId: string, field: string, line: number, from: number, to: number, text: string) =>
    invoke<void>('library_learn_selection', { caseId, field, line, from, to, text }),
  /** A confirmed value: if it is printed on the film, teaches the machine where. */
  learnValue: (caseId: string, field: string, value: string) => invoke<boolean>('library_learn_value', { caseId, field, value }),
  machines: () => invoke<MachineSummary[]>('library_machines'),
  renameMachine: (id: string, name: string) => invoke<void>('library_rename_machine', { id, name }),
  resetMachine: (id: string) => invoke<void>('library_reset_machine', { id }),
  deleteMachine: (id: string) => invoke<void>('library_delete_machine', { id }),
  /** Spec 2026-10-20 (MS1, MS4): "Use for this machine", the count a change would make, the change itself. */
  machineScaleFromFilm: (caseId: string) => invoke<[string, MachineScaleRow]>('library_machine_scale_from_film', { caseId }),
  machineScaleChange: (machineId: string, row: MachineScaleRow | null) => invoke<ScaleChange>('library_machine_scale_change', { machineId, row }),
  setMachineScale: (machineId: string, row: MachineScaleRow | null) => invoke<ScaleChange>('library_set_machine_scale', { machineId, row }),
  machineDeleteChange: (id: string) => invoke<ScaleChange>('library_machine_delete_change', { id }),
  confirmIdentity: (caseId: string, sameAs: PatientRef | null) => invoke<void>('library_confirm_identity', { caseId, sameAs }),
  /** OK on the film-date note: the clinician accepts the date as it is. */
  confirmFilmDate: (caseId: string) => invoke<void>('library_confirm_film_date', { caseId }),
  /** Serial superimposition (spec 2026-09-30): the open film and the same patient's other live films, unordered. */
  series: (caseId: string) => invoke<SeriesFilm[]>('library_series', { caseId }),
  setStage: (caseId: string, stage: Stage | null) => invoke<void>('library_set_stage', { caseId, stage }),
  setInSeries: (caseId: string, on: boolean) => invoke<void>('library_set_in_series', { caseId, on }),
  /** Request G: save, remove (Reset) and "Use the scale from the fit" for one film. */
  saveFit: (caseId: string, fit: FitSave) => invoke<void>('library_save_fit', { caseId, fit }),
  clearFit: (caseId: string) => invoke<void>('library_clear_fit', { caseId }),
  setFitOwn: (caseId: string, on: boolean) => invoke<void>('library_set_fit_own', { caseId, on }),
  setVerified: (caseId: string, verified: boolean) => invoke<void>('library_set_verified', { caseId, verified }),
  calibrate: (caseId: string, p1: Vec2, p2: Vec2, mm: number) =>
    invoke<number>('library_calibrate', { caseId, p1: [p1.x, p1.y], p2: [p2.x, p2.y], mm }),
  /** Spec 2026-10-19 Addendum 3: a calibration fine-tuned by whole presses of 0.5 % of the ruler's own value (−10…+10). */
  recalibrate: (caseId: string, p1: Vec2, p2: Vec2, mm: number, steps: number) =>
    invoke<number>('library_recalibrate', { caseId, p1: [p1.x, p1.y], p2: [p2.x, p2.y], mm, steps }),
  /** Spec 2026-10-19 (F): the marks behind the case's current scale; null if never calibrated or the scale came from elsewhere since. */
  ruler: (caseId: string) => invoke<{ p1: [number, number]; p2: [number, number]; mm: number; steps?: number } | null>('library_ruler', { caseId })
    .then((r): RulerMarks | null => (r ? { p1: { x: r.p1[0], y: r.p1[1] }, p2: { x: r.p2[0], y: r.p2[1] }, mm: r.mm, steps: r.steps ?? 0 } : null)),
  /** Stage A: each model's latest checked run on the film and its flags, as stored (read only). */
  pointChecksForCase: (caseId: string) => invoke<PointCheckView | null>('point_checks_for_case', { caseId }),
  /** Stage A task 7: "Checked" on the film note resolves that film row (`film-checked`). Refused for a row of an older run. */
  pointCheckFilmChecked: (caseId: string, checkId: number) => invoke<boolean>('point_check_film_checked', { caseId, checkId }),
  /** Stage A task 8: Models… counts, per point: flagged, and left as placed; each model's latest run on live films. */
  pointCheckCounts: () => invoke<PointCheckCount[]>('point_check_counts'),
  /** SC-1 Part 1 task 8: the whole-film note's stored result (src-tauri/src/whole_film.rs `WholeFilmView`), read only. */
  wholeFilmCheck: (caseId: string) => invoke<WholeFilmView>('whole_film_check', { caseId }),
  /** SC-1 Part 1b Task D2: Settings › Checks, "Whole-film check (beta)": read the switch, and set it (writes `on`/`off`; deletes nothing). */
  wholeFilmSwitch: () => invoke<WholeSwitch>('whole_film_switch'),
  wholeFilmSwitchSet: (on: boolean) => invoke<WholeSwitch>('whole_film_switch_set', { on }),
  /** SC-1 task 8: `Checked` with one of three reasons on the shown check. false: already resolved (the first reason stays). */
  wholeFilmCheckResolve: (caseId: string, checkId: number, reason: ResolveReason) => invoke<boolean>('whole_film_check_resolve', { caseId, checkId, reason }),
  remove: (caseId: string) => invoke<void>('library_delete', { caseId }),
  restore: (caseId: string) => invoke<void>('library_restore', { caseId }),
  backup: (dest: string) => invoke<string>('library_backup', { dest }),
  restoreBackup: (dir: string) => invoke<void>('library_restore_backup', { dir }),
  /** The safety copy's folder if opening the library upgraded its format (once; then null). */
  upgradeCopy: () => invoke<string | null>('library_upgrade_copy'),
  /** Owner, 6 Nov 2026: whether opening the library would upgrade its format (a notice comes first); null: no upgrade needed. Opens nothing. */
  upgradePending: () => invoke<{ from: number; to: number } | null>('library_upgrade_pending'),
  /** Continue on that notice: the library may now be opened (and upgraded, after its checked safety copy). */
  upgradeConfirm: () => invoke<void>('library_upgrade_confirm'),
  /** Quit on that notice: closes the app; the library has not been opened. */
  upgradeQuit: () => invoke<void>('library_upgrade_quit'),
  /** The case's chosen reference population (Part C, N6); null clears it back to the clinic default. */
  setCasePopulation: (caseId: string, population: string | null) => invoke<void>('library_set_case_population', { caseId, population }),
  /** The clinician's own norms (never in git; always labelled "user norm"). */
  userNorms: () => invoke<UserNorm[]>('library_user_norms'),
  saveUserNorm: (n: UserNorm) => invoke<void>('library_save_user_norm', { norm: n }),
  deleteUserNorm: (setName: string, measurement: string) => invoke<void>('library_delete_user_norm', { setName, measurement }),
};
/** Stage A point check (src-tauri/src/point_check.rs `FlagView`, `RunView`, `PointCheckView`): stored results, read only.
 *  The check only flags; nothing on screen is moved by it. A ring is in film px (centre = where the rest of the face
 *  expected the point; `angleDeg` the major axis's turn). `action` `film-unusual` is ONE film row: `landmarkId` null,
 *  `points` the ids out of keeping (a list that can name a point that was not wrong), no ring. */
export interface PointCheckRing { cx: number; cy: number; rx: number; ry: number; angleDeg: number }
export interface PointCheckFlag {
  id: number; modelId: string; landmarkId: string | null; action: 'flagged' | 'film-unusual'; points: string | null; offPx: number | null;
  expectedX: number | null; expectedY: number | null; ring: PointCheckRing | null; resolved: string | null;
}
export interface PointCheckRun { modelId: string; outcome: 'clean' | 'flagged' | 'film-unusual' | 'not-run'; notRunReason: string | null; present: number | null }
export interface PointCheckView { runs: PointCheckRun[]; flags: PointCheckFlag[] }
/** SC-1 Part 1 (src-tauri/src/whole_film.rs `WholeFilmView`, `CheckView`, `ReasonView`): the strings are the STORED keys (kebab-case),
 *  region keys included (`cranial-base`, `maxilla`, `mandible`, `incisors`, `soft-tissue`); `wholeFilm.ts` turns them into words. */
export type ResolveReason = 'tracing-right' | 'expected-variant' | 'corrected-tracing';
/** `factor` (a `size` reason only): how big the tracing is against the anatomy on this film, ×0.5 half, ×2 double (read from the stored `factor=` detail). */
export interface WholeReasonView { reason: 'mirrored' | 'shape' | 'region' | 'size' | 'facing' | 'no-ceph-found'; region: string | null; ids: string[]; named: string[]; factor?: number | null }
export interface WholeCheckView {
  id: number; subject: 'run' | 'final'; modelId: string | null; outcome: 'clean' | 'flagged' | 'not-run';
  shapeLook: 'judged' | 'too-few-points' | 'not-set-up'; regionLook: 'judged' | 'no-region-model' | 'not-set-up' | 'film-too-small';
  present: number; reasons: WholeReasonView[]; resolved: { reason: ResolveReason; operator: string; resolvedAt: string } | null;
  /** Whole-film/2: the size look's stored status, and the cranial-base centre look's stored status (the same five keys). */
  sizeLook: 'judged' | 'not-set-up' | 'no-region-model' | 'film-too-small' | 'too-few'; cbLook: 'judged' | 'not-set-up' | 'no-region-model' | 'film-too-small' | 'too-few'; cbPresent: number;
  /** The 19 landmarks with their region's result from the region look (src-tauri `LandmarkRegionView`; only the research CSV reads it). */
  landmarkRegions?: { id: string; region: string; result: 'fine' | 'flagged' | 'not-checked' }[];
  /** Whether the region finder gave a facing (stored with its run); the facing look is judged by the regions only then. Absent (an older view) reads false. */
  regionFacing?: boolean;
}
/** `shown` is null until a run's landmarks are saved (and for a film never checked): then there is no note. `off`: the switch in
 *  Settings › Checks is off; nothing is shown (the stored checks are kept) and the points file's cell reads `off`. */
export interface WholeFilmView { shown: WholeCheckView | null; checks: WholeCheckView[]; off: boolean }
/** Settings › Checks (src-tauri `WholeSwitch`): whether the whole-film check is on, whether that is its default (nothing stored), and the result line. */
export interface WholeSwitch { on: boolean; isDefault: boolean; line: string }
/** One Models… row (src-tauri `PointCount`): how often the placing model's flag at this point was raised, and how often you (the operator now) left it as placed. */
export interface PointCheckCount { landmarkId: string; flagged: number; left: number }
/** Who traces on this Mac (spec 2026-10-01 Part 3): verified tracings are credited to `current`. */
export interface Operators { current: string; names: string[] }
export const operators = {
  list: () => invoke<Operators>('operators_list'),
  add: (name: string) => invoke<Operators>('operators_add', { name }),
  setCurrent: (name: string) => invoke<void>('operators_set_current', { name }),
};
export const settings = {
  get: (key: string) => invoke<string | null>('settings_get', { key }),
  set: (key: string, value: string) => invoke<void>('settings_set', { key, value }),
  /** The clinic default reference population (Part C, N6); null = not set, null clears it. */
  defaultPopulation: () => invoke<string | null>('settings_default_population_get'),
  setDefaultPopulation: (population: string | null) => invoke<void>('settings_default_population_set', { population }),
  /** Spec 2026-10-29 §4.8: the number of live cases the upgrade switched to Auto, while its note has not been shown. */
  autoSwitchNote: () => invoke<number | null>('settings_auto_switch_note'),
  dismissAutoSwitchNote: () => invoke<void>('settings_auto_switch_note_dismiss'),
};
/** Plain text files the clinician chose in a save or open dialog (owner B4: an analysis shared as a file). */
export const files = {
  writeText: (path: string, text: string) => invoke<void>('text_file_write', { path, text }),
  readText: (path: string) => invoke<string>('text_file_read', { path }),
};
