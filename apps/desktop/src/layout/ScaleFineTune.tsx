import type { FineTune } from '../tracing/fineTune';
import { modLabel, shortcut } from '../input/keymap';

/** Spec 2026-10-19 Addendum 3 (owner, 20 Oct): − / + beside the film's scale line. Each press is 0.5 % of the ruler's
 *  own value and one undo step. */
export function ScaleFineTune({ t }: { t: FineTune }) {
  const undo = shortcut(modLabel(), 'Z');
  return (
    <span className="fine-tune" role="group" aria-label="Fine-tune the calibration">
      <button type="button" aria-label="Scale down 0.5 %" title={`Scale down 0.5 % (${undo} undoes)`} disabled={!t.canDown} onClick={() => t.onStep(-1)}>−</button>
      <button type="button" aria-label="Scale up 0.5 %" title={`Scale up 0.5 % (${undo} undoes)`} disabled={!t.canUp} onClick={() => t.onStep(1)}>+</button>
    </span>
  );
}
