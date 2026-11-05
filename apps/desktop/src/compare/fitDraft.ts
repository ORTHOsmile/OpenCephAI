import type { Vec2 } from '@ceph/geometry';
import type { FitRefKind, FitSave, MachineScale, SeriesFilm } from '../ipc';
import { baseScale } from '../tracing/spacing';
import { orderSeries } from './series';
import { MIN_PAIR_PX, SCALE_MAX, SCALE_MIN, SIZE_STEP, apply, invert, poseOf, simOf, startPose, wrap, type Pose } from './fit';

/** Request G panel (spec step 2): what the operator is adjusting, before it is saved. */
export type Show = 'both' | 'ref' | 'film';
export interface DraftFilm { id: string; label: string; points: Record<string, Vec2>; facing: string; spacingMm: number | null; dims: { W: number; H: number };
  /** MS-4: a machine's calibrated scale, when it applies and the film has no ruler, locks its size the same way. */
  machineScale?: MachineScale | null }
export interface Draft {
  film: string; ref: string; filmLabel: string; refLabel: string; kind: FitRefKind; mirror: boolean;
  /** Owner G2: a ruler-calibrated film's true size (its mm/px ÷ the reference's); its size cannot be changed. */
  locked: number | null;
  /** S and N on both films today, when both have them. */
  sn: { ref: [Vec2, Vec2]; film: [Vec2, Vec2] } | null;
  /** The pair the current placement starts from (S–N, picked points, or a saved fit's own points). */
  anchor: { ref: [Vec2, Vec2]; film: [Vec2, Vec2] } | null;
  /** Two points you pick: [reference 1, reference 2] in reference px, then [film 1, film 2] in film px. */
  picks: Vec2[];
  pose: Pose; start: Pose | null;
  /** Whether the film has a saved fit (to any reference): "Remove fit" is shown only then (owner D-f). */
  saved: boolean;
  /** Owner D-f (18 Oct): the saved fit Reset goes back to — the film's saved fit when it is to THIS reference, else null
   *  (Reset then goes back to the S–N start). */
  last: FitSave | null;
  /** Where a draft with nothing saved starts: the S–N start, else the film drawn centre on centre. */
  blank: Pose;
  show: Show; message: string | null;
}
export type DraftAction =
  | { type: 'kind'; kind: FitRefKind } | { type: 'pick'; at: Vec2 } | { type: 'move'; d: Vec2 } | { type: 'turn'; rad: number }
  | { type: 'size'; k: number } | { type: 'step'; n: number } | { type: 'show'; show: Show } | { type: 'restart' }
  /** The film's saved fit changed outside the draft: removed (null) or put back (⌘Z). The draft goes back to it. */
  | { type: 'saved'; fit: FitSave | null };

const v2 = ([x, y]: [number, number]): Vec2 => ({ x, y });
const centre = (d: { W: number; H: number }): Vec2 => ({ x: (d.W - 1) / 2, y: (d.H - 1) / 2 });
const NO_SN = 'Place S and N on both films to start from S–N, or choose two points you pick.';

/** The draft placed where `s.last` was saved, or — nothing saved for this reference — at the S–N start (owner D-f). */
function home(s: Draft): Draft {
  const f = s.last;
  if (f) {
    const anchor = { ref: [v2(f.refPoints[0]), v2(f.refPoints[1])] as [Vec2, Vec2], film: [v2(f.filmPoints[0]), v2(f.filmPoints[1])] as [Vec2, Vec2] };
    return { ...s, kind: f.refKind, mirror: f.mirror, anchor, picks: f.refKind === 'points' ? [...anchor.ref, ...anchor.film] : [],
      pose: { ...poseOf(f), scale: s.locked ?? f.scale }, start: startPose(anchor.ref, anchor.film, f.mirror, s.locked), show: 'both', message: null };
  }
  const start = s.sn ? startPose(s.sn.ref, s.sn.film, s.blank.mirror, s.locked) : null;
  return { ...s, kind: 'sn', mirror: s.blank.mirror, anchor: start ? s.sn : null, picks: [], start, pose: s.blank, show: 'both', message: start ? null : NO_SN };
}

export function startDraft(ref: DraftFilm, film: DraftFilm, saved: FitSave | null): Draft {
  const own = baseScale(film), rs = baseScale(ref);
  const locked = own.source === 'calibration' || own.source === 'machine' ? own.mmPerPx / rs.mmPerPx : null;
  const sn = ref.points.S && ref.points.N && film.points.S && film.points.N
    ? { ref: [ref.points.S, ref.points.N] as [Vec2, Vec2], film: [film.points.S, film.points.N] as [Vec2, Vec2] } : null;
  const mirror = ref.facing !== film.facing, start = sn ? startPose(sn.ref, sn.film, mirror, locked) : null;
  const blank = start ?? { a: centre(ref.dims), b: centre(film.dims), mirror, scale: locked ?? 1, rotation: 0, dx: 0, dy: 0 };
  return home({ film: film.id, ref: ref.id, filmLabel: film.label, refLabel: ref.label, kind: 'sn', mirror, locked, sn, anchor: null, picks: [],
    pose: blank, start: null, saved: !!saved, last: saved && saved.refCaseId === ref.id ? saved : null, blank, show: 'both', message: null });
}

