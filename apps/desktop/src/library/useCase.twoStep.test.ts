import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Automatic best Task 7 (owner D2; Q6 A): tracing in two steps, driven through the real `useCase` hook. Aariz's points
// are shown at once; a point the evidence gives to another model appears when that model answers; Replace all and
// batch wait for every model; automatic sign-off waits for points still to come; bars and error lines show only for a
// model whose ghost is on or that a held point waits for. SYNTHETIC data only: made-up films and points.
//
// The app has no DOM test renderer and no new dependency is allowed, so (as in useMyAnalyses.test.ts) the hook runs in
// a minimal stand-in for React's hooks: state, refs and reducers in slots by call order, callbacks and memos by deps,
// effects after each render. The tracing reducer is the real one; the hook's own code runs unchanged.
const host = vi.hoisted(() => {
  type Slot = { v?: unknown; deps?: unknown[] };
  const slots: Slot[] = [];
  let i = 0, rendering = false, again = false;
  let effects: (() => void)[] = [];
  let hook: (() => unknown) | null = null, result: unknown = null;
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const slot = () => (slots[i] ??= {}, slots[i++]);
  const render = (): void => {
    if (!hook) return;
    if (rendering) { again = true; return; }
    do {
      again = false; rendering = true; i = 0; effects = [];
      result = hook();
      rendering = false;
      for (const e of effects) e();
    } while (again);
  };
  return {
    react: {
      useState: <T,>(init: T) => {
        const s = slot();
        if (!('v' in s)) s.v = typeof init === 'function' ? (init as () => T)() : init;
        return [s.v as T, (n: T | ((p: T) => T)) => { s.v = typeof n === 'function' ? (n as (p: T) => T)(s.v as T) : n; render(); }] as const;
      },
      useReducer: <S, A>(red: (s: S, a: A) => S, init: S) => {
        const s = slot();
        if (!('v' in s)) s.v = init;
        return [s.v as S, (a: A) => { s.v = red(s.v as S, a); render(); }] as const;
      },
      useRef: <T,>(init: T) => { const s = slot(); if (!('v' in s)) s.v = { current: init }; return s.v as { current: T }; },
      useCallback: <F,>(fn: F, deps: unknown[]) => { const s = slot(); if (!same(s.deps, deps)) { s.v = fn; s.deps = deps; } return s.v as F; },
      useMemo: <T,>(fn: () => T, deps: unknown[]) => { const s = slot(); if (!same(s.deps, deps)) { s.v = fn(); s.deps = deps; } return s.v as T; },
      useEffect: (fn: () => void, deps?: unknown[]) => { const s = slot(); if (!deps || !same(s.deps, deps)) { s.deps = deps; effects.push(fn); } },
    },
    mount: <R,>(h: () => R) => { slots.length = 0; hook = h; render(); return () => result as R; },
    render,
  };
});
vi.mock('react', () => host.react);

// The back end, stubbed. Each extra-model call waits until the test answers it, so the test chooses when "later" is.
const be = vi.hoisted(() => ({
  docs: {} as Record<string, any>,
  extras: [] as { path: string; run: number | null; resolve: (x: unknown) => void; reject: (e: unknown) => void }[],
  recorded: [] as string[],
  signed: [] as string[],
  savedAi: [] as any[],
  calls: [] as string[],
  listeners: {} as Record<string, (e: { payload: unknown }) => void>,
  source: null as any,
  main: null as any,
  ghostsResult: [] as unknown,
  saved: [] as any[],
  table: null as any,
  quits: 0,
  failSave: false,
  saveGate: null as Promise<void> | null,
  recordGate: null as Promise<void> | null,
  failRecord: false,
  refuseSign: null as string | null,
  fresh: [] as (string[] | undefined)[],
  sourceGate: null as Promise<void> | null,
}));
vi.mock('../ipc', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  detectLandmarks: async (path: string) => { be.calls.push(`main ${path}`); return be.main(path); },
  detectExtras: (path: string, _facingLeft: boolean, run: number | null) => {
    be.calls.push(`extras ${path}`);
    return new Promise((resolve, reject) => { be.extras.push({ path, run, resolve, reject }); });
  },
  library: {
    open: async (id: string) => structuredClone(be.docs[id]),
    ruler: async () => null,
    ghosts: async () => be.ghostsResult,
    recordAi: async (id: string, run: { modelId: string }, _points: unknown, fresh?: string[]) => { be.fresh.push(fresh); if (be.recordGate) await be.recordGate; if (be.failRecord) throw new Error('SYNTHETIC: the library is busy'); be.recorded.push(`${id}:${run.modelId}`); },
    // Like the store: a save replaces the film's points (so a later open reads them back).
    save: async (e: any) => { if (be.saveGate) await be.saveGate; if (be.failSave) throw new Error('SYNTHETIC: the disk is full');
      be.saved.push(structuredClone(e)); if (be.docs[e.id]) Object.assign(be.docs[e.id], { landmarks: e.landmarks, orientation: e.orientation, display: e.display, facing: e.facing });
      return { updatedAt: 'u', verifiedAt: be.docs[e.id]?.verifiedAt ?? null }; },
    setVerified: async (id: string, v: boolean) => { if (v && be.refuseSign) throw be.refuseSign; be.signed.push(`${id}:${v}`); be.docs[id].verifiedAt = v ? 'SYNTHETIC-now' : null; be.docs[id].verifiedBy = v ? 'Dr Demo' : null; },
    saveAiIfUntraced: async (e: any) => { be.calls.push(`saveAi ${e.id}`); be.savedAi.push(e); return true; },
    import: async (p: string) => ({ caseId: p, created: true }),
    readLabel: async () => null,
  },
  models: { points: async () => be.table ?? TABLE, mainPointSource: async () => { const v = be.source; if (be.sourceGate) await be.sourceGate; return v; } },
  quitNow: () => { be.quits++; },
}));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: async (cmd: string) => { throw new Error(`no back end in this test: ${cmd}`); } }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: async () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (name: string, fn: (e: { payload: unknown }) => void) => { be.listeners[name] = fn; return () => {}; } }));

import { useCase, type CaseHooks } from './useCase';
import { initialTracing, tracingReducer, type Action, type TracingState } from '../tracing/state';
import { EXTRA_EVENT } from '../progress/modelBars';
import { toRow } from './persist';
import { SIGN_WAITING, signCheckWords } from '../ai/autoBestWords';

const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', GU = 'gu2net-isbi19';
const O = { kind: 'original' }, NS = { kind: 'notScored' };
const TABLE = [
  { modelId: AZ, title: 'Aariz', main: true, points: ['S', 'N', 'Po', 'Or', 'Go'].map((id) => ({ id, status: O })) },
  { modelId: SR, title: 'SRPose', main: false, points: [...['S', 'N', 'Po', 'Or', 'Go'].map((id) => ({ id, status: O })), { id: 'Ba', status: NS }] },
  { modelId: GU, title: 'GU2Net', main: false, points: ['S', 'N'].map((id) => ({ id, status: O })) },
];
const src = (uses: Record<string, string>) => ({ ruleVersion: 'x', confirmationPending: false, points: { S: AZ, N: AZ, Po: AZ, Or: AZ, Go: AZ },
  autoBest: { available: true, on: true, base: 'aariz-cepha29', uses, notes: {}, kept: {}, latest: [] } });
