import { useState } from 'react';
import { CsvOptions, csvDefaults, type CsvChoice } from '../report/CsvOptions';

/** Library ▸ Export CSV… for the chosen films: one file, the analyses switched on; Named or Anonymised always offered,
 *  Anonymised chosen for several films and Named for one (owner R4, ANON-1). */
export function CsvDialog({ count, onSave, onClose }: { count: number; onSave: (c: CsvChoice) => Promise<boolean>; onClose: () => void }) {
  const [c, setC] = useState<CsvChoice>(csvDefaults(count));
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { if (await onSave(c)) onClose(); }
    catch (e) { setErr(`Couldn't export: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop">
      <div className="settings-window csv-dialog" role="dialog" aria-modal="true" aria-label="Export CSV">
        <h2>Export CSV: {count} {count === 1 ? 'film' : 'films'}</h2>
        <p className="hint">One file with the analyses switched on. Each film uses its own scale, its own chosen norms and any words changed in its report.</p>
        <CsvOptions value={c} onChange={setC} />
        {err && <p className="report-error">{err}</p>}
        <div className="report-actions">
          <button type="button" className="primary" disabled={busy || !count} onClick={() => void go()}>Save…</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
