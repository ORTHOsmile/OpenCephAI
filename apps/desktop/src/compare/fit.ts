import type { Vec2 } from '@ceph/geometry';
import type { FilmFit, FitSave, MachineScale } from '../ipc';
import { baseScale, scaleOf, type FitNote, type Scale } from '../tracing/spacing';
import type { Pts } from './align';

/** Request G (spec 2026-10-17; owner G1–G3, 17 Oct): one film placed on another film of the same patient. Every
 *  position is in a film's own image pixels (§2 pixel-centre convention); a fit maps the fitted film's pixels onto its
 *  reference film's pixels. Nothing here reads or writes a stored landmark or a ruler calibration. */
export const MIN_PAIR_PX = 20;               // the two reference points, at least this far apart on each film (input limit)
export const SCALE_MIN = 0.2;                // reference px per film px; outside SCALE_MIN–SCALE_MAX a fit is refused
export const SCALE_MAX = 5;
export const SIZE_STEP = 0.001;              // one press of − / + (⇧: ten)

/** x' = a·x + c·y + e, y' = b·x + d·y + f — the order of the canvas `transform(a, b, c, d, e, f)`. */
export interface Sim { a: number; b: number; c: number; d: number; e: number; f: number }
export const IDENTITY: Sim = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
export const apply = (s: Sim, p: Vec2): Vec2 => ({ x: s.a * p.x + s.c * p.y + s.e, y: s.b * p.x + s.d * p.y + s.f });
/** outer ∘ inner: `inner` first. */
export const compose = (o: Sim, i: Sim): Sim => ({
  a: o.a * i.a + o.c * i.b, b: o.b * i.a + o.d * i.b, c: o.a * i.c + o.c * i.d, d: o.b * i.c + o.d * i.d,
  e: o.a * i.e + o.c * i.f + o.e, f: o.b * i.e + o.d * i.f + o.f });
export function invert(s: Sim): Sim | null {
  const det = s.a * s.d - s.b * s.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = s.d / det, b = -s.b / det, c = -s.c / det, d = s.a / det;
  return { a, b, c, d, e: -(a * s.e + c * s.f), f: -(b * s.e + d * s.f) };
}

/** Where a fitted film sits: its first reference point `b` lands on the reference's first point `a`, moved by
 *  (dx, dy) reference px; it is turned by `rotation` radians and enlarged by `scale` about that landed point, after
 *  being mirrored when the two films face opposite ways. */
export interface Pose { a: Vec2; b: Vec2; mirror: boolean; scale: number; rotation: number; dx: number; dy: number }
/** Fix round 1, ruling 4: a closed form (no loop), so a non-finite or huge `t` can never hang. NaN for
 *  non-finite input (±Infinity, NaN itself); otherwise into (−π, π] in one step. */
export const wrap = (t: number): number => {
  if (!Number.isFinite(t)) return NaN;
  const r = t - 2 * Math.PI * Math.ceil((t - Math.PI) / (2 * Math.PI));
  return r > Math.PI ? r - 2 * Math.PI : r;
};
const mx = (mirror: boolean, p: Vec2): Vec2 => (mirror ? { x: -p.x, y: p.y } : p);

/** The placement as a matrix; `k` replaces the stored size (a ruler-calibrated film's true size, owner G2). */
export function simOf(p: Pose, k = p.scale): Sim {
  const s = p.mirror ? -1 : 1, cos = Math.cos(p.rotation) * k, sin = Math.sin(p.rotation) * k;
  const a = s * cos, b = s * sin, c = -sin, d = cos;
  return { a, b, c, d, e: p.a.x + p.dx - (a * p.b.x + c * p.b.y), f: p.a.y + p.dy - (b * p.b.x + d * p.b.y) };
}

/** The start of a fit (spec G step 2): `film[0]` on `ref[0]`, the line film[0]→film[1] along ref[0]→ref[1], sized so
 *  the two distances are equal — or at `locked` (a ruler-calibrated film's true size). Null when a pair is closer than
 *  MIN_PAIR_PX, a number is not finite, or the size is outside SCALE_MIN–SCALE_MAX. */
