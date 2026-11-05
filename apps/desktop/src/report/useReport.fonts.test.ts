// Task 9 review I2 (fix round 1): the three font-path edge cases the brief names ("the font still loading when
// Save PDF… is pressed, says why"; "the font failing to load, says why"; preflight-rulings' "Save pressed while
// searching [for a system CJK font], says so") had no guard that could fail — the implementer's report said only
// "code-reviewed". This commits a deterministic unit test for each, using the same fake-hook harness as
// `useReport.flush.test.ts` (no jsdom in this repo; `useReport` is a plain hook with no DOM dependency).
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

vi.mock('./words', () => ({
  readWords: async () => ({ value: {}, error: null }),
  saveWord: vi.fn(async () => ({})),
  resetWord: vi.fn(async () => ({})),
}));

// A mutable config the three tests set before rendering — `loadFonts`/`reportTexts`/`cachedCjkSearch` all read it
// live, so each test can pick its own font-loading outcome without three separate copies of this file's mocks.
const cfg = vi.hoisted(() => ({
  fontsResult: 'pending' as 'pending' | 'reject' | { has: (c: number) => boolean; regular: Uint8Array; bold: Uint8Array; cjk: null },
  texts: [] as string[],
  cjkResult: 'pending' as 'pending' | null,
}));
vi.mock('./model', () => ({
  buildReport: (x: { edits: unknown }) => ({ header: { patient: 'SYNTHETIC' }, film: { timepoint: 'T1', takenOn: null }, edits: x.edits }),
  modelsUsed: () => [], headerLines: () => [],
  reportTexts: () => cfg.texts,
  DEFAULT_REPORT_OPTIONS: { profilogramPage: false, normSources: false, placedBy: false },
}));
vi.mock('./fonts', () => ({
  loadFonts: () => {
    if (cfg.fontsResult === 'pending') return new Promise(() => {});
    if (cfg.fontsResult === 'reject') return Promise.reject(new Error('SYNTHETIC: font gone'));
    return Promise.resolve(cfg.fontsResult);
  },
}));
vi.mock('./systemFont', () => ({
  isCjk: (c: number) => c === 0x674e,   // 李
  cachedCjkSearch: () => (cfg.cjkResult === 'pending' ? new Promise(() => {}) : Promise.resolve(cfg.cjkResult)),
}));

import { useReport } from './useReport';

const input = {
  open: true, doc: { id: 'c1' } as never, rows: [], normFor: () => null, normsError: null, words: () => undefined, points: {},
  placer: () => null, titleOf: (m: string) => m, scale: { mmPerPx: 0.1, source: 'calibration' as const, steps: 0 }, dateFormat: 'iso' as never,
  defs: [], bitmap: null, orientation: { mirror: false, rotDeg: 0, source: 'none' } as never, display: {} as never, decimals: 1 as never,
  figureInput: { points: {}, registry: {}, overlays: {}, orientation: { mirror: false, rotDeg: 0, source: 'none' }, dims: { W: 1, H: 1 }, scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 } } as never,
};
const render = () => { h.begin(); const r = useReport(input); h.flushEffects(); return r; };
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { h.reset(); cfg.fontsResult = 'pending'; cfg.texts = []; cfg.cjkResult = 'pending'; });

describe('review I2 (deterministic): the font-loading edge cases savePdf must say something about', () => {
  it('still loading: savePdf rejects saying so', async () => {
    render(); await tick();   // the font-loading effect starts; loadFonts never resolves
    const r = render();
    await expect(r.savePdf('a4', false)).rejects.toThrow(/still loading/);
  });

  it('failed to load: savePdf rejects with why', async () => {
    cfg.fontsResult = 'reject';
    render(); await tick();   // the effect runs; loadFonts rejects -> fontError is set
    await tick();
    const r = render();
    await expect(r.savePdf('a4', false)).rejects.toThrow('SYNTHETIC: font gone');
  });

  it('still searching for a system CJK font: savePdf rejects saying so', async () => {
    cfg.fontsResult = { has: () => true, regular: new Uint8Array(), bold: new Uint8Array(), cjk: null };
    cfg.texts = ['李 SYNTHETIC'];   // needs a CJK font; cachedCjkSearch never resolves (above)
    render(); await tick();   // the font-loading AND the CJK-search effects both start
    await tick();              // let loadFonts settle
    const r = render();
    expect(r.print.searching).toBe(true);   // the state this test is actually exercising
    await expect(r.savePdf('a4', false)).rejects.toThrow(/Still looking/);
  });
});
