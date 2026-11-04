import type { Vec2 } from '@ceph/geometry';
import { LANDMARKS } from '@ceph/analyses';
import { levelRotation, NO_ORIENTATION, type Orientation } from '../canvas/orientation';

export type Source = 'ai' | 'ai-adjusted' | 'manual';
export interface TracingPoint { x: number; y: number; source: Source; verified: boolean; ai?: Vec2; confidence?: number }
export type PlaneKey = 'sn' | 'fh' | 'pp' | 'mp' | 'na' | 'nb' | 'fp';
export interface Overlays { planes: Record<PlaneKey, boolean>; profilogram: boolean; background: 'radiograph' | 'grid' }
/** Display-only film adjustments: never sent to the model, never change a coordinate or a value. */
export interface Display { brightness: number; contrast: number; invert: boolean; sharpness: number }
export const DISPLAY_DEFAULT: Display = { brightness: 1, contrast: 1, invert: false, sharpness: 0 };
interface Snapshot { points: Record<string, TracingPoint>; orientation: Orientation }
export interface TracingState {
  points: Record<string, TracingPoint>; active: string | null; orientation: Orientation; overlays: Overlays; display: Display;
  past: Snapshot[]; future: Snapshot[]; dragging: string | null; rotating: boolean; lastPlanes: Record<PlaneKey, boolean> | null;
  /** A drag's (or rotate drag's) undo snapshot is taken on its first move, so a click that moves nothing is not an undo step. */
  dragCommitted: boolean;
}
type Detected = { id: string; x: number; y: number; confidence?: number };
export type Action =
  | { type: 'load'; landmarks: Detected[] }
  | { type: 'hydrate'; points: Record<string, TracingPoint>; orientation: Orientation; display: Display }
  | { type: 'redetect'; landmarks: Detected[]; overwrite: boolean }
  | { type: 'autoOrient'; mirror: boolean }
  | { type: 'reset' }
  | { type: 'select'; id: string } | { type: 'cancel' }
  | { type: 'place'; id: string; pos: Vec2 } | { type: 'remove' }
  | { type: 'beginDrag'; id: string } | { type: 'dragTo'; pos: Vec2 } | { type: 'endDrag' }
  | { type: 'beginRotate' } | { type: 'rotateTo'; deg: number } | { type: 'endRotate' }
  | { type: 'nudge'; delta: Vec2 } | { type: 'accept' }
  | { type: 'orient'; op: 'level' | 'flip' | 'restore' } | { type: 'orient'; op: 'rotate'; deg: number }
  | { type: 'undo' } | { type: 'redo' }
  | { type: 'togglePlane'; key: PlaneKey } | { type: 'toggleAllPlanes' } | { type: 'toggleProfilogram' }
  | { type: 'setBackground'; background: 'radiograph' | 'grid' }
  | { type: 'setOverlays'; overlays: Overlays }
  | { type: 'setDisplay'; display: Partial<Display> };

const PLANES_DEFAULT: Record<PlaneKey, boolean> = { sn: true, fh: true, pp: false, mp: true, na: true, nb: true, fp: false };
export const initialTracing: TracingState = {
  points: {}, active: null, orientation: NO_ORIENTATION, past: [], future: [], dragging: null, rotating: false, lastPlanes: null, dragCommitted: false,
  overlays: { planes: PLANES_DEFAULT, profilogram: false, background: 'radiograph' }, display: DISPLAY_DEFAULT,
};

const snap = (s: TracingState): Snapshot => ({ points: s.points, orientation: s.orientation });
const commit = (s: TracingState): TracingState => ({ ...s, past: [...s.past, snap(s)], future: [] });
const moved = (p: TracingPoint, pos: Vec2): TracingPoint =>
  ({ ...p, x: pos.x, y: pos.y, verified: true, source: p.source === 'manual' ? 'manual' : 'ai-adjusted' });
