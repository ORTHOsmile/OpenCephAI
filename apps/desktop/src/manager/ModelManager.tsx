import { useEffect, useState } from 'react';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { models, type ModelRow } from '../ipc';
import { blocked, statusText } from './status';
import { useModels } from './useModels';

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="model-link">
      <input readOnly value={url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Copied' : 'Copy link'}</button>
    </span>
  );
}

/** One catalogue model: its status, licence, and the buttons that fit its state (spec 2026-10-01 Part 1). */
function Row({ r, progress, onChanged, setErr }: { r: ModelRow; progress: ReturnType<typeof useModels>['progress']; onChanged: () => void; setErr: (e: string | null) => void }) {
  const [licence, setLicence] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const run = (f: () => Promise<unknown>) => { setErr(null); f().catch(() => {}).finally(onChanged); };   // the row shows the failure
  const install = () => { if (r.licenceAccepted) run(() => models.install(r.id)); else setLicence(true); };
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
          <label><input type="radio" name="main-model" checked={r.main} onChange={() => run(() => models.setMain(r.id))} />Starts the tracing</label>
          <button type="button" onClick={async () => {
            if (await ask(`Remove ${r.title}? You can install it again later.`, { title: 'Remove model', kind: 'warning' })) run(() => models.remove(r.id));
          }}>Remove</button>
        </div>
      ) : r.status !== 'installing' && !licence && (
        <div className="row"><button type="button" onClick={install}>Install</button></div>
      )}
      {licence && r.status !== 'ready' && (
        <div className="model-licence">
          <p>{r.licence.summary}</p>
          <CopyLink url={r.licence.url} />
          <label><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />I accept</label>
          <div className="row">
            <button type="button" onClick={() => setLicence(false)}>Cancel</button>
            <button type="button" className="primary" disabled={!accepted}
              onClick={() => { setLicence(false); run(async () => { await models.acceptLicence(r.id); await models.install(r.id); }); }}>Install</button>
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
export function ModelManager({ onClose, onLocateModel }: { onClose: () => void; onLocateModel: () => void }) {
  const { rows, progress, refresh, error } = useModels();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div className="model-manager" role="dialog" aria-modal="true" aria-label="Models">
        <h2>Models</h2>
        <p className="identity-note">Models run on this Mac. Each is downloaded from its authors and checked; nothing is uploaded.</p>
        {rows.map((r) => <Row key={r.id} r={r} progress={progress} onChanged={refresh} setErr={setErr} />)}
        {(err ?? error) && <p className="error">{err ?? error}</p>}
        <div className="row">
          <button type="button" onClick={onLocateModel}>Use a model folder…</button>
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
