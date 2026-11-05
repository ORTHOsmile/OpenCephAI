import type { MachineScale, SeriesFilm } from '../ipc';
import { baseScale } from '../tracing/spacing';
import { defaultReference, fitBlock } from './fitDraft';

/** Owner G1 (17 Oct): a film with no ruler and no fit is "not scaled"; the advice offers its ruler or a fit.
 *  MS-4: a machine-scaled film is scaled too, so it gets no advice. */
export interface Advice { film: string; filmLabel: string; ref: string | null; refLabel: string | null; block: string | null }
export function adviceFor(film: { id: string; timepoint: string; spacingMm: number | null; fitted: boolean; machineScale?: MachineScale | null }, films: SeriesFilm[], unnamed: boolean): Advice | null {
  if (baseScale(film).source !== 'assumed' || film.fitted) return null;
  const r = unnamed ? null : defaultReference(films, film.id);
  return { film: film.id, filmLabel: film.timepoint, ref: r?.id ?? null, refLabel: r?.timepoint ?? null, block: fitBlock(films, film.id, unnamed) };
}
export const adviceText = (a: Advice) => (a.refLabel
  ? `${a.filmLabel} is not scaled. Calibrate it from its ruler, or scale it to ${a.refLabel}?`
  : `${a.filmLabel} is not scaled. Calibrate it from its ruler.`);
