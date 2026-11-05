import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { library, type MachineScaleRow, type MachineSummary } from '../ipc';
import { changeScale, discardScaleUndo, scaleUndoVersion, subscribeScaleUndo, undoRowFor, undoScaleChange } from './scaleUndo';
import { CHOOSE_LABELS } from './choose';
import { changeWarning, parseEntered, scaleSummary } from './machineScale';
import type { DateFormat } from '../dates';
import { formatDate } from '../dates';

// Preflight ruling (Task 7, X9): Gender and Referring practitioner (owner Q6) are learned per machine, like the
// Choose-on-the-film fields, but are not Choose-on-the-film buttons themselves, so they are not in `CHOOSE_LABELS`
// (`choose.ts`'s `ChooseField`). A local label map, not a change to `ChooseField`, keeps this screen from printing
// the raw field names "gender"/"referrer" (box words, Q12).
const FIELD_LABELS: Record<string, string> = { ...CHOOSE_LABELS, gender: 'Gender', referrer: 'Referring practitioner' };
/** Exported for `FilmLayouts.test.tsx` (pre-flight ruling, Task 7, X9): a machine that has learned Gender or
 *  Referring practitioner must read with the box words, never the raw field name. */
export const learnedText = (m: MachineSummary) => (m.learned.length
  ? `${m.learned.map((f) => FIELD_LABELS[f] ?? f).join(', ')} learned` : 'nothing learned yet');

/** Exported for `FilmLayouts.test.tsx` (MS4's order: count, warn, write); it lives with Undo in `scaleUndo.ts`. */
export { applyScaleChange } from './scaleUndo';

/** Library › Film layouts (spec 2026-09-29 Part 5; spec 2026-10-20 MS1–MS4, MS6): each machine recognised on this
 *  Mac, renamable, resettable, deletable, and its calibrated scale — set, changed, removed and undone. */
export function FilmLayouts({ dateFormat }: { dateFormat: DateFormat }) {
  const [ms, setMs] = useState<MachineSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // MS6: the machine (if any) whose "Enter scale…" form is open, and its typed values.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ mm: '', w: '', h: '' });
  // MS4/MQ10, final review I4: Undo is the last change of each machine (`scaleUndo.ts`), re-rendered when it changes.
  useSyncExternalStore(subscribeScaleUndo, scaleUndoVersion, scaleUndoVersion);
  const load = useCallback(() => { library.machines().then((r) => setMs(r ?? [])).catch((e) => setErr(String(e))); }, []);
  useEffect(load, [load]);
  const act = (f: () => Promise<unknown>) => { setErr(null); f().then(load).catch((e) => setErr(String(e))); };
  const change = (m: MachineSummary, row: MachineScaleRow | null) => act(() => changeScale(library, ask, m, row));
  const openEditor = (m: MachineSummary) => {
    setEditing(m.id);
    setDraft(m.scale ? { mm: String(m.scale.spacingMm), w: String(m.scale.widthPx), h: String(m.scale.heightPx) } : { mm: '', w: '', h: '' });
  };
  const save = (m: MachineSummary) => {
    const parsed = parseEntered(draft.mm, draft.w, draft.h);
    if (typeof parsed === 'string') { setErr(parsed); return; }
    setEditing(null);
    change(m, parsed);
  };
  return (
    <details className="lib-operator film-layouts" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) load(); else discardScaleUndo(); }}>
      <summary>Film layouts</summary>
      {!ms.length && <p className="identity-note">No machines yet: each is recognised as its films are imported.</p>}
      <ul>{ms.map((m) => (
        <li key={m.id}>
          <input aria-label={`Name of ${m.name}`} defaultValue={m.name} key={m.name}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) act(() => library.renameMachine(m.id, v)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <span className="identity-note">{learnedText(m)} · {m.films} film{m.films === 1 ? '' : 's'}</span>
          <span className="identity-note machine-scale">{scaleSummary(m, (iso) => formatDate(iso, dateFormat))}</span>
          {editing === m.id && <span className="row scale-editor">
            <label>mm per pixel<input aria-label="mm per pixel" value={draft.mm} onChange={(e) => setDraft((d) => ({ ...d, mm: e.target.value }))} /></label>
            <label>Width (px)<input aria-label="Width (px)" value={draft.w} onChange={(e) => setDraft((d) => ({ ...d, w: e.target.value }))} /></label>
            <label>Height (px)<input aria-label="Height (px)" value={draft.h} onChange={(e) => setDraft((d) => ({ ...d, h: e.target.value }))} /></label>
            <button type="button" onClick={() => save(m)}>Save</button>
            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
          </span>}
          <span className="row">
            <button type="button" onClick={() => openEditor(m)}>Enter scale…</button>
            {m.scale && <button type="button" onClick={() => change(m, null)}>Remove scale</button>}
            {undoRowFor(m) !== undefined && <button type="button" onClick={() => act(() => undoScaleChange(library, ask, m))}>Undo</button>}
            <button type="button" onClick={async () => {
              const base = `Forget where ${m.name} prints each detail? Its printing pattern is kept.`;
              if (await ask(base, { title: 'Reset machine', kind: 'warning' })) act(() => library.resetMachine(m.id));
            }}>Reset</button>
            <button type="button" onClick={async () => {
              const words = changeWarning(await library.machineDeleteChange(m.id));
              const question = `Delete everything learned about ${m.name}? Its cases are kept.${words ? ` ${words}` : ''}`;
              if (await ask(question, { title: 'Delete machine', kind: 'warning' })) act(() => library.deleteMachine(m.id));
            }}>Delete</button>
          </span>
        </li>))}</ul>
      {err && <p className="error">{err}</p>}
    </details>
  );
}
