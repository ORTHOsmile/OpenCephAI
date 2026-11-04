import { ALL_ANALYSES } from './analyses';
import { byId, CATALOGUE } from './catalogue';
import type { NormSet } from './norms/types';
import { isLive, originFor, type MyAnalysis, type MyItem } from './custom';

/** Owner B4 (17 Oct 2026): one analysis as a file, to share with another clinic or move to a new Mac. Labels are for
 *  people reading the file; import ignores them (today's catalogue labels are used). */
export const ANALYSIS_FILE_FORMAT = 'opencephai-analysis';
export const ANALYSIS_FILE_VERSION = 1;
export const FILE_WORDS = {
  notOurs: 'This file is not an OpenCephAI analysis.',
  newer: 'This analysis was saved by a newer OpenCephAI. Update the app, then import it again.',
  nothingKnown: "None of this file's measurements are in this app's catalogue, so there is nothing to import.",
} as const;

export function analysisFile(a: MyAnalysis): string {
  const items = a.items.map((i) => ({ id: i.id, label: isLive(i.id) ? byId(i.id).label : null, from: i.from }));
  return `${JSON.stringify({ format: ANALYSIS_FILE_FORMAT, version: ANALYSIS_FILE_VERSION, name: a.name, items }, null, 2)}\n`;
}

export type ParsedFile = { ok: true; name: string; items: MyItem[] } | { ok: false; error: string };

/** A catalogue id: `m<number>_<1-60 word characters>`, as every `CATALOGUE` entry's `id` is shaped (`custom-file.test.ts`
 *  m6). Anything else is not a ceiling measurement id and is skipped rather than kept as "no longer available". */
const ID_SHAPE = /^m\d+_\w{1,60}$/;

/** `from` is kept when it is '' AND this app would also choose none (`originFor` gives ''), or when it names a
 *  built-in that lists the measurement; otherwise this app's own choice (`originFor`). A kept `''` that this app
 *  would NOT itself choose (preflight review I1) would show no own-analysis norm where Settings never could, so it
 *  is replaced the same as an unknown `from`. Unknown measurements are kept (shown "no longer available"); a file
 *  with none this app knows, or with far more items than the catalogue could ever hold (m6), is refused. The name is
 *  checked by `checkAnalysis` when it is saved (too long, already used). */
export function parseAnalysisFile(text: string, sets: NormSet[]): ParsedFile {
  let v: unknown;
  // A UTF-8 BOM (older Windows Notepad) must not read as "not an analysis" (m4).
  try { v = JSON.parse(text.replace(/^﻿/, '')); } catch { return { ok: false, error: FILE_WORDS.notOurs }; }
  const o = (v ?? {}) as { format?: unknown; version?: unknown; name?: unknown; items?: unknown };
  if (typeof v !== 'object' || o.format !== ANALYSIS_FILE_FORMAT || typeof o.name !== 'string' || !Array.isArray(o.items))
    return { ok: false, error: FILE_WORDS.notOurs };
  // Versions 0.5 and -3 must not silently read as v1 (m5).
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) return { ok: false, error: FILE_WORDS.notOurs };
  if (o.version > ANALYSIS_FILE_VERSION) return { ok: false, error: FILE_WORDS.newer };
  // An unbounded junk list (m6) is refused outright rather than kept as thousands of "no longer available" rows.
  if (o.items.length > 2 * CATALOGUE.length) return { ok: false, error: FILE_WORDS.notOurs };
  const items: MyItem[] = [], seen = new Set<string>();
  for (const x of o.items as unknown[]) {
    const { id, from } = (x ?? {}) as { id?: unknown; from?: unknown };
    if (typeof id !== 'string' || !ID_SHAPE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const lists = (a: string) => ALL_ANALYSES.some((b) => b.id === a && b.measurements.some((m) => m.node === id));
    const ok = typeof from === 'string' && (from === '' ? originFor(id, sets) === '' : lists(from));
    items.push({ id, from: ok ? from : originFor(id, sets) });
  }
  if (!items.some((i) => isLive(i.id))) return { ok: false, error: FILE_WORDS.nothingKnown };
  return { ok: true, name: o.name, items };
}

/** Windows device names that stay invalid even with an extension appended (F19). Checked case-insensitively on the
 *  cleaned name, before the extension is added. */
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** A file name that is safe on macOS and Windows (no \ / : * ? " < > | or control characters; not hidden; never
 *  blank; not a Windows reserved device name — reserved even before the first dot, e.g. `con.x` (m9)). */
export function exportFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const base = safe || 'analysis';
  return `${RESERVED_NAMES.test(base.split('.')[0]) ? `_${base}` : base}.analysis.json`;
}
