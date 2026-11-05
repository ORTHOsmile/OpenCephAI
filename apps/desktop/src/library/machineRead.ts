import type { CaseDoc } from '../ipc';
import { ownPages } from '../compare/fit';

/** The parts of a film's doc a machine re-match can change (the store's `match_machine`, MQ12) and that the screen's
 *  scale and sign-off are read from. */
export type MachineReadDoc = Pick<CaseDoc, 'spacingMm' | 'scaleSteps' | 'fit' | 'machine' | 'machineScale' | 'verifiedAt' | 'verifiedBy'>;

/** Final review I3 (ruling, 25 Oct): after a store call that can assign or move the OPEN film's machine
 *  ("Read the film again", or entering Choose, which reads the film by itself), `was` is the doc on screen before it
 *  and `fresh` the doc re-read after it. `patch` carries the machine, scale, fit and sign-off across; `hold` says the
 *  V3 hold must be applied (`holdForMm`): the scale the film's own pages use moved, or the store cleared its sign-off.
 *  Held, nothing signs the film again until the clinician presses "Mark tracing verified". */
export function afterMachineRead(was: MachineReadDoc, fresh: MachineReadDoc): { patch: Pick<CaseDoc, 'machine' | 'machineScale' | 'fit' | 'verifiedAt' | 'verifiedBy'>; hold: boolean } {
  const a = ownPages(was).scale, b = ownPages(fresh).scale;
  const moved = a.source !== b.source || a.mmPerPx !== b.mmPerPx;
  const cleared = !!was.verifiedAt && !fresh.verifiedAt;
  return { patch: { machine: fresh.machine ?? null, machineScale: fresh.machineScale ?? null, fit: fresh.fit ?? null, verifiedAt: fresh.verifiedAt, verifiedBy: fresh.verifiedBy },
    hold: moved || cleared };
}
