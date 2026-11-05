import { describe, it, expect } from 'vitest';
import { compile, type AnalysisDef } from '@ceph/geometry';
import { ALL_ANALYSES, buildRegistry, loadSets, resolveNorm, type MyAnalysisDef } from '@ceph/analyses';
import { DEFAULT_ENABLED, enabledDefs } from '../analyses/enabled';
import { measurementRows } from '../measurements';
import { normCell, queryFor } from '../norms/normCell';
import { scaleOf } from '../tracing/spacing';
import { SYNTH_POINTS, synthDoc, synthFittedDoc } from '../report/fixtures';
import { ownPages } from '../compare/fit';
import { fittedValues } from '../compare/comparison';
import { docPoints, evaluateFilm } from './film';

const compiled = compile(buildRegistry(ALL_ANALYSES)), defs = enabledDefs(DEFAULT_ENABLED);
const n = { sets: loadSets(), userNorms: [], clinicDefault: null };

describe('a closed film worked out from its saved points (Library ▸ Export CSV…)', () => {
  it('gives exactly the rows the screen gives for the same points and scale', () => {
    const doc = synthDoc({ spacingMm: 0.1 });
    const { rows, cells } = evaluateFilm(doc, defs, compiled, 1, n, {});
    const pos = docPoints(doc);
    expect(rows).toEqual(measurementRows(defs, compiled, compiled.evaluate(pos, 0.1), new Set(Object.keys(pos)), 1, scaleOf(0.1)));
    expect(cells).toHaveLength(rows.length);
    expect(rows.find((r) => r.node === 'm03_ANB')!.num).not.toBeNull();
  });
  // Preflight-rulings Task 4 (Critical: test fails on correct code) — SYNTH_POINTS has no Co, so McNamara Co-A,
  // Co-Gn and the maxillomandibular difference come out "Needs: Co" with hidden: false (measurementRows hides only
  // a value it actually computed); assert on the mm rows that ARE computable, and separately that no mm row ever
  // carries a number on an uncalibrated film.
  it('hides every computable mm value on a film with no ruler calibration (N5), and keeps the angles', () => {
    const { rows } = evaluateFilm(synthDoc({ spacingMm: null }), defs, compiled, 1, n, {});
    const mm = rows.filter((r) => r.unit === 'mm' && r.needs.length === 0 && !r.undefinedReason);
    expect(mm.length).toBeGreaterThan(0);   // e.g. A-Nperp, Pog-Nperp, Pog-NB
    expect(mm.every((r) => r.hidden && r.num === null)).toBe(true);
    expect(rows.filter((r) => r.unit === 'mm').every((r) => r.num === null)).toBe(true);
    expect(rows.find((r) => r.node === 'm03_ANB')!.num).not.toBeNull();
  });
  it('positive control: moving B moves ANB', () => {
    const a = evaluateFilm(synthDoc(), defs, compiled, 1, n, {}).rows.find((r) => r.node === 'm03_ANB')!.num!;
    const b = evaluateFilm(synthDoc({}, { ...SYNTH_POINTS, B: { x: 990, y: 950 } }), defs, compiled, 1, n, {}).rows.find((r) => r.node === 'm03_ANB')!.num!;
    expect(b).not.toBeCloseTo(a, 3);
  });
  it('a film with no points: every row waits on its points', () => {
    const { rows } = evaluateFilm(synthDoc({ landmarks: [] }), defs, compiled, 1, n, {});
    expect(rows.every((r) => r.num === null && r.needs.length > 0)).toBe(true);
  });

  // Merge-second follow-up (b), final-review.md: evaluateFilm must query norms with r.normAnalysisId, never
  // r.analysisId — silent either way (both compile and run), but a "My analysis" row's analysisId ('my:…') is not
  // a real analysis the resolver knows, so querying on it would give a different, less specific norm than the one
  // the row's own normAnalysisId (its item's original built-in) resolves to, and the screen (App.tsx normFor,
  // norms/compare.ts compareCells) always queries on normAnalysisId.
  it('a "My analysis" row\'s CSV norm cell is queried on normAnalysisId, not analysisId, and equals what the screen shows for it', () => {
    const myAnb: MyAnalysisDef = { id: 'my:test-anb', name: 'My test', nodes: {}, mine: true,
      measurements: [{ node: 'm03_ANB', label: 'ANB' }], normFrom: { m03_ANB: 'steiner' }, unavailable: [] };
    const defsWithMy = [...defs, myAnb];
    const doc = synthDoc({ spacingMm: 0.1 });
    const { rows, cells } = evaluateFilm(doc, defsWithMy, compiled, 1, n, {});
    const myRow = rows.find((r) => r.analysisId === 'my:test-anb')!;
    expect(myRow.analysisId).not.toBe(myRow.normAnalysisId);   // the case this bug needs: the two ids differ
    expect(myRow.normAnalysisId).toBe('steiner');
    const myCell = cells[rows.indexOf(myRow)];
    // The screen's own path (App.tsx normFor / norms/compare.ts compareCells): queryFor on normAnalysisId.
    const screenQuery = queryFor(myRow.node, myRow.normAnalysisId, doc, n, {});
    const screenCell = normCell(myRow.num, resolveNorm(screenQuery), screenQuery, 1);
    expect(myCell).toEqual(screenCell);
    // Positive control for the test itself: querying on analysisId ('my:test-anb', not a real analysis the
    // resolver knows) gives a DIFFERENT cell — so this test can actually fail, and isn't comparing two equal
    // things by construction.
    const wrongQuery = queryFor(myRow.node, myRow.analysisId, doc, n, {});
    const wrongCell = normCell(myRow.num, resolveNorm(wrongQuery), wrongQuery, 1);
    expect(wrongCell).not.toEqual(screenCell);
  });
});

