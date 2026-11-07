import { ask, open } from '@tauri-apps/plugin-dialog';
import { checkModel, type CheckRow, type ModelProgress } from '../ipc';
import { CopyLink } from './CopyLink';
import { useBusyRun } from './useBusyRun';
import { CHECK_ID } from './useCheckModel';

/** The all-versions DOI the credit gives (never the version record the files come from). */
const DOI = /10\.5281\/zenodo\.\d+/;
const doiUrl = (citation: string) => { const m = DOI.exec(citation); return m ? `https://doi.org/${m[0]}` : null; };

/** What Remove asks. The check's own calibration files, if any sit in the same folder, are left alone. */
export const REMOVE_QUESTION = 'Remove the region finder? The whole-film check will not look at regions until it is downloaded again.';

/** The status line: Not installed, Downloading n%, Checking, Testing, Ready, Failed, Damaged. */
export function checkStatusText(r: CheckRow, p?: ModelProgress | null): string {
  if (r.status === 'installing') {
    const stage = p?.id === CHECK_ID ? p.stage : r.stage;
    if (stage === 'downloading') return p?.id === CHECK_ID && p.stage === 'downloading' && p.fraction != null ? `Downloading ${Math.floor(p.fraction * 100)}%` : 'Downloading';
    return stage === 'testing' ? 'Testing' : 'Checking';
  }
  if (r.status === 'ready') return r.byHand ? 'Ready (added by hand)' : 'Ready';
  if (r.status === 'failed') return 'Failed';
  if (r.status === 'damaged') return 'Damaged: download it again';
  return 'Not installed';
}

/** Models… › Whole-film check: the region finder the check needs, downloaded here from its author's Zenodo record, checked
 *  against the file this version was made for. `row` is null until it has been read. */
export function CheckModelRow({ row, progress, onChanged, setErr }: { row: CheckRow | null; progress: Record<string, ModelProgress>; onChanged: () => Promise<unknown>; setErr: (e: string | null) => void }) {
  const { pending, start } = useBusyRun(onChanged, setErr);
  if (!row) return <section className="model-row check-model-row" data-id={CHECK_ID} aria-label="Region finder for the whole-film check"><div className="identity-note">Reading…</div></section>;
  const doi = doiUrl(row.citation);
  const blocked = row.status === 'failed' && row.error === 'DOWNLOAD_BLOCKED';
  // A refusal reaches the screen in the app's own words, then the row is read again (as ModelManager's runAction).
  const run = (f: () => Promise<unknown>) => { setErr(null); void f().catch((e) => setErr(String(e))).then(() => onChanged()); };
  // Remove always asks first, in the app's own dialog (a damaged row too), and removes only the finder's own files.
  const confirmRemove = async () => {
    if (await ask(REMOVE_QUESTION, { title: 'Remove model', kind: 'warning' })) run(() => checkModel.remove());
  };
  const addFiles = async () => {
    const path = await open({ directory: true, multiple: false, title: 'The folder holding manifest.json and model.onnx' });
    if (typeof path === 'string') start(() => checkModel.addFiles(path));
  };
  const again = row.status === 'failed' || row.status === 'damaged';
  return (
    <section className="model-row check-model-row" data-id={CHECK_ID} aria-label={row.title}>
      <div className="model-head">
        <b>{row.title}</b>
        <span className="model-status">{checkStatusText(row, progress[CHECK_ID])}</span>
      </div>
      <div className="identity-note">{row.title}, by {row.author}, {row.licence}</div>
      <div className="identity-note">{row.citation} · ~{row.sizeMb} MB</div>
      {doi && <CopyLink url={doi} />}
      {row.status === 'ready' && <div className="row"><button type="button" onClick={() => void confirmRemove()}>Remove</button></div>}
      {row.status !== 'ready' && row.status !== 'installing' && (
        <div className="row">
          <button type="button" disabled={pending} onClick={() => start(() => checkModel.install())}>{pending ? 'Starting…' : again ? 'Retry' : 'Download'}</button>
          <button type="button" disabled={pending} onClick={() => void addFiles()}>Add files…</button>
          {row.status === 'damaged' && <button type="button" onClick={() => void confirmRemove()}>Remove</button>}
        </div>
      )}
      {row.status === 'failed' && (blocked
        ? <div className="model-blocked"><p>The download was not allowed automatically. Download manifest.json and model.onnx yourself from this page, put them in one folder, then press Add files…</p><CopyLink url={row.page} /></div>
        : row.error && <p className="error">{row.error}</p>)}
    </section>
  );
}
