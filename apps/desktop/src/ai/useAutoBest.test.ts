import { describe, it, expect, vi, beforeEach } from 'vitest';
import { beforePlacingOf, notesAfterUndo, runIntro, useAutoBest } from './useAutoBest';
import { caseHooksOf } from './caseHooks';
import { event } from './autoBestFixtures';

// The app has no DOM test renderer (and no new dependencies are allowed), so, as in useMyAnalyses.test.ts, the hook runs
// in a minimal stand-in for React's hooks: state and refs in slots by call order, callbacks by deps, effects after each
// render. `notesAfterUndo` below is a plain function and does not touch it.
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
const ipc = vi.hoisted(() => ({ models: {} as Record<string, unknown> }));
vi.mock('../ipc', () => ipc);
const settle = () => new Promise((r) => setTimeout(r, 0));

// Final review I3 (spec §6a): after an Undo, from a note or from Models…, the notes at that point are out of date and
// go; an adoption the Undo handed the point to is a change like any other and gets its own note (with its own Undo).
// SYNTHETIC rows. Positive control: return `notes` unchanged -> both tests fail.
const GU = 'gu2net-isbi19';
describe('notes after an Automatic best Undo (final review I3)', () => {
  it('the Undo hands Gonion to GU2Net: SRPose’s note goes, GU2Net’s adoption is a new note; other points keep theirs', () => {
    const sr = event({ id: 1 }), n = event({ id: 2, landmarkId: 'N' });
    const rows = [event({ id: 3, kind: 'undone', uses: GU }), event({ id: 4, kind: 'adopted', modelId: GU, uses: GU })];
    expect(notesAfterUndo([sr, n], sr, rows, true).map((e) => [e.id, e.landmarkId, e.kind, e.modelId])).toEqual([[2, 'N', 'adopted', 'srpose-cldet23'], [4, 'Go', 'adopted', GU]]);
  });
  it('an Undo from Models… with nothing handed on: the stale note at that point goes and no new one appears', () => {
    const stale = event({ id: 1 });
    expect(notesAfterUndo([stale], event({ id: 5 }), [event({ id: 6, kind: 'undone', uses: null })], true)).toEqual([]);
  });
  // Follow-up round (concern 4): like sync(), no new note while Automatic best is not the main model; the stale note
  // at that point still goes. Positive control: ignore `on` -> GU2Net's note appears and this fails.
  it('Automatic best not main: the stale note goes, and the handed-on adoption shows no note', () => {
    const sr = event({ id: 1 });
    const rows = [event({ id: 3, kind: 'undone', uses: GU }), event({ id: 4, kind: 'adopted', modelId: GU, uses: GU })];
    expect(notesAfterUndo([sr], sr, rows, false)).toEqual([]);
  });
});

// Leftovers Task 3 (M2): Automatic best stays off until the first-open step has run on a library with films. When the
// base is installed mid-session, the screen runs the step again (`reintro`) so its note shows at once, no relaunch.
// SYNTHETIC answers. Positive control: `reintro` that does not call the step again -> both tests fail.
describe('reintro: the first-open step again, after the base is installed (M2)', () => {
  beforeEach(() => { for (const k of Object.keys(ipc.models)) delete ipc.models[k]; });
  it('reintro runs the first-open step again and shows its note (M2)', async () => {
    const intro = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ before: null, keptDeclines: 1 });
    const sync = vi.fn().mockResolvedValue({ on: true, events: [] });
    Object.assign(ipc.models, { autoBestIntro: intro, autoBestSync: sync });
    const current = host.mount(() => useAutoBest(() => {}));
    await current().ready; await settle();
    expect(current().intro).toBeNull();
    const syncsBefore = sync.mock.calls.length;
    await current().reintro(); await settle();
    expect(intro).toHaveBeenCalledTimes(2);
    expect(current().intro).toEqual({ before: null, keptDeclines: 1 });
    expect(sync.mock.calls.length).toBe(syncsBefore + 1);   // then the check, now that it may be on
  });
  it('reintro when the step already ran: no second note, the shown note is left as it is', async () => {
    const intro = vi.fn().mockResolvedValueOnce({ before: 'gu2net-isbi19', keptDeclines: 0 }).mockResolvedValue(null);
    Object.assign(ipc.models, { autoBestIntro: intro, autoBestSync: vi.fn().mockResolvedValue({ on: true, events: [] }) });
    const current = host.mount(() => useAutoBest(() => {}));
    await current().ready; await settle();
    current().closeIntro();
    await current().reintro(); await settle();
    expect(intro).toHaveBeenCalledTimes(2);
    expect(current().intro).toBeNull();
  });
});

// Leftovers Task 4 (M1): the check before a tracing waits for the first-open step, so a film traced in the first second
// after launch cannot record an adoption the owner had declined in Part F (the step carries those declines). SYNTHETIC.
// Positive control: `beforePlacingOf` returning `ab.sync()` without waiting for `ready` -> the first test fails, and so
// does the App wiring test (which is how the App wired it before).
describe('the check before a tracing waits for the first-open step (M1)', () => {
  it('the before-tracing check waits for the first-open step (M1)', async () => {
    let open!: () => void;
    const ready = new Promise<void>((r) => { open = r; });
    const sync = vi.fn().mockResolvedValue(undefined);
    const p = beforePlacingOf({ ready, sync });
    await Promise.resolve(); await Promise.resolve();
    expect(sync).not.toHaveBeenCalled();
    open(); await p;
    expect(sync).toHaveBeenCalledTimes(1);
  });
  it('with no Automatic best yet, the check resolves and calls nothing', async () => {
    await expect(beforePlacingOf(null)).resolves.toBeUndefined();
  });
  it('the first-open step already done: the check runs at once (one turn of the queue)', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const p = beforePlacingOf({ ready: Promise.resolve(), sync });
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(1);
    await p;
  });
  it('the first-open step failing: ready still resolves (runIntro catches, says so), then the check runs', async () => {
    let fail!: (e: unknown) => void;
    const setError = vi.fn(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ready = runIntro(() => new Promise((_, rej) => { fail = rej; }), () => {}, setError);
    const sync = vi.fn().mockResolvedValue(undefined);
    const p = beforePlacingOf({ ready, sync });
    await settle();
    expect(sync).not.toHaveBeenCalled();
    fail(new Error('SYNTHETIC: the library is locked'));
    await expect(p).resolves.toBeUndefined();
    expect([sync.mock.calls.length, setError.mock.calls.length]).toEqual([1, 1]);
    warn.mockRestore();
  });
  it('the App wiring: the open case\'s beforePlacing waits for the step; with no Automatic best yet it resolves', async () => {
    let open!: () => void;
    const ready = new Promise<void>((r) => { open = r; });
    const sync = vi.fn().mockResolvedValue(undefined);
    const ref: { current: { ready: Promise<void>; sync: () => Promise<void> } | null } = { current: null };
    const hooks = caseHooksOf(ref, { current: null });
    await expect(hooks.beforePlacing!()).resolves.toBeUndefined();     // useCase declared before useAutoBest: ref empty
    ref.current = { ready, sync };
    const p = hooks.beforePlacing!();
    await settle();
    expect(sync).not.toHaveBeenCalled();                               // a film traced before the step has run waits
    open(); await p;
    expect(sync).toHaveBeenCalledTimes(1);
    hooks.afterSignOff!(); await settle();                             // after a sign-off: the check, as before
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
