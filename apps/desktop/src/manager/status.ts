import type { ModelProgress, ModelRow } from '../ipc';
/** The Manager row's status line (spec Part 1): Not installed · Downloading n% · Checking · Converting · Ready · Failed. */
export function statusText(r: ModelRow, p?: ModelProgress | null): string {
  if (r.status === 'installing') {
    const stage = p?.id === r.id ? p.stage : r.stage;
    if (stage === 'downloading') return p?.fraction != null ? `Downloading ${Math.floor(p.fraction * 100)}%` : 'Downloading';
    return stage === 'converting' ? 'Converting' : 'Checking';
  }
  if (r.status === 'ready') return r.msPerFilm != null ? `Ready · ${(r.msPerFilm / 1000).toFixed(1)} s per film` : 'Ready';
  return r.status === 'failed' ? 'Failed' : 'Not installed';
}
export const blocked = (r: ModelRow) => r.status === 'failed' && r.error === 'DOWNLOAD_BLOCKED';
/** The button on a row that is not Ready or installing: a Failed row says Retry. */
export const actionLabel = (r: ModelRow): 'Install' | 'Retry' => (r.status === 'failed' ? 'Retry' : 'Install');