// R3 (final-review.md, part A): a film with no ruler, fitted to T1 with "Use the scale from the fit" on, gives
// Library ▸ Export CSV… exactly what its own screen gives — the screen's path is `ownPages` + `fittedValues`
// (App.tsx). SYNTHETIC films only.
// Every built-in analysis (not just the default ones), so every mm measurement is exercised.
const all = ALL_ANALYSES as unknown as AnalysisDef[];
describe('R3 (A): a fitted film is worked out on the scale its screen uses', () => {
  const screen = (doc: ReturnType<typeof synthDoc>) => {
    const p = ownPages(doc), pos = docPoints(doc);
    const values = fittedValues(compiled.evaluate(pos, p.own.mmPerPx), compiled, pos, p.scale);
    return { rows: measurementRows(all, compiled, values, new Set(Object.keys(pos)), 1, p.scale), scale: p.scale };
  };
  it('switch on: every mm row equals the screen\'s (Object.is), and every angle, % and ratio equals the switch-off row', () => {
    const on = synthFittedDoc(), off = synthFittedDoc({ useOwn: false });
    const got = evaluateFilm(on, all, compiled, 1, n, {}), want = screen(on), offRows = evaluateFilm(off, all, compiled, 1, n, {}).rows;
    expect(got.scale).toEqual(want.scale);
    expect(got.scale.source).toBe('fit');
    expect(got.rows).toHaveLength(want.rows.length);
    const mm = got.rows.filter((r) => r.unit === 'mm' && r.num !== null);
    expect(mm).toHaveLength(22);   // the computable mm rows are SHOWN (switch off: all 22 hidden)
    expect(offRows.filter((r) => r.unit === 'mm' && r.hidden)).toHaveLength(22);
    got.rows.forEach((r, i) => { expect(Object.is(r.num, want.rows[i].num)).toBe(true); expect(r.value).toBe(want.rows[i].value); });
    const notMm = got.rows.filter((r) => r.unit !== 'mm');
    console.log(`[R3 D1] rows ${got.rows.length}; mm shown ${mm.length}; non-mm with a number ${notMm.filter((r) => r.num !== null).length}`);
    expect(notMm.filter((r) => r.num !== null).length).toBeGreaterThanOrEqual(20);
    got.rows.forEach((r, i) => { if (r.unit !== 'mm') expect(Object.is(r.num, offRows[i].num)).toBe(true); });
    // the fitted mm really are the fit's: 0.1 × 1.042 mm per pixel, not the own (assumed) 0.1
    const pos = docPoints(on), atFit = compiled.evaluate(pos, 0.1 * 1.042);
    for (const r of mm) expect(Object.is(r.num, (atFit[r.node] as { v: number }).v)).toBe(true);
  });
});

