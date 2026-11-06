import { useCallback, useEffect, useState } from 'react';
import { library, type WholeSwitch } from '../ipc';

/** Settings › Checks, the switch (owner ruling 5 Nov 2026, SC-1 Part 1b): "Whole-film check (beta)", with one plain line
 *  under it giving the PKU result (or "Not yet tested on new films."). The default and the line come from the back end
 *  (`src-tauri/src/whole_film.rs` `PKU_RESULT`); this file holds neither. Off stops the check and its note; it deletes nothing. */
export const WHOLE_SWITCH_LABEL = 'Whole-film check (beta)';
/** Owner ruling 6 Nov 2026: the second, research switch beside it. Off by default; remembered per Mac in this settings key ('1' / '0'). */
export const WHOLE_IN_REPORTS_LABEL = 'Include the whole-film check in reports and CSV (research)';
export const WHOLE_IN_REPORTS_KEY = 'whole_film_in_reports';

/** The view, hook-free: nothing read yet (`state` null) shows a disabled box. */
export function WholeFilmSettingsView({ state, error, onChange, inReports = false, onInReports }: { state: WholeSwitch | null; error: string | null; onChange: (on: boolean) => void;
  inReports?: boolean; onInReports?: (on: boolean) => void }) {
  return (
    <div className="settings-checks">
      <label className="whole-film-switch">
        <input type="checkbox" checked={!!state?.on} disabled={!state} onChange={(e) => onChange(e.target.checked)} />
        {' '}{WHOLE_SWITCH_LABEL}
      </label>
      {state && <p className="hint whole-film-switch-line">{state.line}</p>}
      <label className="whole-film-in-reports">
        <input type="checkbox" checked={inReports} disabled={!onInReports} onChange={(e) => onInReports?.(e.target.checked)} />
        {' '}{WHOLE_IN_REPORTS_LABEL}
      </label>
      <p className="hint">Off: the PDF report and the CSV leave the whole-film check out. On: they show its result, and the points CSV adds each landmark's region result (fine, region flagged or not checked).</p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** Writes the switch through the command, then tells the open film to read its note again. A failed write throws (nothing re-read). */
export async function applyWholeSwitch(lib: { wholeFilmSwitchSet: (on: boolean) => Promise<WholeSwitch> }, on: boolean, onChanged: () => void): Promise<WholeSwitch> {
  const s = await lib.wholeFilmSwitchSet(on);
  onChanged();
  return s;
}

/** The tab, wired: reads the switch when it opens, writes it on a change. `onChanged` makes App read the open film's note again. */
export function WholeFilmSettings({ onChanged, inReports = false, onInReports }: { onChanged: () => void; inReports?: boolean; onInReports?: (on: boolean) => void }) {
  const [state, setState] = useState<WholeSwitch | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    library.wholeFilmSwitch().then((s) => { if (live) setState(s); }).catch((e) => { if (live) setError(`The setting could not be read: ${String(e)}`); });
    return () => { live = false; };
  }, []);
  const change = useCallback((on: boolean) => {
    applyWholeSwitch(library, on, onChanged).then((s) => { setState(s); setError(null); }).catch((e) => setError(`The setting could not be saved: ${String(e)}`));
  }, [onChanged]);
  return <WholeFilmSettingsView state={state} error={error} onChange={change} inReports={inReports} onInReports={onInReports} />;
}