export function draftReducer(s: Draft, a: DraftAction): Draft {
  switch (a.type) {
    case 'kind': {
      if (a.kind === s.kind) return s;
      if (a.kind === 'points') return { ...s, kind: 'points', anchor: null, start: null, picks: [], show: 'ref', message: null };
      const start = s.sn ? startPose(s.sn.ref, s.sn.film, s.mirror, s.locked) : null;
      return { ...s, kind: 'sn', anchor: start ? s.sn : null, start, picks: [], pose: start ?? s.pose, show: 'both', message: start ? null : NO_SN };
    }
    case 'pick': {
      if (s.kind !== 'points' || s.picks.length >= 4) return s;
      // The first two clicks are on the reference; the next two on the film, read back through how it is drawn now.
      const back = s.picks.length < 2 ? null : invert(simOf(s.pose));
      const p = s.picks.length < 2 ? a.at : back ? apply(back, a.at) : null;
      if (!p) return s;
      const picks = [...s.picks, p];
      if (picks.length < 4) return { ...s, picks, show: picks.length === 2 ? 'film' : s.show, message: null };
      const anchor = { ref: [picks[0], picks[1]] as [Vec2, Vec2], film: [picks[2], picks[3]] as [Vec2, Vec2] };
      const start = startPose(anchor.ref, anchor.film, s.mirror, s.locked);
      return start ? { ...s, picks, anchor, start, pose: start, show: 'both', message: null }
        : { ...s, picks: [], anchor: null, start: null, show: 'ref', message: `Pick two points at least ${MIN_PAIR_PX} px apart on each film, then try again.` };
    }
    case 'move': return { ...s, pose: { ...s.pose, dx: s.pose.dx + a.d.x, dy: s.pose.dy + a.d.y } };
    case 'turn': return { ...s, pose: { ...s.pose, rotation: wrap(s.pose.rotation + a.rad) } };
    case 'size':
      if (s.locked !== null) return s;
      if (!(a.k >= SCALE_MIN && a.k <= SCALE_MAX)) return { ...s, message: `The size must be between ×${SCALE_MIN.toFixed(3)} and ×${SCALE_MAX.toFixed(3)}.` };
      return { ...s, pose: { ...s.pose, scale: a.k }, message: null };
    case 'step': return draftReducer(s, { type: 'size', k: Math.round((s.pose.scale + a.n * SIZE_STEP) * 1000) / 1000 });
    case 'show': return { ...s, show: a.show };
    // Owner D-f (18 Oct): Reset discards every unsaved change, back to the last saved fit (else the S–N start).
    case 'restart': return home(s);
    case 'saved': return home({ ...s, saved: !!a.fit, last: a.fit && a.fit.refCaseId === s.ref ? a.fit : null });
  }
}

export function pickStep(s: Draft): string | null {
  if (s.kind !== 'points' || s.picks.length >= 4) return null;
  return [`Click a stable point on ${s.refLabel} (for example the front wall of sella turcica).`, `Click a second stable point on ${s.refLabel}, well away from the first.`,
    `Click the same first point on ${s.filmLabel}.`, `Click the same second point on ${s.filmLabel}.`][s.picks.length];
}

/** What "Save fit" stores; null while there is nothing to anchor it on (no S–N, or points not all picked). */
export function toSave(s: Draft): FitSave | null {
  if (!s.anchor || !s.start) return null;
  const xy = (p: Vec2): [number, number] => [p.x, p.y];
  return { refCaseId: s.ref, refKind: s.kind, refPoints: [xy(s.anchor.ref[0]), xy(s.anchor.ref[1])], filmPoints: [xy(s.anchor.film[0]), xy(s.anchor.film[1])],
    mirror: s.pose.mirror, scale: s.pose.scale, rotation: s.pose.rotation, dx: s.pose.dx, dy: s.pose.dy };
}

/** The films `film` may be fitted to, oldest first: the patient's other films with no fit of their own (plan D-d). None
 *  when another film is fitted to `film`. */
export function references(films: SeriesFilm[], film: string): SeriesFilm[] {
  if (films.some((f) => (f.fitRef ?? null) === film)) return [];
  return orderSeries(films).filter((f) => f.id !== film && !(f.fitRef ?? null));
}
/** "Scale now" starts with the earliest film that has a ruler, else the earliest film. */
export const defaultReference = (films: SeriesFilm[], film: string): SeriesFilm | null => {
  const r = references(films, film); return r.find((f) => !!f.calibrated) ?? r[0] ?? null; };
/** Why a film cannot be fitted now, in plain words; null when it can. */
export function fitBlock(films: SeriesFilm[], film: string, unnamed: boolean): string | null {
  if (unnamed) return 'Name the patient first.';
  const by = films.find((f) => (f.fitRef ?? null) === film);
  if (by) return `${by.timepoint} is scaled to this film; remove that fit first.`;
  return references(films, film).length ? null : 'No other X-ray of this patient to scale it to.';
}