const aiPoint = (l: Detected): TracingPoint =>
  ({ x: l.x, y: l.y, source: 'ai', verified: false, ai: { x: l.x, y: l.y }, ...(l.confidence !== undefined ? { confidence: l.confidence } : {}) });
const isLandmark = (id: string) => Object.prototype.hasOwnProperty.call(LANDMARKS, id);
/** A different case: nothing from the old one survives except the user's overlay choices. */
const fresh = (s: TracingState): TracingState => ({ ...initialTracing, overlays: s.overlays, lastPlanes: s.lastPlanes });
const relevel = (s: TracingState): TracingState => {
  const Po = s.points.Po, Or = s.points.Or;
  return s.orientation.source === 'auto-FH' && Po && Or
    ? { ...s, orientation: { ...s.orientation, rotDeg: levelRotation(Po, Or, s.orientation.mirror) } } : s;
};
const touchesFH = (id: string) => id === 'Po' || id === 'Or';

/** Whether Re-detect replaces this point: always when overwriting, else only a new point or an untouched AI one. */
export const replacedOnRedetect = (old: TracingPoint | undefined, overwrite: boolean): boolean =>
  overwrite || !old || (old.source === 'ai' && !old.verified);

export function tracingReducer(s: TracingState, a: Action): TracingState {
  switch (a.type) {
    case 'load': {
      const points = Object.fromEntries(a.landmarks.map((l) => [l.id, aiPoint(l)]));
      return { ...fresh(s), points, active: a.landmarks[0]?.id ?? null };
    }
    case 'hydrate': {
      const ids = Object.keys(a.points), active = ids.find((id) => !a.points[id].verified) ?? ids[0] ?? null;
      return { ...fresh(s), points: a.points, orientation: a.orientation, display: a.display, active };
    }
    case 'redetect': {                                    // Re-detect keeps what the clinician touched unless told otherwise
      const points = { ...s.points };
      for (const l of a.landmarks) {
        const old = points[l.id];
        if (replacedOnRedetect(old, a.overwrite)) points[l.id] = aiPoint(l);
      }
      return relevel({ ...commit(s), points });
    }
    case 'autoOrient': {                                  // decision 14: face right on upload, FH level once Po and Or exist
      const Po = s.points.Po, Or = s.points.Or;
      return { ...s, orientation: Po && Or ? { mirror: a.mirror, rotDeg: levelRotation(Po, Or, a.mirror), source: 'auto-FH' } : { mirror: a.mirror, rotDeg: 0, source: 'none' } };
    }
    case 'reset': return fresh(s);
    case 'select': return s.points[a.id] || isLandmark(a.id) ? { ...s, active: a.id } : s;
    case 'cancel': return s.active && !s.points[s.active] ? { ...s, active: null } : s;
    case 'place': {
      const old = s.points[a.id]; if (!old && !isLandmark(a.id)) return s;
      const p: TracingPoint = old ? moved(old, a.pos) : { x: a.pos.x, y: a.pos.y, source: 'manual', verified: true };
      const next = { ...commit(s), active: a.id, points: { ...s.points, [a.id]: p } };
      return touchesFH(a.id) ? relevel(next) : next;
    }
    case 'remove': {
      if (!s.active || !s.points[s.active]) return s;
      const points = { ...s.points }; delete points[s.active];
      return { ...commit(s), points };
    }
    case 'beginDrag': return s.points[a.id] ? { ...s, dragging: a.id, active: a.id, dragCommitted: false } : s;
    case 'dragTo': {
      if (!s.dragging) return s;
      const base = s.dragCommitted ? s : { ...commit(s), dragCommitted: true };
      return { ...base, points: { ...base.points, [s.dragging]: moved(base.points[s.dragging], a.pos) } };
    }
    case 'endDrag': {
      if (!s.dragging) return s;
      const id = s.dragging, done = { ...s, dragging: null };
      return touchesFH(id) ? relevel(done) : done;                               // never mid-drag, always on release
    }
    case 'beginRotate': return { ...s, rotating: true, dragCommitted: false };
    case 'rotateTo': {
      if (!s.rotating) return s;
      const base = s.dragCommitted ? s : { ...commit(s), dragCommitted: true };
      return { ...base, orientation: { ...base.orientation, rotDeg: Math.round(a.deg * 1000) / 1000, source: 'manual' } };
    }
    case 'endRotate': return { ...s, rotating: false };
    case 'nudge': {
      const p = s.active ? s.points[s.active] : null; if (!p) return s;
      const next = { ...commit(s), points: { ...s.points, [s.active!]: moved(p, { x: p.x + a.delta.x, y: p.y + a.delta.y }) } };
      return touchesFH(s.active!) ? relevel(next) : next;
    }
    case 'accept': {
      const p = s.active ? s.points[s.active] : null; if (!p || p.verified) return s;
      return { ...commit(s), points: { ...s.points, [s.active!]: { ...p, verified: true } } };
    }
    case 'orient': {
      const o = s.orientation, c = commit(s);
      if (a.op === 'level') {
        const Po = s.points.Po, Or = s.points.Or; if (!Po || !Or) return s;
        return { ...c, orientation: { ...o, rotDeg: levelRotation(Po, Or, o.mirror), source: 'auto-FH' } };
      }
      if (a.op === 'rotate') return { ...c, orientation: { ...o, rotDeg: Math.round((o.rotDeg + a.deg) * 1000) / 1000, source: 'manual' } };
      if (a.op === 'restore') return { ...c, orientation: { mirror: false, rotDeg: 0, source: 'restored' } };
      const flipped = { ...o, mirror: !o.mirror, rotDeg: -o.rotDeg };                      // flip
      return relevel({ ...c, orientation: flipped });
    }
    case 'undo': {
      const prev = s.past[s.past.length - 1]; if (!prev) return s;
      return { ...s, ...prev, past: s.past.slice(0, -1), future: [snap(s), ...s.future], dragging: null, rotating: false };
    }
    case 'redo': {
      const next = s.future[0]; if (!next) return s;
      return { ...s, ...next, past: [...s.past, snap(s)], future: s.future.slice(1) };
    }
    case 'togglePlane': return { ...s, overlays: { ...s.overlays, planes: { ...s.overlays.planes, [a.key]: !s.overlays.planes[a.key] } } };
    case 'toggleAllPlanes': {
      const on = s.overlays.planes, any = Object.values(on).some(Boolean);
      const off = Object.fromEntries(Object.keys(on).map((k) => [k, false])) as Record<PlaneKey, boolean>;
      return any ? { ...s, lastPlanes: on, overlays: { ...s.overlays, planes: off } }
        : { ...s, overlays: { ...s.overlays, planes: s.lastPlanes ?? PLANES_DEFAULT } };
    }
    case 'toggleProfilogram': return { ...s, overlays: { ...s.overlays, profilogram: !s.overlays.profilogram } };
    case 'setBackground': return { ...s, overlays: { ...s.overlays, background: a.background } };
    case 'setOverlays': return { ...s, overlays: a.overlays };
    case 'setDisplay': return { ...s, display: { ...s.display, ...a.display } };
  }
}
export const verifiedSet = (s: TracingState) => new Set(Object.entries(s.points).filter(([, p]) => p.verified).map(([id]) => id));
export const positions = (s: TracingState): Record<string, Vec2> =>
  Object.fromEntries(Object.entries(s.points).map(([id, p]) => [id, { x: p.x, y: p.y }]));
/** The Superimposition page (decision 19): the profilogram on the true-mm grid, without changing the saved toggles. */
export const superimpositionView = (s: TracingState): TracingState => ({ ...s, overlays: { ...s.overlays, profilogram: true, background: 'grid' } });