export function startPose(ref: [Vec2, Vec2], film: [Vec2, Vec2], mirror: boolean, locked: number | null = null): Pose | null {
  if (![...ref, ...film].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const u = { x: ref[1].x - ref[0].x, y: ref[1].y - ref[0].y }, f0 = mx(mirror, film[0]), f1 = mx(mirror, film[1]);
  const v = { x: f1.x - f0.x, y: f1.y - f0.y }, lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
  if (lu < MIN_PAIR_PX || lv < MIN_PAIR_PX) return null;
  const scale = locked ?? lu / lv;
  if (!(scale >= SCALE_MIN && scale <= SCALE_MAX)) return null;
  return { a: ref[0], b: film[0], mirror, scale, rotation: wrap(Math.atan2(u.y, u.x) - Math.atan2(v.y, v.x)), dx: 0, dy: 0 };
}

/** `alignOnSN` (align.ts) as a matrix, for composing with fits: the same rule and the same refusals. */
export function alignSim(cur: Pts, other: Pts, ratio: number, mirror: boolean): Sim | null {
  const S1 = cur.S, N1 = cur.N, S2 = other.S, N2 = other.N;
  if (!S1 || !N1 || !S2 || !N2 || !(ratio > 0) || !Number.isFinite(ratio)) return null;
  const s2 = mx(mirror, S2), n2 = mx(mirror, N2), u = { x: N1.x - S1.x, y: N1.y - S1.y }, v = { x: n2.x - s2.x, y: n2.y - s2.y };
  if (!Math.hypot(u.x, u.y) || !Math.hypot(v.x, v.y)) return null;
  return simOf({ a: S1, b: S2, mirror, scale: ratio, rotation: Math.atan2(u.y, u.x) - Math.atan2(v.y, v.x), dx: 0, dy: 0 });
}

export const poseOf = (f: FitSave): Pose => ({ a: { x: f.refPoints[0][0], y: f.refPoints[0][1] }, b: { x: f.filmPoints[0][0], y: f.filmPoints[0][1] },
  mirror: f.mirror, scale: f.scale, rotation: f.rotation, dx: f.dx, dy: f.dy });

/** A film as the Superimposition page places it: its points, which way it faces, its own scale, its fit. */
export interface Placed { id: string; points: Pts; facing: string; own: Scale; fit: { refId: string; pose: Pose } | null }

/** Film `g`'s pixels → the open film's pixels. Each film goes to its root (its reference when fitted, else itself) by
 *  its fit — at its true size when it has a ruler (G2) — the two roots are aligned on S–N exactly as today, and the
 *  open film's own fit is undone last. Null when a step cannot be made (a reference not loaded, S or N missing). */
export function toOpen(g: Placed, open: Placed, byId: (id: string) => Placed | null): Sim | null {
  const root = (x: Placed): { root: Placed; sim: Sim } | null => {
    if (!x.fit) return { root: x, sim: IDENTITY };
    const r = x.fit.refId === open.id ? open : byId(x.fit.refId);
    if (!r) return null;
    const k = x.own.source === 'calibration' ? x.own.mmPerPx / r.own.mmPerPx : x.fit.pose.scale;
    return { root: r, sim: simOf(x.fit.pose, k) };
  };
  const rg = root(g), ro = root(open);
  if (!rg || !ro) return null;
  const across = rg.root.id === ro.root.id ? IDENTITY
    : alignSim(ro.root.points, rg.root.points, rg.root.own.mmPerPx / ro.root.own.mmPerPx, rg.root.facing !== ro.root.facing);
  const back = invert(ro.sim);
  return across && back ? compose(back, compose(across, rg.sim)) : null;
}

/** Owner G2 (re-signed MS-4: takes each side's already-resolved Scale, not raw spacing): the scale a film's mm come
 *  from. A ruler or a machine scale always wins (MS-4: the screen's order is ruler, then machine, then fit, then
 *  assumed — both lock the film the same way). A film with neither, with a usable fit, takes
 *  `reference mm/px × fit size` (spec: 0.100 × 1.04 = 0.104), marked; else its own (assumed) scale. */
export function fittedScale(own: Scale, fit: Pick<FitSave, 'scale' | 'refKind'> | null, ref: Scale, refLabel: string): Scale {
  if (own.source !== 'assumed' || !fit || !(fit.scale >= SCALE_MIN && fit.scale <= SCALE_MAX)) return own;
  return { mmPerPx: ref.mmPerPx * fit.scale, source: 'fit', fit: { ref: refLabel, kind: fit.refKind, k: fit.scale, refAssumed: ref.source === 'assumed' } };
}
/** MS-4: a reference's scale for a fit — its ruler, else its machine's scale (counts as calibrated for a fit, not
 *  G3 assumed; its words are never shown), else assumed. Fix round 1, minor 7 (kept here, moved from fittedScale):
 *  `refSpacingMm` takes only `null` for "no ruler"; `undefined` (an unloaded reference, not a checked absence) is
 *  refused rather than silently read as "no ruler". */
export const refScaleOf = (f: FilmFit): Scale => {
  if (typeof f.refSpacingMm === 'undefined') throw new Error('refScaleOf: the reference’s spacing is undefined (not loaded); only null means "no ruler"');
  return f.refSpacingMm !== null ? scaleOf(f.refSpacingMm)
    // Final review (carried item): only a finite machine scale above 0 counts, as in ceph-store's film_scale (`ok`).
    : typeof f.refMachineSpacingMm === 'number' && Number.isFinite(f.refMachineSpacingMm) && f.refMachineSpacingMm > 0
      ? { mmPerPx: f.refMachineSpacingMm, source: 'calibration', steps: 0 } : scaleOf(null);
};
/** Owner G2 (Task 10); MS-4: a machine scale sits above a fit, exactly like a ruler. The scale a film's OWN pages
 *  use, its own scale (what the comparison starts from), and what "Use the scale from the fit" offers. A ruler or a
 *  machine scale always wins (Task 5/MS-3: `calibrate` switches the flag off, `set_fit_own` refuses a ruler or
 *  machine-scaled film): such a film with a fit is offered no switch ('ruler' / 'machine') and keeps its own scale
 *  even if a stale flag says on. A film with neither, with a usable fit, is offered the switch; its pages take the
 *  fit's scale only while it is on. */
export function ownPages(doc: { spacingMm: number | null; scaleSteps: number; fit?: FilmFit | null; machineScale?: MachineScale | null }):
  { scale: Scale; own: Scale; offer: { on: boolean; note: FitNote } | 'ruler' | 'machine' | null } {
  const own = baseScale(doc), f = doc.fit ?? null;
  if (!f) return { scale: own, own, offer: null };
  if (own.source === 'calibration') return { scale: own, own, offer: 'ruler' };
  if (own.source === 'machine') return { scale: own, own, offer: 'machine' };
  const fs = fittedScale(own, f, refScaleOf(f), f.refTimepoint);
  if (fs.source !== 'fit') return { scale: own, own, offer: null };
  return { scale: f.useOwn ? fs : own, own, offer: { on: f.useOwn, note: fs.fit } };
}
