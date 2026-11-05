import type { TracingPoint } from './tracing/state';
// Plan §11: points are coloured by *calibrated predicted error*, never by a raw network score. The HRNet heatmap peak
// is not a probability (8.5–26.8 on Ceph-400) and barely tracks error (Spearman ρ = −0.07), so until §11's calibration
// exists every AI point looks the same and is labelled unverified. Green/amber/red stay reserved for §11.
export const AI_POINT_LABEL = 'AI · unverified';
// Owner P1 (19 Oct): a point the clinician accepted; "Verified" now means only the tracing's sign-off.
export const POINT_ACCEPTED = 'Accepted';
export const aiPointColour = (_rawScore?: number): string => 'var(--mark-ai)';
/** The line under the film (spec 2026-10-19 addendum, H). Its words are unchanged; the same statement is in About. */
export const AI_LINE = `${AI_POINT_LABEL}: clinician review required · not a diagnostic device`;
/** H: shown while the open film has an AI point (moved or not) and its tracing is not signed off; hidden once it is
 *  signed off, and back whenever the sign-off clears. A film with no AI points never shows it. */
export const aiLineShown = (points: Record<string, Pick<TracingPoint, 'source'>>, signedOff: boolean): boolean =>
  !signedOff && Object.values(points).some((p) => p.source !== 'manual');
