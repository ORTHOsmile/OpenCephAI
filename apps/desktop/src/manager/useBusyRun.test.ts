import { describe, it, expect, vi } from 'vitest';

// Leftovers Task 7: the Install button's busy state. No DOM renderer and no new dependency (as useModels.test.ts), so the
// hook runs in a minimal stand-in for React's hooks. The list re-read is held pending on purpose: with an instant refresh
// the row would already have moved on and a missing guard would pass for the wrong reason.
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
      useState: <T,>(init: T | (() => T)) => {
        const s = slot();
        if (!('v' in s)) s.v = typeof init === 'function' ? (init as () => T)() : init;
        return [s.v as T, (n: T | ((p: T) => T)) => { s.v = typeof n === 'function' ? (n as (p: T) => T)(s.v as T) : n; render(); }] as const;
      },
      useRef: <T,>(init: T) => { const s = slot(); if (!('v' in s)) s.v = { current: init }; return s.v as { current: T }; },
      useCallback: <F,>(fn: F, deps: unknown[]) => { const s = slot(); if (!same(s.deps, deps)) { s.v = fn; s.deps = deps; } return s.v as F; },
      useEffect: (fn: () => void, deps: unknown[]) => { const s = slot(); if (!same(s.deps, deps)) { s.deps = deps; effects.push(fn); } },
    },
    mount: <R,>(h: () => R) => { slots.length = 0; hook = h; render(); return () => result as R; },
  };
});
vi.mock('react', () => host.react);

import { useBusyRun } from './useBusyRun';

const settle = () => new Promise((r) => setTimeout(r, 0));
const hold = () => { let go: () => void = () => {}; const p = new Promise<void>((r) => { go = r; }); return { p, go }; };

describe('useBusyRun', () => {
  it('a double click starts one install and the button stays busy while the install and the re-read are out', async () => {
    const install = vi.fn(() => new Promise<void>(() => {}));   // never ends: the install is still running
    const cur = host.mount(() => useBusyRun(() => Promise.resolve(), () => {}));
    cur().start(install); cur().start(install);
    expect(install).toHaveBeenCalledTimes(1);
    expect(cur().pending).toBe(true);
  });
  it('stays busy after the call ends until the list has been re-read, then frees (Retry on a failure is possible)', async () => {
    const reread = hold(), onChanged = vi.fn(() => reread.p);
    const cur = host.mount(() => useBusyRun(onChanged, () => {}));
    cur().start(() => Promise.reject('Not enough disk space'));
    await settle();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(cur().pending).toBe(true);      // the list still shows the old row: no second press yet
    cur().start(() => Promise.resolve());
    expect(onChanged).toHaveBeenCalledTimes(1);
    reread.go(); await settle();
    expect(cur().pending).toBe(false);
    const again = vi.fn(() => Promise.resolve());
    cur().start(again);
    expect(again).toHaveBeenCalledTimes(1);   // Retry goes through
  });
  it('clears the earlier error when it starts', () => {
    const setErr = vi.fn();
    const cur = host.mount(() => useBusyRun(() => Promise.resolve(), setErr));
    cur().start(() => new Promise<void>(() => {}));
    expect(setErr).toHaveBeenCalledWith(null);
  });
});