const lm = (id: string, x: number, y = 100) => ({ id, x, y, confidence: 0.9 });
const det = (modelId: string, landmarks: ReturnType<typeof lm>[]) => ({ modelId, imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub',
  timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks, raw: [] });
// Aariz: Po and Or at different heights, so levelling the film on them gives a non-zero turn.
const AARIZ_RUN = () => ({ ...det(AZ, [lm('S', 10), lm('N', 20), lm('Po', 30, 100), lm('Or', 60, 120), lm('Go', 40)]), facingLeft: false, meanPeakLeft: null, meanPeakRight: null });
const srOk = (extra: ReturnType<typeof lm>[] = []) => ({ modelId: SR, title: 'SRPose', error: null, timedOut: false,
  detection: det(SR, [lm('S', 11), lm('N', 21), lm('Po', 31, 90), lm('Or', 61, 130), lm('Go', 444), lm('Ba', 555), ...extra]) });
const blankDoc = (id: string, landmarks: any[] = []) => ({ id, patientName: 'Demo Synthetic', timepoint: 'T1', takenOn: null,
  image: { path: `/synthetic/${id}.png`, width: 1200, height: 1400 }, facing: 'right', orientation: {}, display: {}, spacingMm: null,
  verifiedAt: null, verifiedBy: null, landmarks, createdAt: 'c', updatedAt: 'u' });
const row = (id: string, x: number, source = 'ai', verified = false) => ({ id, x, y: 100, source, verified, aiX: x, aiY: 100, confidence: 0.9, placedBy: AZ });
const settle = async () => { for (let k = 0; k < 20; k++) await new Promise((r) => setTimeout(r, 0)); };

let tracing: TracingState;
const dispatch = (a: Action) => { tracing = tracingReducer(tracing, a); host.render(); };
let mounted: (() => ReturnType<typeof useCase>) | null = null;
function mount(hooks: CaseHooks = {}) {
  tracing = initialTracing;
  return (mounted = host.mount(() => useCase(tracing, dispatch, () => {}, hooks)));
}
// The saver writes 600 ms after an edit, on a real timer: write it now, so an edit of one test never lands in the next
// test's stub library (its `save` keeps what it is given, I2).
afterEach(async () => { await mounted?.().retrySave(); mounted = null; });
const ids = () => Object.keys(tracing.points).sort();
const answer = async (k: number, results: unknown[]) => { be.extras[k].resolve(results); await settle(); };
const bar = (modelId: string, title: string, run: number | null) =>
  be.listeners[EXTRA_EVENT]({ payload: { modelId, title, state: 'working', limitMs: 15000, run } });

beforeEach(() => {
  be.docs = { A: blankDoc('A'), B: blankDoc('B', [row('S', 5), row('N', 6)]) };
  be.extras = []; be.recorded = []; be.signed = []; be.savedAi = []; be.calls = []; be.listeners = {}; be.ghostsResult = []; be.saved = []; be.table = null; be.quits = 0; be.failSave = false; be.saveGate = null; be.sourceGate = null; be.recordGate = null; be.failRecord = false; be.refuseSign = null; be.fresh = [];
  be.source = src({ Go: SR }); be.main = AARIZ_RUN;
  vi.stubGlobal('fetch', async () => ({ blob: async () => ({}) }));
  vi.stubGlobal('createImageBitmap', async () => ({}));
});

