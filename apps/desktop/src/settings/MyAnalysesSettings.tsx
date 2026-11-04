import { useEffect, useState } from 'react';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { ALL_ANALYSES, NO_LONGER_AVAILABLE, analysisFile, checkAnalysis, copyName, duplicateItems, exportFileName, isLive, parseAnalysisFile, type MyAnalysis, type NormSet } from '@ceph/analyses';
import { files, settings } from '../ipc';
import { MY_WORDS, deleteMyAnalysis, saveMyAnalysis } from './myAnalyses';
import { MyAnalysisEditor, type EditorDraft } from './MyAnalysisEditor';

const count = (n: number) => (n === 1 ? '1 measurement' : `${n} measurements`);

/** Settings › Analyses › Your analyses (owner B1/B2, 17 Oct 2026): this clinician's own analyses — New, Duplicate a
 *  built-in (built-ins stay read-only), Edit, Delete. Saved on this Mac under their name. */
export function MyAnalysesSettings({ clinician, list, error, sets, onSaved, onDeleted }: {
  clinician: string; list: MyAnalysis[]; error: string | null; sets: NormSet[];
  onSaved: (a: MyAnalysis, isNew: boolean) => void; onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dupFrom, setDupFrom] = useState(ALL_ANALYSES[0].id);
  useEffect(() => { setDraft(null); setNotice(null); }, [clinician]);
  if (!clinician) return <p className="hint">{MY_WORDS.noClinician}</p>;
  const locked = !!error;   // an unreadable stored list is never written over
  const taken = [...ALL_ANALYSES.map((a) => a.name), ...list.map((a) => a.name)];
  const startEdit = (d: EditorDraft, why: string | null = null) => { setSaveError(why); setNotice(null); setDraft(d); };
  const onSave = (d: EditorDraft) => {
    saveMyAnalysis(settings, clinician, d)
      .then((a) => { setDraft(null); setSaveError(null); setNotice(`“${a.name}” is saved.`); onSaved(a, d.id === null); })
      .catch((e) => setSaveError(e instanceof Error ? e.message : String(e)));
  };
  const onDelete = async (a: MyAnalysis) => {
    if (!(await ask(`Delete your analysis “${a.name}”? This cannot be undone.`, { title: 'Delete analysis', kind: 'warning' }))) return;
    deleteMyAnalysis(settings, clinician, a.id)
      .then(() => { setNotice(`“${a.name}” is deleted.`); onDeleted(a.id); })
      .catch((e) => setNotice(`It could not be deleted: ${e instanceof Error ? e.message : String(e)}`));
  };
  const FILTERS = [{ name: 'OpenCephAI analysis', extensions: ['json'] }];
  const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
  // Owner B4: share an analysis as a file — also how analyses move to a new Mac.
  const onExport = async (a: MyAnalysis) => {
    const path = await save({ title: `Export “${a.name}”`, defaultPath: exportFileName(a.name), filters: FILTERS });
    if (!path) return;
    try { await files.writeText(path, analysisFile(a)); setNotice(`“${a.name}” is exported to ${path}.`); }
    catch (e) { setNotice(`It could not be exported: ${reason(e)}`); }
  };
  const onImport = async () => {
    const path = await open({ title: 'Import an analysis', multiple: false, directory: false, filters: FILTERS });
    if (typeof path !== 'string') return;
    try {
      const p = parseAnalysisFile(await files.readText(path), sets);
      if (!p.ok) { setNotice(p.error); return; }
      const c = checkAnalysis(p, list, null);
      // A name already used (or too long): open it in the editor with the reason, to rename and save.
      if (!c.ok) { startEdit({ id: null, name: p.name, items: p.items }, c.error); return; }
      const a = await saveMyAnalysis(settings, clinician, { id: null, name: p.name, items: p.items });
      const gone = a.items.filter((i) => !isLive(i.id)).length;
      setNotice(`“${a.name}” is imported${gone ? `; ${gone} of its measurements are ${NO_LONGER_AVAILABLE} here` : ''}.`);
      onSaved(a, true);
    } catch (e) { setNotice(`It could not be imported: ${reason(e)}`); }
  };
  return (
    <section className="my-analyses" aria-label="Your analyses">
      <h3>Your analyses <span className="hint">({clinician})</span></h3>
      {error && <p className="hint warn" role="alert">{error}</p>}
      {notice && <p className="hint" role="status">{notice}</p>}
      {list.length === 0 && !draft && <p className="hint">None yet. Make one from the catalogue's measurements, or duplicate a built-in analysis.</p>}
      <ul className="my-list">{list.map((a) => {
        const gone = a.items.filter((i) => !isLive(i.id)).length;
        return (
          <li key={a.id} className="my-row" data-id={a.id}>
            <b>{a.name}</b> <span className="hint">{count(a.items.length - gone)}{gone ? `, ${gone} ${NO_LONGER_AVAILABLE}` : ''}</span>
            <button type="button" disabled={locked || !!draft} onClick={() => startEdit({ id: a.id, name: a.name, items: a.items })}>Edit…</button>
            <button type="button" disabled={!!draft} onClick={() => void onExport(a)}>Export…</button>
            <button type="button" disabled={locked || !!draft} onClick={() => void onDelete(a)}>Delete…</button>
          </li>);
      })}</ul>
      {!draft && <div className="row">
        <button type="button" disabled={locked} onClick={() => startEdit({ id: null, name: '', items: [] })}>New analysis…</button>
        <select aria-label="Built-in analysis to duplicate" value={dupFrom} onChange={(e) => setDupFrom(e.target.value)}>
          {ALL_ANALYSES.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button type="button" disabled={locked} onClick={() => { const a = ALL_ANALYSES.find((x) => x.id === dupFrom)!;
          startEdit({ id: null, name: copyName(a.name, taken), items: duplicateItems(a) }); }}>Duplicate</button>
        <button type="button" disabled={locked} onClick={() => void onImport()}>Import…</button>
      </div>}
      {draft && <MyAnalysisEditor key={`${clinician}:${draft.id ?? 'new'}`} initial={draft} sets={sets} error={saveError}
        onSave={onSave} onCancel={() => { setDraft(null); setSaveError(null); }} />}
    </section>
  );
}
