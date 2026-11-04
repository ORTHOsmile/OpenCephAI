import { describe, it, expect, vi } from 'vitest';

// Final review M2: useMyAnalyses lets only the LATEST read land (`mine === seq.current`). Two reads for the same
// clinician that resolve out of order must leave the newer list on screen, never the older one.
//
// The app has no DOM test renderer (and no new dependencies are allowed), so this file hosts the hook in a minimal,
// deterministic stand-in for React's hooks: state and refs kept in slots by call order, callbacks and memos by their
// deps, effects run after each render when their deps change. The hook's own code runs unchanged.
const host = vi.hoisted(() => {
  type Slot = { v?: unknown; deps?: unknown[] };
  const slots: Slot[] = [];
  let i = 0, rendering = false;
  let effects: (() => void)[] = [];
  let hook: (() => unknown) | null = null, result: unknown = null;
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const slot = () => (slots[i] ??= {}, slots[i++]);
  const render = () => {
    if (rendering || !hook) return;
    rendering = true; i = 0; effects = [];
    result = hook();
    rendering = false;
    for (const e of effects) e();
  };
  return {
    react: {
      useState: <T,>(init: T) => {
        const s = slot();
        if (!('v' in s)) s.v = init;
        return [s.v as T, (n: T) => { s.v = n; render(); }] as const;
      },
      useRef: <T,>(init: T) => { const s = slot(); if (!('v' in s)) s.v = { current: init }; return s.v as { current: T }; },
      useCallback: <F,>(fn: F, deps: unknown[]) => { const s = slot(); if (!same(s.deps, deps)) { s.v = fn; s.deps = deps; } return s.v as F; },
      useMemo: <T,>(fn: () => T, deps: unknown[]) => { const s = slot(); if (!same(s.deps, deps)) { s.v = fn(); s.deps = deps; } return s.v as T; },
      useEffect: (fn: () => void, deps: unknown[]) => { const s = slot(); if (!same(s.deps, deps)) { s.deps = deps; effects.push(fn); } },
    },
    mount: <R,>(h: () => R) => { slots.length = 0; hook = h; render(); return () => result as R; },
  };
});
vi.mock('react', () => host.react);

// Each settings read waits until the test resolves it, so the order the reads land in is the test's choice.
const reads = vi.hoisted(() => [] as { key: string; resolve: (json: string | null) => void }[]);
vi.mock('../ipc', () => ({
  settings: { get: (key: string) => new Promise<string | null>((resolve) => { reads.push({ key, resolve }); }) },
}));

import { useMyAnalyses } from './useMyAnalyses';

const DEMO = 'Dr Demo SYNTHETIC';
const stored = (name: string) => JSON.stringify({ version: 1, analyses: [{ id: 'my:a', name, items: [{ id: 'm01_SNA', from: 'steiner' }] }] });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('useMyAnalyses: only the latest read lands (the seq guard)', () => {
  it('two reads for the same clinician resolving out of order: the newer list is shown, never the older', async () => {
    const current = host.mount(() => useMyAnalyses(DEMO));
    expect(reads.map((r) => r.key)).toEqual([`my_analyses:${DEMO}`]);   // the first read, on mount
    reads[0].resolve(stored('First SYNTHETIC')); await settle();
    expect(current().list.map((a) => a.name)).toEqual(['First SYNTHETIC']);

    current().refresh();   // an older read (for example before a save) …
    current().refresh();   // … and a newer one (after the save)
    expect(reads).toHaveLength(3);
    reads[2].resolve(stored('New SYNTHETIC')); await settle();
    reads[1].resolve(stored('Old SYNTHETIC')); await settle();   // the older read arrives last

    expect(current().list.map((a) => a.name)).toEqual(['New SYNTHETIC']);
    expect(current().defs.map((d) => d.name)).toEqual(['New SYNTHETIC']);
  });
});