describe('tracing in two steps (spec §3, §6; owner D2, Q6 A)', () => {
  it('Aariz’s points show at once; the point given to SRPose is held back, then appears when SRPose answers (with Ba)', async () => {
    const api = mount();
    void api().open('A'); await settle();
    expect(be.extras).toHaveLength(1);                                     // SRPose et al. are still running
    expect(ids()).toEqual(['N', 'Or', 'Po', 'S']);                         // Go held back, nothing from SRPose yet
    expect(api().busy).toBeNull();                                         // the film is usable now
    expect(api().placedBy).toEqual({ S: AZ, N: AZ, Po: AZ, Or: AZ });
    await answer(0, [srOk()]);
    expect(ids()).toEqual(['Ba', 'Go', 'N', 'Or', 'Po', 'S']);
    expect([tracing.points.Go.x, tracing.points.Go.source, tracing.points.Go.verified, tracing.points.S.x]).toEqual([444, 'ai', false, 10]);
    expect([api().placedBy!.Go, api().placedBy!.Ba, api().placedVia!.Go]).toEqual([SR, SR, 'auto-best']);
    expect(be.recorded).toEqual([`A:${AZ}`, `A:${SR}`]);
  });

  it('the waited-for model gives nothing (failed, or over its 15 s limit): Aariz’s own mark arrives instead', async () => {
    for (const out of [{ modelId: SR, title: 'SRPose', error: 'boom', timedOut: false, detection: null },
      { modelId: SR, title: 'SRPose', error: 'SRPose took longer than 15 s, so it was stopped.', timedOut: true, detection: null }]) {
      be.extras = [];
      const api = mount();
      void api().open('A'); await settle();
      expect(ids()).toEqual(['N', 'Or', 'Po', 'S']);
      await answer(0, [out]);
      expect([tracing.points.Go?.x, api().placedBy!.Go]).toEqual([40, AZ]);
    }
  });

  it('the extra-model call itself failing: Aariz’s mark arrives too, and the tracing has no error', async () => {
    const api = mount();
    void api().open('A'); await settle();
    be.extras[0].reject(new Error('the back end went away')); await settle();
    expect([tracing.points.Go?.x, api().error]).toEqual([40, null]);
  });

  it('a point you place, move or accept before its late result is never replaced', async () => {
    const api = mount();
    void api().open('A'); await settle();
    dispatch({ type: 'place', id: 'Go', pos: { x: 77, y: 7 } });          // placed by hand while SRPose runs
    await answer(0, [srOk()]);
    expect([tracing.points.Go.x, tracing.points.Go.source]).toEqual([77, 'manual']);
    expect(ids()).toEqual(['Ba', 'Go', 'N', 'Or', 'Po', 'S']);             // Ba (free) still arrives
    // Final review I1: the model's mark is remembered UNDER your point, for ⌘Z only. Your point itself saves no placer
    // (toRow writes placedBy only for an AI point), so it is still saved and labelled as yours.
    expect(api().placedBy!.Go).toBe(SR);
    expect(toRow('Go', tracing.points.Go, api().placedBy!.Go, api().placedVia!.Go)).toMatchObject({ source: 'manual', placedBy: null, placedVia: null });
  });

  it('place, drag a point, a late point arrives, ⌘Z: the drag is undone and the late point stays (fix round 1)', async () => {
    const api = mount();
    void api().open('A'); await settle();
    dispatch({ type: 'beginDrag', id: 'S' }); dispatch({ type: 'dragTo', pos: { x: 15, y: 105 } }); dispatch({ type: 'endDrag' });
    await answer(0, [srOk()]);
    expect([tracing.points.S.x, tracing.points.Go?.x]).toEqual([15, 444]);
    dispatch({ type: 'undo' });
    expect([tracing.points.S.x, tracing.points.Go?.x, tracing.points.Ba?.x]).toEqual([10, 444, 555]);
    dispatch({ type: 'undo' });                                           // back past the first placement: Go never goes
    expect(tracing.points.Go?.x).toBe(444);
  });

  // Final review I1 (owner, 28 Oct): a waiting point you place by hand, then ⌘Z, gives back the MODEL's mark, credited to
  // it, never an empty point. Driven through the real path (the hook never passes your point to `arrive`). Positive
  // control: restore `lateArrivals`' filter to "free on the film now" only -> Go is null after ⌘Z and this fails.
  it('a waiting point placed by hand, its model answers, ⌘Z: the model’s mark comes back, credited to it (I1)', async () => {
    const api = mount();
    void api().open('A'); await settle();
    dispatch({ type: 'place', id: 'Go', pos: { x: 77, y: 7 } });          // placed by hand while SRPose runs
    const steps = tracing.past.length;
    await answer(0, [srOk()]);
    expect([tracing.points.Go.x, tracing.points.Go.source]).toEqual([77, 'manual']);   // your point is never overwritten
    expect(tracing.past.length).toBe(steps);                              // the late mark made no ⌘Z step of its own
    dispatch({ type: 'undo' });
    expect([tracing.points.Go?.x, tracing.points.Go?.source, tracing.points.Go?.verified]).toEqual([444, 'ai', false]);
    expect([api().placedBy!.Go, api().placedVia!.Go]).toEqual([SR, 'auto-best']);
    dispatch({ type: 'redo' });                                           // ⌘⇧Z: your own point again
    expect([tracing.points.Go.x, tracing.points.Go.source]).toEqual([77, 'manual']);
  });

  it('a waiting point placed by hand while Po waits too: the late Po does not level the film under your hand (I1 edge)', async () => {
    be.source = src({ Po: SR, Go: SR });
    const api = mount();
    void api().open('A'); await settle();
    const before = tracing.orientation;
    dispatch({ type: 'place', id: 'Po', pos: { x: 33, y: 140 } });         // your Po; Or is Aariz's
    const mine = tracing.orientation;
    await answer(0, [srOk()]);
    expect([tracing.points.Po.x, tracing.orientation]).toEqual([33, mine]);   // the film you see is not turned
    dispatch({ type: 'undo' });
    expect([tracing.points.Po?.x, before.source]).toEqual([31, 'none']);
  });

  it('another film opened before the late result: nothing is placed on it and the late run is not stored (R2)', async () => {
    const api = mount();
    void api().open('A'); await settle();
    void api().open('B'); await settle();
    const before = structuredClone(tracing.points);
    await answer(0, [srOk()]);
    expect([api().doc!.id, tracing.points]).toEqual(['B', before]);
    expect(be.recorded).toEqual([`A:${AZ}`]);                              // Aariz's run of A was stored when shown; SRPose's is not
  });

  // Follow-up round (owner ruling, 28 Oct): "Mark verified" pressed while a point is coming WAITS for it; when the point
  // arrives the tracing is NOT signed off and you are asked to check it, as automatic sign-off does. Nothing is ever
  // signed off with a point unseen. Positive control: let the button sign at once (drop its wait in setVerified) ->
  // be.signed is ['A:true'] straight away and this fails.
  it('Mark verified while Go is coming: it waits, says so; Go arrives; not signed, you are asked to check Go', async () => {
    const api = mount();
    void api().open('A'); await settle();
    await api().setVerified(true); await settle();
    expect([be.signed, api().signOff?.holdLine]).toEqual([[], SIGN_WAITING]);
    await answer(0, [srOk()]);
    expect([be.signed, tracing.points.Go.x, tracing.points.Go.verified]).toEqual([[], 444, false]);
    expect(api().signOff?.holdLine).toBe(signCheckWords(['Go', 'Ba']));
    expect(be.recorded).toEqual([`A:${AZ}`, `A:${SR}`]);                   // its run is stored, as always
    dispatch({ type: 'acceptRemaining' }); await settle();                 // you check and accept them: now it signs
    expect([be.signed, api().signOff?.holdLine]).toEqual([['A:true'], null]);
  });

  it('Mark verified while Go is coming and SRPose fails: Aariz’s Go arrives unverified; still not signed', async () => {
    const api = mount();
    void api().open('A'); await settle();
    await api().setVerified(true); await settle();
    await answer(0, [{ modelId: SR, title: 'SRPose', error: 'SRPose took longer than 15 s, so it was stopped.', timedOut: true, detection: null }]);
    expect([be.signed, tracing.points.Go.x, tracing.points.Go.verified, api().signOff?.holdLine]).toEqual([[], 40, false, signCheckWords(['Go'])]);
  });

  it('Mark verified while the extras run but nothing new comes (or it goes only under your own point): it signs then', async () => {
    be.source = src({});
    let api = mount();
    void api().open('A'); await settle();
    await api().setVerified(true); await settle();
    expect(be.signed).toEqual([]);
    await answer(0, [{ ...srOk(), detection: det(SR, [lm('S', 11)]) }]);
    expect([be.signed, api().signOff?.holdLine]).toEqual([['A:true'], null]);
    be.docs.A = blankDoc('A'); be.signed = []; be.extras = []; be.source = src({ Go: SR });
    api = mount();
    void api().open('A'); await settle();
    dispatch({ type: 'place', id: 'Go', pos: { x: 77, y: 7 } });           // you placed Go yourself
    await api().setVerified(true); await settle();
    await answer(0, [{ ...srOk(), detection: det(SR, [lm('Go', 444)]) }]);
    expect([be.signed, tracing.points.Go.x]).toEqual([['A:true'], 77]);    // nothing unseen: signed
  });

  it('Mark verified, then you leave before Go arrives: Aariz’s Go is saved, nothing is signed, the words go', async () => {
    be.docs.B = blankDoc('B', [row('S', 5), row('N', 6)]);
    const api = mount();
    void api().open('A'); await settle();
    await api().setVerified(true); await settle();
    void api().open('B'); await settle();
    await answer(0, [srOk()]);
    expect([be.signed, rowOf('A', 'Go')?.x, rowOf('A', 'Go')?.verified, api().signOff?.holdLine]).toEqual([[], 40, false, null]);
  });

  it('Po arriving late levels a new film again', async () => {
    be.source = src({ Po: SR });
    const api = mount();
    void api().open('A'); await settle();
    expect([ids(), tracing.orientation.source, tracing.orientation.rotDeg]).toEqual([['Go', 'N', 'Or', 'S'], 'none', 0]);
    await answer(0, [srOk()]);
    expect(tracing.points.Po.x).toBe(31);
    expect(tracing.orientation.source).toBe('auto-FH');
    expect(tracing.orientation.rotDeg).not.toBe(0);
  });

  it('Re-detect that keeps your points works in two steps: the held point keeps its old mark until SRPose answers', async () => {
    be.docs.A = blankDoc('A', [row('S', 5), row('N', 6), row('Go', 7), row('Po', 8, 'manual', true)]);
    const api = mount();
    await api().open('A'); await settle();
    void api().redetect({}); await settle();
    expect([tracing.points.S.x, tracing.points.Go.x, tracing.points.Po.x, tracing.points.Or.x]).toEqual([10, 7, 8, 60]);
    await answer(0, [srOk()]);
    expect([tracing.points.Go.x, tracing.points.Po.x, tracing.points.Ba.x]).toEqual([444, 8, 555]);
  });

  it('Replace all waits for every model before showing anything, as before', async () => {
    be.docs.A = blankDoc('A', [row('S', 5), row('N', 6), row('Go', 7, 'manual', true)]);
    const api = mount();
    await api().open('A'); await settle();
    void api().redetect({ overwrite: true }); await settle();
    expect(be.extras).toHaveLength(1);
    expect([tracing.points.S.x, tracing.points.Go.x, tracing.points.Go.source]).toEqual([5, 7, 'manual']);   // nothing yet
    await answer(0, [srOk()]);
    expect([tracing.points.S.x, tracing.points.Go.x, tracing.points.Go.source, tracing.points.Ba.x]).toEqual([10, 444, 'ai', 555]);
  });

  it('batch tracing is unchanged: each film waits for every model, then is saved with SRPose’s point', async () => {
    const api = mount();
    const done = api().importFiles(['A', 'B2']);
    be.docs.B2 = blankDoc('B2');
    await settle();
    expect(be.calls).toEqual(['main /synthetic/A.png', 'extras /synthetic/A.png']);   // nothing saved before the extras answer
    await answer(0, [srOk()]);
    await answer(1, [srOk()]);
    await done;
    expect(be.calls).toEqual(['main /synthetic/A.png', 'extras /synthetic/A.png', 'saveAi A', 'main /synthetic/B2.png', 'extras /synthetic/B2.png', 'saveAi B2']);
    expect(be.savedAi[0].landmarks.find((l: { id: string }) => l.id === 'Go').x).toBe(444);
    expect(be.extras.map((x) => x.run)).toEqual([null, null]);             // a batch shows no bars
  });
});

