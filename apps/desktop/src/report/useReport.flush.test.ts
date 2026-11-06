// Deterministic regression test for the typed-word race (Task 9 review I1, fix round 1): the e2e smoke's fake
// `settings_set` (e2e14.cjs R21) resolves before Playwright's click fires, so that smoke can never fail here no
// matter what `useReport`/`useReportWords` do — confirmed by the implementer's own report (the brief's control (a)
// did not catch `words.words` used instead of `await words.flush()`). This file is the reviewer's own probe
// (`/tmp/rv9-zzReviewFlush.test.ts`, Task 9 review), committed and extended with a `savePdf` twin so BOTH exported
// paths are covered, not just Export CSV….
//
// There is no jsdom in this repo, and `useReport`/`useReportWords` are plain hooks (useState/useRef/useMemo/
// useCallback/useEffect) with no DOM dependency of their own — so instead of mounting a real React tree, `react`
// is replaced with a tiny fake that keeps hook state in an array of "slots" (one per hook call, in call order,
// exactly like React's own rules of hooks) and defers effects to run after each render via `flushEffects()`.
// `saveWord`/`resetWord` are mocked to return a single DEFERRED promise that the test resolves by hand
// (`d.resolve`), so "the save is still in flight when Export CSV…/Save PDF… is pressed" is forced on every run,
// never left to timing.
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
  let promise = new Promise((r) => { resolve = r; });
  return {
    get promise() { return promise; },
    resolve: (w: unknown) => resolve(w),
    reset() { promise = new Promise((r) => { resolve = r; }); },
  };
});
vi.mock('./words', () => ({
  readWords: async () => ({ value: {}, error: null }),
  saveWord: vi.fn(() => d.promise),
  resetWord: vi.fn(() => d.promise),
}));
const seen = vi.hoisted(() => ({ csvEdits: [] as unknown[], pdfEdits: [] as unknown[] }));
vi.mock('./model', () => ({
  buildReport: (x: { edits: unknown }) => ({ header: { patient: 'SYNTHETIC' }, film: { timepoint: 'T1', takenOn: null }, edits: x.edits }),
  modelsUsed: () => [], headerLines: () => [], reportTexts: () => [],
  DEFAULT_REPORT_OPTIONS: { profilogramPage: false, normSources: false, placedBy: false, pointsTable: true },
}));
vi.mock('../export/measurementsCsv', () => ({
  measurementsCsv: (ms: Array<{ edits: unknown }>) => { seen.csvEdits.push(ms[0].edits); return 'csv'; },
  readSalt: async () => 'salt',
}));
vi.mock('./save', () => ({ chooseAndSave: async () => true }));
vi.mock('./fonts', () => ({ loadFonts: async () => ({ has: () => true, regular: new Uint8Array(), bold: new Uint8Array(), cjk: null }) }));
vi.mock('./pdf', () => ({ buildPdf: (x: { model: { edits: unknown } }) => { seen.pdfEdits.push(x.model.edits); return new Uint8Array(); } }));
vi.mock('./shapes', () => ({ figure: () => ({ shapes: [], img: { x: 0, y: 0, w: 10, h: 10 } }) }));

import { useReport } from './useReport';

const input = {
  open: true, doc: { id: 'c1' } as never, rows: [], normFor: () => null, normsError: null, words: () => undefined, points: {},
  placer: () => null, titleOf: (m: string) => m, scale: { mmPerPx: 0.1, source: 'calibration' as const, steps: 0 }, dateFormat: 'iso' as never,
  defs: [], bitmap: null, orientation: { mirror: false, rotDeg: 0, source: 'none' } as never, display: {} as never, decimals: 1 as never,
  figureInput: { points: {}, registry: {}, overlays: {}, orientation: { mirror: false, rotDeg: 0, source: 'none' }, dims: { W: 1, H: 1 }, scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 } } as never,
};
const render = () => { h.begin(); const r = useReport(input); h.flushEffects(); return r; };
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { h.reset(); d.reset(); seen.csvEdits = []; seen.pdfEdits = []; });

describe('review I1 (deterministic): a word typed, then Export CSV…/Save PDF… pressed before its save lands', () => {
  it('Export CSV… carries the typed word (saveCsv waits for the pending save)', async () => {
    render(); await tick();               // the read lands
    const r = render();                   // the render the click handler belongs to
    r.words.save('steiner:m01', 'typed SYNTHETIC', 'usual');   // blur: the save starts, not yet landed
    const out = r.saveCsv({ anonymise: false, layout: 'tidy' });   // the click, from the SAME (stale) render
    await tick();
    d.resolve({ 'steiner:m01': { text: 'typed SYNTHETIC', was: 'usual' } });   // the save lands only now
    expect(await out).toBe(true);
    expect(seen.csvEdits).toEqual([{ 'steiner:m01': { text: 'typed SYNTHETIC', was: 'usual' } }]);
  });

  it('Save PDF… carries the typed word too (savePdf waits for the pending save)', async () => {
    render(); await tick();
    let r = render();
    // The PDF font must be loaded (not "still loading") before the pending-save race is the thing under test;
    // `loadFonts` resolves asynchronously even in this mock, so give its effect a turn first.
    await tick(); r = render();
    r.words.save('steiner:m01', 'typed SYNTHETIC', 'usual');
    const out = r.savePdf('a4', false);
    await tick();
    d.resolve({ 'steiner:m01': { text: 'typed SYNTHETIC', was: 'usual' } });
    expect(await out).toBe(true);
    expect(seen.pdfEdits).toEqual([{ 'steiner:m01': { text: 'typed SYNTHETIC', was: 'usual' } }]);
  });
});

// Review I2 (Task 8): a report made while the film's point check is unread (or its read failed) would carry blank
// `point_check` cells that read as "nothing flagged". Export CSV… and Save PDF… refuse, in words, and write nothing.
describe('Task 8 review I2: no export while the point check is unread or failed', () => {
  const renderWith = (problem: string | null) => { h.begin(); const r = useReport({ ...input, pointCheckProblem: problem }); h.flushEffects(); return r; };
  it('Export CSV… and Save PDF… refuse with the words and write nothing', async () => {
    const words = 'The point check could not be read.';
    renderWith(words); await tick(); renderWith(words); await tick();      // as the control: the report's reads have landed
    const r = renderWith(words);
    await expect(r.saveCsv({ anonymise: false, layout: 'points' })).rejects.toThrow(words);
    await expect(r.savePdf('a4', false)).rejects.toThrow(words);
    expect(seen.csvEdits).toEqual([]); expect(seen.pdfEdits).toEqual([]);
  });
  it('control: with no problem the same calls export', async () => {
    render(); await tick(); render(); await tick(); const r = renderWith(null);
    d.resolve({});
    expect(await r.saveCsv({ anonymise: false, layout: 'points' })).toBe(true);
    expect(seen.csvEdits.length).toBe(1);
  });
});
