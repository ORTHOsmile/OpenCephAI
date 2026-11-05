import type { Vec2 } from '@ceph/geometry';
import { LANDMARKS } from '@ceph/analyses';
import { levelRotation, NO_ORIENTATION, type Orientation } from '../canvas/orientation';
import type { RulerMarks } from '../ipc';

export type Source = 'ai' | 'ai-adjusted' | 'manual';
/** Chain spec answer 7 (format 14): how a point's final position was reached. */
export type AcceptKind = 'single' | 'bulk' | 'double-click' | 'drag' | 'hand';
export interface TracingPoint { x: number; y: number; source: Source; verified: boolean; ai?: Vec2; confidence?: number; acceptKind?: AcceptKind }
export type PlaneKey = 'sn' | 'fh' | 'pp' | 'mp' | 'na' | 'nb' | 'fp';
export interface Overlays { planes: Record<PlaneKey, boolean>; profilogram: boolean; background: 'radiograph' | 'grid' }
/** Display-only film adjustments: never sent to the model, never change a coordinate or a value. */
export interface Display { brightness: number; contrast: number; invert: boolean; sharpness: number }
export const DISPLAY_DEFAULT: Display = { brightness: 1, contrast: 1, invert: false, sharpness: 0 };
interface Snapshot { points: Record<string, TracingPoint>; orientation: Orientation; ruler: RulerMarks | null }
export interface TracingState {
  points: Record<string, TracingPoint>; active: string | null; orientation: Orientation; overlays: Overlays; display: Display;
  past: Snapshot[]; future: Snapshot[]; dragging: string | null; rotating: boolean; lastPlanes: Record<PlaneKey, boolean> | null;
  /** A drag's (or rotate drag's) undo snapshot is taken on its first move, so a click that moves nothing is not an undo step. */
  dragCommitted: boolean;
  /** Spec 2026-10-19 (V6): the ⌘-picked points, for "Accept Positions (n)". Never an undo step, never saved. */
  picked: string[];
  /** Stage A (task 7): the points with an unresolved point-check flag shown on the film. Both bulk accepts ("Accept
   *  Positions", "Accept remaining") leave them out; a single Accept, a double-click, a drag or a hand placement does
   *  not. Set by App from the stored check; never an undo step, never saved. */
  flagged: string[];
  /** The film's point check has not been read yet (App sets it on a film's first read; a failed read also settles it). Both
   *  bulk accepts wait, so a point the check is about to flag is never taken in the gap. Never an undo step, never saved. */
  checkPending: boolean;
  /** Spec 2026-10-19 (V2): how many point actions have left every point accepted. The open case signs itself off on
   *  each increase (useCase). Kept through a case switch, so a reset never looks like a new request. */
  signOffAsk: number;
  /** Spec 2026-10-19 (F): the ruler marks behind the film's scale (drawn and draggable after calibrating). In the
   *  undo snapshots, so ⌘Z restores a dropped mark. */
  ruler: RulerMarks | null;
}
type Detected = { id: string; x: number; y: number; confidence?: number };
export type Action =
  | { type: 'load'; landmarks: Detected[] }
  | { type: 'hydrate'; points: Record<string, TracingPoint>; orientation: Orientation; display: Display }
  | { type: 'redetect'; landmarks: Detected[]; overwrite: boolean }
  | { type: 'arrive'; landmarks: Detected[]; level: boolean }
  | { type: 'autoOrient'; mirror: boolean }
  | { type: 'reset' }
  | { type: 'select'; id: string } | { type: 'cancel' }
  | { type: 'place'; id: string; pos: Vec2 } | { type: 'remove' }
  | { type: 'beginDrag'; id: string } | { type: 'dragTo'; pos: Vec2 } | { type: 'endDrag' }
  | { type: 'beginRotate' } | { type: 'rotateTo'; deg: number } | { type: 'endRotate' }
  | { type: 'nudge'; delta: Vec2 } | { type: 'accept' }
  | { type: 'togglePick'; id: string } | { type: 'unpick' }
  | { type: 'setFlagged'; ids: string[]; pending?: boolean }
  | { type: 'acceptMany'; ids: string[]; kind?: 'bulk' | 'double-click' } | { type: 'acceptRemaining' }
  | { type: 'orient'; op: 'level' | 'flip' | 'restore' } | { type: 'orient'; op: 'rotate'; deg: number }
  | { type: 'undo' } | { type: 'redo' }
  | { type: 'togglePlane'; key: PlaneKey } | { type: 'toggleAllPlanes' } | { type: 'toggleProfilogram' }
  | { type: 'setBackground'; background: 'radiograph' | 'grid' }
  | { type: 'setOverlays'; overlays: Overlays }
  | { type: 'setDisplay'; display: Partial<Display> }
  | { type: 'setRuler'; ruler: RulerMarks | null } | { type: 'moveRuler'; ruler: RulerMarks };

