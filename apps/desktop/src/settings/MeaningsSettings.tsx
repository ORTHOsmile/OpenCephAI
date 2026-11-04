import { useState } from 'react';
import { CATALOGUE, DEFAULT_MEANINGS } from '@ceph/analyses';
import { settings } from '../ipc';
import { resetOverride, saveOverride, wordsFor, type Overrides, type Side } from './meanings';

/** Owner MEANING-PER-CLINICIAN (16 Oct 2026): Settings › Meanings — the approved words for every measurement, each
 *  editable for the current clinician (saved on this Mac under their name). A changed side shows the approved words
 *  in grey with Reset; clearing a box also goes back to the approved words.
 *  NOCLIN-2 (ruling, 17 Oct 2026, item 34): editing here always changes `clinician`'s own words — the
 *  top-bar choice, or the Mac login name when none is chosen — never a referrer's, so nobody edits another
 *  person's words by accident. `referrerNote`, when set, says in one plain line whose words the open film is
 *  actually SHOWING right now (the referring practitioner's), so it is clear why that may differ from what is
 *  edited below. */
export function MeaningsSettings({ clinician, overrides, referrerNote = null, onChanged }: { clinician: string; overrides: Overrides; referrerNote?: string | null; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const live = CATALOGUE.filter((e) => !e.retired && DEFAULT_MEANINGS[e.id]);
  const save = (id: string, side: Side, text: string) => {
    const d = DEFAULT_MEANINGS[id][side], t = text.trim();
    const p = !t || t === d ? resetOverride(settings, clinician, id, side) : saveOverride(settings, clinician, id, side, t);
    p.then(() => { setError(null); onChanged(); }).catch((e) => setError(`Your words could not be saved: ${String(e)}`));
  };
  if (!clinician) return <p className="hint">Choose who is tracing (top bar) to keep your own words; the approved words are used meanwhile.</p>;
  return (
    <div className="settings-meanings">
      {referrerNote && <p className="hint referrer-note">{referrerNote}</p>}
      <p className="hint">Words used in each measurement's detail line and, later, the report — for <b>{clinician}</b>. The
        severity word (Mild, Moderate, Severe, tendency) is added automatically. Clear a box to use the approved words.</p>
      {error && <p className="hint warn">{error}</p>}
      <table className="measures meanings">
        <thead><tr><th>Measurement</th><th>Above the norm</th><th>Below the norm</th></tr></thead>
        <tbody>{live.map((e) => {
          const w = wordsFor(e.id, overrides)!, d = DEFAULT_MEANINGS[e.id];
          return (
            <tr key={e.id} className="meanings-row" data-node={e.id}>
              <td>{e.label}</td>
              {(['high', 'low'] as const).map((side) => {
                const changed = !!overrides[e.id]?.[side]?.trim();
                return (
                  <td key={side}>
                    <input aria-label={`${e.label}, ${side === 'high' ? 'above' : 'below'} the norm`} defaultValue={w[side]} key={`${clinician}:${w[side]}`}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') ev.currentTarget.blur(); }}
                      onBlur={(ev) => { const t = ev.target.value.trim();
                        // Review M-1: a cleared (or spaces-only) box shows the approved words again, as it now uses them.
                        if (!t) ev.target.value = d[side]; else if (t !== ev.target.value) ev.target.value = t;
                        if (t !== w[side]) save(e.id, side, t); }} />
                    {changed && <div className="meaning-default">Approved: {d[side]}{' '}
                      <button type="button" className="link" onClick={() => save(e.id, side, '')}>Reset</button></div>}
                  </td>);
              })}
            </tr>);
        })}</tbody>
      </table>
    </div>
  );
}
