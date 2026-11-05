import type { Vec2 } from '@ceph/geometry';
import type { RulerMarks } from '../ipc';

export interface RulerStoreLib {
  calibrate: (caseId: string, p1: Vec2, p2: Vec2, mm: number) => Promise<number>;
  recalibrate: (caseId: string, p1: Vec2, p2: Vec2, mm: number, steps: number) => Promise<number>;
}

/**
 * The core of `storeRuler`'s queued job (`useCase.ts`), pulled out so the id guard (final review I-1) can be
 * proven without a React test harness — apps/desktop has no renderHook library. A queued job must act on the
 * film it was queued for, never on whichever film happens to be open when the serial queue (`serial()`) finally
 * runs it, or when the library's IPC call returns.
 *
 * `id` is the film the caller captured when `storeRuler` was CALLED (see `useCase.ts`'s `storeRuler`), not read
 * here. `getOpenId` reads whichever film is open right now; a mismatch — before the IPC call, or after it
 * returns — skips both the library write and `onStored` (which the caller uses for `rulerOnDisk` and
 * `afterMmChange`, i.e. the screen update). The IPC call already in flight when the film switches cannot be
 * unsent, so it still lands on the library side for `id`'s row; `onStored` is what must not then write B's screen.
 */
export async function runRulerStore(id: string, r: RulerMarks, getOpenId: () => string | undefined,
  lib: RulerStoreLib, onStored: (spacingMm: number) => Promise<void>): Promise<boolean> {
  if (getOpenId() !== id) return false;
  const spacingMm = r.steps === 0 ? await lib.calibrate(id, r.p1, r.p2, r.mm) : await lib.recalibrate(id, r.p1, r.p2, r.mm, r.steps);
  if (getOpenId() !== id) return false;
  await onStored(spacingMm);
  return true;
}
