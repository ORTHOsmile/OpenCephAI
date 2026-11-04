import { useCallback, useEffect, useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { library, type MachineSummary } from '../ipc';
import { CHOOSE_LABELS } from './choose';

// Preflight ruling (Task 7, X9): Gender and Referring practitioner (owner Q6) are learned per machine, like the
// Choose-on-the-film fields, but are not Choose-on-the-film buttons themselves, so they are not in `CHOOSE_LABELS`
// (`choose.ts`'s `ChooseField`). A local label map, not a change to `ChooseField`, keeps this screen from printing
// the raw field names "gender"/"referrer" (box words, Q12).
const FIELD_LABELS: Record<string, string> = { ...CHOOSE_LABELS, gender: 'Gender', referrer: 'Referring practitioner' };
/** Exported for `FilmLayouts.test.tsx` (pre-flight ruling, Task 7, X9): a machine that has learned Gender or
 *  Referring practitioner must read with the box words, never the raw field name. */
export const learnedText = (m: MachineSummary) => (m.learned.length
  ? `${m.learned.map((f) => FIELD_LABELS[f] ?? f).join(', ')} learned` : 'nothing learned yet');

/** Library › Film layouts (spec 2026-09-29 Part 5): each machine recognised on this Mac, renamable, resettable, deletable. */
export function FilmLayouts() {
  const [ms, setMs] = useState<MachineSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { library.machines().then((r) => setMs(r ?? [])).catch((e) => setErr(String(e))); }, []);
  useEffect(load, [load]);
  const act = (f: () => Promise<unknown>) => { setErr(null); f().then(load).catch((e) => setErr(String(e))); };
  return (
    <details className="lib-operator film-layouts" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) load(); }}>
      <summary>Film layouts</summary>
      {!ms.length && <p className="identity-note">No machines yet: each is recognised as its films are imported.</p>}
      <ul>{ms.map((m) => (
        <li key={m.id}>
          <input aria-label={`Name of ${m.name}`} defaultValue={m.name} key={m.name}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) act(() => library.renameMachine(m.id, v)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <span className="identity-note">{learnedText(m)} · {m.films} film{m.films === 1 ? '' : 's'}</span>
          <span className="row">
            <button type="button" onClick={async () => {
              if (await ask(`Forget where ${m.name} prints each detail? Its printing pattern is kept.`, { title: 'Reset machine', kind: 'warning' })) act(() => library.resetMachine(m.id));
            }}>Reset</button>
            <button type="button" onClick={async () => {
              if (await ask(`Delete everything learned about ${m.name}? Its cases are kept.`, { title: 'Delete machine', kind: 'warning' })) act(() => library.deleteMachine(m.id));
            }}>Delete</button>
          </span>
        </li>))}</ul>
      {err && <p className="error">{err}</p>}
    </details>
  );
}
