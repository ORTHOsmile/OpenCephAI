import { allAccepted, type TracingPoint } from './state';

/** The open film's sign-off as the status row shows it (spec 2026-10-19, V1: beside Accept position). */
export interface SignOff {
  verifiedAt: string | null; verifiedBy: string | null;
  /** A line saying why the tracing waits for a press of "Mark tracing verified" (V3), or null. */
  holdLine: string | null;
  /** The case is busy (opening, detecting): every control is disabled. */
  busy: boolean;
  /** Owner ruling "Hold sign-off": the point check holds "Mark tracing verified" (its `holdLine` says why): an unresolved
   *  film note, or the check of the current run not read yet or not readable (whole-branch review I1, I2). */
  filmHeld?: boolean;
  /** Set only when the check could not be read: "Try again" reads it again. */
  retryCheck?: () => void;
  onSign: () => void; onReopen: () => void;
}

/**
 * Why a tracing with every point accepted waits for a press of "Mark tracing verified" instead of signing itself off
 * (spec 2026-10-19, V2/V3): its mm changed (a calibration, a ruler drop, or, after merging G, a fit's scale); the
 * clinician pressed Reopen; or it was opened that way (the store does not say why a film is unsigned, so it is held).
 * Only a press of the button lifts a hold. Closing the film forgets it; reopening it gives 'opened'.
 */
export type SignHold = 'mm' | 'reopen' | 'opened' | null;
export type HoldEvent =
  | { kind: 'opened'; signed: boolean; points: Record<string, TracingPoint> }
  | { kind: 'mmChanged'; wasSigned: boolean; points: Record<string, TracingPoint> }
  | { kind: 'signed' } | { kind: 'reopened' };
export function nextHold(prev: SignHold, e: HoldEvent): SignHold {
  switch (e.kind) {
    case 'opened': return !e.signed && allAccepted(e.points) ? 'opened' : null;
    case 'mmChanged': return e.wasSigned || allAccepted(e.points) || prev !== null ? 'mm' : null;
    case 'signed': return null;
    case 'reopened': return 'reopen';
  }
}
export const autoSignAllowed = (h: SignHold): boolean => h === null;
/** Fix round 1, review M-1: the auto path's two IPC round-trips (flush, then the store's own re-read) give a hold
 *  set meanwhile (a calibration, a fit's own mm change, a Reopen) time to land before the sign-off is sent. Re-check
 *  the hold right here, not only once before those awaits. A button press never calls this: it just set or lifted
 *  the hold itself, so there is nothing to re-check. */
export const autoSignStillAllowed = (how: 'button' | 'auto', h: SignHold): boolean => how !== 'auto' || autoSignAllowed(h);
/** Spec §3 (owner D2): automatic sign-off also waits while points are still to come from a background model, so a
 *  tracing is never signed off with a point missing that is about to arrive. */
export const autoSignNow = (h: SignHold, coming: boolean): boolean => autoSignAllowed(h) && !coming;
export const HOLD_LINE: Record<'mm' | 'reopen' | 'opened', string | null> = { mm: 'The mm changed — check, then mark verified.', reopen: null, opened: null };
export const holdLine = (h: SignHold): string | null => (h ? HOLD_LINE[h] : null);
