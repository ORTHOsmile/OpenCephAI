import type { ModelRow } from '../ipc';
import { AARIZ } from '../ai/placement';
import { shortName } from '../ai/pointLabel';

/** The base drop-down (spec 2026-10-29 §2), in Models… beside Automatic best and in Settings › Best model. It shows the
 *  one shared base (`useBase`) and keeps no copy of its own. Lists the installed models in Models… order, Aariz marked
 *  recommended, never Automatic best; a base that is no longer installed stays shown, "(not installed)". */
export function BaseSelect({ id, base, rows, titleOf, disabled, onChoose, error }: {
  id: string; base: string | null; rows: ModelRow[]; titleOf: (id: string) => string; disabled: boolean; onChoose: (id: string) => void; error: string | null;
}) {
  const ready = rows.filter((r) => r.status === 'ready' && r.id !== 'auto-best');
  const name = (m: string) => shortName(m, titleOf) + (m === AARIZ ? ' (recommended)' : '');
  const missing = base !== null && !ready.some((r) => r.id === base);
  return (
    <span className="base-select">
      <label>Base model{' '}
        <select id={id} value={base ?? ''} disabled={disabled || base === null} onChange={(e) => onChoose(e.target.value)}>
          {base === null ? <option value="">Reading…</option> : <>
            {ready.map((r) => <option key={r.id} value={r.id}>{name(r.id)}</option>)}
            {missing && <option value={base} disabled>{`${shortName(base, titleOf)} (not installed)`}</option>}
          </>}
        </select>
      </label>
      {error && <span className="error">{error}</span>}
    </span>
  );
}
