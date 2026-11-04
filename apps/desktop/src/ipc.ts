// Typed wrappers around the Tauri commands in src-tauri/src/{lib,library}.rs. Shapes mirror ceph-store's serde types.
import { invoke } from '@tauri-apps/api/core';
import type { Vec2 } from '@ceph/geometry';
import type { Orientation } from './canvas/orientation';
import type { Display, Source } from './tracing/state';
import type { UserNorm } from '@ceph/analyses';
export type { Source };
export type { UserNorm };

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
export interface MachineSummary { id: string; name: string; films: number; learned: string[] }
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
}
/** One line of the Library ID trail (owner L9-A, 18 Oct): a number merged into this patient's, or an X-ray that left
 *  one of its numbers. `on` is the local day of the move (YYYY-MM-DD). */
export type TrailLine =
  | { kind: 'merged'; number: string; into: string; on: string }
  | { kind: 'left'; number: string; on: string; now: string | null; name: string };
export interface CaseDoc {
  id: string; patientName: string; timepoint: string; takenOn: string | null; image: ImageInfo; facing: Facing;
  orientation: Partial<Orientation>; display: Partial<Display>; spacingMm: number | null;
  verifiedAt: string | null; verifiedBy: string | null; landmarks: LandmarkRow[]; createdAt: string; updatedAt: string;
  patientKey: string; dateOfBirth: string | null; scanId: string | null; identitySource: 'film' | 'manual'; identityChecked: boolean; identityIssues: IdentityIssue[];
  takenOnSource: 'label' | 'image' | 'import' | 'manual' | null;
  /** Fields filled from the machine's learned default and not yet confirmed: "name", "dob", "scan_date", "scan_id". */
  learnedFields: string[];
  gender: Gender | null;
  referringPractitioner: string | null;
  /** The reference population chosen for this case (Part C, N6); null = use the clinic default (`settings.defaultPopulation`). */
  population: string | null;
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
/** The per-point source table (`models_main_point_source`; reference/main-point-source.json, owner O6). */
export interface MainPointSource { ruleVersion: string; confirmationPending: boolean; points: Record<string, string> }
export interface ModelPointRow { modelId: string; title: string; main: boolean; points: { id: string; status: PointStatus }[] }
export const models = {
  list: () => invoke<ModelRow[]>('models_list'),
  /** Who finds which point on this Mac, and whether each passes the gate. */
  points: () => invoke<ModelPointRow[]>('models_points'),
  /** Which model places each original point when Aariz is the main model (embedded in the app). */
  mainPointSource: () => invoke<MainPointSource>('models_main_point_source'),
  acceptLicence: (id: string) => invoke<void>('models_accept_licence', { id }),
  install: (id: string) => invoke<void>('models_install', { id }),
  addFile: (id: string, path: string) => invoke<void>('models_add_file', { id, path }),
  remove: (id: string) => invoke<void>('models_remove', { id }),
  setMain: (id: string) => invoke<void>('models_set_main', { id }),
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
  open: (caseId: string) => invoke<CaseDoc>('library_open', { caseId }),
  save: (edit: CaseEdit) => invoke<Saved>('library_save', { edit }),
  /** Batch tracing: writes only if the case is still untraced (a case opened meanwhile is never overwritten). */
  saveAiIfUntraced: (edit: CaseEdit) => invoke<boolean>('library_save_ai_if_untraced', { edit }),
  recordAi: (caseId: string, run: AiRun, points: AiPoint[]) => invoke<void>('library_record_ai', { caseId, run, points }),
  /** Each model's latest points on this film. */
  ghosts: (caseId: string) => invoke<ModelPoints[]>('library_ghosts', { caseId }),
  setMeta: (caseId: string, meta: CaseMeta) => invoke<void>('library_set_meta', { caseId, meta }),
  /** Single-field saves (final-review fix round, Important 1): each writes only its own column, so a Gender save
   *  and a Referrer save landing out of order can never overwrite one another's value. */
  setPatientGender: (caseId: string, gender: Gender | null) => invoke<void>('library_set_patient_gender', { caseId, gender }),
  setPatientReferrer: (caseId: string, referringPractitioner: string | null) =>
    invoke<void>('library_set_patient_referrer', { caseId, referringPractitioner }),
  /** Format 11 (spec 2026-10-17): single-field saves, like Gender and Referrer. */
  setPatientId: (caseId: string, patientId: string | null) => invoke<void>('library_set_patient_id', { caseId, patientId }),
  setFilmDetail: (caseId: string, field: FilmDetailField, value: string | null) => invoke<void>('library_set_film_detail', { caseId, field, value }),
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
  confirmIdentity: (caseId: string, sameAs: PatientRef | null) => invoke<void>('library_confirm_identity', { caseId, sameAs }),
  /** OK on the film-date note: the clinician accepts the date as it is. */
  confirmFilmDate: (caseId: string) => invoke<void>('library_confirm_film_date', { caseId }),
  /** Serial superimposition (spec 2026-09-30): the open film and the same patient's other live films, unordered. */
  series: (caseId: string) => invoke<SeriesFilm[]>('library_series', { caseId }),
  setStage: (caseId: string, stage: Stage | null) => invoke<void>('library_set_stage', { caseId, stage }),
  setInSeries: (caseId: string, on: boolean) => invoke<void>('library_set_in_series', { caseId, on }),
  setVerified: (caseId: string, verified: boolean) => invoke<void>('library_set_verified', { caseId, verified }),
  calibrate: (caseId: string, p1: Vec2, p2: Vec2, mm: number) =>
    invoke<number>('library_calibrate', { caseId, p1: [p1.x, p1.y], p2: [p2.x, p2.y], mm }),
  remove: (caseId: string) => invoke<void>('library_delete', { caseId }),
  restore: (caseId: string) => invoke<void>('library_restore', { caseId }),
  backup: (dest: string) => invoke<string>('library_backup', { dest }),
  restoreBackup: (dir: string) => invoke<void>('library_restore_backup', { dir }),
  /** The safety copy's folder if opening the library upgraded its format (once; then null). */
  upgradeCopy: () => invoke<string | null>('library_upgrade_copy'),
  /** The case's chosen reference population (Part C, N6); null clears it back to the clinic default. */
  setCasePopulation: (caseId: string, population: string | null) => invoke<void>('library_set_case_population', { caseId, population }),
  /** The clinician's own norms (never in git; always labelled "user norm"). */
  userNorms: () => invoke<UserNorm[]>('library_user_norms'),
  saveUserNorm: (n: UserNorm) => invoke<void>('library_save_user_norm', { norm: n }),
  deleteUserNorm: (setName: string, measurement: string) => invoke<void>('library_delete_user_norm', { setName, measurement }),
};
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
};
/** Plain text files the clinician chose in a save or open dialog (owner B4: an analysis shared as a file). */
export const files = {
  writeText: (path: string, text: string) => invoke<void>('text_file_write', { path, text }),
  readText: (path: string) => invoke<string>('text_file_read', { path }),
};
