import { useCallback, useEffect, useState } from 'react';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { models, type AutoBestMap, type ModelRow } from '../ipc';
import { actionLabel, blocked, statusText } from './status';
import { useBusyRun } from './useBusyRun';
import { useModels } from './useModels';
import { AutoBestRow } from './AutoBestRow';
import { BaseSelect } from './BaseSelect';
import { PointCheckCounts } from './PointCheckCounts';
import type { BaseControl } from '../ai/useBase';

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="model-link">
      <input readOnly value={url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Copied' : 'Copy link'}</button>
    </span>
  );
}

/** Remove, Starts the tracing and Add downloaded file: runs the call, and a refusal reaches the screen (the words the app
 *  wrote, as they are), then the list is read again. Final review I1: this used to swallow the refusal. */
export function runAction(f: () => Promise<unknown>, setErr: (e: string | null) => void, onChanged: () => Promise<unknown>) {
  setErr(null);
  return f().catch((e) => setErr(String(e))).then(() => onChanged());
}

/** One catalogue model: its status, licence, and the buttons that fit its state (spec 2026-10-01 Part 1). */
export function Row({ r, progress, onChanged, setErr }: { r: ModelRow; progress: ReturnType<typeof useModels>['progress']; onChanged: () => Promise<unknown>; setErr: (e: string | null) => void }) {
  const [licence, setLicence] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const run = (f: () => Promise<unknown>) => { void runAction(f, setErr, onChanged); };
  const { pending, start } = useBusyRun(onChanged, setErr);   // Install: busy after one press, until the row has moved on
  const install = () => { if (r.licenceAccepted) start(() => models.install(r.id)); else setLicence(true); };
  return (
    <section className="model-row" data-id={r.id} aria-label={r.title}>
      <div className="model-head">
        <b>{r.title}</b>
        <span className="chip">{r.tier === 'standard' ? 'Standard' : 'Optional'}</span>
        {r.recommended && <span className="chip ok">recommended</span>}
        {r.licence.nonCommercial && <span className="chip warn">Non-commercial</span>}
        <span className="model-status">{statusText(r, progress[r.id])}</span>
      </div>
      <div className="identity-note">{r.citation} · ~{r.sizeMb} MB</div>
      <div className="identity-note">Code: {r.licence.code} · Weights: {r.licence.weights}</div>
      {r.status === 'ready' ? (
        <div className="row">
          <label><input type="radio" name="main-model" checked={r.main} onChange={() => run(() => models.setMain(r.id))} />Starts the tracing{r.recommended ? ' (recommended)' : ''}</label>
          <button type="button" onClick={async () => {
            if (await ask(`Remove ${r.title}? You can install it again later.`, { title: 'Remove model', kind: 'warning' })) run(() => models.remove(r.id));
          }}>Remove</button>
        </div>
      ) : r.status !== 'installing' && !licence && (
        <div className="row"><button type="button" disabled={pending} onClick={install}>{pending ? 'Starting…' : actionLabel(r)}</button></div>
      )}
      {licence && r.status !== 'ready' && (
        <div className="model-licence">
          <p>{r.licence.summary}</p>
          <CopyLink url={r.licence.url} />
          <label><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />I accept</label>
          <div className="row">
            <button type="button" onClick={() => setLicence(false)}>Cancel</button>
            <button type="button" className="primary" disabled={!accepted || pending}
              onClick={() => { setLicence(false); start(async () => { await models.acceptLicence(r.id); await models.install(r.id); }); }}>Install</button>
          </div>
        </div>
      )}
      {blocked(r) && (
        <div className="model-blocked">
          <p>Google Drive didn’t allow an automatic download. Download it yourself:</p>
          <CopyLink url={r.page} />
          <div className="row">
            <button type="button" onClick={async () => {
              const path = await open({ multiple: false, title: `The file you downloaded for ${r.title}` });
              if (typeof path === 'string') run(() => models.addFile(r.id, path));
            }}>Add downloaded file…</button>
          </div>
        </div>
      )}
      {r.status === 'failed' && !blocked(r) && r.error && <p className="error">{r.error}</p>}
      {r.status === 'ready' && r.notice && <p className="notice">{r.notice}</p>}
    </section>
  );
}

/** Library › Models…: install, remove and choose the main model (spec 2026-10-01 Part 1). */
export function ModelManager({ onClose, onLocateModel, base, onOpenBestModel }: { onClose: () => void; /** Resolves to why the folder was not used (shown here), or null. */ onLocateModel: () => Promise<string | null>;
  /** The one base state (App's `useBase`), shared with Settings › Best model; absent in older callers. Recent changes and
   *  Part F's table moved to Settings › Best model (spec 2026-10-29 §2), opened by `onOpenBestModel`. */
  base?: BaseControl; onOpenBestModel?: () => void }) {
  const { rows, progress, refresh, error } = useModels();
  const [err, setErr] = useState<string | null>(null);
  const [folderNote, setFolderNote] = useState<string | null>(null);
  const titleOf = useCallback((id: string) => rows.find((r) => r.id === id)?.title ?? id, [rows]);
  const [auto, setAuto] = useState<AutoBestMap | null>(null);
  const [autoErr, setAutoErr] = useState<string | null>(null);
  const readAuto = useCallback(() => {
    models.autoBest().then((m) => { setAuto(m ?? null); setAutoErr(null); }).catch((e) => setAutoErr(`Automatic best couldn't be read: ${String(e)}`));
  }, []);
  useEffect(readAuto, [readAuto, base?.base]);   // a change of base, from here or from Settings, is read again at once
  useEffect(() => { void base?.refresh(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- read the base again on every open (final review M7)
  const changed = useCallback(() => { readAuto(); return refresh(); }, [refresh, readAuto]);
  const act = (f: () => Promise<unknown>) => { setErr(null); f().catch((e) => setErr(`That was not saved: ${String(e)}`)).finally(changed); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div className="model-manager" role="dialog" aria-modal="true" aria-label="Models">
        <h2>Models</h2>
        <p className="identity-note">Models run on this Mac. Each is downloaded from its authors and checked; nothing is uploaded.</p>
        <AutoBestRow state={auto} error={autoErr} titleOf={titleOf} rows={rows} onOpenSettings={onOpenBestModel}
          baseSelect={base && <BaseSelect id="base-models" base={base.base} rows={rows} titleOf={titleOf} disabled={!rows.some((r) => r.status === 'ready')}
            onChoose={(id) => void base.choose(id, 'models')} error={base.errorFor('models')} />}
          onMain={() => act(() => models.setMain('auto-best'))} />
        {rows.map((r) => <Row key={r.id} r={r} progress={progress} onChanged={changed} setErr={setErr} />)}
        <PointCheckCounts />
        {(err ?? error) && <p className="error">{err ?? error}</p>}
        {folderNote && <p className="notice" role="status">{folderNote}</p>}
        <div className="row">
          <button type="button" onClick={() => { setFolderNote(null); void onLocateModel().then(setFolderNote).catch(() => {}); }}>Use a model folder…</button>
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
