import { useState } from 'react';
import { ALT } from '../input/modName';
import { pickStep, type Draft, type DraftAction, type Show } from './fitDraft';
import type { FitRefKind } from '../ipc';

interface Props { draft: Draft; refs: { id: string; label: string }[]; busy: boolean; error: string | null; notice: string | null; canSave: boolean;
  onRef: (id: string) => void; act: (a: DraftAction) => void; onSave: () => void; onReset: () => void; onRemove: () => void; onCancel: () => void }

/** Request G (spec step 2): fit one film to another — reference, size, what is shown, Save fit / Reset / Cancel, and
 *  (owner D-f, 18 Oct) Remove fit while a fit is saved. */
export function FitPanel({ draft: s, refs, busy, error, notice, canSave, onRef, act, onSave, onReset, onRemove, onCancel }: Props) {
  const [typed, setTyped] = useState<string | null>(null);
  const fixed = s.locked !== null || busy;
  const commit = () => { if (typed !== null) act({ type: 'size', k: Number(typed.replace(/[^0-9.]/g, '') || 'x') }); setTyped(null); };
  return (
    <section className="fit-panel" aria-label={`Fit ${s.filmLabel} to ${s.refLabel}`}>
      <h3>Fit {s.filmLabel} to {s.refLabel}</h3>
      <label className="fit-ref">Fit to <select aria-label="Fit to" value={s.ref} disabled={busy} onChange={(e) => onRef(e.target.value)}>
        {refs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      <div className="segmented" role="radiogroup" aria-label="Reference">
        {(['sn', 'points'] as FitRefKind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={s.kind === k} disabled={busy} onClick={() => act({ type: 'kind', kind: k })}>
            {k === 'sn' ? 'S–N' : 'Two points you pick'}</button>))}
      </div>
      {pickStep(s) && <p className="hint">{pickStep(s)}</p>}
      <div className="fit-size">Size
        <button type="button" aria-label="Smaller" disabled={fixed} onClick={(e) => act({ type: 'step', n: e.shiftKey ? -10 : -1 })}>−</button>
        <span aria-hidden="true">×</span>
        <input aria-label="Size" type="text" inputMode="decimal" disabled={fixed} value={typed ?? s.pose.scale.toFixed(3)}
          onChange={(e) => setTyped(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
        <button type="button" aria-label="Larger" disabled={fixed} onClick={(e) => act({ type: 'step', n: e.shiftKey ? 10 : 1 })}>+</button>
      </div>
      {s.locked !== null && <p className="hint">{s.filmLabel} was calibrated from its ruler, so its size is fixed. You can still move and turn it.</p>}
      <div className="segmented" role="radiogroup" aria-label="Show">
        {(['both', 'ref', 'film'] as Show[]).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={s.show === v} onClick={() => act({ type: 'show', show: v })}>
            {v === 'both' ? 'Both' : v === 'ref' ? s.refLabel : s.filmLabel}</button>))}
      </div>
      {s.message && <p className="hint warn">{s.message}</p>}
      {notice && <p className="hint" role="status">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <p className="hint">Drag the film to move it, {ALT()}-drag to turn it, arrow keys nudge (⇧ 10).
        Scroll or pinch to zoom at the pointer; hold Space and drag to pan.</p>
      <div className="row">
        <button type="button" className="primary" disabled={!canSave || busy} onClick={onSave}>Save fit</button>
        <button type="button" disabled={busy} onClick={onReset}>Reset</button>
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {s.saved && <div className="row"><button type="button" disabled={busy} onClick={onRemove}>Remove fit</button></div>}
    </section>);
}
