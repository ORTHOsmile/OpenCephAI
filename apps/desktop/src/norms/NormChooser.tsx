import { AUTO_CHOICE_ID, choiceFacts, normChoices, pickPopulation, type NormQuery } from '@ceph/analyses';
import type { Decimals } from '../format';
import { normText, rewordUnstatedScale } from './normCell';

/** Owner NORM-PICK-1 (12 Oct) and N-A2 (19 Oct): the row's norm list — "◆ Auto" first when Auto has an answer, then
 *  every source that has the measurement (normChoices: other populations, the analysis's own norm, the clinician's
 *  own norm sets), each with its value at the decimals setting, its sample n and ages, and its source line on hover —
 *  all from the resolver. The source in use is marked (`aria-current`). */
export function NormChooser({ q, decimals, onPick, onClose }: { q: NormQuery; decimals: Decimals; onPick: (source: string) => void; onClose: () => void }) {
  const choices = normChoices(q);
  // Owner N-A2 (19 Oct 2026): the source in use — a stored pick that is still offered wins; otherwise Auto, when offered.
  const pop = pickPopulation(q);
  const stored = q.picks?.[pop]?.[q.measurement];
  const inUse = choices.find((c) => c.id === stored)?.id ?? choices.find((c) => c.id === AUTO_CHOICE_ID)?.id ?? null;
  return (
    <div className="norm-chooser" role="group" aria-label="Choose a norm">
      <ul>
        {choices.map((c) => (
          <li key={c.id} className="norm-choice" aria-current={c.id === inUse ? 'true' : undefined}>
            {c.id === AUTO_CHOICE_ID && <><span className="norm-auto-mark" aria-hidden="true">◆</span>{' '}</>}
            {/* Review I-1 (fix round 1, 24 Oct 2026): owner ruling Q-B's reword, so the candidate's hover never
               reads as if the PATIENT's film were unscaled — the same rewordUnstatedScale normCell applies. */}
            <button type="button" className="link" title={rewordUnstatedScale(c.resolved.sourceLine)} onClick={() => onPick(c.id)}>{c.label}</button>
            {' '}<span className="norm-choice-value">{normText(c.resolved, decimals)}</span>
            {' '}<span className="norm-choice-facts">{choiceFacts(c)}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  );
}
