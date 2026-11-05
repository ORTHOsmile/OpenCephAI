// Task 9 review I3 (fix round 1), confirmed by probe: `flush` could return the PREVIOUS film's words when the
// film switches and the preview reopens while a save for the old film is still in flight (useReportWords.ts
// :17, 21, 24 before this fix) — one patient's changed Meaning could then land in another patient's PDF or CSV.
// This is the reviewer's own probe (`/tmp/rv9-zzReviewLeak.test.ts`, Task 9 review), committed. Same fake-hook
// harness as `useReport.flush.test.ts` (no jsdom in this repo); `saveWord` returns a single DEFERRED promise
// resolved by hand, so film A's save can be made to land AFTER film B's preview has already opened, on every run.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  let slots: unknown[] = [];
  let i = 0;
  let pending: Array<() => void> = [];
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  return {
    begin() { i = 0; },
    reset() { slots = []; i = 0; pending = []; },
    flushEffects() { while (pending.length) pending.shift()!(); },
    useState<T>(init: T | (() => T)) {
      const k = i++;
      if (!(k in slots)) slots[k] = typeof init === 'function' ? (init as () => T)() : init;
      return [slots[k] as T, (v: T | ((p: T) => T)) => { slots[k] = typeof v === 'function' ? (v as (p: T) => T)(slots[k] as T) : v; }] as const;
    },
    useRef<T>(init: T) { const k = i++; if (!(k in slots)) slots[k] = { current: init }; return slots[k] as { current: T }; },
    useMemo<T>(f: () => T, deps: unknown[]) {
      const k = i++; const s = slots[k] as { deps: unknown[]; v: T } | undefined;
      if (s && same(s.deps, deps)) return s.v;
      const v = f(); slots[k] = { deps, v }; return v;
    },
    useCallback<T>(f: T, deps: unknown[]) { return h.useMemo(() => f, deps); },
    useEffect(f: () => void | (() => void), deps?: unknown[]) {
      const k = i++; const s = slots[k] as { deps?: unknown[]; cleanup?: void | (() => void) } | undefined;
      if (s && deps && same(s.deps, deps)) return;
      const slot: { deps?: unknown[]; cleanup?: void | (() => void) } = { deps };
      pending.push(() => { if (s?.cleanup) s.cleanup(); slot.cleanup = f(); });
      slots[k] = slot;
    },
  };
});
vi.mock('react', () => ({ useState: h.useState, useRef: h.useRef, useMemo: h.useMemo, useCallback: h.useCallback, useEffect: h.useEffect }));

const d = vi.hoisted(() => {
  let resolve: (w: unknown) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  let promise = new Promise((r, j) => { resolve = r; reject = j; });
  return {
    get promise() { return promise; },
    resolve: (w: unknown) => resolve(w),
    reject: (e: unknown) => reject(e),
    reset() { promise = new Promise((r, j) => { resolve = r; reject = j; }); },
  };
});
vi.mock('./words', () => ({
  readWords: async () => ({ value: {}, error: null }),
  saveWord: vi.fn(() => d.promise),
  resetWord: vi.fn(() => d.promise),
}));

import { useReportWords } from './useReportWords';
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { h.reset(); d.reset(); });

describe('review I3 (deterministic): a save for film A landing after film B opens', () => {
  it('flush for B returns B\'s words, not A\'s', async () => {
    let id: string | null = 'A';
    const render = () => { h.begin(); const r = useReportWords(id); h.flushEffects(); return r; };
    render(); await tick();
    const a = render();
    a.save('steiner:m01', 'A words SYNTHETIC', 'usual');   // A's save in flight
    id = null; render();                                     // preview closed
    id = 'B'; render(); await tick();                        // B's preview opens, B's read lands ({})
    d.resolve({ 'steiner:m01': { text: 'A words SYNTHETIC', was: 'usual' } });   // A's save lands late
    await tick();
    const b = render();
    expect(b.words).toEqual({});                             // the screen shows B's (empty) words
    expect(await b.flush()).toEqual({});                     // ...and the export must too
  });

  // I3-b (review round 2): the write-gating half (above) is not the whole fix — `flush()`'s OWN reject branch
  // (useReportWords.ts:45) had no test of its own. Here `flush()` is called WHILE film A is still open (so it
  // captures caseId 'A'), the film then changes to B before A's own pending save settles, and the promise
  // `flush()` returned must reject — never resolve to A's (now foreign) words.
  it('flush() called for A rejects if the film changes to B before A\'s own save lands', async () => {
    let id: string | null = 'A';
    const render = () => { h.begin(); const r = useReportWords(id); h.flushEffects(); return r; };
    render(); await tick();
    const a = render();
    a.save('steiner:m01', 'A words SYNTHETIC', 'usual');   // A's save in flight
    const out = a.flush();                                  // called for A, while A is still the open film
    id = 'B'; render();                                      // the film changes to B before A's save lands
    d.resolve({ 'steiner:m01': { text: 'A words SYNTHETIC', was: 'usual' } });   // A's save lands only now
    await expect(out).rejects.toThrow(/open film changed/);
  });

  // Final review Minor 2: a failed save for a typed word must not let flush() silently hand back the OLD (usual)
  // words while the export goes on to say "saved" — the caller (useReport.ts) must find out the save failed.
  it('flush() rejects when the last save for this film failed, instead of resolving to the words it never wrote', async () => {
    let id: string | null = 'A';
    const render = () => { h.begin(); const r = useReportWords(id); h.flushEffects(); return r; };
    render(); await tick();
    const a = render();
    a.save('steiner:m01', 'typed but never saved', 'usual');
    d.reject(new Error('disk full'));
    await tick();
    const b = render();
    await expect(b.flush()).rejects.toThrow(/could not be saved/);
  });

  // Final review Minor 2, second half: the catch in `run` set `error` with no caseId check, so film A's failed
  // save could show its banner on film B's preview once B opened. Both the recorded failure (above) and the
  // on-screen error must be scoped to the case the save was actually for.
  it('a stale film\'s failed save does not show its banner on the next film\'s preview', async () => {
    let id: string | null = 'A';
    const render = () => { h.begin(); const r = useReportWords(id); h.flushEffects(); return r; };
    render(); await tick();
    const a = render();
    a.save('steiner:m01', 'A words SYNTHETIC', 'usual');   // A's save in flight
    id = null; render();                                     // preview closed
    id = 'B'; render(); await tick();                        // B's preview opens, B's read lands ({})
    d.reject(new Error('disk full'));                        // A's save fails late
    await tick();
    const b = render();
    expect(b.error).toBeNull();
  });
});
