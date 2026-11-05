import type { AiPoint, AiRun, CaseDoc, CaseEdit, Detection, DetectResult, Facing, LandmarkRow } from '../ipc';
import { NO_ORIENTATION } from '../canvas/orientation';
import { DISPLAY_DEFAULT, initialTracing, tracingReducer, type Action, type Overlays, type PlaneKey, type TracingPoint, type TracingState } from '../tracing/state';

/** `placedBy`: the model that placed this AI point (schema 10); `placedVia`: 'auto-best' when Automatic best chose it
 *  (format 15). A hand-placed point has neither; `placedVia` only travels with a `placedBy`. */
export const toRow = (id: string, p: TracingPoint, placedBy?: string, placedVia?: string): LandmarkRow => ({
  id, x: p.x, y: p.y, source: p.source, verified: p.verified, aiX: p.ai?.x ?? null, aiY: p.ai?.y ?? null, confidence: p.confidence ?? null,
  placedBy: p.source === 'manual' ? null : placedBy ?? null,
  placedVia: p.source === 'manual' || !placedBy ? null : placedVia ?? null,
  acceptKind: p.verified ? p.acceptKind ?? null : null,
});
export const fromRow = (r: LandmarkRow): TracingPoint => ({
  x: r.x, y: r.y, source: r.source, verified: r.verified,
  ...(r.aiX !== null && r.aiY !== null ? { ai: { x: r.aiX, y: r.aiY } } : {}),
  ...(r.confidence !== null ? { confidence: r.confidence } : {}),
  ...(r.acceptKind ? { acceptKind: r.acceptKind } : {}),
});

/** What autosave writes: the points, the view orientation and the display adjustments (never overlays: those are per user). */
export const toEdit = (caseId: string, facing: Facing, s: TracingState, placedBy: Record<string, string> = {}, placedVia: Record<string, string> = {}): CaseEdit => ({
  id: caseId, facing, orientation: s.orientation, display: s.display,
  landmarks: Object.entries(s.points).map(([id, p]) => toRow(id, p, placedBy[id], placedVia[id])),
});
/** Every point of a placement Automatic best made carries 'auto-best' (spec §9); any other placement marks none. */
export const viaOf = (p: { source: Record<string, string>; via: string | null }): Record<string, string> =>
  (p.via ? Object.fromEntries(Object.keys(p.source).map((id) => [id, p.via as string])) : {});

/** Opens a stored case; fields an older build did not write fall back to their defaults. */
export const hydrateAction = (doc: CaseDoc): Extract<Action, { type: 'hydrate' }> => ({
  type: 'hydrate',
  points: Object.fromEntries(doc.landmarks.map((row) => [row.id, fromRow(row)])),
  orientation: { ...NO_ORIENTATION, ...doc.orientation },
  display: { ...DISPLAY_DEFAULT, ...doc.display },
});

/** The first save of a newly detected case: every point AI and unverified, mirrored to face right and levelled. */
export function aiEdit(caseId: string, r: DetectResult, placedBy: Record<string, string> = {}, placedVia: Record<string, string> = {}): CaseEdit {
  const s = tracingReducer(tracingReducer(initialTracing, { type: 'load', landmarks: r.landmarks }), { type: 'autoOrient', mirror: r.facingLeft });
  return toEdit(caseId, r.facingLeft ? 'left' : 'right', s, placedBy, placedVia);
}
/** Every channel's point from a detection, as stored (schema 7's model_points). */
export const pointsOf = (d: Detection): AiPoint[] =>
  (d.raw ?? []).map((p) => ({ channel: p.channel, landmarkId: p.landmarkId, x: p.x, y: p.y, peak: p.peak }));
export const aiRunOf = (r: DetectResult): AiRun =>
  ({ modelId: r.modelId, executionProvider: r.executionProvider, facing: r.facingLeft ? 'left' : 'right', totalMs: r.timingsMs.total, modelSha256: r.modelSha256 ?? null });

/** Overlay choices kept in settings across restarts; anything unreadable falls back to the defaults. */
export function parseOverlays(json: string | null): Overlays | null {
  if (!json) return null;
  let v: Partial<Overlays>;
  try { v = JSON.parse(json) as Partial<Overlays>; } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const d = initialTracing.overlays, planes = { ...d.planes };
  for (const k of Object.keys(planes) as PlaneKey[]) { const on = v.planes?.[k]; if (typeof on === 'boolean') planes[k] = on; }
  return { planes, profilogram: typeof v.profilogram === 'boolean' ? v.profilogram : d.profilogram, background: v.background === 'grid' ? 'grid' : 'radiograph' };
}

/**
 * The reducer action for a detection result. Even the first detection merges (never `load`): points placed, moved or
 * accepted while it ran, and the display settings, survive, and the whole detection is one undo step (review #4).
 */
export const detectionAction = (mode: 'first' | 'keep' | 'overwrite', landmarks: { id: string; x: number; y: number; confidence?: number }[]): Action =>
  ({ type: 'redetect', landmarks, overwrite: mode === 'overwrite' });

/** The patient details of a freshly loaded case, to refresh the open case after an edit or a confirmation. */
export const identityFields = (d: CaseDoc) => ({
  patientName: d.patientName, patientKey: d.patientKey, timepoint: d.timepoint, takenOn: d.takenOn, dateOfBirth: d.dateOfBirth,
  scanId: d.scanId, identitySource: d.identitySource, identityChecked: d.identityChecked, identityIssues: d.identityIssues, takenOnSource: d.takenOnSource,
  learnedFields: d.learnedFields, gender: d.gender, referringPractitioner: d.referringPractitioner,
  printedPatientId: d.printedPatientId, xrayType: d.xrayType, xraySize: d.xraySize, radiographyPractice: d.radiographyPractice,
  libraryId: d.libraryId, patientIdsSeen: d.patientIdsSeen, idMatches: d.idMatches, libraryTrail: d.libraryTrail,
  title: d.title, ageOnFilm: d.ageOnFilm, ageOnFilmYears: d.ageOnFilmYears,
  background: d.background ?? null,   // spec 2026-10-29 §4.1: on the patient, so a join or a save elsewhere changes it
});