const PLANES_DEFAULT: Record<PlaneKey, boolean> = { sn: true, fh: true, pp: false, mp: true, na: true, nb: true, fp: false };
export const initialTracing: TracingState = {
  points: {}, active: null, orientation: NO_ORIENTATION, past: [], future: [], dragging: null, rotating: false, lastPlanes: null, dragCommitted: false,
  overlays: { planes: PLANES_DEFAULT, profilogram: false, background: 'radiograph' }, display: DISPLAY_DEFAULT,
  picked: [], flagged: [], checkPending: false, signOffAsk: 0, ruler: null,
};

const snap = (s: TracingState): Snapshot => ({ points: s.points, orientation: s.orientation, ruler: s.ruler });
const commit = (s: TracingState): TracingState => ({ ...s, past: [...s.past, snap(s)], future: [] });
const moved = (p: TracingPoint, pos: Vec2): TracingPoint =>
  ({ ...p, x: pos.x, y: pos.y, verified: true, source: p.source === 'manual' ? 'manual' : 'ai-adjusted', acceptKind: p.source === 'manual' ? 'hand' : 'drag' });
/** A hand-placed point stays `hand` and a moved one `drag` however it is then accepted; an AI point left where it was
 *  takes the gesture that accepted it (answer 7). */
const acceptedAs = (p: TracingPoint, k: 'single' | 'bulk' | 'double-click'): AcceptKind => (p.source === 'manual' ? 'hand' : p.source === 'ai-adjusted' ? 'drag' : k);
const aiPoint = (l: Detected): TracingPoint =>
  ({ x: l.x, y: l.y, source: 'ai', verified: false, ai: { x: l.x, y: l.y }, ...(l.confidence !== undefined ? { confidence: l.confidence } : {}) });
const isLandmark = (id: string) => Object.prototype.hasOwnProperty.call(LANDMARKS, id);
/** A different case: nothing from the old one survives except the user's overlay choices. */
const fresh = (s: TracingState): TracingState => ({ ...initialTracing, overlays: s.overlays, lastPlanes: s.lastPlanes, signOffAsk: s.signOffAsk });
const relevel = (s: TracingState): TracingState => {
  const Po = s.points.Po, Or = s.points.Or;
  return s.orientation.source === 'auto-FH' && Po && Or
    ? { ...s, orientation: { ...s.orientation, rotDeg: levelRotation(Po, Or, s.orientation.mirror) } } : s;
};
const touchesFH = (id: string) => id === 'Po' || id === 'Or';

/** Whether Re-detect replaces this point: always when overwriting, else only a new point or an untouched AI one. */
export const replacedOnRedetect = (old: TracingPoint | undefined, overwrite: boolean): boolean =>
  overwrite || !old || (old.source === 'ai' && !old.verified);

