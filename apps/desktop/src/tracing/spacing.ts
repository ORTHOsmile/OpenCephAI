import type { FitRefKind, MachineScale } from '../ipc';
export type { MachineScale } from '../ipc';
/** The Ceph-400 convention, used until the ruler is calibrated (decision 17) and always labelled "assumed". */
export const ASSUMED_MM_PER_PX = 0.1;
/** Request G (owner G2): what a fitted scale rests on — the reference film, S–N or two points, the size, and whether
 *  the reference itself had no ruler (G3). */
export interface FitNote { ref: string; kind: FitRefKind; k: number; refAssumed: boolean }
/** Fix round 1, ruling 5: a discriminated union, not one flat interface with an optional `fit?` — so a 'fit'
 *  scale cannot exist without its note. The old shape let `{ source: 'fit' }` (no `fit`) compile, which read as
 *  NOT assumed (`isAssumed` fail-open) and printed the plain "assumed: calibrate with K)" label: the "assumed
 *  scale" mark could be silently lost. There is no such producer today (only `fit.ts`'s `fittedScale`, which
 *  always supplies `fit`); this closes the gap before one is added. */
export type Scale =
  | { mmPerPx: number; source: 'calibration'; /** Spec 2026-10-19 Addendum 3: fine-tune presses (0 = none). */ steps: number }
  | { mmPerPx: number; source: 'machine'; /** Spec 2026-10-20: the machine's calibrated scale, applying to this film. */ machine: MachineScale }
  | { mmPerPx: number; source: 'assumed' }
  | { mmPerPx: number; source: 'fit'; fit: FitNote };
/** `steps`: the film's fine-tune presses (CaseDoc.scaleSteps). Only `ownPages` passes them; a caller that only asks
 *  where the scale came from, or its mm per px, can leave them out. */
export const scaleOf = (spacingMm: number | null | undefined, steps = 0): Scale =>
  spacingMm !== null && spacingMm !== undefined && Number.isFinite(spacingMm) && spacingMm > 0
    ? { mmPerPx: spacingMm, source: 'calibration', steps } : { mmPerPx: ASSUMED_MM_PER_PX, source: 'assumed' };
/** A film's own scale before any fit (spec 2026-10-20, "a film's scale, in order"): its ruler (with its fine-tune),
 *  else its machine's calibrated scale when that applies (exact pixel size), else assumed. */
export function baseScale(d: { spacingMm: number | null | undefined; scaleSteps?: number; machineScale?: MachineScale | null }): Scale {
  const own = scaleOf(d.spacingMm, d.scaleSteps ?? 0);
  const m = d.machineScale;
  return own.source === 'assumed' && m?.applies && Number.isFinite(m.spacingMm) && m.spacingMm > 0
    ? { mmPerPx: m.spacingMm, source: 'machine', machine: m } : own;
}
/** MS3 (owner, 20 Oct), word for word. `date` formats an ISO day (the screen and report: the operator's format; the
 *  CSV: as stored). Anonymised (MQ4) and a source film that is gone (MQ3) say "from a calibrated film". */
export const machineWords = (m: MachineScale, date: (iso: string) => string, anonymise = false): string =>
  `calibrated scale (machine: ${m.machineName}, ${m.source === 'entered' ? 'entered value'
    : !anonymise && m.sourceFilmDate ? `from film of ${date(m.sourceFilmDate)}` : 'from a calibrated film'})`;
/** MS2: why a film of the machine at another size keeps the assumed scale; null when there is nothing to explain. */
export function machineSizeNote(d: { image: { width: number; height: number }; machineScale?: MachineScale | null; spacingMm: number | null }): string | null {
  const m = d.machineScale;
  if (!m || m.applies || d.spacingMm !== null) return null;
  return `${m.machineName} has a calibrated scale for films of ${m.widthPx} × ${m.heightPx} px; this film is ${d.image.width} × ${d.image.height} px, so its scale stays assumed.`;
}
/** Spec 2026-10-19 Addendum 3 (owner, 20 Oct): one press of − / + is 0.5 % of the ruler's own mm per px; at most 10
 *  presses either way (±5 %). The library computes the mm per px (ceph-store `with_steps`); these only bound and word it. */
export const SCALE_STEP_PERCENT = 0.5;
export const MAX_SCALE_STEPS = 10;
/** ", adjusted +1.0 %" for a fine-tuned calibration; '' for none, so an unadjusted film reads exactly as before. */
export const adjustedWords = (steps: number): string =>
  steps === 0 ? '' : `, adjusted ${steps > 0 ? '+' : '-'}${(Math.abs(steps) * SCALE_STEP_PERCENT).toFixed(1)} %`;
/** Not a measured scale: no ruler, or a fit to a film with no ruler (G3). */
export const isAssumed = (s: Scale) => s.source === 'assumed' || (s.source === 'fit' && !!s.fit.refAssumed);
export const fitMark = (n: FitNote) =>
  `scaled to ${n.ref} on ${n.kind === 'sn' ? 'S–N' : 'two points'} (×${n.k.toFixed(3)})${n.refAssumed ? ', assumed scale' : ''}`;
/** The † note's line, naming the fitted film (owner, 23 Oct): the same words on the film's own Measurements and in
 *  the report, e.g. "T2 scaled to T1 on S–N (×1.042)"; "This film" when it has no timepoint. */
export const fitNoteLine = (timepoint: string, n: FitNote) => `${timepoint.trim() || 'This film'} ${fitMark(n)}`;
/** Owner G2 (17 Oct), word for word, with the reference's timepoint. */
export const noRulerSentence = (n: FitNote) => `This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to ${n.ref}.`
  + (n.refAssumed ? ` ${n.ref} had no ruler either, so both are on the assumed scale.` : '');
/** Spec 2026-10-19 addendum (J, film side): "calibrated scale" after a ruler calibration, "assumed scale" before. The
 *  paper's own "assumed scale" norm tag (flag `scale-assumed`) is a different thing, handled by the norms piece. */
export const scaleLabel = (s: Scale, date: (iso: string) => string = (iso) => iso) =>
  s.source === 'machine' ? `${s.mmPerPx.toFixed(4)} mm/px, ${machineWords(s.machine, date)}`
    : s.source === 'calibration' ? `${s.mmPerPx.toFixed(4)} mm/px (calibrated scale${adjustedWords(s.steps)})`
      : s.source === 'fit' ? `${s.mmPerPx.toFixed(4)} mm/px (${fitMark(s.fit)})`
        : `${s.mmPerPx} mm/px (assumed scale: calibrate with K)`;
