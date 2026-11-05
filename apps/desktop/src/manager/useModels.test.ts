import { describe, it, expect, vi, beforeEach } from 'vitest';

// Leftovers Task 3, fix round 1: the install-event path of useModels. An install's last event is 'ready' or 'failed':
// both re-read the list; only 'ready' calls `onReady` (Automatic best's first-open step runs again). Any other stage
// marks the row 'installing'. SYNTHETIC rows. Positive control: let the `else` bind to the `ready` check (the first,
// buggy grouping) -> the 'failed' test fails (the row reads 'installing').
//
// No DOM test renderer and no new dependencies, so (as in useMyAnalyses.test.ts) the hook runs in a minimal stand-in
// for React's hooks: state and refs in slots by call order, callbacks by deps, effects after each render.
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

// The one 'models://progress' listener the hook registers; the test sends events through it.
const bus = vi.hoisted(() => ({ handler: null as ((e: { payload: unknown }) => void) | null, event: '' }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) => { bus.event = event; bus.handler = handler; return Promise.resolve(() => {}); },
}));
const ipc = vi.hoisted(() => ({ models: { list: (() => Promise.resolve([])) as () => Promise<unknown[]> } }));
vi.mock('../ipc', () => ipc);

import { useModels } from './useModels';

const row = (status: string) => ({ id: 'aariz-cepha29', title: 'Aariz SYNTHETIC', status, stage: null });
const settle = () => new Promise((r) => setTimeout(r, 0));
const send = (stage: string) => bus.handler!({ payload: { id: 'aariz-cepha29', stage, fraction: null } });

describe('useModels: the install events (leftovers Task 3, fix round 1)', () => {
  let list: ReturnType<typeof vi.fn>;
  let onReady: ReturnType<typeof vi.fn>;
  let current: () => ReturnType<typeof useModels>;
  beforeEach(async () => {
    bus.handler = null;
    list = vi.fn().mockResolvedValue([row('not-installed')]);
    ipc.models.list = list as unknown as () => Promise<unknown[]>;
    onReady = vi.fn();
    current = host.mount(() => useModels(onReady as unknown as (id: string) => void));
    await settle();
    expect(bus.event).toBe('models://progress');
    expect(list).toHaveBeenCalledTimes(1);   // on mount
  });
  it("a 'failed' event re-reads the list and does not mark the row installing (nor call onReady)", async () => {
    // The re-read waits until the test lets it land, so the row's state straight after the event is seen (with the
    // buggy grouping it read 'installing' until the list came back, and for good if the re-read failed).
    let land: (r: unknown[]) => void = () => {};
    list.mockReturnValue(new Promise<unknown[]>((r) => { land = r; }));
    send('failed'); await settle();
    expect(list).toHaveBeenCalledTimes(2);
    expect(current().rows.map((r) => r.status)).toEqual(['not-installed']);
    land([row('failed')]); await settle();
    expect(current().rows.map((r) => r.status)).toEqual(['failed']);
    expect(onReady).not.toHaveBeenCalled();
  });
  it("a 'ready' event re-reads the list and calls onReady with the model's id", async () => {
    list.mockResolvedValue([row('ready')]);
    send('ready'); await settle();
    expect(list).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith('aariz-cepha29');
    expect(current().rows.map((r) => r.status)).toEqual(['ready']);
  });
  it('a mid-install stage marks the row installing, does not re-read, and does not call onReady', async () => {
    send('downloading'); await settle();
    expect(list).toHaveBeenCalledTimes(1);
    expect(current().rows.map((r) => [r.status, r.stage])).toEqual([['installing', 'downloading']]);
    expect(onReady).not.toHaveBeenCalled();
  });
});