// Final review I2 (owner ruling, 28 Oct: "Save Aariz's mark"): leaving a film while a point still waits for its model
// saves the film with Aariz's mark for that point -- unverified like every AI point, credited to Aariz, with no
// placed_via (Aariz placed it, not Automatic best). The film is never saved with a point missing. Driven through the
// real switch path (open another film), the Library button (close) and quit. SYNTHETIC: 19 made-up points.
// Positive control: remove the `saveHeld` call from `open` -> the first test saves 18 of 19 and fails.
const IDS19 = ['S', 'N', 'Or', 'Po', 'A', 'B', 'Pog', 'Me', 'Gn', 'Go', 'L1T', 'U1T', 'UL', 'LL', 'Sn', 'PogS', 'PNS', 'ANS', 'Ar'];
const T19 = [AZ, SR].map((modelId) => ({ modelId, title: modelId, main: modelId === AZ, points: IDS19.map((id) => ({ id, status: O })) }));
const AZ19 = (without: string[] = []) => () => ({ ...det(AZ, IDS19.filter((id) => !without.includes(id)).map((id, k) => lm(id, 10 + k, id === 'Or' ? 120 : 100))),
  facingLeft: false, meanPeakLeft: null, meanPeakRight: null });
const src19 = (uses: Record<string, string>) => ({ ...src(uses), points: Object.fromEntries(IDS19.map((id) => [id, AZ])) });
const lastSaved = (id: string) => [...be.saved].reverse().find((e) => e.id === id);
const rowOf = (id: string, pid: string) => lastSaved(id)?.landmarks.find((l: { id: string }) => l.id === pid);

describe('leaving a film while a point still waits: saved with Aariz’s mark (final review I2, owner 28 Oct)', () => {
  beforeEach(() => { be.table = T19; be.main = AZ19(); be.source = src19({ Go: SR }); });

  it('another film opened: the film left is saved with all 19 points, Go as Aariz’s unverified mark', async () => {
    const api = mount();
    void api().open('A'); await settle();
    expect(ids()).toHaveLength(18);                                        // Go is waiting for SRPose
    void api().open('B'); await settle();
    expect(lastSaved('A')?.landmarks).toHaveLength(19);
    expect(rowOf('A', 'Go')).toMatchObject({ x: 19, source: 'ai', verified: false, placedBy: AZ, placedVia: null });
    expect(rowOf('A', 'S')).toMatchObject({ placedBy: AZ, placedVia: 'auto-best' });   // the shown points keep theirs
    await answer(0, [srOk()]);                                             // SRPose answers late: nothing more (R2)
    expect([api().doc!.id, lastSaved('A')?.landmarks.length, rowOf('A', 'Go')?.x]).toEqual(['B', 19, 19]);
    void api().open('A'); await settle();                                  // reopened: 19 points, nothing traced again
    expect([ids().length, tracing.points.Go.x, be.calls.filter((c) => c.startsWith('main')).length]).toEqual([19, 19, 1]);
  });

  it('back to the Library (close) and quitting save it the same way', async () => {
    let api = mount();
    void api().open('A'); await settle();
    await api().close(); await settle();
    expect([lastSaved('A')?.landmarks.length, rowOf('A', 'Go')?.placedBy]).toEqual([19, AZ]);
    be.docs.A = blankDoc('A'); be.saved = []; be.extras = [];
    api = mount();
    void api().open('A'); await settle();
    be.listeners['cephtrace://quit-requested']({ payload: null }); await settle();
    expect([be.quits, lastSaved('A')?.landmarks.length, rowOf('A', 'Go')?.verified]).toEqual([1, 19, false]);
  });

  it('the point placed by hand meanwhile is saved as yours, not replaced by Aariz’s mark', async () => {
    const api = mount();
    void api().open('A'); await settle();
    dispatch({ type: 'place', id: 'Go', pos: { x: 77, y: 7 } });
    void api().open('B'); await settle();
    expect([lastSaved('A')?.landmarks.length, rowOf('A', 'Go')]).toEqual([19, expect.objectContaining({ x: 77, source: 'manual', placedBy: null })]);
  });

  it('Aariz itself has no Go: nothing to save for it; the film keeps its 18, and nothing fails', async () => {
    be.main = AZ19(['Go']);
    const api = mount();
    void api().open('A'); await settle();
    void api().open('B'); await settle();
    expect([lastSaved('A')?.landmarks.length, rowOf('A', 'Go'), api().error]).toEqual([18, undefined, null]);
  });

  // Follow-up round (re-review Minor): a save that fails on the way out is reported (the save status) and loses
  // nothing: the edit with your moved S AND Aariz's Go is kept and written by the next try. Before, the hand edit and
  // Aariz's mark were two separate writes and the retry of the first wrote over the second (Go lost).
  // Positive control: write Aariz's mark in a separate save after the flush (the old saveHeld) -> Go is lost.
  it('a failed save on the way out is reported and loses neither your moved point nor Aariz’s Go', async () => {
    const api = mount();
    void api().open('A'); await settle();
    dispatch({ type: 'place', id: 'S', pos: { x: 5, y: 5 } });            // you move S
    be.failSave = true;
    void api().open('B'); await settle();
    await new Promise((r) => setTimeout(r, 700)); await settle();         // past the saver's 600 ms: every write tried
    expect([api().save.status, api().save.error]).toEqual(['error', 'SYNTHETIC: the disk is full']);   // reported
    be.failSave = false;
    await api().retrySave(); await settle();
    expect([lastSaved('A')?.landmarks.length, rowOf('A', 'S')?.x, rowOf('A', 'S')?.source, rowOf('A', 'Go')?.x]).toEqual([19, 5, 'ai-adjusted', 19]);
  });

  // Follow-up round (re-review Minor): SRPose answers WHILE the film is being left (its save still in flight). Leaving
  // overtakes the run first (R2), so the film is written ONCE, with Aariz's mark (the owner's ruling); SRPose's late run
  // is neither drawn nor stored, and nothing is written twice. Positive control: the old two-write leave -> two saves.
  it('SRPose answering in the middle of a leave: one save of the film left, with Aariz’s Go; SRPose’s run not stored', async () => {
    const api = mount();
    void api().open('A'); await settle();
    const before = be.saved.length;
    let release!: () => void;
    be.saveGate = new Promise<void>((r) => { release = r; });
    void api().open('B'); await settle();
    await answer(0, [srOk()]);                                             // SRPose answers mid-leave
    be.saveGate = null; release(); await settle();
    const leaveSaves = be.saved.slice(before).filter((e) => e.id === 'A');
    expect([leaveSaves.length, leaveSaves[0]?.landmarks.length, rowOf('A', 'Go')?.x, rowOf('A', 'Go')?.placedBy]).toEqual([1, 19, 19, AZ]);
    expect(be.recorded).toEqual([`A:${AZ}`]);
  });

  it('automatic sign-off asked while Go waited, then you leave: saved with Aariz’s Go, not signed (Go is not accepted)', async () => {
    const api = mount();
    void api().open('A'); await settle();
    dispatch({ type: 'acceptRemaining' }); await settle();
    expect(be.signed).toEqual([]);                                          // waits for the point still coming
    void api().open('B'); await settle();
    expect([be.signed, rowOf('A', 'Go')?.verified, lastSaved('A')?.landmarks.length]).toEqual([[], false, 19]);
  });

  it('SRPose answered before you left: its mark is saved, not Aariz’s (nothing held any more)', async () => {
    const api = mount();
    void api().open('A'); await settle();
    await answer(0, [{ ...srOk(), detection: det(SR, IDS19.map((id) => lm(id, id === 'Go' ? 444 : 11))) }]);
    void api().open('B'); await settle();
    expect(rowOf('A', 'Go')).toMatchObject({ x: 444, placedBy: SR, placedVia: 'auto-best' });
  });
});

