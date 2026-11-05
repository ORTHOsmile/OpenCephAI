import type { settings } from '../ipc';

/** Owner R2 (17 Oct 2026): words the clinician changes in a report are kept with the film. Stored in the library's
 *  existing settings table, one key per film — `report_words:<caseId>` → { "<analysisId>:<node>": { text, was } } — the
 *  way NORM-PICK-1 keeps `norm_picks:<caseId>`: no library format change. `was` is the usual words the change replaced
 *  (see `shownMeaning`). */
export interface WordEdit { text: string; was: string }
export type ReportWords = Record<string, WordEdit>;
type Store = Pick<typeof settings, 'get' | 'set'>;

export const WORD_MAX = 300;
export const reportWordsKey = (caseId: string) => `report_words:${caseId}`;
export const wordKey = (analysisId: string, node: string) => `${analysisId}:${node}`;
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function parseWords(json: string | null): ReportWords {
  let v: unknown = null;
  try { v = json ? JSON.parse(json) : null; } catch { v = null; }
  const out: ReportWords = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
    if (!e || typeof e !== 'object') continue;
    const { text, was } = e as Record<string, unknown>;
    if (typeof text === 'string' && typeof was === 'string') out[k] = { text: text.slice(0, WORD_MAX), was };
  }
  return out;
}

export async function readWords(s: Pick<Store, 'get'>, caseId: string): Promise<{ value: ReportWords; error: string | null }> {
  try { return { value: parseWords(await s.get(reportWordsKey(caseId))), error: null }; }
  catch (e) { return { value: {}, error: `Your words for this report could not be read (${why(e)}); the usual words are shown.` }; }
}

// Changes run one after another (each reads, changes and writes back), so two made close together never overwrite
// each other (the same queue as settings/meanings.ts, review I-2).
let queue: Promise<unknown> = Promise.resolve();
function change(s: Store, caseId: string, f: (w: ReportWords) => void): Promise<ReportWords> {
  const run = async () => {
    const w = parseWords(await s.get(reportWordsKey(caseId)));
    f(w);
    await s.set(reportWordsKey(caseId), JSON.stringify(w));
    return w;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/** Keeps the clinician's words for one row with the words they replaced; typing the usual words back removes the change. */
export function saveWord(s: Store, caseId: string, key: string, text: string, was: string): Promise<ReportWords> {
  const t = text.trim().slice(0, WORD_MAX);
  return change(s, caseId, (w) => { if (t === was) delete w[key]; else w[key] = { text: t, was }; });
}
export const resetWord = (s: Store, caseId: string, key: string): Promise<ReportWords> => change(s, caseId, (w) => { delete w[key]; });

/** What the report prints: the clinician's words while the row still reads what they replaced; once it reads
 *  differently, the usual words, and the old change is offered back (`stale`) — never printed beside a changed value. */
export function shownMeaning(usual: string, edit: WordEdit | undefined): { text: string; edited: boolean; stale: WordEdit | null } {
  if (!edit) return { text: usual, edited: false, stale: null };
  if (edit.was === usual) return { text: edit.text, edited: true, stale: null };
  return { text: usual, edited: false, stale: edit };
}
