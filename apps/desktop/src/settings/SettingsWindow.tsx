import { useState, type ChangeEvent, type ReactNode } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { ALL_ANALYSES, OWN_NORMS_LABEL, populationsOffered, type LandmarkId, type MyAnalysis, type UserNorm } from '@ceph/analyses';
import { library } from '../ipc';
import { UNIT_SUFFIX, type Decimals } from '../format';
import type { useNorms } from '../norms/useNorms';
import { AnalysisBrowser } from '../analyses/AnalysisBrowser';
import { checkUserNorm, deleteSetRows, measurementLabel, MEASUREMENT_CHOICES, normSets, type UserNormDraft } from './userNorm';
import { normsErrorMessage } from '../norms/normCell';
import { MeaningsSettings } from './MeaningsSettings';
import type { Overrides } from './meanings';
import { FilmDetailsSettings } from './FilmDetailsSettings';
import type { useFilmDetailsOff } from './useFilmDetails';
import { MyAnalysesSettings } from './MyAnalysesSettings';
import type { useMyAnalyses } from './useMyAnalyses';
import type { DateFormat } from '../dates';
import { APP_VERSION, BUILD_DATE, versionLine } from '../version';

type Norms = ReturnType<typeof useNorms>;
const EMPTY_DRAFT: UserNormDraft = { setName: '', measurement: '', mean: '', sd: '', sourceNote: '' };

/** Settings ▸ Analyses (read-only catalogue browser) and Settings ▸ Norms (DEC-1's decimals control, owner addendum 2 I;
 *  the clinic default population, N6, and the clinician's own norms, Task 4 schema 9). One dialog, reached from the library
 *  and from the Sidebar (owner, 7 Oct). Every write that can fail (a user-norm save/delete, the clinic default)
 *  is shown on screen on failure — `useNorms`'s own `loadError`/`settingsError` cover the reads; this component
 *  covers the writes it makes itself. */