describe('automatic sign-off waits for points still to come (spec §3, owner D2)', () => {
  it('every shown point accepted while a point is coming: no sign-off; the late point arrives unaccepted; accepting it signs', async () => {
    const api = mount();
    void api().open('A'); await settle();
    dispatch({ type: 'acceptRemaining' }); await settle();
    expect(be.signed).toEqual([]);
    await answer(0, [srOk()]);
    expect([be.signed, tracing.points.Go.verified]).toEqual([[], false]);
    dispatch({ type: 'acceptRemaining' }); await settle();
    expect(be.signed).toEqual(['A:true']);
  });

  it('asked while the extras run but nothing came: it signs once they have answered', async () => {
    be.source = src({});                                                 // no point waits for another model
    const api = mount();
    void api().open('A'); await settle();
    expect(ids()).toEqual(['Go', 'N', 'Or', 'Po', 'S']);
    dispatch({ type: 'acceptRemaining' }); await settle();
    expect(be.signed).toEqual([]);
    await answer(0, [{ ...srOk(), detection: det(SR, [lm('S', 11)]) }]);
    expect(be.signed).toEqual(['A:true']);
  });

  it('nothing coming any more: sign-off is at once, as before', async () => {
    const api = mount();
    void api().open('A'); await settle();
    await answer(0, [srOk()]);
    dispatch({ type: 'acceptRemaining' }); await settle();
    expect(be.signed).toEqual(['A:true']);
  });

  it('another film opened while the last one’s points were coming: accepting every point on it signs at once', async () => {
    be.docs.B = blankDoc('B', [row('S', 5), row('N', 6)]);               // traced already: opening it runs no model
    const api = mount();
    void api().open('A'); await settle();
    void api().open('B'); await settle();
    expect(be.extras).toHaveLength(1);                                     // A's extras have not answered
    dispatch({ type: 'acceptRemaining' }); await settle();
    expect(be.signed).toEqual(['B:true']);
  });
});

// Leftovers Task 4 (M9): a sign-off asked while a run's points were coming belongs to that run. A Re-detect that overtakes
// it starts a new run; the old run never reaches its late step, so its request is stale and must not sign the new run.
// The stale request could only sign when the new run ends with nothing landing and every point accepted (a point that
// lands already stops it: `!landing.length`), so the first test's second run has no Go anywhere. SYNTHETIC films.
// Positive control: remove the M9 line at the top of `detect()` -> the first test signs ('A:true') and fails.
describe('a Re-detect drops the overtaken run\'s sign-off request (M9)', () => {
  const NO_GO = () => ({ ...AARIZ_RUN(), landmarks: AARIZ_RUN().landmarks.filter((l) => l.id !== 'Go') });
  it('Re-detect overtakes a run with a sign-off request pending; nothing new comes: no automatic sign-off', async () => {
    const api = mount();
    void api().open('A'); await settle();                                  // run 1: Go waits for SRPose
    dispatch({ type: 'acceptRemaining' }); await settle();                 // every shown point accepted: asked while coming
    expect([be.signed, ids()]).toEqual([[], ['N', 'Or', 'Po', 'S']]);
    be.main = NO_GO;                                                       // run 2: no model has a Go
    void api().redetect({}); await settle();
    expect(be.extras).toHaveLength(2);                                     // run 2's extras are held too
    await answer(0, [srOk()]);                                             // run 1 answers late: overtaken, nothing placed
    expect([be.signed, tracing.points.Go]).toEqual([[], undefined]);
    await answer(1, [{ ...srOk(), detection: det(SR, [lm('S', 11)]) }]);  // run 2 ends; nothing new on the film
    expect([ids(), Object.values(tracing.points).every((p) => p.verified)]).toEqual([['N', 'Or', 'Po', 'S'], true]);
    expect(be.signed).toEqual([]);                                         // the stale request did not sign it
    dispatch({ type: 'acceptRemaining' }); await settle();                 // nothing left to accept: no new request
    expect(be.signed).toEqual([]);
    await api().setVerified(true); await settle();                         // the button still signs it
    expect(be.signed).toEqual(['A:true']);
  });
  // Ruling on Task 4 concern 1: a run that THROWS after its points are shown (here its main run's library
  // write fails) ends through `finally`, which resets `coming` but
  // (before this fix) not the request; the next run starts with `coming === 0`, so the M9 line did not clear it either.
  // Positive control: drop the clear in `finally` -> 'A:true' and this fails.
  it('a run that throws after its points are shown, then a Re-detect where nothing new comes: its leftover request never signs', async () => {
    const api = mount();
    let fail!: (e: unknown) => void;
    be.recordGate = new Promise<void>((_, rej) => { fail = rej; });       // run 1's write of its main run is held
    void api().open('A'); await settle();                                  // run 1: points shown, Go waits for SRPose
    dispatch({ type: 'acceptRemaining' }); await settle();                 // asked while coming
    expect(be.signed).toEqual([]);
    fail(new Error('SYNTHETIC: the library is locked')); await settle();   // run 1 throws after its points were shown
    expect([be.signed, api().error, be.extras.length]).toEqual([[], 'Error: SYNTHETIC: the library is locked', 0]);
    be.recordGate = null; be.main = NO_GO;
    void api().redetect({}); await settle();                               // run 2 starts with nothing coming
    await answer(0, [{ ...srOk(), detection: det(SR, [lm('S', 11)]) }]);  // ends; nothing new on the film
    expect([ids(), Object.values(tracing.points).every((p) => p.verified)]).toEqual([['N', 'Or', 'Po', 'S'], true]);
    expect(be.signed).toEqual([]);                                         // the failed run's request did not sign it
  });
  it('the brief\'s own case: Re-detect overtakes, run 2 lands a new point: not signed (before and after M9: landing stops it)', async () => {
    const api = mount();
    void api().open('A'); await settle();
    dispatch({ type: 'acceptRemaining' }); await settle();
    void api().redetect({}); await settle();
    await answer(0, [srOk()]);
    expect(be.signed).toEqual([]);
    await answer(1, [srOk()]);                                             // Go and Ba land, unaccepted
    expect([be.signed, tracing.points.Go.x, tracing.points.Go.verified]).toEqual([[], 444, false]);
  });
  it('a request asked DURING the Re-detect\'s own run still signs it when nothing new comes', async () => {
    const api = mount();
    void api().open('A'); await settle();
    be.main = NO_GO;
    void api().redetect({}); await settle();                               // overtakes run 1 with no request pending
    await answer(0, [srOk()]);
    dispatch({ type: 'acceptRemaining' }); await settle();                 // asked while run 2's extras are coming
    expect(be.signed).toEqual([]);
    await answer(1, [{ ...srOk(), detection: det(SR, [lm('S', 11)]) }]);
    expect(be.signed).toEqual(['A:true']);
  });
});

