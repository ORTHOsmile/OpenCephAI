import type { Stage } from '../ipc';
import { STAGE_LABEL } from '../compare/series';

export interface KeyLine { id: string; label: string; ticked: boolean; open: boolean; stage: Stage | null; auto: Stage | null;
  look: { colour: string; dash?: string } | null; note: string | null }
interface Props { lines: KeyLine[]; hint: string | null; onTick: (id: string, on: boolean) => void; onStage: (id: string, s: Stage | null) => void }

/** The films of the comparison (spec 2026-09-30 Part 1): tick, ABO swatch, T-label and date, and Stage. */
export function SeriesKey({ lines, hint, onTick, onStage }: Props) {
  return (
    <div className="series-key">
      {hint && <p className="hint">{hint}</p>}
      <ul aria-label="Films in the comparison">
        {lines.map((l) => (
          <li key={l.id}>
            <label className="series-line">
              {l.open ? <span className="series-open" title="The open film is always in its comparison" /> :
                <input type="checkbox" checked={l.ticked} onChange={(e) => onTick(l.id, e.target.checked)} aria-label={`Show ${l.label}`} />}
              <span className="swatch" style={l.look ? { borderTopColor: l.look.colour, borderTopStyle: l.look.dash ? (l.look.dash === '2 4' ? 'dotted' : 'dashed') : 'solid' } : { borderTopColor: 'transparent' }} />
              <span className="series-label">{l.label}{l.open ? ' (open)' : ''}</span>
            </label>
            <select aria-label={`Stage of ${l.label}`} value={l.stage ?? ''} onChange={(e) => onStage(l.id, (e.target.value || null) as Stage | null)}>
              <option value="">{l.auto ? `Auto (${STAGE_LABEL[l.auto]})` : 'Auto'}</option>
              {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
            {l.note && <div className="identity-note">{l.note}</div>}
          </li>))}
      </ul>
    </div>
  );
}