export type SettingsTab = 'analyses' | 'norms' | 'meanings' | 'filmText' | 'bestModel';
export function SettingsWindow({ tab: initialTab, found, norms, decimals, onDecimals, onClose, meanings, filmDetails, mine, onMineSaved, onMineDeleted, dateFormat, bestModel = null }: {
  tab: SettingsTab; found: ReadonlySet<LandmarkId> | null; norms: Norms;
  /** Settings › Best model (spec 2026-10-29 §2): App's `BestModelSettings`, which holds the shared base state. */
  bestModel?: ReactNode;
  /** Owner MEANING-PER-CLINICIAN (16 Oct) + NOCLIN-2 (17 Oct): the clinician Settings › Meanings edits (the
   *  top-bar choice, or the Mac login name) and their words, plus `referrerNote` when the open film is actually
   *  showing a different clinician's words (the referring practitioner's). */
  meanings: { clinician: string; overrides: Overrides; referrerNote?: string | null; refresh: () => void };
  /** Settings › Text on the film (Task 8, D-FIELDS-1). */
  filmDetails: ReturnType<typeof useFilmDetailsOff>;
  // Owner B1/B2 (17 Oct): this clinician's own analyses — Settings › Analyses › Your analyses (New, Duplicate,
  // Edit, Delete). A save shows the new/edited analysis at once; a delete leaves it off the shown list (App.tsx).
  mine: ReturnType<typeof useMyAnalyses>; onMineSaved: (a: MyAnalysis, isNew: boolean) => void; onMineDeleted: (id: string) => void;
  decimals: Decimals; onDecimals: (d: Decimals) => void; onClose: () => void;
  /** The operator's date format, for the build day in the version line at the foot (owner, 19 Oct). */
  dateFormat: DateFormat;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  // Final review M-5 (Task 10 M10): one source for the norm sets — `norms.sets` — never a second `sets` prop.
  const sets = norms.sets;
  // P18: a fresh draft every time Settings opens — this component unmounts with the dialog, so a new instance
  // (and a new useState) is created each time `onClose`/reopen happens; no draft ever survives a close.
  const [draft, setDraft] = useState<UserNormDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const setField = (k: keyof UserNormDraft) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const [notice, setNotice] = useState<string | null>(null);
  const selectedUnit = MEASUREMENT_CHOICES.find((m) => m.id === draft.measurement)?.unit;
  const unitWords = selectedUnit === undefined ? '' : selectedUnit === '' ? 'ratio' : UNIT_SUFFIX[selectedUnit].trim();

  // Minor (ruling, 12 Oct, "the clinic default cleared" smoke's own case): deleting a set the clinic default
  // points at leaves it dangling — `populationsOffered` would no longer list it. Checked generically (never a
  // hardcoded "user:" prefix, which `resolve.ts` keeps private) against what IS still offered after the change.
  const clearDanglingDefault = async (remaining: UserNorm[]): Promise<boolean> => {
    if (norms.clinicDefault && !populationsOffered(sets, remaining).some((p) => p.id === norms.clinicDefault)) {
      await norms.setClinicDefault(null);
      return true;
    }
    return false;
  };
  const onSave = async () => {
    const r = checkUserNorm(draft);
    if (!r.ok) { setError(r.error); setNotice(null); return; }
    try { await library.saveUserNorm(r.norm); setError(null); setNotice(null); setDraft(EMPTY_DRAFT); norms.refresh(); }
    catch (e) { setError(String(e)); }
  };
  const onDeleteRow = async (n: UserNorm) => {
    try {
      await library.deleteUserNorm(n.setName, n.measurement);
      const remaining = norms.userNorms.filter((x) => !(x.setName === n.setName && x.measurement === n.measurement));
      const cleared = await clearDanglingDefault(remaining);
      setError(null);
      setNotice(cleared ? `“${n.setName}” had no norms left, so it was removed and the clinic default is now cleared.` : null);
      norms.refresh();
    } catch (e) { setError(String(e)); }
  };
  const onDeleteSet = async (setName: string, rows: UserNorm[]) => {
    if (!(await ask(`Delete the norm set “${setName}” and all its measurements? This cannot be undone.`, { title: 'Delete set', kind: 'warning' }))) return;
    // Final review M-5 (Task 10 M4): a failure part-way says how many went; the list is refreshed whatever happened.
    try {
      const partial = await deleteSetRows(library.deleteUserNorm, setName, rows);
      if (partial) { setError(partial); setNotice(null); return; }
      const remaining = norms.userNorms.filter((n) => n.setName !== setName);
      const cleared = await clearDanglingDefault(remaining);
      setError(null);
      setNotice(cleared ? `“${setName}” is deleted, and it was the clinic default, so the default is now cleared.` : null);
    } catch (e) { setError(String(e)); }
    finally { norms.refresh(); }
  };
  const onClinicDefault = async (value: string) => {
    try { await norms.setClinicDefault(value || null); setError(null); setNotice(null); }
    catch (e) { setError(String(e)); }
  };

  const setNames = [...new Set(norms.userNorms.map((n) => n.setName))];
  const populations = populationsOffered(sets, norms.userNorms);
  const grouped = normSets(norms.userNorms);

  return (
    <div className="modal-backdrop">
      <div className="settings-window" role="dialog" aria-modal="true" aria-label="Settings">
        <h2>Settings</h2>
        <div role="tablist" className="tabs">
          <button type="button" role="tab" aria-selected={tab === 'analyses'} onClick={() => setTab('analyses')}>Analyses</button>
          <button type="button" role="tab" aria-selected={tab === 'norms'} onClick={() => setTab('norms')}>Norms</button>
          <button type="button" role="tab" aria-selected={tab === 'meanings'} onClick={() => setTab('meanings')}>Meanings</button>
          <button type="button" role="tab" aria-selected={tab === 'filmText'} onClick={() => setTab('filmText')}>Text on the film</button>
          <button type="button" role="tab" aria-selected={tab === 'bestModel'} onClick={() => setTab('bestModel')}>Best model</button>
        </div>
        {tab === 'bestModel' && bestModel}
        {tab === 'meanings' && <MeaningsSettings clinician={meanings.clinician} overrides={meanings.overrides} referrerNote={meanings.referrerNote} onChanged={meanings.refresh} />}
        {tab === 'filmText' && <FilmDetailsSettings filmDetails={filmDetails} />}
        {tab === 'analyses' && (
          <div className="settings-analyses">
            <MyAnalysesSettings clinician={mine.clinician} list={mine.list} error={mine.error} sets={sets} onSaved={onMineSaved} onDeleted={onMineDeleted} />
            <h3>All analyses</h3>
            <AnalysisBrowser analyses={[...ALL_ANALYSES, ...mine.defs]} found={found} placed={null} sets={sets} />
          </div>
        )}
        {tab === 'norms' && (
          <div className="settings-norms">
            {/* Final review M-5: both read failures, through the Inspector's own wording (never one hiding the other). */}
            {normsErrorMessage(norms.loadError, norms.settingsError) && <div className="error">{normsErrorMessage(norms.loadError, norms.settingsError)}</div>}
            {/* DEC-1 (12 Oct); on the Norms page since owner addendum 2 I (19 Oct 2026) — the same setting and stored value: display only — every calculation
                (colour, z-score, comparisons) always uses the full figures; this changes only how numbers are
                shown, and takes effect immediately (App.tsx's `decimals` state), without reopening the case. */}
            <label className="dec-control">Decimals shown
              <select value={decimals} onChange={(e) => onDecimals(Number(e.target.value) as Decimals)}>
                {([0, 1, 2, 3] as const).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label>Clinic default population
              <select value={norms.clinicDefault ?? ''} onChange={(e) => void onClinicDefault(e.target.value)}>
                <option value="">Not set</option>
                {populations.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            {/* Owner decision 2 (29 Oct 2026; spec 2026-10-29 §4.3): the default stays per library, as stored; only its words change. */}
            {/* Owner R3 (3 Nov 2026; spec 2026-11-03 §8.3). */}
            <p className="hint">Auto uses: the patient's background, else this default, else for patients 18 and over (or with no age entered) a combined adult norm (every adult study, weighted by size, men and women separately) and for children the largest study for their sex and age.
              Cases switched to Auto at the upgrade follow this rule too. Only cases you put back on "Clinic default (as before the upgrade)" use {OWN_NORMS_LABEL} when this is not set.</p>
            <div className="user-norm-editor">
              <h3>Add a norm</h3>
              <label>Set name
                <input list="existing-set-names" value={draft.setName} onChange={setField('setName')} />
              </label>
              <datalist id="existing-set-names">{setNames.map((n) => <option key={n} value={n} />)}</datalist>
              <label>Measurement
                <select value={draft.measurement} onChange={setField('measurement')}>
                  <option value="">—</option>
                  {MEASUREMENT_CHOICES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <label>Mean{unitWords && ` (${unitWords})`}
                <input value={draft.mean} onChange={setField('mean')} />
              </label>
              <label>SD{unitWords && ` (${unitWords})`}
                <input value={draft.sd} onChange={setField('sd')} placeholder="blank = no SD, no colour" />
              </label>
              <label>Where it comes from
                <input value={draft.sourceNote} onChange={setField('sourceNote')} />
              </label>
              {error && <div role="alert">{error}</div>}
              {!error && notice && <p className="hint" role="status">{notice}</p>}
              <div className="row">
                <button type="button" className="primary" onClick={() => void onSave()}>Save norm</button>
              </div>
            </div>
            {grouped.length === 0
              ? <p className="hint">No user norms yet.</p>
              : grouped.map(({ setName, rows }) => (
                  <div key={setName} className="user-norm-set">
                    <div className="set-head"><h4>{setName}</h4>
                      <button type="button" onClick={() => void onDeleteSet(setName, rows)}>Delete set…</button></div>
                    <table>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.measurement}>
                            <td>{measurementLabel(r.measurement)}</td>
                            <td>{r.mean}</td>
                            <td>{r.sd ?? '—'}</td>
                            <td>{r.sourceNote}</td>
                            <td><button type="button" onClick={() => void onDeleteRow(r)}>Delete</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              ))}
          </div>
        )}
        <div className="row">
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </div>
        <p className="settings-version">{versionLine(APP_VERSION, BUILD_DATE, dateFormat)}</p>
      </div>
    </div>
  );
}