describe('quiet: bars and error lines only for a model whose ghost is on or that a point waits for (spec §6, D2)', () => {
  it('ghosts off: the extras still run; SRPose (waited for) shows its bar and its line, GU2Net (not waited for) shows neither', async () => {
    const api = mount({ extraShown: () => false });
    void api().open('A'); await settle();
    expect(be.calls).toContain('extras /synthetic/A.png');
    const run = be.extras[0].run;
    bar(SR, 'SRPose', run); bar(GU, 'GU2Net', run);
    expect(api().modelBars.map((b) => b.id)).toEqual(['main', SR]);
    await answer(0, [{ modelId: SR, title: 'SRPose', error: 'SRPose took longer than 15 s, so it was stopped.', timedOut: true, detection: null },
      { modelId: GU, title: 'GU2Net', error: 'boom', timedOut: false, detection: null }]);
    expect(api().extraErrors).toEqual(['SRPose took longer than 15 s, so it was stopped.']);
    expect(api().extraFailed).toEqual(['SRPose', 'GU2Net']);              // no ghost for either, whatever is shown
  });

  it('ghosts on: every bar and every line, as before', async () => {
    const api = mount({ extraShown: () => true });
    void api().open('A'); await settle();
    const run = be.extras[0].run;
    bar(SR, 'SRPose', run); bar(GU, 'GU2Net', run);
    expect(api().modelBars.map((b) => b.id)).toEqual(['main', SR, GU]);
    await answer(0, [{ modelId: GU, title: 'GU2Net', error: 'boom', timedOut: false, detection: null }]);
    expect(api().extraErrors).toEqual(['GU2Net couldn\'t read this film.']);
  });

  it('ghosts off, Replace all after a run that waited for SRPose: no point waits now, so no SRPose bar', async () => {
    const api = mount({ extraShown: () => false });
    void api().open('A'); await settle();
    await answer(0, [srOk()]);
    void api().redetect({ overwrite: true }); await settle();
    bar(SR, 'SRPose', be.extras[1].run);
    expect(api().modelBars.map((b) => b.id)).toEqual(['main']);
  });

  it('no hooks passed: every bar shows (the default), and a bar from an older run never shows', async () => {
    const api = mount();
    void api().open('A'); await settle();
    const run = be.extras[0].run;
    bar(GU, 'GU2Net', run); bar(SR, 'SRPose', (run ?? 0) - 1);
    expect(api().modelBars.map((b) => b.id)).toEqual(['main', GU]);
  });
});

// Automatic best Task 10: App.tsx's new ghost code reads `kase.aiPoints.filter(...)` directly (unguarded, as every
// other reader of `aiPoints` already assumed an array). `library.ghosts` is typed to return `ModelPoints[]`, but
// nothing stops a back end (or, as found live, this very test's default-case stub returning `null` for an unhandled
// command) from resolving `null`; `setAiPoints` had no `?? []` guard, unlike its sibling `useModels.refresh`
// (`setRows(r ?? [])`), so `aiPoints` could carry `null` at runtime despite its type. Found by running the Task 10
// e2e smokes: e2e13 (no `library_ghosts` stub, so the stub's own `default: return null` fired) crashed on
// `kase.aiPoints.filter` with "Cannot read properties of null (reading 'filter')".
// Spec §11 ("a signed-off tracing gets no new point"): coverage dropped by the follow-up round (re-review Minor,
// 28 Oct) when its two direct tests were replaced by tests of the NEW waiting behaviour rather than retargeted at a
// still-reachable route into the same state. This restores it via a route the wait guard does not block: a film is
// signed off once its first run has fully landed (coming.current is 0, so the button signs at once and automatic
// sign-off fires normally), then a SECOND run (Re-detect) holds a point again and its late answer must still be
// dropped, by `useCase.ts`'s own `docRef.current?.verifiedAt` check -- not by the point's own `verified` flag, so the
// new point here (`Ba2`) is one the film has never carried before (onFilm[id] undefined), which `lateArrivals` would
// otherwise let land. Positive control: in `detect()`, change
// `docRef.current?.verifiedAt ? { ...full, landmarks: [] } : lateArrivals(...)` to call `lateArrivals(...)`
// unconditionally -> Ba2 lands and both tests below fail.
describe('a signed-off tracing gets no new point (spec §11)', () => {
  const TABLE_BA2 = [
    { modelId: AZ, title: 'Aariz', main: true, points: ['S', 'N', 'Po', 'Or', 'Go'].map((id) => ({ id, status: O })) },
    { modelId: SR, title: 'SRPose', main: false, points: [...['S', 'N', 'Po', 'Or', 'Go'].map((id) => ({ id, status: O })), { id: 'Ba', status: NS }, { id: 'Ba2', status: NS }] },
  ];
  beforeEach(() => { be.table = TABLE_BA2; });

  it('signed off by the button, then Re-detect: a brand-new late point (Ba2) is not added; the saved tracing is unchanged', async () => {
    const api = mount();
    void api().open('A'); await settle();
    await answer(0, [srOk()]);                                   // round 1: Go and Ba land, nothing accepted
    expect(be.signed).toEqual([]);
    await api().setVerified(true); await settle();                // coming.current is 0 now: the button signs at once
    expect(be.signed).toEqual(['A:true']);
    const before = { ids: ids(), savedLen: be.saved.length };
    void api().redetect({}); await settle();                      // round 2: Go is held again
    expect(be.extras).toHaveLength(2);
    await answer(1, [{ ...srOk(), detection: det(SR, [lm('S', 11), lm('N', 21), lm('Po', 31, 90), lm('Or', 61, 130), lm('Go', 444), lm('Ba', 555), lm('Ba2', 777)]) }]);
    expect(ids()).toEqual(before.ids);                            // Ba2 never lands
    expect(tracing.points.Ba2).toBeUndefined();
    expect(be.docs.A.verifiedAt).toBe('SYNTHETIC-now');           // still signed, untouched
    await api().retrySave(); await settle();
    expect(lastSaved('A')?.landmarks.find((l: { id: string }) => l.id === 'Ba2')).toBeUndefined();
    expect(lastSaved('A')?.landmarks).toHaveLength(before.ids.length);
  });

  it('signed off automatically (every point accepted), then Re-detect: a brand-new late point (Ba2) is not added', async () => {
    const api = mount();
    void api().open('A'); await settle();
    await answer(0, [srOk()]);                                   // Go and Ba land
    dispatch({ type: 'acceptRemaining' }); await settle();         // every point accepted, nothing coming: signs at once
    expect(be.signed).toEqual(['A:true']);
    const before = { ids: ids(), savedLen: be.saved.length };
    void api().redetect({}); await settle();
    expect(be.extras).toHaveLength(2);
    await answer(1, [{ ...srOk(), detection: det(SR, [lm('S', 11), lm('N', 21), lm('Po', 31, 90), lm('Or', 61, 130), lm('Go', 444), lm('Ba', 555), lm('Ba2', 777)]) }]);
    expect(ids()).toEqual(before.ids);
    expect(tracing.points.Ba2).toBeUndefined();
    expect(be.docs.A.verifiedAt).toBe('SYNTHETIC-now');
    await api().retrySave(); await settle();
    expect(lastSaved('A')?.landmarks.find((l: { id: string }) => l.id === 'Ba2')).toBeUndefined();
  });
});

