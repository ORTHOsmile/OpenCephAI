import { choiceFacts, normChoices, type NormQuery } from '@ceph/analyses';
import type { Decimals } from '../format';
import { normText } from './normCell';

/** Owner NORM-PICK-1 (12 Oct): the list behind "no <population> norm — choose one". `q` is the query of the cell being
 *  chosen for, its population the one with no norm. Every source that has the measurement (normChoices: other
 *  populations, the analysis's own norm, the clinician's own norm sets), each with its value at the decimals setting,
 *  its sample n and ages, and its source line on hover — all from the resolver. */
export function NormChooser({ q, decimals, onPick, onClose }: { q: NormQuery; decimals: Decimals; onPick: (source: string) => void; onClose: () => void }) {
  const choices = normChoices(q);
  return (
    <div className="norm-chooser" role="group" aria-label="Choose a norm">
      <ul>
        {choices.map((c) => (
          <li key={c.id} className="norm-choice">
            <button type="button" className="link" title={c.resolved.sourceLine} onClick={() => onPick(c.id)}>{c.label}</button>
            {' '}<span className="norm-choice-value">{normText(c.resolved, decimals)}</span>
            {' '}<span className="norm-choice-facts">{choiceFacts(c)}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  );
}
