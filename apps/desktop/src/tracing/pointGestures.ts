import type { Vec2 } from '@ceph/geometry';
import type { Action } from './state';

/** A double press (spec 2026-10-19, V5): the second press on the same point within this time and screen distance. */
export const DOUBLE_MS = 500, DOUBLE_PX = 4;
export interface LastPress { id: string; at: Vec2; t: number }

/** A press on a point on the film: ⌘/Ctrl picks it (V6); a second press on the same point soon after and close by
 *  accepts it where it is, with no drag (V5); anything else starts a drag (and is remembered for a double press). */
export function pressOnPoint(id: string, at: Vec2, t: number, mod: boolean, last: LastPress | null): { act: 'pick' | 'accept' | 'drag'; last: LastPress | null } {
  if (mod) return { act: 'pick', last: null };
  if (last && last.id === id && t - last.t <= DOUBLE_MS && Math.hypot(at.x - last.at.x, at.y - last.at.y) <= DOUBLE_PX) return { act: 'accept', last: null };
  return { act: 'drag', last: { id, at, t } };
}
/** A click on a point's row: ⌘/Ctrl picks it (V6), a plain click selects it (and clears the picks). Read-only: select. */
export const listClick = (id: string, mod: boolean, readOnly: boolean): Action => (mod && !readOnly ? { type: 'togglePick', id } : { type: 'select', id });
/** A double-click on a row accepts that point where it is (V5); nothing on a read-only film. */
export const listDoubleClick = (id: string, readOnly: boolean): Action | null => (readOnly ? null : { type: 'acceptMany', ids: [id], kind: 'double-click' });