// Follow-up round (re-review Minor, 28 Oct): no test isolated the plain "no Automatic best, nothing held" path through
// the reordered `stageHeld()`/`saver.flush()` calls in `open()`/`close()` -- every twoStep test runs with Automatic
// best on. This drives an ordinary film (Automatic best off, every point placed by the main model at once, so
// `held.current` is always null) through `close()`: `stageHeld()` must be a true no-op there, so the film is saved
// exactly once, with exactly the points it had; a failed save is still reported and retried; and nothing Aariz-fallback
// is ever added. Positive control: in `detect()`, change `held.current = all.fallback.length ? {...} : null` to always
// build the held entry (as if a point were pending) regardless of `all.fallback.length` -> `close()`'s `stageHeld()`
// then acts on an ordinary film and the point count / single-save assertions below fail.
describe('an ordinary film, Automatic best off, nothing held: open()/close() through the reordered stageHeld()/flush()', () => {
  const plainSource = () => ({ ruleVersion: 'x', confirmationPending: false, points: { S: AZ, N: AZ, Po: AZ, Or: AZ, Go: AZ },
    autoBest: { available: true, on: false, base: 'aariz-cepha29', uses: {}, notes: {}, kept: {}, latest: [] } });
  beforeEach(() => { be.source = plainSource(); });

  it('close() saves the film exactly once, with exactly its 5 points; nothing held is added', async () => {
    const api = mount();
    void api().open('A'); await settle();
    expect(ids()).toEqual(['Go', 'N', 'Or', 'Po', 'S']);           // every point landed at once: nothing waits
    const before = be.saved.length;
    await api().close(); await settle();
    const mine = be.saved.slice(before).filter((e) => e.id === 'A');
    expect(mine).toHaveLength(1);                                  // saved exactly once
    expect(mine[0].landmarks.map((l: { id: string }) => l.id).sort()).toEqual(['Go', 'N', 'Or', 'Po', 'S']);
  });

  it('a failed save on the way out is still reported, and a retry saves the same 5 points', async () => {
    const api = mount();
    void api().open('A'); await settle();
    be.failSave = true;
    await api().close(); await settle();
    expect([api().save.status, api().save.error]).toEqual(['error', 'SYNTHETIC: the disk is full']);
    be.failSave = false;
    await api().retrySave(); await settle();
    expect(lastSaved('A')?.landmarks.map((l: { id: string }) => l.id).sort()).toEqual(['Go', 'N', 'Or', 'Po', 'S']);
  });
});

describe('aiPoints never carries null, even when the back end answers null (regression)', () => {
  it('open on an already-traced film: library.ghosts() resolving null leaves aiPoints as [], not null', async () => {
    be.ghostsResult = null;
    const api = mount();
    void api().open('B'); await settle();
    expect(api().aiPoints).toEqual([]);
  });
  it('open on an untraced film, after the background extras answer and ghosts re-reads as null: still []', async () => {
    be.ghostsResult = null;
    const api = mount();
    void api().open('A'); await settle();
    await answer(0, [srOk()]);
    expect(api().aiPoints).toEqual([]);
  });
});

describe('M4: the "choices could not be read" flag belongs to the film on screen (I1, fix round 1)', () => {
  const unreadable = () => ({ ...src({ Go: SR }), autoBest: null, autoBestUnreadable: true });
  it('(a) nothing open: no film is flagged', async () => {
    be.source = unreadable();
    const api = mount();
    expect(api().unreadableFor).toBeNull();
  });
  it('a traced-from-scratch film whose choices are unreadable is flagged by its own id', async () => {
    be.source = unreadable();
    const api = mount();
    void api().open('A'); await settle();
    expect(api().unreadableFor).toBe('A');
    expect(tracing.points.Go.x).toBe(40);                                   // the base's own Go, not SRPose's
  });
  it('(b) an already-traced film opened next: the flag is cleared and no detection sets it again', async () => {
    be.source = unreadable();
    const api = mount();
    void api().open('A'); await settle();
    expect(api().unreadableFor).toBe('A');
    void api().open('B'); await settle();
    expect(api().unreadableFor).toBeNull();
  });
  it('(c) batch tracing does not set it', async () => {
    be.source = unreadable();
    const api = mount();
    be.docs.C = blankDoc('C'); be.docs.D = blankDoc('D');
    const p = api().importFiles(['C', 'D']); await settle();
    await answer(0, [srOk()]); await answer(1, [srOk()]); await p; await settle();
    expect(be.savedAi.map((e: any) => e.id)).toEqual(['C', 'D']);          // both films were really traced (control)
    expect(api().unreadableFor).toBeNull();
  });
  it('(d) the table unreadable: placeOnFilm never reads the source, and the old flag is gone anyway', async () => {
    be.source = unreadable();
    const api = mount();
    void api().open('A'); await settle();
    expect(api().unreadableFor).toBe('A');
    be.table = { notAnArray: true } as any;                                  // loadTable yields a non-array: the early return
    void api().redetect({}); await settle();
    expect(api().unreadableFor).toBeNull();
  });
  it('closing the film clears it', async () => {
    be.source = unreadable();
    const api = mount();
    void api().open('A'); await settle();
    await api().close(); await settle();
    expect(api().unreadableFor).toBeNull();
  });
  it('m3: an overtaken run (another film opened while it read) cannot set the flag on the newer film', async () => {
    let release: () => void = () => {};
    be.sourceGate = new Promise<void>((r) => { release = r; });
    be.source = unreadable();
    const api = mount();
    void api().open('A'); await settle();                                    // A's tracing is held inside its source read
    be.sourceGate = null;
    be.source = src({ Go: SR });                                             // B's choices read fine
    void api().open('B'); await settle();
    release(); await settle();                                               // A's read now finishes, overtaken
    expect(api().unreadableFor).toBeNull();
  });
});

