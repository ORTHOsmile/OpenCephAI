import type { Placement } from '../ai/placement';
import { replacedOnRedetect, type TracingPoint } from '../tracing/state';

/** Spec §3 and §6 (owner D2; Q6, recommended A): what the screen shows as soon as the main run is placed. Placed with no
 *  extra model yet, a point given to another model gets Aariz's mark and is listed in `fallback`; those are held back,
 *  to appear when their model answers. */
export function firstShown(p: Placement): Placement {
  const held = new Set(p.fallback);
  return { landmarks: p.landmarks.filter((l) => !held.has(l.id)), source: Object.fromEntries(Object.entries(p.source).filter(([id]) => !held.has(id))),
    fallback: [], via: p.via, wanted: p.wanted };
}
/** The models a held point waits for: their bar and their errors show even with their ghost off. */
export const waitingFor = (first: Placement): Set<string> => new Set(Object.values(first.wanted));
/** The second step: points of the full placement the first step did not show, where the film is still free (no point,
 *  or an AI point nobody touched) or holds a point you placed there by hand while it waited. The reducer's `arrive`
 *  never replaces your point: for it, the model's mark only goes into the ⌘Z history, so ⌘Z of your placement gives
 *  back the model's mark (owner, 28 Oct; final review I1). A point moved or accepted meanwhile is left out. */
export function lateArrivals(full: Placement, first: Placement, onFilm: Record<string, TracingPoint>): Placement {
  const shown = new Set(first.landmarks.map((l) => l.id));
  const landmarks = full.landmarks.filter((l) => !shown.has(l.id) && (replacedOnRedetect(onFilm[l.id], false) || onFilm[l.id]?.source === 'manual'));
  const ids = new Set(landmarks.map((l) => l.id));
  return { landmarks, source: Object.fromEntries(Object.entries(full.source).filter(([id]) => ids.has(id))),
    fallback: full.fallback.filter((id) => ids.has(id)), via: full.via, wanted: {} };
}
/** The late points that land on the film you see now (free there); the rest only go into the ⌘Z history. */
export const landingNow = (late: Placement, onFilm: Record<string, TracingPoint>): Placement['landmarks'] =>
  late.landmarks.filter((l) => replacedOnRedetect(onFilm[l.id], false));
/** A new film is levelled on Frankfort (Po, Or) when first traced; if either arrives late (on the film now), level it again then. */
export const levelAgain = (landing: Placement['landmarks']): boolean => landing.some((l) => l.id === 'Po' || l.id === 'Or');
/** Spec §6 (D2): an extra model's bar and error line show when its ghost is on. `hidden` is null until the ghost
 *  settings have loaded, and then nothing shows, so the screen never flashes a bar you turned off (fix round 1).
 *  A model a held point waits for shows regardless (useCase adds that). */
export const extraShownBy = (hidden: ReadonlySet<string> | null) => (modelId: string): boolean => hidden !== null && !hidden.has(modelId);