// R3 (D2): the untouched path. With no fit, a fit with the switch off, or a ruler film with a fit, evaluateFilm and
// the report header equal main's (`scaleOf(doc.spacingMm)`) — compared with toEqual, which treats NaN as equal.
describe('R3 (D2): a film that is not on a fit scale is worked out exactly as on main', () => {
  const mainPath = (doc: ReturnType<typeof synthDoc>) => {
    const s = scaleOf(doc.spacingMm), pos = docPoints(doc);
    return { rows: measurementRows(all, compiled, compiled.evaluate(pos, s.mmPerPx), new Set(Object.keys(pos)), 1, s), scale: s };
  };
  const cases: [string, ReturnType<typeof synthDoc>][] = [
    ['no fit, no ruler', synthDoc({ spacingMm: null })],
    ['no fit, ruler', synthDoc({ spacingMm: 0.1 })],
    ['a fit with the switch off', synthFittedDoc({ useOwn: false })],
    ['a ruler film with a fit (a ruler wins)', synthFittedDoc({}, { spacingMm: 0.11 })],
  ];
  for (const [name, doc] of cases) it(name, () => {
    const got = evaluateFilm(doc, all, compiled, 1, n, {}), want = mainPath(doc);
    expect(got.rows).toEqual(want.rows);
    expect(got.scale).toEqual(want.scale);
    expect(got.rows.length).toBeGreaterThanOrEqual(60);
    expect(got.rows.filter((r) => r.unit === 'mm' && !r.needs.length && !r.undefinedReason)).toHaveLength(22);
    console.log(`[R3 D2] ${name}: ${got.rows.length} rows compared (${got.rows.filter((r) => r.unit === 'mm').length} mm), scale ${got.scale.source}`);
  });
});

describe('a fine-tuned calibration moves only the mm (spec 2026-10-19 addendum 3)', () => {
  const ruler = 0.0937, steps = 4, adjusted = ruler * ((200 + steps) / 200);
  const at = (spacingMm: number, scaleSteps: number) => evaluateFilm(synthDoc({ spacingMm, scaleSteps }), ALL_ANALYSES, compiled, 1, n, {});
  it('angles bit-identical (Object.is); %, ratios and their shown values unchanged; every mm × 1.02', () => {
    const a = at(ruler, 0), b = at(adjusted, steps);
    expect(b.scale).toEqual({ mmPerPx: adjusted, source: 'calibration', steps });
    expect(b.rows.map((r) => r.node)).toEqual(a.rows.map((r) => r.node));
    const seen = { deg: 0, mm: 0, other: 0 };
    a.rows.forEach((r, i) => {
      const s = b.rows[i];
      if (r.num === null) { expect(s.num).toBeNull(); return; }
      if (r.unit === 'deg') { expect(Object.is(s.num, r.num)).toBe(true); seen.deg++; }
      else if (r.unit === 'mm') { expect(s.num!).toBeCloseTo(r.num! * 1.02, 9); seen.mm++; }
      else { expect(s.value).toBe(r.value); expect(Math.abs(s.num! - r.num!)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(r.num!))); seen.other++; }
    });
    expect([seen.deg > 0, seen.mm > 0, seen.other > 0]).toEqual([true, true, true]);
  });
});
