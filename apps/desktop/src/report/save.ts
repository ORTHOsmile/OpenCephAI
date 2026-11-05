import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

/** Saving a report or CSV (spec 2026-10-17 report-exports): the save dialog, then `export_write` (src-tauri/src/export.rs),
 *  which refuses anything but .pdf/.csv outside the library folder. */
export type ExportKind = 'pdf' | 'csv';

export const withExtension = (path: string, kind: ExportKind): string =>
  new RegExp(`\\.${kind}$`, 'i').test(path) ? path : `${path}.${kind}`;

/** A default file name with nothing a Mac or Windows folder refuses (/ \ : * ? " < > | and control characters). */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const s = name.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).trim();
  return s || 'OpenCephAI export';
}

/** Asks where to save, then writes. false when the clinician cancelled; a failed write rejects with its message.
 *  `caseId`, for a film's PDF report: `export_write` records the report's date on that film (format 16, the Library
 *  table's Report column) only after the file is written — never on a cancel (no write is asked for) or a failed write. */
export async function chooseAndSave(kind: ExportKind, defaultName: string, bytes: Uint8Array, caseId?: string): Promise<boolean> {
  const picked = await save({
    defaultPath: withExtension(safeFileName(defaultName), kind),
    filters: [kind === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'CSV (Excel)', extensions: ['csv'] }],
  });
  if (!picked) return false;
  const path = encodeURIComponent(withExtension(picked, kind));
  await invoke('export_write', bytes, { headers: kind === 'pdf' && caseId ? { path, case: encodeURIComponent(caseId) } : { path } });
  return true;
}
