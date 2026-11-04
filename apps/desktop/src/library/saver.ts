import type { CaseEdit } from '../ipc';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

/**
 * Debounced autosave (§3.2). Each edit carries its case id, so opening another case writes the pending edit to the case
 * it belongs to straight away. Writes run one at a time, in order. An edit identical to the last one written for that
 * case (or to what was just loaded, via prime) is skipped. A failed write is kept per case and retried by every later
 * flush until it is written or a newer edit of the same case replaces it; the status stays "error" until then.
 */
export function createSaver(save: (e: CaseEdit) => Promise<unknown>, onStatus: (s: SaveStatus, error?: string) => void, delayMs = 600) {
  let pending: CaseEdit | null = null, timer: ReturnType<typeof setTimeout> | null = null, chain: Promise<void> = Promise.resolve();
  let lastError = '';
  const written = new Map<string, string>(), failed = new Map<string, CaseEdit>();
  const settle = () => { if (failed.size) onStatus('error', lastError); else onStatus(pending ? 'pending' : 'saved'); };
  /** A retry runs only if its edit is still the case's newest unsaved one. */
  const write = (e: CaseEdit, retry = false): void => {
    chain = chain.then(async () => {
      if (retry && failed.get(e.id) !== e) return;
      const key = JSON.stringify(e);
      if (written.get(e.id) === key) { failed.delete(e.id); settle(); return; }
      onStatus('saving');
      try { await save(e); written.set(e.id, key); failed.delete(e.id); }
      catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!(pending && pending.id === e.id)) failed.set(e.id, e);       // a newer pending edit of this case supersedes it
      }
      settle();
    });
  };
  const api = {
    /** The state just loaded from the library is already on disk: don't write it back. */
    prime(e: CaseEdit) { written.set(e.id, JSON.stringify(e)); },
    schedule(e: CaseEdit) {
      if (pending && pending.id !== e.id) void api.flush();
      if (!pending && written.get(e.id) === JSON.stringify(e)) return;
      pending = e; onStatus('pending');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void api.flush(); }, delayMs);
    },
    /** Writes the pending edit and retries every failed one; resolves true when everything is on disk. */
    flush(): Promise<boolean> {
      if (timer) { clearTimeout(timer); timer = null; }
      const e = pending; pending = null;
      for (const f of [...failed.values()]) if (!e || f.id !== e.id) write(f, true);
      if (e) { failed.delete(e.id); write(e); }
      return chain.then(() => failed.size === 0);
    },
  };
  return api;
}
