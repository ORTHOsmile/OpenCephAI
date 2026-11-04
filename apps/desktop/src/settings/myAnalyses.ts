import { MY_PREFIX, checkAnalysis, newAnalysisId, type MyAnalysis, type MyItem } from '@ceph/analyses';

/** Owner B2 (17 Oct 2026): each clinician's own analyses, saved on this Mac under their name — the same place and
 *  pattern as their meaning words (meanings.ts): the app settings, key `my_analyses:<clinician>`. No clinician chosen:
 *  nothing is saved or shown. No library format change (the settings table exists since format 1). */
interface Store { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<void> }

export const STORE_VERSION = 1;
export const myAnalysesKey = (clinician: string): string | null => (clinician.trim() ? `my_analyses:${clinician}` : null);
export const MY_WORDS = {
  unreadable: 'Your analyses could not be read, so nothing will be saved over them.',
  newer: 'Your analyses were saved by a newer OpenCephAI, so nothing will be saved over them. Update the app.',
  noClinician: 'Choose who is tracing (top bar) to keep your own analyses.',
} as const;

/** Unreadable (not JSON, the wrong shape) or newer: an error, so no write ever replaces it. A malformed analysis inside
 *  a readable list is left out and the rest kept (the meanings' review M-3: never a crash). Unknown measurement ids are
 *  KEPT: they show as "no longer available" (spec edge case). */
export function parseStored(json: string | null): { list: MyAnalysis[]; error: string | null } {
  if (json === null || !json.trim()) return { list: [], error: null };
  let v: unknown;
  try { v = JSON.parse(json); } catch { return { list: [], error: MY_WORDS.unreadable }; }
  const o = v as { version?: unknown; analyses?: unknown } | null;
  if (!o || typeof o !== 'object' || typeof o.version !== 'number' || !Array.isArray(o.analyses)) return { list: [], error: MY_WORDS.unreadable };
  if (o.version > STORE_VERSION) return { list: [], error: MY_WORDS.newer };
  const list: MyAnalysis[] = [];
  for (const a of o.analyses as unknown[]) {
    const x = (a ?? {}) as { id?: unknown; name?: unknown; items?: unknown };
    if (typeof x.id !== 'string' || !x.id.startsWith(MY_PREFIX) || typeof x.name !== 'string' || !x.name.trim() || !Array.isArray(x.items)) continue;
    if (list.some((y) => y.id === x.id)) continue;
    const items: MyItem[] = (x.items as unknown[]).flatMap((i) => {
      const it = (i ?? {}) as { id?: unknown; from?: unknown };
      return typeof it.id === 'string' && it.id ? [{ id: it.id, from: typeof it.from === 'string' ? it.from : '' }] : [];
    });
    list.push({ id: x.id, name: x.name, items });
  }
  return { list, error: null };
}
export const storedJson = (list: MyAnalysis[]): string => JSON.stringify({ version: STORE_VERSION, analyses: list });

export async function readMyAnalyses(s: Pick<Store, 'get'>, clinician: string): Promise<{ list: MyAnalysis[]; error: string | null }> {
  const key = myAnalysesKey(clinician);
  if (!key) return { list: [], error: null };
  try { return parseStored(await s.get(key)); }
  catch (e) { return { list: [], error: `Your analyses could not be read (${e instanceof Error ? e.message : String(e)}).` }; }
}

// As the meanings' review I-2: writes run one after another, each reading what is stored first, so two made close
// together never overwrite each other. A stored list that cannot be read is never written over.
let queue: Promise<unknown> = Promise.resolve();
function write<T>(s: Store, clinician: string, change: (list: MyAnalysis[]) => { list: MyAnalysis[]; out: T }): Promise<T> {
  const run = async () => {
    const key = myAnalysesKey(clinician);
    if (!key) throw new Error(MY_WORDS.noClinician);
    const r = parseStored(await s.get(key));
    if (r.error) throw new Error(r.error);
    const { list, out } = change(r.list);
    await s.set(key, storedJson(list));
    return out;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

export interface Draft { id: string | null; name: string; items: MyItem[] }

/** Saves a new (id null) or edited analysis after `checkAnalysis`; rejects with its words (nothing written). */
export const saveMyAnalysis = (s: Store, clinician: string, d: Draft): Promise<MyAnalysis> =>
  write(s, clinician, (list) => {
    const c = checkAnalysis(d, list, d.id);
    if (!c.ok) throw new Error(c.error);
    const saved: MyAnalysis = { id: d.id ?? newAnalysisId(list.map((a) => a.id)), name: c.name, items: d.items.map((i) => ({ id: i.id, from: i.from })) };
    const at = list.findIndex((a) => a.id === saved.id);
    return { list: at >= 0 ? list.map((a, i) => (i === at ? saved : a)) : [...list, saved], out: saved };
  });

export const deleteMyAnalysis = (s: Store, clinician: string, id: string): Promise<void> =>
  write(s, clinician, (list) => ({ list: list.filter((a) => a.id !== id), out: undefined }));