// Whole-branch review I1: the screen's copy of the check must follow the run it belongs to. The hook says when a run of the
// open film is being recorded (`checkRecording`) and moves `checkRev` after each run is recorded, so the screen's read is
// issued after the write and a read that won the race is not taken for the new run's check. Today's failure: the screen
// re-read when `busy` cleared, which is BEFORE `recordAi` resolves, and nothing marked the read stale.
describe('the point check follows each run (whole-branch review I1)', () => {
  const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };
  it('recording from the start of a detection until its run is stored; the rev moves only after; the late run is stored BEFORE its points land', async () => {
    const g = gate(); be.recordGate = g.p;
    const api = mount();
    const rev0 = api().checkRev;
    void api().open('A'); await settle();
    expect(ids()).toEqual(['N', 'Or', 'Po', 'S']);                         // Aariz's points are on the film
    expect(api().busy).toBeNull();                                         // (the old read trigger has fired)
    expect([api().checkRecording, be.recorded]).toEqual([true, []]);       // ...but its run, and its check, are not stored yet
    expect(api().checkRev).toBe(rev0 + 1);                                 // the start of the run moved it once (a new read is due)
    be.recordGate = null; g.open(); await settle();
    expect([api().checkRecording, be.recorded]).toEqual([false, [`A:${AZ}`]]);
    const rev1 = api().checkRev;
    expect(rev1).toBeGreaterThan(rev0 + 1);                                // stored: a read issued from now on sees it
    const g2 = gate(); be.recordGate = g2.p;
    await answer(0, [srOk()]);
    expect(tracing.points.Go).toBeUndefined();                             // SRPose's Go waits until SRPose's run is stored
    expect(api().checkRecording).toBe(true);
    be.recordGate = null; g2.open(); await settle();
    expect([tracing.points.Go?.x, be.recorded, api().checkRecording]).toEqual([444, [`A:${AZ}`, `A:${SR}`], false]);
    expect(api().checkRev).toBeGreaterThan(rev1);
  });
  it('Replace all: recording until every model\'s run is stored', async () => {
    be.docs.B = blankDoc('B', [row('S', 5), row('N', 6)]);
    const api = mount();
    void api().open('B'); await settle();
    const g = gate(); be.recordGate = g.p;
    void api().redetect({ overwrite: true }); await settle();
    await answer(0, [srOk()]);
    expect(api().checkRecording).toBe(true);
    be.recordGate = null; g.open(); await settle();
    expect([api().checkRecording, be.recorded]).toEqual([false, [`B:${AZ}`, `B:${SR}`]]);
  });
  it('a run that fails to be stored still ends the recording (never a hold that cannot lift)', async () => {
    be.failRecord = true;
    const api = mount();
    void api().open('A'); await settle();
    expect(api().checkRecording).toBe(false);
  });
  it('another film opened mid-run: the new film is not left recording', async () => {
    const g = gate(); be.recordGate = g.p;
    const api = mount();
    void api().open('A'); await settle();
    void api().open('B'); await settle();
    be.recordGate = null; g.open(); await settle();
    expect(api().checkRecording).toBe(false);
  });
});

// Whole-branch review I2 (front end): the hold is checked on the state at the moment of signing, after the awaits, not
// once before them; the sign-off first waits for the check of the current run to be read; and the store's own refusal
// ("Press Checked on the film note first.") is silent on the automatic path. Today's failures: the hold was read once at
// entry (a film note that landed meanwhile was signed over), and the store's refusal showed as an error after an
// automatic attempt.
describe('the sign-off hold is checked on the latest state (whole-branch review I2)', () => {
  // C: S accepted, N not. Opening it sets no hold, so accepting N (a bulk accept here) asks for the automatic sign-off.
  const ready = () => { be.docs.C = blankDoc('C', [row('S', 5, 'ai', true), row('N', 6)]); };
  const sign = async (api: () => ReturnType<typeof useCase>, how: 'button' | 'auto') => {
    if (how === 'auto') dispatch({ type: 'acceptRemaining' }); else { dispatch({ type: 'acceptRemaining' }); void api().setVerified(true, 'button'); }
    await settle();
  };
  for (const how of ['button', 'auto'] as const) {
    it(`${how}: a film note that lands while the sign-off waits for the check's read stops it`, async () => {
      ready();
      let held = false, open!: () => void;
      const read = new Promise<void>((r) => { open = r; });
      const api = mount({ signHeld: () => held, checkSettled: () => read });
      void api().open('C'); await settle();
      await sign(api, how);
      expect(be.signed).toEqual([]);                                       // it waits for the read
      held = true; open(); await settle();                                 // the read lands: a film note, unresolved
      expect(be.signed).toEqual([]);
    });
    it(`${how}, control: the same with no film note signs once the read lands`, async () => {
      ready();
      let open!: () => void;
      const read = new Promise<void>((r) => { open = r; });
      const api = mount({ signHeld: () => false, checkSettled: () => read });
      void api().open('C'); await settle();
      await sign(api, how);
      expect(be.signed).toEqual([]);
      open(); await settle();
      expect(be.signed).toEqual(['C:true']);
    });
  }
  it('the store refuses an automatic sign-off for a film note: no error on screen; a press shows the words', async () => {
    ready();
    be.refuseSign = 'Press Checked on the film note first.';
    const api = mount({ signHeld: () => false });
    void api().open('C'); await settle();
    dispatch({ type: 'acceptRemaining' }); await settle();                 // the automatic attempt
    expect([be.signed, api().error]).toEqual([[], null]);
    await api().setVerified(true, 'button'); await settle();
    expect(api().error).toBe('Press Checked on the film note first.');
  });
});

// Re-review N1: Replace all puts a fresh, unverified pin at every point, and its runs are stored before the autosave writes
// those pins. The detection names the pins it replaced, so the store carries no earlier look to them. Fails today: the
// runs are stored with no names (undefined). Control: a Re-detect that keeps your points names none.
describe('Replace all names the pins it replaced (re-review N1)', () => {
  it('every run of a Replace all is stored with the ids of the pins it put on the film; a keeping Re-detect names none', async () => {
    be.docs.B = blankDoc('B', [row('S', 5, 'ai', true), row('N', 6, 'ai', true)]);
    const api = mount();
    void api().open('B'); await settle();
    void api().redetect({ overwrite: true }); await settle();
    await answer(0, [srOk()]);
    const placed = ids();
    expect(be.recorded).toEqual([`B:${AZ}`, `B:${SR}`]);
    expect(be.fresh.map((f) => [...(f ?? [])].sort())).toEqual([placed, placed]);   // main run and SRPose's run alike
    expect(placed).toContain('N');                                         // N was verified before: now a fresh pin
    be.fresh = []; be.recorded = [];
    void api().redetect({}); await settle();
    await answer(1, [srOk()]);
    expect(be.recorded.length).toBe(2);
    expect(be.fresh.every((f) => !f || f.length === 0)).toBe(true);
  });
});
