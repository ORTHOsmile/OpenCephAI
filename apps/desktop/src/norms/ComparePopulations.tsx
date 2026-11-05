import { useEffect, useRef, useState } from 'react';
import { populationsOffered } from '@ceph/analyses';
import { settings, type CaseDoc } from '../ipc';
import type { Decimals } from '../format';
import type { MeasurementRow } from '../measurements';
import { fitMark, type Scale } from '../tracing/spacing';
import { COMPARE_KEY, compareCells, readCompare, ticksAfterRead } from './compare';
import type { NormContext } from './normCell';
import { CompareTable } from './CompareTable';

const REFUSAL = 'Compare 2 to 4 populations.';
/** Request G (Task 10 ruling, "never silently"): with "Use the scale from the fit" on, the open film's mm here come from
 *  the fit, so the window says so ("mm scaled to T1 on S–N (×1.042)."); none for a ruler or the assumed scale (whose
 *  mm are hidden, N5). */
export const scaleNoteOf = (s: Scale): string | null => (s.source === 'fit' ? `mm ${fitMark(s.fit)}.` : null);

/** Sidebar/CasePanel › "Compare populations…" (master plan §9, ruling P26): the open case's measurements
 *  against 2–4 populations side by side. The tick-list is kept on this Mac (`COMPARE_KEY`), read once on open and
 *  written on every tick, so a close and reopen of the dialog (or the case) keeps the choice — the same pattern as
 *  the analyses picker and the decimals setting. Ticking a 5th is refused in words; it stays unticked.
 *  Final review M-10: a failed read of the stored ticks is shown, and a tick made before it returns is kept.
 *  Ruling AUTO-Q7 (19 Oct 2026): each column is that population's own norm or '—'; choosing happens on the
 *  Measurements tab. Final review I-2: `unconfirmedFor` marks each measurement using an AI point not yet accepted,
 *  from the same per-row list the Inspector shows. */
export function ComparePopulations({ rows, doc, ctx, decimals, unconfirmedFor, onClose, scaleNote = null }: {
  rows: MeasurementRow[];
  doc: Pick<CaseDoc, 'population' | 'gender' | 'dateOfBirth' | 'takenOn'>;
  ctx: NormContext;
  decimals: Decimals;
  unconfirmedFor: (node: string) => string[];
  onClose: () => void;
  /** Request G (Task 10): where the mm come from when a fit scales them (`scaleNoteOf`); null otherwise. */
  scaleNote?: string | null;
}) {
  const offered = populationsOffered(ctx.sets, ctx.userNorms);
  const offeredIds = offered.map((p) => p.id);
  const [ticked, setTicked] = useState<string[]>([]);
  const [refused, setRefused] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const touched = useRef(false);
  useEffect(() => {
    let gone = false;
    void readCompare(settings, offeredIds).then((r) => {
      if (gone) return;
      setTicked((cur) => ticksAfterRead(touched.current, cur, r.value));
      setReadError(r.error);
    });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const onToggle = (id: string) => {
    const on = ticked.includes(id);
    if (!on && ticked.length >= 4) { setRefused(true); return; }
    touched.current = true;
    setRefused(false);
    const next = on ? ticked.filter((x) => x !== id) : [...ticked, id];
    setTicked(next);
    void settings.set(COMPARE_KEY, JSON.stringify(next));
  };
  const comparable = ticked.length >= 2 && ticked.length <= 4;
  const compared = comparable ? compareCells(rows, ticked, doc, ctx, decimals) : [];
  const labelOf = (id: string) => offered.find((p) => p.id === id)?.label ?? id;
  return (
    <div className="modal-backdrop">
      <div className="compare-populations" role="dialog" aria-modal="true" aria-label="Compare populations">
        <h2>Compare populations</h2>
        <div className="compare-ticks">
          {offered.map((p) => (
            <label key={p.id} className="inline">
              <input type="checkbox" checked={ticked.includes(p.id)} onChange={() => onToggle(p.id)} />
              {p.label}
            </label>
          ))}
        </div>
        {readError && <p className="hint warn" role="status">{readError}</p>}
        {refused && <p className="hint warn" role="alert">{REFUSAL}</p>}
        {scaleNote && <p className="hint fit-note">{scaleNote}</p>}
        {!comparable
          ? <p className="hint">Tick 2 to 4 populations to compare.</p>
          : <CompareTable compared={compared} ticked={ticked} labelOf={labelOf} unconfirmedFor={unconfirmedFor} />}
        <div className="row">
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