function step(s: TracingState, a: Action): TracingState {
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
    case 'arrive': {                                      // owner D2: a late point is part of the placement, not an action
      // No undo step of its own: it is folded into the film now AND into every undo/redo snapshot, wherever that point
      // is free there (absent, or an AI point nobody touched), so ⌘Z undoes your own actions and never takes it away.
      // `level`: a new film never levelled (no Po/Or at first) is levelled on Frankfort once both are here.
      const fold = <T extends { points: Record<string, TracingPoint>; orientation: Orientation }>(x: T): T => {
        const points = { ...x.points };
        for (const l of a.landmarks) if (replacedOnRedetect(points[l.id], false)) points[l.id] = aiPoint(l);
        const o = x.orientation, Po = points.Po, Or = points.Or;
        const orientation = Po && Or && (o.source === 'auto-FH' || (a.level && o.source === 'none'))
          ? { ...o, rotDeg: levelRotation(Po, Or, o.mirror), source: 'auto-FH' as const } : o;
        return { ...x, points, orientation };
      };
      return { ...fold(s), past: s.past.map(fold), future: s.future.map(fold) };
    }
    case 'autoOrient': {                                  // decision 14: face right on upload, FH level once Po and Or exist
      const Po = s.points.Po, Or = s.points.Or;
      return { ...s, orientation: Po && Or ? { mirror: a.mirror, rotDeg: levelRotation(Po, Or, a.mirror), source: 'auto-FH' } : { mirror: a.mirror, rotDeg: 0, source: 'none' } };
    }
    case 'reset': return fresh(s);
    case 'select': return s.points[a.id] || isLandmark(a.id) ? { ...s, active: a.id, picked: [] } : s;
    case 'cancel': {
      const c = s.picked.length ? { ...s, picked: [] } : s;
      return c.active && !c.points[c.active] ? { ...c, active: null } : c;
    }
    case 'place': {
      const old = s.points[a.id]; if (!old && !isLandmark(a.id)) return s;
      const p: TracingPoint = old ? moved(old, a.pos) : { x: a.pos.x, y: a.pos.y, source: 'manual', verified: true, acceptKind: 'hand' };
      const next = { ...commit(s), active: a.id, points: { ...s.points, [a.id]: p } };
      return touchesFH(a.id) ? relevel(next) : next;
    }
    case 'remove': {
      if (!s.active || !s.points[s.active]) return s;
      const points = { ...s.points }; delete points[s.active];
      return { ...commit(s), points };
    }
    case 'beginDrag': return s.points[a.id] ? { ...s, dragging: a.id, active: a.id, dragCommitted: false, picked: [] } : s;
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
      return { ...commit(s), points: { ...s.points, [s.active!]: { ...p, verified: true, acceptKind: acceptedAs(p, 'single') } } };
    }
    case 'togglePick': {
      if (!s.points[a.id]) return s;
      return s.picked.includes(a.id) ? { ...s, picked: s.picked.filter((x) => x !== a.id) } : { ...s, picked: [...s.picked, a.id], active: a.id };
    }
    case 'unpick': return s.picked.length ? { ...s, picked: [] } : s;
    case 'setFlagged': {
      const pending = a.pending ?? false;
      return pending === s.checkPending && a.ids.length === s.flagged.length && a.ids.every((id, i) => id === s.flagged[i]) ? s : { ...s, flagged: a.ids, checkPending: pending };
    }
    case 'acceptMany': {
      if (s.checkPending && a.kind !== 'double-click') return s;   // a bulk accept waits for the check to be read
      // A bulk accept (no kind) leaves flagged points out; a double-click is one point looked at on its own.
      const ids = a.ids.filter((id) => s.points[id] && !s.points[id].verified && (a.kind === 'double-click' || !s.flagged.includes(id)));
      if (!ids.length) return s;
      // Where it is: only `verified` (and the kind) changes, so Part F reads "accepted without moving".
      const points = { ...s.points };
      for (const id of ids) points[id] = { ...points[id], verified: true, acceptKind: acceptedAs(points[id], a.kind ?? 'bulk') };
      return { ...commit(s), points, picked: [] };
    }
    case 'acceptRemaining': return step(s, { type: 'acceptMany', ids: Object.keys(s.points) });
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
    case 'setRuler': {                                    // a new baseline (open, the dialog): ⌘Z never goes back past it
      const re = (x: Snapshot): Snapshot => ({ ...x, ruler: a.ruler });
      return { ...s, ruler: a.ruler, past: s.past.map(re), future: s.future.map(re) };
    }
    case 'moveRuler': return { ...commit(s), ruler: a.ruler };   // a dropped mark, already calibrated: one undo step
  }
}
/** One or more points, every one accepted. */
export const allAccepted = (points: Record<string, TracingPoint>): boolean => {
  const v = Object.values(points);
  return v.length > 0 && v.every((p) => p.verified);
};
/** The points not yet accepted, in the order they are listed. */
export const remaining = (s: TracingState): string[] => Object.keys(s.points).filter((k) => !s.points[k].verified);
/** Same marks and same distance (exact: these are the values sent to and read back from the library). */
export const sameRuler = (a: RulerMarks | null, b: RulerMarks | null): boolean =>
  a === b || (!!a && !!b && a.mm === b.mm && a.steps === b.steps && a.p1.x === b.p1.x && a.p1.y === b.p1.y && a.p2.x === b.p2.x && a.p2.y === b.p2.y);
/** Spec 2026-10-19 (V2): the actions a clinician takes on points. Only these ask for a sign-off, and a drag only on release. */
const POINT_ACTIONS: ReadonlySet<Action['type']> = new Set<Action['type']>(['place', 'endDrag', 'nudge', 'accept', 'acceptMany', 'acceptRemaining', 'remove', 'undo', 'redo']);

export function tracingReducer(s: TracingState, a: Action): TracingState {
  const n = step(s, a);
  const touched = a.type === 'endDrag' ? !!s.dragging && s.dragCommitted : n.points !== s.points;
  const kept = n.points === s.points ? n : { ...n, picked: n.picked.filter((id) => n.points[id]) };
  return touched && POINT_ACTIONS.has(a.type) && allAccepted(kept.points) ? { ...kept, signOffAsk: s.signOffAsk + 1 } : kept;
}
export const verifiedSet = (s: TracingState) => new Set(Object.entries(s.points).filter(([, p]) => p.verified).map(([id]) => id));
export const positions = (s: TracingState): Record<string, Vec2> =>
  Object.fromEntries(Object.entries(s.points).map(([id, p]) => [id, { x: p.x, y: p.y }]));
/** The Superimposition page (decision 19): the profilogram on the true-mm grid, without changing the saved toggles. */
export const superimpositionView = (s: TracingState): TracingState => ({ ...s, overlays: { ...s.overlays, profilogram: true, background: 'grid' } });
